# Etapa 2 – Correções gerais

Protótipo: `prototipos/correcoes.html`.

## Design (não mudam a identidade)

### D1. Coletor no padrão ORION, com retorno de leitura
Arquivos: `src/components/collector/*` (`kit.tsx`, `task-runner.tsx`, `claim-button.tsx`, `lookup`, `count-runner.tsx`) e `src/app/coletor/*`.

- **Padrão visual:**
  - Gabarito 600 nos títulos, no lugar de `font-bold`;
  - `radius-lg`, no lugar de `rounded-xl`;
  - contorno de 1 px;
  - ícones na cor do texto;
  - alvos de 56 px;
  - cabeçalho noite com o símbolo.
- **Banners de sucesso e erro:**
  - fundo `--ok-bg`/`--crit-bg` com texto `--ok-fg`/`--crit-fg` (ou cores sólidas escurecidas);
  - contraste mínimo de 4,5:1, verificado por teste ou cálculo.
- **Retorno da leitura:**
  - acerto: pulso de 120 ms (`scale` 1→1,04 e opacidade) na borda verde;
  - erro: `translateX` ±6 px, 3 ciclos em 240 ms;
  - sempre texto fixo de situação;
  - vibração mantida onde existir;
  - nada de animação com reduzir movimento.
- **Estado vazio:**
  - botão "Atualizar";
  - hora da última sincronização;
  - atalho para a Consulta rápida.

### D2. Uma só contagem de tarefas
- O painel e o coletor passam a usar o mesmo critério do serviço de tarefas.
- O coletor mostra "0 suas · 2 da equipe", com o botão "Assumir" para quem tiver permissão.

### D3. Formulários e tabelas
- `lang="pt-BR"` no `<html>` (confirmar em `src/app/layout.tsx`).
- Componente de data próprio, no formato `dd/mm/aaaa`.
- `select` estilizado em `src/components/ui/fields.tsx`.
- Códigos com `whitespace-nowrap`.
- Um só traço para vazio ("—").
- Zero em `muted`; a cor de situação só aparece quando há exceção.
- O cabeçalho de coluna herda o alinhamento da coluna (números à direita).
- Paginação com `radius-md`.
- Rótulos de KPI em uma linha, com o número alinhado pela base.

### D4. Celular
- A barra superior mostra só o menu e a busca. Tema e atalhos vão para dentro do menu ☰. Alvos de 44 px.
- O selo de demonstração não sobrepõe nada (e some quando o modo demonstração sair).
- Abaixo de 640 px, as tabelas viram cartões (Separação, Recebimentos, Estoque, Inventário).

### D5. Movimento
- Trocar propriedades de layout por `transform` e `opacity`:
  - `collector-laser` usa `translateY`;
  - `nv-cursor` usa `translate`;
  - `nv-fill` usa `scaleY` com `transform-origin`;
  - `nv-type` e `nv-cx-line` usam `scaleX`;
  - os glows viram um pseudo-elemento com opacidade.
- `motion-safe:animate-spin` e o texto "Salvando…" em `action-form.tsx`, `login-form.tsx`, `change-password-form.tsx`, `reset-password.tsx` e `lead-form.tsx`.
- `transition-all` → `transition-[transform,opacity]` em `novidades.tsx` e `onboarding-tour.tsx`.
- Tokens em CSS vars:
  - durações: `--dur-1: 120ms`, `--dur-2: 200ms`, `--dur-3: 320ms`;
  - curvas: `--ease-out: cubic-bezier(.2,.7,.2,1)` e `--ease-in-out`.
- Estado de pressionado nos botões e cartões do coletor (`active:scale-[.98]`).
- View Transitions com fade de 150 ms entre rotas, respeitando reduzir movimento.
- `site-cta`: glow com no máximo 2 iterações.

## Regras de operação

### R1. Quarentena do produto acabado e da devolução
- `receiveOutput` (`src/server/services/production.ts`) e a devolução apta (`returns.ts`) entram com o status "aguardando qualidade". O saldo fica bloqueado, ou vai para a zona `quarantine` se existir.
- Nova tela em Qualidade com as ações Aprovar, Reprovar e Retrabalhar. Cada uma registra laudo (texto e anexo opcional), usuário e data.
- Só depois da aprovação o sistema gera a tarefa de armazenagem e o saldo fica disponível.
- O parâmetro da empresa `qc_required_for_output` vem ligado por padrão.

### R2. Validade mínima restante
- Campo `min_shelf_life_days` no produto, com padrão na empresa e opcionalmente por cliente.
- A reserva FEFO (`outbound.ts` ~299-330 e `production.ts` `reserveRequisition`) ignora lotes abaixo do mínimo e informa o motivo na indisponibilidade.

### R3. Eventos de produção para o ERP
- Novos eventos na outbox (`integration.ts` e o contrato ATLAS):
  - `production_material_issued`;
  - `production_leftover_returned`;
  - `production_output_received`.
- Cada evento é idempotente e tem payload por lote.

### R4. Endereço sugerido por peso e volume
- `suggestLocations` (`stock-core.ts`) considera:
  - o volume e o peso da unidade logística (`products.ts`);
  - a capacidade em m³ e kg do endereço (novos campos `max_volume_m3` e `max_weight_kg`; `max_weight` já pode existir).
- Recusa ou rebaixa os endereços que estourariam. A tela mostra "1,10 de 1,20 m³ · 820 de 1.000 kg".

### R5. Genealogia de lote e recall
- Tabela `lot_genealogy (company_id, parent_product, parent_lot, child_product, child_lot, qty, source: production|repack, ref_id)`, preenchida na entrega à linha e no recebimento do acabado.
- Consulta em Armazém › Rastreabilidade:
  - para trás: acabado → componentes;
  - para frente: componente → acabados → pedidos → NF e cliente.
- Botão "Iniciar recall":
  - bloqueia todo o saldo dos lotes afetados;
  - gera a lista de clientes e notas;
  - registra o processo na auditoria.
