-- =============================================================================
-- ORION — Integração ATLAS.ERP ↔ ORION.WMS (contrato v1, docs/INTEGRACAO-ATLAS-ORION.md)
-- -----------------------------------------------------------------------------
-- Fases 1–3 do lado ORION:
--  * wms.atlas_links: vínculo empresa ORION ↔ empresa ATLAS, segredo HMAC por
--    empresa cifrado (AES-256-GCM, chave ATLAS_INTEGRATION_ENCRYPTION_KEY) e a
--    configuração enviada em integration.activated.
--  * wms.atlas_warehouse_map: depósito ATLAS → depósito ORION.
--  * wms.atlas_inbox + wms.atlas_aggregate_state: idempotência (id do evento) e
--    ordem por agregado (aggregate.sequence) dos eventos recebidos do ATLAS.
--  * wms.sso_token_uses: anti-replay (jti) dos tokens de lançamento do SSO.
--  * wms.users: atlas_user_id, versão de acesso, checagem periódica; e-mail
--    passa a ser único POR EMPRESA (company_id + lower(email)).
--  * ids externos do ATLAS nos cadastros/documentos do schema erp.
--  * outbox: aggregate_seq por agregado.
--  * expedição condicionada à NF-e autorizada (require_invoice_before_ship).
--  * carga inicial de estoque: movimento `initial_load` e registro de snapshots.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Vínculo
-- -----------------------------------------------------------------------------
create table wms.atlas_links (
  company_id                  uuid primary key references erp.companies(id),
  atlas_company_id            text not null unique,
  key_id                      text not null unique,
  secret_ciphertext           text not null,
  previous_key_id             text,
  previous_secret_ciphertext  text,
  previous_valid_until        timestamptz,
  status                      text not null default 'activating'
                              check (status in ('activating', 'active', 'suspended', 'disabled')),
  status_reason               text,
  stock_owner                 text not null default 'atlas' check (stock_owner in ('atlas', 'orion')),
  sales_release_status        text,
  purchase_release_status     text,
  production_release_status   text,
  require_invoice_before_ship boolean not null default false,
  system_user_id              uuid references wms.users(id),
  linked_at                   timestamptz not null default now(),
  activated_at                timestamptz,
  disabled_at                 timestamptz,
  last_inbound_at             timestamptz,
  last_outbound_at            timestamptz,
  updated_at                  timestamptz not null default now(),
  check (previous_secret_ciphertext is null or previous_valid_until is not null)
);

create table wms.atlas_warehouse_map (
  company_id          uuid not null references erp.companies(id),
  atlas_warehouse_id  text not null,
  warehouse_id        uuid not null references wms.warehouses(id),
  atlas_code          text,
  atlas_name          text,
  updated_at          timestamptz not null default now(),
  primary key (company_id, atlas_warehouse_id),
  unique (company_id, warehouse_id)
);

-- -----------------------------------------------------------------------------
-- Entrada de eventos (idempotência e ordem)
-- -----------------------------------------------------------------------------
create table wms.atlas_inbox (
  event_id        uuid primary key,
  company_id      uuid not null references erp.companies(id),
  event_type      text not null,
  version         integer not null default 1,
  aggregate_type  text not null,
  aggregate_id    text not null,
  aggregate_seq   bigint not null check (aggregate_seq >= 0),
  payload_hash    text not null,
  envelope        jsonb not null,
  status          text not null default 'received' check (status in ('received', 'applied', 'failed', 'ignored')),
  attempts        integer not null default 1 check (attempts >= 0),
  error_code      text,
  last_error      text,
  result          jsonb,
  received_at     timestamptz not null default now(),
  applied_at      timestamptz,
  check (status <> 'applied' or applied_at is not null)
);
create index atlas_inbox_company_idx on wms.atlas_inbox (company_id, received_at desc);
create index atlas_inbox_status_idx on wms.atlas_inbox (company_id, status);

create table wms.atlas_aggregate_state (
  company_id      uuid not null references erp.companies(id),
  aggregate_type  text not null,
  aggregate_id    text not null,
  last_seq        bigint not null default 0,
  last_event_id   uuid,
  updated_at      timestamptz not null default now(),
  primary key (company_id, aggregate_type, aggregate_id)
);

-- -----------------------------------------------------------------------------
-- SSO
-- -----------------------------------------------------------------------------
create table wms.sso_token_uses (
  jti            uuid primary key,
  company_id     uuid references erp.companies(id),
  atlas_user_id  text not null,
  expires_at     timestamptz not null,
  used_at        timestamptz not null default now()
);
create index sso_token_uses_expires_idx on wms.sso_token_uses (expires_at);

-- -----------------------------------------------------------------------------
-- Usuários: vínculo ATLAS e e-mail único por empresa
-- -----------------------------------------------------------------------------
alter table wms.users
  add column atlas_user_id         text,
  add column atlas_access_version  integer,
  add column atlas_checked_at      timestamptz,
  add column atlas_access_ok_at    timestamptz,
  add column is_system             boolean not null default false;

alter table wms.users drop constraint if exists users_email_key;
drop index if exists wms.users_email_lower_uniq;
create unique index users_company_email_uniq on wms.users (company_id, lower(email));
create unique index users_company_atlas_uniq on wms.users (company_id, atlas_user_id) where atlas_user_id is not null;
create index users_email_lower_idx on wms.users (lower(email));
-- Usuário vinculado ao ATLAS não tem senha local (login só por SSO).
alter table wms.users add constraint users_atlas_no_password check (atlas_user_id is null or password_hash is null);

-- -----------------------------------------------------------------------------
-- Ids externos do ATLAS
-- -----------------------------------------------------------------------------
alter table erp.products   add column source text not null default 'local' check (source in ('local', 'atlas')),
                           add column external_id text, add column synced_at timestamptz;
alter table erp.customers  add column source text not null default 'local' check (source in ('local', 'atlas')),
                           add column external_id text, add column synced_at timestamptz,
                           add column status text not null default 'active' check (status in ('active', 'inactive'));
alter table erp.suppliers  add column source text not null default 'local' check (source in ('local', 'atlas')),
                           add column external_id text, add column synced_at timestamptz,
                           add column status text not null default 'active' check (status in ('active', 'inactive'));
create unique index products_external_uniq  on erp.products  (company_id, external_id) where external_id is not null;
create unique index customers_external_uniq on erp.customers (company_id, external_id) where external_id is not null;
create unique index suppliers_external_uniq on erp.suppliers (company_id, external_id) where external_id is not null;

alter table erp.sales_orders add column external_id text, add column requested_ship_date date, add column notes text;
alter table erp.sales_order_items add column external_id text;
alter table erp.purchase_orders add column external_id text;
alter table erp.purchase_order_items add column external_id text;
alter table erp.production_orders add column external_id text;
alter table erp.production_order_components add column external_id text;
create unique index sales_orders_external_uniq on erp.sales_orders (company_id, external_id) where external_id is not null;
create unique index purchase_orders_external_uniq on erp.purchase_orders (company_id, external_id) where external_id is not null;
create unique index production_orders_external_uniq on erp.production_orders (company_id, external_id) where external_id is not null;
create index sales_order_items_external_idx on erp.sales_order_items (external_id) where external_id is not null;
create index purchase_order_items_external_idx on erp.purchase_order_items (external_id) where external_id is not null;
create index production_order_components_external_idx on erp.production_order_components (external_id) where external_id is not null;

-- Unidades do ATLAS (fatores de conversão; estoque segue na unidade base do produto).
create table wms.atlas_units (
  company_id      uuid not null references erp.companies(id),
  atlas_unit_id   text not null,
  code            text not null,
  name            text not null,
  base_unit_code  text,
  factor_to_base  numeric(14,6) check (factor_to_base is null or factor_to_base > 0),
  status          text not null default 'active' check (status in ('active', 'inactive')),
  updated_at      timestamptz not null default now(),
  primary key (company_id, atlas_unit_id)
);

-- -----------------------------------------------------------------------------
-- Outbox: sequência por agregado (envelope do contrato)
-- -----------------------------------------------------------------------------
alter table wms.integration_events add column aggregate_seq bigint check (aggregate_seq is null or aggregate_seq > 0);
create unique index integration_events_aggregate_seq_uniq
  on wms.integration_events (company_id, aggregate_type, aggregate_id, aggregate_seq) where aggregate_seq is not null;

-- -----------------------------------------------------------------------------
-- Saída: NF-e autorizada antes da expedição
-- -----------------------------------------------------------------------------
alter table wms.outbound_orders
  add column requires_invoice       boolean not null default false,
  add column invoice_number         text,
  add column invoice_series         text,
  add column invoice_access_key     text,
  add column invoice_authorized_at  timestamptz,
  add constraint outbound_orders_invoice_key_format check (invoice_access_key is null or invoice_access_key ~ '^[0-9]{44}$');

-- Linha do pedido de saída ↔ item do pedido de venda (atlas_line_id nos eventos).
alter table wms.outbound_order_lines add column sales_order_item_id uuid references erp.sales_order_items(id);
create index outbound_order_lines_so_item_idx on wms.outbound_order_lines (sales_order_item_id) where sales_order_item_id is not null;

-- -----------------------------------------------------------------------------
-- Carga inicial de estoque e snapshots de reconciliação
-- -----------------------------------------------------------------------------
alter table wms.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table wms.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('putaway', 'transfer', 'adjustment_in', 'adjustment_out', 'pick', 'shipment', 'block', 'unblock',
                           'replenishment', 'return', 'return_in', 'discard',
                           'production_pick', 'production_issue', 'production_return', 'initial_load'));

create table wms.atlas_stock_snapshots (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references erp.companies(id),
  snapshot_id   text not null,
  direction     text not null check (direction in ('inbound', 'outbound')),
  reason        text not null,
  warehouse_id  uuid references wms.warehouses(id),
  chunk         integer not null default 1 check (chunk >= 1),
  chunks        integer not null default 1 check (chunks >= chunk),
  items         jsonb not null default '[]'::jsonb,
  taken_at      timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (company_id, snapshot_id, direction, chunk)
);
create index atlas_stock_snapshots_company_idx on wms.atlas_stock_snapshots (company_id, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS e consistência multiempresa
-- -----------------------------------------------------------------------------
alter table wms.atlas_links enable row level security;
alter table wms.atlas_warehouse_map enable row level security;
alter table wms.atlas_inbox enable row level security;
alter table wms.atlas_aggregate_state enable row level security;
alter table wms.sso_token_uses enable row level security;
alter table wms.atlas_units enable row level security;
alter table wms.atlas_stock_snapshots enable row level security;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas de leitura do Supabase não foram criadas (ambiente local).';
    return;
  end if;
  -- O segredo cifrado nunca é legível pelo navegador: atlas_links e sso_token_uses ficam sem política (só o servidor).
  execute $p$create policy tenant_read on wms.atlas_warehouse_map for select to authenticated
    using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on wms.atlas_inbox for select to authenticated
    using (company_id = wms.current_company_id() and wms.current_role() in ('admin', 'supervisor', 'auditor'))$p$;
  execute $p$create policy tenant_read on wms.atlas_aggregate_state for select to authenticated
    using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on wms.atlas_units for select to authenticated
    using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on wms.atlas_stock_snapshots for select to authenticated
    using (company_id = wms.current_company_id())$p$;
end
$$;

select wms.install_tenant_guards();
