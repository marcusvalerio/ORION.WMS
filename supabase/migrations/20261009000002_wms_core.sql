-- =============================================================================
-- ORION WMS — Modelo operacional
-- -----------------------------------------------------------------------------
-- Princípios:
--  * O saldo (wms.stock_balances) só muda por operações de serviço que, na
--    mesma transação, gravam uma linha imutável em wms.stock_movements.
--  * Restrições CHECK impedem saldo negativo e reserva/bloqueio acima do físico.
--  * Movimentações, eventos de tarefas e auditoria são imutáveis (trigger).
--  * Idempotência por chave (wms.idempotency_keys) gravada na mesma transação.
-- =============================================================================

create schema if not exists wms;

-- Função genérica que bloqueia UPDATE/DELETE em tabelas de histórico.
create or replace function wms.prevent_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Registro imutável em %.%: alterações não são permitidas', TG_TABLE_SCHEMA, TG_TABLE_NAME
    using errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- Usuários e perfis (estrutura mínima; vincula-se ao Supabase Auth por auth_user_id)
-- -----------------------------------------------------------------------------
create table wms.users (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references erp.companies(id),
  auth_user_id   uuid unique,
  name           text not null,
  email          text not null unique,
  role           text not null check (role in ('admin', 'supervisor', 'operator', 'auditor')),
  password_hash  text,
  active         boolean not null default true,
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Contadores transacionais para códigos legíveis (REC-000001, TAR-000001...).
create table wms.counters (
  company_id  uuid not null references erp.companies(id),
  scope       text not null,
  value       bigint not null default 0,
  primary key (company_id, scope)
);

-- -----------------------------------------------------------------------------
-- Estrutura física
-- -----------------------------------------------------------------------------
create table wms.warehouses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references erp.companies(id),
  code        text not null,
  name        text not null,
  address     text,
  active      boolean not null default true,
  created_by  uuid references wms.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, code)
);

create table wms.zones (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references erp.companies(id),
  warehouse_id  uuid not null references wms.warehouses(id),
  code          text not null,
  name          text not null,
  zone_type     text not null check (zone_type in ('receiving', 'storage', 'picking', 'shipping', 'quarantine')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (warehouse_id, code),
  unique (id, warehouse_id)
);

create table wms.locations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references erp.companies(id),
  warehouse_id    uuid not null references wms.warehouses(id),
  zone_id         uuid not null,
  aisle           text not null,   -- rua
  bay             text not null,   -- módulo
  level           text not null,   -- nível
  position        text not null,   -- posição
  code            text not null,
  location_type   text not null check (location_type in ('rack', 'shelf', 'floor', 'dock', 'staging', 'quarantine')),
  storage_class   text check (storage_class is null or storage_class in ('general', 'refrigerated', 'hazardous', 'bulky')),
  capacity_units  numeric(14,3) not null check (capacity_units > 0),
  max_weight_kg   numeric(12,3) check (max_weight_kg is null or max_weight_kg > 0),
  status          text not null default 'active' check (status in ('active', 'blocked', 'inactive')),
  notes           text,
  created_by      uuid references wms.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- a zona precisa pertencer ao mesmo depósito do endereço
  foreign key (zone_id, warehouse_id) references wms.zones (id, warehouse_id),
  unique (warehouse_id, code),
  unique (warehouse_id, aisle, bay, level, position)
);
create index locations_zone_idx on wms.locations (zone_id);
create index locations_wh_status_idx on wms.locations (warehouse_id, status);

-- -----------------------------------------------------------------------------
-- Parâmetros logísticos do produto (o cadastro mestre continua no ERP)
-- -----------------------------------------------------------------------------
create table wms.product_settings (
  product_id              uuid primary key references erp.products(id),
  company_id              uuid not null references erp.companies(id),
  lot_controlled          boolean not null default false,
  expiry_controlled       boolean not null default false,
  serial_controlled       boolean not null default false,
  storage_class           text not null default 'general'
                          check (storage_class in ('general', 'refrigerated', 'hazardous', 'bulky')),
  max_units_per_location  numeric(14,3) check (max_units_per_location is null or max_units_per_location > 0),
  preferred_zone_id       uuid references wms.zones(id),
  updated_by              uuid references wms.users(id),
  updated_at              timestamptz not null default now()
);

-- Unidades logísticas (embalagens). Apenas fator de conversão: estoque é sempre
-- mantido na unidade base do produto, então alterar uma embalagem não altera saldo.
create table wms.packaging_units (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references erp.companies(id),
  product_id         uuid not null references erp.products(id),
  code               text not null,
  description        text,
  units_per_package  numeric(14,3) not null check (units_per_package > 0),
  barcode            text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (product_id, code)
);

-- -----------------------------------------------------------------------------
-- Saldos e movimentações
-- -----------------------------------------------------------------------------
create table wms.stock_balances (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references erp.companies(id),
  warehouse_id  uuid not null references wms.warehouses(id),
  location_id   uuid not null references wms.locations(id),
  product_id    uuid not null references erp.products(id),
  lot_code      text not null default '',
  expiry_date   date,
  quantity      numeric(14,3) not null default 0 check (quantity >= 0),
  reserved_qty  numeric(14,3) not null default 0 check (reserved_qty >= 0),
  blocked_qty   numeric(14,3) not null default 0 check (blocked_qty >= 0),
  version       integer not null default 0,
  updated_at    timestamptz not null default now(),
  constraint stock_balances_allocation_check check (reserved_qty + blocked_qty <= quantity),
  unique (location_id, product_id, lot_code)
);
create index stock_balances_product_idx on wms.stock_balances (company_id, product_id);
create index stock_balances_wh_idx on wms.stock_balances (warehouse_id);

-- -----------------------------------------------------------------------------
-- Recebimento
-- -----------------------------------------------------------------------------
create table wms.receipts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references erp.companies(id),
  warehouse_id       uuid not null references wms.warehouses(id),
  code               text not null,
  purchase_order_id  uuid references erp.purchase_orders(id),
  supplier_id        uuid not null references erp.suppliers(id),
  invoice_number     text,
  invoice_key        text,
  status             text not null default 'expected'
                     check (status in ('expected', 'checking', 'checked', 'released', 'completed', 'cancelled')),
  arrived_at         timestamptz,
  checker_id         uuid references wms.users(id),
  check_started_at   timestamptz,
  checked_at         timestamptz,
  released_at        timestamptz,
  completed_at       timestamptz,
  notes              text,
  is_demo            boolean not null default false,
  created_by         uuid not null references wms.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 0,
  unique (company_id, code)
);
-- Um pedido de compra só pode ter um recebimento ativo (evita duplicidade por reenvio).
create unique index receipts_po_active_uniq on wms.receipts (purchase_order_id)
  where purchase_order_id is not null and status <> 'cancelled';
create index receipts_status_idx on wms.receipts (company_id, status);

create table wms.receipt_items (
  id                      uuid primary key default gen_random_uuid(),
  receipt_id              uuid not null references wms.receipts(id),
  line_no                 integer not null,
  product_id              uuid not null references erp.products(id),
  purchase_order_item_id  uuid references erp.purchase_order_items(id),
  expected_qty            numeric(14,3) not null check (expected_qty >= 0),
  counted_qty             numeric(14,3) check (counted_qty is null or counted_qty >= 0),
  damaged_qty             numeric(14,3) not null default 0 check (damaged_qty >= 0),
  quality_hold_qty        numeric(14,3) not null default 0 check (quality_hold_qty >= 0),
  lot_code                text not null default '',
  expiry_date             date,
  released_qty            numeric(14,3) not null default 0 check (released_qty >= 0),
  putaway_qty             numeric(14,3) not null default 0 check (putaway_qty >= 0),
  notes                   text,
  counted_by              uuid references wms.users(id),
  counted_at              timestamptz,
  check (counted_qty is null or damaged_qty + quality_hold_qty <= counted_qty),
  check (putaway_qty <= released_qty),
  unique (receipt_id, line_no)
);

-- -----------------------------------------------------------------------------
-- Pedidos de saída, reservas e expedição
-- -----------------------------------------------------------------------------
create table wms.outbound_orders (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references erp.companies(id),
  warehouse_id         uuid not null references wms.warehouses(id),
  code                 text not null,
  sales_order_id       uuid references erp.sales_orders(id),
  source               text not null check (source in ('erp', 'manual')),
  customer_name        text not null,
  status               text not null default 'open'
                       check (status in ('open', 'reserved', 'picking', 'picked', 'checked', 'shipped', 'cancelled')),
  priority             integer not null default 2 check (priority between 1 and 3),
  staging_location_id  uuid references wms.locations(id),
  notes                text,
  is_demo              boolean not null default false,
  created_by           uuid not null references wms.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  reserved_at          timestamptz,
  picked_at            timestamptz,
  checked_at           timestamptz,
  shipped_at           timestamptz,
  version              integer not null default 0,
  unique (company_id, code)
);
create unique index outbound_orders_so_active_uniq on wms.outbound_orders (sales_order_id)
  where sales_order_id is not null and status <> 'cancelled';
create index outbound_orders_status_idx on wms.outbound_orders (company_id, status);

create table wms.outbound_order_lines (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references wms.outbound_orders(id),
  line_no        integer not null,
  product_id     uuid not null references erp.products(id),
  requested_qty  numeric(14,3) not null check (requested_qty > 0),
  reserved_qty   numeric(14,3) not null default 0 check (reserved_qty >= 0),
  picked_qty     numeric(14,3) not null default 0 check (picked_qty >= 0),
  checked_qty    numeric(14,3) not null default 0 check (checked_qty >= 0),
  shipped_qty    numeric(14,3) not null default 0 check (shipped_qty >= 0),
  check (reserved_qty <= requested_qty),
  check (picked_qty <= requested_qty),
  check (checked_qty <= picked_qty),
  check (shipped_qty <= checked_qty),
  unique (order_id, line_no)
);

create table wms.stock_reservations (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references erp.companies(id),
  order_line_id  uuid not null references wms.outbound_order_lines(id),
  balance_id     uuid not null references wms.stock_balances(id),
  location_id    uuid not null references wms.locations(id),
  product_id     uuid not null references erp.products(id),
  lot_code       text not null default '',
  quantity       numeric(14,3) not null check (quantity > 0),
  picked_qty     numeric(14,3) not null default 0 check (picked_qty >= 0),
  status         text not null default 'active' check (status in ('active', 'picked', 'released', 'consumed')),
  created_by     uuid not null references wms.users(id),
  created_at     timestamptz not null default now(),
  closed_at      timestamptz,
  check (picked_qty <= quantity)
);
create index stock_reservations_line_idx on wms.stock_reservations (order_line_id);
create index stock_reservations_balance_idx on wms.stock_reservations (balance_id) where status = 'active';

create table wms.shipments (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references erp.companies(id),
  order_id       uuid not null unique references wms.outbound_orders(id),
  code           text not null,
  carrier        text,
  vehicle_plate  text,
  document_ref   text,
  notes          text,
  shipped_by     uuid not null references wms.users(id),
  shipped_at     timestamptz not null default now(),
  unique (company_id, code)
);

-- -----------------------------------------------------------------------------
-- Inventário
-- -----------------------------------------------------------------------------
create table wms.inventory_counts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references erp.companies(id),
  warehouse_id    uuid not null references wms.warehouses(id),
  code            text not null,
  count_type      text not null check (count_type in ('general', 'cyclic')),
  status          text not null default 'counting' check (status in ('counting', 'submitted', 'approved', 'cancelled')),
  zone_id         uuid references wms.zones(id),
  location_id     uuid references wms.locations(id),
  product_id      uuid references erp.products(id),
  notes           text,
  created_by      uuid not null references wms.users(id),
  created_at      timestamptz not null default now(),
  submitted_by    uuid references wms.users(id),
  submitted_at    timestamptz,
  approved_by     uuid references wms.users(id),
  approved_at     timestamptz,
  approval_notes  text,
  unique (company_id, code)
);

create table wms.inventory_count_items (
  id            uuid primary key default gen_random_uuid(),
  inventory_id  uuid not null references wms.inventory_counts(id),
  location_id   uuid not null references wms.locations(id),
  product_id    uuid not null references erp.products(id),
  lot_code      text not null default '',
  expiry_date   date,
  expected_qty  numeric(14,3) not null check (expected_qty >= 0),
  counted_qty   numeric(14,3) check (counted_qty is null or counted_qty >= 0),
  counted_by    uuid references wms.users(id),
  counted_at    timestamptz,
  notes         text,
  adjusted      boolean not null default false,
  unique (inventory_id, location_id, product_id, lot_code)
);

-- -----------------------------------------------------------------------------
-- Tarefas operacionais
-- -----------------------------------------------------------------------------
create table wms.tasks (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references erp.companies(id),
  warehouse_id           uuid not null references wms.warehouses(id),
  code                   text not null,
  task_type              text not null check (task_type in ('putaway', 'transfer', 'inventory', 'picking', 'replenishment')),
  status                 text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  priority               integer not null default 2 check (priority between 1 and 3),
  product_id             uuid references erp.products(id),
  lot_code               text not null default '',
  expiry_date            date,
  quantity               numeric(14,3) check (quantity is null or quantity > 0),
  confirmed_qty          numeric(14,3) check (confirmed_qty is null or confirmed_qty >= 0),
  from_location_id       uuid references wms.locations(id),
  suggested_location_id  uuid references wms.locations(id),
  to_location_id         uuid references wms.locations(id),
  receipt_id             uuid references wms.receipts(id),
  receipt_item_id        uuid references wms.receipt_items(id),
  order_id               uuid references wms.outbound_orders(id),
  order_line_id          uuid references wms.outbound_order_lines(id),
  reservation_id         uuid references wms.stock_reservations(id),
  inventory_id           uuid references wms.inventory_counts(id),
  assigned_to            uuid references wms.users(id),
  notes                  text,
  created_by             uuid not null references wms.users(id),
  created_at             timestamptz not null default now(),
  started_at             timestamptz,
  completed_at           timestamptz,
  completed_by           uuid references wms.users(id),
  cancelled_at           timestamptz,
  cancel_reason          text,
  version                integer not null default 0,
  unique (company_id, code),
  check (status <> 'completed' or completed_at is not null)
);
create index tasks_status_idx on wms.tasks (company_id, status, task_type);
create index tasks_receipt_idx on wms.tasks (receipt_id) where receipt_id is not null;
create index tasks_order_idx on wms.tasks (order_id) where order_id is not null;

create table wms.task_events (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references wms.tasks(id),
  event_type   text not null,
  from_status  text,
  to_status    text,
  payload      jsonb not null default '{}'::jsonb,
  user_id      uuid not null references wms.users(id),
  created_at   timestamptz not null default now()
);
create index task_events_task_idx on wms.task_events (task_id);
create trigger task_events_immutable before update or delete on wms.task_events
  for each row execute function wms.prevent_mutation();

-- -----------------------------------------------------------------------------
-- Movimentações (histórico imutável do estoque)
-- -----------------------------------------------------------------------------
create table wms.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references erp.companies(id),
  warehouse_id      uuid not null references wms.warehouses(id),
  movement_type     text not null check (movement_type in
                      ('putaway', 'transfer', 'adjustment_in', 'adjustment_out', 'pick', 'shipment', 'block', 'unblock')),
  product_id        uuid not null references erp.products(id),
  lot_code          text not null default '',
  expiry_date       date,
  quantity          numeric(14,3) not null check (quantity > 0),
  from_location_id  uuid references wms.locations(id),
  to_location_id    uuid references wms.locations(id),
  reason            text,
  reference_type    text,
  reference_id      uuid,
  reference_code    text,
  task_id           uuid references wms.tasks(id),
  created_by        uuid not null references wms.users(id),
  created_at        timestamptz not null default now(),
  check (from_location_id is not null or to_location_id is not null)
);
create index stock_movements_product_idx on wms.stock_movements (company_id, product_id, created_at desc);
create index stock_movements_created_idx on wms.stock_movements (company_id, created_at desc);
create index stock_movements_from_idx on wms.stock_movements (from_location_id);
create index stock_movements_to_idx on wms.stock_movements (to_location_id);
create trigger stock_movements_immutable before update or delete on wms.stock_movements
  for each row execute function wms.prevent_mutation();

-- -----------------------------------------------------------------------------
-- Divergências (recebimento, separação, conferência de saída, inventário)
-- -----------------------------------------------------------------------------
create table wms.divergences (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references erp.companies(id),
  source           text not null check (source in ('receipt', 'picking', 'outbound_check', 'inventory')),
  divergence_type  text not null check (divergence_type in
                     ('shortage', 'overage', 'damage', 'quality_hold', 'short_pick', 'count_difference', 'other')),
  product_id       uuid references erp.products(id),
  quantity         numeric(14,3) check (quantity is null or quantity >= 0),
  description      text not null,
  receipt_id       uuid references wms.receipts(id),
  receipt_item_id  uuid references wms.receipt_items(id),
  order_id         uuid references wms.outbound_orders(id),
  order_line_id    uuid references wms.outbound_order_lines(id),
  task_id          uuid references wms.tasks(id),
  inventory_id     uuid references wms.inventory_counts(id),
  status           text not null default 'open' check (status in ('open', 'resolved')),
  resolution       text,
  created_by       uuid not null references wms.users(id),
  created_at       timestamptz not null default now(),
  resolved_by      uuid references wms.users(id),
  resolved_at      timestamptz,
  check (status = 'open' or (resolution is not null and resolved_at is not null))
);
create index divergences_status_idx on wms.divergences (company_id, status);

-- -----------------------------------------------------------------------------
-- Integração (outbox), auditoria e idempotência
-- -----------------------------------------------------------------------------
create table wms.integration_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references erp.companies(id),
  event_type      text not null,
  aggregate_type  text not null,
  aggregate_id    uuid not null,
  payload         jsonb not null,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts        integer not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);
create index integration_events_status_idx on wms.integration_events (status, created_at);

create table wms.audit_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references erp.companies(id),
  user_id      uuid references wms.users(id),
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  entity_code  text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index audit_log_created_idx on wms.audit_log (company_id, created_at desc);
create index audit_log_entity_idx on wms.audit_log (entity_type, entity_id);
create trigger audit_log_immutable before update or delete on wms.audit_log
  for each row execute function wms.prevent_mutation();

create table wms.idempotency_keys (
  company_id  uuid not null references erp.companies(id),
  key         text not null,
  action      text not null,
  user_id     uuid not null references wms.users(id),
  result      jsonb,
  created_at  timestamptz not null default now(),
  primary key (company_id, key)
);
