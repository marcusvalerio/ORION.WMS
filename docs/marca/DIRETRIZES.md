# Diretrizes de marca do ORION

> Resumo prático do livro de marca. O livro completo está em
> [`livro-de-marca-orion.pdf`](./livro-de-marca-orion.pdf) e em [`livro-de-marca-orion.html`](./livro-de-marca-orion.html).
> Arquivos do logo (SVG com o nome em curvas e PNG transparente) em [`arquivos/`](./arquivos/).
> Os tokens de verdade vivem em `src/app/globals.css`. Se este arquivo e o código discordarem, o código vale.

**Conceito:** Céu de inverno. Órion é a constelação que se acha sem esforço, e o armazém pede o mesmo: cada caixa no lugar certo, e você sabe onde.

**Atributos:** Preciso · Calmo · Guia.

---

## 0. Estratégia

| | |
|---|---|
| **Propósito** | Dar ordem ao que se move. |
| **Missão** | Que cada operação saiba onde está cada item, agora. |
| **Visão** | Ser o céu pelo qual a logística brasileira se orienta. |
| **Promessa** | Cada caixa no lugar certo, e você sabe onde. |

**Valores:** Exatidão antes de velocidade · Clareza no chão · Calma sob pressão · Integração sem atrito.

**Posicionamento:** para operações de armazém que cresceram além da planilha, o ORION é o WMS que organiza estoque e expedição sem projeto de implantação de seis meses, porque já nasce ligado ao ERP.

**Público:**
- **Gestor:** quer ver acuracidade, custo e prazo, e usa o computador.
- **Líder de turno:** quer status claro e alerta cedo.
- **Operador:** usa o coletor e precisa de texto grande e código claro.

**Personalidade (somos / não somos):**
- seguro, não arrogante;
- direto, não seco;
- técnico, não hermético;
- calmo, não apagado;
- moderno, não modinha;
- próximo, não íntimo.

---

## 1. Marca

### Símbolo
- Sete colunas de barras recortadas formam um **O**. Também podem ser lidas como prateleiras vistas de cima.
- A geometria é fixa e está em `src/components/brand/orion-mark.tsx` (`ORION_COLUMNS`). **Nunca redesenhe à mão.** Use `<OrionMark />`.
- As colunas ficam entre −0,70R e +0,70R. As larguras vão de 0,045R a 0,19R. O vão mínimo entre barras é 0,06R.

### Assinatura
- O símbolo fica à esquerda e o nome **orion**, em minúsculas, Gabarito 600, com espaçamento levemente fechado (`tracking-tight`).
- O nome tem **0,68×** a altura do símbolo, como no componente `<OrionLogo />`. Abaixo dele pode vir o descritor “Gestão de armazéns” em Inter 11.
- **Área de proteção:** deixe livre em volta a largura da letra O.
- **Tamanho mínimo:**
  - na tela, o símbolo tem 16 px;
  - no impresso, 6 mm;
  - abaixo disso, use só o símbolo.

| Fundo | Cor da assinatura |
|---|---|
| Branco / Gelo 50 | Noite `#060B2A` |
| Noite | `#EAF1FB` |
| Céu 50–100 | Noite 700 `#172354` |
| Céu 600 | Branco |

### Versões
- **Horizontal** (preferencial): site, sistema e papelaria.
- **Vertical**: peças quadradas ou estreitas, brindes e placas.
- **Elemento-síntese** (só o símbolo): app, perfil e favicon.
- **Positiva**: Noite sobre fundo claro.
- **Negativa**: Gelo sobre Noite.
- **Monocromática**: preto 100%.
- **Traço**: laser, bordado e relevo seco.

### Aplicação sobre fundos
- **Fundos claros:** versão positiva.
- **Fundos escuros:** versão negativa.
- **Tons médios e fotos movimentadas:** **box** Noite, com a área de proteção como margem. Sem cantos arredondados e sem sombra.

### Assinatura conjunta
- As duas marcas têm a mesma altura visual e ficam separadas por um fio de 1 px em Gelo 300.
- A distância entre elas é **2x** (o dobro da área de proteção).
- **Ecossistema:** ORION | ATLAS, com “Universo ASTRAEUS” abaixo.
- **Com cliente:** no material do cliente, a marca dele vem primeiro; no nosso, o ORION vem primeiro.

### Redução máxima
| | Tela | Impresso |
|---|---|---|
| Horizontal | 72 px | 20 mm |
| Vertical | 40 px | 12 mm |
| Símbolo | 16 px | 6 mm |

### Não fazer
- Distorcer, inclinar ou girar a assinatura.
- Aplicar gradiente, sombra, brilho ou contorno.
- Trocar a fonte do nome.
- Usar cores fora da paleta.
- Colocar sobre fotos sem contraste.
- Rodear a marca de estrelas, brilhos ou partículas.

### Cinturão
- O cinturão é o O aberto em círculo: as **barras das sete colunas**, com as mesmas larguras, alturas e cortes, repetidas em volta de um anel (componente `<OrionRing />`).
- Tem de **84 a 96 barras** e **gira devagar**: 70 s por volta no topo do site, 240–260 s quando está ao fundo.
- **Onda:** a cada 4–6 s, uma onda percorre o anel afinando as barras e devolvendo a espessura.
- O centro fica livre para o título, um número ou o símbolo. Pode sangrar pela borda; não use abaixo de 240 px.
- **Paletas:** externo (céu, cobalto, noite e um toque de creme), interno (mais escuro), céu e tinta (marca d’água no claro).
- Órbitas de linha fina e pontos soltos **não** fazem parte da marca: o círculo do ORION é sempre feito de barras.

---

## 2. Tipografia

| Papel | Família | Pesos | Token |
|---|---|---|---|
| Títulos, KPIs, assinatura | **Gabarito** | 600 (fixo) | `--font-display` |
| Texto e interface | **Inter** | 400 · 500 · 600 | `--font-sans` |
| SKU, endereço, lote, chave NF-e | **Geist Mono** | 400 · 500 | `--font-mono` |

### Gabarito
- Os títulos usam sempre o peso **600**, nunca 700.
- **Letter-spacing:**
  - acima de 48 px, −3%;
  - de 24 a 48 px, −2%;
  - no logotipo, levemente fechado (`tracking-tight`).
- **Entrelinha:**
  - título de 1 linha, 92–100%;
  - de 2 linhas, 105%;
  - de 3 ou mais, 115%.
- Não use Gabarito em texto corrido, tabelas ou formulários.

### Inter
- O corpo de texto tem **14 px** no produto e **16 px** no site.
- Números em tabela levam `tabular-nums`.

### Geist Mono
- Use para todo valor que alguém vai ler em voz alta, digitar ou bipar.
- Nunca use em frases.

### Escala
| Nível | Tamanho | Família |
|---|---|---|
| Display | 64 | Gabarito 600 |
| Título | 32 | Gabarito 600 |
| Seção | 20 | Gabarito 600 |
| Corpo | 14 | Inter 400 |
| Rótulo | 12 | Inter 500 |
| Código | 13 | Geist Mono |

---

## 3. Cor

As cores **Noite** e **Gelo** formam 90% de qualquer tela. **Céu** marca ação e seleção. **Creme** é o calor raro, para destaques e novidades.

| Nome | Hex | Uso |
|---|---|---|
| Noite 900 | `#060B2A` | Texto principal, botão primário, fundo escuro |
| Noite 700 | `#172354` | Hover do primário |
| Noite 500 | `#33448F` | Série em gráfico |
| Céu 600 | `#2D77CC` | Links, ação, foco |
| Céu 400 | `#7DB7F0` | Ação no tema escuro |
| Céu 100 | `#DCEBFC` | Seleção |
| Gelo 50 | `#F7F9FC` | Fundo da aplicação |
| Gelo 200 | `#DCE8F3` | Linhas |
| Gelo 400 | `#A6B3C6` | Desabilitado |
| Gelo 600 | `#5E6A82` | Texto secundário |
| Gelo 900 | `#1A2238` | Superfície no escuro |
| Creme 100 | `#FFF8E7` | Fundo de novidades |
| Creme 500 | `#DDB54C` | Destaque |

### Especificação para impressão (referência, validar com prova de cor)
| Cor | HEX | RGB | CMYK | Pantone |
|---|---|---|---|---|
| Noite | `#060B2A` | 6 11 42 | 100 90 35 65 | 2766 C |
| Noite 700 | `#172354` | 23 35 84 | 100 85 25 35 | 2758 C |
| Céu 600 | `#2D77CC` | 45 119 204 | 80 45 0 0 | 2172 C |
| Céu 400 | `#7DB7F0` | 125 183 240 | 48 15 0 0 | 284 C |
| Gelo 200 | `#DCE8F3` | 220 232 243 | 12 4 2 0 | 656 C |
| Gelo 600 | `#5E6A82` | 94 106 130 | 65 50 30 15 | 7545 C |
| Creme 500 | `#DDB54C` | 221 181 76 | 12 28 78 2 | 7407 C |
| Ok | `#12A27A` | 18 162 122 | 80 10 65 0 | 3405 C |
| Crítico | `#E03A45` | 224 58 69 | 5 90 70 0 | 1788 C |

### Estados
As cores de estado servem só para estado, nunca para decorar.

| Estado | Sólido | Fundo | Texto |
|---|---|---|---|
| Ok | `#12A27A` | `#E8F7F1` | `#0B6B4F` |
| Atenção | `#E0A100` | `#FFF6DB` | `#7A5300` |
| Crítico | `#E03A45` | `#FDECEC` | `#A3202A` |
| Info | `#4E97E3` | `#F1F7FE` | `#1E4C82` |

### Contraste
- Texto corrido precisa de **AAA (7:1)**.
- Títulos grandes e ícones precisam de no mínimo **AA (4,5:1)**.
- Céu 400 não carrega texto longo, e Creme não carrega texto branco pequeno.
- Se a cor é a primeira coisa que alguém nota, há cor demais.

### Tema escuro
O escuro não é o claro invertido:
- Noite vira fundo;
- Gelo 900 vira superfície;
- Céu 400 assume a ação.

O produto nasce no tema claro.

---

## 4. Gráficos

- **Ordem das séries:**
  1. Noite
  2. Céu 600
  3. Céu 400
  4. Creme 500
  5. Ok
  6. Gelo 400
- Use no máximo **3 séries por gráfico**. Acima disso, divida.
- Vermelho e amarelo são reservados para estado.
- **Pílulas de estado:**
  - uma ou duas palavras, sempre com o ponto de cor;
  - fundo claro com texto escuro do mesmo estado;
  - nunca são botão;
  - uma por linha de tabela;
  - o texto sempre diz o estado, e a cor nunca é o único sinal.
- **Cartazes:** fundo Noite chapado, uma frase e a assinatura pequena.
- Nenhum elemento existe só para enfeitar.

---

## 4b. Ícones, imagem e grid

### Ícones
- Os ícones vêm da família **Lucide**, com traço de 1,5 px numa grade de 24 px e sem preenchimento.
- Os tamanhos são 16, 20 e 24 px, e a cor é a do texto ao lado.
- Sempre têm rótulo, exceto em ações universais.
- Não misture ícones de traço com ícones preenchidos.

### Fotografia
- Mostre armazéns reais e pessoas com EPI, trabalhando.
- Luz natural ou fria, temperatura levemente azulada.
- Prefira enquadramentos de corredor, com linhas verticais.
- **Evitar:**
  - banco de imagem genérico;
  - filtros quentes;
  - galáxias, estrelas e céus digitais;
  - telas flutuando.

### Grid
- O grid tem **12 colunas** no desktop, com calha de 24 px; 8 colunas no tablet; 4 no celular.
- Espaços em múltiplos de 4: 4, 8, 12, 16, 24, 32, 48, 64.
- Nas peças, o texto ocupa no máximo 7 colunas.

---

## 4c. Gráficos do sistema (referência: o dashboard em produção)
- **KpiCard:**
  - rótulo em Inter 12 medium, cor secundária;
  - valor em Inter 28 medium, tabular, com “un” menor para quantidades;
  - dica de contexto abaixo do valor;
  - mini barras dos últimos dias, com hoje em azul;
  - selo Atenção ou Crítico só quando o número pede ação;
  - ícone de informação com a definição do cálculo.
- **Os 12 indicadores:** Produtos ativos, Endereços ativos, Ocupação do armazém, Recebimentos pendentes, Em conferência, Aguardando armazenagem, Tarefas pendentes, Produtos bloqueados, Pedidos a separar, Pedidos expedidos e Divergências em aberto.
- **GlyphGauge:** o símbolo como medidor. Os 14 trechos acendem em Céu 400 coluna a coluna, de baixo para cima; o resto fica em Gelo 200.
- **BlockBar:** 12 blocos de larguras variadas. Acima de 70%, os blocos cheios passam para Atenção.
- **Recebimentos × expedições:** colunas empilhadas, Noite para entrada e Céu 600 para saída.
- **Tarefas por tipo:** concluídas na base, em execução no meio e pendentes no topo.
- **Na dúvida, a referência é a tela do sistema, não este documento.**

## 5. Interface

- **Raios** (tokens `--radius-sm/md/lg`):
  - 6 px para elementos pequenos;
  - 10 px para cartões e campos;
  - 18 px para painéis e diálogos.
- **Botões** são sempre em pílula. O primário é Noite, o secundário tem contorno Gelo 300 e o perigo é Crítico sólido.
- **Separação:** objetos se separam com contorno de 1 px. Sombra só em camadas que flutuam (menus, diálogos, avisos).

### Movimento

| Ação | Duração | Detalhe |
|---|---|---|
| Entrar | 180–240 ms | Sobe 8 px + opacidade |
| Sair | 120 ms | Só opacidade |
| Números (KPI) | 1,4 s | Contam até o valor |
| Ícones / cards | +60 ms cada | Em cascata |
| Cinturão | 70 s (topo) / 240–260 s (fundo) | Uma volta; onda de 4–6 s nas barras |

- **Curva:** `cubic-bezier(.2,.7,.2,1)`.
- Com `prefers-reduced-motion`, tudo aparece pronto e não há animação.
- A página precisa estar completa mesmo sem JavaScript.
- Animações de rolagem usam IntersectionObserver, não `animation-timeline`, que não funciona no Safari.

---

## 6. Voz

O ORION fala como um bom líder de turno: direto, calmo, sem jargão de sistema.

- O verbo vem no início do botão: **Liberar onda**, **Separar**, **Expedir**.
- Números sempre com unidade: *24 un.*, *3 dias*.
- Os erros dizem o que houve e como resolver.
- Sem desculpas, sem exclamações, sem “Ops!”.
- Chame as coisas pelo nome usado no chão do armazém.

| Assim | Não assim |
|---|---|
| Separar 24 un. em A-03-12-B | Executar tarefa de picking #8841 |
| NF-e rejeitada: CNPJ do destinatário inválido. Corrija no pedido 1.042 e envie de novo. | Ops! Algo deu errado. Tente novamente mais tarde. |
| Inventário fechado. 3 divergências ajustadas. | Parabéns!!! Processo concluído com sucesso! |

---

## 6b. Aplicações

### Kit de elementos
Três elementos saem do símbolo. Use no máximo dois por peça.

- **Símbolo recortado:** o O gigante, sangrando para fora da peça. Nunca inteiro e pequeno no meio.
- **Coluna acesa:** uma das sete colunas em Céu e as outras em tom sobre tom. Marca o item em foco.
- **Cinturão:** as barras do símbolo em volta de um círculo, girando devagar. É a assinatura sem palavras.
- **Padrão de barras:** as colunas do símbolo repetidas, como prateleiras.

### Redes sociais
| Formato | Tamanho |
|---|---|
| Feed | 1080×1350 |
| Quadrado / carrossel | 1080×1080 |
| Story | 1080×1920 (zona segura de 250 px em cima e embaixo) |
| LinkedIn post | 1200×627 |
| Capa LinkedIn | 1584×396 |

- **Três famílias de post:**
  - **Novidade:** fundo Noite, símbolo recortado ao fundo e etiqueta Creme;
  - **Número:** um indicador real do dashboard (ex.: 45,9% de ocupação) dentro do cinturão, com o símbolo-medidor acima;
  - **Dica:** fundo Gelo com padrão de barras e um passo por coluna.
- **Story:** o cinturão ocupa a tela, cortado pelas bordas.
- **Carrossel:** o símbolo gigante atravessa os cards e só se completa no último.
- **Perfil:** só o símbolo. **Capa do LinkedIn:** o cinturão entra cortado pela direita.
- Cada post diz uma coisa só. A assinatura fica pequena, embaixo à esquerda.
- **Carrossel:** o primeiro card promete e o último assina. O contador de páginas vai em Geist Mono (`01/03`).
- **Foto de perfil:** só o símbolo, em Gelo sobre Noite.

### Novidades
Cada recurso novo é anunciado em três lugares com o mesmo texto:
1. **No sistema**, em um cartão de Novidades com demonstração animada.
2. **Por e-mail**, com título, uma frase e um botão.
3. **Nas redes**, em um post de Novidade.

**Como escrever o texto:**
- **Título:** o que mudou, em até 6 palavras.
- **Frase:** o que a pessoa ganha.
- **Botão:** verbo + lugar, como “Abrir Comex”.

A etiqueta “Novo” sai depois de 30 dias.

### Armazém
- **Etiqueta de endereço** (100×50 mm):
  - endereço em Geist Mono, o maior possível;
  - Code 128 abaixo;
  - fundo branco e texto Noite.
- **Placas de doca e de rua:**
  - fundo Noite com letras Gelo;
  - letra com 1 cm de altura a cada 3 m de distância de leitura.
- **Crachá** (86×54 mm): nome, função e turno, código do operador em Mono e o símbolo.

### Fachada e frota
- **Fachada do galpão:** faixa Noite na platibanda, símbolo na quina e placas “DOCA 0n” em Gabarito.
- **Frota:** furgão branco com faixa Noite na base, assinatura na lateral e símbolo na porta.
- A sinalização de segurança (NR-26) tem prioridade sobre a marca.

### Crachá
- PVC 54×86 mm, com o símbolo inteiro e grande, cortado pela borda.
- **A cor das barras indica a função:** Céu para operação, Creme para liderança de turno, Gelo para visitante.
- Nome em Gabarito, função em caixa alta espaçada e código em Geist Mono. O cordão é Noite, com as barras em Céu.

### Coletor
- Barra superior Noite com o símbolo e a palavra **Coletor**.
- Três ações grandes em cartões com contorno: **Minhas tarefas**, **Contagem de inventário** e **Consulta rápida**.
- Ícone à esquerda, título em Gabarito e contagem logo abaixo.
- Alvo de toque mínimo de 56 px.
- Sem gráficos e sem cor decorativa.

### Etiqueta de endereço (como o sistema gera)
- Depósito, zona e tipo no topo, em texto pequeno.
- Rua · Módulo · Nível · Posição em Geist Mono grande, com o rótulo acima de cada par.
- Code 128 do endereço completo, com uma seta indicando se o nível fica acima ou abaixo.

### Papelaria e apresentações
Na papelaria, o símbolo é o protagonista: grande e recortado, como uma janela para o O.

- **Cartão duplex** (85×55 mm, 2×350 g): Noite por fora e Céu 400 por dentro. O símbolo é vazado a laser na frente, e o azul aparece pelos cortes. O verso é branco, com o símbolo em relevo seco, e a borda é pintada em Céu.
- **Cartão coluna** (55×85 mm): série de 7 cartões, um por coluna do símbolo, com a coluna da pessoa acesa em hot stamping Céu e numeração 01/07 a 07/07. Juntos, os sete formam o O.
- **Papel timbrado** A4: padrão de barras na faixa lateral e assinatura no topo.
- **Envelope:** símbolo recortado na aba.
- **Assinatura de e-mail:** símbolo de 16 px.
- **Acabamento:** papel sem brilho; símbolo em verniz localizado ou hot stamping azul Céu.
- **Slides em 16:9:** a abertura é em Noite e o conteúdo, em branco.

### Acessibilidade
- O contraste do texto é AAA.
- **Alvo de toque:**
  - mínimo de 44 px;
  - no coletor, 56 px, para uso com luva.
- Cor nunca é o único sinal.
- Tudo funciona pelo teclado, com foco visível em Céu 600.
- “Reduzir movimento” desliga as animações.
- Linhas de texto com até 70 caracteres.

---

## 7. Ecossistema ASTRAEUS

| Sistema | Papel |
|---|---|
| **ORION** | Armazém: recebimento, endereçamento, separação, inventário e expedição |
| **ATLAS** | ERP: pedidos, notas fiscais, financeiro e os cadastros que alimentam o ORION |
| **ASTRAEUS** | A casa dos sistemas, com login único e dados compartilhados |

Nos materiais do ORION, o ecossistema aparece só como assinatura discreta no rodapé: **“ORION é do universo ASTRAEUS”**.

---

## Arquivos da marca (`docs/marca/arquivos/`)
| Arquivo | Formatos | Uso |
|---|---|---|
| `orion-logo-horizontal-noite` | SVG · PNG | Principal, sobre fundos claros |
| `orion-logo-horizontal-branco` | SVG · PNG | Negativa, sobre Noite e fotos |
| `orion-logo-horizontal-preto` | SVG · PNG | Monocromática |
| `orion-logo-vertical-{noite,branco,preto}` | SVG · PNG | Peças quadradas e estreitas |
| `orion-simbolo-{noite,branco,preto,ceu}` | SVG · PNG 1024 | Elemento-síntese |
| `orion-icone-app` | SVG · PNG 32/180/512/1024 | Ícone do app e favicon |

No código, use os componentes `<OrionLogo />` e `<OrionMark />`.

## Checklist antes de publicar

- [ ] O símbolo veio de `<OrionMark />`, sem desenho à mão.
- [ ] Os títulos estão em Gabarito 600; o texto, em Inter; os códigos, em Geist Mono.
- [ ] Todas as cores vêm dos tokens, sem hex solto no componente.
- [ ] O contraste do texto é AAA.
- [ ] A cor de estado só aparece em estado.
- [ ] Os raios são 6, 10 ou 18, e os botões são em pílula.
- [ ] O movimento respeita `prefers-reduced-motion`.
- [ ] Os textos seguem o tom de voz: verbo no início, unidade nos números, nada de “Ops!”.
- [ ] Não há estrelas, brilhos falsos nem gradientes.
