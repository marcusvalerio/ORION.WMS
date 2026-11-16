# Ecossistema ASTRAEUS — ATLAS.ERP · ORION.WMS · TMS

**ASTRAEUS** é o nome do ecossistema que reúne os sistemas de gestão: **ATLAS** (ERP, MRP e MCN), **ORION** (WMS) e o **TMS** (em breve). O ERP planeja, o WMS guarda e separa, o TMS leva — um dado digitado uma vez vale para todos. No ORION, a marca aparece no login, no rodapé da área logada, na tela **Sobre** (`/sobre`), na página pública (`/site`) e no rodapé dos e-mails.

Este documento descreve a divisão de responsabilidades entre os sistemas, as entidades de cada um e os eventos trocados. Cada item indica se **já existe** no código do ORION.WMS ou se é **proposto** (ainda não implementado).

## 1. Papéis

| Sistema | Papel | Situação |
|---|---|---|
| **ATLAS.ERP** | Dono dos cadastros mestres (empresa, produtos, fornecedores, clientes), pedidos de compra e venda, fiscal (NF-e, NCM, DI/DUIMP, DU-E), custos e MRP (ordens de produção e lista de componentes). | Existe como sistema separado. No ORION, a fronteira é o schema `erp` local (`supabase/migrations/20261009000001_erp_core.sql` e tabelas `erp.production_orders`/`erp.production_order_components` de `20261114000006`), lido pelo gateway `src/server/integrations/erp/gateway.ts`. A integração oficial é a API do contrato `docs/INTEGRACAO-ATLAS-ORION.md` (vínculo, eventos, SSO). O conector direto ao banco do ATLAS (`ATLAS_DATABASE_URL`) está **aposentado**: continua funcionando, por compatibilidade, apenas para empresas sem vínculo pela API. |
| **ORION.WMS** | Dono do físico: endereços, saldo por endereço/lote/série, reservas, tarefas (armazenagem, separação, reposição, inventário, separação para produção), conferência, volumes/packing list e expedição física. | Existe (este repositório). |
| **TMS** (futuro) | Dono de cargas, roteiros, transportadoras, fretes e rastreio da entrega. | **Proposto.** Não há código de TMS. Hoje o WMS guarda apenas campos textuais de transportadora/placa na expedição e no agendamento de docas. |

## 2. Dono de cada entidade

| Entidade | Dono | No ORION hoje |
|---|---|---|
| Empresa (razão social, CNPJ) | ERP | `erp.companies` (editável localmente ou vinculada ao ATLAS) |
| Produto, unidade, peso, dimensões, **NCM** | ERP | `erp.products` (lido); NCM em `erp.products.ncm` |
| Parâmetros logísticos do produto (lote, validade, série, classe, máx. por endereço) | WMS | `wms.product_settings`, `wms.packaging_units` |
| Fornecedor, cliente | ERP | `erp.suppliers`, `erp.customers` (lidos) |
| Pedido de compra | ERP | `erp.purchase_orders` (lido; status atualizado pelo evento `receipt.completed`) |
| Recebimento, conferência, divergências | WMS | `wms.receipts`, `wms.receipt_items`, `wms.divergences` |
| Dados de importação no recebimento (DI/DUIMP, Incoterm, origem, contêiner, lacre, NCM do item, desembaraço) | ERP (documento fiscal) — WMS registra o que chega fisicamente e a retenção | `wms.receipts.*import*/customs_*`, `wms.receipt_items.ncm` |
| País de origem do lote | WMS (rastreabilidade física) | `wms.lot_origins` |
| Pedido de venda | ERP | `erp.sales_orders` (lido; status atualizado por `outbound.shipped`) |
| Pedido de saída, reservas, separação, conferência, expedição | WMS | `wms.outbound_orders`, `wms.stock_reservations`, `wms.shipments` |
| Dados de exportação (Incoterm, destino, invoice, RE/DU-E) | ERP (fiscal) — informados no WMS para o packing list | `wms.outbound_orders.export_*` |
| Volumes, pesos, packing list, estufagem (contêiner/lacre) | WMS | `wms.export_packages`, `wms.export_package_items` |
| Ordem de produção e lista de componentes (MRP) | ERP | `erp.production_orders`, `erp.production_order_components` (lidos) |
| Requisição de material, reservas de componentes, entrega à linha, sobras, entrada do acabado | WMS | `wms.production_requisitions` e tabelas relacionadas |
| Saldo físico por endereço/lote/série e movimentações | WMS | `wms.stock_balances`, `wms.stock_movements` (imutável) |
| Agenda de docas | WMS | `wms.docks`, `wms.dock_appointments` |
| Carga, romaneio de transporte, roteiro, transportadora, frete, rastreio | TMS | **Proposto** |

## 3. Envelope dos eventos

Os eventos do WMS são gravados na outbox `wms.integration_events` **na mesma transação** da operação e entregues pelo processador (`src/server/integrations/outbox`), com retentativa e backoff.

Formato enviado pelo transporte HTTP (existe hoje):

```json
{
  "id": "uuid do evento",
  "type": "receipt.completed",
  "aggregate": { "type": "receipt", "id": "uuid" },
  "company_id": "uuid da empresa",
  "created_at": "2026-11-14T12:00:00Z",
  "attempt": 0,
  "payload": { }
}
```

Mapeamento para o envelope do ecossistema (id, tipo, versão, empresa, ocorrido_em, payload):

| Campo do ecossistema | Campo atual | Situação |
|---|---|---|
| `id` | `id` | existe |
| `tipo` | `type` | existe |
| `versão` | — | **proposto**: incluir `version` (inteiro, começa em 1) e incrementar a cada mudança incompatível de payload. Hoje todos os payloads são considerados versão 1. |
| `empresa` | `company_id` | existe |
| `ocorrido_em` | `created_at` | existe (momento da gravação na outbox, igual ao commit da operação) |
| `payload` | `payload` | existe |

Cabeçalhos: `X-Orion-Event-Id` e `Idempotency-Key` (= id do evento), `X-Orion-Timestamp` e `X-Orion-Signature: sha256=<HMAC>` com `ERP_WEBHOOK_SECRET`.

## 4. Idempotência

- **Entrada no WMS:** toda operação crítica recebe uma chave (`_key` do formulário) gravada em `wms.idempotency_keys` na mesma transação; reenvio devolve o resultado original sem reexecutar.
- **Saída do WMS:** o consumidor deve tratar o `id` do evento como chave de idempotência (ignorar ids já processados). O transporte local (schema `erp` do mesmo banco) aplica efeitos idempotentes (definir status).
- A entrega é *pelo menos uma vez*; a ordem é aproximadamente a de criação, sem garantia estrita entre agregados diferentes.

## 5. Eventos

### Já existentes antes desta frente

| Tipo | Agregado | Quando |
|---|---|---|
| `receipt.completed` | receipt | todo o volume liberado do recebimento foi armazenado |
| `outbound.shipped` | outbound_order | expedição confirmada |
| `outbound.cancelled` | outbound_order | pedido de saída cancelado |
| `outbound.line_cancelled` | outbound_order | linha cancelada |
| `customer_return.completed` | customer_return | devolução de cliente inspecionada e concluída |

### Novos (Frente F) — implementados

| Tipo | Agregado | Quando | Payload principal |
|---|---|---|---|
| `import.cleared` | receipt | supervisor registra o desembaraço de um recebimento retido | código, declaração (tipo/número), data, país de origem, itens com NCM e lote |
| `export.packed` | outbound_order | packing list fechado (todo o separado em volumes) | Incoterm, destino, invoice, RE/DU-E, totais de peso/volume, volumes com itens, lote, NCM e origem |
| `production.materials_delivered` | production_requisition | entrega à linha confirmada | ordem, código da entrega, quem recebeu, itens/lotes/quantidades |
| `production.leftovers_returned` | production_requisition | sobra de componente devolvida ao estoque | ordem, SKU, lote, quantidade, endereço |
| `production.output_received` | production_requisition | entrada do produto acabado registrada | ordem, SKU, lote da ordem, validade, quantidade e total recebido |

O transporte local não aplica efeito no ERP para estes cinco (considerados entregues). O status da ordem de produção local (`in_progress`/`completed`) é atualizado pelo serviço via gateway, como já acontece com pedidos de compra.

## 6. Ponto de encontro WMS → TMS (proposto)

Nada desta seção está implementado. Proposta de contrato:

- **Carga/romaneio:** o WMS publicaria `shipment.ready` quando o pedido estiver conferido (e, se exportação, com packing list fechado), com volumes, pesos, dimensões e m³ (já calculados em `export_packages`). O TMS montaria cargas e roteiros e devolveria `load.planned` (carga, transportadora, veículo, doca e janela).
- **Agenda de docas:** o WMS continua dono das docas (`wms.dock_appointments`). O TMS solicitaria janelas (`dock.slot_requested`) e o WMS confirmaria ou recusaria (`dock.slot_confirmed`), mantendo a regra de não sobreposição garantida no banco.
- **Expedição:** `outbound.shipped` (existente) passaria a incluir o identificador da carga do TMS; rastreio e prova de entrega ficam no TMS.

## 7. Integração ATLAS ↔ ORION pela API (substitui `ATLAS_DATABASE_URL`)

Fases 1–3 do contrato estão implementadas no ORION (`src/server/integrations/atlas/**`, `src/server/services/atlas-sync.ts`, `src/app/api/atlas/**`, `src/app/api/sso/**`, migration `20261116000050_atlas_link.sql`). O ORION não lê mais o banco do ATLAS para empresas vinculadas: cadastros, documentos e acessos chegam por eventos assinados (HMAC por empresa) e os fatos físicos voltam pela outbox no envelope do contrato. `ATLAS_DATABASE_URL` pode ser removida quando todas as empresas estiverem vinculadas.
