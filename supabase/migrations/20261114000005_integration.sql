-- =============================================================================
-- ORION — Frente E: integração com o ATLAS.ERP e processador da outbox
-- -----------------------------------------------------------------------------
-- 1. Dados cadastrais da empresa (razão social, CNPJ, contato, endereço) com a
--    origem do cadastro: `local` (editado no WMS) ou `atlas` (vinculado a um
--    registro de public.companies do ATLAS.ERP, lido em transação READ ONLY).
-- 2. Outbox wms.integration_events com ciclo de vida completo: na fila,
--    enviando, enviado, falhou (esgotou as tentativas), descartado (com motivo),
--    além de retentativa com backoff (next_attempt_at) e lock por evento.
-- Nenhuma tabela nova com company_id é criada: as políticas RLS existentes
-- (20261009000003) continuam valendo para erp.companies e wms.integration_events.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Empresa
-- -----------------------------------------------------------------------------
alter table erp.companies
  add column legal_name    text,
  add column email         text,
  add column phone         text,
  add column address       text,
  add column city          text,
  add column state         text,
  add column zip_code      text,
  add column source        text not null default 'local',
  add column external_id   text,
  add column synced_at     timestamptz,
  add column updated_at    timestamptz not null default now();

-- CNPJ, UF e CEP são gravados só com dígitos/maiúsculas; o dígito verificador
-- do CNPJ é validado no servidor (src/lib/cnpj.ts) e aqui pelo formato.
alter table erp.companies
  add constraint companies_document_format check (document is null or document ~ '^[0-9]{14}$'),
  add constraint companies_state_format check (state is null or state ~ '^[A-Z]{2}$'),
  add constraint companies_zip_format check (zip_code is null or zip_code ~ '^[0-9]{8}$'),
  add constraint companies_email_format check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add constraint companies_source_check check (source in ('local', 'atlas')),
  add constraint companies_atlas_link check (
    (source = 'local' and external_id is null) or (source = 'atlas' and external_id is not null)
  );

-- Um registro do ATLAS só pode estar vinculado a uma empresa do WMS.
create unique index companies_atlas_external_uniq on erp.companies (external_id) where source = 'atlas';

-- -----------------------------------------------------------------------------
-- Outbox
-- -----------------------------------------------------------------------------
alter table wms.integration_events drop constraint if exists integration_events_status_check;

alter table wms.integration_events
  add column next_attempt_at  timestamptz not null default now(),
  add column last_attempt_at  timestamptz,
  add column locked_at        timestamptz,
  add column transport        text,
  add column discard_reason   text,
  add column discarded_by     uuid references wms.users(id),
  add column discarded_at     timestamptz;

alter table wms.integration_events
  add constraint integration_events_status_check
    check (status in ('pending', 'sending', 'sent', 'failed', 'discarded')),
  add constraint integration_events_attempts_check check (attempts >= 0),
  add constraint integration_events_transport_check check (transport is null or transport in ('local', 'http')),
  add constraint integration_events_sending_lock check (status <> 'sending' or locked_at is not null),
  add constraint integration_events_sent_check check (status <> 'sent' or processed_at is not null),
  add constraint integration_events_discard_check check (
    status <> 'discarded' or (discard_reason is not null and length(trim(discard_reason)) >= 5 and discarded_at is not null)
  );

drop index if exists wms.integration_events_status_idx;
create index integration_events_queue_idx on wms.integration_events (status, next_attempt_at, created_at);
create index integration_events_company_idx on wms.integration_events (company_id, created_at desc);
