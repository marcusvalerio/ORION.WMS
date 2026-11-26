# Resumo das avaliações

Cada profissional avaliou lendo o código e uma amostra de prints. Itens marcados como "inferido" vieram da ausência no código e devem ser confirmados antes de implementar.

## Rodada 1 – sistema inteiro

| Profissional | Nota |
|---|---|
| Diretor de arte | 6 |
| Designer de produto | 6,5 |
| Designer de UX | 7 |
| Motion designer | 5,5 |
| Diretor de produção | 6 |
| Diretor de armazém | 6 |

### Design
- **Cobalto fora do lugar:** o DS restringe `#2563EB` a foco e seleção, mas ele está em links, códigos, menu ativo e ícones. O creme quase não aparece. *(decisão do dono: manter como está por enquanto, não incluído nas correções)*
- **Coletor fora do DS:** `font-bold`, `rounded-xl`, contorno de 2 px, ícones cobalto (`src/components/collector/*`).
- **Banners do coletor sem contraste AA:** branco sobre `--ok-solid #12A27A` = 3,24:1; sobre `--crit-solid #E03A45` = 4,32:1 (`kit.tsx` 33-34 e 207-208, `claim-button.tsx` 35).
- **Leitura sem retorno visual:** só `navigator.vibrate` (`kit.tsx` 16), que o iOS ignora.
- **Contagem de tarefas diverge:** o painel mostra "2 pendentes" e o coletor "Nenhuma tarefa aberta".
- **Estado vazio do coletor sem próximo passo.**
- **Data em formato americano** (`mm/dd/yyyy`), selects nativos sem estilo.
- **Tabelas:** código quebrando (PC-IMP-0004), "—" e "–" misturados, zero colorido (reservado 0 azul, bloqueado 0 amarelo), cabeçalho de coluna numérica à esquerda.
- **Celular:** a barra do topo corta o selo e tem botões de ~28 px; a tabela de Separação rola sem pista.
- **KPIs do Painel desalinham** quando o rótulo quebra; paginação com `rounded` de 4 px (`table.tsx`).
- **Movimento:**
  - anima propriedades de layout: `collector-laser` (top), `nv-cursor` (left/top), `nv-fill` (height), `nv-type`/`nv-cx-line` (width), `site-glow`/`nv-pick` (box-shadow), em `globals.css` 329-394;
  - `animate-spin` ignora reduzir movimento em `action-form.tsx:128`, `login-form.tsx:67`, `change-password-form.tsx`, `reset-password.tsx` e `lead-form.tsx`;
  - `transition-all` em `novidades.tsx:203` e `onboarding-tour.tsx:211/258`;
  - o mapa anima `viewBox` via setState (`cd-map.tsx:114`).
- **DS contraditório:** KPI em Inter (§4) × número em Gabarito (§7); "hoje em cobalto" (§7) × cobalto só no foco (§3); `radius-pill` não existe como token.

### Operação
- **Produção:**
  - o acabado entra disponível sem inspeção (`receiveOutput`);
  - não há genealogia de lote;
  - o consumo é registrado na entrega, não no uso;
  - o ERP só recebe `production_release_status`;
  - não há kanban de linha;
  - não há validade mínima na reserva FEFO.
- **Armazém:**
  - não há coletor offline;
  - não há separação batch/cluster;
  - a sugestão de endereço ignora peso e volume;
  - não há fila de tarefas com prioridade;
  - não há controle de pátio nem integração com transportadoras;
  - só há integração com o ATLAS;
  - falta SNCM/temperatura;
  - não há cobrança de 3PL.

## Rodada 2 – Inventário

| Profissional | Nota |
|---|---|
| Diretor de arte | 6,5 |
| Designer de produto | 6 |
| Designer de UX | 6,5 |
| Motion designer | 5,5 |
| Diretor de produção | 6 |
| Diretor de armazém | 5,5 |

**Pontos fortes a preservar:**
- o modo inventário noturno com o mapa 3D;
- ajuste só depois da aprovação;
- segregação de funções (`assertSegregationOfDuties`);
- `STALE_SNAPSHOT`;
- a contagem cega no coletor;
- o painel de acuracidade com valor em R$.

**Problemas:**
1. Nada bloqueia o endereço em contagem; o `STALE_SNAPSHOT` derruba o inventário inteiro (`inventory.ts` 430-436).
2. `rejectInventory` devolve tudo para contagem e há um único `counted_qty`: não existem rodadas.
3. Não há tolerância nem alçada por valor.
4. O ajuste não tem custo no movimento; o evento `inventory.approved` (`inventory.ts` 491) não leva as linhas.
5. `count_type` só aceita general/cyclic; não há motor de rotativo ABC.
6. Saldo zero fica fora da folha (`inventory.ts` 186-195): endereço vazio não é contado.
7. Quarentena e bloqueados entram misturados na foto.
8. Não há inventário de WIP/linha nem fechamento de período (Bloco H/K).
9. A contagem não é cega na web: o `CountTable` em `inventario/[id]/page.tsx` mostra "Esperado" e "Diferença".
10. O coletor lista os SKUs previstos no endereço (`inventoryLocation`), o que induz o operador.
11. A segregação só é avisada depois do clique em "Aprovar".
12. A submissão só existe no desktop.
13. O modo inventário é uma caixa escura dentro do layout claro (o DS §7 pede a tela inteira).
14. O hero "98,1%" é gigante e duplica o número do painel (`SuccessHero`).
15. A folha tem endereço em `text-[11px]`, o SKU quebra, o input "Contado" fica à esquerda, "Lote/validade" aparece vazio e "Salvar" fica no fim de 121 linhas.
16. No mobile, a lista e a folha rolam na horizontal.
17. Os botões N1–N4 têm ~28 px; "Ir"/"Voltar" têm 36 px.
18. Divergência na lista usa o tom de atenção, mas o DS diz crítico.
19. O endereço contado não acende no mapa (`iso.tsx`); o coletor não confirma com movimento (`count-runner.tsx`).
20. O mapa: o verde "contado" é saturado demais e há chips de zona demais.

**Mapa (rodada extra com arte, UX e armazém):** visão geral com porta-paletes montados e, ao escolher um nível, blocos planos. Os detalhes estão em `02-inventario.md` §B.
