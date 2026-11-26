# Etapa 1 – Novo Inventário

Protótipo aprovado: `prototipos/inventario.html`. Os números do protótipo são exemplos.

## A. Regras (servidor + banco + testes)

### A1. Bloqueio de endereço durante a contagem
- Novo estado por item de inventário: `pending → counting → counted → recount → closed`.
- Ao **começar** a contar um endereço (primeira leitura no coletor ou abertura da linha na web), gravar um lock `inventory_location_locks (company_id, inventory_id, location_id, locked_at, locked_by)`.
- Enquanto houver lock, `suggestLocations`, separação, reposição, transferência e armazenagem **recusam** origem ou destino nesse endereço, com a mensagem "Endereço em contagem (INV-xxxx)". Implementar a checagem no núcleo de movimentação (`stock-core.ts`) para valer em todos os fluxos.
- O lock é liberado quando o item fecha (contado dentro da tolerância, ou aprovado) ou quando o inventário é cancelado.
- O parâmetro da empresa `inventory_lock_mode` aceita `lock` (padrão) ou `reconcile`. No modo `reconcile` não há bloqueio: o sistema registra os movimentos ocorridos depois da foto e, na aprovação, calcula `esperado_ajustado = foto + entradas − saídas desde a foto`.
- O `STALE_SNAPSHOT` passa a valer **por item**: o item afetado volta para recontagem em vez de derrubar o inventário.

### A2. Rodadas de recontagem
- Nova tabela `inventory_counts (company_id, inventory_item_id, round 1..3, counted_qty, lot, expiry, counted_by, counted_at, device)`. Nenhuma contagem é sobrescrita. `inventory_items.counted_qty` vira valor derivado (a contagem vencedora).
- Regras:
  - se a 1ª contagem estiver dentro da tolerância, o item fecha;
  - se estiver fora, gerar a 2ª contagem cega, que **deve ser feita por outro usuário** (validar no servidor);
  - se a 1ª e a 2ª coincidem, o item fecha com esse valor;
  - se divergem, a 3ª contagem (desempate) fica com um supervisor;
  - vale o valor que se repetir; se as três forem diferentes, vale a 3ª.
- `rejectInventory` é substituído por "Devolver itens para recontagem": recebe a lista de itens e um motivo (mínimo de 5 caracteres) e gera tarefas só para esses itens.
- No coletor, a lista "A recontar" aparece em destaque.

### A3. Tolerância e alçada
- Parâmetros por classe ABC (tabela `inventory_tolerances`):
  - tolerância em % e em unidades (vale o maior);
  - alçada em R$, com o perfil que pode aprovar acima do valor.
- Padrão: A ±1%, B ±2%, C ±5%. Acima de R$ 500, aprovação de Administrador.
- Diferença dentro da tolerância: ajuste aplicado automaticamente na aprovação, sem passar pela fila manual. Fora dela: fica na fila de aprovação e respeita a alçada.

### A4. Contagem cega de verdade
- Web: durante `counting`, o `CountTable` (`src/app/(app)/inventario/[id]/page.tsx`) **não** recebe `expected_qty` nem a diferença. Esses dados só são enviados pelo servidor depois de `submitted`. Não basta esconder no cliente.
- Coletor: `inventoryLocation` (`collector.ts`) deixa de listar os SKUs previstos; o operador lê o que encontrar.

### A5. Endereços vazios e item encontrado
- Na abertura, incluir no escopo os endereços **sem saldo**, como linha "esperado 0".
- Se algo for lido num endereço vazio, o item vira "encontrado" com a contagem informada.

### A6. Separar bloqueado e quarentena
- A foto marca a origem do saldo: zona `quarantine` ou parcela `blocked_qty`. A folha mostra isso numa coluna própria, e o ajuste respeita a parcela.

### A7. Rotativo automático por ABC
- O tipo `cyclic` ganha um motor: tabela `cycle_count_plans` com frequência por classe (padrão: A semanal, B mensal, C trimestral) e o calendário gerado pelo cálculo da curva ABC que já existe (`slotting.ts`).
- Gatilhos que criam contagem de um endereço:
  - endereço zerado na separação;
  - falta registrada no picking;
  - divergência no recebimento.
- Tela em Inventário › Calendário, com os próximos 30 dias e o botão "Gerar contagens de hoje". Job diário opcional.

### A8. Ajuste valorizado e envio ao ERP
- Gravar no movimento de ajuste `unit_cost` (custo médio ou último preço de compra; fonte configurável), `reason_code` e `cost_center`.
- Novo evento de integração `inventory.adjustment_posted`, um por linha, com SKU, lote, endereço, quantidade, custo, motivo e chave idempotente `inventory_id+item_id+round`. O `inventory.approved` continua existindo.

### A9. Segregação avisada antes
- O servidor calcula `canApprove` e `blockedReason` para o usuário atual. A UI troca o botão por "Você contou neste inventário. Outro supervisor precisa aprovar."

### A10. Submeter pelo coletor
- Quando todos os itens fecharem, o coletor mostra "Submeter para aprovação" (respeitando a permissão).

### A11. Inventário de linha (WIP)
- Novo `count_type = 'production_line'`, com escopo nas zonas `production`. Concilia com a requisição de produção aberta: o esperado é o entregue menos o devolvido menos o consumido.

### A12. Fechamento de período
- Campo `reference_date` no inventário. Relatório "Registro de inventário" por data de referência, com quantidade e valor por produto, em formato próprio para o Bloco H (exportação CSV).

## B. Mapa em duas camadas

**Decisão do dono:** a visão geral continua com o 3D **atual** do sistema (`iso.tsx`): blocos sólidos com volume e profundidade, ruas rotuladas e piso com a marcação das ruas. Esse 3D é melhor que o desenho em traço do protótipo `prototipos/inventario.html`. **Não** reproduza os racks em linhas do protótipo; use o protótipo só para o painel, a folha, as rodadas e o coletor.

1. **Visão geral ("Todos")**: o 3D atual, sem mudar o desenho. Ajustes permitidos:
   - verde "contado" um pouco menos saturado;
   - bloqueado com hachura;
   - endereço vazio sem volume (só contorno no piso);
   - aviso de empilhadeira nos níveis altos.
2. **Rua**: tocar numa rua leva à vista frontal (`front-view.tsx`, que já existe).
3. **Nível (N1–N4)**: ao escolher um nível, o mapa mostra só aquele nível em blocos planos, com ícones (✓ ! ↻ ■ ○) e alvos de pelo menos 44 px. É o modo que o dono quer para quando um nível é selecionado.
4. **Endereço**: painel com SKU, rodadas, situação e ação.

Comportamento em todas as camadas:
- O caminho "CD-02 › Armazenagem A › Rua 02 › N3 › endereço" fica sempre visível. "Voltar" sobe um nível e preserva a seleção.
- A busca por endereço vai direto ao painel do endereço.
- O filtro "Só pendentes e diferenças" apaga o resto a ~15%.
- Mostrar "quem está contando onde": um marcador com as iniciais do contador sobre o endereço com lock.
- Nunca exigir toque num palete dentro do 3D. No celular, o toque no 3D seleciona a rua inteira.

Desempenho e movimento:
- Animar a câmera com `transform` num `<g>` (não com `setVb` a cada quadro, `cd-map.tsx` ~114) e gravar o `viewBox` só no fim. Partir sempre de `vbRef.current`.
- Uma geometria por rua; nível de detalhe por zoom.
- Ao contar, o endereço "acende": overlay com opacidade e escala, ~240 ms, ease-out. Na recontagem, o mesmo efeito em âmbar.
- Transição entre camadas: os níveis acima sobem e somem, e o nível escolhido se achata (~250 ms).
- Tudo desligado com `prefers-reduced-motion`.
- Cores:
  - "contado" dessaturado (`#5FD3A8` no modo noite);
  - diferença no tom crítico;
  - recontagem em creme;
  - bloqueado em hachura sobre céu;
  - situação sempre com ícone ou padrão, além da cor.

## C. Telas

1. **Modo inventário em tela cheia**: a tela inteira assume os papéis do modo noite (`bg #03061A`), incluindo a barra superior e o menu. Hoje é uma caixa (`components/layout/inventory-mode`). Mostrar a pílula "Modo inventário" e "Sair do modo".
2. **Cabeçalho**: título "INV-000007 · tipo · escopo", subtítulo com origem (manual ou calendário), contadores e modo de bloqueio.
3. **Painel lateral**:
   - KPIs: % contado, acuracidade parcial × meta, diferença absoluta em R$ e end./hora;
   - barra de progresso;
   - endereço selecionado com a situação da rodada;
   - bloco de aprovação com o aviso de segregação.
   - O hero "98,1%" gigante (`SuccessHero`) sai do fluxo; o número fica no painel em `kpi` 28/32.
4. **Folha de contagem** (`[id]/page.tsx`, `CountTable`):
   - endereço em mono de 14 px, abreviado como "R02 · M05 · N2 · P1", com o endereço completo no `title`;
   - SKU com `whitespace-nowrap`; a descrição em linha secundária;
   - input "Contado" com `text-right tabular-nums`, foco creme;
   - "Esperado" mostra "oculto" durante a contagem;
   - "Lote/validade" só aparece se algum item controla lote ou validade;
   - linhas alteradas e não salvas ficam destacadas;
   - barra fixa no rodapé com "N linhas alteradas" e "Salvar contagens";
   - aviso ao sair com alterações não salvas;
   - abaixo de 640 px, cada linha vira cartão.
5. **Lista de inventários**:
   - abaixo de `md`, cartões;
   - códigos com `nowrap`;
   - "Com diferença" no tom crítico, e o zero em `muted`.
6. **Seletor de zona**: um `select`, no lugar dos chips. Botões N1–N4 e "Todos" com 44 px. "Ir"/"Voltar" com `min-h-11`.
7. **Coletor de inventário** (`src/app/coletor/inventario`, `count-runner.tsx`):
   - tela inteira no modo noite;
   - progresso em barras (o traço do símbolo) com "42 de 72";
   - passos endereço → produto → quantidade;
   - confirmação "✓ 50 un. registradas. Leia o próximo endereço." com pulso visual (transform e opacidade, 120–180 ms) e vibração quando houver;
   - erro com tremida curta (`translateX` ±6 px) e texto fixo;
   - botões de 56 px;
   - plural correto ("1 item contado" / "3 itens contados");
   - lista "A recontar";
   - botão "Submeter para aprovação" quando tudo fechar.
8. **Tela de rodadas** (dentro do painel do endereço): 1ª, 2ª e 3ª contagem com contador, quantidade e situação, como no protótipo.
9. **Configurações › Inventário**:
   - tolerância e alçada por classe;
   - modo de bloqueio (`lock` ou `reconcile`);
   - frequência do rotativo;
   - fonte do custo.

## D. Testes mínimos

- Movimento em endereço com lock é recusado em separação, reposição, transferência e armazenagem.
- No modo `reconcile`, o esperado ajustado está correto.
- A 2ª contagem pelo mesmo usuário é recusada.
- O desempate escolhe o valor certo.
- Dentro da tolerância, o ajuste é automático; fora dela, respeita a alçada.
- A API da folha não devolve `expected_qty` durante `counting`.
- O endereço vazio entra na foto, e o item encontrado é criado.
- O evento `inventory.adjustment_posted` é idempotente e sai uma linha por ajuste.
- O calendário ABC gera as contagens do dia sem duplicar.
- Registrar os novos exports no teste multiempresa.

## E. POPs a atualizar

POP-ORN-33 (abrir), 34 (contar) e 35 (aprovar). Criar POPs novos para "Configurar tolerância e rotativo" e "Recontar itens".
