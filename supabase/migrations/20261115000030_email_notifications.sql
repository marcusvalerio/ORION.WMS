-- =============================================================================
-- Avisos por e-mail gerados pela outbox
--
--  * wms.email_messages: um registro por evento da outbox que tem aviso por
--    e-mail (inventário aprovado, divergência registrada, recebimento agendado).
--    Guarda destinatários, assunto, HTML e texto renderizados e o resultado do
--    transporte de e-mail. Por padrão o transporte é "log" (só registra, nada é
--    enviado); com EMAIL_API_URL configurada, o envio é feito por HTTP.
--  * Destinatários: parâmetro da empresa `notifications.email_recipients`
--    (wms.company_settings). Sem destinatário, o registro fica "sem destinatário".
--  * Um evento gera no máximo um e-mail (único por event_id): reprocessar a fila
--    não duplica avisos.
-- =============================================================================

create table wms.email_messages (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references erp.companies(id),
  event_id      uuid not null unique references wms.integration_events(id),
  template      text not null check (template in ('inventario_concluido', 'divergencia', 'recebimento_agendado')),
  to_addresses  text[] not null default '{}',
  subject       text not null check (length(subject) between 1 and 300),
  html          text not null,
  text_body     text not null,
  status        text not null check (status in ('logged', 'sent', 'failed', 'skipped')),
  transport     text not null check (transport in ('log', 'http')),
  error         text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  check (status = 'skipped' or cardinality(to_addresses) > 0),
  check ((status = 'failed') = (error is not null))
);

create index email_messages_company_idx on wms.email_messages (company_id, created_at desc);

alter table wms.email_messages enable row level security;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Schema auth inexistente: políticas de leitura do Supabase não foram criadas (ambiente local).';
    return;
  end if;
  execute $p$create policy tenant_read on wms.email_messages for select to authenticated
    using (company_id = wms.current_company_id())$p$;
end
$$;
