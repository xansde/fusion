# 06 — Canvas e Renderização

- **Título:** Canvas e Renderização do Fusion VTT
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/03-foundry-canvas-rendering.md`
  - `docs/research/15-vtt-opensource-e-bibliotecas.md`

> **Aviso clean-room.** Esta spec descreve a camada de canvas própria do Fusion. Onde menciona o Foundry VTT, refere-se apenas a comportamento e conceitos observáveis publicamente (Knowledge Base, API docs), usados como referência de design. Nenhum código proprietário do Foundry é reproduzido; nomes de classe próprios do Foundry (`PrimaryCanvasGroup`, `PlaceableObject`, etc.) são citados apenas como referência conceitual — o Fusion adota nomenclatura própria. Os algoritmos geométricos (visibility polygon, hex math) seguem fontes abertas (Red Blob Games, Nicky Case) e bibliotecas MIT (`honeycomb-grid`, `@countertype/clipper2-ts`).

---

## Objetivo

Definir a camada de renderização 2D do Fusion: como o canvas do mapa é estruturado em PIXI.js v8 (grupos, camadas, render groups para a câmera), como funciona a abstração de grade (square, hex, gridless) com conversões pixel↔célula, snapping e medição de distância, e o modelo visual e de interação dos objetos posicionáveis (tokens, tiles, drawings, templates de medição, notas, ruler). Também fixa as metas de performance (60 fps com 50 tokens em mapa 10k×10k) e as técnicas de otimização (culling, atlas de textura, LOD).

Esta spec é a fonte de verdade para tudo que aparece **dentro do `<canvas>`** do mapa. Ela trata da apresentação e da interação local; o estado autoritativo desses objetos é persistido como Documents (`02-modelo-de-dados.md`) e sincronizado pelo servidor (`04-rede-e-sincronizacao.md`). A UI fora do canvas (HUD, sidebar, fichas, diálogos), embora em Svelte, é tratada em `11-ui-framework-e-fichas.md`. O cálculo de visão/iluminação/fog tem spec própria (`07-visao-iluminacao-fog.md`); aqui definimos apenas onde essas camadas se encaixam na pilha de renderização.

---

## Escopo

### O que esta spec inclui

- A hierarquia de grupos e camadas PIXI v8 do canvas, e o uso de **Render Groups** para pan/zoom acelerado por GPU.
- A abstração de grade: `square`, `hex` (pointy/flat, odd/even) e `gridless`; conversões pixel↔célula, snapping configurável e medição de distância (incluindo a regra de diagonais 5-10-5 do PF2e).
- O modelo visual e de interação de **Tokens**: textura, ring/borda, barras de atributo, status icons, nameplate, elevação; movimento (drag, setas, animação interpolada, preview), seleção múltipla e targeting.
- **Tiles** (underfoot/overhead, oclusão), **Drawings** (formas, freehand, texto), **MeasuredTemplates** (circle, cone, line/ray, emanation conforme PF2e), **Notes** (map pins) e **Ruler**.
- A configuração de **Scene** relevante ao canvas (dimensões, grade, background/foreground, padding, initial view, ambiente) e a navegação/ativação de cenas do ponto de vista do canvas.
- As metas e técnicas de **performance** do canvas.

### O que esta spec NÃO inclui

- O algoritmo de **visão, iluminação e fog of war** (varredura radial, polígonos LOS, render textures, paredes/walls) → `07-visao-iluminacao-fog.md`. Aqui só se define a posição dessas camadas na pilha e o contrato visual.
- O **schema persistido** dos Documents de cena (Scene, Token, Tile, Drawing, Wall, AmbientLight, Note, MeasuredTemplate — e Region/RegionBehavior, que é **[V2]** conforme REQ-DOC-022) → `02-modelo-de-dados.md`. Esta spec referencia campos pelo nome, mas a definição normativa é lá.
- O **protocolo de sincronização** das mutações desses objetos (envelopes de socket, ack, broadcast, last-writer-wins) → `04-rede-e-sincronizacao.md`.
- **Permissões/ownership** que governam o que cada usuário pode ver e manipular no canvas → `05-usuarios-e-permissoes.md`.
- A UI Svelte de HUD, paletas de ferramentas, diálogos de config de objetos e fichas → `11-ui-framework-e-fichas.md`.
- O **motor de rolagens** disparado por interações (ex.: clicar um template que rola dano) → `08-motor-de-rolagens.md`.
- Áudio posicional vinculado a tokens/sons ambiente → `13-audio-e-playlists.md`.
- Pipeline de **assets/mídia** (formatos, upload, otimização de texturas no disco) → `20-assets-e-midia.md`. Aqui tratamos apenas do carregamento em GPU.
- **Scene Regions** com behaviors (Modify Movement Cost, Teleport, etc.) como subsistema de regras → **[V2]**, tratadas em `14-macros-e-automacao.md` / `02-modelo-de-dados.md` (REQ-DOC-022, DEC-MAC-04); no MVP, o canvas não renderiza nem processa Regions.

---

## Conceitos e terminologia

| Termo                                       | Definição no Fusion                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canvas**                                  | O elemento `<canvas>` único onde o mapa da cena ativa é renderizado via PIXI.js v8. Distinto da UI Svelte sobreposta.                                                                                                                                   |
| **Stage**                                   | Container raiz do PIXI (`app.stage`). Toda a hierarquia de grupos/camadas pende dele.                                                                                                                                                                   |
| **Group (grupo)**                           | Container de alto nível que agrupa camadas afins. O Fusion define quatro grupos: `PrimaryGroup`, `EffectsGroup`, `InterfaceGroup`, `OverlayGroup` (ver Decisões).                                                                                       |
| **Layer (camada)**                          | Container especializado dentro de um grupo, responsável por um tipo de conteúdo (ex.: `TokenLayer`, `TileLayer`). Uma camada pode ser **interativa** (recebe input) ou apenas **renderizada**.                                                          |
| **Render Group (PIXI v8)**                  | Otimização do PIXI v8: um container marcado como render group tem sua transformação (pan/zoom) aplicada na GPU, habilitando câmera 2D acelerada por hardware (research 15 §3.1). O Fusion usa um render group na raiz do "mundo da cena" para pan/zoom. |
| **Placeable (objeto posicionável)**         | Objeto visual no canvas espelhando um Embedded Document da cena: Token, Tile, Drawing, MeasuredTemplate, Note, Wall, AmbientLight. Tem posição, transformação e estado de seleção/hover.                                                                |
| **Camada ativa (active tool layer)**        | A única camada interativa que recebe input de ponteiro por vez (ex.: TokenLayer ativa quando a ferramenta de tokens está selecionada). Mudar de ferramenta troca a camada ativa.                                                                        |
| **Scene coordinates (coordenadas de cena)** | Sistema de coordenadas interno em pixels, com origem no canto da área da cena (incluindo padding). Independe do zoom/pan.                                                                                                                               |
| **Client coordinates**                      | Pixels na viewport do navegador (evento de mouse). Convertidos para scene coordinates via a inversa da transformação do render group.                                                                                                                   |
| **Cell / célula**                           | Unidade da grade (um quadrado ou hexágono). Identificada por offset `(i, j)`.                                                                                                                                                                           |
| **gridSize**                                | Tamanho da célula em pixels (lado do quadrado ou largura entre lados paralelos do hex). Mínimo 50 px.                                                                                                                                                   |
| **gridDistance / gridUnits**                | Distância que uma célula representa no jogo (ex.: 5) e a unidade (ex.: "ft", "m", "quadrados").                                                                                                                                                         |
| **Footprint**                               | Quantas células um token ocupa (`width`×`height` em células). Distinto da `scale` visual da arte.                                                                                                                                                       |
| **Snapping**                                | Ajuste automático de uma posição livre para um ponto válido da grade (centro de célula, vértice, aresta, interseção), conforme a resolução de snap configurada.                                                                                         |
| **Targeting**                               | Marcar um ou mais tokens como alvos de uma ação (distinto de selecionar/controlar). Alvos são visíveis aos outros usuários conforme política.                                                                                                           |
| **Culling**                                 | Não processar/renderizar objetos fora do viewport visível, para economizar CPU/GPU.                                                                                                                                                                     |
| **LOD (Level of Detail)**                   | Reduzir/ocultar detalhe (ex.: nameplates) conforme o zoom, para manter performance e legibilidade.                                                                                                                                                      |
| **Texture atlas**                           | Spritesheet que agrega várias texturas pequenas (ícones de status, ring) numa só, reduzindo trocas de textura e draw calls.                                                                                                                             |

---

## Decisões

Cada decisão lista alternativas rejeitadas e o racional.

### D1 — Hierarquia de quatro grupos sobre um único `PIXI.Application`

O canvas usa **um** `PIXI.Application` (WebGPU com fallback WebGL) cujo `stage` contém quatro grupos, do fundo ao topo: **PrimaryGroup** (conteúdo físico da cena: background, tiles, drawings, tokens, overhead, foreground), **EffectsGroup** (weather, iluminação, visão, fog — detalhe em `07`), **InterfaceGroup** (objetos interativos da cena que não são físicos: templates, notes, walls (GM), grid, controles de seleção) e **OverlayGroup** (elementos que NÃO seguem o transform do mundo: ruler, pings, cursores de outros usuários).

- **Alternativas rejeitadas:**
  - _Pilha plana de camadas sem grupos_ (só uma lista ordenada por z-index): dificulta aplicar efeitos/máscaras a um subconjunto inteiro (ex.: a máscara de visão deve afetar todo o Primary de uma vez) e mistura objetos físicos com UI de canvas.
  - _Replicar literalmente a taxonomia de grupos do Foundry_ (`Hidden`, `Rendered`, `Environment`, `PrimaryCanvasGroup`, `EffectsCanvasGroup`, `VisibilityCanvasGroup`, `InterfaceCanvasGroup`, `OverlayCanvasGroup` — research 03 §2): mais granular do que o MVP precisa e atrelado a nomenclatura proprietária. O Fusion consolida em quatro grupos com a mesma intenção funcional.
- **Racional:** A pesquisa mostra que o agrupamento físico (Primary) × efeitos × interface × overlay é o que viabiliza (a) aplicar a máscara de visão e os filtros de iluminação ao bloco físico inteiro de uma vez, e (b) manter ruler/pings fixos ao stage transform sem herdar o pan/zoom do mundo (research 03 §2, §3, §17). Quatro grupos cobrem a intenção sem o peso da taxonomia completa. A ordem de renderização visual segue a pesquisa: background → tiles underfoot → tokens → tiles overhead → foreground → weather → iluminação/visão → templates → controles → ruler (research 03 §3).

### D2 — Render Group na raiz do "mundo da cena" para pan/zoom acelerado

A transformação de câmera (pan e zoom) é aplicada a **um** container que envolve PrimaryGroup + EffectsGroup + InterfaceGroup, marcado como **Render Group** do PIXI v8. O OverlayGroup fica **fora** desse container (não recebe a transformação do mundo).

- **Alternativas rejeitadas:**
  - _Aplicar pan/zoom mexendo no `position`/`scale` do `stage` inteiro a cada frame na CPU_: força recálculo de transform em toda a árvore na CPU; com mapas grandes e muitos placeables, é exatamente o custo que o PIXI v8 elimina com Render Groups (research 15 §3.1: "Render Groups: containers podem usar GPU para transformações, habilitando câmera 2D hardware-accelerated — fundamental para pan/zoom em mapas grandes").
  - _Escalar o background e reposicionar cada objeto individualmente_: inviável e propenso a drift de coordenadas.
- **Racional:** Render Groups são o mecanismo nativo do PIXI v8 para câmera 2D eficiente (research 15 §3.1, §16). Manter o Overlay fora do render group do mundo garante que ruler, pings e cursores permaneçam em coordenadas de tela/cena fixas, como o "OverlayCanvasGroup" do Foundry que não segue o stage transform (research 03 §2). Limites de zoom default 0.1×–3× (research 03 §16.3), configuráveis.

### D3 — Abstração de grade com três implementações por trás de uma interface única

Define-se a interface `GridStrategy` com três implementações: `SquareGrid`, `HexGrid` (parametrizada por orientação pointy/flat e paridade odd/even) e `GridlessGrid`. Cada uma implementa conversão pixel↔célula, snapping, medição de distância e geração do highlight de células. A grade hexagonal usa **coordenadas cúbicas** internamente, apoiada na biblioteca **`honeycomb-grid`** (MIT) para a matemática.

- **Alternativas rejeitadas:**
  - _Só grade quadrada no MVP_: PF2e é quadrado 5ft, mas SF2e/Etmos e muitos mapas usam hex; deixar hex de fora forçaria refactor depois. A pesquisa recomenda explicitamente uma camada de abstração que suporte square/hex/gridless (research 15 §7.2).
  - _Implementar hex math do zero_: `honeycomb-grid` é MIT, TypeScript, estável e cobre pointy/flat, offset/axial/cube e shapes (research 15 §7.1). Reimplementar é risco desnecessário; usamos a lib para a matemática e implementamos nós a renderização/snapping no PIXI.
- **Racional:** Uma única interface isola o resto do canvas (movimento de token, templates, ruler) do tipo de grade concreto. Cubo como representação canônica do hex segue a convenção padrão (`q + r + s = 0`) e dá distância trivial `max(|Δq|,|Δr|,|Δs|)` (research 03 §5.2). Conversões `offset↔cube↔point` ficam na estratégia hex.

### D4 — Regra de diagonal configurável por cena, com o conjunto de regras da pesquisa

A medição em grade quadrada respeita uma regra de diagonal configurável por cena, do conjunto: `equidistant` (diagonal=1, D&D5e), `exact` (√2), `approximate` (1.5), `rectilinear` (2), `alternating_1` (alterna 1-2-1-2, **começa em 1** — **PF2e 5-10-5**, `ALTERNATING_1` do Foundry), `alternating_2` (alterna 2-1-2-1, começa em 2 — `ALTERNATING_2` do Foundry; suportado no MVP para fidelidade ao conjunto, marcado [V2] pois nenhum sistema-alvo o usa) e `illegal` (diagonal proibida). O **default para cenas de sistema PF2e é `alternating_1`**.

- **Alternativas rejeitadas:**
  - _Hardcode da regra euclidiana_: não atende PF2e (5-10-5) nem D&D (equidistante); a pesquisa enumera 7 regras distintas que o domínio exige (research 03 §5.1).
  - _Colapsar `alternating_1` e `alternating_2` em um único `alternating_5_10_5`_: a pesquisa distingue explicitamente as duas variantes por onde começam (research 03 §5.1: `ALTERNATING_1` começa em 1, `ALTERNATING_2` começa em 2). Usar um único nome causa ambiguidade na implementação da contagem acumulada de diagonais.
  - _Regra fixa por sistema sem override de cena_: GMs precisam ajustar por cena/encontro; manter configurável na cena é o comportamento esperado.
- **Racional:** A pesquisa lista as constantes de diagonal e identifica explicitamente `ALTERNATING_1` como a regra "PF2e 5-10-5" e `ALTERNATING_2` como variante que começa em 2 (research 03 §5.1). O Fusion inclui ambas para mapeamento 1:1 com a pesquisa. Tornar configurável por cena com default por sistema cobre os três sistemas-alvo. A estratégia de grade recebe a regra e a aplica na medição acumulada ao longo de um caminho (a alternância é por passo diagonal acumulado no caminho, não por segmento isolado).

### D5 — Movimento de token: otimismo com rollback (originador) + animação a partir do broadcast (peers)

O movimento de token segue o modelo otimista definido em `04-rede-e-sincronizacao.md` (REQ-NET-050/051/052) como fonte única de autoridade sobre o comportamento de rede. O fluxo tem três momentos: (1) **preview local (ghost)** durante o drag/setas — antes do drop/confirmação — exibindo um fantasma de posição e um ruler de movimento com distância/custo, sem alterar o estado canônico do token; (2) ao confirmar (drop ou tecla), o **originador aplica a posição localmente (otimismo)** e emite `token:move` ao servidor; (3) ao receber o broadcast ou ack do servidor, o originador corrige para a posição autoritativa se divergir (rollback — REQ-NET-051); **peers** só aplicam a posição a partir do broadcast canônico (REQ-NET-052), com animação interpolada origem→destino.

- **Alternativas rejeitadas:**
  - _Mover apenas o ghost durante e após o drag, sem aplicar posição localmente antes do broadcast (non-optimistic ghost only)_: introduz lag perceptível no próprio jogador que moveu o token; contrária ao modelo de concorrência otimista fixado em `04` (D4, REQ-NET-050). Rejeitado: o originador DEVE ver o movimento imediato.
  - _Esperar o round-trip completo antes de qualquer feedback visual_: UX inaceitável; o preview local (ghost durante drag + posição otimista após drop) resolve a latência percebida sem ceder autoridade ao cliente.
- **Racional:** O modelo otimista com rollback é a decisão arquitetural de concorrência de `04` (D4, REQ-NET-050/051/052). O ghost é restrito ao período de drag (antes da confirmação) e serve de preview sem alterar o estado persistido; após o drop, a posição é aplicada otimisticamente no originador. O servidor continua sendo o árbitro: se rejeitar ou corrigir, o originador reverte para a posição autoritativa. Peers nunca avançam otimisticamente — animam a partir do broadcast. A animação é parametrizável (duração por distância, easing, rotação em direção ao movimento) à semelhança do `TokenAnimationOptions` (research 03 §7.6). A exibição de custo de movimento via Regions (terreno difícil) é **[V2]**, pois depende de Region/RegionBehavior que não fazem parte do MVP (REQ-DOC-022, DEC-MAC-04 em `14`); a aplicação de custo é regra de sistema. Alinha REQ-ARQ-031, REQ-VIS-008.

### D6 — Quatro formas de MeasuredTemplate cobrindo a geometria do PF2e

O Fusion implementa quatro formas de template: **circle** (raio a partir da origem — bursts), **cone** (setor angular configurável; o default do Fusion para PF2e é **90° — decisão de design a confirmar em `17-sistema-pf2e.md`**, não atribuída ao Foundry cujo padrão é ~53°), **line/ray** (linha com largura) e **emanation** (área ao redor de uma origem/token — em grade, é equivalente a um burst centrado no token com o quadrado/hex de origem incluído). Cada template gera o **highlight de células** afetadas conforme a estratégia de grade ativa.

- **Alternativas rejeitadas:**
  - _Reusar `rectangle` do Foundry como quinta forma genérica_: PF2e não usa retângulo livre como forma primária de efeito; line/ray cobre os casos lineares. Retângulo fica como possível extensão [V2].
  - _Apenas geometria contínua sem highlight de células_: em grade, o que importa para PF2e é **quais quadrados** a área cobre (um quadrado é afetado se a área cobre seu ponto relevante segundo a regra do sistema). Sem highlight de células, o GM não sabe quem é atingido.
- **Racional:** A pesquisa lista circle/cone/rectangle/ray como as formas do Foundry (research 03 §6.3) e identifica o cone como setor angular de 1°–360° com **padrão ~53° no Foundry** (research 03 §6.3). Para PF2e, o conjunto necessário é burst (circle), cone, line (ray) e emanation; mapeamos para essas quatro. O ângulo default de 90° para cone em PF2e é uma **decisão de design do Fusion** (um cone de PF2e a partir de um canto ocupa um quadrante de 90°), não um comportamento do Foundry — a regra exata do PF2e remaster deve ser fechada em `17-sistema-pf2e.md`. A regra de "qual quadrado conta como atingido" é igualmente detalhe do sistema PF2e (`17`); o canvas oferece o highlight geométrico e a estratégia de inclusão de célula como ponto de extensão da grade.

### D7 — Tokens com footprint em células separado da escala da arte, e ring opcional

O token separa **footprint** (`width`×`height` em células — define a ocupação na grade e o snapping) da **escala visual** da arte (`scale`, multiplicador estético). Suporta espelhamento (`mirrorX/Y`), `tint`, `rotation`, `alpha`, `elevation` e `disposition`. O **token ring** (moldura circular com cor/fundo dirigida por disposição/estado) é uma camada de apresentação **opcional**, separada da arte do sujeito.

- **Alternativas rejeitadas:**
  - _Acoplar tamanho na grade ao tamanho da imagem_: quebra para artes com moldura/respiro; o footprint precisa ser independente da arte (research 03 §7.2: "`scale` ajusta apenas a aparência da artwork").
  - _Ring obrigatório (todo token tem moldura)_: nem todo token quer moldura; mantê-lo opcional respeita arte de mapa custom. O ring é um framework separado em camadas (subject/ring/background) à semelhança dos Dynamic Token Rings (research 03 §7.5), mas no MVP entregamos uma forma simples (borda colorida por disposição); o ring dinâmico completo é refinamento.
- **Racional:** Separar footprint de escala é o modelo correto observado na pesquisa (research 03 §7.1, §7.2). Disposition pinta a borda/ring (friendly/neutral/hostile/secret), seguindo o esquema de cores observado (research 03 §7.1). Tokens grandes (2×2, 3×3…) exigem snapping multi-célula, com lógica especial em hex (research 03 §5.2, §7.2).

### D8 — Barras de atributo, status icons e nameplate como overlays cacheáveis do token

Cada token compõe, acima da arte: até **duas resource bars** (`bar1`, `bar2`) vinculadas a caminhos de atributo do ator, **ícones de status** (no canto, definidos pelo sistema), **nameplate** (rótulo) e, opcionalmente, indicador de **elevação**. A visibilidade de cada elemento é configurável por nível (nunca / dono / hover dono / hover todos / sempre). Esses overlays são **cacheados como bitmap** quando estáticos, para reduzir draw calls.

- **Alternativas rejeitadas:**
  - _Desenhar barras/ícones com `PIXI.Graphics` por frame sem cache_: `PIXI.Graphics` não participa de batching e gera um draw call por objeto; com 50 tokens isso explode os draw calls (research 03 §4.2, §15.2).
  - _Renderizar nameplates sempre, em qualquer zoom_: ilegível e custoso em zoom out; daí o LOD de nameplate (ver D11).
- **Racional:** A pesquisa quantifica o ganho de cachear barras/ícones como textura (`cacheAsBitmap`): de ~85 para ~36 draw calls, de ~55 fps para 100+ fps (research 03 §15.2). A visibilidade por nível é o comportamento esperado das resource bars/status (research 03 §7.4). Os ícones de status são definidos pelo sistema de jogo (`15-api-de-sistemas.md`).

### D9 — Tiles overhead com modos de oclusão; teste de oclusão por amostragem de pontos

Tiles dividem-se em **underfoot** (abaixo dos tokens: chão, móveis) e **overhead** (acima: telhados, copas). Tiles overhead suportam modos de oclusão: `none`, `fade` (todo o tile faz fade quando um token controlado passa por baixo), `radial` (revela um raio ao redor do token) e `vision` (revela conforme o polígono de visão do token — integra com `07`). A detecção de "token sob o tile" amostra múltiplos pontos do token (centro, cantos e cardeais).

- **Alternativas rejeitadas:**
  - _Só fade global do tile_: insuficiente para telhados grandes onde só a parte sobre o token deveria revelar (daí radial/vision).
  - _Testar só o centro do token_: falha em tokens grandes e em bordas de tile; a pesquisa indica teste de 9 pontos (centro, 4 cantos, 4 cardeais) e considera áreas transparentes da arte (research 03 §8.3).
- **Racional:** Os quatro modos cobrem os casos reais (research 03 §8.3). O modo `vision` depende do polígono de visão calculado em `07`; no MVP entregamos `none`/`fade`/`radial` como base e `vision` acoplado quando a visão estiver pronta. A oclusão é uma flag de re-render batched (ver D13), não um recálculo por frame.

### D10 — Sistema de flags de re-render (perception) para coalescer atualizações

Mudanças que afetam o canvas (mover token, alterar luz, abrir porta, mudar oclusão) **não** disparam re-render imediato e isolado. Elas **enfileiram flags** (ex.: `refreshTokens`, `refreshLighting`, `refreshVision`, `refreshOcclusion`, `refreshGrid`) que são processadas **em lote uma vez por frame**, com propagação entre flags (uma flag pode acionar outras).

- **Alternativas rejeitadas:**
  - _Re-renderizar/recalcular a cada mutação individual_: várias mudanças no mesmo frame causam recálculos redundantes (ex.: mover 5 tokens recalcula visão 5×). A pesquisa descreve exatamente esse problema e a solução por flags batched (research 03 §4.5, §11.4 — PerceptionManager).
- **Racional:** Coalescer por frame é o que mantém o custo previsível com muitos objetos. As flags de visão/iluminação/oclusão são consumidas pelo subsistema de `07`; esta spec define o mecanismo geral e as flags puramente de canvas (tokens, grid, controles). Alinha com o RNF de não bloquear o event loop e com D9 de `01`.

### D11 — LOD de nameplates e detalhe por nível de zoom

Nameplates, barras e ícones de status têm **LOD por zoom**: abaixo de um limiar de zoom, nameplates somem (ou viram um ponto), barras simplificam e ícones de status agregam. A grade também ajusta densidade visual (linhas mais finas/atenuadas) em zoom baixo.

- **Alternativas rejeitadas:**
  - _Detalhe constante em todo zoom_: ilegível em zoom out e custoso (texto pequeno re-renderizado).
  - _Esconder tudo abaixo de um zoom fixo_: perde informação útil; LOD gradual é melhor que liga/desliga abrupto.
- **Racional:** LOD é a técnica padrão para manter legibilidade e fps. A pesquisa não dá limiares exatos de nameplate, então os limiares concretos ficam como decisão de design afinável (ver Questões em aberto). O LOD é puramente visual e local (não afeta estado autoritativo).

### D12 — Coordenadas: scene coordinates como sistema canônico; conversão única client↔scene

Todo placeable e toda lógica de grade operam em **scene coordinates** (pixels da cena, origem no canto da área com padding). A conversão de evento do navegador (**client coordinates**) para scene coordinates passa por **uma** função que inverte a transformação do render group da câmera. Nunca se aplica rotação/skew ao render group do mundo (apenas translação e escala).

- **Alternativas rejeitadas:**
  - _Cada camada faz sua própria conversão de coordenadas_: fonte garantida de bugs de mapeamento cursor→canvas, especialmente sob zoom (research 03 §16.4 menciona bugs de transform que corrompem o mapeamento).
  - _Permitir rotação do stage do mundo (mapas girados)_: introduz exatamente a classe de transform bugs citada; rotação de cena fica [V2] e, se vier, com tratamento dedicado.
- **Racional:** Um único ponto de conversão elimina drift e bugs de mapeamento. Restringir a câmera a translação+escala (sem rotação/skew) evita a corrupção de coordenadas observada na pesquisa (research 03 §16.4).

### D13 — Culling manual e atlas de textura como base de performance

O canvas faz **culling manual**: antes de renderizar/atualizar, verifica se o bounding box do placeable intersecta o viewport. Ícones de status e elementos de ring usam **texture atlas** (spritesheet). Texturas grandes (background) usam mipmapping; formatos preferidos WebP/AVIF.

- **Alternativas rejeitadas:**
  - _Confiar no culling automático do PIXI_: o PIXI não faz culling automático por padrão — todos os objetos do container são processados mesmo fora do viewport (research 03 §15.1). É preciso culling manual.
  - _Uma textura por ícone de status_: troca de textura por ícone aumenta draw calls; um atlas agrega tudo num batch (research 03 §15.2, §15.3).
- **Racional:** A pesquisa é explícita: PIXI não faz culling automático e a otimização vem de culling manual + caching como textura + batching + atlas + formatos WebP/AVIF (research 03 §15). Essas técnicas são o caminho para a meta de 60 fps com 50 tokens em mapa 10k×10k (research 03 §15.4).

---

## Requisitos funcionais

> Tags: **[MVP]** = necessário para a definição de MVP global (sessão de PF2e com mapa+grid, tokens com movimento, visão/iluminação/fog básicos, fichas, rolagens básicas, chat, combat tracker). **[V2]** = pós-MVP.

### Aplicação PIXI, grupos e câmera

- **REQ-CNV-001** [MVP] O cliente DEVE instanciar um único `PIXI.Application` para o canvas do mapa, inicializando com WebGPU e caindo para WebGL automaticamente quando WebGPU não estiver disponível, sem ação do usuário (alinha REQ-ARQ-042).
- **REQ-CNV-002** [MVP] O `stage` DEVE conter quatro grupos ordenados do fundo ao topo: `PrimaryGroup`, `EffectsGroup`, `InterfaceGroup`, `OverlayGroup`, com a semântica definida em D1.
- **REQ-CNV-003** [MVP] A ordem de renderização visual dentro do PrimaryGroup DEVE ser, do fundo ao topo: imagem de background → tiles underfoot → drawings underfoot → tokens → tiles overhead → imagem de foreground.
- **REQ-CNV-004** [MVP] O EffectsGroup (weather, iluminação, visão, fog) DEVE renderizar acima do PrimaryGroup e o InterfaceGroup (templates, notes, walls do GM, grid, controles) acima do EffectsGroup; o detalhe de iluminação/visão/fog é definido em `07-visao-iluminacao-fog.md`.
- **REQ-CNV-005** [MVP] O OverlayGroup (ruler, pings, cursores de outros usuários) DEVE renderizar acima de tudo e NÃO DEVE herdar a transformação de câmera (pan/zoom) do mundo da cena.
- **REQ-CNV-006** [MVP] A câmera (pan/zoom) DEVE ser aplicada via um Render Group do PIXI v8 que envolve Primary+Effects+Interface, de modo que a transformação seja acelerada por GPU; o OverlayGroup fica fora desse render group.
- **REQ-CNV-007** [MVP] O canvas DEVE suportar **pan** (arrastar com botão do meio ou espaço+arrastar) e **zoom** (scroll/pinch), com limites de zoom default 0.1×–3×, configuráveis.
- **REQ-CNV-008** [MVP] O canvas DEVE expor navegação programática: centralizar em um ponto/token, animar pan até uma view (`{x, y, scale}`) e recentralizar no token controlado.
- **REQ-CNV-009** [MVP] A câmera DEVE aplicar apenas translação e escala ao render group do mundo; NÃO DEVE aplicar rotação ou skew no MVP (rotação de cena é [V2]).
- **REQ-CNV-010** [MVP] O cliente DEVE manter exatamente **uma** camada interativa ativa por vez (camada da ferramenta selecionada); trocar de ferramenta troca a camada ativa que recebe input de ponteiro.

### Coordenadas e input

- **REQ-CNV-011** [MVP] Toda lógica de placeables e de grade DEVE operar em **scene coordinates** (pixels da cena, origem no canto da área com padding).
- **REQ-CNV-012** [MVP] A conversão de **client coordinates** (evento do navegador) para **scene coordinates** DEVE ocorrer por uma única função que inverte a transformação da câmera; nenhuma camada DEVE implementar conversão própria divergente.
- **REQ-CNV-013** [MVP] O canvas DEVE suportar seleção por **clique** e por **rubber-band** (arraste de seleção retangular) na camada de tokens.

### Abstração de grade

- **REQ-CNV-014** [MVP] O sistema DEVE suportar três tipos de grade por cena: `square`, `hex` e `gridless`, atrás de uma interface comum `GridStrategy`.
- **REQ-CNV-015** [MVP] A grade `hex` DEVE suportar as quatro variantes: pointy-top (linhas, odd/even) e flat-top (colunas, odd/even), usando coordenadas cúbicas internamente.
- **REQ-CNV-016** [MVP] Cada `GridStrategy` DEVE fornecer: `pixelToCell(point) → offset`, `cellToPixel(offset) → centerPoint`, `getSnappedPoint(point, resolution) → point`, `measureDistance(path, rule) → number` e `getHighlightCells(shape) → offset[]`.
- **REQ-CNV-017** [MVP] O `gridSize` mínimo DEVE ser 50 px por célula; a cena DEVE permitir `gridSize`, `gridDistance` (distância por célula) e `gridUnits` (rótulo da unidade) configuráveis.
- **REQ-CNV-018** [MVP] O **snapping** DEVE ser configurável em resolução (centro de célula, vértice, aresta, interseção) e DEVE poder ser suprimido pelo usuário segurando uma tecla modificadora (ex.: Shift) durante drag/colocação.
- **REQ-CNV-019** [MVP] Para grade `square`, a medição DEVE respeitar uma **regra de diagonal** configurável por cena do conjunto: `equidistant`, `exact`, `approximate`, `rectilinear`, `alternating_1`, `alternating_2` [V2] e `illegal` (D4). A implementação da alternância DEVE usar contagem acumulada de passos diagonais no caminho inteiro (não por segmento isolado), com `alternating_1` iniciando em custo 1 e `alternating_2` iniciando em custo 2.
- **REQ-CNV-020** [MVP] Para cenas de sistema PF2e, o default da regra de diagonal DEVE ser `alternating_1` (alterna 1-2-1-2 ao longo do caminho, começa em 1), refletindo a regra 5-10-5 do PF2e (`ALTERNATING_1` da pesquisa — research 03 §5.1).
- **REQ-CNV-021** [MVP] Para grade `hex`, a medição de distância DEVE usar a distância em coordenadas cúbicas (`max(|Δq|, |Δr|, |Δs|)`).
- **REQ-CNV-022** [MVP] Para `gridless`, a medição DEVE usar distância euclidiana e NÃO DEVE aplicar snapping automático; templates ainda funcionam sem highlight de células.
- **REQ-CNV-023** [MVP] O snapping de tokens com footprint > 1 célula DEVE encaixar corretamente o conjunto de células ocupadas (incluindo a lógica multi-hex em grade hexagonal).
- **REQ-CNV-024** [MVP] A grade DEVE ser renderizável com cor e opacidade configuráveis por cena (apenas visual; não altera a lógica).

### Tokens — modelo visual

- **REQ-CNV-025** [MVP] Um token DEVE renderizar uma textura de sujeito (arte) posicionada conforme sua posição e footprint, com `scale` (escala visual da arte) independente do footprint em células.
- **REQ-CNV-026** [MVP] Um token DEVE suportar `rotation`, `alpha`, `tint`, `mirrorX`, `mirrorY` e `elevation`.
- **REQ-CNV-027** [MVP] Um token DEVE indicar sua **disposition** (friendly / neutral / hostile / secret) por uma borda/ring colorido; o esquema de cores DEVE ser consistente e configurável no tema.
- **REQ-CNV-028** [MVP] Um token DEVE poder exibir até **duas resource bars** (`bar1`, `bar2`) vinculadas a caminhos de atributo do ator, com a barra refletindo valor atual/máximo.
- **REQ-CNV-029** [MVP] Um token DEVE poder exibir **ícones de status** (definidos pelo sistema de jogo) agrupados em um canto; um status PODE ser exibido como overlay grande (no máximo um por token).
- **REQ-CNV-030** [MVP] Um token DEVE exibir um **nameplate** (rótulo) com fonte/cor do tema.
- **REQ-CNV-031** [MVP] A visibilidade de nameplate, resource bars e status icons DEVE ser configurável por nível: nunca / dono / hover-dono / hover-todos / sempre, respeitando ownership (`05-usuarios-e-permissoes.md`).
- **REQ-CNV-032** [MVP] Um token com `elevation` ≠ 0 DEVE exibir um indicador de elevação legível (valor + unidade).
- **REQ-CNV-033** [V2] O **token ring dinâmico** completo (camadas subject/ring/background com shaders dirigidos por estado de jogo, como turno de combate ou saúde) DEVE ser suportado; o MVP entrega apenas a borda colorida por disposição (D7).

### Tokens — movimento, seleção e targeting

- **REQ-CNV-034** [MVP] Um usuário DEVE poder mover um token que controla por **drag** (arraste) e por **teclas direcionais** (setas/WASD), com snapping conforme a grade (suprimível por modificadora).
- **REQ-CNV-035** [MVP] Durante o drag/movimento e **antes da confirmação (drop)**, o cliente DEVE exibir um **preview local (ghost)** e um **ruler de movimento** com a **distância acumulada** (em `gridUnits`) aplicando a regra de diagonal da grade. O ghost é descartado ao confirmar — substituído pela posição otimista aplicada localmente (REQ-CNV-036).
- **REQ-CNV-035a** [V2] O ruler de movimento DEVE exibir o **custo de movimento modificado** quando a trajetória cruzar `SceneRegion`s com behavior `modify-movement-cost` ativos; esse cálculo depende de Region/RegionBehavior, que é [V2] conforme REQ-DOC-022 e DEC-MAC-04 (`14-macros-e-automacao.md`).
- **REQ-CNV-036** [MVP] Ao confirmar o movimento (drop/tecla), o cliente originador DEVE aplicar a posição final localmente de imediato (atualização otimista — REQ-NET-050) e emitir `token:move` ao servidor; se o servidor rejeitar ou retornar uma posição diferente, o originador DEVE fazer **rollback** para a posição autoritativa do ack/broadcast (REQ-NET-051). Peers (clientes não-originadores) DEVEM aplicar a posição de token **exclusivamente** a partir do broadcast canônico do servidor (REQ-NET-052), nunca de forma otimista.
- **REQ-CNV-037** [MVP] Ao receber o update autoritativo de posição, **todos** os clientes DEVEM animar o token interpoladamente de origem a destino, com duração default proporcional à distância, easing configurável e rotação opcional em direção ao movimento.
- **REQ-CNV-038** [MVP] O usuário DEVE poder **selecionar múltiplos tokens** (rubber-band ou clique+modificadora) e movê-los/operá-los em conjunto, restrito aos tokens que ele controla.
- **REQ-CNV-039** [MVP] O usuário DEVE poder **targetar** (marcar como alvo) um ou mais tokens, de forma distinta de selecionar/controlar; os alvos DEVEM ser visíveis aos demais usuários conforme política (ex.: cor do usuário que targetou).
- **REQ-CNV-040** [MVP] A rotação de token DEVE ser possível por modificadora+scroll e por teclas, com incremento fino opcional.
- **REQ-CNV-041** [V2] O GM DEVE poder **duplicar** um token com modificadora+drag (Ctrl+drag).
- **REQ-CNV-042** [V2] O **drag measurement** avançado com waypoints e tipos de movimento selecionáveis (caminhar/voar/nadar/escalar), e custo por tipo, DEVE ser suportado; o MVP entrega ruler de movimento simples (REQ-CNV-035).

### Tiles

- **REQ-CNV-043** [MVP] O sistema DEVE suportar **tiles** com posição, dimensões em pixels, `rotation`, `alpha`, `tint` e ordenação por z-index entre tiles.
- **REQ-CNV-044** [MVP] Um tile DEVE poder ser marcado como **overhead** (renderiza acima dos tokens) ou underfoot (abaixo).
- **REQ-CNV-045** [MVP] Tiles overhead DEVEM suportar modos de oclusão `none`, `fade` e `radial`; o modo `vision` (revela conforme o polígono de visão) é entregue acoplado a `07-visao-iluminacao-fog.md`.
- **REQ-CNV-046** [MVP] A detecção de "token sob tile overhead" DEVE amostrar múltiplos pontos do token (centro, cantos e cardeais), não apenas o centro.
- **REQ-CNV-047** [V2] Tiles de **vídeo** (WebM/MP4) com autoplay/loop/volume DEVEM ser suportados.

### Drawings

- **REQ-CNV-048** [MVP] O sistema DEVE suportar **drawings**: retângulo, elipse/círculo, polígono (vértices por clique), freehand (linha livre) e texto.
- **REQ-CNV-049** [MVP] Cada drawing DEVE ter propriedades de linha (largura, cor, opacidade), preenchimento (nenhum / sólido com cor+opacidade) e, para texto, fonte/tamanho/cor.
- **REQ-CNV-050** [MVP] Drawings DEVEM ter ordenação (z-sort) entre si e DEVEM respeitar as permissões de criação (jogadores não criam por padrão; ver `05`).
- **REQ-CNV-051** [V2] Preenchimento por **pattern (textura)** e suavização avançada de freehand DEVEM ser suportados.

### MeasuredTemplates

- **REQ-CNV-052** [MVP] O sistema DEVE suportar quatro formas de template: **circle** (burst), **cone** (ângulo configurável; default 90° para PF2e como decisão de design do Fusion — a confirmar em `17-sistema-pf2e.md`), **line/ray** (com largura) e **emanation**.
- **REQ-CNV-053** [MVP] Cada template DEVE ter origem, direção, ângulo (cone), largura (line), distância, cor e opacidade configuráveis.
- **REQ-CNV-054** [MVP] Em grade `square`/`hex`, o template DEVE gerar o **highlight das células afetadas** segundo a regra de inclusão de célula da estratégia de grade (ponto de extensão para a regra exata do sistema, ex.: PF2e — ver `17`).
- **REQ-CNV-055** [MVP] Um template em colocação DEVE poder ser rotacionado (modificadora+scroll) e fazer snap a células/interseções conforme a grade.
- **REQ-CNV-056** [MVP] Um template DEVE poder ser ancorado em um token (emanation/burst centrado), acompanhando-o quando o token move (ou recalculando ao reabrir), conforme configuração.

### Notes (map pins)

- **REQ-CNV-057** [MVP] O sistema DEVE suportar **notes** (pinos de mapa) linkados a JournalEntries (ou páginas), com posição, ícone (preset ou imagem), tamanho do ícone, tint e rótulo (label) com fonte/cor.
- **REQ-CNV-058** [MVP] Notes DEVEM respeitar permissões e visibilidade: usuários sem permissão de leitura não veem o conteúdo; uma note PODE ser marcada como globalmente visível.
- **REQ-CNV-059** [MVP] Notes DEVEM poder ser criadas arrastando uma JournalEntry da sidebar para o canvas e reposicionadas por drag.

### Ruler

- **REQ-CNV-060** [MVP] O sistema DEVE oferecer um **ruler** de medição ativável por tecla/ferramenta, medindo a distância entre pontos com a unidade da cena, suportando **waypoints** (caminhos em L/segmentados).
- **REQ-CNV-061** [MVP] O ruler DEVE aplicar a regra de diagonal/medição da grade ativa (incluindo 5-10-5 em PF2e) e DEVE poder ignorar o snapping com tecla modificadora.
- **REQ-CNV-062** [MVP] O ruler de um usuário DEVE ser visível aos demais (com a cor do usuário), pois é um elemento do OverlayGroup compartilhado via presença (`04-rede-e-sincronizacao.md`).
- **REQ-CNV-063** [V2] O ruler DEVE considerar diferença de **elevação** entre waypoints como componente adicional na distância.

### Scene — configuração e navegação

- **REQ-CNV-064** [MVP] Uma cena DEVE ter configuração de **dimensões** (largura/altura em pixels), derivadas do background por default mas overrideáveis.
- **REQ-CNV-065** [MVP] Uma cena DEVE suportar **imagem de background** e, opcionalmente, **imagem de foreground** (overlay de cena inteira acima dos objetos, sem oclusão), além de **offset (X/Y)** para alinhar grade pré-desenhada na imagem.
- **REQ-CNV-066** [MVP] Uma cena DEVE suportar **padding** (borda extra ao redor da imagem, como percentual), criando área de staging fora do mapa principal.
- **REQ-CNV-067** [MVP] Uma cena DEVE suportar configuração de grade (tipo, `gridSize`, cor, opacidade, regra de diagonal, distância e unidade) conforme a seção de grade.
- **REQ-CNV-068** [MVP] Uma cena DEVE suportar **initial view** (posição `{x, y}` e zoom iniciais do viewport ao ativar a cena).
- **REQ-CNV-069** [MVP] Uma cena DEVE expor parâmetros de ambiente que esta spec apenas **posiciona** no canvas (darkness level, fog, iluminação global), com a semântica definida em `07-visao-iluminacao-fog.md`.
- **REQ-CNV-070** [MVP] O cliente DEVE permitir **navegar entre cenas** e **ativar** uma cena (a ativa é a renderizada no canvas); ativar uma cena recarrega o canvas com seus placeables e aplica a initial view.
- **REQ-CNV-071** [V2] **Pré-carregamento (preload)** de assets de uma cena nos clientes antes da ativação DEVE ser suportado para reduzir o tempo de troca de cena.
- **REQ-CNV-072** [V2] **Foreground elevation** (tokens acima de certa elevação aparecem sobre o foreground/overhead) DEVE ser suportado.

### Re-render e flags

- **REQ-CNV-073** [MVP] O canvas DEVE coalescer atualizações por **flags de re-render** processadas uma vez por frame (ex.: `refreshTokens`, `refreshOcclusion`, `refreshGrid`, e as flags de `07`: `refreshLighting`/`refreshVision`), com propagação entre flags, evitando recálculos redundantes no mesmo frame.

---

## Requisitos não-funcionais

- **REQ-CNV-074** [MVP] **Meta de framerate:** o canvas DEVE sustentar ≥ 60 fps em pan/zoom e movimento, em uma cena de até **10.000 × 10.000 px** com **50 tokens** visíveis (com resource bars e status icons), em hardware de cliente desktop de classe média com aceleração de hardware.
- **REQ-CNV-075** [MVP] **Culling manual:** o canvas DEVE descartar do processamento/renderização os placeables cujo bounding box não intersecta o viewport (o PIXI não faz culling automático — research 03 §15.1).
- **REQ-CNV-076** [MVP] **Draw calls controlados:** resource bars e status icons estáticos DEVEM ser cacheados como bitmap/atlas para reduzir draw calls; o objetivo é evitar 1 draw call por elemento por token (research 03 §15.2).
- **REQ-CNV-077** [MVP] **Texturas:** o carregamento de texturas DEVE preferir formatos WebP/AVIF; texturas grandes (background) DEVEM usar mipmapping; ícones de status/ring DEVEM usar texture atlas.
- **REQ-CNV-078** [MVP] **LOD:** nameplates, barras e ícones de status DEVEM ter nível de detalhe reduzido/oculto abaixo de um limiar de zoom configurável, mantendo legibilidade e performance.
- **REQ-CNV-079** [MVP] **Degradação WebGPU→WebGL:** a ausência de WebGPU DEVE resultar em fallback automático para WebGL sem ação do usuário e sem perda de funcionalidade essencial (research 15 §3.1).
- **REQ-CNV-080** [MVP] **Não bloquear o frame:** operações potencialmente longas no canvas (ex.: gerar highlight de um template muito grande, recompor atlas) NÃO DEVEM travar o loop de render por mais de um frame perceptível; caminhos pesados de visão seguem `07` e D9 de `01`.
- **REQ-CNV-081** [MVP] **Responsividade de input:** o feedback de preview de drag/seleção DEVE ser local e imediato (independente de round-trip ao servidor), mantendo a autoridade no servidor (D5).
- **REQ-CNV-082** [MVP] **i18n:** todo texto exibido pelo canvas (rótulos de unidade, mensagens de ferramenta) DEVE ser externalizável, pt-BR primário.

---

## Modelo de dados

Esta spec **não** define o schema persistido dos Documents (ver `02-modelo-de-dados.md`). Define as interfaces TypeScript de **apresentação/render** que vivem no cliente (e os tipos compartilhados da estratégia de grade, que ficam em `packages/shared`). Os campos persistidos são referenciados pelos placeables, mas a fonte de verdade é `02`.

```typescript
// packages/shared — tipos de grade compartilhados entre client e server.

export type GridType = "square" | "hex" | "gridless";

export type HexOrientation = "pointy" | "flat";
export type HexParity = "odd" | "even";

export type DiagonalRule =
  | "equidistant" // diagonal = 1 (D&D 5e) — EQUIDISTANT do Foundry
  | "exact" // diagonal = √2 — EXACT do Foundry
  | "approximate" // diagonal = 1.5 — APPROXIMATE do Foundry
  | "rectilinear" // diagonal = 2 — RECTILINEAR do Foundry
  | "alternating_1" // alterna 1-2-1-2 (começa em 1; PF2e 5-10-5) — ALTERNATING_1 do Foundry
  | "alternating_2" // alterna 2-1-2-1 (começa em 2) — ALTERNATING_2 do Foundry [V2]
  | "illegal"; // diagonal proibida — ILLEGAL do Foundry

export interface GridConfig {
  type: GridType;
  /** Lado do quadrado / distância entre lados paralelos do hex, em px. Mín. 50. */
  size: number;
  /** Distância de jogo por célula (ex.: 5). */
  distance: number;
  /** Rótulo da unidade (ex.: "ft", "m"). */
  units: string;
  /** Cor da grade (hex) e opacidade visual (0–1). */
  color: string;
  alpha: number;
  /** Apenas para hex. */
  hex?: { orientation: HexOrientation; parity: HexParity };
  /** Apenas para square. */
  diagonalRule?: DiagonalRule;
}

/** Coordenada de célula em offset (linha/coluna). */
export interface CellOffset {
  i: number;
  j: number;
}
/** Ponto em scene coordinates (px). */
export interface ScenePoint {
  x: number;
  y: number;
}
/** Coordenada cúbica de hexágono (q + r + s = 0). */
export interface CubeCoord {
  q: number;
  r: number;
  s: number;
}

/** Resolução de snapping. */
export type SnapResolution = "center" | "vertex" | "edge" | "intersection";

/** Contrato de uma estratégia de grade. Implementações: Square, Hex, Gridless. */
export interface GridStrategy {
  readonly config: GridConfig;
  pixelToCell(p: ScenePoint): CellOffset;
  cellToPixel(c: CellOffset): ScenePoint; // centro da célula
  getSnappedPoint(p: ScenePoint, resolution: SnapResolution): ScenePoint;
  /** Mede a distância de jogo ao longo de um caminho de waypoints. */
  measureDistance(path: ScenePoint[]): number;
  /** Células cobertas por uma forma (para highlight de template/footprint). */
  getHighlightCells(shape: TemplateShape | FootprintShape): CellOffset[];
}

// --- Tipos de apresentação (client; não persistidos diretamente) ---

export type Disposition = "friendly" | "neutral" | "hostile" | "secret";

/** Nível de visibilidade de um overlay do token. */
export type DisplayMode = "never" | "owner" | "hover_owner" | "hover_all" | "always";

export interface ResourceBarView {
  /** Caminho de atributo no ator (ex.: "attributes.hp"). */
  attributePath: string;
  value: number;
  max: number;
  display: DisplayMode;
}

export interface TokenView {
  /** Footprint em células (independe da escala da arte). */
  width: number;
  height: number;
  /** Escala visual da arte (multiplicador). */
  scale: number;
  rotation: number; // graus
  alpha: number; // 0–1
  tint?: string; // hex
  mirrorX: boolean;
  mirrorY: boolean;
  elevation: number; // em gridUnits
  disposition: Disposition;
  textureSrc: string; // URL servida por HTTP estático (nunca via socket)
  ring: boolean; // borda/ring por disposição (MVP); ring dinâmico é [V2]
  bars: [ResourceBarView?, ResourceBarView?];
  statusIcons: string[]; // ids de status definidos pelo sistema
  nameplate: { text: string; display: DisplayMode };
}

export type TemplateShapeKind = "circle" | "cone" | "line" | "emanation";

export interface TemplateShape {
  kind: TemplateShapeKind;
  origin: ScenePoint;
  direction: number; // graus
  distance: number; // em gridUnits
  angle?: number; // cone (graus; default 90 para PF2e — decisão de design, a confirmar em 17)
  width?: number; // line (em gridUnits)
  color: string;
  alpha: number;
  /** Token-âncora opcional (emanation/burst centrado). */
  anchorTokenId?: string;
}

export interface FootprintShape {
  origin: CellOffset;
  width: number; // células
  height: number; // células
}

export type OcclusionMode = "none" | "fade" | "radial" | "vision";

/** Render flags coalescidas por frame (canvas). As de visão/luz vêm de 07. */
export interface CanvasRenderFlags {
  refreshTokens?: boolean;
  refreshTiles?: boolean;
  refreshOcclusion?: boolean;
  refreshDrawings?: boolean;
  refreshTemplates?: boolean;
  refreshGrid?: boolean;
  refreshControls?: boolean;
  // Propagadas para o subsistema 07:
  refreshLighting?: boolean;
  refreshVision?: boolean;
}

/** View de câmera (apenas translação + escala no MVP). */
export interface CameraView {
  x: number;
  y: number;
  scale: number;
}
```

---

## API e eventos

Esta spec descreve a **API local do canvas** (no cliente). O contrato de socket que sincroniza estes objetos está em `04-rede-e-sincronizacao.md`; aqui listamos os eventos que o canvas **emite localmente** e os updates de Document que ele **consome**.

### Camadas e grupos (resumo)

| Grupo            | Camadas (ordem do fundo ao topo)                                                    | Interativa?           |
| ---------------- | ----------------------------------------------------------------------------------- | --------------------- |
| `PrimaryGroup`   | background, tiles-underfoot, drawings-underfoot, tokens, tiles-overhead, foreground | tokens (quando ativa) |
| `EffectsGroup`   | weather, lighting, vision, fog (ver `07`)                                           | não                   |
| `InterfaceGroup` | templates, notes, walls (GM, ver `07`), grid, controls/selection                    | a ferramenta ativa    |
| `OverlayGroup`   | ruler, pings, cursores remotos                                                      | n/a (segue presença)  |

### Eventos locais emitidos pelo canvas (cliente → app)

| Evento local            | Quando                             | Carga                                                                    |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `canvas:ready`          | cena ativa carregada e renderizada | `{ sceneId }`                                                            |
| `token:select`          | seleção muda                       | `{ tokenIds }`                                                           |
| `token:target`          | alvos mudam                        | `{ tokenIds }`                                                           |
| `token:moveRequest`     | usuário confirma um movimento      | `{ tokenId, path, finalPosition }` → vira mutação de Document via socket |
| `template:placeRequest` | usuário coloca um template         | `{ shape }` → vira criação de Document                                   |
| `ruler:update`          | waypoints do ruler mudam           | `{ path, distance }` → broadcast de presença                             |
| `camera:change`         | pan/zoom muda                      | `{ view }` (local; force-pan do GM em `05`)                              |

### Updates de Document consumidos pelo canvas (socket → cliente)

O canvas re-renderiza em resposta a create/update/delete dos Documents de cena (Token, Tile, Drawing, MeasuredTemplate, Note, Wall, AmbientLight, Scene), aplicando as **flags de re-render** correspondentes (REQ-CNV-073). O originador aplica a posição otimisticamente ao confirmar o movimento e faz rollback se o servidor corrigir; peers aplicam a posição exclusivamente a partir do broadcast canônico (REQ-CNV-036, REQ-NET-050/051/052).

### Ordem de renderização (referência)

```
PrimaryGroup:   background → tiles(underfoot) → drawings(underfoot) → tokens → tiles(overhead) → foreground
EffectsGroup:   weather → lighting → vision → fog            (detalhe em 07)
InterfaceGroup: templates → notes → walls(GM) → grid → controls
OverlayGroup:   ruler → pings → cursores remotos             (fora do render group do mundo)
```

---

## Dependências (specs irmãs)

- `01-arquitetura-geral.md` — boot do cliente (fase de inicializar o canvas PIXI), servidor autoritativo, fallback WebGPU→WebGL (REQ-ARQ-013, REQ-ARQ-031, REQ-ARQ-042).
- `02-modelo-de-dados.md` — schema persistido de Scene, Token, Tile, Drawing, Wall, AmbientLight, Note, MeasuredTemplate que os placeables espelham (Region/RegionBehavior é **[V2]** — REQ-DOC-022).
- `04-rede-e-sincronizacao.md` — protocolo de socket que sincroniza posição/criação/edição dos objetos de cena; presença (ruler/cursor/targets).
- `05-usuarios-e-permissoes.md` — ownership e roles que governam o que cada usuário vê e move; force-pan do GM (REQ-USR-011); cor do usuário no canvas (REQ-USR-002).
- `07-visao-iluminacao-fog.md` — algoritmo de visão (radial sweep), polígonos LOS, render textures de fog, paredes/walls, darkness level; o canvas apenas posiciona essas camadas e consome suas flags.
- `08-motor-de-rolagens.md` — rolagens disparadas por interações no canvas (ex.: template que rola dano).
- `11-ui-framework-e-fichas.md` — HUD, paletas de ferramentas, diálogos de configuração de objetos e abertura de fichas a partir do canvas.
- `13-audio-e-playlists.md` — sons ambiente posicionados na cena e áudio vinculado a tokens.
- `14-macros-e-automacao.md` — Scene Regions e behaviors (Modify Movement Cost para custo de movimento no ruler — **[V2]**, DEC-MAC-04).
- `17-sistema-pf2e.md` — regra de inclusão de célula de templates do PF2e, cone 90°, default de diagonal 5-10-5, ícones de status do sistema.
- `20-assets-e-midia.md` — formatos de imagem (WebP/AVIF), upload e otimização de texturas em disco.

---

## Critérios de aceitação

- **CA-CNV-01** O canvas inicializa um único `PIXI.Application` com WebGPU e cai para WebGL automaticamente quando WebGPU não existe, sem ação do usuário (REQ-CNV-001, REQ-CNV-079).
- **CA-CNV-02** A pilha de grupos/camadas renderiza na ordem especificada (background → … → ruler), com o OverlayGroup fora da transformação de câmera (REQ-CNV-002 a REQ-CNV-006).
- **CA-CNV-03** Pan e zoom funcionam via Render Group (transformação na GPU), com limites 0.1×–3×, e navegação programática (centralizar/animar/recentralizar) funciona (REQ-CNV-006 a REQ-CNV-008).
- **CA-CNV-04** Conversão client→scene é única e consistente sob qualquer zoom/pan; cliques selecionam o objeto correto sem drift (REQ-CNV-011, REQ-CNV-012).
- **CA-CNV-05** As três grades (square/hex/gridless) implementam pixelToCell, cellToPixel, snapping, medição e highlight; o hex cobre as quatro variantes (REQ-CNV-014 a REQ-CNV-016, REQ-CNV-021).
- **CA-CNV-06** Em cena PF2e (square), medir um caminho diagonal com `alternating_1` aplica 5-10-5 (acumula 1-2-1-2 ao longo do caminho, começa em 1); `alternating_2` acumula 2-1-2-1; trocar a regra de diagonal muda o resultado da medição (REQ-CNV-019, REQ-CNV-020).
- **CA-CNV-07** Um token grande (ex.: 2×2) faz snap corretamente ao conjunto de células, em square e hex (REQ-CNV-023).
- **CA-CNV-08** Um token exibe arte com footprint e escala independentes, borda por disposição, até duas resource bars, ícones de status e nameplate, com visibilidade por nível respeitando ownership (REQ-CNV-025 a REQ-CNV-031).
- **CA-CNV-09** Durante o drag, o ghost e o ruler de movimento aparecem antes da confirmação. Ao confirmar, o originador vê o movimento imediato (otimismo); demais clientes veem o token mover após o broadcast canônico; uma posição inválida/corrigida causa rollback no originador para a posição autoritativa (REQ-CNV-035 a REQ-CNV-037, REQ-NET-050/051/052).
- **CA-CNV-10** Seleção múltipla e targeting funcionam de forma distinta entre si; alvos aparecem aos demais usuários (REQ-CNV-038, REQ-CNV-039).
- **CA-CNV-11** Tiles overhead com modo `fade`/`radial` revelam ao token passar por baixo, com detecção por amostragem de múltiplos pontos (REQ-CNV-044 a REQ-CNV-046).
- **CA-CNV-12** Drawings (retângulo, círculo, polígono, freehand, texto) são criados, estilizados e ordenados; permissões de criação são respeitadas (REQ-CNV-048 a REQ-CNV-050).
- **CA-CNV-13** Os quatro templates (circle/cone/line/emanation) são colocados, rotacionados, snapam à grade e geram highlight das células afetadas; o cone default para PF2e é 90° (decisão de design do Fusion — a validar em `17-sistema-pf2e.md`) (REQ-CNV-052 a REQ-CNV-056).
- **CA-CNV-14** Notes linkam JournalEntries, respeitam permissão de leitura e podem ser criadas por drag da sidebar (REQ-CNV-057 a REQ-CNV-059).
- **CA-CNV-15** O ruler mede com waypoints aplicando a regra da grade e é visível aos demais usuários com a cor do usuário (REQ-CNV-060 a REQ-CNV-062).
- **CA-CNV-16** Uma cena configura dimensões, background/foreground, offset, padding, grade, initial view e ambiente; ativar a cena renderiza seus placeables e aplica a initial view (REQ-CNV-064 a REQ-CNV-070).
- **CA-CNV-17** Atualizações no mesmo frame (ex.: mover 5 tokens) coalescem em um único ciclo de re-render via flags, sem recálculo redundante (REQ-CNV-073).
- **CA-CNV-18** Em hardware de cliente de classe média, uma cena 10k×10k com 50 tokens (com barras/ícones) sustenta ≥ 60 fps em pan/zoom e movimento, com culling manual ativo e draw calls controlados por cache/atlas (REQ-CNV-074 a REQ-CNV-077).
- **CA-CNV-19** Em zoom out abaixo do limiar, nameplates/barras/ícones reduzem detalhe ou somem (LOD), preservando fps e legibilidade (REQ-CNV-078).

---

## Questões em aberto

- **Q-CNV-01 — Limiares de LOD.** A pesquisa não fixa o zoom em que nameplates/barras devem sumir ou simplificar (research 03 §15 trata de performance, não de limiares de LOD). Definir os limiares concretos (ex.: nameplate some abaixo de 0.4× zoom) por experimentação. Decisão de design afinável.
- **Q-CNV-02 — Regra de inclusão de célula por sistema.** Em grade, "qual quadrado conta como atingido" por um template varia por sistema (PF2e tem regra própria de área). O canvas oferece o ponto de extensão na `GridStrategy`/sistema; a regra exata do PF2e fica em `17-sistema-pf2e.md`. Confirmar a regra do PF2e remaster ao detalhar `17`.
- **Q-CNV-03 — Cálculo de visão no cliente vs. servidor.** Esta spec assume que o canvas consome o polígono de visão; resta decidir (em `07`) se o polígono é calculado no servidor (autoritativo, anti-cheat de info) ou no cliente (performance), e o limiar para worker thread (cruza com `01` Q5). Impacta a latência de oclusão `vision` (REQ-CNV-045).
- **Q-CNV-04 — Granularidade da animação de movimento sob latência.** Se o update autoritativo chega com atraso variável, a animação a partir do delta pode parecer "saltada". Avaliar interpolação preditiva leve (sem ceder autoridade) ou apenas easing por distância. Cruza com `04-rede-e-sincronizacao.md`.
- **Q-CNV-05 — Persistência de fog explorado no canvas.** O fog explorado (already-seen) usa render textures + union via clipper2 (research 15 §6.4); definir em `07` se a textura de fog é por-usuário persistida no `world.db` e como o canvas a recarrega ao ativar a cena. Impacta o tempo de ativação (REQ-CNV-070, REQ-CNV-071).
- **Q-CNV-06 — Sincronização do ghost/preview entre clientes.** O preview de drag é local; decidir se o ghost de um jogador é visível aos demais (como o ruler) ou estritamente local. Cruza com presença em `04`.
- **Q-CNV-07 — Texture atlas dinâmico de status icons.** Os ícones de status vêm do sistema (quantidade variável). Definir se o atlas é montado em build (estático por sistema) ou em runtime (dinâmico) ao carregar o sistema; trade-off entre tempo de boot e flexibilidade. Cruza com `15-api-de-sistemas.md` e `20-assets-e-midia.md`.

---

## Referências

- `docs/research/03-foundry-canvas-rendering.md` — hierarquia de grupos/camadas PIXI, ordem de renderização, pipeline WebGL/batching, sistema de grade (square/hex/gridless, GRID_DIAGONALS), ruler e medição, tokens (footprint, scale, disposition, resource bars, status, vision, animação, multi-seleção, dynamic rings), tiles e oclusão, drawings, notes, templates, scene config, performance (culling, batching, atlas, formatos), interação (mouse, seleção, navegação, coordenadas), SMAA/pós-processamento, resumo arquitetural para o Fusion.
- `docs/research/15-vtt-opensource-e-bibliotecas.md` — PIXI.js v8 (WebGPU+WebGL, Render Groups para câmera, Render Layers, ParticleContainer, performance), lições de VTTs open-source (Owlbear: estado de canvas e sincronização), `honeycomb-grid` (hex pointy/flat, cube/offset/axial), `@countertype/clipper2-ts` (union de fog), Svelte 5 coexistindo com PIXI no `<canvas>`, tabela de decisão de stack.
