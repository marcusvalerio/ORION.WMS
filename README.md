# ORION WMS

Gestão de armazéns integrada ao ERP: recebimento, conferência, endereçamento, estoque, movimentações, tarefas, inventário, separação e expedição.

> Primeira versão funcional (MVP). O relatório técnico completo — diagnóstico, decisões, validações e pendências — está em [`docs/RELATORIO-MVP.md`](docs/RELATORIO-MVP.md).

## Stack

| Camada | Tecnologia |
| --- | --- |
| Aplicação | Next.js 16 (App Router, Server Components e Server Actions), React 19, TypeScript 5.9 (strict) |
| Interface | Tailwind CSS 4, ícones lucide-react, gráficos em SVG próprio |
| Dados | PostgreSQL — Supabase/Postgres via `DATABASE_URL`, ou PGlite (Postgres embarcado) quando a variável não existe |
| Validação | Zod 4 |
| Testes | Vitest 3 rodando sobre Postgres real (PGlite em memória) com as mesmas migrations |

## Como executar

Requisitos: Node.js ≥ 20.9 e npm.

```bash
npm install
npm run db:reset   # cria .data/pglite, aplica as migrations e carrega os dados de demonstração
npm run dev        # http://localhost:3000
```

Sem nenhuma variável de ambiente, o sistema usa o PostgreSQL embarcado em `.data/pglite` e carrega os dados de demonstração no primeiro acesso.

### Usuários de demonstração

Empresa fictícia **MetalSupply Componentes** (todos os registros são marcados e exibidos como *Demonstração*). Senha de todos: `orion-demo`.

| Perfil | E-mail |
| --- | --- |
| Administrador | `admin@metalsupply.demo` |
| Supervisor de armazém | `supervisor@metalsupply.demo` |
| Operador | `operador@metalsupply.demo` |
| Auditor (somente consulta) | `auditor@metalsupply.demo` |

A tela de login tem atalhos que preenchem cada perfil. **Não use estes usuários em produção**: defina `WMS_AUTO_SEED=false` e crie usuários reais.

### Variáveis de ambiente

Veja [`.env.example`](.env.example). Nenhuma é obrigatória em desenvolvimento.

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão Postgres/Supabase **somente no servidor**. Sem ela, usa PGlite. |
| `PGLITE_DATA_DIR` | Diretório do banco embarcado (padrão `.data/pglite`). |
| `SESSION_SECRET` | Segredo (≥ 32 caracteres) do cookie de sessão. **Obrigatório em produção.** Em desenvolvimento, um segredo aleatório é gerado em `.data/session-secret`. |
| `WMS_AUTO_SEED` | `false` desliga a carga automática dos dados de demonstração. |
| `WMS_DEMO_MODE` | `true`: abre sem login, como a administradora de demonstração, com banco PGlite temporário e sem `SESSION_SECRET`. Sem a variável, liga sozinho na **Vercel** (preview e produção) quando não há `DATABASE_URL`; `false` desliga. Os dados voltam ao inicial quando o servidor reinicia. |
| `ATLAS_DATABASE_URL` | Conexão Postgres **somente leitura** com o banco do ATLAS.ERP, para importar os dados da empresa. Só no servidor. Sem ela, os dados são editados manualmente. |
| `ERP_OUTBOX_TRANSPORT` | `local` ou `http`. Sem a variável: `http` se `ERP_WEBHOOK_URL` existir, senão `local`. |
| `ERP_WEBHOOK_URL` | Endpoint do ERP que recebe os eventos da outbox (POST JSON assinado). |
| `ERP_WEBHOOK_SECRET` | Segredo (≥ 16 caracteres) da assinatura HMAC-SHA256 dos eventos. |
| `ERP_WEBHOOK_TIMEOUT_MS` | Tempo máximo de cada envio (padrão 10000). |
| `CRON_SECRET` | Token (≥ 16 caracteres) que protege `/api/integracao/processar`. |
| `EMAIL_API_URL` | Opcional. Avisos por e-mail da outbox (inventário aprovado, divergência, recebimento agendado) via `POST` JSON `{from,to,subject,html,text}` nesta URL. Sem ela, o transporte é de **registro**: os e-mails são gerados e mostrados na tela de Integração, sem envio real. SMTP não está incluído (ponto de extensão: `EmailTransport` em `src/server/integrations/outbox/email.ts`). Destinatários em Configurações. |
| `EMAIL_API_TOKEN` | Opcional. Enviado como `Authorization: Bearer` ao `EMAIL_API_URL`. |
| `EMAIL_FROM` | Opcional. Remetente informado ao `EMAIL_API_URL`. |
| `APP_URL` | Opcional. Endereço público do ORION, para os links absolutos nos e-mails. |

### Scripts

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Build e servidor de produção (`SESSION_SECRET` obrigatório) |
| `npm run lint` | ESLint (config Next.js + TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Testes automatizados (Vitest) |
| `npm run check` | lint + typecheck + testes |
| `npm run db:migrate` | Aplica migrations pendentes |
| `npm run db:seed` | Carrega dados de demonstração se o banco estiver vazio |
| `npm run db:reset` | Recria o banco **local** (PGlite) do zero — recusado quando `DATABASE_URL` está definida |

> PGlite aceita um processo por diretório: pare o servidor antes de rodar `db:reset`.

## Roteiro de demonstração (cenário completo)

1. Entre como **Supervisor** → *Entrada › Recebimentos › Novo recebimento* → no pedido **PC-4587** (100 un de *Componente Industrial A*), clique **Iniciar recebimento**.
2. Entre como **Operador** → abra o recebimento → **Registrar chegada e iniciar conferência** → informe **100** em *Conferido* → **Salvar e finalizar conferência**.
3. Como **Supervisor** → **Liberar itens e gerar tarefas de armazenagem**.
4. Como **Operador** → *Entrada › Armazenagem* → abra a tarefa → confira o endereço sugerido → **Confirmar e concluir**.
5. *Armazém › Estoque*: 100 un físicas e disponíveis no endereço.
6. Como **Supervisor** → *Operações › Separação* → importe **PV-1001** (20 un) → **Reservar estoque** (reservado 20, físico continua 100) → **Liberar para separação**.
7. Como **Operador** → abra a tarefa de separação → **Confirmar e concluir** → no pedido, **Registrar conferência** (20) → **Confirmar expedição**.
8. *Estoque*: físico **80**, reservado **0**. *Movimentações*: armazenagem 100 → separação 20 → expedição 20. O pedido mostra 20 expedidas.

Cenários adicionais:

- **Divergência no recebimento** — importe **PC-4588**: confira 55 de LUB-002 (3 avariadas) e 42 de ADE-003 (10 retidas pelo CQ). A finalização exige lote e validade; são registradas falta, sobra, avaria e retenção; só o elegível (52 e 32) vira tarefa, e o adesivo refrigerado só é sugerido na câmara fria.
- **Separação acima da disponibilidade** — importe **PV-1002** (500 un) e tente reservar: a reserva é recusada por inteiro, sem reserva parcial.
- **Coletor (celular/leitor de código de barras)** — como **Operador**, botão **Coletor** no topo; para qualquer perfil, o ícone de leitor de código de barras à direita do campo de busca do topo (rota `/coletor`): *Minhas tarefas* → **Pegar tarefa** → leia o endereço (etiqueta), o produto (EAN ou SKU) e confirme a quantidade. Leitores que funcionam como teclado (código + Enter) são aceitos direto no campo, sempre focado; o botão de teclado libera a digitação manual. Também há contagem de inventário (contagem cega) e consulta rápida (endereço → conteúdo; produto → onde está). Endereço diferente do sugerido é validado com as mesmas regras e a recusa é explicada.
- **Etiquetas** — botões **Imprimir etiquetas** em *Endereços* (filtro atual, ou um endereço), no produto e no pedido de saída. Código de barras **Code 128** gerado no próprio sistema (SVG, sem dependência externa); a impressão usa o diálogo do navegador (`window.print`), com tamanhos físicos: endereço e produto 100×50 mm, volume de expedição 100×150 mm (pedido, cliente, volume *x de y*, doca).
- **Recebimento parcial** — em *Novo recebimento › Entrega parcial / histórico* do **PC-4587**, receba 60; o pedido fica *Recebido parcial* com saldo 40 e uma nova entrega leva o restante. Entregas simultâneas são serializadas por lock do pedido.
- **NF-e (XML)** — importe `docs/exemplos/nfe-pc-4588-entrega-1.xml` em *Novo recebimento*: o emitente casa pelo CNPJ (Química Delta), o pedido pelo `xPed` (PC-4588) e o lubrificante pelo EAN; o adesivo (sem GTIN) fica pendente de vínculo — confirme o produto (o de-para é salvo) e crie o recebimento com lotes e validades da nota.
- **Agenda de docas** — *Entrada › Agenda de docas*: grade do dia por doca, agendamento sem sobreposição (trigger com lock da doca no banco), check-in/não comparecimento/concluído; o agendamento demo AGD-000001 (PC-4587) cria o recebimento.
- **Devolução de cliente** — depois de expedir PV-1001, *Entrada › Devoluções › Registrar*: até o expedido; na inspeção, apto gera armazenagem, avariado vai bloqueado à quarentena e descarte é baixado (movimento `discard`); a conclusão gera o evento `customer_return.completed` na outbox. Fuso da agenda: `WMS_TIMEZONE` (padrão `America/Sao_Paulo`).

Os mesmos cenários estão automatizados em `tests/`.

## Estrutura

```
supabase/migrations/       Migrations SQL versionadas (ERP, WMS, RLS)
scripts/db.ts              migrate / seed / reset
src/app/(app)/             Telas autenticadas (uma pasta por módulo)
src/app/api/relatorios/    Exportação CSV protegida
src/app/api/health/        Saúde (pública, sem dados sensíveis)
src/app/api/integracao/    Processamento da outbox (CRON_SECRET)
src/components/            UI (design system), formulários, componentes WMS
src/lib/                   Permissões, rótulos, formatação (compartilhados)
src/server/db/             Drivers (PGlite/Postgres), migrations, conexão
src/server/auth/           Senha (scrypt), token HMAC, sessão
src/server/services/       Regras de negócio e operações transacionais
src/server/actions/        Server Actions (camada fina sobre os serviços)
src/server/integrations/   Gateway do ERP, conector ATLAS (somente leitura) e outbox
src/server/seed/           Dados de demonstração
tests/                     Testes funcionais e de integridade
```

## Usando Supabase

1. Aplique as migrations: `supabase db push` (ou execute os arquivos de `supabase/migrations` em ordem).
2. Defina `DATABASE_URL` com a string de conexão do Postgres (servidor) e `SESSION_SECRET`.
3. As políticas RLS são criadas automaticamente quando o schema `auth` existe. Os schemas `erp` e `wms` não são expostos pela API REST por padrão; toda escrita passa pelo servidor.

Detalhes, limitações e próximos passos: [`docs/RELATORIO-MVP.md`](docs/RELATORIO-MVP.md).

## Usuários, acesso e produtividade

- **Gestão › Usuários** (somente administrador): criar (senha inicial com no mínimo 8 caracteres, letra e número; troca obrigatória no primeiro acesso), editar nome/perfil, ativar/inativar (não é possível inativar a si mesmo nem deixar a empresa sem administrador ativo), redefinir senha (senha temporária exibida uma única vez) e definir os **depósitos permitidos**. Todo usuário troca a própria senha pelo ícone de chave no topo (`/trocar-senha`). No modo demonstração, os usuários de demonstração ficam protegidos (perfil, situação e senha).
- **Acesso por depósito** (`wms.user_warehouses`): sem depósitos marcados, o usuário acessa todos; com depósitos marcados, só vê e opera estoque, movimentações, endereços, tarefas, recebimentos, pedidos de saída, expedições e inventários desses depósitos.
- **Gestão › Configurações** (administrador): parâmetros do WMS por empresa (`wms.company_settings`). Primeiro parâmetro: *segregação de funções no inventário* (ligado por padrão) — quem registrou contagem não aprova o mesmo inventário.
- **Gestão › Produtividade** (administrador, supervisor, auditor): por operador e período — tarefas concluídas por tipo, tempo médio (início → conclusão), unidades movimentadas, itens separados, linhas conferidas e acuracidade de separação; exportação CSV em `/api/relatorios/produtividade`.
## Integração com o ATLAS.ERP e operação

### Dados da empresa (ATLAS.ERP, somente leitura)

*Gestão › Dados da empresa* (administrador) mostra razão social, CNPJ, contato e endereço usados no cabeçalho, no topo dos CSV de relatórios e nas etiquetas de expedição (`getCompanyProfile` em `src/server/services/company.ts`).

- **Sem `ATLAS_DATABASE_URL`**: a tela explica a configuração e os dados são editados manualmente (CNPJ validado pelos dígitos verificadores, UF e CEP normalizados).
- **Buscar no ERP**: lista as empresas `active` de `public.companies` do ATLAS (nome, razão social, CNPJ). *Vincular* copia os dados e grava a origem `atlas`, o id externo e a data da sincronização. Empresa inativa ou com CNPJ inválido é recusada.
- **Sincronizar agora**: mostra campo a campo o que mudou e só grava após a confirmação. Se o registro no ATLAS mudar entre a pré-visualização e a confirmação, a gravação é recusada para nova revisão. Vínculo, sincronização, edição e desvínculo ficam na auditoria.
- O WMS **nunca escreve no ATLAS**: toda leitura roda em `SET TRANSACTION READ ONLY` e só a tabela `public.companies` é consultada.

Crie no banco do ATLAS um usuário com acesso apenas a essa tabela:

```sql
-- Execute no banco do ATLAS.ERP como superusuário/dono do schema
create role orion_wms_reader login password '<senha forte>';
grant connect on database <banco_atlas> to orion_wms_reader;
grant usage on schema public to orion_wms_reader;
grant select on public.companies to orion_wms_reader;   -- nenhuma outra tabela
alter role orion_wms_reader set default_transaction_read_only = on;
```

E configure no servidor do WMS (nunca com prefixo `NEXT_PUBLIC_`):

```
ATLAS_DATABASE_URL=postgres://orion_wms_reader:<senha>@<host-atlas>:5432/<banco_atlas>?sslmode=require
```

### Processador da outbox (`wms.integration_events`)

Cada operação grava seus eventos na mesma transação (`receipt.completed`, `outbound.shipped`). O processador (`src/server/integrations/outbox/`) os entrega por um transporte plugável:

| Transporte | Comportamento |
| --- | --- |
| `local` (padrão) | Aplica o evento no schema `erp` deste banco (status do pedido de compra/venda), na mesma transação que marca o evento como enviado. Idempotente. |
| `http` | `POST` JSON para `ERP_WEBHOOK_URL` com timeout. Cabeçalhos: `Idempotency-Key` e `X-Orion-Event-Id` (= id do evento; o ERP deve ignorar ids repetidos), `X-Orion-Timestamp` e `X-Orion-Signature: sha256=<hex>`, que é o HMAC-SHA256 de `"<timestamp>.<corpo>"` com `ERP_WEBHOOK_SECRET`. Qualquer resposta fora de 2xx conta como falha. |

Status: **Na fila** → **Enviando** → **Enviado**. Em caso de falha o evento volta para a fila com backoff exponencial (30 s, 1 min, 2 min… até 1 h). Depois de 8 tentativas fica como **Falhou**. Cada evento guarda o último erro, a próxima tentativa e o número de tentativas. A reserva usa `FOR UPDATE SKIP LOCKED`, então dois processadores nunca pegam o mesmo evento. Um evento preso em “Enviando” por mais de 5 min volta a ser elegível.

*Gestão › Integração* tem filtros, payload, contadores por status e o botão **Processar fila** (supervisor/admin). **Reenviar** e **Descartar com motivo** são exclusivos do administrador e ficam auditados.

**Processamento agendado**: `POST /api/integracao/processar` (também aceita `GET`) com `Authorization: Bearer <CRON_SECRET>`. Sem `CRON_SECRET` a rota responde 503; com token errado, 401. No Vercel, defina `CRON_SECRET` no projeto e acrescente ao `vercel.json`:

```json
{ "crons": [{ "path": "/api/integracao/processar", "schedule": "*/5 * * * *" }] }
```

O Vercel Cron envia o cabeçalho `Authorization: Bearer $CRON_SECRET` automaticamente. No plano Hobby o cron roda no máximo uma vez por dia; use um agendador externo (`curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/integracao/processar`) se precisar de mais frequência.

### Saúde do sistema

- `GET /api/health` (pública, para monitoramento): `status` (`ok` / `degraded` / `error`), versão, banco (ok e latência), migrations aplicadas/disponíveis/pendentes e tamanho da fila (na fila e com falha). Não expõe hosts, segredos nem dados de empresa. Responde 503 quando o banco está indisponível.
- *Gestão › Saúde* (administrador): o mesmo com detalhes (driver, migrations pendentes, fila por status, evento mais antigo e se `ATLAS_DATABASE_URL`, transporte e `CRON_SECRET` estão configurados, sem mostrar valores).

### CI

`.github/workflows/ci.yml` roda em todo push e pull request (Node 22, cache do npm): `npm ci`, `npm run check` (lint + typecheck + testes) e `npm run build` com `WMS_DEMO_MODE=true`.
## Saída, reposição e slotting (Frente D)

- **Ondas** (*Operações › Ondas*): agrupe pedidos reservados por doca, transportadora, data prevista (planejamento no pedido) ou seleção manual. Liberar a onda consolida as reservas em tarefas por endereço/produto/lote, com a quantidade de cada pedido (`wms.task_allocations`) e sequência de roteiro (rua → módulo em serpentina → nível → posição). Separada a onda, cada pedido é **distribuído** na doca e segue para a conferência individual. Um pedido fica em no máximo uma onda ativa (índice único).
- **Reposição** (*Operações › Reposição*): mínimo/máximo por produto em endereço de zona de picking. Tarefas de reposição (pulmão → picking, FEFO, até o máximo) são geradas após separação, ajuste e expedição ou pelo botão *Verificar reposição*, sem duplicar tarefa aberta por endereço. Falta encontrada na separação em endereço de picking gera **reposição de emergência** (prioridade alta). Demonstração: LUB-002 em `RUA-PK/MOD-01` (mín. 10, máx. 20).
- **Cancelamento após a separação**: supervisor/admin (`outbound.cancel_picking`) cancela pedido ou linha em separação/separado/conferido; tarefas abertas são canceladas, reservas no endereço liberadas e o que já foi separado gera **tarefa de devolução** (movimento `return`). Evento `outbound.cancelled`/`outbound.line_cancelled` na outbox.
- **Curva ABC** (*Gestão › Curva ABC*): giro por unidades ou linhas separadas nos últimos N dias, cortes A/B configuráveis (padrão 80/15/5), gráfico e tabela; sugestões de reendereçamento de itens A para endereços de picking/níveis baixos, com geração de transferência.
- **Número de série**: produtos com controle de série (demo: SEN-005) exigem as séries na separação e a leitura das mesmas séries na expedição; série duplicada em estoque é barrada pelo banco.

## Comércio exterior e produção (Frente F)

Migration `20261114000006_comex_production.sql`. Arquitetura e eventos do ecossistema em [`docs/ECOSSISTEMA.md`](docs/ECOSSISTEMA.md).

- **Importação** (card "Importação" no recebimento): DI/DUIMP, Incoterm 2020, país de origem (ISO 3166 alfa-2), contêiner (dígito ISO 6346 validado no servidor e no banco), lacre e NCM por item (8 dígitos). Com "reter até o desembaraço" o recebimento não é liberado para armazenagem até um supervisor registrar o desembaraço (`customs.clear`); o banco também impede. O país de origem segue o lote (`wms.lot_origins`) e aparece na consulta de estoque, no saldo e no packing list. Evento `import.cleared`.
- **Exportação** (card "Exportação" no pedido de saída): Incoterm, destino, invoice e RE/DU-E; volumes com pesos e dimensões (nunca acima do separado); packing list bilíngue em `/etiquetas/packing-list/[id]` e etiqueta de volume bilíngue em `/etiquetas/volumes/[id]`; estufagem com contêiner ISO 6346 e lacre. Pedido de exportação só é expedido com o packing list fechado. Evento `export.packed`.
- **Produção** (`/producao`): requisição a partir da ordem de produção do ERP, reserva FEFO (tudo ou nada configurável), tarefas de separação até o endereço da linha (zona tipo "Produção"), entrega à linha com confirmação, devolução de sobras e entrada do produto acabado com o lote da ordem, que vira armazenagem normal. Eventos `production.materials_delivered`, `production.leftovers_returned`, `production.output_received`.
- Permissões novas: `comex.manage`, `customs.clear`, `production.manage` (admin/supervisor); `export.pack`, `production.operate` (operacionais).
- Seed: NCM nos produtos, zona `PRD` com a linha `DEP-01/RUA-PR/...`, produto acabado `SUP-006` e a ordem `OP-2026-001` (5 un; componentes CHP-004 ×5 e LUB-002 ×2), sem requisição nem reserva.
