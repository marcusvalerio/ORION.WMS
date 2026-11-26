-- =============================================================================
-- ORION — Regras de operação da banca (etapa 2)
-- -----------------------------------------------------------------------------
--  R1. wms.quality_holds: produto acabado e devolução apta aguardam a qualidade
--      (saldo bloqueado na quarentena). Aprovar / Reprovar / Retrabalhar com laudo.
--  R2. Validade mínima restante: produto, cliente (e padrão da empresa em
--      company_settings). A reserva FEFO ignora lotes abaixo do mínimo.
--  R4. Capacidade do endereço em m³ (o peso máximo já existe).
--  R5. wms.lot_genealogy (componente → acabado) e wms.recalls.
-- =============================================================================

create table wms.quality_holds (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references erp.companies(id),
  warehouse_id   uuid not null references wms.warehouses(id),
  code           text not null,
  source         text not null check (source in ('production_output', 'customer_return')),
  production_requisition_id uuid references wms.production_requisitions(id),
  customer_return_id        uuid references wms.customer_returns(id),
  reference_code text not null,
  product_id     uuid not null references erp.products(id),
  lot_code       text not null default '',
  expiry_date    date,
  quantity       numeric(14,3) not null check (quantity > 0),
  location_id    uuid references wms.locations(id),
  status         text not null default 'pending' check (status in ('pending', 'rework', 'approved', 'rejected')),
  report         text,
  attachment_url text,
  decided_by     uuid references wms.users(id),
  decided_at     timestamptz,
  created_by     uuid not null references wms.users(id),
  created_at     timestamptz not null default now(),
  unique (company_id, code)
);
create index quality_holds_status_idx on wms.quality_holds (company_id, status, created_at desc);

create table wms.quality_hold_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references erp.companies(id),
  hold_id        uuid not null references wms.quality_holds(id),
  decision       text not null check (decision in ('approved', 'rejected', 'rework')),
  report         text not null,
  attachment_url text,
  decided_by     uuid not null references wms.users(id),
  decided_at     timestamptz not null default now()
);
create trigger quality_hold_events_immutable before update or delete on wms.quality_hold_events
  for each row execute function wms.prevent_mutation();

alter table wms.product_settings add column min_shelf_life_days integer check (min_shelf_life_days is null or min_shelf_life_days >= 0);
alter table erp.customers add column min_shelf_life_days integer check (min_shelf_life_days is null or min_shelf_life_days >= 0);

alter table wms.locations add column max_volume_m3 numeric(10,3) check (max_volume_m3 is null or max_volume_m3 > 0);

create table wms.lot_genealogy (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references erp.companies(id),
  parent_product  uuid not null references erp.products(id),
  parent_lot      text not null default '',
  child_product   uuid not null references erp.products(id),
  child_lot       text not null default '',
  qty             numeric(14,3) not null check (qty > 0),
  source          text not null check (source in ('production', 'repack')),
  ref_id          uuid not null,
  created_at      timestamptz not null default now()
);
create index lot_genealogy_parent_idx on wms.lot_genealogy (company_id, parent_product, parent_lot);
create index lot_genealogy_child_idx on wms.lot_genealogy (company_id, child_product, child_lot);

create table wms.recalls (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references erp.companies(id),
  code          text not null,
  product_id    uuid not null references erp.products(id),
  lot_code      text not null default '',
  reason        text not null,
  affected      jsonb not null default '[]'::jsonb,
  customers     jsonb not null default '[]'::jsonb,
  blocked_qty   numeric(14,3) not null default 0,
  created_by    uuid not null references wms.users(id),
  created_at    timestamptz not null default now(),
  unique (company_id, code)
);

alter table wms.quality_holds enable row level security;
alter table wms.quality_hold_events enable row level security;
alter table wms.lot_genealogy enable row level security;
alter table wms.recalls enable row level security;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas de leitura do Supabase não foram criadas (ambiente local).';
    return;
  end if;
  execute $p$create policy tenant_read on wms.quality_holds for select to authenticated using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on wms.quality_hold_events for select to authenticated using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on wms.lot_genealogy for select to authenticated using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on wms.recalls for select to authenticated using (company_id = wms.current_company_id())$p$;
end
$$;

select wms.install_tenant_guards();
