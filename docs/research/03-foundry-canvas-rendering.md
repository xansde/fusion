# Foundry VTT — Canvas e Renderização (PIXI)

> Documento de pesquisa para o projeto Fusion (VTT próprio, clean-room).
> Descreve comportamento, conceitos e algoritmos observados na documentação pública do Foundry VTT v12/v13.
> Nenhum código proprietário foi copiado. Trechos de módulos open-source são indicados com atribuição.

---

## 1. Visão Geral da Arquitetura

O canvas do Foundry VTT é implementado como uma aplicação WebGL usando a biblioteca **PIXI.js** (v7 a partir da versão 11 do Foundry). O canvas ocupa a tela inteira do navegador e é composto por uma hierarquia ordenada de grupos e camadas. Sobre o canvas WebGL existe uma sobreposição HTML — o **HUD** — para elementos de interface que não precisam de renderização WebGL.

A escolha de PIXI.js garante acesso ao pipeline de renderização WebGL do navegador, possibilitando batching de texturas, shaders customizados e renderização de alto desempenho, ao mesmo tempo que mantém uma API em JavaScript de alto nível.

---

## 2. Hierarquia de Grupos (Canvas Groups)

A organização de mais alto nível do canvas são os **grupos**. Cada grupo é um `PIXI.Container` especializado. A hierarquia (do mais externo ao mais interno) é:

```
PIXI.Application.stage
└── HiddenCanvasGroup          [não renderizado; transformado para cálculos]
└── RenderedCanvasGroup        [tudo que é renderizado visivelmente]
    ├── EnvironmentCanvasGroup [conteúdo físico da cena]
    │   ├── PrimaryCanvasGroup      [objetos tangíveis: tiles, tokens, fundo]
    │   ├── EffectsCanvasGroup      [efeitos visuais sobre o Primary]
    │   └── VisibilityCanvasGroup   [fog of war, renderizado como overlay de render textures]
    └── InterfaceCanvasGroup   [UI interativa; não é objeto de cena]
        └── OverlayCanvasGroup [elementos não vinculados ao transform do stage]
```

Além disso existe o **HeadsUpDisplay** (`canvas.hud`), que é uma `<div>` HTML sobreposta ao elemento `<canvas>`, gerenciada separadamente.

### Detalhamento dos grupos

| Grupo | Descrição |
|---|---|
| `HiddenCanvasGroup` | Container transformado mas nunca renderizado; usado para cálculos de posição/oclusão |
| `RenderedCanvasGroup` | Raiz de tudo que aparece na tela; agrega Environment + Interface |
| `PrimaryCanvasGroup` | Objetos físicos da cena (fundo, tiles, tokens, drawings). É renderizado como um `SpriteMesh` via `CachedContainer` para otimização |
| `EffectsCanvasGroup` | Modifica a aparência do Primary: iluminação, vision, animações de escuridão |
| `VisibilityCanvasGroup` | Consolida múltiplas render textures para o fog of war |
| `InterfaceCanvasGroup` | Elementos de UI interativos que existem no espaço do canvas mas não são objetos físicos da cena |
| `OverlayCanvasGroup` | Elementos que permanecem fixos e não seguem o transform do stage (ex.: ruler, marcadores de combate) |

---

## 3. Camadas (Layers)

Dentro de cada grupo existem **camadas** (`CanvasLayer`). As classes base são:

- **`CanvasLayer`** — base; apenas renderização passiva.
- **`InteractionLayer`** — estende `CanvasLayer`; suporta interação do usuário (mouse, teclado). Somente uma InteractionLayer pode estar "ativa" por vez.
- **`PlaceablesLayer`** — estende `InteractionLayer`; gerencia coleções de `PlaceableObject` (objetos de cena persistidos como `Document`).

### Lista completa de camadas (v12/v13)

| Camada | Classe | Grupo | Descrição |
|---|---|---|---|
| `background` | BackgroundLayer (implícito no Primary) | Primary | Imagem de fundo da cena |
| `tiles` | `TilesLayer` | Primary | Tiles de underfoot e overhead |
| `drawings` | `DrawingsLayer` | Primary | Formas, texto e freehand desenhados pelo GM |
| `tokens` | `TokenLayer` | Primary | Tokens de atores, personagens e monstros |
| `notes` | `NotesLayer` | Interface | Pinos de mapa linkados a Journal Entries |
| `lighting` | `LightingLayer` | Effects | Fontes de luz e escuridão |
| `sounds` | `SoundsLayer` | Interface (GM only) | Emissores de som ambiente |
| `templates` | `TemplateLayer` (MeasuredTemplate) | Interface | Templates de área de efeito |
| `walls` | `WallsLayer` | Interface (GM only) | Paredes que bloqueiam visão/movimento/som |
| `regions` | `RegionLayer` | Interface | Regiões de cena com behaviors (v12+) |
| `grid` | `GridLayer` | Interface | Renderização visual da grade |
| `controls` | `ControlsLayer` | Overlay | Controles de seleção, ruler, cursor tools |
| `weather` | `WeatherEffects` | Effects | Partículas e shaders de clima |
| Occlusion masks | `CanvasOcclusionMask`, `CanvasVisionMask` | Effects/Visibility | Máscaras de oclusão e visão (render textures) |
| Coloration/Illumination | `CanvasColorationEffects`, `CanvasIlluminationEffects`, `CanvasDarknessEffects` | Effects | Layers de efeitos de cor/luz/trevas |

### Ordem de renderização visual (bottom → top, perspectiva de profundidade)

1. Imagem de fundo da cena (background image)
2. Tiles de underfoot (standard tiles, z-index baixo)
3. Tokens de ator
4. Tiles overhead / roofs
5. Imagem de foreground (cena inteira, sem oclusão)
6. Efeitos de clima (WeatherEffects)
7. Sistema de iluminação e visão (Effects group)
8. Templates de medição
9. Sons ambiente (ícones visíveis apenas ao GM)
10. Paredes (visíveis apenas ao GM)
11. Controles e ruler (Overlay/Interface)

---

## 4. Pipeline PIXI e WebGL

### 4.1 PIXI.Application e Stage

O canvas instancia um `PIXI.Application` que gerencia o loop de render (`requestAnimationFrame`), o `Renderer` WebGL e o `stage` raiz. Toda a hierarquia de grupos e camadas pende do `stage`.

### 4.2 Batching de Texturas

PIXI v7 implementa batching automático de sprites que compartilham a mesma textura base, reduzindo o número de draw calls. Sprites consecutivos na hierarquia são agrupados em um único draw call quando usam a mesma textura ou atlas.

Objetos `PIXI.Graphics` **não participam do batching** — cada um gera um draw call próprio. Isso afeta diretamente o desempenho de paredes, resource bars de tokens e status effects desenhados com `PIXI.Graphics`.

### 4.3 CachedContainer / SpriteMesh para o Primary Group

O `PrimaryCanvasGroup` é renderizado para uma `RenderTexture` interna e então exibido como um `SpriteMesh`, o que permite que o grupo inteiro receba filtros de pós-processamento (como efeitos de iluminação do Effects group) de forma eficiente.

### 4.4 Filtros de Blur e Antialiasing

- O canvas usa blur filters dinâmicos para efeitos de visão e fog of war; a intensidade do blur é atualizada em função do nível de zoom.
- O Foundry migrou de **FXAA** (Fast Approximate Antialiasing) para **SMAA** (Subpixel Morphological Antialiasing) na v12 para melhor qualidade.

### 4.5 Percepção (PerceptionManager)

A classe `PerceptionManager` (acessível via `canvas.perception`) gerencia o pipeline de atualização de percepção por meio de `RENDER_FLAGS`. Quando qualquer fonte de luz/visão/som muda, a atualização é enfileirada em flags e executada em lote no próximo frame, evitando recálculos redundantes.

Flags principais e seus efeitos em cascata:

| Flag | Efeito |
|---|---|
| `initializeLighting` | Reinicializa todo o sistema de luz |
| `initializeLightSources` | Reconfigura fontes de luz individuais |
| `refreshLighting` | Recalcula iluminação no frame atual |
| `initializeVision` | Reinicializa o estado de visão |
| `refreshVision` / `refreshVisionSources` | Recalcula polígonos de visão |
| `refreshEdges` | Recalcula arestas de colisão |
| `refreshOcclusion` | Atualiza estado de oclusão de tiles overhead |
| `initializeSounds` / `refreshSounds` | Recalcula zonas de som ambiente |
| `refreshPrimary` | Força re-render do Primary group |

Cada flag pode ter um array `propagate` que aciona outras flags automaticamente.

---

## 5. Sistema de Grade (Grid)

O Foundry VTT suporta três tipos de grade, todos herdando da classe `BaseGrid`:

### 5.1 Grade Quadrada (SquareGrid)

- Coordenadas em offset `(i, j)`.
- Distância de diagonal configurável via `CONST.GRID_DIAGONALS`:

| Constante | Valor | Regra |
|---|---|---|
| `EQUIDISTANT` | 0 | Diagonal = 1 (igual a cardinal; regra D&D 5e) |
| `EXACT` | 1 | Diagonal = √2 (~1.414; geometria pura) |
| `APPROXIMATE` | 2 | Diagonal = 1.5 |
| `RECTILINEAR` | 3 | Diagonal = 2 (só movimentos cardinais) |
| `ALTERNATING_1` | 4 | Alterna 1-2-1-2 (começa em 1; PF2e 5-10-5) |
| `ALTERNATING_2` | 5 | Alterna 2-1-2-1 (começa em 2) |
| `ILLEGAL` | 6 | Movimento diagonal proibido |

### 5.2 Grade Hexagonal (HexagonalGrid)

Quatro variantes suportadas, combinando orientação e offset:

| Tipo | Forma do hexágono | Offset |
|---|---|---|
| Hexagonal Columns Odd | Flat-top | Colunas ímpares deslocadas |
| Hexagonal Columns Even | Flat-top | Colunas pares deslocadas |
| Hexagonal Rows Odd | Pointy-top | Linhas ímpares deslocadas |
| Hexagonal Rows Even | Pointy-top | Linhas pares deslocadas |

**Tamanho do hexágono:** o raio de centro a vértice é igual a `gridSize / √3`.

**Sistemas de coordenadas** da `HexagonalGrid`:
- **Cube coordinates** `(q, r, s)` — convenção padrão de hexágonos; `q + r + s = 0`.
- **Offset coordinates** `(i, j)` — linha/coluna da grade; mais intuitivo para armazenamento.
- **Point coordinates** `(x, y)` — pixels no canvas.

Métodos de conversão: `cubeToOffset()`, `offsetToCube()`, `cubeToPoint()`, `pointToCube()`.

Distância entre dois hexágonos em cube coordinates:
```
distance = max(|Δq|, |Δr|, |Δs|)
```

**Snapping em hexágonos multi-hex:** tokens com tamanho maior que 1 hex precisam de lógica especial para encaixar na grade — o Foundry implementa `getSnappedPoint()` com resolução configurável.

### 5.3 Gridless

Sem snap automático. A medição de distância usa distância euclidiana simples. Templates ainda funcionam mas sem highlight de células.

### 5.4 Tamanho mínimo de célula

O mínimo prático é 50 px por célula. Valores comuns: 70, 100, 140, 200 px.

---

## 6. Ruler e Medição de Distância

O Foundry oferece três mecanismos de medição:

### 6.1 Distance Measurement Ruler

- Ativado pela tecla `R` (padrão) ou botão na barra de controles.
- Mede distância euclidiana entre pontos arbitrários do canvas.
- Suporta **waypoints** para caminhos em L ou segmentados.
- Waypoints com elevações diferentes: a diferença de elevation é calculada como componente euclidiana extra.
- `Shift + Click` ao adicionar waypoint impede snapping à grade.

### 6.2 Token Drag Measurement (v13+)

Introduzido como feature principal da v13 (votada pela comunidade). Difere do ruler simples porque:
- Mede **custo de movimento** (não apenas distância), respeitando multiplicadores de Scene Regions com o behavior "Modify Movement Cost".
- Ao arrastar, o ruler aparece automaticamente mostrando o custo acumulado.
- Waypoints com `CTRL + Click` (ou tecla `F`); elevação com `E`/`Q` ou `Numpad+`/`Numpad-`.
- `Spacebar` confirma o movimento ao longo do caminho medido.
- Suporte a tipos de movimento: caminhar, voar, escalar, nadar, rastejar, se teleportar, etc. (selecionável via `TAB`).

### 6.3 Measured Templates

Quatro formas de template:

| Forma | Comportamento |
|---|---|
| Circle | Raio a partir da origem; highlight de todas as células na área |
| Cone | Setor angular (1°–360°; padrão ~53°); configurável como ponta arredondada ou plana |
| Rectangle | Canto superior esquerdo na origem |
| Ray | Linha com largura configurável |

Configuração via duplo-clique: posição, direção, ângulo, largura, distância, cor, textura.
Rotação com `Shift + Scroll`.

Templates fazem snap automático a células e interseções de grade.

---

## 7. Tokens

### 7.1 Atributos Principais

| Atributo | Tipo | Descrição |
|---|---|---|
| `x`, `y` | pixels | Posição do canto superior esquerdo no canvas |
| `width`, `height` | grid squares | Espaço ocupado (1 = 1 célula; >1 para Large/Huge/Gargantuan) |
| `scale` | float | Escala visual da artwork (independente do footprint) |
| `rotation` | degrees | 0° = sul (convenção Foundry) |
| `elevation` | grid units | Altitude; negativo = subterrâneo/burrowing |
| `disposition` | enum | Friendly (teal), Neutral (yellow), Hostile (red), Secret |
| `alpha` | 0–1 | Opacidade |
| `mirrorX`, `mirrorY` | bool | Espelhamento horizontal/vertical da artwork |
| `tint` | hex | Cor multiplicativa aplicada à textura |
| `displayBars` | enum | Visibilidade das resource bars (nunca/owner/hover/sempre) |
| `bar1`, `bar2` | attribute path | Resource bars vinculadas a atributos do ator |
| `sight` | config object | Configuração de visão (modo, range, angle, attenuation…) |
| `detectionModes` | array | Modos de detecção adicionais (tremorsense, see invisible…) |
| `movementAction` | enum | Tipo de movimento atual (walk/fly/swim/etc.) |
| `actorLink` | bool | Se true, mudanças no token refletem no Actor; se false, instância independente |

### 7.2 Tamanhos e Multi-Grid

O `width`/`height` do token define quantas células ele ocupa. A `scale` ajusta apenas a aparência da artwork. Tokens grandes (Large = 2×2, Huge = 3×3, Gargantuan = 4×4+) exigem lógica de snapping especial nos grids hexagonais.

### 7.3 Visão e Detecção

O token usa um sistema de **Vision Modes** (modos de visão):
- **Basic Vision** — requer iluminação para ver.
- **Darkvision** — vê em escuridão, imagem monocromática.
- **Monochromatic** — visão sem cor.
- **Tremorsense** — detecta sem linha de visão, ignora paredes.
- **Light Amplification** — amplifica fontes de luz fracas.

Parâmetros de visão por token: `visionRange` (distância), `visionAngle` (campo de visão, padrão 360°), attenuation, brightness, saturation, contrast.

**Detection Modes** complementares: Basic Sight (requer luz), See Invisibility, Feel Tremor, See All / Sense All. Modos "See" exigem linha de visão; modos "Sense" ignoram paredes.

### 7.4 Resource Bars e Status Effects

- Duas resource bars configuráveis (`bar1`, `bar2`), vinculadas a caminhos de atributos do ator.
- Visibilidade por nível (never/owner/hover owner/hover all/always).
- Status effects: ícones sobrepostos no canto superior esquerdo. Os ícones são definidos pelo sistema de jogo.
- Um status effect pode ser exibido como overlay grande (máximo 1 por token, via clique direito no status).

### 7.5 Dynamic Token Rings

Framework opcional (v11+) que separa o token em três camadas renderizadas independentemente:
1. **Subject** — artwork do personagem (⅔ central da textura).
2. **Ring** — moldura circular (spritesheet com 4 tamanhos: 256, 512, 1024, 2048 px).
3. **Background** — cor/textura de fundo sob o subject.

Shaders aplicados dinamicamente em resposta a eventos do jogo (turno de combate, status de saúde, etc.). **Limitação:** apenas um spritesheet de ring pode estar ativo por vez.

Recomendação de resolução para subject texture: 512 px (1×1), 1024 px (2×2), 2048 px (4×4+).

### 7.6 Movimento e Animação

A classe `TokenAnimationOptions` controla:
- `duration` — ms; automático por default baseado na distância.
- `movementSpeed` — grid squares/segundo.
- `easing` — função de easing (linear por default).
- `transition` — tipo de transição de textura (fade por default).
- `action` — tipo de movimento.
- `ontick` — callback por frame.

No v13, o drag measurement é o mecanismo principal: o token segue o caminho medido pelo ruler ao confirmar (`Spacebar`). Rotação automática em direção ao movimento.

### 7.7 Multi-Seleção

- A ferramenta "Select Tokens" permite selecionar múltiplos tokens via drag de seleção.
- Apenas tokens que o jogador controla podem ser manipulados.
- Com múltiplos tokens com visão selecionados: quando nenhum está controlado, usa-se a **união** das visões; ao controlar um token, apenas a visão desse token é usada.

---

## 8. Tiles

### 8.1 Underfoot vs. Overhead

Tiles alternam entre dois layers lógicos pelo toggle "Is Overhead?":
- **Underfoot (standard):** abaixo dos tokens; para chão, móveis, decoração.
- **Overhead:** acima dos tokens; para telhados, copas de árvores.

### 8.2 Propriedades Configuráveis

| Propriedade | Descrição |
|---|---|
| `x`, `y` | Posição (canto superior esquerdo) em pixels |
| `width`, `height` | Dimensões em pixels no canvas |
| `z` | Z-Index de ordenação entre tiles |
| `rotation` | Rotação em graus |
| `alpha` | Opacidade (0–1) |
| `tint` | Cor multiplicativa (hex) |
| `overhead` | Bool: é overhead? |
| `roof` | Bool: é roof? (renderiza acima de fontes de luz; bloqueia clima) |
| `occlusion.mode` | Modo de oclusão (ver abaixo) |
| `occlusion.alpha` | Opacidade residual ao ser ocluído (0–1) |
| `video.autoplay` | Auto-play para tiles de vídeo |
| `video.loop` | Loop de vídeo |
| `video.volume` | Volume do vídeo |

### 8.3 Modos de Oclusão

| Modo | Comportamento |
|---|---|
| `None` | Sem oclusão; tile sempre visível |
| `Fade` | Todo o tile faz fade quando um token passa por baixo |
| `Radial` | Revela a área ao redor do token (raio = tamanho do token) |
| `Vision` | Revela baseado no polígono de visão do token (útil para telhados com janelas) |

O algoritmo de detecção testa **9 pontos** do token: centro, 4 cantos e 4 direções cardeais. Tiles com áreas transparentes na artwork também são considerados na detecção (baseado na opacidade da textura, não no bounding box).

---

## 9. Drawings

A `DrawingsLayer` gerencia objetos de desenho vetorial no canvas. Tipos suportados:

| Tipo | Descrição |
|---|---|
| Rectangle | Retângulo/quadrado |
| Circle | Elipse/círculo |
| Polygon | Polígono de linhas retas (click para vértices) |
| Freehand | Linha livre com suavização configurável |
| Text | Texto direto no canvas |

**Propriedades principais:**
- Posição `(x, y)`, dimensões, rotação.
- Linha: largura (px), cor (hex), opacidade.
- Preenchimento: None / Solid (cor + opacidade) / Pattern (textura).
- Texto: fonte, tamanho, cor, opacidade.
- Z-Sort: controla stacking entre drawings (maior = mais ao topo).
- Suavização freehand: reduz vértices para curvas mais suaves.

Jogadores não têm permissão de uso por padrão; Trusted Players e Assistant GMs têm acesso.

---

## 10. Notes (Map Pins)

A `NotesLayer` gerencia pinos de mapa linkados a **Journal Entries** ou páginas específicas.

**Criação:** ferramentas da Notes Layer ou arrastar Journal Entries da barra lateral para o canvas.

**Configuração:**
- Link para Journal Entry ou página específica.
- Label customizado (padrão: nome da Entry).
- Posição `(x, y)` — editável via drag.
- Ícone: preset ou imagem customizada.
- Tamanho do ícone (pixels), tint de cor.
- Fonte, tamanho e cor do label.
- Âncora do texto relativa ao ícone.

**Visibilidade:**
- Por padrão, notas ficam visíveis apenas na Notes Layer; toggle "Exibir Notas" as mostra em todas as layers.
- Respeitam Fog of War e visão de tokens, exceto se marcadas como "Globally Visible".
- Permissões: Limited = vê posição e label mas não o conteúdo; None = invisível.

---

## 11. Sistema de Iluminação e Visão

### 11.1 Fontes de Luz

Configuração por fonte de luz:
- Posição `(x, y)`.
- Raio dim e raio bright (em grid units).
- Ângulo de emissão (0°–360°) e rotação.
- Cor (hex) e intensidade (0–1).
- "Constrained by Walls" — luz respeita ou ignora paredes.
- "Provides Vision" — permite que tokens vejam através do raio da luz.
- Darkness Activation Range — faixa de darkness level que ativa a luz.

**Coloration Techniques (10 blending modes):** Adaptive Luminance (padrão), Color Burn, Halo (interno/externo), Absorption, e outros.

**Animações de luz (20+):** Torch, Pulsing Wave, Sound Reactive Pulse (v13), Emanation, Revolving, Ghostly Light, etc. Cada animação tem velocidade, intensidade e direção configuráveis.

**Darkness Sources (v12+):** Fonte de luz com "emite escuridão" — bloqueia visão e luz como se fosse uma parede nos limites da área. No v13, fontes de luz e escuridão têm **prioridade** numérica para resolver conflitos de sobreposição.

### 11.2 Algoritmo de Visão (Radial Sweep)

O engine de visão usa **Radial Sweep** (varredura radial) para calcular polígonos de linha de visão (LOS):
- Emite raios a partir da posição do token/fonte de luz.
- Elimina raios desnecessários com base nos endpoints de segmentos de parede.
- Armazena o bounding box do polígono para detecção de colisão eficiente.
- O polígono LOS é renderizado uma vez em uma `RenderTexture` e reutilizado até a próxima atualização.

**Render Textures de Fog of War:** atualizações retornam a texture a um pool reutilizável em vez de recriar, melhorando desempenho.

### 11.3 Detection Modes (v12+)

O sistema foi redesenhado para separar diferentes tipos de detecção:
- **Light Perception** (novo modo v12): Basic Sight deixou de incluir percepção de luz — agora é um modo separado.
- Tokens têm no mínimo Basic Sight + Light Perception por padrão.
- Cada detection mode produz um polígono próprio; a visão final é a união de todos.

### 11.4 PerceptionManager

Todas as atualizações de iluminação, visão, som e oclusão são batched pelo `PerceptionManager` via sistema de `RENDER_FLAGS`. Isso garante que múltiplas mudanças no mesmo frame resultem em um único recálculo.

---

## 12. Sistema de Paredes (Walls)

### 12.1 Tipos de Parede

| Tipo | Cor | Bloqueia Movimento | Bloqueia Visão/Luz | Bloqueia Som |
|---|---|---|---|---|
| Normal | Amarela | Sim | Sim | Sim |
| Terrain | Verde | Sim | Limitado (1 segmento) | Não |
| Invisible | Ciano | Sim | Não | Não |
| Ethereal | Magenta | Não | Sim | Não |
| Window | Azul | Configurável | Proximity-based | Configurável |
| Door | Variada | Quando fechada | Quando fechada | Quando fechada |
| Secret Door | Variada | Quando fechada | Quando fechada | Quando fechada |

### 12.2 Modos de Restrição (por tipo: Movement, Vision/Light, Sound)

Cada parede tem configurações independentes para Movement, Vision, Light e Sound, com os modos:
- **None** — não bloqueia.
- **Normal** — bloqueia completamente.
- **Limited** — bloqueia, mas permite visão/luz/som "limitados" (passa por um segmento Limited, não dois).
- **Proximity** — bloqueia apenas se a fonte estiver dentro de um limiar de distância.
- **Reverse Proximity** — bloqueia apenas se a fonte estiver **fora** do limiar.

### 12.3 Direção

Walls podem ser **bidirecionais** (padrão) ou **unidirecionais** (restringe apenas de um lado).

### 12.4 Portas

Estados: Closed / Open / Locked.
Animações de porta (v13): Ascend, Descend, Slide, Swing, Swivel (com velocidade, direção e distância configuráveis).
Secret Doors: ícone oculto para jogadores; apenas o GM pode alternar o estado.

---

## 13. Scene Regions (v12+)

Scene Regions são áreas geométricas persistidas como `Document` na cena, com **behaviors** que definem seu comportamento.

### 13.1 Geometria

Shapes suportadas: retangular, elíptica, poligonal. Múltiplos shapes por região (com suporte a "holes" negativos). Cada shape tem um elevation range.

### 13.2 Behaviors

**Contínuos:**
- Adjust Darkness Level — altera nível de darkness regional.
- Suppress Weather — impede clima na área.
- Modify Movement Cost — multiplica o custo de movimento (fator 0–5, incrementos de 0.25; crucial para terreno difícil no v13 Token Drag Measurement).

**Por evento:**
- Display Scrolling Text, Execute Macro, Execute Script, Pause Game, Teleport Token, Toggle Behavior.

### 13.3 Eventos de Token

O sistema diferencia:
- **Token Enters / Exits** — ao cruzar o limite da região.
- **Token Moves In / Out / Within** — durante arrastar/teclas de movimento.
- **Token Animates In / Out** — durante a animação de movimento.
- **Token Starts/Ends Turn**, **Token Starts/Ends Round** — integração com combate.

O método `segmentizeMovement(waypoints)` divide o caminho em segmentos typed: `ENTER`, `MOVE`, `EXIT`.

---

## 14. Configuração de Cena (Scene)

### 14.1 Dimensões e Imagens

- **Background Image** — define as dimensões base da cena (pixels). Pode ser overrideado manualmente.
- **Foreground Image** — overlay de cena inteira acima de todos os objetos; mesmo tamanho do background; sem oclusão.
- **Image Offset (X/Y)** — shift em pixels para alinhar grade pré-desenhada na imagem.
- **Padding** — percentual das dimensões totais para borda extra ao redor da imagem. Espaço de staging fora do mapa principal; não iluminado por default.

### 14.2 Grade

- Tipo de grade (Gridless / Square / Hex variants).
- Grid size (mínimo 50 px; valores comuns 70–200).
- Grid color e opacidade (visual only).
- Regra de diagonal (GRID_DIAGONALS).
- Distância por célula e unidade de medida.

### 14.3 Elevação de Foreground

`foregroundElevation` — elevation height dos overhead tiles e foreground image. Tokens cuja elevation supera esse valor aparecem acima do foreground.

### 14.4 Iluminação e Visão

- **Token Vision** — ativa visibilidade condicional baseada em ownership de tokens com visão.
- **Global Illumination** — tokens com visão veem tudo dentro do LOS como se estivesse iluminado.
- **Fog of War** — rastreia exploração por usuário; áreas inexploradas/exploradas recebem tints de cor customizáveis.
- **Darkness Level** — 0 (luz do dia) a 1 (escuridão máxima); aplica grading de cor azul.
- **Global Illumination Threshold** — darkness level a partir do qual a global illumination é desativada automaticamente.

### 14.5 Visão Inicial e Ambience

- **Initial View Position** — coordenadas `(x, y)` e escala de zoom para o viewport inicial ao ativar a cena.
- **Linked Playlist** — playlist que inicia ao ativar a cena.
- **Weather Effects** — preset de clima ambiente.
- **Preload Scene** — pré-carrega assets nos clientes antes da ativação.

---

## 15. Performance: Culling, Batching e Limites Práticos

### 15.1 Culling

PIXI não realiza culling automático por padrão (todos os objetos no container são processados mesmo que fora do viewport). O Foundry e módulos de otimização implementam culling manual verificando se o bounding box do objeto intersecta com o viewport antes de renderizá-lo ou atualizá-lo.

### 15.2 Batching de Draw Calls

Situação problemática sem otimização em uma cena com muitos tokens:
- Aproximadamente 85 draw calls e 1000+ WebGL commands por frame.
- Com otimização (caching de resource bars e status effects como texturas via `cacheAsBitmap`):
  - Reduz para ~36 draw calls e ~440 WebGL commands.
  - Ganho de ~8 ms por frame; melhora de ~55 FPS para 100+ FPS.

**Técnicas:**
- **`cacheAsBitmap`** no container de status effects do token: renderiza todos os ícones uma vez em textura, depois usa como sprite único.
- **Paredes como sprites texturizados** em vez de `PIXI.Graphics`: permite batching de todos os segmentos de parede em 1 draw call.
- **Resource bars cacheadas**: de 1 draw call por token para 1 a cada 8–16 tokens.

### 15.3 Texturas e Formatos

| Formato | Uso recomendado |
|---|---|
| WebP | Melhor qualidade/tamanho; suporta transparência; padrão recomendado |
| AVIF | Qualidade superior ao WebP; suporte em expansão |
| PNG | Tiles pequenos; impraticável para mapas grandes |
| JPEG | Fundos sem transparência; artefatos de compressão |
| SVG | Ícones e gráficos vetoriais; requer width/height explícitos |
| WebM / MP4 | Tiles de vídeo; ~30 fps; ~50 MB max para distribuição |

### 15.4 Limites Práticos

- **Tokens por cena:** sem limite hard, mas >50–100 tokens com resource bars e status effects visíveis começam a degradar performance sem otimização.
- **Resolução de mapa:** sem limite técnico; recomenda-se ≤8K para mapas normais; textura GPU com mip-mapping é crucial.
- **Tiles por cena:** múltiplos tiles podem ser combinados em uma única imagem (tile combiner) para reduzir draw calls.
- **Grid size mínimo:** 50 px por célula.
- **Token art:** 400×400 px como padrão de mercado para tamanho Medium/Large.

### 15.5 Antialiasing e Qualidade

- SMAA (v12+) substituiu FXAA para melhor qualidade de bordas.
- PIXI v8 (com WebGPU e melhorias de batching significativas) foi avaliado mas **não adotado** até v13 por quebrar módulos existentes.

---

## 16. Interação com o Canvas

### 16.1 MouseInteractionManager

Cada `InteractionLayer` ativa registra um `MouseInteractionManager` que processa eventos de pointer (click, drag, scroll, right-click). Apenas uma layer pode estar ativa por vez.

### 16.2 Seleção e Drag

- Seleção via click simples ou rubber-band (drag de seleção).
- Drag de token: move o objeto; com Token Drag Measurement (v13), ativa o ruler simultaneamente.
- `CTRL + Drag` para duplicar (GM).
- Rotação via `Shift + WASD` / `Shift + Arrows` / `Shift + Scroll`; incrementos finos com `CTRL + Scroll`.

### 16.3 Navegação do Canvas

- Pan: drag com botão do meio ou Spacebar + drag.
- Zoom: scroll do mouse; pinch-to-zoom em touchpad (corrigido no v13).
- `canvas.pan(x, y, zoom)` — navegação programática.
- `canvas.animatePan(view)` — navegação animada.
- `canvas.recenter()` — centraliza no token controlado.
- Limites de zoom: padrão 0.1× – 3× (configurável por módulos).

### 16.4 Coordenadas

- **Canvas coordinates:** sistema de coordenadas interno em pixels, referenciado à cena.
- **Client coordinates:** pixels na viewport do browser.
- Conversão: `canvas.stage.toLocal()` e `canvas.stage.toGlobal()`.
- Transform bugs: módulos que aplicam rotação/skew no stage podem corromper o mapeamento cursor→canvas.

---

## 17. Antialias SMAA e Pós-processamento

O Foundry v12 migrou para SMAA aplicado como filtro de pós-processamento no `RenderedCanvasGroup`. O SMAA analisa a imagem renderizada e suaviza arestas sem o custo de multisampling por objeto.

Blur filters: instâncias criadas via `canvas.createBlurFilter()`, registradas em `canvas.blurFilters`. A intensidade do blur é dinamicamente atualizada com o zoom (`canvas.updateBlur()`), evitando blur excessivo em zoom muito baixo.

---

## 18. Resumo Arquitetural para o Fusion

Com base em toda a pesquisa, os conceitos-chave que o Fusion deve implementar (clean-room, comportamento análogo) são:

1. **Hierarquia de grupos** sobre um único `PIXI.Application`: Primary (físico) → Effects (iluminação/visão) → Interface (UI interativa) → Overlay (não vinculado ao stage transform).
2. **Sistema de layers** com base class, interaction class e placeables class; uma layer ativa por vez.
3. **Tipos de grade** com algoritmos de distância por regra configurável; hex com cube coordinates.
4. **Ruler com waypoints e custo de movimento** distinto de distância pura; integração com regiões de terreno.
5. **Tokens** com footprint (grid squares) × artwork scale; elevation; disposition; resource bars com visibilidade configurável; status effects como ícones; vision modes + detection modes.
6. **Tiles overhead com modos de oclusão** (fade, radial, vision); teste de 9 pontos por token.
7. **Iluminação via radial sweep** para LOS polygons; render textures reutilizáveis para fog of war.
8. **Paredes com restrições independentes** para movimento, visão, luz e som; portas com estados e animações.
9. **Scene Regions** com geometria composta e behaviors de evento/contínuos.
10. **PerceptionManager** com sistema de flags para batch de atualizações.
11. **Dynamic Token Rings** como framework de apresentação separado da artwork base.
12. **Performance:** culling manual, caching de containers como texturas, batching de sprites, formatos WebP/AVIF.

---

## Fontes

- [Canvas API v14 — Foundry VTT](https://foundryvtt.com/api/classes/foundry.canvas.Canvas.html)
- [Canvas API v12 — Foundry VTT](https://foundryvtt.com/api/v12/classes/client.Canvas.html)
- [Canvas Layers (Knowledge Base) — Foundry VTT](https://foundryvtt.com/article/canvas-layers/)
- [Canvas Layers (API Module) v13 — Foundry VTT](https://foundryvtt.com/api/modules/foundry.canvas.layers.html)
- [Canvas Wiki — Foundry VTT Community](https://foundryvtt.wiki/en/development/api/canvas)
- [Introduction to PIXI — Foundry VTT Community](https://foundryvtt.wiki/en/development/guides/pixi)
- [Tokens (Knowledge Base) — Foundry VTT](https://foundryvtt.com/article/tokens/)
- [Token API v14 — Foundry VTT](https://foundryvtt.com/api/classes/foundry.canvas.placeables.Token.html)
- [TokenAnimationOptions v13 — Foundry VTT](https://foundryvtt.com/api/v13/interfaces/foundry.types.TokenAnimationOptions.html)
- [Dynamic Token Rings — Foundry VTT](https://foundryvtt.com/article/dynamic-token-rings/)
- [Tiles (Knowledge Base) — Foundry VTT](https://foundryvtt.com/article/tiles/)
- [Measurement and Templates — Foundry VTT](https://foundryvtt.com/article/measurement/)
- [Measurement & Templates (DeepWiki) — foundryvtt/foundryvtt](https://deepwiki.com/foundryvtt/foundryvtt/3.6-measurement-and-templates)
- [Scenes (Knowledge Base) — Foundry VTT](https://foundryvtt.com/article/scenes/)
- [Scene Regions — Foundry VTT](https://foundryvtt.com/article/scene-regions/)
- [Walls (Knowledge Base) — Foundry VTT](https://foundryvtt.com/article/walls/)
- [Lighting (Knowledge Base) — Foundry VTT](https://foundryvtt.com/article/lighting/)
- [Drawings — Foundry VTT](https://foundryvtt.com/article/drawings/)
- [Map Notes — Foundry VTT](https://foundryvtt.com/article/map-notes/)
- [Ambient Sound — Foundry VTT](https://foundryvtt.com/article/ambient-sound/)
- [HexagonalGrid API — Foundry VTT](https://foundryvtt.com/api/classes/foundry.grid.HexagonalGrid.html)
- [SquareGrid API — Foundry VTT](https://foundryvtt.com/api/classes/foundry.grid.SquareGrid.html)
- [GRID_DIAGONALS v12 — Foundry VTT](https://foundryvtt.com/api/v12/enums/foundry.CONST.GRID_DIAGONALS.html)
- [PerceptionManager v12 — Foundry VTT](https://foundryvtt.com/api/v12/classes/client.PerceptionManager.html)
- [CanvasVisibility v14 — Foundry VTT](https://foundryvtt.com/api/classes/foundry.canvas.groups.CanvasVisibility.html)
- [Release 13.341 — Foundry VTT](https://foundryvtt.com/releases/13.341)
- [Release 12.324 — Foundry VTT](https://foundryvtt.com/releases/12.324)
- [Media Optimization Guide — Foundry VTT](https://foundryvtt.com/article/media/)
- [Performance Hacks Module — GitHub (Codas)](https://github.com/Codas/foundryvtt-performance-hacks)
- [PIXI v8 Adoption Issue — GitHub (foundryvtt)](https://github.com/foundryvtt/foundryvtt/issues/11183)
- [Token Drag Measurement Issue — GitHub (foundryvtt)](https://github.com/foundryvtt/foundryvtt/issues/11185)
