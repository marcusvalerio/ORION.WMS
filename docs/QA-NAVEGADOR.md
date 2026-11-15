# QA no navegador — ORION.WMS

- **Data:** 15/11/2026
- **Branch:** `claude/wms-erp-mvp-io9q47` (base `3fc500b`)
- **Ambiente:** `WMS_DEMO_MODE=true npm run build` + `next start -p 3400` (servidor de produção, PGlite de demonstração). Chromium headless via Playwright, `deviceScaleFactor: 1`.
- **Viewports:** desktop 1440×900 e celular 390×844; temas claro e escuro (cookie `orion-theme`).
- **Capturado em cada página:** erros de console, exceções de página, respostas HTTP ≥ 400, rolagem horizontal (`scrollWidth > clientWidth`) com o elemento-folha que estoura, textos cortados (`scrollWidth > clientWidth` em botões, links, títulos, rótulos), campos sem rótulo acessível e controles sem nome.
- Os scripts ficaram fora do repositório (pasta de rascunho da sessão `qa/navegador/`: `crawl.js`, `a11y.js`, `f1.js`…`f48.js`).

## Resultado por item

Legenda: **ok** — funcionou sem defeito; **corrigido** — defeito encontrado e corrigido nesta rodada; **pendente** — não corrigido, com motivo.

### 1. Rotas do menu (45 rotas × 2 viewports × 2 temas = 180 aberturas)

| Item | Resultado |
| --- | --- |
| Todas as rotas abrem com 200, sem erro de console, exceção ou HTTP ≥ 400 | ok |
| Rolagem horizontal no celular em `/`, `/armazem/estrutura`, `/docas`, `/relatorios`, `/indicadores`, `/curva-abc` (até 1246 px numa tela de 390 px) | **corrigido** — os grids responsivos (`grid lg:grid-cols-…`) não tinham coluna base; no celular a coluna implícita (`auto`) crescia até a largura mínima do conteúdo (textos `truncate`, tabelas com rolagem própria). Agora usam `grid-cols-1` (= `minmax(0, 1fr)`) e o `Card` tem `min-w-0`. Recrawl: 0 páginas com rolagem horizontal. |
| Cabeçalho desktop: nome da empresa e CNPJ quebravam em 2–3 linhas (“11.222.333/0001-” / “81”) | **corrigido** — sem quebra; o CNPJ aparece a partir de `xl`. |
| Cabeçalho celular: selo “Demonstração” cortado na borda (“Der…”) e nome da empresa sumindo | **corrigido** — a empresa trunca, o selo não encolhe e o nome do usuário sai da barra compacta abaixo de `sm`. |
| Títulos (h1) e estados vazios | ok — exceto `/coletor`, que não tinha h1 (**corrigido**: título “Menu do coletor” para leitores de tela). |

### 2. Fluxos ponta a ponta (pelos formulários da UI)

| Fluxo | Resultado |
| --- | --- |
| NF-e XML (`docs/exemplos/nfe-pc-4588-entrega-1.xml`): importar → vincular produto (ADE-003) → aplicar PC-4588 → criar recebimento | ok (REC-000015; o excedente sobre o saldo do pedido virou linha separada) |
| Registrar chegada → conferência **parcial** (“Salvar contagem” persiste após recarregar) → finalizar (falta de 5 un vira divergência) → liberar | ok |
| Armazenagem: tarefa com endereço sugerido, iniciar, confirmar | ok (LUB-002) |
| Armazenagem de produto refrigerado no CD-02 | ok como regra (recusa com motivo claro “Nenhum endereço ativo aceita a classe refrigerated”); ver pendência de dados |
| Pedido de saída manual → reservar (FEFO) → onda (seleção manual) → liberar onda → separar → distribuir → conferência final → expedir | ok no DEP-01 (PS-000013, EXP-000012); no CD-02 a onda é recusada (pendência de dados) |
| Histórico da onda mostrava códigos crus (`wave.created`, `wave.picked`…); também em Auditoria (`production.*`, `replenishment.checked`, `slotting.settings_updated`, `receipt.import_saved`…) | **corrigido** — 31 rótulos de auditoria tinham sido mesclados dentro de `RETURN_REASON_LABELS`; voltaram para `AUDIT_ACTION_LABELS`. |
| Pedido em onda, status “Em separação”: o aviso levava a “Ver tarefas abertas” (lista vazia) | **corrigido** — com onda, o aviso aponta para a onda e explica a distribuição na doca. |
| Cancelar pedido reservado | ok (reservas liberadas) |
| Transferência (criar tarefa → executar) | ok |
| Reposição (verificar → executar tarefa aberta) | ok |
| Devolução de cliente (registrar → inspecionar aprovado/avariado → tarefa de armazenagem → executar) | ok (DEV-000001) |
| Agenda de doca (agendar janela → check-in → criar recebimento do agendamento) | ok (AGD-000002 → REC-000016) |
| Comex: dados de importação (DI, incoterm, país) com retenção para desembaraço | ok |
| Produção: requisição → reservar → gerar separação → executar → entregar à linha | ok (REQ-000001, ENT-000001) |
| Inventário: criar rotativo → mapa 3D → teclado (setas, Enter = vista frontal, Esc) → “Ir para” → confirmar contagem com avanço automático (5 endereços) → recontar → submeter → devolver para recontagem → submeter → aprovar → tela “Inventário concluído” | ok (INV-000007). Admin que contou é barrado pela segregação de funções; aprovado pelo supervisor. |
| Rótulo “Você · 10 m até …” e balão do endereço selecionado cortados na borda direita do mapa / sob o seletor de nível | **corrigido** — rótulo e balão se deslocam para a esquerda perto da borda. |
| Divergências (registrar tratamento) | ok |
| Etiquetas (endereços, produto, volumes do pedido, expedição) | ok (códigos renderizados, botão Imprimir) |
| Coletor: busca do topo → `/estoque?q=`; ícone do leitor → `/coletor` → consulta rápida; tarefa no coletor | ok |
| Usuários: criar operador com depósito | ok |
| Configurações: meta de acuracidade (97) e destinatários persistem; e-mail inválido recusado com mensagem | ok |
| Integração: processar fila (16 → enviados; fila vazia avisa “Nenhum evento elegível”), ver e-mail registrado | ok |
| Relatórios (10): tabela e CSV 200 `text/csv` | ok |
| Indicadores, Produtividade, Curva ABC (salvar/recalcular, gerar transferência), Auditoria | ok |

### 3. Perfis

| Item | Resultado |
| --- | --- |
| Login pelos perfis de demonstração (supervisor, operador, auditor) | ok |
| Operador: Auditoria/Usuários/Configurações mostram “acesso restrito”; sem ajuste, ondas, reposição, pedido manual | ok |
| Operador no inventário em curso: contagem cega (esperado “oculto”, ocupação arredondada, sem acuracidade) | ok |
| Auditor: telas em consulta, sem botões de ação (só filtros) | ok |
| Supervisor: ações gerenciais e aprovação do inventário | ok |
| CSV de relatórios liberado a operador/auditor (200) | ok pela regra atual de permissão (`reports`); registrado só como observação |

### 4. Novidades da versão

| Item | Resultado |
| --- | --- |
| Abre sozinha na 1ª visita; Esc, X e “Pular” fecham; não reabre em outra rota (cookie `2026.11`) | ok |
| Presente no cabeçalho reabre | ok |
| Não abre em rota de tarefa (`/tarefas/[id]`, `/coletor`, `/coletor/tarefas`) | ok |
| Celular: sem rolagem horizontal no modal | ok |
| Aviso leve (toast) | **pendente** — a versão atual (2026.11) não é “leve”, então o toast não aparece pela UI; o comportamento está coberto pela lógica de `novidadesDoUsuario`. |

### 5. Páginas públicas

`/login`, `/site` (formulário “Garantir minha vaga”: registra e confirma), `/sobre`, `/sobre/estados` — ok nos dois viewports, sem rolagem horizontal.

### 6. Acessibilidade básica

| Item | Resultado |
| --- | --- |
| ~200 campos com `<Field>` sem associação rótulo↔campo (o `<label>` não tinha `htmlFor` nem envolvia o controle) e ~45 filtros (`FilterField` usava `<span>`) | **corrigido** — rótulo passa a envolver o campo quando não há `htmlFor`. Varredura em 39 telas: 0 campos sem rótulo, 0 controles sem nome. |
| Foco visível (anel 2px) e Tab dentro do modal de novidades | ok (modal nativo `showModal`, conteúdo de fora inerte) |
| Mapa do inventário: foco por Tab, setas, Enter, Esc, região `aria-live` | ok |

## Pendências

1. **Dados de demonstração do CD-02** (é o primeiro depósito nos formulários): não tem zona de expedição/doca nem endereço refrigerado. Consequência: onda/pedido de saída no CD-02 é recusado (“Selecione uma doca ativa…”) e a NF-e de exemplo (com ADE-003 refrigerado), se recebida no CD-02, deixa uma tarefa de armazenagem sem endereço elegível. As regras estão corretas; incluir uma doca no CD-02 muda o mapa 3D da vitrine (teste `inventory-showcase` espera 144 células) e ficou para uma decisão de seed.
2. No formulário de nova onda, a lista de docas não é filtrada pelo depósito escolhido (mostra a doca do DEP-01 com o CD-02 selecionado); o servidor recusa com mensagem clara. Melhorar exige tornar o formulário dependente do depósito (cliente).
3. Toast de novidade “leve” não exercitável pela UI na versão atual (ver item 4).

## Verificação

- `npm run check`: lint e typecheck sem erros; 26 arquivos, 188 testes passando.
- `WMS_DEMO_MODE=true npm run build`: concluído.
- Recrawl final: 180 aberturas sem erro, sem rolagem horizontal; varredura de acessibilidade sem achados.

## Capturas (pasta de rascunho `qa/navegador/shots/`)

- Entrada: `01-nfe-vinculos`, `02-recebimento-criado`, `03-conferencia`, `04-conferido`, `05-armazenagem`, `06-tarefa-armazenagem`
- Saída: `08-pedido-saida`, `09-onda`, `10-tarefa-separacao`, `11-pedido-conferencia`, `12-expedido`
- Operações: `13-transferencia`, `14-reposicao`, `15-devolucao`, `16-docas`, `17-producao`, `18-comex-importacao`
- Inventário: `19-inventario-mapa`, `20-vista-frontal`, `21-inventario-contado`, `22-inventario-submetido`, `23-inventario-concluido`, `27-inventario-operador-cego`, `27-inventario-auditor`, `27-inventario-supervisor`, `39-inventario-vitrine-1440/390`, `40-mapa-selecionado-1440/390`
- Gestão: `24-divergencias`, `25-integracao-email`, `25b-processar-fila`, `26-usuario-criado`, `33-etiquetas-enderecos`, `34-relatorios`, `35-curva-abc`, `36-produtividade`
- Novidades e coletor: `28-novidades`, `29-novidades-celular`, `30-coletor`, `31-coletor-consulta`, `32-coletor-tarefa`
- Públicas: `37-1440_*`, `37-390_*`, `38-site-vaga`
- Varredura de rotas: `desk-light_*`, `desk-dark_*`, `mob-light_*`, `mob-dark_*`
