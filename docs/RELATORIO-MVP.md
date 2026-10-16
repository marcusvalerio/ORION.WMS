# Relatório do MVP — ORION WMS

Data: 09/10/2026 · Branch: `claude/wms-erp-mvp-io9q47`

## A. Diagnóstico inicial

### O que existia no repositório

O repositório `ORION.WMS` continha apenas um `README.md` com o título do projeto: nenhum código, `package.json`, rota, componente, serviço, configuração do Supabase, migration, autenticação ou teste. O ERP descrito no briefing (Next.js + TypeScript + Tailwind + Supabase, com produtos, fornecedores, pedidos e estoque) **não está neste repositório**, e nenhum outro repositório foi indicado como fonte.

### Decisões de arquitetura

| Decisão | Motivo |
| --- | --- |
| Construir o WMS como aplicação Next.js modular neste repositório, na stack prevista (Next.js, TypeScript, Tailwind, PostgreSQL/Supabase). | Era a única base disponível; mantém compatibilidade com o ERP planejado. |
| **Fronteira de integração explícita**: o schema `erp` contém só as entidades que pertencem ao ERP (empresas, fornecedores, clientes, produtos, pedidos de compra e de venda); o WMS as acessa por `src/server/integrations/erp/gateway.ts`. | Evita um segundo cadastro de produtos: o WMS nunca edita o cadastro mestre, só guarda parâmetros logísticos (`wms.product_settings`). Quando o ERP real existir, troca-se o gateway (ou o schema `erp` vira views sobre as tabelas do ERP) sem mexer no WMS. |
| PostgreSQL de verdade em todos os ambientes: Supabase/Postgres via `DATABASE_URL`, ou **PGlite** (Postgres compilado para WASM) sem configuração externa. | O projeto roda, é demonstrado e é testado sem credenciais, usando as **mesmas migrations** e as mesmas restrições do banco de produção. |
| Regras de negócio no servidor (`src/server/services`), em transações com `SELECT … FOR UPDATE`; Server Actions apenas autenticam, validam a origem e chamam o serviço. | O navegador nunca altera saldo diretamente; a lógica fica testável e fora dos componentes. |
| Integridade garantida também no banco (CHECK, FK compostas, índices únicos parciais, triggers de imutabilidade). | Uma falha de código não consegue gravar saldo negativo, reserva acima do físico, expedição acima do conferido ou alterar histórico. |
| Autenticação própria mínima (senha scrypt + cookie de sessão assinado com HMAC) e perfis admin/supervisor/operador/auditor. | Não havia autenticação existente; a coluna `wms.users.auth_user_id` e as políticas RLS já preparam a troca para Supabase Auth. |

## B. Implementação

### Funcionalidades criadas, por módulo

| Módulo | Entregue |
| --- | --- |
| A. Dashboard | 11 indicadores calculados dos registros, cada um com definição de cálculo (ícone de informação e tela Indicadores); gráfico entradas × saídas (14 dias); tarefas por tipo/status; alertas (validade, ocupação ≥ 90%, armazenagem sem endereço elegível, tarefas > 24h, divergências, fila de integração); atividade recente; ações rápidas por perfil. |
| B. Estrutura física | Depósitos, zonas (recebimento, armazenagem, picking, expedição, quarentena), endereços DEP/RUA/MÓDULO/NÍVEL/POSIÇÃO com ID interno e código legível, tipo, classe de armazenagem, capacidade (un) e peso máximo; cadastro, edição, geração em lote, ativar/bloquear/inativar com motivo, filtros, ordenação, paginação, mapa zona → rua com ocupação, consulta de produtos no endereço. Exclusão física só sem estoque/histórico; inativação só com endereço vazio. |
| C. Produtos | Leitura do cadastro do ERP (SKU, descrição, código de barras, UN, categoria, status, peso, dimensões); parâmetros WMS: lote, validade (FEFO), série, classe de armazenagem, máximo por endereço, zona preferencial; unidades logísticas (embalagens) como fator de conversão, sem efeito sobre saldo. |
| D. Recebimento | Importação de pedido de compra do ERP (um recebimento ativo por pedido + idempotência), entrada avulsa, NF e chave NF-e (associação manual), registro de chegada, conferência (conferido, avariado, retido CQ, lote, validade, observações), salvamento parcial, finalização que exige quantidades e lote/validade obrigatórios e recusa produto vencido como disponível, divergências automáticas (falta, sobra, avaria, retenção) e manuais, liberação só do elegível, retenção de qualidade liberável só por supervisor com justificativa, cancelamento, histórico. |
| E. Armazenagem | Tarefas geradas na liberação (divididas pelo máximo por endereço), sugestão explicável (zona preferencial → consolidação do mesmo produto/lote → melhor encaixe), validação de status, zona, classe, capacidade (incluindo entradas pendentes) e peso, com lock do endereço; sem posição elegível, o sistema informa o motivo e não escolhe endereço incompatível. Estoque criado só na confirmação. |
| F. Estoque e movimentações | Consulta por produto, depósito, endereço, lote, validade e situação, com físico, reservado, bloqueado e disponível separados; transferência validada (criar tarefa ou executar já); ajuste manual só para supervisor/admin, com justificativa ≥ 10 caracteres e auditoria; bloqueio/desbloqueio; histórico imutável de movimentações com documento, tarefa, motivo e usuário. Não existe edição direta de saldo. |
| G. Tarefas | Central com filtros rápidos (abertas, minhas, sem responsável), busca, tipo, status, prioridade, ordenação e paginação; iniciar, executar, concluir; atribuição e prioridade (supervisor); cancelamento de transferências; eventos imutáveis por tarefa; conclusão única garantida sob lock. |
| H. Inventário | Geral e rotativo (zona, endereço ou produto), snapshot do saldo esperado, folha de contagem, inclusão de item encontrado, submissão (diferenças viram divergências), aprovação com permissão que gera ajustes e é recusada se o saldo mudou durante a contagem, devolução para recontagem e cancelamento. Contagem nunca altera saldo. |
| I. Saída | Importação de pedido de venda do ERP ou pedido manual; disponibilidade por item; reserva FEFO tudo-ou-nada; tarefas de separação por reserva com origem e doca; confirmação de endereço e quantidade (a menor gera divergência e libera o restante da reserva); conferência final que bloqueia a expedição se divergir; expedição com transportadora, placa e documento; status distintos aberto/reservado/em separação/separado/conferido/expedido; atualização do ERP e evento de integração. |
| J. Relatórios | 8 relatórios (estoque, movimentações, recebimentos, divergências, tarefas, inventários, pedidos, expedições) com pré-visualização e CSV (`;`, BOM UTF-8, proteção contra injeção de fórmulas) que respeita filtros e permissões. |
| Gestão | Indicadores de desempenho (dock-to-stock, ciclo do pedido, acuracidade de separação, recebimento e inventário); auditoria com busca e filtro; visão da outbox de integração. |

### Principais arquivos

- `supabase/migrations/20261009000001_erp_core.sql` — fronteira ERP.
- `supabase/migrations/20261009000002_wms_core.sql` — modelo operacional (23 tabelas).
- `supabase/migrations/20261009000003_rls_policies.sql` — RLS.
- `src/server/services/*` — regras e operações (`stock-core.ts` concentra as únicas funções que alteram saldo).
- `src/server/actions/*` — Server Actions.
- `src/app/(app)/*` — 29 telas; `src/app/api/relatorios/[report]` — CSV.
- `tests/*` — 50 testes.

### Modelo de dados (resumo)

`erp`: companies, suppliers, customers, products, purchase_orders(+items), sales_orders(+items).

`wms`: users, counters, warehouses, zones, locations, product_settings, packaging_units, stock_balances, stock_movements, receipts, receipt_items, divergences, tasks, task_events, inventory_counts, inventory_count_items, outbound_orders, outbound_order_lines, stock_reservations, shipments, integration_events, audit_log, idempotency_keys.

Mecanismos de integridade:

- `stock_balances`: `quantity ≥ 0`, `reserved ≥ 0`, `blocked ≥ 0`, `reserved + blocked ≤ quantity`, unicidade (endereço, produto, lote).
- Linhas de pedido: `reserved ≤ requested`, `picked ≤ requested`, `checked ≤ picked`, `shipped ≤ checked`.
- `receipts`/`outbound_orders`: índice único parcial impede dois documentos ativos para o mesmo pedido do ERP.
- `locations`: FK composta garante zona do mesmo depósito.
- Triggers impedem UPDATE/DELETE em `stock_movements`, `task_events` e `audit_log`.
- Idempotência: a chave da requisição é gravada na mesma transação da operação; reenvio devolve o resultado original; falha desfaz a chave junto.
- Concorrência: locks de linha em saldo, tarefa, documento e endereço; transições de status verificadas sob lock; retry automático de serialização/deadlock no driver Postgres.

### Integrações

- **ERP (local)**: leitura de produtos, fornecedores, pedidos de compra e de venda; atualização de status do pedido de compra (recebido/recebido parcial) e de venda (em atendimento/expedido/aberto).
- **Outbox** (`wms.integration_events`): eventos `receipt.completed` e `outbound.shipped` gravados na mesma transação, prontos para um processador de envio.
- **NF-e**: número e chave de acesso (validada com 44 dígitos) associados manualmente. Não foi implementada integração fiscal fictícia.

## C. Execução

Ver [README](../README.md#como-executar). Resumo: `npm install`, `npm run db:reset`, `npm run dev`; login com `supervisor@metalsupply.demo` / `orion-demo`.

Produção: `npm run build` e `SESSION_SECRET=<segredo> npm start`. Com Supabase, defina também `DATABASE_URL` (somente servidor) e `WMS_AUTO_SEED=false`.

## D. Validação

Executado nesta entrega:

| Verificação | Resultado |
| --- | --- |
| `npm run lint` (ESLint 9 + eslint-config-next 16) | 0 erros, 0 avisos |
| `npm run typecheck` (tsc strict) | sem erros |
| `npm test` (Vitest) | **8 arquivos, 50 testes, todos aprovados** |
| `npm run build` (Next.js 16, Turbopack) | concluído, 31 rotas, sem avisos |
| E2E manual automatizado em Chromium (Playwright, fora do repositório) | cenário demonstrativo completo pela interface: físico final 80, reservado 0, expedido 20; cenário com divergência; reserva acima do disponível recusada; 22 telas × 4 perfis sem erro (servidor de produção); CSV 200 para supervisor/admin/auditor, 403 para operador e 401 sem sessão; sem estouro horizontal em 390 px |

Cobertura dos testes automatizados (`tests/`):

- **Funcionais**: criar/consultar endereço e geração em lote; receber mercadoria; registrar divergências; concluir armazenagem; consultar saldo; transferir; inventário (contagem, submissão, aprovação, recontagem, item encontrado); reservar; separar (inclusive a menor); conferir; expedir; fluxo demonstrativo ponta a ponta.
- **Integridade**: saldo negativo e reserva acima do físico barrados pelo banco; dupla conclusão de tarefa; tarefa cancelada; movimentação de saldo reservado/bloqueado; expedição acima do conferido (restrição do banco); idempotência (inclusive requisições simultâneas com a mesma chave); reservas concorrentes nunca ultrapassam o disponível; revalidação de saldo na conclusão; rollback completo com falha no meio da operação; imutabilidade do histórico; permissões por perfil; token de sessão adulterado/expirado.

Problemas encontrados e corrigidos durante a validação:

1. Parser numérico do PGlite não aplicado (opções passadas na posição errada) → valores voltavam como texto.
2. Endereço sem classe aceitava produto refrigerado → classe ausente passou a valer "geral"; especiais exigem classe idêntica.
3. Checkbox ausente no formulário quebrava a validação (Zod 4) → helper `checkbox` comum.
4. Datas do Postgres (`+00`, microssegundos) exibidas como "há NaN d" → normalização ISO e teste.
5. Mensagem de sucesso desaparecia quando a tela mudava de etapa → notificações globais disparadas na resposta da ação.
6. React 19 reseta formulários após ações → envio manual preserva os campos em caso de erro.
7. Aviso de rastreamento de arquivos no build (migrations) → caminhos explícitos e `outputFileTracingIncludes`.

Limitação de ambiente: não havia Supabase nem Docker disponíveis; as migrations foram validadas em PostgreSQL via PGlite. As **políticas RLS** que dependem do schema `auth` só são criadas em um Supabase real e **não foram exercitadas** aqui (o bloco é ignorado com aviso em Postgres puro). Como o PGlite usa conexão única, a concorrência foi testada pela lógica de locks e restrições; o comportamento multi-conexão deve ser revalidado em Postgres/Supabase.

## E. Pendências e limitações

Não concluído nesta versão:

- **Integração com o ERP real**: o ERP existente não está no repositório; o schema `erp` local cumpre o papel de fronteira. Próximo passo: mapear as tabelas reais (views ou novo gateway).
- **Supabase Auth**: login próprio (scrypt + HMAC). Falta vincular `wms.users.auth_user_id` e usar a sessão do Supabase; as políticas RLS já usam `auth.uid()`.
- **Processador da outbox**: eventos ficam "Na fila"; falta o worker que envia ao ERP externo com retentativas.
- **NF-e/SEFAZ**: sem consulta ou importação de XML; apenas associação manual.
- **Controle de acesso por depósito**: o isolamento é por empresa e perfil; falta a tabela usuário × depósito.
- **Número de série**: parâmetro registrado; captura por unidade não implementada.
- **Reposição (replenishment)**: tipo de tarefa previsto no modelo, sem geração automática.
- **Recebimento parcial do mesmo pedido em várias entregas**: hoje um recebimento por pedido; a sobra fica registrada como divergência para tratamento.
- **Cancelamento após o início da separação**: bloqueado; exige fluxo de devolução ao endereço.
- **Gestão de usuários pela interface**: usuários são criados por seed/SQL.
- **Leitura de código de barras/coletor**: a confirmação é por seleção; leitura por scanner é a evolução natural para operadores.
- **Segregação de funções na aprovação de inventário** (quem conta ≠ quem aprova): não imposta.

Próximas prioridades recomendadas:

1. Conectar ao ERP real e ao Supabase (Auth + `DATABASE_URL`), revalidando RLS e concorrência em Postgres multi-conexão.
2. Processador da outbox com retentativa e painel de erros.
3. Acesso por depósito e gestão de usuários.
4. Telas de coletor (mobile) com leitura de código de barras para armazenagem, separação e contagem.
5. Recebimento parcial, devolução e reposição de picking.
6. CI no GitHub executando `npm run check` e `npm run build`.

## F. Demonstração operacional

Passo a passo em [README › Roteiro de demonstração](../README.md#roteiro-de-demonstração-cenário-completo). O mesmo roteiro está automatizado em `tests/demo-flow.test.ts`, que verifica: recebimento de 100 un do PC-4587 sem gerar estoque antes da armazenagem; tarefa com sugestão elegível; 100 un no endereço após a confirmação; reserva de 20 sem baixa física; separação para a doca; conferência; expedição; **físico final 80, reservado 0, expedido 20**; histórico `putaway:100`, `pick:20`, `shipment:20`; status do ERP (`PC-4587` recebido, `PV-1001` expedido) e eventos de integração `receipt.completed` e `outbound.shipped`.
