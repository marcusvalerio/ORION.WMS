# Diretrizes de marca do ORION

> Resumo prático do livro de marca. O livro completo está em
> [`livro-de-marca-orion.pdf`](./livro-de-marca-orion.pdf) e em [`livro-de-marca-orion.html`](./livro-de-marca-orion.html).
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
- O símbolo fica à esquerda e o nome **ORION** em Gabarito 600, com letter-spacing de +14%.
- O símbolo tem 1,25× a altura das maiúsculas.
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

### Não fazer
- Distorcer, inclinar ou girar a assinatura.
- Aplicar gradiente, sombra, brilho ou contorno.
- Trocar a fonte do nome.
- Usar cores fora da paleta.
- Colocar sobre fotos sem contraste.
- Rodear a marca de estrelas, brilhos ou partículas.

### Anel
- Em telas grandes, o símbolo se abre em um anel fino que gira uma volta a cada **70 s** (`<OrionRing />`).
- O cinturão são **três pontos em linha** e nada mais. É o único elemento decorativo animado da marca.

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
  - na assinatura, +14%.
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
| Anel | 70 s | Uma volta |

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
Quatro elementos saem do símbolo e da constelação. Use no máximo dois por peça; o cinturão combina com todos.

- **Símbolo recortado:** o O gigante, sangrando para fora da peça. Nunca inteiro e pequeno no meio.
- **Anel:** órbita em traço de 1 px, com uma segunda órbita tracejada por dentro.
- **Cinturão:** três pontos em linha, inclinados 18°. É a assinatura sem palavras.
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
  - **Número:** KPI gigante dentro do anel, com o cinturão como marcador;
  - **Dica:** fundo Gelo com padrão de barras e um passo por coluna.
- **Story:** o anel ocupa a tela e o cinturão é o ponto de foco.
- **Carrossel:** o símbolo gigante atravessa os cards e só se completa no último.
- **Perfil:** símbolo com o anel por fora. **Capa do LinkedIn:** o cinturão cruza a peça.
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

### Papelaria e apresentações
Na papelaria, o símbolo é o protagonista: grande e recortado, como uma janela para o O.

- **Cartão de visita** (90×50 mm): a frente é Noite com o símbolo sangrando e o cinturão; o verso é branco, com o cinturão marcando o nome.
- **Papel timbrado** A4: padrão de barras na faixa lateral e assinatura no topo.
- **Envelope:** símbolo recortado na aba.
- **Assinatura de e-mail:** símbolo de 16 px, com o cinturão como divisor.
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
