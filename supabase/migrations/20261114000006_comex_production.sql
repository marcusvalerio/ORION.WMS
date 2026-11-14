-- =============================================================================
-- ORION WMS — Frente F: comércio internacional e abastecimento de produção
-- -----------------------------------------------------------------------------
--  1. Importação: DI/DUIMP, desembaraço, Incoterm, país de origem, contêiner
--     (dígito ISO 6346), lacre, NCM por item e retenção aduaneira.
--  2. Origem do lote (wms.lot_origins): o país de origem acompanha o lote.
--  3. Exportação: dados do pedido, volumes (packing list) e estufagem.
--  4. Produção: ordens de produção do ERP (schema erp local) e, no WMS,
--     requisições de material, reservas, separação para a linha, entrega,
--     devolução de sobras e recebimento de produto acabado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funções de validação (usadas em CHECK; também validadas no servidor)
-- -----------------------------------------------------------------------------

-- Contêiner ISO 6346: 3 letras do proprietário + categoria (U, J ou Z) + 6 dígitos + dígito verificador.
create or replace function wms.iso6346_valid(c text) returns boolean
language plpgsql immutable as $$
declare
  alphabet constant text := '0123456789A?BCDEFGHIJK?LMNOPQRSTU?VWXYZ';
  total integer := 0;
  v integer;
  i integer;
  check_digit integer;
begin
  if c is null or c !~ '^[A-Z]{3}[UJZ][0-9]{7}$' then
    return false;
  end if;
  for i in 1..10 loop
    v := strpos(alphabet, substr(c, i, 1)) - 1;
    total := total + v * (1 << (i - 1));
  end loop;
  check_digit := (total % 11) % 10;
  return check_digit = substr(c, 11, 1)::integer;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Importação no recebimento
-- -----------------------------------------------------------------------------
alter table erp.products add column ncm text check (ncm is null or ncm ~ '^[0-9]{8}$');

alter table wms.receipts
  add column import_doc_type     text check (import_doc_type is null or import_doc_type in ('DI', 'DUIMP')),
  add column import_doc_number   text check (import_doc_number is null or length(import_doc_number) between 5 and 30),
  add column incoterm            text,
  add column origin_country      text check (origin_country is null or origin_country ~ '^[A-Z]{2}$'),
  add column container_number    text check (container_number is null or wms.iso6346_valid(container_number)),
  add column seal_number         text check (seal_number is null or length(seal_number) between 1 and 30),
  add column customs_status      text not null default 'none' check (customs_status in ('none', 'awaiting', 'cleared')),
  add column customs_cleared_on  date,
  add column customs_cleared_by  uuid references wms.users(id),
  add column customs_cleared_at  timestamptz;

alter table wms.receipts
  add constraint receipts_incoterm_check check (incoterm is null or incoterm in
    ('EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF')),
  add constraint receipts_import_doc_pair check ((import_doc_type is null) = (import_doc_number is null)),
  add constraint receipts_customs_doc check (customs_status = 'none' or import_doc_type is not null),
  add constraint receipts_customs_cleared check (
    customs_status <> 'cleared' or (customs_cleared_on is not null and customs_cleared_by is not null and customs_cleared_at is not null)),
  -- Retenção aduaneira: enquanto aguarda desembaraço, o recebimento não pode ser liberado para armazenagem.
  add constraint receipts_customs_hold check (customs_status <> 'awaiting' or status in ('expected', 'checking', 'checked', 'cancelled'));

alter table wms.receipt_items add column ncm text check (ncm is null or ncm ~ '^[0-9]{8}$');

-- País de origem por lote (segue o lote no saldo, na consulta e na rastreabilidade).
create table wms.lot_origins (
  company_id      uuid not null references erp.companies(id),
  product_id      uuid not null references erp.products(id),
  lot_code        text not null check (lot_code <> ''),
  origin_country  text not null check (origin_country ~ '^[A-Z]{2}$'),
  receipt_id      uuid references wms.receipts(id),
  created_at      timestamptz not null default now(),
  primary key (company_id, product_id, lot_code)
);

-- -----------------------------------------------------------------------------
-- 2. Exportação
-- -----------------------------------------------------------------------------
alter table wms.outbound_orders
  add column is_export            boolean not null default false,
  add column export_incoterm      text,
  add column destination_country  text check (destination_country is null or destination_country ~ '^[A-Z]{2}$'),
  add column commercial_invoice   text check (commercial_invoice is null or length(commercial_invoice) between 1 and 40),
  add column export_declaration   text check (export_declaration is null or length(export_declaration) between 1 and 40),
  add column container_number     text check (container_number is null or wms.iso6346_valid(container_number)),
  add column seal_number          text check (seal_number is null or length(seal_number) between 1 and 30),
  add column stuffed_at           timestamptz,
  add column packed_at            timestamptz;

alter table wms.outbound_orders
  add constraint outbound_export_incoterm_check check (export_incoterm is null or export_incoterm in
    ('EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF')),
  add constraint outbound_export_fields check (
    is_export or (export_incoterm is null and destination_country is null and container_number is null and packed_at is null)),
  add constraint outbound_stuffing_check check (stuffed_at is null or (container_number is not null and seal_number is not null));

create table wms.export_packages (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references erp.companies(id),
  order_id         uuid not null references wms.outbound_orders(id),
  package_no       integer not null check (package_no > 0),
  package_type     text not null default 'box' check (package_type in ('box', 'pallet', 'crate', 'drum', 'other')),
  gross_weight_kg  numeric(12,3) not null check (gross_weight_kg > 0),
  net_weight_kg    numeric(12,3) not null check (net_weight_kg > 0),
  length_cm        numeric(10,2) not null check (length_cm > 0),
  width_cm         numeric(10,2) not null check (width_cm > 0),
  height_cm        numeric(10,2) not null check (height_cm > 0),
  created_by       uuid not null references wms.users(id),
  created_at       timestamptz not null default now(),
  unique (order_id, package_no),
  check (gross_weight_kg >= net_weight_kg)
);
create index export_packages_order_idx on wms.export_packages (order_id);

create table wms.export_package_items (
  id             uuid primary key default gen_random_uuid(),
  package_id     uuid not null references wms.export_packages(id) on delete cascade,
  order_line_id  uuid not null references wms.outbound_order_lines(id),
  product_id     uuid not null references erp.products(id),
  lot_code       text not null default '',
  quantity       numeric(14,3) not null check (quantity > 0),
  unique (package_id, order_line_id, lot_code)
);
create index export_package_items_line_idx on wms.export_package_items (order_line_id);

-- -----------------------------------------------------------------------------
-- 3. Produção — lado ERP (fronteira de integração local, como compras/vendas)
-- -----------------------------------------------------------------------------
create table erp.production_orders (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references erp.companies(id),
  number           text not null,
  product_id       uuid not null references erp.products(id),
  quantity         numeric(14,3) not null check (quantity > 0),
  status           text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  due_date         date,
  output_lot_code  text check (output_lot_code is null or length(output_lot_code) between 1 and 60),
  created_at       timestamptz not null default now(),
  unique (company_id, number)
);

create table erp.production_order_components (
  id                   uuid primary key default gen_random_uuid(),
  production_order_id  uuid not null references erp.production_orders(id),
  line_no              integer not null,
  product_id           uuid not null references erp.products(id),
  quantity             numeric(14,3) not null check (quantity > 0),
  unique (production_order_id, line_no)
);
create index production_order_components_po_idx on erp.production_order_components (production_order_id);

-- -----------------------------------------------------------------------------
-- 4. Produção — lado WMS
-- -----------------------------------------------------------------------------
alter table wms.zones drop constraint if exists zones_zone_type_check;
alter table wms.zones add constraint zones_zone_type_check
  check (zone_type in ('receiving', 'storage', 'picking', 'shipping', 'quarantine', 'production'));

create table wms.production_requisitions (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references erp.companies(id),
  warehouse_id         uuid not null references wms.warehouses(id),
  code                 text not null,
  production_order_id  uuid not null references erp.production_orders(id),
  line_location_id     uuid not null references wms.locations(id),
  all_or_nothing       boolean not null default true,
  status               text not null default 'open'
                       check (status in ('open', 'reserved', 'picking', 'delivered', 'completed', 'cancelled')),
  output_product_id    uuid not null references erp.products(id),
  planned_output_qty   numeric(14,3) not null check (planned_output_qty > 0),
  output_lot_code      text not null check (output_lot_code <> ''),
  output_qty           numeric(14,3) not null default 0 check (output_qty >= 0),
  notes                text,
  is_demo              boolean not null default false,
  created_by           uuid not null references wms.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  reserved_at          timestamptz,
  delivered_at         timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text,
  version              integer not null default 0,
  unique (company_id, code),
  check (output_qty <= planned_output_qty),
  check (status <> 'cancelled' or cancel_reason is not null)
);
-- Uma ordem de produção tem no máximo uma requisição ativa.
create unique index production_requisitions_po_active_uniq on wms.production_requisitions (production_order_id)
  where status <> 'cancelled';
create index production_requisitions_status_idx on wms.production_requisitions (company_id, status);

create table wms.production_requisition_lines (
  id              uuid primary key default gen_random_uuid(),
  requisition_id  uuid not null references wms.production_requisitions(id),
  line_no         integer not null,
  component_id    uuid references erp.production_order_components(id),
  product_id      uuid not null references erp.products(id),
  required_qty    numeric(14,3) not null check (required_qty > 0),
  reserved_qty    numeric(14,3) not null default 0 check (reserved_qty >= 0),
  picked_qty      numeric(14,3) not null default 0 check (picked_qty >= 0),
  delivered_qty   numeric(14,3) not null default 0 check (delivered_qty >= 0),
  returned_qty    numeric(14,3) not null default 0 check (returned_qty >= 0),
  unique (requisition_id, line_no),
  -- reservado + separado nunca ultrapassa o requerido
  check (reserved_qty + picked_qty <= required_qty),
  check (delivered_qty <= picked_qty),
  check (returned_qty <= delivered_qty)
);

create table wms.production_reservations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references erp.companies(id),
  line_id          uuid not null references wms.production_requisition_lines(id),
  balance_id       uuid not null references wms.stock_balances(id),
  location_id      uuid not null references wms.locations(id),
  product_id       uuid not null references erp.products(id),
  lot_code         text not null default '',
  expiry_date      date,
  quantity         numeric(14,3) not null check (quantity > 0),
  picked_qty       numeric(14,3) not null default 0 check (picked_qty >= 0),
  status           text not null default 'active' check (status in ('active', 'picked', 'delivered', 'released')),
  created_by       uuid not null references wms.users(id),
  created_at       timestamptz not null default now(),
  closed_at        timestamptz,
  check (picked_qty <= quantity)
);
create index production_reservations_line_idx on wms.production_reservations (line_id);

create table wms.production_deliveries (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references erp.companies(id),
  requisition_id  uuid not null references wms.production_requisitions(id),
  code            text not null,
  received_by     text not null check (length(trim(received_by)) >= 2),
  notes           text,
  delivered_by    uuid not null references wms.users(id),
  created_at      timestamptz not null default now(),
  unique (company_id, code)
);

create table wms.production_delivery_items (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid not null references wms.production_deliveries(id),
  line_id      uuid not null references wms.production_requisition_lines(id),
  lot_code     text not null default '',
  quantity     numeric(14,3) not null check (quantity > 0)
);
create trigger production_delivery_items_immutable before update or delete on wms.production_delivery_items
  for each row execute function wms.prevent_mutation();

alter table wms.tasks add column production_requisition_id uuid references wms.production_requisitions(id);
alter table wms.tasks add column production_reservation_id uuid references wms.production_reservations(id);
create index tasks_production_idx on wms.tasks (production_requisition_id) where production_requisition_id is not null;

alter table wms.tasks drop constraint if exists tasks_task_type_check;
alter table wms.tasks add constraint tasks_task_type_check
  check (task_type in ('putaway', 'transfer', 'inventory', 'picking', 'replenishment', 'return', 'return_in', 'discard',
                       'production_pick'));
alter table wms.tasks add constraint tasks_production_pick_check
  check (task_type <> 'production_pick' or (production_requisition_id is not null and production_reservation_id is not null));

alter table wms.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table wms.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('putaway', 'transfer', 'adjustment_in', 'adjustment_out', 'pick', 'shipment', 'block', 'unblock',
                           'replenishment', 'return', 'return_in', 'discard',
                           'production_pick', 'production_issue', 'production_return'));

-- -----------------------------------------------------------------------------
-- RLS (mesmo padrão de 20261009000003)
-- -----------------------------------------------------------------------------
alter table wms.lot_origins enable row level security;
alter table wms.export_packages enable row level security;
alter table wms.export_package_items enable row level security;
alter table erp.production_orders enable row level security;
alter table erp.production_order_components enable row level security;
alter table wms.production_requisitions enable row level security;
alter table wms.production_requisition_lines enable row level security;
alter table wms.production_reservations enable row level security;
alter table wms.production_deliveries enable row level security;
alter table wms.production_delivery_items enable row level security;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas da Frente F não foram criadas (ambiente local).';
    return;
  end if;
  foreach t in array array['lot_origins', 'export_packages', 'production_requisitions', 'production_reservations', 'production_deliveries']
  loop
    execute format(
      'create policy tenant_read on wms.%I for select to authenticated using (company_id = wms.current_company_id())', t);
  end loop;
  execute $p$create policy tenant_read on erp.production_orders for select to authenticated
    using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on erp.production_order_components for select to authenticated
    using (exists (select 1 from erp.production_orders o where o.id = production_order_id and o.company_id = wms.current_company_id()))$p$;
  execute $p$create policy tenant_read on wms.export_package_items for select to authenticated
    using (exists (select 1 from wms.export_packages p where p.id = package_id and p.company_id = wms.current_company_id()))$p$;
  execute $p$create policy tenant_read on wms.production_requisition_lines for select to authenticated
    using (exists (select 1 from wms.production_requisitions r where r.id = requisition_id and r.company_id = wms.current_company_id()))$p$;
  execute $p$create policy tenant_read on wms.production_delivery_items for select to authenticated
    using (exists (select 1 from wms.production_deliveries d where d.id = delivery_id and d.company_id = wms.current_company_id()))$p$;
end
$$;
