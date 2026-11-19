-- =============================================================================
-- ORION — Onboarding de primeiro acesso ("Primeiros passos")
-- -----------------------------------------------------------------------------
--  * wms.onboarding_seen: o tour guiado abre sozinho só no primeiro acesso de
--    cada usuário. Concluir ou pular grava a linha (idempotente). FK composta
--    garante que o usuário é da mesma empresa.
-- =============================================================================

create table wms.onboarding_seen (
  user_id       uuid primary key,
  company_id    uuid not null references erp.companies(id),
  outcome       text not null default 'completed' check (outcome in ('completed', 'skipped')),
  completed_at  timestamptz not null default now(),
  foreign key (user_id, company_id) references wms.users (id, company_id) on delete cascade
);

alter table wms.onboarding_seen enable row level security;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas de leitura do Supabase não foram criadas (ambiente local).';
    return;
  end if;
  execute $p$create policy tenant_read on wms.onboarding_seen for select to authenticated
    using (company_id = wms.current_company_id())$p$;
end
$$;

select wms.install_tenant_guards();
