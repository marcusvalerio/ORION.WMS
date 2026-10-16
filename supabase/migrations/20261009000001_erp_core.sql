-- =============================================================================
-- ORION — Núcleo ERP (fronteira de integração)
-- -----------------------------------------------------------------------------
-- O WMS NÃO é dono destas entidades: produtos, fornecedores, clientes, pedidos
-- de compra e pedidos de venda pertencem ao ERP. O WMS apenas as lê (ver
-- src/server/integrations/erp). Se o ERP já possuir estas tabelas em outro
-- banco/schema, substitua este arquivo por views ou pelo adaptador de
-- integração correspondente — nenhuma tabela WMS depende de colunas além das
-- declaradas aqui.
-- =============================================================================

create schema if not exists erp;

create table erp.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  document    text,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table erp.suppliers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references erp.companies(id),
  code        text not null,
  name        text not null,
  document    text,
  created_at  timestamptz not null default now(),
  unique (company_id, code)
);

create table erp.customers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references erp.companies(id),
  code        text not null,
  name        text not null,
  document    text,
  created_at  timestamptz not null default now(),
  unique (company_id, code)
);

create table erp.products (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references erp.companies(id),
  sku          text not null,
  description  text not null,
  barcode      text,
  uom          text not null default 'UN',
  category     text,
  status       text not null default 'active' check (status in ('active', 'inactive')),
  weight_kg    numeric(12,3) check (weight_kg is null or weight_kg >= 0),
  length_cm    numeric(10,2) check (length_cm is null or length_cm >= 0),
  width_cm     numeric(10,2) check (width_cm is null or width_cm >= 0),
  height_cm    numeric(10,2) check (height_cm is null or height_cm >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, sku)
);
create unique index products_barcode_uniq on erp.products (company_id, barcode) where barcode is not null;

create table erp.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references erp.companies(id),
  number          text not null,
  supplier_id     uuid not null references erp.suppliers(id),
  status          text not null default 'open'
                  check (status in ('open', 'partially_received', 'received', 'cancelled')),
  issue_date      date not null default current_date,
  expected_date   date,
  invoice_number  text,
  created_at      timestamptz not null default now(),
  unique (company_id, number)
);

create table erp.purchase_order_items (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references erp.purchase_orders(id),
  line_no            integer not null,
  product_id         uuid not null references erp.products(id),
  quantity           numeric(14,3) not null check (quantity > 0),
  unit_price         numeric(14,2),
  unique (purchase_order_id, line_no)
);
create index purchase_order_items_po_idx on erp.purchase_order_items (purchase_order_id);

create table erp.sales_orders (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references erp.companies(id),
  number       text not null,
  customer_id  uuid not null references erp.customers(id),
  status       text not null default 'open'
               check (status in ('open', 'in_fulfillment', 'shipped', 'cancelled')),
  issue_date   date not null default current_date,
  created_at   timestamptz not null default now(),
  unique (company_id, number)
);

create table erp.sales_order_items (
  id              uuid primary key default gen_random_uuid(),
  sales_order_id  uuid not null references erp.sales_orders(id),
  line_no         integer not null,
  product_id      uuid not null references erp.products(id),
  quantity        numeric(14,3) not null check (quantity > 0),
  unique (sales_order_id, line_no)
);
create index sales_order_items_so_idx on erp.sales_order_items (sales_order_id);
