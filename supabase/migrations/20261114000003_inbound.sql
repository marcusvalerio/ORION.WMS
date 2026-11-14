-- =============================================================================
-- ORION WMS — Frente C: Entrada
--   * recebimento parcial do mesmo pedido em várias entregas
--   * importação de XML de NF-e (modelo 55) com de-para fornecedor × código
--   * agenda de docas (sem sobreposição garantida no banco)
--   * devolução de cliente com inspeção por item
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Recebimento parcial
-- -----------------------------------------------------------------------------
-- O pedido de compra pode ter vários recebimentos. A regra "não ultrapassar o
-- pedido" passa a ser garantida pelo serviço sob lock do pedido (SELECT ... FOR
-- UPDATE em erp.purchase_orders), e o que exceder fisicamente vira divergência
-- de sobra na conferência (regra existente).
drop index if exists wms.receipts_po_active_uniq;
create index if not exists receipts_po_idx on wms.receipts (purchase_order_id) where purchase_order_id is not null;

-- CNPJ do fornecedor no cadastro do ERP local (usado para casar o emitente da NF-e).
alter table erp.suppliers add column if not exists cnpj text
  check (cnpj is null or cnpj ~ '^[0-9]{14}$');
create unique index if not exists suppliers_cnpj_uniq on erp.suppliers (company_id, cnpj) where cnpj is not null;

-- -----------------------------------------------------------------------------
-- 2. NF-e (XML) e de-para fornecedor × código
-- -----------------------------------------------------------------------------
create table wms.supplier_product_codes (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references erp.companies(id),
  supplier_id    uuid not null references erp.suppliers(id),
  supplier_code  text not null check (length(supplier_code) between 1 and 60),
  product_id     uuid not null references erp.products(id),
  confirmed_by   uuid not null references wms.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, supplier_id, supplier_code)
);

create table wms.nfe_imports (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references erp.companies(id),
  access_key         text not null check (access_key ~ '^[0-9]{44}$'),
  number             text not null,
  series             text not null,
  issued_at          timestamptz,
  emitter_cnpj       text not null check (emitter_cnpj ~ '^[0-9]{14}$'),
  emitter_name       text not null,
  supplier_id        uuid references erp.suppliers(id),
  purchase_order_id  uuid references erp.purchase_orders(id),
  receipt_id         uuid references wms.receipts(id),
  status             text not null default 'pending' check (status in ('pending', 'received', 'discarded')),
  xml                text not null check (length(xml) <= 1048576),
  created_by         uuid not null references wms.users(id),
  created_at         timestamptz not null default now(),
  check (status <> 'received' or receipt_id is not null)
);
-- Uma mesma NF-e (chave) só pode estar ativa uma vez por empresa.
create unique index nfe_imports_key_active_uniq on wms.nfe_imports (company_id, access_key) where status <> 'discarded';

create table wms.nfe_import_items (
  id                   uuid primary key default gen_random_uuid(),
  import_id            uuid not null references wms.nfe_imports(id),
  item_no              integer not null,
  supplier_code        text not null,
  ean                  text,
  description          text not null,
  quantity             numeric(14,3) not null check (quantity > 0),
  unit                 text not null,
  units_factor         numeric(14,3) not null default 1 check (units_factor > 0),
  lots                 jsonb not null default '[]'::jsonb,
  po_number_ref        text,
  product_id           uuid references erp.products(id),
  match_source         text check (match_source is null or match_source in ('ean', 'supplier_code', 'manual')),
  unique (import_id, item_no),
  check ((product_id is null) = (match_source is null))
);

alter table wms.receipts add column if not exists nfe_import_id uuid references wms.nfe_imports(id);

-- -----------------------------------------------------------------------------
-- 3. Agenda de docas
-- -----------------------------------------------------------------------------
create table wms.docks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references erp.companies(id),
  warehouse_id  uuid not null references wms.warehouses(id),
  code          text not null,
  name          text not null,
  dock_type     text not null check (dock_type in ('inbound', 'outbound', 'both')),
  active        boolean not null default true,
  created_by    uuid references wms.users(id),
  created_at    timestamptz not null default now(),
  unique (warehouse_id, code)
);

create table wms.dock_appointments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references erp.companies(id),
  warehouse_id       uuid not null references wms.warehouses(id),
  dock_id            uuid not null references wms.docks(id),
  code               text not null,
  direction          text not null check (direction in ('inbound', 'outbound')),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  carrier            text,
  vehicle_plate      text,
  purchase_order_id  uuid references erp.purchase_orders(id),
  outbound_order_id  uuid references wms.outbound_orders(id),
  status             text not null default 'scheduled'
                     check (status in ('scheduled', 'checked_in', 'no_show', 'completed', 'cancelled')),
  checked_in_at      timestamptz,
  completed_at       timestamptz,
  notes              text,
  created_by         uuid not null references wms.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, code),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours'),
  check (purchase_order_id is null or outbound_order_id is null),
  check (direction = 'inbound' or purchase_order_id is null),
  check (direction = 'outbound' or outbound_order_id is null),
  check (status <> 'checked_in' or checked_in_at is not null)
);
create index dock_appointments_dock_idx on wms.dock_appointments (dock_id, starts_at);
create index dock_appointments_day_idx on wms.dock_appointments (company_id, starts_at);

-- Sem sobreposição na mesma doca. Implementado como trigger com lock da linha da
-- doca (em vez de EXCLUDE USING gist, que exigiria a extensão btree_gist para o
-- uuid): duas transações que agendam a mesma doca serializam no lock, e a segunda
-- enxerga o agendamento confirmado da primeira. Funciona igual em PGlite e Postgres.
create or replace function wms.dock_appointment_no_overlap() returns trigger
language plpgsql as $$
declare
  conflict text;
begin
  if new.status not in ('scheduled', 'checked_in', 'completed') then
    return new;
  end if;
  perform 1 from wms.docks where id = new.dock_id for update;
  select a.code into conflict
  from wms.dock_appointments a
  where a.dock_id = new.dock_id
    and a.id <> new.id
    and a.status in ('scheduled', 'checked_in', 'completed')
    and tstzrange(a.starts_at, a.ends_at) && tstzrange(new.starts_at, new.ends_at)
  limit 1;
  if conflict is not null then
    raise exception 'Doca ocupada neste horário: conflito com o agendamento %.', conflict
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger dock_appointments_no_overlap before insert or update of dock_id, starts_at, ends_at, status
  on wms.dock_appointments for each row execute function wms.dock_appointment_no_overlap();

alter table wms.receipts add column if not exists appointment_id uuid references wms.dock_appointments(id);
create unique index if not exists receipts_appointment_active_uniq on wms.receipts (appointment_id)
  where appointment_id is not null and status <> 'cancelled';

-- -----------------------------------------------------------------------------
-- 4. Devolução de cliente
-- -----------------------------------------------------------------------------
create table wms.customer_returns (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references erp.companies(id),
  warehouse_id       uuid not null references wms.warehouses(id),
  code               text not null,
  outbound_order_id  uuid not null references wms.outbound_orders(id),
  customer_name      text not null,
  reason             text not null check (reason in ('damaged_in_transit', 'wrong_item', 'quality', 'regret', 'excess', 'other')),
  reason_notes       text,
  status             text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  is_demo            boolean not null default false,
  created_by         uuid not null references wms.users(id),
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  unique (company_id, code)
);
create index customer_returns_order_idx on wms.customer_returns (outbound_order_id);

create table wms.customer_return_items (
  id             uuid primary key default gen_random_uuid(),
  return_id      uuid not null references wms.customer_returns(id),
  line_no        integer not null,
  order_line_id  uuid not null references wms.outbound_order_lines(id),
  product_id     uuid not null references erp.products(id),
  lot_code       text not null default '',
  expiry_date    date,
  quantity       numeric(14,3) not null check (quantity > 0),
  approved_qty   numeric(14,3) not null default 0 check (approved_qty >= 0),
  damaged_qty    numeric(14,3) not null default 0 check (damaged_qty >= 0),
  discarded_qty  numeric(14,3) not null default 0 check (discarded_qty >= 0),
  inspected      boolean not null default false,
  inspection_notes text,
  inspected_by   uuid references wms.users(id),
  inspected_at   timestamptz,
  unique (return_id, line_no),
  -- inspecionado: as três destinações somam exatamente a quantidade devolvida
  check (not inspected or approved_qty + damaged_qty + discarded_qty = quantity),
  check (inspected or approved_qty + damaged_qty + discarded_qty = 0)
);

alter table wms.tasks add column if not exists customer_return_id uuid references wms.customer_returns(id);

-- Novos tipos de movimentação: entrada por devolução e baixa por descarte.
alter table wms.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table wms.stock_movements add constraint stock_movements_movement_type_check check (movement_type in
  ('putaway', 'transfer', 'adjustment_in', 'adjustment_out', 'pick', 'shipment', 'block', 'unblock',
   'return_in', 'discard'));

-- Origem de divergência para devoluções.
alter table wms.divergences drop constraint if exists divergences_source_check;
alter table wms.divergences add constraint divergences_source_check
  check (source in ('receipt', 'picking', 'outbound_check', 'inventory', 'customer_return'));

-- -----------------------------------------------------------------------------
-- RLS (mesmo padrão de 20261009000003)
-- -----------------------------------------------------------------------------
alter table wms.supplier_product_codes enable row level security;
alter table wms.nfe_imports enable row level security;
alter table wms.nfe_import_items enable row level security;
alter table wms.docks enable row level security;
alter table wms.dock_appointments enable row level security;
alter table wms.customer_returns enable row level security;
alter table wms.customer_return_items enable row level security;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas da Frente C não foram criadas (ambiente local).';
    return;
  end if;
  foreach t in array array['supplier_product_codes', 'nfe_imports', 'docks', 'dock_appointments', 'customer_returns'] loop
    execute format(
      'create policy tenant_read on wms.%I for select to authenticated using (company_id = wms.current_company_id())', t);
  end loop;
  execute $p$create policy tenant_read on wms.nfe_import_items for select to authenticated
    using (exists (select 1 from wms.nfe_imports i where i.id = import_id and i.company_id = wms.current_company_id()))$p$;
  execute $p$create policy tenant_read on wms.customer_return_items for select to authenticated
    using (exists (select 1 from wms.customer_returns r where r.id = return_id and r.company_id = wms.current_company_id()))$p$;
end
$$;
