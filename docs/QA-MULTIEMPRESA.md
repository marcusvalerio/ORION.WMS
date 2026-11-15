# QA multiempresa: isolamento e concorrência

Bateria automatizada que testa se uma empresa consegue ver ou alterar dados de outra, e se o sistema aguenta 49 funcionários trabalhando ao mesmo tempo.

| Arquivo | Conteúdo |
|---|---|
| `tests/fixtures/multi-tenant.ts` | Cenário com 5 empresas e 49 usuários, e funções de verificação (impressão digital, FKs cruzadas) |
| `tests/multi-tenant-isolation.test.ts` | Isolamento: leituras, buscas por ID, escritas, outbox/e-mail, KPIs e rotas de API |
| `tests/multi-tenant-load.test.ts` | Concorrência: os 49 funcionários ao mesmo tempo |
| `supabase/migrations/20261115000040_tenant_consistency.sql` | Gatilho `tenant_guard`, que impede no banco qualquer FK apontando para registro de outra empresa |

## Como rodar

```bash
npm run check                                    # inclui as duas baterias (PGlite em memória)
npx vitest run tests/multi-tenant-isolation.test.ts tests/multi-tenant-load.test.ts

# PostgreSQL real, com concorrência de verdade (pool de 25 conexões).
# ATENÇÃO: os schemas erp/wms do banco indicado são APAGADOS. Use um banco só de teste.
TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/orion_test \
  npx vitest run tests/multi-tenant-isolation.test.ts tests/multi-tenant-load.test.ts
LOAD_ROUNDS=12 TEST_DATABASE_URL=... npx vitest run tests/multi-tenant-load.test.ts   # mais carga
```

Cada bateria imprime um resumo (`[multiempresa] ...` e `[carga] ...`) com as contagens.

## Cenário

| Empresa | CNPJ (fictício) | Funcionários | Perfis |
|---|---|---|---|
| A: Alfa Armazéns Gerais (QA) | 11.444.777/0001-61 | 10 | 1 admin, 2 supervisores, 1 auditor, 6 operadores |
| B: Beta Logística Integrada (QA) | 22.333.444/0001-81 | 10 | idem |
| C: Gama Distribuidora (QA) | 33.444.555/0001-49 | 10 | idem |
| D: Delta Insumos Industriais (QA) | 44.555.666/0001-07 | 10 | idem |
| E: Épsilon Comércio Exterior (QA) | 55.666.777/0001-65 | 9 | 1 admin, 2 supervisores, 1 auditor, 5 operadores |
| **Total** | | **49** | |

Cada empresa tem:
- depósito `DEP-01` (A e B também têm `DEP-02`);
- zonas ARM, EXP, QUA e PRD;
- endereços `DEP-01/RUA-01/MOD-01..04/NIV-01..02/POS-00`, doca `DOC-01`, linha de produção;
- produtos `SKU-001..003` com os mesmos EAN, e um produto exclusivo `EXC-x`;
- fornecedor `FOR-001`, cliente `CLI-001`, `PC-0001`, `PV-0001`, `OP-0001`/`OP-0002`;
- saldo inicial de 500 unidades por SKU em dois endereços.

**Colisões propositais:** os códigos acima são iguais nas 5 empresas, e a mesma NF-e (mesma chave de acesso) foi importada em todas. Em cada empresa, um operador tem acesso restrito ao `DEP-01`.

Tudo foi criado pelos **serviços reais** (`createUser`, `createWarehouse`, `createZone`, `generateLocations`, `createDock`, `adjustStock`, `createManualReceipt`, `createManualOrder`, `reserveOrder`, `releaseForPicking`, `completeTask`, `checkOrder`, `shipOrder`, `createReturn`, `createTransfer`, `createInventory`, `createWave`, `createAppointment`, `processQueue`, `createRequisition`, `importNfe`, `addPackaging`, `updateSettings`). Os inserts diretos ficaram só para o que não tem serviço:
- a empresa e o 1º administrador;
- os cadastros mestres do ERP (produtos, fornecedor, cliente, pedidos de compra e venda, ordens de produção), que no produto chegam pela integração.

O cenário completo é montado em cerca de 5 s.

## O que foi testado

### Isolamento (`multi-tenant-isolation.test.ts`)

Para cada empresa X e cada outra empresa Y (**20 pares**), com usuários de X:

1. **Cobertura sistemática.** Um teste percorre `src/server/services/*.ts` e exige que todo export do tipo função esteja em uma de três listas:
   - leituras testadas;
   - escritas testadas;
   - exclusões justificadas: funções puras, auxiliares internas que só rodam após o registro pai ter sido validado, e o banco externo ATLAS.

   Se alguém criar um serviço novo sem cobri-lo aqui, o teste falha.
2. **Leituras.** São 126 chamadas por par: todas as `list*`/`get*`, os relatórios (`buildReport` e `exportReport` dos 10 relatórios), o dashboard, a curva ABC, a produtividade, as etiquetas, o coletor (`lookupCode`/`resolve*`), a auditoria, a outbox e os e-mails.
   - Os filtros recebem IDs de Y de propósito (depósito, produto, pedido, recebimento).
   - Os buscadores por ID recebem o ID do registro de Y.
   - O resultado é serializado e procurado por **todos os UUIDs de Y**, extraídos do catálogo, e por textos exclusivos de Y (nome, domínio de e-mail, descrições, transportadora).
3. **Códigos iguais.** Endereço, SKU e EAN iguais resolvem sempre para o registro da própria empresa.
4. **Agregados.** Após Y movimentar estoque (ajuste e transferência executada), o resultado de X fica byte a byte igual em: `getKpis`, `getKpiSeries`, `getFlowSeries`, `getTaskDistribution`, `getPerformance`, `getAlerts`, curva ABC, produtividade e totais de estoque.
5. **Escritas.** São 134 ataques por par, cobrindo:
   - produto, endereço, depósito, zona, doca, agendamento, embalagem, saldo e bloqueio;
   - recebimento, divergência, pedido, linha, tarefa, coletor, inventário e onda;
   - devolução, usuário, outbox, reposição, slotting, comex, produção e NF-e.

   Além dos ataques diretos, há **ataques mistos**: o ID de X junto com um ID de Y na mesma chamada (ex.: inventário de X filtrando zona de Y, item de produto de Y no inventário de X, transferência de X para endereço de Y, usuário de X com depósito de Y).

   Cada ataque precisa falhar com `DomainError`. Antes e depois dos ataques de cada par, uma **impressão digital** do conteúdo inteiro de Y é comparada: hash md5 de todas as linhas das 45 tabelas com `company_id` (descobertas no catálogo), das tabelas filhas via registro pai, e da linha da empresa.
6. **FKs cruzadas.** As 125 FKs entre tabelas com `company_id` são descobertas no `pg_constraint`. Nenhuma linha pode apontar para registro de outra empresa.
7. **Gatilho no banco.** `tenant_guard` recusa referência cruzada mesmo em SQL direto, fora dos serviços.
8. **Outbox e e-mail.**
   - `processQueue` de X processa só eventos de X; os de Y continuam pendentes.
   - O processador global (`/api/integracao/processar`) gera cada e-mail com os destinatários da empresa do evento.
   - Nenhum e-mail fica ligado a evento de outra empresa.
9. **Saúde do sistema.** A tela do administrador mostra só a fila da própria empresa.
10. **Rotas de API.**
    - `/api/relatorios/[report]` foi chamada com a sessão de cada X e filtros apontando para cada Y: 10 relatórios × 20 pares = 200 chamadas. Nenhum CSV contém dado de Y.
    - Operador e auditor recebem 403.
    - `/api/health` não expõe dados de empresa.
11. **ID malformado.** Um ID que não é UUID gera mensagem clara, e não "erro inesperado".

### Concorrência (`multi-tenant-load.test.ts`)

Os 49 funcionários trabalham ao mesmo tempo (`Promise.all`), por perfil:
- **Administrador:** ajustes de saída sobre o **mesmo saldo** que os operadores transferem (SKU-003 em MOD-01/NIV-01), e ajustes de entrada.
- **Supervisores:** os dois reservam e liberam para separação os **mesmos 4 pedidos**, em ordem inversa.
- **Operadores:**
  - transferências imediatas do mesmo saldo (a demanda é maior que o disponível);
  - todos tentam concluir as **mesmas tarefas** de armazenagem;
  - assumem pelo coletor e concluem as separações liberadas;
  - contam o mesmo inventário pelo coletor.
- **Auditor:** lê estoque e KPIs durante a carga.

Depois da fase concorrente, o fechamento:
1. conclui as tarefas que sobraram;
2. confere e expede os pedidos separados;
3. submete e aprova o inventário.

Invariantes verificadas:
- nenhum saldo negativo, e reservado + bloqueado ≤ físico;
- **Σ entradas − Σ saídas das movimentações = saldo**, por empresa, endereço, produto e lote;
- reserva por linha ≤ quantidade pedida;
- reservado de cada saldo de armazenagem = soma das reservas ativas (pedidos + produção);
- nenhuma reserva duplicada por linha e saldo;
- nenhuma tarefa concluída duas vezes, nem por evento nem por movimentação;
- nenhuma FK, movimentação, auditoria ou evento de tarefa feito por usuário de outra empresa;
- todo erro é `DomainError` com mensagem: nenhum erro inesperado, deadlock ou violação de CHECK chegou ao usuário.

## Números

| Verificação | Quantidade |
|---|---|
| Pares empresa X → empresa Y | 20 |
| Leituras verificadas contra vazamento | 2.520, das quais 1.540 com filtro ou ID de Y |
| Ataques de escrita (diretos e mistos) | 2.680, todos recusados |
| Impressões digitais de Y comparadas (45 tabelas com `company_id`, 7 filhas e a empresa) | 20 |
| FKs verificadas para referência cruzada | 125 |
| Chamadas às rotas de API | 203 |
| Gatilhos `tenant_guard` instalados | 39 tabelas |
| Tempo da bateria de isolamento | ≈ 16–24 s (PGlite) e ≈ 11 s (PostgreSQL 16) |

| Concorrência | PGlite | PostgreSQL 16 (pool 25) | PostgreSQL, `LOAD_ROUNDS=12` (3 execuções) |
|---|---|---|---|
| Operações | 1.183 | 1.117 | ≈ 1.940 |
| Sucesso | 489 | 489 | ≈ 752 |
| Recusas de negócio esperadas | 694 | 628 | ≈ 1.190 |
| Detalhe das recusas | TASK_CLOSED 434, TASK_ASSIGNED 96, INSUFFICIENT_STOCK 124, INVALID_STATUS 40 | TASK_CLOSED 425, TASK_ASSIGNED 39, INSUFFICIENT_STOCK 124, INVALID_STATUS 40 | INSUFFICIENT_STOCK ≈ 330 |
| Erros inesperados | 0 | 0 | 0 |
| Tempo da fase concorrente | ≈ 5 s | ≈ 1,2 s | ≈ 1,5 s |

As recusas são o comportamento correto:
- tarefa já concluída ou assumida por outro operador;
- saldo insuficiente na disputa;
- pedido já reservado ou liberado pelo outro supervisor.

`npm run check`: 30 arquivos, 223 testes, todos verdes. `WMS_DEMO_MODE=true npm run build`: verde.

## Falhas encontradas e corrigidas

Todas foram reproduzidas pela bateria antes da correção. Os testes falharam com a impressão digital ou a verificação de FKs acusando a referência cruzada, e passaram depois.

| # | Falha | Gravidade | Correção |
|---|---|---|---|
| 1 | `createInventory` aceitava `zoneId`, `locationId` ou `productId` de **outra empresa**. O inventário e a tarefa de contagem de X ficavam apontando para zona, endereço ou produto de Y, e a tela do inventário de X passava a exibir dados cadastrais de Y. | Alta (vazamento de cadastro + dado inconsistente) | Valida empresa e depósito de cada filtro (`NotFoundError`). |
| 2 | `addInventoryItem` aceitava `productId` de outra empresa. O item de contagem de X apontava para produto de Y, e a aprovação geraria ajuste de estoque de X com produto de Y. | Alta | Valida o produto na empresa. |
| 3 | `updateProductSettings` aceitava `preferredZoneId` de outra empresa. A sugestão de endereço de X passaria a considerar zona de Y. | Média | Valida a zona na empresa. |
| 4 | `runReplenishmentCheck` aceitava depósito de outra empresa e respondia sucesso (sem efeito). | Baixa | Recusa com "Depósito não encontrado". |
| 5 | **Saúde do sistema** (tela do administrador): contagem da fila de integração (pendentes, falhas, evento mais antigo) e status "degradado" eram calculados com eventos de **todas** as empresas. | Média (vazamento de métrica operacional) | `getSystemHealth` filtra pela empresa do usuário. A rota pública `/api/health` continua agregada e sem dado de empresa, por design. |
| 6 | ID malformado (ex.: código `TAR-000001` no lugar do UUID) virava "Erro inesperado". | Baixa | Código Postgres `22P02` mapeado para "Registro não encontrado: identificador inválido." |
| 7 | Nenhuma proteção no banco contra referência cruzada: qualquer checagem esquecida em serviço gravava dado misturado. | Estrutural | Migration `20261115000040_tenant_consistency.sql`. O gatilho genérico `tenant_guard` é instalado a partir do catálogo em 39 tabelas e recusa (P0001) qualquer FK de coluna única cujo registro pai seja de outra empresa. Só verifica quando a FK ou o `company_id` muda. |

Nenhuma regra de negócio foi alterada além dessas checagens.

## Banco: o RLS está ativo para a aplicação?

**Não, e não foi ativado.** O diagnóstico, conferido no PostgreSQL 16:
- As 59 tabelas erp/wms têm `ENABLE ROW LEVEL SECURITY`, mas nenhuma tem `FORCE`. A aplicação conecta (`DATABASE_URL`) com o papel **dono das tabelas**, e o dono ignora o RLS.
- As políticas de `20261009000003_rls_policies.sql` só são criadas quando existe o schema `auth` (Supabase). Elas cobrem apenas `SELECT`, para o papel `authenticated`, e dependem de `auth.uid()`. Fora do Supabase há **0 políticas**.
- Não existe `wms.current_company_id` definido por transação: a função `wms.current_company_id()` lê `auth.uid()`.

### Por que não ativar agora

Seria uma mudança arriscada demais para fazer sem uma frente própria:
1. **122 leituras** dos serviços usam `ctx.db.query` fora de transação. Para o RLS valer, todas precisariam passar por um invólucro que abra transação com `SET LOCAL ROLE` e `set_config('wms.company_id', …, true)`. Isso dobra as idas ao banco em cada leitura, e no pool do `pg` exige muito cuidado para o papel não "vazar" entre requisições.
2. Há caminhos **legitimamente multiempresa**, que precisariam de um segundo pool ou papel com `BYPASSRLS`:
   - login (busca o usuário por e-mail antes de saber a empresa);
   - sessão (`loadSessionUser`);
   - processador global da outbox (cron);
   - `/api/health`;
   - o seed;
   - as migrations.
3. Seriam necessárias políticas de **escrita** (`INSERT`/`UPDATE`/`DELETE`) em 59 tabelas, além das tabelas filhas sem `company_id` via registro pai. As de hoje são só de leitura, e um erro nelas derruba operações.
4. No Supabase, o usuário de `DATABASE_URL` é `postgres` (dono). Trocar de papel exige `GRANT` ao papel da aplicação, o que depende da configuração de cada instalação.

### O que foi feito no lugar

- A proteção no banco **contra escrita cruzada** (`tenant_guard`), que vale para qualquer papel, inclusive o dono.
- A bateria de isolamento cobrindo todos os serviços.

### O que faltaria para ativar o RLS

1. Criar o papel `orion_app` (sem `BYPASSRLS`, não dono) com `GRANT` de DML.
2. Criar políticas `using/with check (company_id = current_setting('wms.company_id')::uuid)` em todas as tabelas, e via pai nas filhas.
3. Fazer um `Db` com escopo de empresa, criado em `requireCtx`, que execute toda consulta em transação com `SET LOCAL ROLE orion_app` + `set_config`.
4. Manter um `Db` "sistema" separado para login, cron, health e seed.
5. Rodar estas duas baterias com `TEST_DATABASE_URL` para validar. Elas já servem como critério de aceite.

## O que NÃO está coberto e riscos residuais

### Fora do escopo desta bateria

- **Server Actions** (`src/server/actions/*`) não são chamadas diretamente: elas só repassam IDs do formulário aos serviços, que são o ponto de controle testado. A sessão (cookie assinado) não foi atacada aqui; ela é coberta por `tests/auth.test.ts`.
- **Páginas** (`src/app/(app)/**`) não foram renderizadas: elas leem pelos mesmos serviços. Uma página que faça SQL próprio escaparia da bateria. Por busca, só `login/page.tsx` usa `getDb()` direto, para listar os usuários de demonstração.
- **ATLAS** (banco externo de empresas) e os **transportes reais** (HTTP do ERP e do e-mail) não fazem parte do teste. O roteamento por empresa foi testado com os transportes locais (`local`/`log`).
- O cenário **não tem números de série nem retenção de qualidade**. Os serviços de série foram tratados como internos.

### Limites do que foi verificado

- **Concorrência no PGlite** não é paralela: há uma conexão só, e as transações se intercalam por operação. A prova de concorrência real é a execução com `TEST_DATABASE_URL`, feita nesta entrega contra PostgreSQL 16 local (pool de 25 conexões, 4 execuções, 0 falhas). Ela **não roda no `npm run check`/CI** sem um Postgres configurado.
- O driver `pg` **refaz automaticamente** a transação em deadlock ou falha de serialização (até 3 tentativas). Por isso a bateria só prova que nenhum deadlock *chegou ao usuário*, não que não houve nenhum.
- A carga é de 49 usuários simultâneos com cerca de 1.100 a 1.900 operações. Não é teste de desempenho nem de volume (milhares de usuários, milhões de linhas).

### Pontos que dependem de cuidado futuro

- O gatilho `tenant_guard` não cobre tabelas filhas **sem** `company_id` (ex.: `inventory_count_items`, `receipt_items`, `outbound_order_lines`). Nelas a proteção é só do serviço; a falha #2 escaparia do gatilho.
- Tabelas criadas em migrations futuras só ganham o gatilho se a migration chamar `select wms.install_tenant_guards();`.
- O e-mail é único no sistema todo (login global): `createUser` em X com um e-mail já usado em Y responde "já cadastrado", o que revela que o e-mail existe em alguma empresa. É inerente ao login por e-mail.

## Veredito

Com as correções desta entrega, o comportamento ficou assim:
- **Nas 2.520 leituras, 2.680 tentativas de escrita (diretas e mistas) e 200 exportações por API desta bateria, nenhuma empresa viu nem alterou dado de outra.**
- O sistema manteve saldo, reservas e tarefas consistentes com 49 funcionários simultâneos, também em PostgreSQL real.

A bateria **encontrou 5 falhas reais de isolamento** (4 parâmetros opcionais com ID de outra empresa e 1 métrica agregada de todas as empresas), todas corrigidas. Isso mostra que o isolamento dependia só da disciplina de cada serviço.

O gatilho no banco reduz o risco de regressão nas escritas, mas **as leituras continuam protegidas só pelo código da aplicação**, porque o RLS não está ativo para a conexão do servidor.

Para operar com várias empresas reais no mesmo banco, recomendo:
1. manter estas baterias no CI, com um Postgres de teste;
2. ativar o RLS em uma frente dedicada, conforme o plano acima.
