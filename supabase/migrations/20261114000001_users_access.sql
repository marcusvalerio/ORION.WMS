-- =============================================================================
-- ORION WMS — Usuários, acesso por depósito, parâmetros da empresa e
-- produtividade.
-- -----------------------------------------------------------------------------
--  * wms.users ganha troca obrigatória de senha e carimbos de alteração.
--  * wms.user_warehouses: usuário × depósito. Sem linhas = acesso a todos os
--    depósitos da empresa (comportamento original). FKs compostas garantem que
--    usuário e depósito pertencem à MESMA empresa da linha.
--  * wms.company_settings: parâmetros do WMS por empresa (chave/valor). Os
--    valores padrão ficam no código (src/server/services/settings.ts); a tabela
--    guarda apenas o que o administrador alterou.
--  * Índices para os relatórios de produtividade por operador.
-- =============================================================================

alter table wms.users
  add column must_change_password boolean not null default false,
  add column password_changed_at  timestamptz,
  add column updated_at           timestamptz not null default now();

-- E-mail sempre normalizado em minúsculas a partir daqui (unicidade sem diferenciar caixa).
create unique index users_email_lower_uniq on wms.users (lower(email));

alter table wms.users add constraint users_id_company_uniq unique (id, company_id);
alter table wms.warehouses add constraint warehouses_id_company_uniq unique (id, company_id);

create table wms.user_warehouses (
  user_id       uuid not null,
  warehouse_id  uuid not null,
  company_id    uuid not null references erp.companies(id),
  created_by    uuid references wms.users(id),
  created_at    timestamptz not null default now(),
  primary key (user_id, warehouse_id),
  foreign key (user_id, company_id) references wms.users (id, company_id) on delete cascade,
  foreign key (warehouse_id, company_id) references wms.warehouses (id, company_id)
);
create index user_warehouses_wh_idx on wms.user_warehouses (warehouse_id);

create table wms.company_settings (
  company_id  uuid not null references erp.companies(id),
  key         text not null check (key ~ '^[a-z][a-z0-9_.]*$'),
  value       jsonb not null,
  updated_by  uuid references wms.users(id),
  updated_at  timestamptz not null default now(),
  primary key (company_id, key)
);

-- Produtividade: consultas por usuário e período.
create index task_events_user_idx on wms.task_events (user_id, created_at);
create index tasks_completed_by_idx on wms.tasks (company_id, completed_by, completed_at) where status = 'completed';
create index stock_movements_user_idx on wms.stock_movements (company_id, created_by, created_at);

-- -----------------------------------------------------------------------------
-- RLS (mesmo padrão de 20261009000003_rls_policies.sql)
-- -----------------------------------------------------------------------------
alter table wms.user_warehouses enable row level security;
alter table wms.company_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas de leitura do Supabase não foram criadas (ambiente local).';
    return;
  end if;
  execute $p$create policy tenant_read on wms.user_warehouses for select to authenticated
    using (company_id = wms.current_company_id())$p$;
  execute $p$create policy tenant_read on wms.company_settings for select to authenticated
    using (company_id = wms.current_company_id())$p$;
end
$$;
