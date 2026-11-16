-- =============================================================================
-- ORION WMS — Aba Comex: acompanhamento do processo de importação
-- -----------------------------------------------------------------------------
-- Campos opcionais do processo de importação no recebimento, usados na linha do
-- tempo (embarque → chegada → registro DI/DUIMP → desembaraço → recebimento →
-- armazenagem) e nos filtros da aba Comex. Incoterm, país de origem e contêiner
-- já existem (migration 20261114000006). Sem tabela nova: wms.receipts já é
-- protegida por company_id, RLS e guardas de consistência entre empresas.
-- =============================================================================

alter table wms.receipts
  add column transport_mode        text check (transport_mode is null or transport_mode in ('sea', 'air', 'road', 'rail')),
  add column transport_doc         text check (transport_doc is null or length(transport_doc) between 3 and 40),
  add column commercial_invoice    text check (commercial_invoice is null or length(commercial_invoice) between 1 and 40),
  add column shipped_on            date,
  add column eta_on                date,
  add column import_registered_on  date,
  add column customs_channel       text check (customs_channel is null or customs_channel in ('green', 'yellow', 'red', 'grey'));

alter table wms.receipts
  add constraint receipts_eta_after_shipment check (eta_on is null or shipped_on is null or eta_on >= shipped_on),
  -- canal de parametrização e data de registro só existem com a declaração (DI/DUIMP)
  add constraint receipts_channel_doc check (customs_channel is null or import_doc_type is not null),
  add constraint receipts_registered_doc check (import_registered_on is null or import_doc_type is not null);

-- Consulta da aba Comex: processos de importação por empresa.
create index receipts_import_idx on wms.receipts (company_id, customs_status, created_at desc)
  where import_doc_type is not null or incoterm is not null or origin_country is not null or container_number is not null
     or transport_doc is not null or commercial_invoice is not null or transport_mode is not null;
