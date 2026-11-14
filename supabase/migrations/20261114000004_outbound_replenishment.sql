-- =============================================================================
-- ORION WMS — Frente D: saída, reposição e inteligência de armazenagem
-- -----------------------------------------------------------------------------
--  * Ondas de separação (wms.waves, wms.wave_orders, wms.task_allocations)
--  * Reposição de picking (wms.replenishment_settings) e tarefas de reposição
--  * Cancelamento após o início da separação (tarefas de devolução, movimento 'return')
--  * Curva ABC / slotting (wms.slotting_settings)
--  * Números de série (wms.serial_numbers, wms.movement_serials)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ampliação de domínios existentes
-- -----------------------------------------------------------------------------
alter table wms.tasks drop constraint if exists tasks_task_type_check;
alter table wms.tasks add constraint tasks_task_type_check
  check (task_type in ('putaway', 'transfer', 'inventory', 'picking', 'replenishment', 'return', 'return_in', 'discard'));

alter table wms.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table wms.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('putaway', 'transfer', 'adjustment_in', 'adjustment_out', 'pick', 'shipment', 'block', 'unblock',
                           'replenishment', 'return', 'return_in', 'discard'));

-- 'returning': separado e aguardando devolução ao endereço após cancelamento.
alter table wms.stock_reservations drop constraint if exists stock_reservations_status_check;
alter table wms.stock_reservations add constraint stock_reservations_status_check
  check (status in ('active', 'picked', 'released', 'consumed', 'returning'));

-- Planejamento de saída (agrupamento de ondas por transportadora/data/doca).
alter table wms.outbound_orders add column carrier text;
alter table wms.outbound_orders add column planned_ship_date date;
alter table wms.outbound_orders add column cancel_reason text;
alter table wms.outbound_orders add column cancelled_at timestamptz;

-- Cancelamento de linha.
alter table wms.outbound_order_lines add column cancelled_at timestamptz;
alter table wms.outbound_order_lines add column cancel_reason text;
alter table wms.outbound_order_lines add constraint outbound_lines_cancel_check
  check (cancelled_at is null or (cancel_reason is not null and reserved_qty = 0 and picked_qty = 0 and shipped_qty = 0));

-- -----------------------------------------------------------------------------
-- Ondas de separação
-- -----------------------------------------------------------------------------
create table wms.waves (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references erp.companies(id),
  warehouse_id      uuid not null references wms.warehouses(id),
  code              text not null,
  status            text not null default 'draft'
                    check (status in ('draft', 'released', 'picking', 'picked', 'completed', 'cancelled')),
  grouping          text not null check (grouping in ('dock', 'carrier', 'date', 'manual')),
  grouping_value    text,
  dock_location_id  uuid not null references wms.locations(id),
  notes             text,
  is_demo           boolean not null default false,
  created_by        uuid not null references wms.users(id),
  created_at        timestamptz not null default now(),
  released_by       uuid references wms.users(id),
  released_at       timestamptz,
  picked_at         timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  version           integer not null default 0,
  unique (company_id, code),
  check (status <> 'cancelled' or cancel_reason is not null)
);
create index waves_status_idx on wms.waves (company_id, status);

create table wms.wave_orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references erp.companies(id),
  wave_id         uuid not null references wms.waves(id),
  order_id        uuid not null references wms.outbound_orders(id),
  active          boolean not null default true,
  added_by        uuid not null references wms.users(id),
  added_at        timestamptz not null default now(),
  distributed_by  uuid references wms.users(id),
  distributed_at  timestamptz,
  removed_at      timestamptz,
  unique (wave_id, order_id)
);
-- Integridade: um pedido participa de no máximo uma onda ativa.
create unique index wave_orders_active_uniq on wms.wave_orders (order_id) where active;

alter table wms.tasks add column wave_id uuid references wms.waves(id);
alter table wms.tasks add column pick_sequence integer check (pick_sequence is null or pick_sequence > 0);
alter table wms.tasks add column emergency boolean not null default false;
create index tasks_wave_idx on wms.tasks (wave_id) where wave_id is not null;

-- Rastreio de qual pedido recebe o quê em uma tarefa consolidada.
create table wms.task_allocations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references erp.companies(id),
  task_id         uuid not null references wms.tasks(id),
  reservation_id  uuid not null references wms.stock_reservations(id),
  order_id        uuid not null references wms.outbound_orders(id),
  order_line_id   uuid not null references wms.outbound_order_lines(id),
  quantity        numeric(14,3) not null check (quantity > 0),
  picked_qty      numeric(14,3) check (picked_qty is null or (picked_qty >= 0 and picked_qty <= quantity)),
  status          text not null default 'open' check (status in ('open', 'picked', 'cancelled')),
  unique (task_id, reservation_id),
  unique (reservation_id)
);
create index task_allocations_order_idx on wms.task_allocations (order_id);

-- -----------------------------------------------------------------------------
-- Reposição de picking
-- -----------------------------------------------------------------------------
create table wms.replenishment_settings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references erp.companies(id),
  warehouse_id  uuid not null references wms.warehouses(id),
  location_id   uuid not null references wms.locations(id),
  product_id    uuid not null references erp.products(id),
  min_qty       numeric(14,3) not null check (min_qty >= 0),
  max_qty       numeric(14,3) not null check (max_qty > 0),
  active        boolean not null default true,
  updated_by    uuid references wms.users(id),
  updated_at    timestamptz not null default now(),
  check (max_qty > min_qty),
  unique (location_id, product_id)
);
-- Um endereço de picking abastece um único produto ativo.
create unique index replenishment_settings_loc_uniq on wms.replenishment_settings (location_id) where active;

-- Nunca há duas tarefas de reposição abertas para o mesmo endereço de picking.
create unique index tasks_open_replenishment_uniq on wms.tasks (to_location_id)
  where task_type = 'replenishment' and status in ('pending', 'in_progress');

-- -----------------------------------------------------------------------------
-- Curva ABC / slotting
-- -----------------------------------------------------------------------------
create table wms.slotting_settings (
  company_id  uuid primary key references erp.companies(id),
  days        integer not null default 90 check (days between 7 and 730),
  basis       text not null default 'units' check (basis in ('units', 'lines')),
  a_pct       numeric(5,2) not null default 80 check (a_pct > 0),
  b_pct       numeric(5,2) not null default 15 check (b_pct > 0),
  updated_by  uuid references wms.users(id),
  updated_at  timestamptz not null default now(),
  check (a_pct + b_pct < 100)
);

-- -----------------------------------------------------------------------------
-- Números de série
-- -----------------------------------------------------------------------------
create table wms.serial_numbers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references erp.companies(id),
  product_id   uuid not null references erp.products(id),
  serial       text not null check (length(serial) between 1 and 100),
  status       text not null check (status in ('in_stock', 'picked', 'shipped')),
  location_id  uuid references wms.locations(id),
  order_id     uuid references wms.outbound_orders(id),
  order_line_id uuid references wms.outbound_order_lines(id),
  updated_at   timestamptz not null default now(),
  check (status = 'shipped' or location_id is not null)
);
-- Impede série duplicada em estoque (em endereço ou separada na doca).
create unique index serial_numbers_stock_uniq on wms.serial_numbers (company_id, product_id, serial)
  where status in ('in_stock', 'picked');
create index serial_numbers_order_idx on wms.serial_numbers (order_line_id) where order_line_id is not null;

create table wms.movement_serials (
  id           uuid primary key default gen_random_uuid(),
  movement_id  uuid not null references wms.stock_movements(id),
  serial_id    uuid not null references wms.serial_numbers(id),
  created_at   timestamptz not null default now(),
  unique (movement_id, serial_id)
);
create trigger movement_serials_immutable before update or delete on wms.movement_serials
  for each row execute function wms.prevent_mutation();

-- -----------------------------------------------------------------------------
-- RLS das novas tabelas (mesmo padrão de 20261009000003)
-- -----------------------------------------------------------------------------
alter table wms.waves enable row level security;
alter table wms.wave_orders enable row level security;
alter table wms.task_allocations enable row level security;
alter table wms.replenishment_settings enable row level security;
alter table wms.slotting_settings enable row level security;
alter table wms.serial_numbers enable row level security;
alter table wms.movement_serials enable row level security;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas de leitura das novas tabelas não foram criadas (ambiente local).';
    return;
  end if;
  foreach t in array array['waves', 'wave_orders', 'task_allocations', 'replenishment_settings', 'slotting_settings', 'serial_numbers']
  loop
    execute format(
      'create policy tenant_read on wms.%I for select to authenticated using (company_id = wms.current_company_id())', t);
  end loop;
  execute $p$create policy tenant_read on wms.movement_serials for select to authenticated
    using (exists (select 1 from wms.stock_movements m where m.id = movement_id and m.company_id = wms.current_company_id()))$p$;
end
$$;
