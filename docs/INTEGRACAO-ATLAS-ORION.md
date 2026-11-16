# Contrato de integração ATLAS.ERP ↔ ORION.WMS (ecossistema ASTRAEUS)

Versão do contrato: **1** (revisão 2026-11-16, alinhamento pós-implementação — ver "Revisões" no fim) · Data: 2026-11-15 · Situação: **implementado nos dois lados** (branch ATLAS `claude/integracao-orion`, ORION `claude/wms-erp-mvp-io9q47`); teste real ponta a ponta em `docs/QA-INTEGRACAO.md`.

Este arquivo é idêntico nos dois repositórios:

- ATLAS.ERP: `docs/INTEGRACAO-ATLAS-ORION.md` (repo `educa.erp`, Next 16, Supabase/Postgres via `pg`, testes `node --test`)
- ORION.WMS: `docs/INTEGRACAO-ATLAS-ORION.md` (repo `ORION.WMS`, Next 16, Postgres/PGlite, Vitest)

As mensagens de exemplo (fixtures de contrato) ficam em `docs/contrato/*.json`, também idênticas nos dois repositórios. Qualquer mudança no contrato muda **as duas cópias no mesmo dia** e os testes de contrato dos dois lados (seção 7.4).

---

## 0. Decisões do produto (já tomadas)

1. O **admin central do ATLAS** (`/app/admincentral`) autoriza **empresas** a usar o módulo ORION. O **admin da empresa** no ATLAS (`/app/admin`) autoriza **funcionários** e escolhe o **perfil ORION** (`admin`, `supervisor`, `operator`, `auditor`).
2. **Login único**: o funcionário entra no ORION com a conta do ATLAS. O ORION provisiona o usuário no primeiro acesso (JIT) na empresa certa. Revogar no ATLAS derruba o acesso no ORION (checagem periódica + evento).
3. Pedido de venda vai **automaticamente** ao ORION ao atingir uma etapa configurável (padrão: `approved`), com botão manual **"Enviar ao armazém / Reenviar"**; idempotente. Pedido de compra vira recebimento previsto. Ordem de produção vira requisição de abastecimento.
4. Empresa com ORION ⇒ **ORION é dono do estoque físico** (endereço, lote, validade, reservas). O ATLAS mantém o **estoque fiscal/financeiro** atualizado pelos eventos do ORION. Para essas empresas, guardar/movimentar estoque físico no ATLAS fica desativado ("Gerenciado pelo ORION"). Empresas sem ORION continuam como hoje.
5. Cadastros mestres (empresa, produtos, clientes, fornecedores, unidades) nascem no ATLAS e são sincronizados para o ORION; no ORION, registros vinculados ficam **somente leitura** nos campos mestres.

---

## 1. Inventário do que existe hoje

### 1.1 ATLAS.ERP (`/home/user/educa.erp`, base `origin/main` 1bb6e7e)

| Assunto | O que existe (nomes reais) |
|---|---|
| Autenticação | Supabase Auth (padrão) ou Neon Auth (`AUTH_PROVIDER=neon`), escolhido em `src/lib/auth/provider.ts`. Ponte Neon→Postgres em `src/lib/auth/neon-bridge.ts` já usa **`jose`** (`SignJWT`, `jwtVerify`, JWKS). Sessão: `src/lib/auth/session.ts`; contexto/permissões: `src/lib/auth/context.ts` (`getAuthContext`, `hasPermission`, `hasPlatformPermission`). Rotas: `src/app/api/auth/{sign-in,session,logout,password}`. Vínculo de identidade externa: `public.auth_identity_links` (0073). |
| Dados | `DATA_BACKEND=supabase` (PostgREST) ou `postgres` (pg direto, `src/lib/database/pg`). Toda tabela de `public` tem RLS com helpers `has_permission`, `current_user_company_ids`, `current_app_user_id`. |
| Empresas / tenant | `public.companies` (0001: id, name, legal_name, document, email, phone, address, city, state, zip_code, status, updated_at). Ciclo de vida SaaS: `public.company_platform_profiles` (TRIAL/ACTIVE/SUSPENDED/CANCELLED). |
| Admin central (plataforma) | Telas `src/app/app/admincentral/{companies,modules,permissions,platform-members,audit,settings}`. API `src/app/api/platform/{companies,companies/[id]/modules,modules,permissions,overview}`. Catálogo `public.platform_modules` (códigos `core`, `cadastros`, `estoque`, `compras`, `comercial`, `logistica`, `producao`, `fiscal`, `custos`, …) e habilitação `public.company_modules` (`contracted` = plataforma, `enabled_by_company` = admin da empresa; acesso exige os dois). Membros: `public.platform_members`. |
| Admin da empresa | Telas `src/app/app/admin/{users,roles,modules,groups,departments,positions,branches,settings,audit}`; API `src/app/api/admin/*`. Usuários: `public.users` (id, company_id, code, auth_user_id, name, email, login, status), `public.user_companies`, `public.user_roles`, `public.roles`, `public.permissions`, `public.role_permissions`; convites `public.user_invitations`. |
| Cadastros | `public.products` (code, sku, barcode, name, unit, ncm, weight, dimensões, `batch_controlled`, `expiration_controlled`, status), `public.units` (+ `base_unit_id`, 0049), `public.customers`, `public.suppliers`, endereços/contatos (0051), `public.product_lots`, `public.product_serial_numbers`. |
| Pedido de venda | `public.sales_orders` / `sales_order_items`. Status (0022): `draft → pending_approval → approved → reservation_pending → reserved → picking → ready_to_ship → partially_shipped → shipped → completed`, `cancelled`. Funções: `fn_submit_sales_order_for_approval`, `fn_approve_sales_order`, `fn_reserve_sales_order_stock`, `fn_cancel_sales_order`. Rotas `src/app/api/sales-orders/[id]/{submit,approve,reserve,release-reservation,pick-lists,pick-auto,shipments,ship-auto,cancel,generate-fiscal-document,generate-receivable}`. Separação `public.pick_lists` (0023), expedição `public.shipments` (0024, `fn_ship_shipment`). |
| Pedido de compra | `public.purchase_orders` / `purchase_order_items`. Status: `draft, pending_approval, approved, sent, partially_received, received, closed, cancelled`. Funções `fn_approve_purchase_order`, `fn_send_purchase_order`, `fn_cancel_purchase_order`, `fn_close_purchase_order`. Recebimento `public.purchase_receipts` (0018, `fn_create_purchase_receipt`, `fn_confirm_purchase_receipt` — com custo em 0044), NF de entrada (0116/0119). |
| Estoque | `public.warehouses` (0008), `public.warehouse_locations` (endereçamento: tela `/app/logistica/enderecamento`), `public.stock_balances` (grão empresa+produto+local+lote), `public.stock_movements`, `fn_post_stock_movement(… p_idempotency_key …)`, `fn_receive_stock`, `fn_issue_stock` (0009), transferências `public.stock_transfers` (0010), reservas `public.stock_reservations` (0011), ajustes/contagens `stock_adjustments`, `stock_counts` (0012), requisições `material_requests` (0013). Telas `/app/logistica/{estoque,movimentacoes,transferencias,inventario,enderecamento,recebimento,picking,packing,expedicao,devolucoes,almoxarifado}`. |
| Produção / MRP | `public.production_orders` (status `draft, planned, released, materials_reserved, in_progress, completed, cancelled, on_hold`), `production_order_materials`; funções `fn_plan/release/start/hold/resume/cancel_production_order`, `fn_consume_production_material`, `fn_return_production_material`, `fn_register_production_output`, `fn_complete_production_order` (0123 faz **baixa automática de materiais** — backflush). MRP em `src/app/api/mrp`. |
| Custos | `public.cost_movements`, `product_cost_balances` (custo médio), integrações de custo em 0044 dentro de `fn_confirm_purchase_receipt`, `fn_ship_shipment`, `fn_post_adjustment`, `fn_register_production_output` etc. |
| Fiscal | `public.fiscal_documents`, `fiscal_document_items`, `fiscal_document_events` (0039–0042, 0063), rotas `src/app/api/fiscal-*` e `sales-orders/[id]/generate-fiscal-document`. |
| Outbox/webhook | **Não existe.** Nada de `outbox`/`webhook` no repo. |

### 1.2 ORION.WMS (`/home/user/ORION.WMS`, branch `claude/wms-erp-mvp-io9q47`)

| Assunto | O que existe |
|---|---|
| Fronteira ERP | Schema `erp` local: `erp.companies` (com `source in ('local','atlas')`, `external_id`, `synced_at` — migration `20261114000005_integration.sql`; índice único `companies_atlas_external_uniq`), `erp.products`, `erp.customers`, `erp.suppliers`, `erp.purchase_orders(_items)`, `erp.sales_orders(_items)`, `erp.production_orders`, `erp.production_order_components`. Acesso via `src/server/integrations/erp/gateway.ts`. |
| Conector ATLAS | `src/server/integrations/atlas/connector.ts`: leitura **somente** de `public.companies` do ATLAS por `ATLAS_DATABASE_URL` em transação READ ONLY. Será **substituído** pela API desta especificação (acesso direto ao banco do ATLAS deixa de ser necessário). |
| Usuários e sessão | `wms.users` (company_id, `auth_user_id` unique, name, **email unique global**, role `admin/supervisor/operator/auditor`, password_hash, active), `wms.user_warehouses`. Sessão por cookie `orion_session` HMAC (`src/server/auth/token.ts`, `session.ts`); `getLoggedUser` **relê o usuário do banco a cada requisição** (inativar tem efeito imediato). Permissões `src/lib/permissions.ts`. |
| Outbox | `wms.integration_events` (gravada na mesma transação por `enqueueIntegrationEvent` em `src/server/services/common.ts`), processador `src/server/integrations/outbox/processor.ts` (retentativa/backoff, descarte manual em `services/integration.ts`), transporte HTTP `outbox/transports.ts`: POST JSON para `ERP_WEBHOOK_URL`, cabeçalhos `X-Orion-Event-Id`, `Idempotency-Key`, `X-Orion-Timestamp`, `X-Orion-Signature: sha256=HMAC(ERP_WEBHOOK_SECRET, "${timestamp}.${corpo}")`. Disparo: `POST /api/integracao/processar`. Painel: `/integracao`, saúde `/saude`. |
| Eventos emitidos hoje | `receipt.completed`, `outbound.shipped`, `outbound.cancelled`, `outbound.line_cancelled`, `customer_return.completed`, `inventory.approved`, `divergence.registered`, `dock.appointment_created`, `import.cleared`, `export.packed`, `production.materials_delivered`, `production.leftovers_returned`, `production.output_received`. Payloads hoje identificam produto por `sku` e não carregam ids do ATLAS (ajuste na seção 3.6). |
| Saldo | Só muda por `src/server/services/stock-core.ts`; histórico imutável em `wms.stock_movements`. |
| Multiempresa | RLS (`20261009000003_rls_policies.sql`) + gatilho `tenant_guard` (`20261115000040_tenant_consistency.sql`); bateria `tests/multi-tenant-*.test.ts` (ver `docs/QA-MULTIEMPRESA.md`). |
| Idempotência de entrada | `wms.idempotency_keys` via `runOperation` (`services/common.ts`). |
| Dependências | **Não tem `jose`** (será adicionada). |

---

## 2. Identidade e SSO

### 2.1 Protocolo escolhido

**JWT de lançamento (launch token) assinado pelo ATLAS, curto (60 s), uso único, entregue ao ORION por `form_post`**, verificado pelo ORION com a chave pública publicada em **JWKS**. Biblioteca: `jose` nos dois lados (o ATLAS já usa).

Por que não OIDC completo: o ATLAS não é (e não precisa virar) um provedor OIDC com `/authorize` + `/token` + consentimento; ele já delega a autenticação a Supabase/Neon Auth. O que o ORION precisa é uma **asserção assinada** "esta pessoa, desta empresa, com este perfil ORION, agora". O desenho abaixo tem as mesmas propriedades de segurança do *authorization code + PKCE* para este caso (token curto, de uso único, com audiência, fora da URL, ligado a um `state` quando o fluxo começa no ORION) com uma fração do código. Se o ecossistema crescer (TMS), o mesmo par de chaves e JWKS servem de base para evoluir para OIDC sem trocar claims.

- Algoritmo: **ES256** (P-256). Proibido `none`/HS*. O ORION aceita **apenas** `alg: ES256` e `kid` presente no JWKS.
- Chave privada: só no ATLAS, variável `ATLAS_SSO_PRIVATE_JWK` (JWK com `kid`). Chaves públicas anteriores (rotação): `ATLAS_SSO_PREVIOUS_PUBLIC_JWKS` (JSON com `keys`).
- JWKS público: `GET {ATLAS_URL}/.well-known/astraeus-jwks.json` (rota `src/app/.well-known/astraeus-jwks.json/route.ts`), `Cache-Control: public, max-age=300`. Exemplo: `docs/contrato/sso.jwks.json`.
- ORION: `ATLAS_URL`, `ATLAS_SSO_ISSUER` (= `ATLAS_URL`), `ATLAS_JWKS_URL` (padrão `${ATLAS_URL}/.well-known/astraeus-jwks.json`), audiência fixa `orion-wms`. Usa `createRemoteJWKSet` (cache + refetch quando aparece `kid` desconhecido).

### 2.2 Claims do launch token (`docs/contrato/sso.launch-token.claims.json`)

| Claim | Tipo | Regra |
|---|---|---|
| `iss` | string | URL do ATLAS (`APP_URL`). ORION exige igualdade exata com `ATLAS_SSO_ISSUER`. |
| `aud` | string | `"orion-wms"`. |
| `sub` | uuid | `public.users.id` do ATLAS (**atlas_user_id**, não o `auth_user_id` do provedor — estável se o provedor de login mudar). |
| `atlas_company_id` | uuid | `public.companies.id` da empresa ativa da sessão do ATLAS. |
| `orion_company_id` | uuid | `erp.companies.id` no ORION, gravado no ATLAS na ativação. ORION confere que bate com `external_id`. |
| `email`, `name` | string | Do `public.users`. Usados no provisionamento e atualizados a cada login. |
| `orion_role` | enum | `admin` \| `supervisor` \| `operator` \| `auditor`. O ATLAS é a fonte do perfil. |
| `access_version` | int | Versão do acesso (`orion_user_access.version`). ORION grava e compara na checagem. |
| `warehouses` | string[] | Opcional. Códigos de depósito do ORION permitidos (vazio/ausente = todos). Mapeia para `wms.user_warehouses`. |
| `iat`, `nbf`, `exp` | int | `exp - iat = 60`. ORION aceita tolerância de relógio de 30 s e recusa `exp - iat > 120`. |
| `jti` | uuid | Uso único (anti-replay, 2.5). |
| `return_to` | string | Caminho relativo do ORION (começa com `/`, sem `//`). Validado nos dois lados. |
| `state` | string | Presente só no fluxo iniciado pelo ORION; ecoa o `state` recebido. |

### 2.3 Fluxos

**A. Iniciado no ATLAS (menu "Abrir ORION")**

1. Navegador → `GET {ATLAS}/api/integrations/orion/v1/sso/launch?return_to=/separacao` (exige sessão ATLAS).
2. ATLAS confere, nesta ordem: empresa com `company_modules(orion).contracted and enabled_by_company`, `company_platform_profiles.lifecycle_status in (TRIAL, ACTIVE)`, `orion_integrations.status in ('activating','active')` (em ativação a equipe ORION já entra para preparar endereços antes da carga inicial; o ORION aceita `wms.atlas_links.status in ('activating','active')`), `public.users.status = 'active'`, `orion_user_access.status = 'active'`. Falhou ⇒ página de erro do ATLAS ("Seu acesso ao ORION não foi liberado pelo administrador da empresa").
3. ATLAS assina o token e responde **HTML com formulário auto-submetido** (`<form method="post" action="{ORION_URL}/api/sso/atlas">` com campo `token`), `Cache-Control: no-store`, CSP com `form-action {ORION_URL}`. O token nunca vai na URL (não aparece em logs, histórico ou `Referer`).
4. ORION `POST /api/sso/atlas` valida (2.4), provisiona/atualiza o usuário (2.6), chama `startSession` e redireciona (303) para `return_to`.

**B. Iniciado no ORION (botão "Entrar com ATLAS" em `/login`)**

1. ORION gera `state` aleatório (32 bytes base64url), grava cookie `orion_sso_state` (httpOnly, SameSite=Lax, 10 min) e redireciona para `GET {ATLAS}/api/integrations/orion/v1/sso/authorize?state=…&return_to=/…`.
2. Sem sessão no ATLAS ⇒ login normal do ATLAS (`/login?next=…`) e volta para o passo 1 do fluxo A.
3. Igual ao fluxo A, com `state` no token. O ORION exige `state` igual ao cookie (e apaga o cookie).

**Logout**

- "Sair" no ORION: `endSession()` do ORION apenas (não derruba o ATLAS).
- "Sair" no ATLAS: não derruba a sessão do ORION imediatamente; a sessão SSO do ORION expira pela checagem de acesso (2.7) e tem TTL máximo de 12 h (`TTL_SECONDS` atual). Logout único (front-channel) fica para a fase 4.
- Usuários vinculados ao ATLAS **não usam senha local** no ORION (`password_hash = null`; o login por senha recusa usuários com `atlas_user_id` preenchido).

### 2.4 Validação no ORION (ordem obrigatória)

1. `jwtVerify(token, JWKS, { issuer, audience: "orion-wms", algorithms: ["ES256"], clockTolerance: 30, maxTokenAge: "120s" })`.
2. Claims obrigatórias presentes e tipadas (Zod).
3. `return_to` relativo e seguro; `state` confere quando há cookie.
4. **Replay**: `insert into wms.sso_token_uses (jti, atlas_user_id, expires_at) values (…)` — conflito de chave ⇒ 401 `token_replayed`. Limpeza: linhas com `expires_at < now() - interval '1 day'`.
5. Empresa: `erp.companies where source = 'atlas' and external_id = atlas_company_id and id = orion_company_id` e `wms.atlas_links.status = 'active'`. Falhou ⇒ 403 `company_not_linked`.
6. Provisionamento (2.6) e sessão. Auditoria `auth.sso_login` (`audit(...)`).

Erros respondem página amigável (pt-BR) e registram o motivo; nunca expõem o token.

### 2.5 Proteção contra replay e roubo

- Token de 60 s, uso único (`jti`), `aud` fixa, entregue por POST em HTTPS.
- `state` amarrado a cookie no fluxo B (impede login CSRF).
- Cookie de sessão do ORION continua httpOnly/Secure/SameSite=Lax.
- **Domínio**: o fluxo B depende do cookie `orion_sso_state` voltar no `POST /api/sso/atlas` que o navegador faz a partir de uma página do ATLAS. Com `SameSite=Lax` isso só acontece se ATLAS e ORION estiverem no **mesmo domínio registrável** (ex.: `atlas.empresa.com.br` e `orion.empresa.com.br`; portas diferentes em `localhost` também contam como mesmo site). Essa é a implantação exigida. Se os dois ficarem em domínios registráveis diferentes, o ORION aceita `ORION_SSO_STATE_SAMESITE=none`, que grava **só o cookie de state** com `SameSite=None; Secure` (exige HTTPS; o cookie de sessão continua Lax, porque o redirecionamento 303 depois do POST é navegação de topo). O fluxo A não depende de cookie.
- O payload da sessão do ORION ganha `src: "atlas"`, `av` (access_version) e `chk` (epoch da última checagem); o token continua HMAC com `SESSION_SECRET`.

### 2.6 Provisionamento JIT e mapeamento de IDs

| ATLAS | ORION | Onde fica o vínculo |
|---|---|---|
| `public.companies.id` (atlas_company_id) | `erp.companies.id` (orion_company_id) | ORION: `erp.companies.source='atlas'`, `external_id` (existe). ATLAS: `orion_integrations.orion_company_id` (novo). |
| `public.users.id` (atlas_user_id) | `wms.users.id` | ORION: nova coluna `wms.users.atlas_user_id uuid`, único por `(company_id, atlas_user_id)`. |
| `products.id`, `customers.id`, `suppliers.id`, `units.id` | `erp.products.id` etc. | ORION: novas colunas `external_id` + `source` em `erp.products/customers/suppliers` (mesmo padrão de `erp.companies`), único `(company_id, external_id)`. |
| `sales_orders.id` / `sales_order_items.id` | `erp.sales_orders.id` → `wms.outbound_orders.sales_order_id` | `erp.sales_orders.external_id`, `erp.sales_order_items.external_id`. |
| `purchase_orders.id` / itens | `erp.purchase_orders.id` → `wms.receipts.purchase_order_id` | idem. |
| `production_orders.id` / `production_order_materials.id` | `erp.production_orders.id` / `erp.production_order_components.id` | idem. |
| `warehouses.id` | `wms.warehouses.code` | ATLAS: `orion_warehouse_map` (novo). |

Regra de provisionamento no `POST /api/sso/atlas`:

1. Procura `wms.users where company_id = :orion_company_id and atlas_user_id = :sub`.
2. Não achou ⇒ procura por e-mail na mesma empresa (usuário criado antes do vínculo): vincula `atlas_user_id`. Achou o e-mail em **outra** empresa ⇒ 409 `email_in_use_other_company` (a restrição `wms.users.email unique` é global hoje; a migration do ORION da fase 1 a troca por `unique (company_id, lower(email))`).
3. Não achou ⇒ cria (`createUser` do serviço, com `password_hash = null`, `role = orion_role`, `active = true`).
4. Achou ⇒ atualiza `name`, `email`, `role`, `active = true`, `atlas_access_version = access_version`; substitui `wms.user_warehouses` se `warehouses` veio.
5. Tudo numa transação, com `audit("user.provisioned_from_atlas" | "user.updated_from_atlas")`.

No ORION, as telas `/usuarios` mostram usuários vinculados com selo "ATLAS" e **bloqueiam** edição de nome, e-mail, perfil e ativação (o ORION pode ainda restringir depósitos se o ATLAS não mandou `warehouses`).

### 2.7 Revogação

Três mecanismos, todos obrigatórios:

1. **Evento** `user_access.revoked` (ATLAS → ORION, 3.3): ORION faz `active = false` no usuário. Como `getLoggedUser` relê o usuário a cada requisição, a sessão morre na próxima requisição.
2. **Checagem na renovação**: a cada requisição, se `now - chk > ORION_ATLAS_ACCESS_CHECK_SECONDS` (padrão 900), o ORION chama `GET {ATLAS}/api/integrations/orion/v1/access?atlas_user_id=…` (assinado, 3.2) e atualiza `chk`. Resposta `active: false` ⇒ inativa o usuário e encerra a sessão. `access_version` maior que o da sessão ⇒ atualiza perfil/depósitos. Exemplos: `docs/contrato/s2s.access-check.*.json`.
3. **Falha fechada com tolerância**: se o ATLAS não responder, a sessão continua por no máximo `ORION_ATLAS_ACCESS_GRACE_SECONDS` (padrão 3600) desde o último `chk` bem-sucedido; depois disso, pede novo login.

Também derrubam o acesso: empresa `SUSPENDED/CANCELLED` em `company_platform_profiles`, módulo ORION descontratado/desabilitado, `public.users.status = 'inactive'` — a rota de acesso do ATLAS responde `active: false` com `reason` (`company_suspended`, `module_disabled`, `user_inactive`, `access_revoked`) e o ATLAS emite `user_access.revoked` para cada usuário afetado.

### 2.8 Rotação de chaves

1. Gerar novo par ES256 com novo `kid` (`atlas-sso-AAAA-MM`).
2. Publicar a pública nova no JWKS **antes** de assinar com ela (colocar a atual em `ATLAS_SSO_PREVIOUS_PUBLIC_JWKS`, a nova em `ATLAS_SSO_PRIVATE_JWK`; o JWKS publica as duas).
3. Após 1 dia (≫ cache de 5 min + validade de 60 s), remover a antiga do JWKS.
4. Comprometimento: remover a chave do JWKS imediatamente; o ORION refaz o fetch ao ver `kid` desconhecido e passa a recusar o antigo.

---

## 3. Autorização e transporte de dados

### 3.1 Tabelas novas no ATLAS (migration `0126_integracao_orion.sql`)

```sql
-- módulo contratável
insert into public.platform_modules (code, name, description, category, is_core, sort_order)
values ('orion', 'ORION.WMS', 'Armazém (WMS) integrado: endereçamento, separação, inventário e expedição física', 'OPERATIONAL', false, 65)
on conflict (code) do nothing;

create table public.orion_integrations (
  company_id                 uuid primary key references public.companies(id) on delete cascade,
  status                     text not null default 'pending'
                             check (status in ('pending','activating','active','suspended','disabled')),
  orion_url                  text not null,                 -- base do ORION (mesma instalação para todas as empresas)
  orion_company_id           uuid,                          -- erp.companies.id no ORION
  key_id                     text not null unique,          -- identifica o segredo HMAC desta empresa
  secret_ciphertext          bytea not null,                -- segredo HMAC cifrado (3.2)
  previous_secret_ciphertext bytea,                         -- rotação
  stock_owner                text not null default 'atlas' check (stock_owner in ('atlas','orion')),
  sales_release_status       text not null default 'approved' check (sales_release_status in ('approved','reserved')),
  purchase_release_status    text not null default 'sent'     check (purchase_release_status in ('approved','sent')),
  production_release_status  text not null default 'released' check (production_release_status in ('planned','released')),
  auto_send                  boolean not null default true,
  require_invoice_before_ship boolean not null default true,
  cutover_at                 timestamptz,                   -- momento da carga inicial (5.3)
  activated_at timestamptz, activated_by uuid references public.users(id),
  disabled_at  timestamptz, disabled_by  uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.orion_user_access (
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null,
  orion_role  text not null check (orion_role in ('admin','supervisor','operator','auditor')),
  warehouses  text[] not null default '{}',                 -- códigos de depósito do ORION; vazio = todos
  status      text not null default 'active' check (status in ('active','revoked')),
  version     integer not null default 1,                   -- access_version
  granted_by  uuid references public.users(id), granted_at timestamptz not null default now(),
  revoked_by  uuid references public.users(id), revoked_at timestamptz,
  revoke_reason text,
  primary key (company_id, user_id)
);
-- user_id references public.users(id) on delete cascade. Não existe
-- public.user_companies no esquema real do ATLAS: o vínculo funcionário ↔
-- empresa é public.users.company_id, garantido pelo gatilho
-- fn_orion_user_access_guard (o usuário precisa ser da mesma empresa; 23503).

create table public.orion_warehouse_map (
  company_id uuid not null references public.companies(id) on delete cascade,
  warehouse_id uuid not null,                               -- public.warehouses.id
  orion_warehouse_code text not null,
  integration_location_id uuid not null,                    -- warehouse_locations "ORION" (5.2)
  primary key (company_id, warehouse_id),
  unique (company_id, orion_warehouse_code)
);

create table public.integration_outbox (            -- 4
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  target text not null default 'orion' check (target in ('orion')),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  aggregate_seq bigint not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','discarded')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text, last_http_status integer,
  created_at timestamptz not null default now(), sent_at timestamptz,
  discarded_by uuid references public.users(id), discard_reason text,
  unique (company_id, aggregate_type, aggregate_id, aggregate_seq)
);
create index integration_outbox_due_idx on public.integration_outbox (status, next_attempt_at);

create table public.integration_inbox (             -- eventos recebidos do ORION
  event_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null, aggregate_id uuid not null, aggregate_seq bigint,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','applied','failed','ignored')),
  attempts integer not null default 0, last_error text,
  received_at timestamptz not null default now(), applied_at timestamptz
);

create table public.integration_aggregate_seq (     -- contador de sequência por agregado
  company_id uuid not null, aggregate_type text not null, aggregate_id uuid not null,
  last_seq bigint not null default 0,
  primary key (company_id, aggregate_type, aggregate_id)
);

create table public.orion_reconciliation_runs (...);  -- 5.4
create table public.orion_reconciliation_items (...); -- 5.4
```

Colunas novas: `public.sales_orders.wms_status text` (`not_sent, queued, sent, accepted, rejected, failed, picking, ready_to_invoice, shipped, cancelled`, e para compra/OP também `received, in_progress, completed`), `wms_sent_at`, `wms_last_error`, `wms_details jsonb` (e o mesmo em `purchase_orders` e `production_orders`). `rejected` = o ORION recusou o documento por regra (`document.rejected` ou 4xx não retentável); **`failed`** = o `*.released` esgotou as 20 tentativas na outbox (ORION fora do ar, configuração) — os dois liberam "Enviar ao armazém / Reenviar".

RLS: todas com `company_id` seguem o padrão `has_permission(company_id, …)`. Permissões novas em `public.permissions` (módulo `orion`, mapeado em `platform_module_permission_map`): `orion.integration.view`, `orion.integration.manage`, `orion.access.manage`, `orion.documents.send`. Segredos (`*_ciphertext`) **nunca** são selecionáveis por `authenticated`: `revoke select (secret_ciphertext, previous_secret_ciphertext)` e leitura só por função `security definer` executável pelo `service_role`.

### 3.2 Autenticação servidor-a-servidor (os dois sentidos)

**HMAC-SHA256 com segredo por empresa**, no mesmo formato que o ORION já usa (`signBody` em `outbox/transports.ts`), estendido para cobrir método e caminho:

```
X-Astraeus-Key-Id:    <key_id da empresa>
X-Astraeus-Timestamp: <epoch em segundos>
X-Astraeus-Signature: sha256=<hex(HMAC_SHA256(segredo, `${timestamp}.${METHOD}.${path_com_query}.${corpo}`))>
Idempotency-Key:      <id do evento>        (POSTs de evento)
Content-Type:         application/json; charset=utf-8
```

- O receptor localiza o segredo pelo `key_id`, recusa `|agora - timestamp| > 300 s` (401 `stale_timestamp`), compara com `timingSafeEqual`, aceita também o segredo anterior durante a rotação, e confere que a empresa do `key_id` é a mesma do envelope (`atlas_company_id`/`orion_company_id`) — senão 403 `company_mismatch`.
- Um segredo por empresa (32 bytes aleatórios, base64url) gerado pelo ATLAS na ativação e entregue ao ORION **uma vez**, na chamada de vínculo (6.1, passo 4) sobre HTTPS autenticada com a credencial de instalação (abaixo). Guardado cifrado nos dois lados com AES-256-GCM: ATLAS chave `INTEGRATION_ENCRYPTION_KEY`; ORION chave `ATLAS_INTEGRATION_ENCRYPTION_KEY`.
- **Credencial de instalação** (só para o vínculo/desvínculo de empresas): `ORION_INSTALL_KEY_ID` + `ORION_INSTALL_SECRET`, configurados nas duas instalações; mesmo esquema HMAC. Só pode chamar `POST /api/atlas/v1/links` e `DELETE /api/atlas/v1/links/{atlas_company_id}`.
- Compatibilidade: enquanto a fase 2 não chega, o ORION continua aceitando o modo atual (`ERP_WEBHOOK_URL` + `ERP_WEBHOOK_SECRET` global, cabeçalhos `X-Orion-*`). O ATLAS aceita os dois formatos na rota de entrada; o formato `X-Astraeus-*` passa a ser obrigatório quando a empresa tem `key_id`.

Por que não client credentials OAuth2: exigiria um servidor de token e mais uma chamada por requisição; HMAC por empresa já existe no ORION, isola empresas (um segredo vazado não afeta outra) e é verificável sem estado.

### 3.3 Envelope comum (os dois sentidos)

```json
{
  "id": "uuid do evento (chave de idempotência)",
  "type": "sales_order.released",
  "version": 1,
  "source": "atlas",
  "atlas_company_id": "uuid",
  "orion_company_id": "uuid",
  "aggregate": { "type": "sales_order", "id": "uuid", "sequence": 1 },
  "occurred_at": "2026-11-15T13:00:00Z",
  "payload": { }
}
```

- `version`: versão do **payload daquele tipo**. Mudança compatível (campo novo opcional) não muda a versão; incompatível incrementa e o emissor manda a versão mais alta que o receptor anunciou em `GET /api/…/v1/capabilities` (`{"types": {"sales_order.released": [1]}}`).
- `aggregate.sequence`: inteiro crescente por agregado, atribuído pelo emissor na mesma transação (`integration_aggregate_seq` no ATLAS; no ORION, `wms.integration_events.aggregate_seq`, novo). É a base da ordenação (3.5).
- O ORION continua enviando também `company_id`, `created_at` e `attempt` (formato atual); o ATLAS os ignora.
- Ids de documento/linha são sempre os **do ATLAS** (`atlas_*_id`); o ORION inclui os seus em campos `orion_*` e códigos legíveis (`code`, `sku`).
- Quantidades em número decimal na **unidade base do produto** do ATLAS (`products.unit`); até 4 casas.

### 3.4 API do ORION que recebe do ATLAS

Base: `{ORION_URL}/api/atlas/v1`. Implementação em `src/app/api/atlas/v1/**/route.ts` chamando serviços em `src/server/services/atlas-sync.ts` (com `runOperation` e idempotência), validação Zod em `src/server/integrations/atlas/contract.ts`.

| Método e caminho | Uso | Autenticação |
|---|---|---|
| `POST /links` | Vínculo de empresa (cria/atualiza `erp.companies` com `source='atlas'`, grava `key_id` + segredo cifrado, devolve `orion_company_id`) | instalação |
| `DELETE /links/{atlas_company_id}` | Desvínculo (6.3) | instalação |
| `POST /events` | **Entrada única de eventos** (um envelope por requisição) | empresa |
| `POST /events/batch` | Até 500 envelopes da mesma empresa, em ordem; resposta por item (o caminho antigo `/events:batch` continua como alias no ORION) | empresa |
| `GET /capabilities` | Tipos e versões aceitos | empresa |
| `GET /documents/{atlas_document_type}/{atlas_id}` | Estado do documento no ORION (para o botão "Reenviar" e o painel) | empresa |
| `GET /stock/balances?cursor=` | Saldo físico paginado (reconciliação sob demanda, 5.4) | empresa |

**`POST /links`** (fixtures `s2s.links.request.json` / `s2s.links.response.json`). Corpo: `{ atlas_company_id, atlas_url?, key_id, secret, company: { name, legal_name, document, email, phone, address, city, state, zip_code, … }, admin: { atlas_user_id, email, name } | null, previous_secret_hours? }`. `atlas_url` é informativo (URL do ATLAS que pediu); campos extras de `company` (o ATLAS manda o mesmo objeto de `company.upserted`) são ignorados; `previous_secret_hours` (padrão 24) é a janela em que o segredo anterior continua aceito numa rotação. Resposta 201 (criado) ou 200 (atualizado/rotacionado): `{ status, atlas_company_id, orion_company_id, key_id }`; o ATLAS confere que `atlas_company_id` e `key_id` ecoam o pedido. Erros no formato de 3.4 (`unknown_key`/`invalid_signature` 401, `validation_failed` 400).

**`POST /events/batch`** (fixtures `s2s.events-batch.request.json` / `.response.json`), nos dois sentidos (ATLAS também expõe `POST /api/integrations/orion/v1/events/batch`): corpo `{ "events": [envelope, …] }` (1 a 500, ≤ 10 MB, todos da empresa do `key_id`), assinado uma vez sobre o corpo inteiro; cada envelope é aplicado **em ordem** exatamente como em `POST /events` (mesma idempotência e regras de sequência). Resposta HTTP 200 `{ "status": "processed", "results": [{ "http_status": 202, "body": {…resposta de /events…} }, …] }`. O emissor trata cada item pela tabela abaixo. **Uso opcional**: os processadores de outbox dos dois lados enviam um envelope por requisição (`/events`); o lote existe para cargas grandes e reprocessamentos.

Tipos aceitos em `POST /events` (exemplo de cada um em `docs/contrato/a2o.*.json`):

| Tipo | Efeito no ORION |
|---|---|
| `company.upserted` | Atualiza `erp.companies` (campos mestres ficam só leitura em `/empresa`). |
| `company.deactivated` | `wms.atlas_links.status = 'suspended'` ⇒ ORION em modo **somente leitura** para a empresa; logins SSO recusados. |
| `integration.activated` | Grava configuração (dono do estoque, `require_invoice_before_ship`, mapa de depósitos); cria depósitos que não existem. |
| `user_access.granted` / `user_access.revoked` | Pré-provisiona/atualiza ou inativa o `wms.users` (2.6/2.7). |
| `unit.upserted` | Unidades e fatores (`wms.packaging_units` para embalagens). |
| `product.upserted` / `product.deactivated` | Upsert em `erp.products` por `external_id`; `code`→`sku` (o ATLAS usa `products.code` como SKU do ORION). `barcode` → `erp.products.barcode`. Quando `products.sku` do ATLAS é **diferente** de `code` (comparação sem caixa), vira **código de barras alternativo**: embalagem `wms.packaging_units` código `ATLAS-SKU`, fator 1, `barcode = sku` — aceita pelo coletor (`resolveProductCode`) e pela importação de NF-e; se depois ficar igual ao `code` ou vazio, a embalagem `ATLAS-SKU` é desativada. `packagings` → `wms.packaging_units`. `batch_controlled`/`expiration_controlled` → `wms.product_settings`. Desativar não apaga saldo; bloqueia novas entradas. |
| `customer.upserted`, `supplier.upserted` | Upsert em `erp.customers`/`erp.suppliers`. |
| `sales_order.released` | Cria `erp.sales_orders` + itens e o **pedido de saída** (`wms.outbound_orders`, origem ERP) no depósito mapeado; responde `outbound.accepted` pela outbox. |
| `sales_order.updated` | Aceito só se a saída ainda não começou a separação; senão 409 `document_in_progress` (o ATLAS mostra "o armazém já começou a separar; cancele a linha ou o pedido"). |
| `sales_order.line_cancelled` / `sales_order.cancelled` | Cancela linha/pedido, libera reservas; se já expedido, 409 `already_shipped`. |
| `sales_invoice.authorized` | Registra chave/número da NF-e na saída e libera a expedição quando `require_invoice_before_ship`. |
| `purchase_order.released` / `purchase_order.cancelled` | Cria/cancela `erp.purchase_orders` + itens = **recebimento previsto** (aparece em `/recebimentos`, agenda de docas). |
| `production_order.released` / `production_order.cancelled` | Cria `erp.production_orders` + componentes e a **requisição de abastecimento** (`wms.production_requisitions`). |
| `stock.initial_snapshot` | Carga inicial (5.3). Aceita só com `wms.atlas_links.status = 'activating'`. |

Respostas de `POST /events` (exemplos em `docs/contrato/resposta.*.json`):

| HTTP | Corpo | Significado / ação do emissor |
|---|---|---|
| 202 | `{"status":"accepted","event_id":…,"duplicate":false}` | Aplicado (ou enfileirado no ORION). Marcar `sent`. |
| 200 | `{"status":"accepted","duplicate":true}` | Já visto (mesmo `id`). Marcar `sent`. |
| 400 | `error.code = invalid_envelope \| validation_failed`, `retryable:false` | Não reenviar sem correção; vai a `failed` e aparece no painel. |
| 401 | `invalid_signature \| stale_timestamp \| unknown_key` | Configuração; `failed` + alerta. |
| 403 | `company_mismatch \| company_not_linked \| integration_suspended` | Idem. |
| 409 | `out_of_order` (`retryable:true`, traz `expected_sequence`) | Reenviar depois do anterior. |
| 409 | `document_in_progress \| already_shipped` (`retryable:false`) | Regra de negócio; o ATLAS mostra a mensagem no documento. |
| 422 | `dependency_missing` (`retryable:true`) | Referência ainda não sincronizada (ex.: cliente). O emissor reenvia a dependência e tenta de novo. |
| 429 / 5xx / timeout | — | Retentativa com backoff. |

### 3.5 Idempotência, ordenação e reentrega

- **Idempotência**: o `id` do envelope é a chave. ORION grava em `wms.atlas_inbox (event_id pk, …)` na mesma transação do efeito; ATLAS em `public.integration_inbox`. Reentrega do mesmo `id` ⇒ 200 `duplicate:true` sem reexecutar. Payload diferente com mesmo `id` ⇒ 400 `idempotency_conflict`. A comparação usa **só o conteúdo** (`type`, `version`, `aggregate`, `payload`); campos de transporte (`attempt`, `created_at`, `occurred_at` e campos legados) podem variar entre reentregas.
- **Ordenação**: por agregado, via `aggregate.sequence`. O receptor guarda o último `sequence` aplicado por agregado: igual ou menor ⇒ duplicata/obsoleto (200, `duplicate:true`, sem efeito); maior que último+1 ⇒ 409 `out_of_order` (com `expected_sequence`). **O primeiro evento visto de um agregado é aceito com qualquer sequência** (o emissor numera também eventos que não são enviados ao outro lado, e "Reenviar" gera sequência nova); a partir dele a sequência tem de ser contínua. Regra igual nos dois receptores (ORION `wms.atlas_aggregate_state`, ATLAS `integration_inbox`). Upserts de cadastro (`*.upserted`) são **estado completo** e aceitam lacunas (aplica se `sequence` > último; ignora se menor). Entre agregados diferentes não há garantia de ordem; dependências são resolvidas por `dependency_missing` + reenvio, e o emissor sempre enfileira o upsert de cadastros referenciados **antes** do documento quando eles nunca foram enviados.
- **Reentrega**: pelo menos uma vez, backoff exponencial com jitter (2 s, 4 s … teto 30 min), máximo 20 tentativas para erros `retryable`; depois `failed`, com reprocessamento manual no painel (mesma mecânica do ORION em `services/integration.ts`).

### 3.6 Caminho de volta: API do ATLAS que recebe eventos do ORION

`POST {ATLAS_URL}/api/integrations/orion/v1/events` (e `…/events/batch`, 3.4). Rota `src/app/api/integrations/orion/v1/events/route.ts` no ATLAS, executada com o cliente administrativo (sem sessão de usuário), validação Zod em `src/lib/validations/orion.ts`, aplicação em funções SQL `security definer` `fn_orion_apply_*` (migration `0127_orion_aplicar_eventos.sql`), todas com `p_event_id` como chave de idempotência e chamando **as funções que já existem** para não duplicar regra de estoque/custo. Configuração do ORION: `ERP_WEBHOOK_URL = {ATLAS_URL}/api/integrations/orion/v1/events` (o transporte HTTP atual já serve; a fase 2 troca o segredo global pelo segredo por empresa).

Outras rotas do ATLAS: `GET /api/integrations/orion/v1/access?atlas_user_id=` (2.7), `GET /api/integrations/orion/v1/capabilities`, `GET /api/integrations/orion/v1/documents/{type}/{id}` (estado do documento no ATLAS), `GET /api/integrations/orion/v1/sso/launch`, `GET /api/integrations/orion/v1/sso/authorize`, `GET /.well-known/astraeus-jwks.json`.

Para empresas ORION, `L(w)` = local de integração do depósito `w` (`orion_warehouse_map.integration_location_id`, 5.2). Lotes são resolvidos/criados em `public.product_lots` pelo `lot_code`; `lot_code: null` (produto sem lote) é válido em todos os `lots[]` dos eventos o2a.

| Evento (fixture `o2a.*.json`) | Situação no ORION | Efeito no ATLAS |
|---|---|---|
| `outbound.accepted` | **novo** | `sales_orders.wms_status = 'accepted'`; nada de estoque. |
| `document.rejected` | **novo** | `wms_status = 'rejected'`, `wms_last_error`; notificação para quem aprovou. Documento fica liberado para correção e "Reenviar". |
| `outbound.picking_started` | **novo** | `sales_orders.status = 'picking'`, `wms_status = 'picking'`. |
| `outbound.ready_to_invoice` | **novo** (emitido ao concluir a conferência) | `status = 'ready_to_ship'`, guarda lotes/volumes/pesos separados; se a empresa fatura antes de expedir, habilita "Gerar NF-e" (`generate-fiscal-document`) com as quantidades e lotes **separados**; ao autorizar a NF-e o ATLAS emite `sales_invoice.authorized`. |
| `outbound.shipped` | existe (payload ganha ids ATLAS) | Para cada linha: `fn_post_stock_movement(company, product, L(w), 'issue', shipped_qty, lot, null, 'sales_order', so_id, …, idem = event_id‖line‖lot)` com custo médio vigente (mesma integração de custo de `fn_ship_shipment`, 0044); atualiza `sales_order_items.shipped_quantity`; `status = 'shipped'` ou `'partially_shipped'` (regra de 0022); cria `public.shipments` em `shipped` como registro (sem passar por pick/pack do ATLAS). Contas a receber seguem o fluxo atual (`generate-receivable`). |
| `outbound.cancelled` | existe | `wms_status = 'cancelled'`. Payload traz `origin` (`"atlas"` \| `"orion"`) e `atlas_event_id`. `origin: "atlas"` = eco de `sales_order.cancelled` (o ATLAS só registra o estado). `origin: "orion"` (ou ausente, emissores antigos) = o armazém cancelou: o pedido volta a `approved` com alerta "Armazém cancelou a saída" (não cancela o pedido comercial). |
| `outbound.line_cancelled` | existe | `origin: "orion"` (ou ausente): `sales_order_items.cancelled_quantity += cancelled_qty` (limitado ao saldo aberto); recalcula status. **`origin: "atlas"`** (eco de `sales_order.line_cancelled`/`sales_order.cancelled` do próprio ATLAS, com `atlas_event_id` do evento de origem): o ATLAS **não** soma a quantidade de novo (já descontou ao cancelar) — evita a contagem dupla; só registra em `wms_details.last_line_cancel_ack`. |
| `receipt.completed` | existe (payload ganha ids ATLAS, nota e lotes; campo `purchase_order_status` em snake_case — o nome antigo `purchaseOrderStatus` ainda é aceito pela validação do ATLAS durante a transição e é só informativo) | Cria `purchase_receipts` já confirmado chamando `fn_create_purchase_receipt` + `fn_confirm_purchase_receipt` com o local `L(w)` e as quantidades aceitas (reaproveita entrada de estoque, custo e vínculo com NF de entrada de 0116/0119); `purchase_orders.status = partially_received/received`. Recusados (`rejected_qty`) não entram. |
| `divergence.registered` | existe | Só registro/notificação no pedido de compra (sem estoque). |
| `customer_return.completed` | existe | Entrada de `restocked_qty` em `L(w)` (`'return'`, custo do último custo médio), vínculo à devolução fiscal (0042); `scrapped_qty` vira entrada + baixa como perda (`fn_post_adjustment` com motivo `return_scrap`). |
| `inventory.approved` | existe (payload ganha ajustes por item) | `fn_create_adjustment` + `fn_post_adjustment` com os `delta` (motivo `inventory_count`), referência ao código do inventário do ORION. |
| `stock.adjusted` | **novo** (ajuste avulso aprovado no ORION; hoje não emite) | Idem, motivo do ORION. |
| `stock.transferred` | **novo** (só quando os depósitos mapeiam para depósitos ATLAS diferentes) | `fn_create_transfer` + `fn_ship_transfer` + `fn_receive_transfer` entre `L(origem)` e `L(destino)`. Transferências entre endereços do mesmo depósito **não** são enviadas. |
| `production.materials_delivered` | existe | `fn_consume_production_material` por item (lote, quantidade) na OP; OP vai a `in_progress` se estava `released`. |
| `production.leftovers_returned` | existe | `fn_return_production_material`. |
| `production.output_received` | existe | `fn_register_production_output` (entrada do acabado em `L(w)`, custo da OP). O encerramento da OP continua no ATLAS (`fn_complete_production_order`), **sem backflush** para empresas ORION (5.2). |
| `import.cleared` | existe | Atualiza dados de importação do recebimento/NF de entrada (DI/DUIMP, data, país); sem estoque. |
| `export.packed` | existe | Grava volumes/pesos/Incoterm/RE-DU-E no pedido (dados para NF-e de exportação). |
| `stock.balance_snapshot` | **novo** | Alimenta a reconciliação (5.4); não altera saldo. |
| `dock.appointment_created` | existe | Ignorado pelo ATLAS (200, `status: ignored`). |

Respostas do ATLAS: mesmo formato e códigos de 3.4. Erros de regra (ex.: pedido não encontrado) ⇒ 422 `unknown_reference` `retryable:false`; o ORION mostra o evento como `failed` no painel `/integracao`. Eventos sem efeito no ATLAS (ex.: `dock.appointment_created`) respondem 200 `{"status":"ignored","duplicate":false}`.

**Autoria no ATLAS (usuário de sistema)**: eventos do ORION não têm usuário do ATLAS. As funções `fn_orion_apply_*` rodam como `security definer` com `created_by = null` nos movimentos e documentos que criam, e a auditoria (`public.audit_logs`) usa `user_id = null` com `actor_label = 'orion'` (aplicação) ou `'orion.event_failed'` (falha). Não existe usuário técnico no ATLAS. No ORION, ao contrário, cada empresa vinculada tem um usuário técnico (`wms.atlas_links.system_user_id`, sem login) que assina as ações dos eventos recebidos do ATLAS.

---

## 4. Outbox no ATLAS

### 4.1 Gravação na mesma transação

Função `public.fn_orion_enqueue(p_company_id, p_event_type, p_aggregate_type, p_aggregate_id, p_payload jsonb)`, `security definer`: se a empresa não tem `orion_integrations.status in ('activating','active')` não faz nada; senão incrementa `integration_aggregate_seq` (com `for update`) e insere em `integration_outbox`. Chamada:

- **Gatilhos** `after insert or update` em `products`, `customers`, `suppliers`, `units`, `companies` (só quando colunas mestres mudam; o payload é montado por `fn_orion_payload_<entidade>(id)` para ser sempre estado completo).
- **Gatilho de transição de status** em `sales_orders`, `purchase_orders`, `production_orders`: quando `new.status = orion_integrations.<doc>_release_status` e `old.status` é anterior, e `auto_send`, enfileira `*.released` (com itens). `cancelled` ⇒ `*.cancelled`. Alteração de itens depois de enviado ⇒ `sales_order.updated` / `sales_order.line_cancelled`.
- `fn_orion_grant_access` / `fn_orion_revoke_access` (telas da seção 2) ⇒ `user_access.*`.
- Autorização da NF-e de venda (em `fiscal_document_events`) para pedido com `wms_status` ativo ⇒ `sales_invoice.authorized`.

Como é gatilho no banco, vale para todos os caminhos (PostgREST, `pg` direto, funções SQL) e a mensagem nunca existe sem o commit do documento, nem o contrário.

### 4.2 Etapa configurável

`orion_integrations.sales_release_status` (`approved` padrão, ou `reserved`), `purchase_release_status` (`sent` padrão, ou `approved`), `production_release_status` (`released` padrão, ou `planned`). Para empresa ORION, `reserved` significa só "liberado para separação" — a reserva física é do ORION; `fn_reserve_sales_order_stock` passa a apenas mudar o status (ver 5.2).

### 4.3 Botão "Enviar ao armazém / Reenviar"

Rota `POST /api/sales-orders/[id]/send-to-wms` (idem `purchase-orders`, `production-orders`), permissão `orion.documents.send`. Enfileira um novo `*.released` com **novo `id` e novo `sequence`**, payload atual completo. O ORION trata `released` de documento que já existe como upsert (se ainda não começou a separar) ou responde `document_in_progress`. Visível quando `wms_status in ('not_sent','rejected','failed')` ou para quem tem `orion.integration.manage`.

### 4.4 Processador

- Rota `POST /api/integrations/orion/v1/outbox/process` protegida por `CRON_SECRET` (Vercel Cron a cada 1 min, `vercel.json`) e disparo assíncrono logo após o commit (`after()` do Next 16, ver `node_modules/next/dist/docs`).
- Seleção: `select … from integration_outbox where status = 'pending' and next_attempt_at <= now() and (locked_at is null or locked_at < now() - interval '2 minutes') order by company_id, aggregate_type, aggregate_id, aggregate_seq for update skip locked limit 100`. Dentro de um agregado, só envia `seq` N se N-1 já estiver `sent` (garante ordem).
- Envio com HMAC da empresa (3.2), timeout 10 s, backoff idêntico ao do ORION (`backoffMs`), 20 tentativas; `last_error`, `last_http_status` gravados; `failed` e `discarded` como no ORION.
- Módulo `src/lib/integrations/orion/{client.ts,outbox.ts,signature.ts,contract.ts}`.

---

## 5. Estoque

### 5.1 Regra do dono

| Empresa | Estoque físico (endereço, lote, validade, reserva) | Estoque fiscal/financeiro (quantidade por depósito/lote, custo) |
|---|---|---|
| sem ORION | ATLAS (como hoje) | ATLAS |
| com ORION (`stock_owner = 'orion'`) | **ORION** (`wms.stock_balances`) | **ATLAS**, alterado **apenas** por eventos do ORION (3.6) e pelos movimentos puramente fiscais que não têm físico (ex.: ajuste de custo) |

### 5.2 O que muda no ATLAS para empresas com ORION

- **Local de integração**: na ativação, para cada depósito mapeado o ATLAS cria um `warehouse_locations` código `ORION-<depósito>` (marcado `managed_by = 'orion'`, coluna nova). Todo o saldo fiscal da empresa fica nesses locais (grão: produto + lote por depósito). O endereçamento fino vive só no ORION.
- **Guarda no banco**: função `fn_stock_managed_by_orion(company_id)` + verificação no início de `fn_post_stock_movement`: se a empresa é ORION e a chamada **não** veio de `fn_orion_apply_*` (variável de transação `set local app.orion_apply = 'on'`), erro `ESTOQUE_GERENCIADO_PELO_ORION`. Isso desativa de uma vez, inclusive por API: entradas/saídas manuais, transferências (`fn_ship_transfer`/`fn_receive_transfer`), ajustes e contagens (`fn_post_adjustment`, `fn_close_count`), pick lists (`fn_create_pick_list`, `pick-auto`), expedição (`fn_ship_shipment`, `ship-auto`), recebimento manual (`fn_confirm_purchase_receipt` fora do evento), consumo/baixa de produção, e o **backflush** de `fn_complete_production_order` (0123) — para empresa ORION a OP é concluída sem baixar materiais, porque o consumo já veio por `production.materials_delivered`.
- `fn_reserve_sales_order_stock`: para empresa ORION apenas muda status (sem `stock_reservations`).
- **Telas** (badge "Gerenciado pelo ORION" + link "Abrir no ORION" via SSO, botões de ação ocultos): `/app/logistica/{enderecamento,movimentacoes,transferencias,inventario,recebimento,picking,packing,expedicao,almoxarifado,devolucoes}`; `/app/logistica/estoque` continua mostrando o saldo **fiscal** (por depósito/lote) com o rótulo "Saldo fiscal — físico no ORION". Pedido de venda/compra/OP mostram o painel "Armazém" com `wms_status`, histórico de eventos e o botão "Enviar ao armazém / Reenviar". Cadastro de produto: campo `default_location_code` oculto.
- Disponibilidade para venda: o ATLAS usa o saldo fiscal menos pedidos já enviados e não expedidos (aproximação); a reserva real é do ORION, que rejeita/registra falta por `outbound.line_cancelled` quando não houver saldo.

### 5.3 Carga inicial (snapshot ATLAS → ORION)

Feita na ativação (6.1, passos 6–8), com `orion_integrations.status = 'activating'`:

1. ATLAS congela movimentos físicos da empresa (a guarda de 5.2 passa a valer; usuários veem "Em ativação do ORION").
2. Transfere os saldos de todos os locais de cada depósito para `ORION-<depósito>` (movimentos `transfer` com referência `orion_cutover`) e grava `cutover_at`.
3. Envia `stock.initial_snapshot` em lotes de até 1000 itens (`chunk`/`chunks`), por depósito: produto, lote, validade, quantidade, custo.
4. ORION coloca tudo no endereço de recebimento do depósito (`receiving_location`) por `stock-core.ts` (movimento `initial_load`), gerando **tarefas de armazenagem** para a equipe guardar fisicamente. Responde, ao fim, `stock.balance_snapshot` (`reason: "initial_load"`).
   - **Validade de lote**: `expiration_date` = `product_lots.expires_at` do ATLAS (ISO `AAAA-MM-DD` ou `null`); o ORION grava no saldo e na tarefa. Produto com `expiration_controlled` e item sem `expiration_date` ⇒ o bloco inteiro é recusado com 400 `validation_failed` (corrigir o lote no ATLAS e refazer a carga). Saldo sem lote (`lot_code: null`) entra com lote vazio, mesmo para produto com controle de lote (o ORION pede o lote na próxima movimentação).
5. ATLAS compara (5.4). Diferença zero ⇒ `status = 'active'` e liberação dos documentos. Diferença ⇒ fica em `activating` com o relatório para correção.

### 5.4 Reconciliação periódica

- Diária (padrão 02:00, configurável) o ORION emite `stock.balance_snapshot` (`reason: daily_reconciliation`) por depósito, com saldo total por produto + lote (sem endereço), **descontando** o que está em trânsito de eventos ainda `pending` na outbox do ORION (o snapshot carrega `as_of_event_id` = último evento emitido).
- O ATLAS só compara quando já aplicou todos os eventos até `as_of_event_id`; grava `orion_reconciliation_runs (id, company_id, snapshot_id, taken_at, status, total_items, divergent_items)` e `orion_reconciliation_items (run_id, product_id, lot_code, warehouse_id, atlas_qty, orion_qty, delta)`.
- Tela `/app/admin/integracoes/orion` aba "Reconciliação": lista de diferenças, exportação CSV. Correção: sempre pelo ORION (inventário/ajuste ⇒ evento) — o ATLAS não ajusta saldo de empresa ORION diretamente. Alerta quando `divergent_items > 0` dois dias seguidos.

---

## 6. Ativação e desativação de uma empresa

### 6.1 Ativação (do clique ao primeiro pedido separado)

1. **Admin central** (`/app/admincentral/companies` → empresa → aba Módulos, API existente `PUT /api/platform/companies/[id]/modules`): contrata `orion` (`company_modules.contracted = true`). Requer permissão de plataforma `platform.modules.manage`.
2. **Admin da empresa** (`/app/admin/modules`, existente): habilita `orion` (`enabled_by_company = true`). Aparece o item de menu **Integrações → ORION** (`/app/admin/integracoes/orion`, nova).
3. Na tela ORION, aba **Configuração**: URL do ORION (preenchida a partir de `ORION_URL` da instalação), etapas de liberação (4.2), `require_invoice_before_ship`, mapa de depósitos ATLAS ↔ código do depósito ORION. Botão **"Vincular ao ORION"**.
4. ATLAS gera `key_id` + segredo, chama `POST {ORION}/api/atlas/v1/links` (credencial de instalação) com dados da empresa + segredo + 1º administrador (o próprio usuário). ORION cria `erp.companies(source='atlas', external_id)` ou vincula existente pelo CNPJ (só se `source='local'` e não houver outro vínculo), cria `wms.atlas_links`, responde `orion_company_id`. `status = 'activating'`.
5. ATLAS enfileira `company.upserted`, `integration.activated`, `unit.upserted` (todas), `product.upserted` (ativos), `customer.upserted`, `supplier.upserted` — carga de cadastros; a tela mostra o progresso pela outbox.
6. Aba **Acessos**: admin da empresa libera funcionários e perfis (`orion_user_access`); pelo menos um `admin` ORION é obrigatório para seguir.
7. Botão **"Carga inicial de estoque"** (5.3). Bloqueado até a carga de cadastros terminar sem erros.
8. Conciliação da carga zerada ⇒ `status = 'active'`. A partir daqui: pedidos de compra/venda/OP já existentes nos status de liberação **não** são enviados automaticamente; a tela oferece "Enviar pendentes" com a lista.
9. Funcionário clica **Abrir ORION** (SSO, 2.3) → provisionado JIT → equipe faz a armazenagem das tarefas da carga inicial.
10. Primeiro pedido de venda aprovado ⇒ `sales_order.released` ⇒ ORION cria a saída e devolve `outbound.accepted` ⇒ separação (`outbound.picking_started`) ⇒ conferência (`outbound.ready_to_invoice`) ⇒ ATLAS gera NF-e ⇒ `sales_invoice.authorized` ⇒ ORION expede ⇒ `outbound.shipped` ⇒ ATLAS baixa o estoque fiscal e marca `shipped`.

### 6.2 Suspensão

Empresa `SUSPENDED` na plataforma ou módulo desabilitado ⇒ `orion_integrations.status = 'suspended'`, `company.deactivated (mode: read_only)` e `user_access.revoked` para todos. A outbox do ATLAS segura eventos (não descarta). O ORION continua aceitando eventos **de saída** dele já gerados (entrega da outbox do ORION continua), para não perder fatos físicos.

### 6.3 Desativação definitiva (voltar ao estoque do ATLAS)

1. Pré-condições: nenhuma saída/recebimento/requisição aberta no ORION (`GET /documents` por tipo), outbox dos dois lados vazia.
2. Reconciliação final com diferença zero.
3. ATLAS: transfere o saldo de `ORION-<depósito>` para um local padrão do depósito (ou, opcionalmente, recria por endereço a partir de `GET /stock/balances` do ORION mapeando endereço → `warehouse_locations.code`), `stock_owner = 'atlas'`, `status = 'disabled'`; telas voltam ao normal.
4. `DELETE /api/atlas/v1/links/{atlas_company_id}`: ORION marca `wms.atlas_links.status = 'disabled'`, `erp.companies.source` continua `'atlas'` (histórico), usuários vinculados inativados; dados ficam em modo leitura por 90 dias para auditoria.

---

## 7. Segurança, multiempresa, observabilidade e testes

### 7.1 Segurança e multiempresa

- Toda tabela nova com `company_id` tem RLS nos dois lados (ATLAS: padrão `has_permission`; ORION: padrão de `20261009000003_rls_policies.sql` + `tenant_guard` de `20261115000040_tenant_consistency.sql` para as FKs novas).
- As rotas servidor-a-servidor ignoram cookies e operam **somente** na empresa resolvida pelo `key_id`; envelope de outra empresa ⇒ 403. Teste obrigatório: com o segredo da empresa A, nenhum evento afeta B (entra na bateria `tests/multi-tenant-isolation.test.ts` do ORION e num teste equivalente no ATLAS).
- Segredos: nunca em `NEXT_PUBLIC_*`; cifrados em repouso (AES-256-GCM); exibidos uma única vez (nunca); rotação pelo botão "Rotacionar segredo" (gera novo, guarda anterior por 24 h, envia ao ORION por `POST /links` com a credencial de instalação).
- Variáveis — ATLAS: `ORION_URL`, `ORION_INSTALL_KEY_ID`, `ORION_INSTALL_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `ATLAS_SSO_PRIVATE_JWK`, `ATLAS_SSO_PREVIOUS_PUBLIC_JWKS`, `CRON_SECRET`. ORION: `ATLAS_URL`, `ATLAS_SSO_ISSUER`, `ATLAS_JWKS_URL`, `ORION_INSTALL_KEY_ID`, `ORION_INSTALL_SECRET`, `ATLAS_INTEGRATION_ENCRYPTION_KEY`, `ORION_ATLAS_ACCESS_CHECK_SECONDS`, `ORION_ATLAS_ACCESS_GRACE_SECONDS`, `ORION_SSO_STATE_SAMESITE` (opcional, `none` só para domínios diferentes, 2.5), e `ERP_WEBHOOK_URL` apontando para o ATLAS. `ATLAS_DATABASE_URL` deixa de ser usada.
- Auditoria: ATLAS registra em `public.audit_logs` (vocabulário de 0017 ampliado): `orion.module_contracted`, `orion.linked`, `orion.access_granted/revoked`, `orion.document_sent/resent`, `orion.event_applied/failed`, `orion.secret_rotated`, `orion.disabled`. ORION registra via `audit(...)`: `auth.sso_login`, `auth.sso_denied`, `user.provisioned_from_atlas`, `atlas.event_applied/rejected`, `atlas.link_created/disabled`.
- Limites: corpo máximo 1 MB por evento, 10 MB por lote; 600 req/min por empresa (429).

### 7.2 Observabilidade

- **ATLAS** `/app/admin/integracoes/orion` (empresa) e card no `/app/admincentral/companies` (plataforma): status do vínculo, última comunicação bem-sucedida em cada sentido, fila (pendentes/falhos/descartados, mais antigo pendente), lista de eventos de saída e entrada com filtro por tipo/documento, payload, resposta, "Reprocessar" e "Descartar" (com motivo), reconciliação, acessos.
- **ORION** `/integracao` (existe): ganha a seção "ATLAS" com status do vínculo, eventos recebidos (`wms.atlas_inbox`) e rejeitados com motivo, além da outbox existente; `/saude` passa a checar JWKS do ATLAS e a rota de acesso.
- Correlação: o `id` do evento aparece nos logs dos dois lados; os documentos mostram "evento de origem".

### 7.3 Alertas mínimos

Evento `failed`; pendente mais antigo > 15 min; reconciliação com diferença 2 dias seguidos; falhas de assinatura > 10/h (possível segredo errado ou ataque).

### 7.4 Testes de contrato compartilhados

- `docs/contrato/*.json` são **a fonte da verdade**, idênticas nos dois repos (`index.json` lista os arquivos). Convenção de nomes: `a2o.<tipo>.json` (ATLAS→ORION), `o2a.<tipo>.json` (ORION→ATLAS), `sso.*`, `s2s.*`, `resposta.*`.
- **ATLAS** (`node --test`, `tests/orion-contract.test.ts`): (1) todo `a2o.*` é produzido igual pelos montadores de payload (`fn_orion_payload_*`/`src/lib/integrations/orion/contract.ts`) a partir de dados de teste equivalentes (comparação estrutural: mesmas chaves e tipos); (2) todo `o2a.*` passa no schema Zod de entrada e, aplicado em PGlite (o ATLAS já tem `@electric-sql/pglite` como dependência de teste), produz o efeito descrito em 3.6; (3) assinatura HMAC confere com vetor fixo; (4) `sso.launch-token.claims.json` passa no schema de claims.
- **ORION** (Vitest, `tests/atlas-contract.test.ts`): espelho — `a2o.*` aplicados via `createTestEnv()`; `o2a.*` comparados com o que `enqueueIntegrationEvent` gera nos fluxos reais (receber, expedir, devolver, inventário, produção).
- Teste de igualdade: um script (`scripts/check-contract.mjs` nos dois repos) calcula SHA-256 de cada fixture e compara com `docs/contrato/index.json`; a CI de cada repo falha se as fixtures mudarem sem a atualização do índice. Mudança de contrato = PR nos dois repos com o mesmo `index.json`.

---

## 8. Fases e divisão de trabalho

As equipes só compartilham `docs/INTEGRACAO-ATLAS-ORION.md` e `docs/contrato/*.json`. Cada lado pode avançar contra as fixtures, sem depender do outro rodando.

### Fase 1 — fundação (paralela, sem dependência)

**ATLAS**
1. Migration `0126_integracao_orion.sql` (3.1): módulo `orion`, tabelas, colunas `wms_status`, permissões, RLS.
2. `src/lib/integrations/orion/{signature,contract,client}.ts` (HMAC 3.2, schemas Zod de todos os tipos, envelope).
3. JWKS + `sso/launch` + `sso/authorize` + `access` (seção 2), botão "Abrir ORION" no menu.
4. Telas: aba ORION no admin central (contratação já existe; só o card de status), `/app/admin/integracoes/orion` (Configuração, Acessos), coluna "Acesso ORION" em `/app/admin/users`.
5. Testes de contrato do lado ATLAS para `sso.*`, `s2s.*` e assinatura.

**ORION**
1. Migration nova (ex.: `20261116000050_atlas_link.sql`): `wms.atlas_links`, `wms.atlas_inbox`, `wms.sso_token_uses`, `wms.users.atlas_user_id` + troca de `email unique` por `(company_id, lower(email))`, `external_id/source` em `erp.products/customers/suppliers/sales_orders(_items)/purchase_orders(_items)/production_orders/production_order_components`, `aggregate_seq` em `wms.integration_events`; RLS + `tenant_guard`.
2. Dependência `jose`; `POST /api/sso/atlas`, botão "Entrar com ATLAS", provisionamento JIT, checagem de acesso periódica (2.7), bloqueio de senha local para vinculados.
3. `src/server/integrations/atlas/contract.ts` (Zod, envelope), verificação HMAC por empresa, `POST /api/atlas/v1/links`.
4. Telas: selo "ATLAS" e campos mestres somente leitura em `/empresa`, `/produtos`, `/usuarios`.
5. Testes de contrato do lado ORION para `sso.*` e assinatura; isolamento multiempresa das rotas novas.

### Fase 2 — cadastros e documentos (ATLAS→ORION)

**ATLAS**: `fn_orion_enqueue`, gatilhos de cadastros e de status, processador da outbox + cron, botão "Enviar ao armazém / Reenviar", painel de eventos. **ORION**: `POST /api/atlas/v1/events` (+ batch, capabilities, documents) aplicando todos os `a2o.*`; emissão dos eventos novos `outbound.accepted`, `document.rejected`, `outbound.picking_started`; payloads existentes passam a incluir `atlas_*_id`, `version`, `atlas_company_id`, `orion_company_id`, `aggregate.sequence`; transporte HTTP com segredo por empresa e cabeçalhos `X-Astraeus-*`.

### Fase 3 — fatos físicos (ORION→ATLAS) e estoque

**ATLAS**: rota `POST /api/integrations/orion/v1/events`, `fn_orion_apply_*` para todos os `o2a.*` (3.6), guarda `ESTOQUE_GERENCIADO_PELO_ORION` (5.2), telas "Gerenciado pelo ORION", carga inicial e reconciliação. **ORION**: eventos novos `outbound.ready_to_invoice`, `stock.adjusted`, `stock.transferred`, `stock.balance_snapshot` (diário + carga inicial); aplicação de `stock.initial_snapshot` com tarefas de armazenagem; bloqueio de expedição até `sales_invoice.authorized` quando configurado.

### Fase 4 — operação

Rotação de segredo/chave pelas telas, alertas, logout único (front-channel), desativação definitiva assistida (6.3), métricas no admin central.

### Fronteiras para não conflitar

- O ATLAS não escreve no banco do ORION e vice-versa (o conector `ATLAS_DATABASE_URL` é aposentado na fase 2).
- Nenhum lado muda fixture sozinho: mudança de contrato é PR espelhado nos dois repos.
- No ORION, saldo continua mudando só por `stock-core.ts`; no ATLAS, por `fn_post_stock_movement` (com a guarda nova).
- Arquivos novos de cada lado ficam em pastas próprias: ATLAS `src/lib/integrations/orion/**`, `src/app/api/integrations/orion/**`, `src/app/app/admin/integracoes/orion/**`; ORION `src/server/integrations/atlas/**`, `src/app/api/atlas/**`, `src/app/api/sso/**`.

---

## Revisões

### 2026-11-16 — alinhamento pós-implementação (sem mudar `version` dos payloads)

Mudanças compatíveis, aplicadas nos dois repositórios no mesmo dia, com `index.json` regenerado:

1. `POST /links`: corpo e resposta unificados (3.4) e fixtures novas `s2s.links.request.json` / `s2s.links.response.json`; `atlas_url` opcional.
2. Lote: `POST …/events/batch` (sem `:` no caminho; ORION mantém `/events:batch` como alias), corpo `{events}`, resposta `{status, results:[{http_status, body}]}`, nos dois receptores; envio em lote é opcional. Fixtures `s2s.events-batch.*`.
3. Sequência: primeiro evento de um agregado aceita qualquer `sequence`; depois, contínua (3.5). Fixtures `o2a.outbound.line_cancelled` (seq 5) e `o2a.outbound.cancelled` (seq 6) deixaram de repetir sequência.
4. `receipt.completed`: `purchaseOrderStatus` → `purchase_order_status` (o ATLAS aceita o antigo temporariamente).
5. `outbound.cancelled` / `outbound.line_cancelled` ganham `origin` (`atlas`/`orion`) e `atlas_event_id`; com `origin: "atlas"` o ATLAS não repete o efeito de quantidade.
6. `product.upserted`: `sku` ≠ `code` ⇒ código de barras alternativo `ATLAS-SKU`; carga inicial: regra de validade de lote (5.3).
7. `orion_user_access`: FK para `public.users(id)` + gatilho de mesma empresa (não há `user_companies`).
8. Cookie de state do SSO: exigência de mesmo domínio registrável; `ORION_SSO_STATE_SAMESITE=none` opcional (2.5).
9. Eventos do ORION aplicados no ATLAS sem usuário (`created_by = null`, `actor_label = 'orion'`); `wms_status = 'failed'` documentado (3.1).

Defeitos achados no teste real (`docs/QA-INTEGRACAO.md`) e corrigidos no mesmo dia:

10. SSO/checagem de acesso do ATLAS passam a valer com a integração em `activating` (o ORION já aceitava) — sem isso ninguém prepara endereços antes da carga inicial (2.3).
11. `lot_code: null` aceito nos `lots[]` de `outbound.ready_to_invoice` e `receipt.completed` no ATLAS (produto sem lote recusava o evento com 400).
12. Idempotência no ATLAS compara só o conteúdo do envelope: reentrega legítima do ORION virava `idempotency_conflict` (3.5).

