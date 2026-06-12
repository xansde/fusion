# 07 — Visão, Iluminação e Fog of War

- **Título:** Visão, Iluminação e Fog of War
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/04-foundry-visao-iluminacao-fog.md` (modelo de walls e restrições por dimensão, presets de parede, proximity/threshold, direcionalidade, portas, terrain walls, sistema de iluminação, darkness sources, darkness level, global illumination, animações de luz, vision modes vs detection modes, pipeline de teste de visibilidade, fog of war e FogManager, ClockwiseSweepPolygon e algoritmo de angular sweep, arquitetura de renderização PIXI, scene regions)
  - `docs/research/15-vtt-opensource-e-bibliotecas.md` (estratégia de visibility polygon próprio, clipper2 para union de fog, PIXI v8 RenderTexture, referências Red Blob Games / Nicky Case, MapTool como prova de viabilidade local, honeycomb-grid para hex)

> **Aviso clean-room.** Esta spec descreve um motor de visão/iluminação/fog **próprio** do Fusion. Onde menciona o Foundry VTT, refere-se a comportamento e conceitos observáveis publicamente (Knowledge Base, API docs, issues públicas), usados como referência de design. Nenhum código proprietário é reproduzido. O algoritmo de visibilidade é uma implementação independente baseada em fontes públicas (Red Blob Games, Nicky Case).

---

## Objetivo

Especificar o subsistema de percepção espacial do Fusion: o modelo de **paredes (walls)** que restringem visão, luz, som e movimento; o **algoritmo de visibilidade** (visibility polygon por angular sweep) que decide o que cada fonte de visão ou luz enxerga; o sistema de **iluminação dinâmica** (luzes de ambiente e de token, darkness, global illumination) e sua composição visual no canvas PIXI; os **modos de visão e detecção** por token (visão normal, darkvision, e modos [V2]); e o **fog of war** (não-explorado opaco, explorado-fora-de-visão translúcido, atualmente-visível claro), com persistência por usuário e reset.

Esta spec define **como se calcula o que cada cliente pode ver e como o canvas representa luz e névoa**. A divisão de responsabilidade entre cliente e servidor (onde cada cálculo roda) é parte central da decisão de design (ver Decisões D2 e D9).

## Escopo

### O que inclui

- **Modelo de Wall:** segmentos de linha com restrições independentes para `move`/`sight`/`light`/`sound`; modos de restrição (`none`/`normal`/`limited`/`proximity`/`reverse_proximity`); threshold/atenuação de proximidade; direcionalidade (bidirecional/esquerda/direita); portas com estado (fechada/aberta/trancada/secreta) e animação; presets de parede (normal, terrain, invisible, ethereal, door, window).
- **Algoritmo de visibilidade:** visibility polygon por angular sweep por fonte (visão de token e fonte de luz); aplicação de range (raio) e ângulo (cone) como constraints; tratamento de terrain walls (regra "passa por uma camada"); caching e invalidação dos polígonos.
- **Iluminação:** luzes de ambiente (`AmbientLight`) e de token (`token.light`); raios bright/dim; cor e intensidade; ângulo e rotação de emissão; animações; darkness sources (luminosidade negativa); darkness level da cena; global illumination e threshold; composição visual no PIXI (meshes/shaders/RenderTexture).
- **Visão por token:** alcance (range) e ângulo (cone de visão); modos de visão (`basic`, `darkvision`, [V2] `monochromatic`, [V2] `tremorsense`) e modos de detecção (`sight`, [V2] `see-invisibility`, `sense-invisibility`, `feel-tremor`); regra "GM vê tudo", "jogador vê a união dos seus tokens".
- **Fog of war:** três estados visuais (não-explorado, explorado-fora-de-visão, atualmente-visível); persistência por (usuário, cena) via textura comprimida + union acumulado com clipper2; reset pelo GM; toggle de uso de fog por cena.
- **Casos de teste comportamentais:** cenários verificáveis (abrir porta atualiza visão, mover token revela fog, etc.).

### O que NÃO inclui

- Renderização base do canvas (camadas PIXI, câmera/pan/zoom, sprites de token, grid de fundo) — ver `06-canvas-e-renderizacao.md`. Esta spec usa o canvas, mas o framework de camadas é definido lá.
- Protocolo de transporte dos deltas de fog, do movimento de token e dos updates de wall/luz pela rede — ver `04-rede-e-sincronizacao.md`. Aqui se define **o que** é transportado (forma do delta de fog, validação de colisão), não o envelope.
- Schema persistido de `Scene`, `Wall`, `AmbientLight`, `Token` no banco — ver `02-modelo-de-dados.md` (esta spec define as interfaces de dados de percepção, que serão refletidas no modelo de dados).
- Escrita em disco do `world.db` e da textura de fog — ver `03-persistencia-e-mundos.md`.
- Quem pode editar walls/luzes e quem é dono de qual token (matriz de ownership) — ver `05-usuarios-e-permissoes.md`. Esta spec assume o resultado dessa checagem (ex.: "os tokens controlados pelo usuário").
- Custo de movimento, pathfinding e medição de distância (ruler) — ver `06-canvas-e-renderizacao.md`. Walls aqui só restringem **se** o movimento atravessa, não o custo.
- Templates de área de magia, weather e efeitos visuais não ligados a luz/visão — ver `06-canvas-e-renderizacao.md`.
- Áudio posicional e propagação de som por walls (a dimensão `sound` da wall é **modelada** aqui, mas seu efeito sonoro é consumido em `13-audio-e-playlists.md`).
- Scene Regions completas (shapes + behaviors arbitrários) — [V2]; esta spec só prevê o gancho de "darkness por região" como questão em aberto.

## Conceitos e terminologia

| Termo | Definição no Fusion |
|---|---|
| **Wall (parede)** | Segmento de linha `(a, b)` numa cena que restringe percepção. Cada wall tem quatro restrições independentes: `move`, `sight`, `light`, `sound`. É um Document embutido na `Scene`. |
| **Restrição** | O modo como uma wall afeta uma dimensão: `none` (passa livre), `normal` (bloqueia), `limited` (passa uma camada — terrain), `proximity` (passa se a fonte está perto), `reverse_proximity` (passa se a fonte está longe). Para `move` só `none`/`normal`. |
| **Threshold** | Distância (em pixels de cena) usada por `proximity`/`reverse_proximity` para decidir se a percepção penetra; com atenuação, a penetração é gradual em vez de binária. |
| **Direcionalidade (`dir`)** | Lado pelo qual a wall restringe: `both` (padrão), `left` ou `right`, relativo à orientação `a→b` do segmento. Permite efeitos one-way. |
| **Door (porta)** | Wall com `doorType` (`none`/`door`/`secret`) e `doorState` (`closed`/`open`/`locked`). Quando `open`, a wall não restringe nenhuma dimensão. |
| **Vision source (fonte de visão)** | Origem de percepção atrelada a um token controlável: posição, range, ângulo, modo de visão e modos de detecção. Produz um **vision polygon**. |
| **Light source (fonte de luz)** | Origem de iluminação (ambient ou de token): posição, raios bright/dim, cor, ângulo, animação, luminosidade. Produz um **light polygon** (área iluminada limitada por walls de `light`). |
| **Visibility polygon (polígono de visibilidade)** | Polígono calculado por angular sweep a partir de uma origem, recortado pelas walls relevantes; representa a área "alcançável" por raios retos a partir da origem antes de aplicar range/ângulo. |
| **Vision polygon** | Visibility polygon de uma fonte de visão, recortado por walls de `sight`, range e ângulo. |
| **Light polygon** | Visibility polygon de uma fonte de luz, recortado por walls de `light`, raio e ângulo. |
| **LOS (line of sight)** | Linha de visão: um ponto-alvo está em LOS de uma fonte se está contido no vision polygon (sem wall de `sight` `normal` no caminho, respeitando `limited`). |
| **Illumination level (nível de iluminação)** | Estado de iluminação de uma área: `bright` (2), `dim` (1), `unlit` (0), `darkness` (-2). Determina o que uma dada combinação de vision mode percebe. |
| **Vision mode (modo de visão)** | Define a **aparência** do que o token vê (cor/dessaturação) conforme o nível de iluminação. Ex.: `basic`, `darkvision`, [V2] `monochromatic`. Ortogonal ao detection mode. |
| **Detection mode (modo de detecção)** | Define a **mecânica** do que pode ser detectado e sob quais condições (requer LOS? penetra walls?). Ex.: `sight`, `see-invisibility`, `sense-invisibility`, `feel-tremor`. |
| **Darkness source** | Fonte de iluminação com luminosidade negativa: emite escuridão, suprimindo luz de outras fontes na sua área. |
| **Darkness level** | Parâmetro de cena (0–1) que escurece visualmente a cena (hora do dia) e, via threshold, controla global illumination. |
| **Global illumination (GI)** | Modo de cena onde toda a área (explorada) conta como iluminada, dispensando fontes de luz. Suprimido quando o darkness level cruza o `globalLightThreshold`. |
| **Fog of war (névoa de guerra)** | Camada de exploração por (usuário, cena). Três estados: **não-explorado** (opaco total), **explorado-fora-de-visão** (translúcido), **atualmente-visível** (claro). |
| **Exploration texture (textura de exploração)** | Máscara monocromática persistente que acumula tudo que o usuário já explorou na cena; só cresce (exceto reset). |
| **Vision mask (máscara de visão)** | Máscara efêmera, recalculada por frame, que representa o que os tokens do usuário enxergam **agora** (união dos vision polygons + light polygons aplicáveis). |

## Decisões

Cada decisão lista alternativas rejeitadas e o racional.

### D1 — Wall como segmento com quatro restrições independentes

Uma wall é um segmento `(a, b)` com restrições **independentes** por dimensão: `move`, `sight`, `light`, `sound`. Esta é a abstração mais importante do subsistema: um mesmo segmento pode bloquear visão sem bloquear movimento, bloquear luz sem bloquear som, etc.

- **Alternativas rejeitadas:**
  - *Um booleano único "bloqueia tudo"*: insuficiente para vidro (bloqueia movimento e som, mas não visão/luz), barreiras etéreas (bloqueiam visão, permitem passagem), terrenos translúcidos. Rejeitado.
  - *Restrições só para sight e light*: deixaria movimento e som sem modelo, exigindo um segundo sistema de colisão paralelo. Unificar as quatro dimensões no mesmo Document de wall simplifica edição e cálculo.
- **Racional:** Modela diretamente os casos do research (research 04 §1.1–1.3): a separação por dimensão é "o ponto arquitetural mais importante" das walls. Presets (D4) são apenas combinações pré-definidas dessas quatro restrições.

### D2 — Visibilidade calculada no cliente; servidor valida colisão de movimento

Os **vision polygons** e **light polygons** (e portanto a máscara de visão e o fog) são calculados **no cliente** que controla os tokens. O servidor é autoritativo sobre **posições e walls** (o que constitui a "verdade" geométrica) e valida **colisão de movimento** (se um `token:move` atravessa uma wall de `move` `normal`), mas NÃO recalcula a visão de cada cliente.

- **Alternativas rejeitadas:**
  - *Calcular visão no servidor e enviar o polígono pronto a cada cliente*: o servidor é single-thread (ver `01-arquitetura-geral.md` D1/D9); recalcular o polígono de N tokens por frame para M clientes no event loop principal congelaria a sincronização de todos. Além disso, geraria tráfego de polígonos por frame. Rejeitado para o caminho quente; o servidor só valida colisão (operação pontual e barata).
  - *Confiar no cliente para "o que pode ver" sem nenhuma checagem servidor*: cliente é não-confiável. Mitigado porque (a) o servidor não envia ao cliente Documents que o usuário não pode possuir/ver (ver `04` REQ-NET-024 e `05`), reduzindo o que um cliente trapaceiro poderia revelar; (b) o fog é por-usuário e local — revelar o próprio fog não dá vantagem mecânica sobre outros jogadores. O risco residual (um jogador "ver" geometria de parede que poderia inferir) é aceitável no MVP e tratado em `21-seguranca.md`.
- **Racional:** Alinha com o research 15 §6.4 ("visibility polygon calculado no servidor **ou** no cliente a cada movimento") e com a diretriz arquitetural de não bloquear o event loop (research 01-spec D9). O cálculo de visão é inerentemente per-viewer e gráfico — pertence ao cliente, junto do PIXI. O servidor mantém a autoridade onde importa para anti-cheat: posição final do token e colisão de movimento.

### D3 — Algoritmo de visibilidade: visibility polygon por angular sweep, implementação própria

A visibilidade usa **visibility polygon por varredura angular** (angular sweep), implementação independente baseada nas fontes públicas Red Blob Games e Nicky Case. Complexidade alvo O(n log n) para n arestas relevantes.

- **Alternativas rejeitadas:**
  - *Ray casting bruto (disparar K raios fixos em todas as direções)*: O(K·n), impreciso (artefatos em cantos) e custoso para muitos tokens. Rejeitado.
  - *Shadow casting em grid (recursive shadowcasting de roguelikes)*: amarrado a grid quadrado; o Fusion suporta grid quadrado, hexagonal e gridless (ver `06`). Walls do Fusion são geometria contínua, não células. Rejeitado.
  - *Biblioteca `visibility-polygon-js` direta*: arquivada/legada (research 15 §6.2); usada apenas como referência conceitual, não como dependência.
- **Racional:** Angular sweep é o padrão para visibility polygon com geometria de segmentos arbitrários (research 04 §5.1–5.2, research 15 §6.1). Dispara raios para cada endpoint de wall (mais dois raios com offset ε para "dobrar a esquina"), ordena interseções por ângulo e conecta os pontos. É o mesmo padrão do `ClockwiseSweepPolygon` do Foundry, mas escrito do zero. Uma **quadtree** (ou bucket grid) de walls limita o conjunto de arestas testadas por origem.

### D4 — Presets de wall como combinações nomeadas das quatro restrições

A UI oferece **presets** (`normal`, `terrain`, `invisible`, `ethereal`, `door`, `window`) que apenas pré-preenchem as quatro restrições. O dado persistido é sempre as quatro restrições; o preset é conveniência de edição.

- **Alternativas rejeitadas:**
  - *Persistir o tipo de preset e derivar restrições em runtime*: acopla a semântica ao enum de preset, dificultando walls "híbridas" customizadas e migrações quando um preset muda. Rejeitado — persistir o estado expandido é mais robusto.
- **Racional:** Reproduz a ergonomia do research 04 §1.2 (presets) sem amarrar o modelo de dados. Um `window` é só `{sight: proximity, light: proximity, sound: proximity, move: normal}` com threshold default.

### D5 — Modo `limited` (terrain) implementado por contagem no sweep

Walls com restrição `limited` (terrain) deixam a percepção passar por **uma** camada: o sweep conta quantas arestas `limited` o raio cruzou; 0 ou 1 → passa; 2+ → bloqueia. A contagem é por dimensão (sight/light têm contadores separados).

- **Alternativas rejeitadas:**
  - *Tratar terrain como semitransparência sem contagem*: não modela o caso clássico de "ver a rocha mas não o que está atrás" (research 04 §1.7). Rejeitado.
- **Racional:** É a semântica observada (research 04 §1.7). Atenção ao bug conhecido de vértices compartilhados em terrain walls complexas (research 04 §1.7, issue #5935): a contagem deve ser por aresta cruzada, com cuidado em vértices coincidentes — tratado como caso de teste e questão de robustez.

### D6 — Fog de três estados, persistido por (usuário, cena) como textura comprimida + union clipper2

O fog tem três estados: **não-explorado** (opaco total), **explorado-fora-de-visão** (translúcido), **atualmente-visível** (claro). A exploração acumulada é persistida por par (usuário, cena) como **textura comprimida** (PNG/WebP) e, geometricamente, como **union de polígonos** mantido com `@countertype/clipper2-ts`. A máscara de "atualmente visível" é efêmera (recalculada por frame, nunca persistida).

- **Alternativas rejeitadas:**
  - *Fog em dois estados (visível / não-visível, sem memória)*: perde o valor de "já explorei este corredor". O estado intermediário translúcido é esperado pelos jogadores (research 04 §4.1). Rejeitado.
  - *Fog global compartilhado entre todos os jogadores*: a exploração é individual por design (research 04 §4.1: "cada jogador mantém seu próprio estado"). Rejeitado; o GM tem visão total separada (D8).
  - *Persistir só a textura, sem geometria*: a textura é boa para render e save, mas operações de "revelar" e o cálculo de "ponto X já explorado?" se beneficiam de geometria. Mantemos **ambos**: a textura é a representação serializável/renderizável; o union de polígonos (clipper2) é a representação geométrica para revelar incrementalmente e testar pontos (research 15 §6.3–6.4).
  - *Persistir como base64 dentro do `world.db`*: a textura de fog pode ser grande; guardá-la inline incha o banco. Decisão de **onde** salvar (blob no banco vs arquivo no diretório do world) fica para `03-persistencia-e-mundos.md`; esta spec só especifica o formato (imagem comprimida) e a chave (usuário+cena).
- **Racional:** Combina o research 04 §4 (FogManager, textura WebP por usuário/cena, commit com threshold para evitar writes excessivos) com a estratégia recomendada no research 15 §6.4 (RenderTexture do PIXI + clipper2 para union progressivo). O `commit` é throttled (D7).

### D7 — Persistência de fog throttled e off-loop

O fog explorado é acumulado em GPU (RenderTexture) e em geometria (clipper2) continuamente, mas a **persistência** (serializar a textura e salvar) só ocorre periodicamente (após N atualizações ou T segundos de inatividade), nunca por frame. A serialização/compressão da textura roda fora do caminho quente de render.

- **Alternativas rejeitadas:**
  - *Salvar o fog a cada frame de movimento*: I/O e CPU excessivos; o research 04 §4.3 nota o `COMMIT_THRESHOLD = 70` justamente para evitar writes a cada refresh. Rejeitado.
- **Racional:** Espelha o `COMMIT_THRESHOLD`/`commit()` do research 04 §4.3–4.4. O delta de fog para o servidor (para persistir o estado daquele usuário) é enviado de forma esparsa e tratado como op de baixa prioridade (ver `04-rede-e-sincronizacao.md`, que transporta o delta de fog).

### D8 — GM vê tudo; jogador vê a união dos seus tokens

O **GM** (e assistentes) enxerga a cena inteira sem fog ativo (vê todos os tokens e geometria). Um **jogador** vê a **união** dos vision polygons de todos os tokens que controla, mais a área iluminada que essas fontes de visão percebem, mais o fog já explorado por ele.

- **Alternativas rejeitadas:**
  - *GM também sujeito a fog*: atrapalha a preparação e narração; o GM precisa de visão onisciente da cena. O GM pode opcionalmente ativar uma pré-visualização do fog de um jogador ([V2]). Rejeitado como default.
  - *Jogador vê apenas o token "ativo"*: jogadores frequentemente controlam familiares, invocações ou múltiplos personagens; a união é o comportamento esperado. Rejeitado.
- **Racional:** Comportamento padrão de VTTs (research 04 §3, §4.1). Quem controla qual token vem de `05-usuarios-e-permissoes.md`; esta spec consome esse conjunto.

### D9 — Cálculo pesado de visão pode migrar para Web Worker no cliente

Quando o número de walls/fontes torna o sweep custoso o bastante para causar queda de frame, o cálculo do visibility polygon roda em um **Web Worker** no cliente (OffscreenCanvas/transferência de buffers), mantendo a thread de UI fluida. No MVP, começa na thread principal com orçamento de tempo; o worker é o caminho de escala.

- **Alternativas rejeitadas:**
  - *Sempre na thread principal*: cenas grandes (muitas walls) travariam o pan/zoom e a animação de tokens. Rejeitado como única estratégia.
  - *Cálculo no servidor* (já rejeitado em D2).
- **Racional:** Alinha com a diretriz de não bloquear (research 01-spec D9, que cita explicitamente "visibility polygon pesado" como candidato a worker). O limiar exato (nº de walls) é questão em aberto, a medir.

### D10 — Iluminação composta em RenderTextures e meshes/shaders PIXI

A iluminação é composta no canvas via PIXI v8: cada fonte de luz renderiza seu light polygon em uma RenderTexture de iluminação (com gradiente bright→dim e cor); a darkness da cena é um tint/overlay; a máscara de visão recorta o que o jogador efetivamente vê. Animações de luz são shaders/parâmetros por frame.

- **Alternativas rejeitadas:**
  - *Iluminação puramente geométrica sem shaders (polígonos sólidos)*: bordas duras, sem gradiente dim, sem cor suave, sem animação. Insuficiente para a qualidade visual esperada. Rejeitado.
  - *Canvas 2D*: performance inferior para iluminação dinâmica com muitos polígonos (research 15 §3.4). Rejeitado.
- **Racional:** Espelha a arquitetura de render do research 04 §5.3, §7 (visibilidade como máscara sobre camadas de luz/fog; meshes background/coloration/illumination por fonte) com PIXI v8 (research 15 §3.1). O framework de camadas concreto vem de `06-canvas-e-renderizacao.md`.

### D11 — Grid-agnóstico: visão opera em coordenadas de pixel, não em células

O cálculo de visão, luz e walls opera em **coordenadas contínuas de pixel** da cena, independente do tipo de grid (square/hex/gridless). Range de visão e raios de luz são convertidos de unidades de grid para pixels via a métrica da cena.

- **Alternativas rejeitadas:**
  - *Visão por células (FOV de roguelike)*: amarra ao grid quadrado e quantiza a geometria. O Fusion suporta hex e gridless. Rejeitado.
- **Racional:** Walls são segmentos contínuos; tokens movem-se livremente (snap ao grid é só UX, ver `06`). Manter a percepção em pixels desacopla do grid. A conversão unidade→pixel usa a configuração de grid da cena (ver `06-canvas-e-renderizacao.md`).

## Requisitos funcionais

> Tags: **[MVP]** = necessário para "jogar uma sessão de PF2e com mapa+grid, tokens com movimento, visão/iluminação/fog básicos". **[V2]** = pós-MVP.

### Modelo e edição de walls

- **REQ-VIS-001** [MVP] Uma cena DEVE poder conter um conjunto de **walls**, cada uma um segmento `(a, b)` em coordenadas de pixel da cena, com restrições independentes `move`, `sight`, `light`, `sound`.
- **REQ-VIS-002** [MVP] As restrições de `sight`, `light` e `sound` DEVEM suportar os modos `none`, `normal` e `limited`; `move` DEVE suportar `none` e `normal`. Os modos `proximity` e `reverse_proximity` para `sight`/`light`/`sound` são **[V2]**.
- **REQ-VIS-003** [MVP] Cada wall DEVE ter direcionalidade `dir` ∈ {`both`, `left`, `right`}, relativa à orientação `a→b`; restrições só se aplicam pelo(s) lado(s) indicado(s).
- **REQ-VIS-004** [MVP] Uma wall PODE ser uma **porta** (`doorType` ∈ {`none`, `door`, `secret`}) com estado (`doorState` ∈ {`closed`, `open`, `locked`}). Quando `doorState === "open"`, a wall NÃO DEVE restringir nenhuma dimensão.
- **REQ-VIS-005** [MVP] Portas `secret` NÃO DEVEM expor controle de interação para usuários não-GM, e sua existência como porta NÃO DEVE ser distinguível de uma parede normal para o jogador (apenas o GM vê o ícone de porta secreta).
- **REQ-VIS-006** [MVP] Abrir, fechar ou trancar uma porta DEVE invalidar e recalcular as máscaras de visão e luz afetadas e atualizar o fog dos clientes em tempo real (ver Casos de teste CT-01).
- **REQ-VIS-007** [MVP] Trancar uma porta (`locked`) DEVE impedir que jogadores a abram; somente GM/assistente PODE destrancar. Tentar abrir uma porta trancada DEVE produzir feedback (ex.: som/indicação), sem alterar estado.
- **REQ-VIS-008** [MVP] A UI de edição de walls (restrita a GM/assistente, ver `05`) DEVE oferecer **presets** que pré-preenchem as quatro restrições: `normal`, `terrain` (sight/light `limited`), `invisible` (sight/light `none`), `ethereal` (sight/light `normal`, move `none`), `door`. O preset `window` (proximity) é **[V2]**.
- **REQ-VIS-009** [MVP] O editor DEVE permitir desenhar, mover endpoints, dividir, juntar (chain) e apagar walls, com **snap** opcional a endpoints próximos e ao grid.
- **REQ-VIS-010** [V2] Walls de `proximity`/`reverse_proximity` DEVEM suportar um `threshold` (distância em pixels) e atenuação opcional (`attenuation`), em que a penetração de sight/light é gradual conforme a fonte se aproxima/afasta; `sound` com proximity é binário (sem atenuação).
- **REQ-VIS-011** [V2] Portas DEVEM suportar **animação** de abertura/fechamento (ex.: swing/slide) com duração configurável e efeito sonoro opcional (o áudio é consumido por `13-audio-e-playlists.md`).
- **REQ-VIS-012** [V2] Walls DEVEM suportar faixa de **elevação** (bottom/top) para cenas multi-andar, restringindo a percepção apenas para fontes dentro da faixa.

### Algoritmo de visibilidade

- **REQ-VIS-020** [MVP] O sistema DEVE calcular, para cada fonte de visão e cada fonte de luz, um **visibility polygon** por angular sweep a partir da origem, recortado pelas walls relevantes à dimensão (sight para visão; light para luz).
- **REQ-VIS-021** [MVP] O sweep DEVE disparar raios para os endpoints das walls relevantes, com dois raios auxiliares de offset ±ε angular por endpoint para resolver corretamente os cantos, e conectar as interseções ordenadas por ângulo.
- **REQ-VIS-022** [MVP] O conjunto de walls testadas por origem DEVE ser reduzido por um índice espacial (quadtree ou bucket grid) limitado ao alcance máximo daquela fonte, para escalar com o número de walls.
- **REQ-VIS-023** [MVP] O vision polygon DEVE ser recortado por um **range** (círculo de raio = alcance de visão convertido para pixels) e, quando o ângulo de visão < 360°, por um **cone** centrado na rotação do token.
- **REQ-VIS-024** [MVP] O light polygon DEVE ser recortado pelo raio `dim` (e marcar internamente a sub-área `bright`), e pelo ângulo/rotação de emissão quando < 360°.
- **REQ-VIS-025** [MVP] Walls com restrição `limited` (terrain) na dimensão calculada DEVEM permitir que o raio passe por **uma** camada: o sweep conta arestas `limited` cruzadas; ao cruzar a segunda, o raio é bloqueado. Sight e light contam independentemente.
- **REQ-VIS-026** [MVP] A direcionalidade (`dir`) da wall DEVE ser respeitada no sweep: uma wall que só restringe pelo lado `left` não bloqueia raios que a cruzam pelo lado `right`.
- **REQ-VIS-027** [MVP] Os polígonos calculados DEVEM ser **cacheados** por fonte e invalidados quando: a origem move; o range/ângulo/modo da fonte muda; qualquer wall dentro do alcance da fonte é criada/movida/removida/alterada (inclui abrir/fechar porta); ou a cena recarrega. Fontes não afetadas por uma mudança NÃO DEVEM recalcular.
- **REQ-VIS-028** [MVP] O recálculo de visibilidade NÃO DEVE bloquear a thread de UI por mais que o orçamento de frame; quando o custo exceder o orçamento, o cálculo DEVE poder ser feito em um Web Worker (D9), com o resultado aplicado de forma assíncrona.
- **REQ-VIS-029** [MVP] O teste "o ponto P está em LOS da fonte F" DEVE ser respondível a partir do vision polygon de F (contenção ponto-em-polígono), para uso em detecção de tokens e visibilidade de placeables.
- **REQ-VIS-030** [MVP] O cálculo DEVE ser robusto a casos degenerados: walls de comprimento zero, walls coincidentes, vértices compartilhados entre terrain walls (não contar duas vezes), e origem exatamente sobre uma wall ou endpoint.

### Iluminação

- **REQ-VIS-040** [MVP] Uma cena DEVE suportar **fontes de luz de ambiente** (`AmbientLight`), Documents embutidos com posição, raios `bright` e `dim` (em unidades de grid), cor (hex) e intensidade, ângulo de emissão e rotação, e flag de ativação.
- **REQ-VIS-041** [MVP] Um **token** DEVE poder emitir luz própria (`token.light`) com os mesmos parâmetros de uma luz de ambiente; a luz acompanha o token ao mover e é recalculada como uma luz de ambiente, respeitando walls de `light`.
- **REQ-VIS-042** [MVP] A área de uma fonte de luz DEVE ser limitada pelo seu light polygon (recortado por walls de `light`); uma luz NÃO DEVE iluminar através de uma wall que bloqueia `light` (salvo flag explícita "ignora walls" — **[V2]**).
- **REQ-VIS-043** [MVP] A composição visual DEVE distinguir três níveis: `bright` (plenamente iluminado), `dim` (penumbra, intensidade reduzida) e `unlit` (não iluminado), com transição suave (gradiente) entre `bright` e `dim` por default e opção de borda abrupta.
- **REQ-VIS-044** [MVP] A cena DEVE ter um **darkness level** (0–1) que escurece visualmente a cena; DEVE ter um **global illumination** ligável e um `globalLightThreshold` (0–1) acima do qual a GI é suprimida (research 04 §2.5).
- **REQ-VIS-045** [MVP] Com **global illumination** ativa e darkness level abaixo do threshold, toda a área **explorada** DEVE contar como ao menos `dim`/`bright` (conforme config), dispensando fontes de luz; ao cruzar o threshold, a GI DEVE ser suprimida e tokens sem luz/darkvision ficam sem visão em áreas não iluminadas.
- **REQ-VIS-046** [MVP] Fontes de luz DEVEM suportar **cor** com intensidade configurável, compondo-se sobre o background da cena sem ocultá-lo completamente (método de coloração default tipo "adaptive luminance").
- **REQ-VIS-047** [V2] Fontes de luz DEVEM suportar **animações** (ex.: torch/flicker, pulse, chroma) parametrizadas por velocidade e intensidade, implementadas como shaders/parâmetros por frame.
- **REQ-VIS-048** [V2] O sistema DEVE suportar **darkness sources** (luminosidade negativa) que suprimem luz de outras fontes na sua área, modelando escuridão mágica.
- **REQ-VIS-049** [V2] Fontes de luz DEVEM suportar **darkness activation range** (faixa de darkness level em que ligam/desligam automaticamente).
- **REQ-VIS-050** [MVP] Ligar/desligar/mover/recolorir uma luz DEVE invalidar apenas as máscaras afetadas e recompor a iluminação sem recalcular fontes não impactadas.

### Visão por token e detecção

- **REQ-VIS-060** [MVP] Cada token DEVE ter parâmetros de visão: `enabled` (token tem visão?), `range` (alcance em unidades de grid; `null` = ilimitado dentro da cena), `angle` (ângulo do cone, default 360°), `visionMode` e lista de `detectionModes`.
- **REQ-VIS-061** [MVP] O modo de visão `basic` DEVE depender de iluminação: em área `unlit`/`darkness`, um token só-`basic` NÃO enxerga; em `dim`/`bright` enxerga normalmente (colorido).
- **REQ-VIS-062** [MVP] O modo de visão `darkvision` DEVE permitir enxergar em área `unlit` (até o range), com renderização **dessaturada/monocromática** nessas áreas e colorida onde há luz.
- **REQ-VIS-063** [V2] O modo de visão `monochromatic` DEVE renderizar a visão sempre de forma dessaturada (monocromática/escala de cinza), independente do nível de iluminação da área — diferente de `darkvision`, que é colorido em áreas iluminadas e monocromático apenas em `unlit`. (Research 04 §3.2)
- **REQ-VIS-064** [MVP] Um **jogador** DEVE ver a **união** dos vision polygons de todos os tokens que controla (mais a iluminação que essas fontes percebem). Um **GM/assistente** DEVE ver a cena inteira (sem fog ativo por default).
- **REQ-VIS-065** [MVP] A **visibilidade de um token-alvo** para um observador DEVE depender de: (a) o alvo estar dentro do range de algum detection mode do observador; (b) se o modo requer LOS, o alvo estar contido no vision polygon do observador; (c) o alvo estar suficientemente iluminado/perceptível conforme o vision mode (ex.: `basic` não vê em `unlit`).
- **REQ-VIS-066** [MVP] O detection mode `sight` DEVE requerer LOS (bloqueado por walls de `sight`) e respeitar iluminação. É o modo base de todo token com visão.
- **REQ-VIS-067** [V2] DEVEM existir detection modes adicionais: `see-invisibility` (requer LOS; detecta tokens com condição "invisível"), `sense-invisibility` (ignora walls; detecta invisíveis através de paredes), `feel-tremor`/tremorsense (ignora walls; detecta tokens na mesma elevação, exceto voadores). Convenção semântica: nomes "see-*" requerem LOS; "sense-*"/"feel-*" ignoram walls.
- **REQ-VIS-068** [V2] DEVE existir o vision mode `tremorsense` com aparência de "radar sweep" (revela geometria/fog sem revelar o background da cena).
- **REQ-VIS-069** [MVP] Quando o usuário não controla nenhum token com visão em uma cena com fog ativo, o cliente DEVE exibir apenas o fog já explorado por ele (sem revelar novas áreas), conforme política da cena (ver REQ-VIS-085).
- **REQ-VIS-070** [MVP] Mudanças nos parâmetros de visão de um token (range, ângulo, modo) DEVEM invalidar e recalcular a máscara de visão do(s) usuário(s) que o controla(m).

### Fog of war

- **REQ-VIS-080** [MVP] O fog of war DEVE ter três estados visuais por pixel: **não-explorado** (opaco total, oculta o mapa), **explorado-fora-de-visão** (translúcido/escurecido, mostra o mapa atenuado sem tokens/atualizações ao vivo), **atualmente-visível** (claro, mostra tudo).
- **REQ-VIS-081** [MVP] A área **atualmente-visível** DEVE ser a união dos vision/light polygons aplicáveis dos tokens do usuário, recalculada quando a visão muda (movimento, porta, luz). Essa máscara é **efêmera** e NÃO é persistida.
- **REQ-VIS-082** [MVP] A área **explorada** DEVE acumular tudo que já esteve atualmente-visível para aquele usuário naquela cena, mantida como **union de polígonos** (clipper2) e materializada como **textura comprimida**. A exploração só cresce (exceto reset).
- **REQ-VIS-083** [MVP] A exploração DEVE ser **persistida por par (usuário, cena)** como imagem comprimida (PNG/WebP), com `commit` **throttled** (após N atualizações ou T de inatividade), nunca por frame (D7). O destino físico do arquivo é definido por `03-persistencia-e-mundos.md`; o delta para o servidor trafega por `04-rede-e-sincronizacao.md`.
- **REQ-VIS-084** [MVP] Ao abrir uma cena, o cliente DEVE carregar a exploração persistida do usuário (se houver) e renderizá-la como estado inicial do fog antes do primeiro cálculo de visão.
- **REQ-VIS-085** [MVP] Cada cena DEVE ter uma flag **fog habilitado** e uma política de **token vision habilitado**: com fog desabilitado, toda a cena é visível a todos (mapa de "teatro da mente" ou exterior aberto); com token vision habilitado, jogadores são limitados ao que seus tokens veem.
- **REQ-VIS-086** [MVP] O **GM** DEVE poder **resetar** o fog of war de uma cena: para todos os usuários ou para um usuário específico. O reset DEVE limpar a exploração persistida e a textura, voltando a cena a totalmente não-explorada para o(s) usuário(s) alvo.
- **REQ-VIS-087** [MVP] O reset DEVE ser robusto ao caso de exploração local ainda não persistida (research 04 §4.5, issue #8122): o reset limpa tanto o estado no servidor quanto o cache local do cliente, sem reaparecimento de áreas após refresh (issue #7613).
- **REQ-VIS-088** [V2] O GM DEVE poder **pré-revelar** manualmente áreas do fog (pintar como explorado) ou **reocultar** áreas, por usuário ou para todos.
- **REQ-VIS-089** [V2] O GM DEVE poder **pré-visualizar** o fog/visão de um jogador específico (ver a cena pelos olhos dele) para fins de preparação.

### Integração e invalidação

- **REQ-VIS-090** [MVP] Um `token:move` confirmado pelo servidor (ver `04` REQ-NET-050) DEVE acionar, no cliente, o recálculo da máscara de visão do(s) token(s) movido(s), a expansão do fog explorado e a recomposição da iluminação afetada.
- **REQ-VIS-091** [MVP] O servidor DEVE validar **colisão de movimento** contra walls de `move` `normal`/portas fechadas/trancadas ao processar `token:move`, rejeitando ou ajustando movimentos que atravessem barreiras (a forma como rejeita/ajusta é coordenada com `04` e `06`).
- **REQ-VIS-092** [MVP] Criar/mover/alterar/remover uma wall ou luz (op de Document via `04`) DEVE propagar a invalidação para todos os clientes na cena, que recalculam apenas as fontes dentro do alcance da mudança (REQ-VIS-027, REQ-VIS-050).
- **REQ-VIS-093** [MVP] As interfaces de `Wall`, `AmbientLight` e os campos de visão/luz do `Token` DEFINIDAS aqui DEVEM ser refletidas no schema persistido em `02-modelo-de-dados.md`, sem divergência de tipos (fonte única em `packages/shared`).

## Requisitos não-funcionais

- **REQ-VIS-100** [MVP] O recálculo da máscara de visão completa de uma cena típica do MVP (≤ 500 walls, ≤ 8 tokens com visão, ≤ 20 luzes) ao mover um token DEVE caber no orçamento de um frame a 60 fps (≤ ~16 ms) em hardware baseline, ou ser feito off-thread sem travar a UI (D9).
- **REQ-VIS-101** [MVP] O algoritmo de visibilidade DEVE ter complexidade O(n log n) no número de walls relevantes por fonte (dominado pela ordenação angular), com poda espacial reduzindo n ao alcance da fonte.
- **REQ-VIS-102** [MVP] A persistência de fog NÃO DEVE causar mais que um `commit` a cada N atualizações/T segundos (D7), e a serialização da textura NÃO DEVE bloquear a render thread.
- **REQ-VIS-103** [MVP] O cálculo de visão DEVE ser **determinístico** dado o mesmo conjunto de walls e a mesma origem (mesmo polígono em qualquer cliente), para que a noção de "o que é visível" seja consistente entre o cliente e a validação de colisão do servidor.
- **REQ-VIS-104** [MVP] O cliente DEVE degradar com elegância em cenas grandes: se o orçamento de frame for excedido repetidamente, PODE reduzir a frequência de recálculo durante o arraste (recalcular no `drop`) sem travar.
- **REQ-VIS-105** [MVP] A textura de fog persistida DEVE ser comprimida (formato com perdas/lossless adequado) para manter o tamanho por (usuário, cena) modesto; cenas muito grandes PODEM usar resolução de fog reduzida (downscale) sem artefatos perceptíveis.
- **REQ-VIS-106** [MVP] Os tipos do subsistema (wall, luz, visão, detecção, fog delta) DEVEM viver em `packages/shared` e ser usados por servidor e cliente sem divergência (TypeScript estrito).
- **REQ-VIS-107** [MVP] O cliente DEVE detectar ausência de WebGPU e operar via WebGL (capacidade do PIXI v8, ver `01`/`06`) sem perda de funcionalidade de visão/fog.

## Modelo de dados

Interfaces em TypeScript (estrito), definidas em `packages/shared` e refletidas no schema persistido por `02-modelo-de-dados.md`. Coordenadas em pixels da cena; distâncias de range/raio em **unidades de grid** (convertidas para pixels em runtime pela métrica da cena, ver `06`).

```typescript
/** Dimensões de percepção que uma wall pode restringir. */
export type WallSense = "move" | "sight" | "light" | "sound";

/** Modos de restrição. `move` só usa "none" | "normal". */
export type RestrictionMode =
  | "none"            // passa livremente
  | "normal"          // bloqueia
  | "limited"         // passa uma camada (terrain)
  | "proximity"       // [V2] passa se a fonte está dentro do threshold
  | "reverse_proximity"; // [V2] passa se a fonte está além do threshold

/** Direcionalidade da wall, relativa à orientação a→b. */
export type WallDirection = "both" | "left" | "right";

export type DoorType = "none" | "door" | "secret";
export type DoorState = "closed" | "open" | "locked";

/** Wall: segmento embutido na Scene. */
export interface Wall {
  _id: string;
  /** Endpoints em pixels da cena. */
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Restrição por dimensão. */
  move: "none" | "normal";
  sight: RestrictionMode;
  light: RestrictionMode;
  sound: RestrictionMode;
  dir: WallDirection;
  doorType: DoorType;
  doorState: DoorState;
  /** [V2] threshold (px) e atenuação para proximity/reverse_proximity. */
  threshold?: number;
  attenuation?: boolean;
  /** [V2] faixa de elevação para cenas multi-andar. */
  elevation?: { bottom: number; top: number };
}

/** Preset apenas para a UI; expande para as quatro restrições ao persistir. */
export type WallPreset =
  | "normal" | "terrain" | "invisible" | "ethereal" | "door" | "window"; // window = [V2]

/** Fonte de luz de ambiente (Document embutido na Scene). */
export interface AmbientLight {
  _id: string;
  x: number;
  y: number;
  /** Raios em unidades de grid. */
  bright: number;
  dim: number;
  /** Ângulo de emissão em graus (360 = círculo completo). */
  angle: number;
  /** Rotação/orientação em graus. */
  rotation: number;
  /** Cor hex (#rrggbb) e intensidade 0–1. */
  color: string;
  intensity: number;
  /** Transição suave bright→dim. */
  gradual: boolean;
  /** Se false, luz ignora walls de light. [V2] */
  constrainedByWalls: boolean;
  /** Luminosidade; negativa = darkness source. [V2] */
  luminosity: number;
  /** Animação. [V2] */
  animation?: LightAnimation;
  /** Faixa de darkness level em que a luz ativa. [V2] */
  darknessActivation?: { min: number; max: number };
  enabled: boolean;
}

/** [V2] Configuração de animação de luz. */
export interface LightAnimation {
  type: string;        // ex.: "torch" | "pulse" | "chroma"
  speed: number;       // 0–10
  intensity: number;   // 0–10
  reverse?: boolean;
}

/** Vision modes (aparência) e detection modes (mecânica). */
export type VisionModeId =
  | "basic" | "darkvision"
  | "monochromatic" // [V2] sempre dessaturado independente de iluminação
  | "tremorsense";  // [V2]

export type DetectionModeId =
  | "sight"
  | "see-invisibility"    // [V2] requer LOS
  | "sense-invisibility"  // [V2] ignora walls
  | "feel-tremor";        // [V2] ignora walls

export interface DetectionModeEntry {
  id: DetectionModeId;
  /** Alcance em unidades de grid; null = ilimitado na cena. */
  range: number | null;
  enabled: boolean;
}

/** Configuração de visão de um token (subdocumento do Token). */
export interface TokenVision {
  enabled: boolean;
  /** Alcance de visão em unidades de grid; null = ilimitado na cena. */
  range: number | null;
  /** Ângulo do cone em graus (360 = visão total). */
  angle: number;
  visionMode: VisionModeId;
  detectionModes: DetectionModeEntry[];
}

/** Luz emitida por um token (mesmos parâmetros de AmbientLight, sem _id/x/y próprios). */
export interface TokenLight {
  bright: number;
  dim: number;
  angle: number;
  color: string;
  intensity: number;
  gradual: boolean;
  animation?: LightAnimation; // [V2]
  enabled: boolean;
}

/** Configuração de percepção da cena. */
export interface ScenePerception {
  /** Fog of war habilitado nesta cena. */
  fogEnabled: boolean;
  /** Token vision habilitado (jogadores limitados ao que seus tokens veem). */
  tokenVision: boolean;
  /** Darkness level 0–1 (estético + controla GI). */
  darkness: number;
  /** Global illumination ligada. */
  globalLight: boolean;
  /** Acima deste darkness, GI é suprimida (0–1). */
  globalLightThreshold: number;
}

/** Resultado de cálculo de uma fonte (não persistido; em memória/GPU). */
export interface VisibilityResult {
  sourceId: string;
  /** Polígono em pixels (anel de pontos), já recortado por range/ângulo/walls. */
  polygon: Array<{ x: number; y: number }>;
  /** Para luz: sub-anel da área bright. */
  brightPolygon?: Array<{ x: number; y: number }>;
}

/** Estado de exploração persistido por (usuário, cena). */
export interface FogExploration {
  sceneId: string;
  userId: string;
  /** Imagem comprimida (data URL ou referência a arquivo; ver 03). */
  texture: string;
  /** Timestamp da última atualização persistida. */
  updatedAt: number;
}

/** Delta de fog enviado ao servidor para persistência (ver 04). */
export interface FogUpdateDelta {
  sceneId: string;
  /** Polígonos recém-revelados a unir à exploração (px). */
  revealed: Array<Array<{ x: number; y: number }>>;
  /** Opcional: textura completa quando o commit serializa o estado inteiro. */
  texture?: string;
}

/** Comando de reset de fog (GM → servidor). */
export interface FogResetCommand {
  sceneId: string;
  /** Alvo: todos, ou um userId específico. */
  target: "all" | { userId: string };
}
```

## API e eventos

Esta spec define **o que** trafega e **quais cálculos** ocorrem; o envelope/transporte está em `04-rede-e-sincronizacao.md`.

### Cálculos no cliente (não trafegam pela rede)

| Cálculo | Disparado por | Entrada | Saída |
|---|---|---|---|
| `computeVisibilityPolygon` | movimento, mudança de wall/porta/luz/visão | origem, walls relevantes (poda espacial), dimensão (sight/light) | `VisibilityResult.polygon` |
| `applyRangeAndCone` | após o sweep | polígono, range (px), ângulo, rotação | polígono recortado |
| `composeVisionMask` | mudança de visão de qualquer token do usuário | união dos vision/light polygons | máscara efêmera (RenderTexture) |
| `accumulateExploration` | nova área visível | máscara atual, union acumulado (clipper2) | exploração atualizada (textura + geometria) |
| `composeLighting` | mudança de luz/darkness/GI | light polygons, darkness, GI | RenderTexture de iluminação |

### Mensagens que trafegam pela rede (via `04`)

| Direção | Conteúdo | Persistência |
|---|---|---|
| cliente → servidor | `doc:update`/`doc:create`/`doc:delete` de `Wall`, `AmbientLight`, mudança de `doorState`, params de visão/luz do token | sim (autoritativo, broadcast) |
| cliente → servidor | `FogUpdateDelta` (op de baixa prioridade, throttled) | sim (estado de fog do usuário) |
| GM → servidor | `FogResetCommand` | apaga exploração persistida |
| servidor → clientes | broadcast de mudanças de wall/luz/porta/token | clientes invalidam e recalculam |
| servidor (na abertura da cena) | `FogExploration` do usuário | carregado como estado inicial |

### Pipeline de visibilidade (resumo)

```
mover token / abrir porta / mudar luz
  → invalidar fontes afetadas (poda espacial: dentro do alcance da mudança)
  → para cada fonte afetada:
       sweep angular sobre walls relevantes (sight ou light)
       → recortar por range + cone
       → aplicar contagem de terrain (limited) e direcionalidade
  → união dos vision/light polygons do usuário → máscara de visão (efêmera)
  → acumular no fog explorado (clipper2 union + RenderTexture)
  → recompor iluminação (darkness, GI, cor) e aplicar máscara
  → [throttle] commit do fog → delta ao servidor (persistência)
```

### Pipeline de teste de visibilidade de um token-alvo (resumo)

```
para cada detectionMode do observador:
  _testRange: alvo dentro do range do modo?           (não → próximo modo)
  _testLOS:   modo requer LOS?
                 sim → alvo contido no vision polygon? (não → próximo modo)
                 não → passa (ignora walls)
  _testIllumination (modos de sight): alvo iluminado o bastante p/ o visionMode?
  → se algum modo detecta: alvo VISÍVEL
```

## Dependências (specs irmãs)

- `01-arquitetura-geral.md` — princípio de não bloquear o event loop (D9: visibility polygon como candidato a worker); cliente PIXI v8 e degradação WebGPU→WebGL.
- `02-modelo-de-dados.md` — schema persistido de `Scene`, `Wall`, `AmbientLight`, `Token` (visão/luz) refletindo as interfaces desta spec.
- `03-persistencia-e-mundos.md` — destino físico da textura de fog (blob no `world.db` vs arquivo no diretório do world) e ciclo de save.
- `04-rede-e-sincronizacao.md` — transporte dos updates de wall/luz/porta/token (ops de Document), do `FogUpdateDelta` e do `FogResetCommand`; validação de colisão no `token:move`.
- `05-usuarios-e-permissoes.md` — quem controla quais tokens (base da união de visão do jogador), quem é GM (vê tudo), quem pode editar walls/luzes e abrir portas secretas/trancadas.
- `06-canvas-e-renderizacao.md` — framework de camadas PIXI, câmera, sprites de token, conversão unidade-de-grid→pixel, snap; consumo da máscara de visão e da iluminação na composição final.
- `08-motor-de-rolagens.md` — sem dependência direta; condições mecânicas (ex.: invisível) que alimentam detection modes podem vir de efeitos do sistema.
- `13-audio-e-playlists.md` — consumo da dimensão `sound` das walls (propagação/oclusão de áudio) e dos sons de porta.
- `15-api-de-sistemas.md` — sistemas podem registrar vision/detection modes adicionais ([V2]) e mapear traços (darkvision, tremorsense) dos atores para configuração de visão dos tokens.
- `17-sistema-pf2e.md` — mapeamento de sentidos PF2e (visão normal, darkvision, low-light vision) para vision/detection modes do Fusion.
- `21-seguranca.md` — risco residual de cliente inferir geometria; redaction de dados de cena para não-GM.
- `25-testes-e-qualidade.md` — cenários comportamentais (abaixo) como testes automatizados/manuais.

## Critérios de aceitação

- **CA-01 (porta atualiza visão)** Um token em um corredor com uma porta fechada à frente NÃO vê além da porta; ao abrir a porta, o vision polygon se estende além dela e o fog revela a sala adjacente, em tempo real, no cliente do dono e de quem observa. (REQ-VIS-006, REQ-VIS-090)
- **CA-02 (parede bloqueia visão e luz)** Uma wall `normal` bloqueia tanto a visão de um token quanto a luz de uma fonte do outro lado; um token não enxerga atrás dela e a luz não a atravessa. (REQ-VIS-020, REQ-VIS-042)
- **CA-03 (terrain "uma camada")** Um boulder cercado de terrain walls é inteiramente visível (vê a rocha), mas o que está imediatamente atrás dele não é; cruzar a segunda camada de `limited` bloqueia. (REQ-VIS-025)
- **CA-04 (vidro)** Uma wall `invisible` (sight/light `none`, move `normal`) deixa ver e iluminar através, mas bloqueia movimento — um token não atravessa, mas vê e é iluminado do outro lado. (REQ-VIS-002, REQ-VIS-008)
- **CA-05 (etérea)** Uma wall `ethereal` (sight/light `normal`, move `none`) bloqueia visão e luz, mas o token a atravessa. (REQ-VIS-008)
- **CA-06 (cone de visão)** Um token com `angle` < 360° só enxerga dentro do cone na direção de sua rotação; girar o token gira o cone. (REQ-VIS-023)
- **CA-07 (range)** Um token com `range` finito não enxerga além do raio mesmo sem walls no caminho; aumentar o range expande a visão. (REQ-VIS-023)
- **CA-08 (darkvision)** Em uma cena escura (sem luz, darkness alto, GI suprimida), um token `basic` não enxerga nada além de luzes; um token `darkvision` enxerga até seu range em monocromático. (REQ-VIS-061, REQ-VIS-062, REQ-VIS-045)
- **CA-09 (luz de token segue o token)** Uma tocha (token.light) ilumina a área ao redor do token e a iluminação acompanha o movimento, respeitando walls de `light`. (REQ-VIS-041, REQ-VIS-042, REQ-VIS-090)
- **CA-10 (global illumination)** Com GI ligada e darkness abaixo do threshold, a área explorada é toda visível sem fontes de luz; ao subir o darkness acima do threshold, a cena escurece e tokens sem luz/darkvision perdem a visão fora de áreas iluminadas. (REQ-VIS-044, REQ-VIS-045)
- **CA-11 (união de tokens do jogador)** Um jogador que controla dois tokens em salas diferentes vê a união das duas visões; o GM vê a cena inteira sem fog. (REQ-VIS-064)
- **CA-12 (três estados de fog)** Uma sala já explorada porém fora da visão atual aparece translúcida/escurecida sem mostrar tokens ao vivo; ao reentrar com um token, volta a clara; áreas nunca visitadas permanecem opacas. (REQ-VIS-080, REQ-VIS-081, REQ-VIS-082)
- **CA-13 (persistência de fog)** Fechar e reabrir a cena (ou reconectar) preserva a exploração do usuário; a exploração não se perde por reload (sem reaparecimento indevido nem perda). (REQ-VIS-083, REQ-VIS-084)
- **CA-14 (reset de fog)** O GM reseta o fog de um jogador; a cena volta a totalmente não-explorada para aquele jogador, persistido, sem reaparecer após refresh; outros jogadores não são afetados. (REQ-VIS-086, REQ-VIS-087)
- **CA-15 (colisão de movimento)** Tentar mover um token através de uma wall `move` `normal` (ou porta fechada) é bloqueado/ajustado pelo servidor; através de uma porta aberta é permitido. (REQ-VIS-091, REQ-VIS-004)
- **CA-16 (porta secreta)** Uma porta secreta aparece como parede comum para o jogador (sem controle de interação) e como porta com ícone só para o GM; abri-la (pelo GM) atualiza visão como uma porta normal. (REQ-VIS-005)
- **CA-17 (direcionalidade)** Uma wall com `dir: left` deixa um token de um lado ver para o outro, mas não o inverso (efeito one-way). (REQ-VIS-026, REQ-VIS-003)
- **CA-18 (não bloquear UI)** Em uma cena grande (centenas de walls), arrastar um token não congela a UI; o recálculo cabe no orçamento de frame ou ocorre off-thread/no drop sem travamento. (REQ-VIS-028, REQ-VIS-100, REQ-VIS-104)
- **CA-19 (consistência de tipos)** As interfaces de wall/luz/visão/fog vêm de `packages/shared` e são iguais no servidor (colisão) e no cliente (render), sem duplicação. (REQ-VIS-093, REQ-VIS-106)
- **CA-20 (fog desabilitado)** Em uma cena com fog desabilitado, todos os jogadores veem o mapa inteiro sem névoa. (REQ-VIS-085)

## Questões em aberto

- **Q1 — Limiar para Web Worker.** A partir de quantas walls/fontes o cálculo de visibilidade deve migrar para Web Worker (D9)? Requer medição em hardware baseline; cruzar com `01-arquitetura-geral.md` Q5 e `25-testes-e-qualidade.md`.
- **Q2 — Onde persistir a textura de fog.** Blob no `world.db` (simples, mas incha o banco e o WAL) vs arquivo por (usuário, cena) no diretório do world (mais leve no banco, mais arquivos a gerenciar). Decidir com `03-persistencia-e-mundos.md`. Afeta também backup/portabilidade do world.
- **Q3 — Resolução do fog.** Usar resolução 1:1 com a cena ou um downscale (ex.: 1/2, 1/4) para a textura de fog? Downscale economiza memória/tráfego mas pode causar bordas serrilhadas em cenas detalhadas. Medir qualidade vs custo.
- **Q4 — Sincronização de fog entre clientes do mesmo usuário.** Se um usuário abre a cena em dois dispositivos, o fog deve sincronizar entre eles em tempo real (research 04 §4.3 cita `sync()` experimental)? Provavelmente [V2]; no MVP, o último commit vence.
- **Q5 — Darkness por região.** O research 04 §6.4 descreve "Adjust Darkness Level" por Scene Region (masmorra escura dentro de exterior claro). Scene Regions completas são [V2]; precisamos do gancho mínimo de "darkness por área" já no MVP para PF2e (ex.: magia de escuridão)? Cruzar com `17-sistema-pf2e.md` e o roadmap (`27`).
- **Q6 — Elevação e cenas multi-andar.** Walls e visão com elevação (REQ-VIS-012) são [V2]; confirmar que nenhum cenário do MVP de PF2e (ex.: voo, criaturas voadoras em combate) exige tratamento de elevação na visão já no MVP.
- **Q7 — Validação de colisão no servidor vs cálculo no cliente (consistência).** Como garantir que a colisão de movimento validada no servidor usa exatamente a mesma geometria/algoritmo que o cliente usa para visão, evitando "o cliente acha que vê/passa mas o servidor discorda"? Provável: compartilhar o teste de interseção segmento-wall em `packages/shared` (REQ-VIS-103). Confirmar a fronteira com `04` e `06`.
- **Q8 — Tremorsense e detection modes do PF2e.** O mapeamento exato dos sentidos do PF2e (imprecise/precise senses, tremorsense, scent) para vision/detection modes do Fusion é [V2]; validar que o MVP cobre visão normal + darkvision/low-light, suficientes para a maioria dos personagens iniciais. Cruzar com `17-sistema-pf2e.md`.
- **Q9 — Low-light vision.** PF2e tem "low-light vision" (trata dim como bright) além de darkvision. Modelar como vision mode próprio ou como modificador? Definir com `17-sistema-pf2e.md`.

## Referências

- `docs/research/04-foundry-visao-iluminacao-fog.md` — modelo de walls e restrições independentes por dimensão (§1.1–1.3), modos de restrição none/normal/limited/proximity/reverse (§1.3), threshold/atenuação (§1.4), direcionalidade e bug de proximity one-way (§1.5), portas fechada/aberta/secreta e animação (§1.6), terrain walls e regra "uma camada" + bug de vértices compartilhados (§1.7), iluminação bright/dim/unlit e propriedades de fonte (§2.1–2.2), darkness sources (§2.3), darkness level (§2.4), global illumination e threshold (§2.5), animações e coloração (§2.6–2.7), token light (§2.8), vision mode vs detection mode (§3.1–3.3), parâmetros de visão por token (§3.4), pipeline de teste de visibilidade (§3.5), lighting levels (§3.6), fog of war e três estados (§4.1), FogManager e commit threshold (§4.3–4.4), reset e edge cases / issues #8122 #7613 (§4.5), ClockwiseSweepPolygon e angular sweep / quadtree / O(n log n) (§5.1–5.2), render como máscara e RenderTexture acumulada (§5.3–5.4), scene regions e adjust darkness (§6), arquitetura PIXI de render (§7), referências Red Blob Games / Nicky Case / módulos open-source (§8).
- `docs/research/15-vtt-opensource-e-bibliotecas.md` — PIXI v8 WebGPU/WebGL e RenderTexture (§3.1), estratégia de visibility polygon próprio + clipper2 para union de fog explorado (§6.1–6.4), `@countertype/clipper2-ts` para operações booleanas de polígono (§6.3), honeycomb-grid para hex (§7.1), MapTool como prova de que dynamic lighting/vision/fog são viáveis localmente sem plataforma externa (§1.1), tabela de decisão de stack: visibilidade própria + clipper2 (§16).
