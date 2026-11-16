# QA da integração ATLAS.ERP ↔ ORION.WMS — teste real ponta a ponta

Data: 2026-11-16 · Contrato: `docs/INTEGRACAO-ATLAS-ORION.md` (revisão 2026-11-16) · Este arquivo é idêntico nos dois repositórios.

Branches: ATLAS `claude/integracao-orion` (repo `educa.erp`), ORION `claude/wms-erp-mvp-io9q47` (repo `ORION.WMS`).

## Veredito

**Integração aprovada para homologação**, com as ressalvas de "Pendências". No teste real os dois sistemas rodaram como build de produção (`next build` + `next start`), cada um com seu banco PostgreSQL 16, conversando **somente por HTTP** (vínculo, eventos nos dois sentidos, SSO ES256 com JWKS, checagem de acesso). Resultado da última execução: **50/50 verificações OK**, depois de corrigir os 4 defeitos listados abaixo (todos com teste automatizado). O teste não cobre SEFAZ, Vercel Cron real nem HTTPS/domínios públicos.

## Ambiente

| Peça | Como rodou |
|---|---|
| PostgreSQL 16 local (porta 55440) | banco `atlas_e2e` (migrations do ATLAS, mesmo plano dos testes PGlite: produção equivalente + 0126–0128, papel dono `neondb_owner`) e banco `orion_e2e` (`npm run db:migrate` do ORION) |
| ATLAS | `next start -p 3000`, `DATA_BACKEND=postgres`, `AUTH_PROVIDER=neon`, `APP_URL=http://localhost:3000` |
| Login do ATLAS | **harness** `scripts/qa-integracao/neon-auth-stub.mjs` (ATLAS): servidor local com o protocolo do Neon Auth (`/sign-in/email`, `/get-session` com JWT EdDSA em `set-auth-jwt`, JWKS). O código de produção não muda — só `NEON_AUTH_BASE_URL` aponta para ele; a ponte de identidade (`auth_identity_links`, verificação EdDSA/iss/aud) é a real. Supabase Auth hospedado não foi usado (sem rede externa). |
| ORION | `next start -p 3100`, `DATABASE_URL=orion_e2e`, `WMS_AUTO_SEED=false`, `ATLAS_URL=http://localhost:3000`, `ORION_ATLAS_ACCESS_CHECK_SECONDS=20` (para ver a checagem em segundos) |
| Chaves | ES256 por `scripts/orion-sso-keygen.mjs`; credencial de instalação, `INTEGRATION_ENCRYPTION_KEY`/`ATLAS_INTEGRATION_ENCRYPTION_KEY` e `CRON_SECRET` aleatórios gerados por `scripts/qa-integracao/gerar-env.sh` |
| Navegador | Playwright + Chromium (`/opt/pw-browsers`), `deviceScaleFactor: 1`, 1366×860 |
| Mesmo site | `localhost:3000` e `localhost:3100` são o mesmo site para cookies — equivale a `atlas.dominio`/`orion.dominio` (contrato 2.5) |

Quem faz o quê no roteiro:
- **Pessoas no ATLAS**: login pela tela real e chamadas às APIs do ATLAS com a sessão de cada uma (admin central Paula, admin da empresa Ana, Sergio e Olga).
- **SSO**: botão "Abrir ORION" (fluxo A) e "Entrar com ATLAS" na tela de login do ORION (fluxo B), no navegador.
- **Operadores no ORION**: `scripts/qa-operador.ts` (ORION) executa separação, conferência, expedição, recebimento, abastecimento e ajuste pelos **mesmos serviços das telas**, como o usuário provisionado pelo SSO. Isso é ação interna do ORION; tudo que vai ao ATLAS sai pela outbox do servidor ORION, por HTTP.
- **Crons**: o roteiro chama os endpoints reais `POST /api/integrations/orion/v1/outbox/process` (ATLAS) e `POST /api/integracao/processar` e `POST /api/atlas/cron/snapshot` (ORION) com `Authorization: Bearer CRON_SECRET`, como o Vercel Cron faria.
- **NF-e**: não há SEFAZ; o roteiro grava a NF-e e a marca `AUTHORIZED` no banco do ATLAS (o que o retorno do autorizador faz). O gatilho real do ATLAS gera `sales_invoice.authorized`.
- **Cancelamento de linha no ATLAS**: não há tela/rota para cancelar uma linha de pedido; o roteiro atualiza `sales_order_items.cancelled_quantity` (o gatilho real gera `sales_order.line_cancelled`).

## Como reproduzir

Pré-requisitos: os dois repositórios lado a lado (`educa.erp` e `ORION.WMS`), `npm install` nos dois, PostgreSQL 16 em `127.0.0.1:55440` com papel `postgres` e o script de montagem de banco do ATLAS (`QA_BUILD_DB`, padrão `/tmp/claude-0/build.sh`, que aplica um plano de migrations como `neondb_owner`), Playwright com Chromium.

```bash
cd educa.erp
QA_DIR=/caminho/qa QA_BUILD=1 bash scripts/qa-integracao/rodar.sh   # recria bancos, gera .env, compila, sobe, roda, derruba
# QA_KEEP=1 mantém os servidores no ar; QA_STEPS=s1,s2 roda só alguns passos
```

Arquivos: ATLAS `scripts/qa-integracao/{rodar.sh,servidores.sh,gerar-env.sh,seed-atlas.mjs,neon-auth-stub.mjs,lib.mjs,roteiro.mjs}`; ORION `scripts/qa-operador.ts`. Saída: `resultado.json`, `execucao.log` e capturas em `<QA_DIR>/shots/`.

## Resultado por passo (última execução)

| # | Verificação (cada uma confere os dois bancos) | Resultado |
|---|---|---|
| 1.1 | admin central contrata o módulo ORION | OK |
| 1.2 | admin da empresa habilita o módulo | OK |
| 1.3 | vínculo real POST /links (credencial de instalação) | OK |
| 1.3a | ORION: erp.companies source=atlas + atlas_links | OK |
| 1.4 | mapa de depósitos PRINCIPAL ↔ DEP-01 | OK |
| 1.5 | acesso ORION da admin da empresa (perfil admin) | OK |
| 1.6 | cadastros chegam ao ORION (produtos source=atlas) | OK |
| 1.6a | clientes e fornecedores sincronizados | OK |
| 1.6b | SKU do ATLAS ≠ code vira código alternativo (ALT-200) | OK |
| 1.6c | depósito DEP-01 criado/mapeado no ORION | OK |
| 1.6d | outbox do ATLAS entregue (sem pendências) | OK |
| 1.7 | SSO (Abrir ORION) da admin: usuário JIT perfil admin, sem senha local | OK |
| 1.8 | admin prepara zonas/endereços no ORION (REC, ARM, EXP, PRD) | OK |
| 1.9 | carga inicial de estoque enviada | OK |
| 1.10 | ORION: saldo no recebimento (P-100 lote L2611-A val. 2027-06-30 =120; P-200 =300; MP-01 =50) | OK |
| 1.11 | ORION: tarefas de armazenagem da carga inicial | OK |
| 1.12 | ATLAS: conciliação da carga zerada ⇒ integração ativa | OK |
| 1.13 | equipe armazena (tarefas concluídas) | OK |
| 2.1 | libera Sergio (supervisor, DEP-01) | OK |
| 2.2 | libera Olga (operadora) | OK |
| 2.3 | JIT: Sergio supervisor (depósito DEP-01) e Olga operadora | OK |
| 2.4 | auditoria auth.sso_login no ORION | OK |
| 2.5 | revoga Olga no ATLAS | OK |
| 2.6 | evento user_access.revoked: Olga inativa no ORION | OK |
| 2.7 | sessão da Olga cai na próxima requisição | OK |
| 2.8 | checagem GET /access (sem entregar evento): Sergio derrubado | OK |
| 3.1 | venda aprovada no ATLAS ⇒ enfileirada (wms_status queued/sent) | OK |
| 3.2 | pedido chega sozinho ao ORION e outbound.accepted volta | OK |
| 3.3 | separação e conferência no ORION | OK |
| 3.4 | ATLAS: ready_to_invoice (status ready_to_ship) | OK |
| 3.5 | ORION bloqueia expedição antes da NF-e | OK |
| 3.6 | NF-e autorizada no ATLAS ⇒ sales_invoice.authorized registrada no ORION | OK |
| 3.7 | expedição no ORION | OK |
| 3.8 | ATLAS: pedido shipped e estoque fiscal baixado (P-100 −20, P-200 −50) | OK |
| 3.9 | físico ORION = fiscal ATLAS | OK |
| 4.1 | compra liberada ⇒ recebimento previsto no ORION | OK |
| 4.2 | recebido, conferido e armazenado no ORION | OK |
| 4.3 | ATLAS: entrada no estoque fiscal (+100) e pedido recebido | OK |
| 4.5 | OP liberada ⇒ requisição de abastecimento no ORION | OK |
| 4.6 | abastecimento da linha no ORION | OK |
| 4.7 | ATLAS: baixa do material (MP-01 −20) e OP em andamento | OK |
| 5.1 | ajuste de inventário no ORION (−5 P-200) | OK |
| 5.2 | ajuste refletido no estoque fiscal do ATLAS | OK |
| 5.3 | ATLAS recusa movimento físico manual (ESTOQUE_GERENCIADO_PELO_ORION) | OK |
| 5.4 | snapshot diário ⇒ reconciliação sem diferenças | OK |
| 6.1 | ORION fora do ar: envio falha e fica pendente com backoff | OK |
| 6.2 | ao voltar, reenvio com backoff entrega uma única vez | OK |
| 6.3 | ATLAS→ORION: repetida 200 duplicate, fora de ordem 409, assinatura 401, timestamp velho 401 | OK |
| 6.4 | ORION→ATLAS: repetida 200, fora de ordem 409, assinatura 401, timestamp velho 401 | OK |
| 6.5 | linha cancelada no ATLAS: ORION cancela e ecoa origin=atlas; ATLAS mantém 10 (sem dobrar) | OK |

Capturas (`shots/`): 01 admin central ORION · 02 produtos ATLAS somente leitura no ORION · 03 estoque após carga inicial · 04 integração no admin da empresa · 05 acessos · 06 Sergio pelo "Abrir ORION" · 07 Olga pelo "Entrar com ATLAS" · 08 Olga revogada (login) · 09 pedido de venda expedido pelo ORION (painel Armazém) · 10 expedição no ORION · 11 pedidos de compra · 12 movimentações "Gerenciado pelo ORION" · 13 reconciliação · 14 linha cancelada sem contagem dupla · 15 painel de integração do ORION.

## Defeitos encontrados no teste real e corrigidos

| # | Defeito | Correção | Teste |
|---|---|---|---|
| 1 | ATLAS negava SSO/checagem com a integração em `activating`: ninguém conseguia entrar no ORION para criar zonas/endereços, e a carga inicial exige endereço de recebimento | `fn_orion_access_status` aceita `activating` (0128); contrato 2.3 | `tests/orion-db.test.ts` (acesso em ativação) |
| 2 | ATLAS recusava `outbound.ready_to_invoice` e `receipt.completed` de produto sem lote (`lot_code: null`) com 400 — pedido parado em "picking", recebimento sem entrada fiscal | `lot_code` anulável nos schemas de entrada; contrato 3.6 | `tests/orion-db.test.ts` (lote nulo) |
| 3 | Reentrega legítima do mesmo evento pelo ORION virava `idempotency_conflict` no ATLAS (hash do envelope inteiro) | hash só do conteúdo (`type`, `version`, `aggregate`, `payload`) em `fn_orion_receive_event` (0128); contrato 3.5 | `tests/orion-db.test.ts` (reentrega) |
| 4 | Harness: segredo JWK no `.env` sem aspas perdia as aspas do JSON ao ser carregado pelo shell (JWKS vazio) | `gerar-env.sh` grava entre aspas simples | execução do roteiro |

Divergências de contrato resolvidas antes do teste (Parte A, ver "Revisões" no contrato): corpo/resposta de `POST /links` (fixtures `s2s.links.*`); `/events/batch` sem `:` (alias no ORION; receptor também no ATLAS); regra de sequência do primeiro evento; `purchase_order_status`; `origin`/`atlas_event_id` no cancelamento; SKU alternativo e validade de lote na carga inicial; FK real de `orion_user_access`; cookie SameSite; usuário de sistema e `wms_status = 'failed'`.

## Pendências

- **NF-e real**: autorização simulada no banco; falta o teste com o autorizador (homologação SEFAZ).
- **Cancelamento de linha pelo ATLAS** não tem tela/rota; hoje só por dado direto ou pela API de itens (o gatilho funciona).
- **Envio em lote** (`/events/batch`) existe nos dois receptores, mas os processadores de outbox enviam um a um (opcional pelo contrato).
- **Supabase Auth**: o ATLAS rodou com Neon Auth simulado localmente; o caminho Supabase não foi exercitado neste teste.
- **Domínios/HTTPS**: rodado em `localhost` (mesmo site). Domínios registráveis diferentes exigem `ORION_SSO_STATE_SAMESITE=none` + HTTPS, não testado aqui.
- Operações internas do ORION foram executadas pelos serviços (script de operador), não clicando nas telas do coletor.
