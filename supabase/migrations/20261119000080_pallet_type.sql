-- =============================================================================
-- ORION — tipo de palete (PBR, Europeu, Americano, Asiático, Australiano, Meio)
-- -----------------------------------------------------------------------------
-- No endereço: qual palete a posição recebe (o assistente "Montar armazém"
-- preenche). Na importação e na exportação: o palete da carga, usado no desenho
-- do contêiner (quantos cabem por camada). Opcional em todos.
-- =============================================================================
alter table wms.locations
  add column pallet_type text check (pallet_type is null or pallet_type in ('PBR', 'EUR', 'US', 'ASIA', 'AUS', 'HALF'));
alter table wms.receipts
  add column pallet_type text check (pallet_type is null or pallet_type in ('PBR', 'EUR', 'US', 'ASIA', 'AUS', 'HALF'));
alter table wms.outbound_orders
  add column pallet_type text check (pallet_type is null or pallet_type in ('PBR', 'EUR', 'US', 'ASIA', 'AUS', 'HALF'));
