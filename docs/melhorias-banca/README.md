# Melhorias da banca: pacote para implementação

Este pacote reúne tudo o que a banca de avaliação (4 de design + 2 de operação) pediu para o ORION WMS e o dono aprovou **por inteiro**, inclusive as funcionalidades novas.

## O que tem aqui

| Arquivo | Conteúdo |
|---|---|
| `README.md` | Este guia: contexto, regras de trabalho e ordem de execução |
| `01-avaliacoes.md` | Resumo das avaliações (notas, problemas com arquivo e linha) |
| `02-inventario.md` | Especificação completa do novo Inventário (etapa 1) |
| `03-correcoes-gerais.md` | As 10 correções gerais: 5 de design e 5 de regra (etapa 2) |
| `04-funcionalidades-novas.md` | Funcionalidades grandes (etapa 3) |
| `prototipos/inventario.html` | Protótipo aprovado do Inventário (abrir no navegador) |
| `prototipos/correcoes.html` | Protótipo "hoje × proposto" das 10 correções |

## Contexto do sistema

- Next.js 16 (app router), server actions (`runAction`, `ActionForm`/`SubmitButton`), validação zod.
- Banco: PGlite local/demo ou Postgres (Neon) via `DATABASE_URL`. Migrations em `supabase/migrations` (nomeie `2026112xxxxxxx_nome.sql`, sempre com `company_id` e RLS como as demais).
- Serviços em `src/server/services/*`. Testes com vitest (`npm test`).
- **O teste de isolamento multiempresa exige registrar todo novo export de serviço** (veja `tests/multi-tenant-isolation*.test.ts`). Toda consulta filtra por `company_id`.
- Design system "Céu de inverno": `docs/DESIGN.md` e tokens em `src/app/globals.css`. Títulos Gabarito 600, texto Inter, códigos Geist Mono. Botões em pílula, contorno de 1 px, sem sombra. Use só tokens.
- O mapa isométrico vem de `src/components/inventory/cd-map/` (`cd-map.tsx`, `iso.tsx`, `front-view.tsx`, `cell-panel.tsx`).
- Coletor: `src/app/coletor/*` e `src/components/collector/*` (`kit.tsx`, `count-runner.tsx`, `task-runner.tsx`, `camera-scanner.tsx`).
- Os POPs (manual por ferramenta) precisam ser atualizados no fim de cada etapa que mudar um fluxo.

## Regras de trabalho

1. Trabalhar em branch, nunca direto no `main`. Uma etapa por vez, com commits pequenos.
2. Toda regra nova fica **no servidor** (serviço + constraint/trigger no banco quando fizer sentido), com teste.
3. "Reduzir movimento" respeitado em CSS **e** em JS. Animar só `transform` e `opacity`.
4. Contraste AA (4,5:1), toque mínimo de 44 px (56 px no coletor), situação nunca só por cor.
5. Textos em português, rótulos de botão pelo verbo da ação.
6. Antes de ir para o `main`, mostrar ao dono (prints em 390 px e 1440 px ou artefato).
7. `npm test`, `npm run lint` e `npm run build` verdes ao fim de cada etapa.

## Ordem de execução

1. **Etapa 1 – Inventário** (`02-inventario.md`). Prioridade máxima.
2. **Etapa 2 – Correções gerais** (`03-correcoes-gerais.md`).
3. **Etapa 3 – Funcionalidades novas** (`04-funcionalidades-novas.md`), na ordem listada lá.

## Pendências fora do código

- **Modo demonstração:** o código para tirar já está no branch `claude/friendly-shannon-vutswg` (`src/server/demo-mode.ts` só liga com `WMS_DEMO_MODE=true`). Falta o dono apagar `WMS_DEMO_MODE` na Vercel e garantir `SESSION_SECRET`. Com isso, o selo "Demonstração" some.
- O assistente "Montar armazém" e os 6 tipos de palete estão no mesmo branch, ainda não no `main`.
