# Etapa 3 – Especificações curtas para aprovação do dono

O `04-funcionalidades-novas.md` pede que cada funcionalidade comece com uma especificação curta (regra, dados, telas, exceções e MVP), **mostrada ao dono antes de construir**. Este arquivo é essa especificação. Nada da Etapa 3 foi implementado ainda: cada item abaixo aguarda o "pode construir" do dono.

Ordem de impacto: F1 → F9.

---

## F1. Coletor sem Wi-Fi (PWA offline)

- **Regra:** toda leitura feita sem conexão entra numa fila local com chave de idempotência (UUID gerado no aparelho). Ao reconectar, a fila é enviada em ordem; o servidor aplica cada leitura uma única vez (os server actions já usam `idempotencyKey`). Conflito (item já fechado, endereço bloqueado por outro inventário, saldo mudou) volta com a mensagem do servidor e a leitura fica marcada "recusada" na fila, sem repetir.
- **Dados:** IndexedDB `orion-coletor` com `fila(id, tipo, payload, chave, criadoEm, tentativas, situacao, mensagem)` e `cache(inventario, enderecos, produtos)` (códigos e EAN para validar a leitura sem rede).
- **Telas:** faixa fixa no topo do coletor "Sem conexão · 3 leituras na fila" (âmbar) / "Sincronizando…" / "Sincronizado às 14:32" (verde); tela "Fila" com as leituras e as recusadas.
- **Exceções:** sessão expirada durante a falta de rede (pedir login e manter a fila); duas abas abertas (trava por `navigator.locks`); aparelho sem espaço (aviso).
- **MVP:** service worker com cache da casca do coletor + fila para contagem de inventário (`countFromCollector`) e consulta rápida offline a partir do cache. Separação e armazenagem na fase 2 (precisam de `idempotencyKey` em `completeFromCollector`, que já existe).

## F2. Separação em lote (batch) e em grupo (cluster)

- **Regra:** *batch* — a onda junta linhas de vários pedidos pelo mesmo SKU + endereço numa só tarefa; a redistribuição acontece no put-wall da doca (posição por pedido). *Cluster* — um operador separa N pedidos ao mesmo tempo, cada pedido numa caixa numerada do carrinho; o coletor diz "coloque 3 un na caixa 2". Reposição disparada pela onda antes da liberação quando o picking não cobre a onda.
- **Dados:** `wave_tasks` (tarefa consolidada → reservas), `putwall_slots (wave, pedido, posição)`, `cart_slots (tarefa, pedido, caixa)`.
- **Telas:** Ondas › tipo de separação (discreta, lote, grupo); coletor com a caixa/posição em destaque; tela do put-wall na doca.
- **Exceções:** falta na consolidada (rateio da falta pelos pedidos por prioridade); pedido cancelado com a onda em andamento.
- **MVP:** cluster com até 6 pedidos por carrinho, sem put-wall; batch na fase 2.

## F3. Abastecimento de linha por kanban

- **Regra:** cada endereço da zona `production` tem mínimo, máximo e cartão kanban; quando o saldo cai ao mínimo, gera tarefa de reposição até o máximo. Milk run: rotas com horários fixos agrupam as reposições da rota. Consumo por apontamento: baixa pela estrutura do produto (BOM) × quantidade apontada, ou manual com motivo (refugo/perda).
- **Dados:** `line_kanban (endereço, produto, min, max, cartao)`, `milk_runs (rota, horários, endereços)`, `consumption_events`.
- **Telas:** Produção › Kanban (quadro por linha), Rotas, Apontamento; indicadores de falta de material por linha e lead time de abastecimento.
- **MVP:** kanban por endereço + reposição automática + apontamento manual com motivo.

## F4. API pública e conectores de ERP

- **Regra:** API REST versionada (`/api/v1`) com token por empresa (escopo e expiração), limitada por taxa; webhooks de saída para os mesmos eventos da outbox, assinados por HMAC (o processador da outbox já assina).
- **Dados:** `api_tokens (empresa, nome, hash, escopos, expira_em, ultimo_uso)`, `webhooks (empresa, url, eventos, segredo)`.
- **Telas:** Integração › Tokens e Webhooks; documentação OpenAPI em `/api/v1/docs`.
- **MVP:** leitura de saldo, pedidos de saída (criar/consultar) e recebimentos + webhooks. Conectores Protheus e SAP B1 e NF-e de saída na fase 2.

## F5. Cobrança de 3PL

- **Regra:** tabela de preço por cliente (posição-palete/dia, entrada, saída, linha separada, serviços extras); apuração mensal a partir dos movimentos e da ocupação diária.
- **Dados:** `billing_price_lists`, `billing_runs (mês, cliente, situação)`, `billing_lines`.
- **Telas:** Faturamento 3PL › Tabelas, Apuração do mês (prévia e fechamento), exportação CSV.
- **MVP:** posição-palete/dia + entrada + saída + linha separada, com fechamento mensal e CSV.

## F6. Fila de tarefas inteligente

- **Regra:** prioridade dinâmica = urgência da onda + doca agendada + idade da tarefa; intercalação: ao concluir uma armazenagem perto de uma separação pendente, oferece a separação na mesma viagem; meta por atividade comparada em Produtividade.
- **MVP:** prioridade dinâmica e intercalação simples (mesma rua).

## F7. Pátio e transportadoras

- **Regra:** chegada → fila → doca → saída, com horários; romaneio de carregamento por veículo; OTIF por cliente/transportadora.
- **MVP:** controle de pátio + romaneio + OTIF. EDI e rastreio na fase 2.

## F8. Regulatório

- **Farma:** serialização SNCM (IUM por unidade, eventos de ativação/expedição). **Frio:** registro de temperatura por zona/câmara com alarme e anexação ao lote.
- **MVP:** registro de temperatura com alarme (é a base para farma e alimentos); SNCM depois.

## F9. Slotting avançado

- **Regra:** afinidade entre SKUs (pares que saem juntos), sazonalidade (curva ABC por janela móvel) e reendereçamento em massa com plano de transferências, tudo sobre `slotting.ts`.
- **MVP:** afinidade + plano de reendereçamento em massa com prévia de ganho em metros.
