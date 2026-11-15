-- =============================================================================
-- ORION — Frente 2: identidade, novidades da versão e leads do site
-- -----------------------------------------------------------------------------
--  * wms.release_notes_seen: cada usuário vê a janela "Novidades da versão" uma
--    vez por versão. FK composta garante que o usuário é da mesma empresa.
--  * public.site_leads: e-mails deixados no formulário "Garantir minha vaga" da
--    página pública /site. Não pertence a nenhuma empresa (é pré-venda); fica
--    sem políticas de leitura para o papel `authenticated` do Supabase.
-- =============================================================================

create table wms.release_notes_seen (
  user_id     uuid not null,
  company_id  uuid not null references erp.companies(id),
  version     text not null check (version ~ '^[0-9]{4}\.[0-9]{1,2}$'),
  seen_at     timestamptz not null default now(),
  primary key (user_id, version),
  foreign key (user_id, company_id) references wms.users (id, company_id) on delete cascade
);

create table public.site_leads (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  cohort      text not null default '2027' check (cohort ~ '^[0-9]{4}$'),
  source      text not null default 'site' check (source in ('site')),
  created_at  timestamptz not null default now()
);
create unique index site_leads_email_cohort_uniq on public.site_leads (lower(email), cohort);

-- -----------------------------------------------------------------------------
-- RLS (mesmo padrão de 20261009000003_rls_policies.sql)
-- -----------------------------------------------------------------------------
alter table wms.release_notes_seen enable row level security;
alter table public.site_leads enable row level security;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas de leitura do Supabase não foram criadas (ambiente local).';
    return;
  end if;
  execute $p$create policy tenant_read on wms.release_notes_seen for select to authenticated
    using (company_id = wms.current_company_id())$p$;
end
$$;
