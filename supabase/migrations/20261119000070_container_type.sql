-- =============================================================================
-- ORION — tipo do contêiner nos processos de importação e exportação
-- -----------------------------------------------------------------------------
-- O número (ISO 6346) já existia; o tipo define a capacidade (m³ e kg) usada
-- no desenho de ocupação do contêiner no Comex. Opcional: sem tipo, o desenho
-- não mostra porcentagem.
-- =============================================================================
alter table wms.receipts
  add column container_type text check (container_type is null or container_type in ('20DC', '40DC', '40HC', '40RF'));
alter table wms.outbound_orders
  add column container_type text check (container_type is null or container_type in ('20DC', '40DC', '40HC', '40RF'));
