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

Os mesmos cenários estão automatizados em `tests/`.

## Estrutura

```
supabase/migrations/       Migrations SQL versionadas (ERP, WMS, RLS)
scripts/db.ts              migrate / seed / reset
src/app/(app)/             Telas autenticadas (uma pasta por módulo)
src/app/api/relatorios/    Exportação CSV protegida
src/components/            UI (design system), formulários, componentes WMS
src/lib/                   Permissões, rótulos, formatação (compartilhados)
src/server/db/             Drivers (PGlite/Postgres), migrations, conexão
src/server/auth/           Senha (scrypt), token HMAC, sessão
src/server/services/       Regras de negócio e operações transacionais
src/server/actions/        Server Actions (camada fina sobre os serviços)
src/server/integrations/   Gateway do ERP
src/server/seed/           Dados de demonstração
tests/                     Testes funcionais e de integridade
```

## Usando Supabase

1. Aplique as migrations: `supabase db push` (ou execute os arquivos de `supabase/migrations` em ordem).
2. Defina `DATABASE_URL` com a string de conexão do Postgres (servidor) e `SESSION_SECRET`.
3. As políticas RLS são criadas automaticamente quando o schema `auth` existe. Os schemas `erp` e `wms` não são expostos pela API REST por padrão; toda escrita passa pelo servidor.

Detalhes, limitações e próximos passos: [`docs/RELATORIO-MVP.md`](docs/RELATORIO-MVP.md).
