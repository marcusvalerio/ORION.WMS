# Etapa 3 – Funcionalidades novas

Aprovadas pelo dono. São projetos maiores: cada um deve começar com uma especificação curta (regra, dados, telas, exceções e MVP), mostrada ao dono antes de construir. A ordem abaixo segue o impacto apontado pelos diretores.

## F1. Coletor sem Wi-Fi (PWA offline)
- Service worker com cache da casca do coletor e fila local em IndexedDB para as leituras, cada uma com chave de idempotência. Os server actions já aceitam `keyRef` no inventário; estender para as tarefas.
- Indicador "Sem conexão · 3 leituras na fila" e sincronização automática quando a conexão voltar.
- Conflitos resolvidos pelo servidor, com mensagem clara ao operador.
- MVP: inventário e consulta offline; tarefas de separação e armazenagem na segunda fase.

## F2. Separação em lote (batch) e em grupo (cluster)
- Batch: juntar linhas de vários pedidos pelo mesmo SKU e endereço, e redistribuir na doca (put-wall).
- Cluster: um operador separa vários pedidos ao mesmo tempo, em caixas numeradas no carrinho.
- Reposição disparada pela onda antes da liberação.
- Estender `waves.ts` e o coletor.

## F3. Abastecimento de linha por kanban
- Ponto de reposição por endereço de linha (zona `production`), com mínimo, máximo e cartão kanban.
- Rotas cíclicas (milk run) com horários.
- Consumo por apontamento: baixa pela estrutura do produto, ou manual com motivo de refugo ou perda.
- Indicadores: falta de material por linha e lead time de abastecimento.

## F4. API pública e conectores de ERP
- API REST documentada (OpenAPI) com token por empresa e webhooks de saída para os mesmos eventos da outbox.
- Conectores iniciais: TOTVS Protheus e SAP Business One, mais NF-e de saída automática via integração.

## F5. Cobrança de 3PL
- Tabela de preços por cliente: armazenagem (posição-palete por dia), entrada, saída, separação por linha e serviços extras.
- Apuração mensal a partir dos movimentos, com relatório e exportação.

## F6. Fila de tarefas inteligente
- Prioridade dinâmica (prazo da onda, doca, urgência).
- Intercalação de tarefas (guardar e separar na mesma viagem).
- Meta por atividade e comparação com o padrão em Produtividade.

## F7. Pátio e transportadoras
- Controle de pátio: chegada, fila, doca, saída.
- Romaneio de carregamento.
- EDI e rastreio com transportadoras.
- Indicador de OTIF.

## F8. Regulatório
- Farma: serialização SNCM.
- Frio: registro de temperatura por zona ou câmara, com alarme e anexação ao lote.

## F9. Slotting avançado
- Afinidade entre SKUs, sazonalidade e reendereçamento em massa, tudo sobre `slotting.ts`.
