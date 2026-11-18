# ORION · Guia de design

> **Calmo como o céu de inverno. Preciso como uma constelação.**

Leia antes de criar ou mudar qualquer tela, material ou animação do ORION.
Os tokens vivem em `src/app/globals.css`; o anel e o símbolo, em `src/components/brand/`.

## 1. Personalidade

Palavras da marca: **calmo · técnico · preciso · integrado** — e, só como acento, *transcendental*.

- A interface do dia a dia é **calma**: fundo claro, pouco movimento, hierarquia por tipografia e espaço, não por efeito.
- A energia (tipografia gigante, anel girando, frases de impacto) fica para **momentos de marca**: site, apresentação comercial, LinkedIn, tela de login. Não para dentro do fluxo de trabalho.
- Movimento só quando explica algo (o laser lendo o código, a posição acendendo na contagem). Nunca decoração contínua dentro do sistema. Tudo para com `prefers-reduced-motion`.

## 2. Tom de voz

- Frases curtas, voz ativa. **O botão diz o que vai acontecer**: “Liberar armazenagem”, não “Processar item”; “Confirmar contagem”, “Recontar”.
- Fala a língua do armazém: endereço, doca, onda, palete, lote. Códigos sempre em Geist Mono (`ARM-02-07-03`, `PC-4588`, `NF 000.456`).
- Marketing pode provocar (“O armazém que os outros vão copiar.”, “Leu. Achou. Contou.”). O sistema, não: informa e orienta.

## 3. Cores — “Céu de inverno”

Escalas base (50–900): **noite** (azul-marinho, 900 `#060B2A`, 950 `#03061A`), **céu** (400 `#7DB7F0`, 600 `#2D77CC`), **gelo** (cinzas azulados, 50 `#F7F9FC`, 200 `#DCE8F3`), **creme** (100 `#FFF8E7`, 300 `#F8E2A6`), **cobalto** (600 `#2563EB`, só foco/seleção).

Três modos de interface (todo texto ≥ 4,5:1):

| Papel | Claro · dia a dia | Escuro · noite | Modo inventário |
|---|---|---|---|
| fundo | `#F7F9FC` | `#060B2A` | `#03061A` |
| superfície | `#FFFFFF` | `#0D163B` | `#0D163B` |
| contorno | `#DCE8F3` | `#22306F` | `#172354` |
| texto | `#060B2A` | `#EEF1FA` | `#FFF8E7` |
| texto secundário | `#46516A` | `#A6B3C6` | `#9DC7F4` |
| ação principal | `#060B2A` | `#7DB7F0` | `#FFF8E7` |
| texto na ação | `#FFF8E7` | `#060B2A` | `#060B2A` |
| destaque | `#7DB7F0` | `#FFF8E7` | `#7DB7F0` |
| foco/seleção | `#2563EB` | `#9DC7F4` | `#F8E2A6` |

**Situações** — cada uma com fundo suave, texto, contorno e cor sólida, no claro e no escuro. **Sempre com rótulo, nunca só cor.**

| Situação | Usos | Sólida |
|---|---|---|
| Sucesso | concluído, expedido, aprovado | `#12A27A` |
| Atenção | prazo, validade, aguardando | `#E0A100` |
| Crítico | divergência, bloqueio, falha | `#E03A45` |
| Informação | previsto, conferido, dica | `#4E97E3` |
| Em andamento | em conferência, em separação | `#2563EB` |
| Neutro | pendente, inativo, rascunho | `#7E8BA2` |

Gráficos: s1 `#060B2A`, s2 `#2D77CC`, s3 `#7DB7F0`, s4 `#DDB54C`, s5 `#12A27A`, s6 `#A6B3C6`. “Hoje” em azul; seleção no mapa em creme.

**Regras dos temas** (design system):
- Use sempre os **papéis** (`bg`, `surface`, `border`, `text`, `text-muted`, `action`, `on-action`, `accent`, `focus`), nunca o tom base direto. Cor forte só para ação, foco e situação.
- **Escuro** é escolha do usuário. **Modo inventário** entra sozinho nas telas de contagem.
- Situações têm `-bg`, `-fg` e sólido por tema: `success`, `warning`, `danger`, `info`, `progress`, `neutral`. No escuro/inventário os sólidos clareiam (ex.: success `#2CC593`, danger `#F2545E`) e os fundos escurecem (ex.: success-bg `#0B3A31`, danger-bg `#3D0F15`). Valores completos no design system.
- No escuro, a série 1 de gráfico vira `creme-100`.

## 4. Tipografia

- **Gabarito** — títulos e logotipo, peso **600** (não mais pesado na interface).
- **Inter** — todo o texto.
- **Geist Mono** — endereços e códigos (`ARM-02-07-03`, `CIA-001`, `L2410`, `PC-4588`, `NF 000.456`).

| Estilo | Família | Tamanho / linha | Peso |
|---|---|---|---|
| display | Gabarito | 40 / 44 | 600 |
| page-title | Gabarito | 24 / 30 | 600 |
| card-title | Gabarito | 16 / 22 | 600 |
| body | Inter | 14 / 20 | 400 |
| body-small | Inter | 13 / 18 | 400 |
| label | Inter | 12 / 16 | 500 |
| kpi | Inter | 28 / 32 | 500 |
| address | Geist Mono | 14 / 20 | 500 |
| address-hero | Geist Mono | 28 / 34 | 500 |
| code-small | Geist Mono | 12 / 16 | 400 |

- **Números** alinhados à direita, algarismos tabulares, unidade ao lado em texto secundário: `120 un`.
- Os títulos gigantes e pesados (site, posts) são de marketing, não da interface.

## 4b. Forma e espaço

- Espaçamento em múltiplos de 4 px: `space-1` 4 (vãos das barras do símbolo e dos gráficos), `space-2` 8 (ícone–rótulo), `space-3` 12 (entre campos), `space-4` 16 (padding de cartão), `space-6` 24 (entre seções), `space-8` 32 (margem da página).
- Raios: `radius-sm` 6 (selos de lote, células do mapa), `radius-md` 10 (campos, botões quadrados), `radius-lg` 18 (cartões, painéis), `radius-pill` 999 (botões principais e selos de situação), `radius-icon` 24% (ícone do app).
- **Contorno de 1 px em `border` no lugar de sombra.**
- **Gráficos e KPIs seguem o traço do símbolo**: barras verticais de espessuras diferentes, partidas por vãos de `space-1`; o valor continua lido pela altura ou pela quantidade de barras cheias. Séries `chart-1` a `chart-6`, nessa ordem.

## 5. Marca

- Símbolo: sete colunas verticais de espessuras diferentes, partidas em trechos de corte reto, formando um círculo; nenhum trecho menor que 1/5 da altura. Logotipo = símbolo + “orion” em minúsculas, Gabarito. Ícone do app: fundo `ceu-400`, barras `noite-900`, cantos `radius-icon`.
- Geometria (unidades do raio R; centro x · largura · trechos verticais):

  | x | largura | trechos |
  |---|---|---|
  | -0,70 | 0,15 | -0,30…-0,06 · 0,04…0,34 |
  | -0,44 | 0,19 | -0,58…-0,14 · -0,04…0,58 |
  | -0,17 | 0,13 | -0,80…-0,40 · -0,30…0,22 · 0,32…0,80 |
  | 0,08 | 0,17 | -0,86…0,08 · 0,18…0,86 |
  | 0,32 | 0,10 | -0,78…-0,16 · -0,06…0,78 |
  | 0,52 | 0,07 | -0,62…0,14 · 0,24…0,62 |
  | 0,70 | 0,045 | -0,44…0,44 |
- Uso correto: sobre céu-400, creme ou noite. Evitar pouco contraste e trocar fonte ou caixa (nada de “ORION” em itálico/maiúsculas no logotipo).
- Abaixo de 24 px o símbolo perde os cortes e fica só com as colunas cheias.
- Respiro mínimo = altura do “o” em volta de toda a marca.
- Avatar e favicon: sempre o símbolo sobre céu-400.
- Ecossistema **ASTRAEUS**: atlas (ERP · MRP · MCN, creme), orion (WMS, céu), tms (em breve, tracejado).

## 6. Iconografia

Lucide, traço 1,75 px, sempre na cor do texto ao redor. O leitor (`scan-barcode`) abre o coletor a partir da busca do topo.

> Fonte: design system “ORION Design System” (artefato do claude.ai), imagens de marca, painel, sinalização e LinkedIn, e a apresentação comercial. Divergência em aberto: o design system diz “WMS do ecossistema **ATLAS**”; marca, site e apresentação usam ecossistema **ASTRAEUS** (com ATLAS como o ERP).

## 7. Aplicações de referência

- **Painel claro**: cartões brancos com número em Gabarito + sparkline (hoje em cobalto), ação principal em pílula noite, um cartão escuro de destaque (ocupação com o símbolo).
- **Modo inventário**: “O CD apaga a luz. A contagem acende.” Fundo noite-950, posições pela situação da contagem, a selecionada em creme.
- **Coletor**: “Leia o código. Caia na tarefa certa.” O leitor fica dentro da busca.
- **Impressos e sinalização**: etiqueta de endereço 100×50 mm (código grande em mono), etiqueta de palete 100×150 mm com faixa noite e LPN, placas de rua/doca com número enorme (zona em céu, recebimento em creme, expedição em noite com contorno céu), crachá noite, colete com faixa creme refletiva.
- **Comercial/LinkedIn**: capa noite com degradê, posts em noite/creme/céu, um número ou uma frase por peça.

## 8. O que já não funcionou

- Onboarding com anel girando o tempo todo e chamadas de impacto (“Primeiro turno. Não um tour.”): bonito, mas fora do tom **calmo** — parecia peça de marketing dentro do sistema.
