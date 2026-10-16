-- =============================================================================
-- Row Level Security
-- -----------------------------------------------------------------------------
-- 1. RLS é habilitado em TODAS as tabelas erp/wms. Sem políticas de escrita, o
--    navegador (roles anon/authenticated do Supabase) não consegue inserir,
--    alterar ou excluir nada: toda escrita passa pelos serviços do servidor,
--    que validam regras de negócio e gravam movimentação + auditoria.
-- 2. Políticas de LEITURA isolam os dados por empresa do usuário autenticado.
--    Elas só são criadas quando o schema `auth` (Supabase) existe; em ambiente
--    local (PGlite/Postgres puro) o bloco é ignorado com um aviso.
-- 3. O servidor conecta com o papel dono das tabelas (DATABASE_URL) e nunca
--    expõe essa credencial ao navegador.
-- =============================================================================

do $$
declare
  t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('erp', 'wms')
  loop
    execute format('alter table %I.%I enable row level security', t.schema_name, t.table_name);
  end loop;
end
$$;

do $$
declare
  t record;
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas de leitura do Supabase não foram criadas (ambiente local).';
    return;
  end if;

  execute $fn$
    create or replace function wms.current_company_id() returns uuid
    language sql stable security definer set search_path = '' as $body$
      select u.company_id from wms.users u where u.auth_user_id = auth.uid() and u.active
    $body$
  $fn$;

  execute $fn$
    create or replace function wms.current_role() returns text
    language sql stable security definer set search_path = '' as $body$
      select u.role from wms.users u where u.auth_user_id = auth.uid() and u.active
    $body$
  $fn$;

  -- Tabelas com company_id: leitura restrita à empresa do usuário.
  for t in
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.column_name = 'company_id' and c.table_schema in ('erp', 'wms') and tb.table_type = 'BASE TABLE'
      and c.table_name not in ('idempotency_keys', 'counters')
  loop
    execute format(
      'create policy tenant_read on %I.%I for select to authenticated using (company_id = wms.current_company_id())',
      t.table_schema, t.table_name);
  end loop;

  -- Auditoria: apenas administradores, supervisores e auditores.
  execute 'drop policy if exists tenant_read on wms.audit_log';
  execute $p$create policy audit_read on wms.audit_log for select to authenticated
    using (company_id = wms.current_company_id() and wms.current_role() in ('admin', 'supervisor', 'auditor'))$p$;

  execute $p$create policy tenant_read on erp.companies for select to authenticated
    using (id = wms.current_company_id())$p$;

  -- Tabelas filhas sem company_id: leitura via registro pai.
  execute $p$create policy tenant_read on erp.purchase_order_items for select to authenticated
    using (exists (select 1 from erp.purchase_orders p where p.id = purchase_order_id and p.company_id = wms.current_company_id()))$p$;
  execute $p$create policy tenant_read on erp.sales_order_items for select to authenticated
    using (exists (select 1 from erp.sales_orders s where s.id = sales_order_id and s.company_id = wms.current_company_id()))$p$;
  execute $p$create policy tenant_read on wms.receipt_items for select to authenticated
    using (exists (select 1 from wms.receipts r where r.id = receipt_id and r.company_id = wms.current_company_id()))$p$;
  execute $p$create policy tenant_read on wms.outbound_order_lines for select to authenticated
    using (exists (select 1 from wms.outbound_orders o where o.id = order_id and o.company_id = wms.current_company_id()))$p$;
  execute $p$create policy tenant_read on wms.inventory_count_items for select to authenticated
    using (exists (select 1 from wms.inventory_counts i where i.id = inventory_id and i.company_id = wms.current_company_id()))$p$;
  execute $p$create policy tenant_read on wms.task_events for select to authenticated
    using (exists (select 1 from wms.tasks k where k.id = task_id and k.company_id = wms.current_company_id()))$p$;
end
$$;
