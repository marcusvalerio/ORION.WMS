-- =============================================================================
-- ORION — Inventário v2 (melhorias da banca, etapa 1)
-- -----------------------------------------------------------------------------
--  * Estado por item (pending → counting → counted → recount → closed) e rodada.
--  * wms.inventory_location_locks: endereço bloqueado enquanto é contado (modo lock).
--  * wms.inventory_count_rounds: todas as contagens (1ª, 2ª cega, 3ª desempate);
--    nenhuma é sobrescrita. inventory_count_items.counted_qty = valor vencedor.
--  * wms.inventory_tolerances: tolerância (% e un) e alçada em R$ por classe ABC.
--  * wms.cycle_count_plans: frequência do rotativo por classe ABC.
--  * Endereços vazios na foto (product_id nulo, esperado 0) e item encontrado.
--  * Origem do saldo na foto (disponível, bloqueado, quarentena).
--  * Ajuste valorizado: unit_cost, reason_code e cost_center no movimento.
--  * Inventário de linha (production_line) e data de referência (Bloco H).
-- =============================================================================

alter table wms.inventory_counts drop constraint if exists inventory_counts_count_type_check;
alter table wms.inventory_counts
  add constraint inventory_counts_count_type_check check (count_type in ('general', 'cyclic', 'production_line'));
alter table wms.inventory_counts
  add column lock_mode text not null default 'lock' check (lock_mode in ('lock', 'reconcile')),
  add column origin text not null default 'manual' check (origin in ('manual', 'calendar', 'trigger')),
  add column plan_date date,
  add column reference_date date,
  add column scope_label text;
create unique index inventory_counts_calendar_uq on wms.inventory_counts (company_id, warehouse_id, plan_date)
  where origin = 'calendar' and status <> 'cancelled';

alter table wms.inventory_count_items alter column product_id drop not null;
alter table wms.inventory_count_items
  add column company_id uuid references erp.companies(id),
  add column status text not null default 'pending' check (status in ('pending', 'counting', 'counted', 'recount', 'closed')),
  add column round smallint not null default 1 check (round between 1 and 3),
  add column empty_location boolean not null default false,
  add column found boolean not null default false,
  add column stock_origin text not null default 'available' check (stock_origin in ('available', 'blocked', 'quarantine')),
  add column blocked_qty numeric(14,3) not null default 0,
  add column snapshot_at timestamptz not null default now(),
  add column abc_class text check (abc_class is null or abc_class in ('A', 'B', 'C'));
update wms.inventory_count_items i set company_id = c.company_id,
  status = case when i.adjusted then 'closed' when i.counted_qty is not null then 'counted' else 'pending' end
  from wms.inventory_counts c where c.id = i.inventory_id;
alter table wms.inventory_count_items alter column company_id set not null;
-- company_id do item herda o do cabeçalho quando não informado.
create or replace function wms.inventory_item_company() returns trigger language plpgsql as $$
begin
  if new.company_id is null then
    select company_id into new.company_id from wms.inventory_counts where id = new.inventory_id;
  end if;
  return new;
end
$$;
create trigger inventory_item_company before insert on wms.inventory_count_items
  for each row execute function wms.inventory_item_company();
create unique index inventory_count_items_empty_uq on wms.inventory_count_items (inventory_id, location_id) where product_id is null;

create table wms.inventory_location_locks (
  location_id   uuid primary key references wms.locations(id),
  company_id    uuid not null references erp.companies(id),
  inventory_id  uuid not null references wms.inventory_counts(id),
  locked_at     timestamptz not null default now(),
  locked_by     uuid not null references wms.users(id)
);
create index inventory_location_locks_inv_idx on wms.inventory_location_locks (company_id, inventory_id);

create table wms.inventory_count_rounds (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references erp.companies(id),
  inventory_item_id  uuid not null references wms.inventory_count_items(id),
  round              smallint not null check (round between 1 and 3),
  counted_qty        numeric(14,3) not null check (counted_qty >= 0),
  lot_code           text not null default '',
  expiry_date        date,
  counted_by         uuid not null references wms.users(id),
  counted_at         timestamptz not null default now(),
  device             text not null default 'web' check (device in ('web', 'collector')),
  unique (inventory_item_id, round)
);
create trigger inventory_count_rounds_immutable before update or delete on wms.inventory_count_rounds
  for each row execute function wms.prevent_mutation();

create table wms.inventory_tolerances (
  company_id            uuid not null references erp.companies(id),
  abc_class             text not null check (abc_class in ('A', 'B', 'C')),
  tolerance_pct         numeric(6,3) not null check (tolerance_pct >= 0 and tolerance_pct <= 100),
  tolerance_units       numeric(14,3) not null default 0 check (tolerance_units >= 0),
  approval_limit_value  numeric(14,2) not null default 500 check (approval_limit_value >= 0),
  approval_role         text not null default 'admin' check (approval_role in ('supervisor', 'admin')),
  updated_by            uuid references wms.users(id),
  updated_at            timestamptz not null default now(),
  primary key (company_id, abc_class)
);

create table wms.cycle_count_plans (
  company_id      uuid not null references erp.companies(id),
  abc_class       text not null check (abc_class in ('A', 'B', 'C')),
  frequency_days  integer not null check (frequency_days between 1 and 366),
  updated_by      uuid references wms.users(id),
  updated_at      timestamptz not null default now(),
  primary key (company_id, abc_class)
);

alter table wms.stock_movements
  add column unit_cost numeric(14,4),
  add column reason_code text,
  add column cost_center text;

alter table wms.inventory_location_locks enable row level security;
alter table wms.inventory_count_rounds enable row level security;
alter table wms.inventory_tolerances enable row level security;
alter table wms.cycle_count_plans enable row level security;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas de leitura do Supabase não foram criadas (ambiente local).';
    return;
  end if;
  execute $p$create policy tenant_read on wms.inventory_location_locks for select to authenticated
    using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on wms.inventory_count_rounds for select to authenticated
    using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on wms.inventory_tolerances for select to authenticated
    using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on wms.cycle_count_plans for select to authenticated
    using (company_id = wms.current_company_id())$p$;
end
$$;

select wms.install_tenant_guards();
