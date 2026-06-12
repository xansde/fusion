# Foundry VTT — Visão, Iluminação e Fog of War

> **Pesquisa clean-room para o projeto Fusion.**
> Descreve comportamento, conceitos, formatos e algoritmos observados a partir de fontes públicas (Knowledge Base oficial, API docs, issues públicas do GitHub). Nenhum código proprietário foi copiado.
> Data de referência: junho de 2026. Versões analisadas: v11, v12, v13, v14 (estado mais recente da API pública).

---

## Sumário

1. [Walls — Paredes e Barreiras](#1-walls--paredes-e-barreiras)
2. [Lighting — Sistema de Iluminação](#2-lighting--sistema-de-iluminação)
3. [Vision — Modos de Visão e Detection Modes](#3-vision--modos-de-visão-e-detection-modes)
4. [Fog of War — Névoa de Guerra](#4-fog-of-war--névoa-de-guerra)
5. [Algoritmos Subjacentes](#5-algoritmos-subjacentes)
6. [Scene Regions (v12+)](#6-scene-regions-v12)
7. [Arquitetura de Renderização](#7-arquitetura-de-renderização)
8. [Implementações Open-Source de Referência](#8-implementações-open-source-de-referência)
9. [Fontes](#9-fontes)

---

## 1. Walls — Paredes e Barreiras

### 1.1 Conceito Geral

Walls (paredes) são segmentos de linha colocados no canvas que restringem movement (movimento de tokens), sight (visão), light (luz) e sound (som). Cada segmento pode ter configurações independentes para cada uma dessas quatro dimensões. Essa separação é o ponto arquitetural mais importante: um mesmo segmento pode bloquear movimento sem bloquear visão, ou bloquear luz sem bloquear som.

### 1.2 Tipos de Parede (Presets)

| Tipo | Cor padrão | Movement | Sight | Light | Sound | Uso típico |
|---|---|---|---|---|---|---|
| Normal | Amarelo | Bloqueado | Bloqueado | Bloqueado | Bloqueado | Paredes sólidas |
| Terrain | Verde | Bloqueado | Limitado (1 camada) | Limitado | Bloqueado | Rochas, telhados, moitas |
| Invisible | Ciano | Bloqueado | Livre | Livre | Livre | Vidro, campos de força |
| Ethereal | Magenta claro | Livre | Bloqueado | Bloqueado | Livre | Barreiras que bloqueam visão mas permitem passagem |
| Door (porta) | — | Bloqueado (fechado) | Bloqueado (fechado) | Bloqueado (fechado) | Bloqueado (fechado) | Portas interativas |
| Secret Door | — | Bloqueado (fechado) | Bloqueado (fechado) | Bloqueado (fechado) | Bloqueado (fechado) | Portas secretas (ícone oculto a players) |
| Window (proximity wall) | — | Bloqueado | Proximity-based | Proximity-based | Proximity-based | Janelas, seteiras |

### 1.3 Opções de Restrição por Dimensão

Para cada dimensão de percepção (sight, light, sound), existem cinco modos de restrição possíveis:

- **None**: A percepção passa livremente. A parede é ignorada para essa dimensão.
- **Normal**: A percepção é completamente bloqueada pela parede.
- **Limited**: A percepção passa através desta parede, mas não além de uma segunda parede "Limited" ou "Normal" subsequente. É o mecanismo das terrain walls — permite ver a rocha ou o prédio, mas não o que está do outro lado.
- **Proximity**: A percepção passa apenas se a fonte/viewer estiver dentro de uma distância threshold configurável da parede. Modela janelas vistas de perto.
- **Reverse Proximity**: O oposto — a percepção passa apenas se a fonte/viewer estiver ALÉM da distância threshold. Modela seteiras ou ameias: visíveis de longe, opacas de perto.

Para movement, a opção é binária: None ou Normal (bloqueado).

### 1.4 Threshold Attenuation (Atenuação de Proximidade)

Quando atenuação está habilitada em uma Proximity wall, a penetração não é binária. Se a fonte está na borda do threshold, a luz/visão penetra apenas um pouco através da parede. Conforme a fonte se aproxima, a penetração aumenta gradualmente até o máximo permitido quando a fonte está encostada na parede. Esse comportamento **não se aplica a sound** — som é simplesmente passado ou bloqueado.

### 1.5 Direcionalidade

Por padrão, paredes restringem pelos dois lados. É possível configurar uma parede para restringir apenas pelo lado esquerdo ou apenas pelo lado direito (indicado por uma seta no editor). Isso cria efeitos de "one-way" — por exemplo, tokens dentro de uma sala podem ver para fora, mas tokens fora não podem ver para dentro.

**Nota conhecida:** Em versões anteriores ao v12, proximity walls não respeitavam corretamente a direção da parede para visão e luz (issue #9363 do GitHub público do Foundry).

### 1.6 Portas

Portas são segmentos de parede com estado interativo:

- **Fechada/Trancada**: Bloqueia movimento, visão, luz e som.
- **Aberta**: Remove todas as restrições.
- **Secreta**: Funciona como porta normal, mas o ícone de interação não é exibido para players — apenas o GM pode abrí-la. Players não sabem que a parede é interativa.

Portas suportam animações configuráveis (Ascend, Descend, Slide, Swing, Swivel) com parâmetros de duração e intensidade, e efeitos sonoros opcionais.

### 1.7 Terrain Walls e a Regra "Passa Através de Uma"

Terrain walls implementam o modo "Limited" em sight e light. O engine verifica quantas limited walls consecutivas estão no caminho do raio. Se o raio cruzou zero ou uma limited wall, a visão continua. Se cruzou duas ou mais, é bloqueada. Essa contagem é feita durante o sweep polygon — cada aresta marcada como "limited" é contada separadamente.

**Caso de uso clássico**: Um boulder (rocha grande) cercado de terrain walls. O jogador vê a rocha inteira (primeira camada de limited walls), mas não vê o que está imediatamente atrás dela (segunda camada).

**Limitação conhecida**: Terrain walls com formatos complexos, especialmente com cantos ou protuberâncias, podem gerar artefatos visuais onde vertices compartilhados causam contagem incorreta de limited walls cruzadas (issue #5935 do GitHub público).

---

## 2. Lighting — Sistema de Iluminação

### 2.1 Conceito Geral

Foundry implementa iluminação dinâmica 2D usando WebGL/PIXI.js. Cada fonte de luz — seja colocada diretamente na cena (ambient light) ou carregada por um token (token light) — é um `PointLightSource` que emite um polígono de luz calculado em tempo real usando o mesmo algoritmo de sweep polygon das walls.

O canvas distingue três estados visuais de iluminação:
- **Bright Light**: Área totalmente iluminada.
- **Dim Light**: Área de penumbra — visível, mas com intensidade reduzida.
- **Unlit (Darkness)**: Área não iluminada. Tokens sem darkvision ou outra fonte de iluminação não enxergam nessa área.

### 2.2 Propriedades de uma Fonte de Luz

| Propriedade | Descrição |
|---|---|
| Posição (X, Y) | Coordenadas em pixels no canvas da cena |
| Bright Radius | Raio de luz plena, em unidades de grid |
| Dim Radius | Raio de luz fraca (pode ser maior ou menor que bright) |
| Emission Angle | Ângulo de emissão (padrão: 360° — círculo completo) |
| Rotation | Orientação direcional da fonte em graus |
| Color | Cor hexadecimal com intensidade configurável (padrão: 0.5) |
| Luminosity | Brilho da fonte. Valor negativo cria **darkness source** |
| Constrained by Walls | Se falso, a luz ignora paredes e ilumina através de tudo |
| Provides Vision | Tokens controlados pelo jogador podem ver dentro do raio desta luz |
| Gradual Illumination | Transição suave entre bright e dim; se desativado, borda abrupta |
| Darkness Activation Range | Faixa de darkness level da cena na qual a luz ativa/desativa automaticamente |

### 2.3 Darkness Sources (Luz Negativa)

Definindo `luminosity` negativo, a fonte passa a **emitir escuridão** em vez de luz. Dentro do raio da darkness source:
- A luz de outras fontes é suprimida (ou reduzida, dependendo da intensidade).
- Tokens sem detection modes especiais não conseguem ver nessa área.
- O efeito é aditivo com outras fontes — uma darkness source poderosa sobrepõe fontes de luz comuns.

Esse mecanismo é usado para modelar zonas de escuridão mágica, por exemplo.

### 2.4 Darkness Level da Cena

O Darkness Level é um parâmetro de cena (slider de 0 a 1) que:
- Aplica um filtro visual (tint) sobre toda a cena, simulando hora do dia.
- Controla quais fontes de luz estão ativas (via Darkness Activation Range de cada luz).
- Interage com o Global Illumination Threshold.

**Atenção**: O Darkness Level é principalmente estético — ele por si só NÃO afeta mecanicamente o que os tokens enxergam. O efeito mecânico vem do threshold de global illumination.

### 2.5 Global Illumination e Threshold

**Global Illumination (GI)** é um modo de cena onde toda a área explorada é considerada iluminada, independente de fontes de luz. Útil para cenas de dia em exteriores.

**Global Illumination Threshold**: Define em qual valor de Darkness Level o GI é automaticamente desabilitado. Quando o Darkness Level atinge esse threshold:
- A GI é suprimida.
- Tokens sem fonte de luz ou darkvision ficam cegos em áreas não iluminadas.
- Scene Regions com "Adjust Darkness" que ultrapassam o threshold também se tornam mecanicamente escuras.

### 2.6 Animações de Luz

O engine suporta aproximadamente 20 tipos de animações para fontes de luz, implementadas como shaders WebGL ou manipulações de parâmetros por frame:

- **Efeitos de chama**: Torch, Flickering Light
- **Efeitos de pulso**: Pulse, Pulsing Wave
- **Efeitos de cor**: Radial Rainbow, Chroma, Fairy Light, Bewitching Wave
- **Efeitos atmosféricos**: Swirling Fog, Energy Field, Vortex
- **Outros**: Emanation, Mysterious Emanation, Ghost Light, etc.

Cada animação tem parâmetros de Speed, Intensity e Direction Reversal.

### 2.7 Técnicas de Coloração (Coloration Methods)

Onze métodos controlam como a cor de uma luz afeta os pixels subjacentes:

- **Adaptive Luminance** (padrão): preserva visibilidade do background com boa saturação de cor.
- **Halo Interno/Externo**: flares pronunciados.
- **Color Burn**: escurece e aumenta contraste.
- **Modos de Absorção** (Low, High, Inverted): efeitos de absorção de luz.
- **Natural Light**: simula perda de luz branca conforme escuridão aumenta.

### 2.8 Token Light Sources

Tokens podem ter fontes de luz próprias configuradas diretamente no documento do token (campos `light.*`). Essas luzes seguem o token durante o movimento e são calculadas da mesma forma que ambient lights — inclusive respeitando walls.

---

## 3. Vision — Modos de Visão e Detection Modes

### 3.1 Separação Conceitual: Vision Mode vs. Detection Mode

O Foundry distingue dois sistemas ortogonais:

- **Vision Mode**: Controla a *aparência* — como o canvas é renderizado do ponto de vista daquele token. Exemplos: visão colorida normal, visão monocromática (darkvision), visão de radar (tremorsense).
- **Detection Mode**: Controla a *mecânica* — o que e quem pode ser detectado, sob quais condições. Exemplos: Basic Sight (darkvision em áreas não iluminadas), See Invisibility, Feel Tremor.

Um token pode ter um Vision Mode ativo e múltiplos Detection Modes configurados simultaneamente.

### 3.2 Vision Modes Nativos

| Vision Mode | Descrição |
|---|---|
| Basic Vision | Visão padrão colorida. Depende de fontes de luz para enxergar. |
| Darkvision | Em áreas sem luz, a visão é dessaturada (monocromática). Em áreas com luz, visão normal colorida. |
| Monochromatic | Similar ao darkvision, mas sempre monocromático, independente de iluminação. |
| Tremorsense | Efeito visual de "radar sweep" — pulsa e revela detalhes (paredes, fog exploration) mas não o background da cena. |

Vision Modes são classes extendíveis via API pública — sistemas e módulos podem registrar novos modos.

### 3.3 Detection Modes Nativos

| Detection Mode | Tipo | Requer LOS | Penetra Walls | Descrição |
|---|---|---|---|---|
| Darkvision (ex-Basic Sight) | SIGHT | Sim | Não | Controla quanto um token enxerga em áreas não iluminadas. Renomeado em v12. |
| See Invisibility | SIGHT | Sim | Não | Detecta tokens com condição "Invisible". Requer linha de visão. |
| Sense Invisibility | OTHER | Não | Sim | Detecta tokens invisíveis mesmo através de paredes. |
| Feel Tremor | OTHER | Não | Sim | Detecta todos os tokens na mesma elevação. Tokens voando (elevação > altura da cena) não são detectados. |

**Regra semântica importante**: Detection Modes cujo nome começa com "See" requerem linha de visão e são bloqueados por paredes. Modos cujo nome começa com "Sense" ignoram paredes.

### 3.4 Parâmetros de Visão por Token

Cada token tem:
- **Vision Range**: Raio máximo de visão (em unidades de grid). Pode ser `null` para ilimitado.
- **Vision Angle**: Ângulo do cone de visão (padrão: 360°). Reduzir cria cone direcional.
- **Vision Mode**: Qual Vision Mode está ativo.
- **Detection Modes**: Lista de Detection Modes com range individual por modo.

### 3.5 Pipeline de Teste de Visibilidade

Quando o engine testa se um objeto `O` está visível para um token `T`:

1. Para cada Detection Mode de `T`:
   a. **`_testPoint`**: Verifica se o ponto-alvo está dentro do range do detection mode.
   b. **`_testLOS`**: Se o modo requer linha de visão, verifica se o ponto está contido dentro do polígono LOS de `T`. Se o modo ignora paredes, esse teste sempre retorna `true`.
2. Se qualquer Detection Mode resultar em detecção positiva, `O` é visível para `T`.

A classe `CanvasVisibility` coordena esse pipeline para todos os placeables da cena (tokens, notas, controles de porta, etc.).

### 3.6 VisionMode: Lighting Levels

A classe `VisionMode` define constantes de nível de iluminação relevantes para a percepção:
- `BRIGHT = 2`
- `DIM = 1`
- `UNLIT = 0`
- `DARKNESS = -2`

Esses valores são usados internamente para determinar o estado de iluminação de uma área e qual Vision Mode/Detection Mode se aplica.

---

## 4. Fog of War — Névoa de Guerra

### 4.1 Conceito e Comportamento

O Fog of War (FoW) em Foundry é uma camada de exploração persistente por jogador por cena. Áreas não exploradas aparecem completamente opacas (negras). Áreas já visitadas mas fora da linha de visão atual aparecem num estado intermediário (geralmente coloridas mais escuras — "explored but not currently visible"). Áreas na linha de visão atual aparecem normalmente.

Importante: a exploração é **individual** — cada jogador (usuário) mantém seu próprio estado de FoW para cada cena.

### 4.2 Armazenamento — FogExploration Document

O estado de exploração é persistido em documentos `FogExploration` no banco de dados do mundo (LevelDB):

```
FogExploration {
  scene: <id da cena>,
  user: <id do usuário>,
  explored: "data:image/webp;base64,..." // textura base64
}
```

- Um documento por (cena, usuário).
- A textura armazenada é uma imagem WEBP (anteriormente JPEG) em base64.
- Pixels brancos na textura indicam áreas exploradas; pixels transparentes indicam áreas não exploradas.
- A textura funciona como máscara inversa sobre a camada de FoW.

### 4.3 FogManager — Gerenciador de Estado

O `FogManager` (`canvas.fog`) é um singleton que gerencia o ciclo de vida do FoW:

| Método/Propriedade | Descrição |
|---|---|
| `COMMIT_THRESHOLD = 70` | Número de cycles de refresh antes de salvar no banco. Evita writes excessivos. |
| `_updated` | Flag booleana: indica se há mudanças pendentes não salvas. |
| `exploration` | Referência ao FogExploration document ativo. |
| `load()` | Carrega dados existentes do banco e popula o sprite inicial. |
| `commit()` | Compõe containers explorados no staging sprite; dispara save se threshold atingido. |
| `save()` | Solicita extração da textura e persistência no banco. |
| `reset()` | Envia requisição ao servidor para deletar FogExploration documents da cena e reinicializar. |
| `sync()` | Funcionalidade experimental: sincroniza exploração entre usuários. |
| `isPointExplored(x, y)` | Testa se coordenadas específicas já foram exploradas. |

### 4.4 Pipeline de Atualização

1. A cada frame com movimentação ou mudança de visão, o engine calcula o novo polígono de visão.
2. O polígono é renderizado (pintado de branco) sobre a textura de exploração acumulada.
3. O contador de refreshes é incrementado.
4. Quando o contador ultrapassa `COMMIT_THRESHOLD` (70), `commit()` é chamado:
   - A textura acumulada é extraída como base64 (`_extractBase64()`).
   - Os dados são formatados (`_prepareFogUpdateData()`) e enviados ao banco.
5. O flag `_updated` é limpo após save bem-sucedido.

### 4.5 Reset e Edge Cases

- O botão "Reset Fog of War" da toolbar invoca `fog.reset()`.
- O reset envia requisição ao servidor para deletar os documentos; o handler `_handleReset()` então desativa o fog atual e reinicializa no cliente.
- **Problema histórico (issue #8122)**: O reset podia falhar quando o cliente tinha exploração local ainda não salva no banco (sem document ID atribuído). A correção move o reset para o nível da WorldCollection para tratar esses casos.
- **Problema histórico (issue #7613)**: Reset não limpava posições em cache, causando reaparecimento de áreas exploradas após refresh.

---

## 5. Algoritmos Subjacentes

### 5.1 ClockwiseSweepPolygon — O Motor de Visibilidade

Foundry usa um algoritmo chamado `ClockwiseSweepPolygon` para calcular polígonos de visibilidade (linha de visão, iluminação). Trata-se de uma implementação de **angular sweep** (varredura angular) com geometria CCW (counter-clockwise), executada para cada fonte de luz e visão a cada frame relevante.

**Estruturas de dados principais:**
- `vertices`: Mapa de vértices candidatos a colisão (endpoints das walls, interseções).
- `edges`: Conjunto de arestas que definem as barreiras (walls ativas).
- `rays`: Array de raios disparados de `origin` para cada vértice relevante.
- `bounds`: Retângulo delimitador que limita o sweep.

**Fases do algoritmo:**

1. **Identificação de arestas** (`_identifyEdges`): Consulta a quadtree de walls para recuperar candidatos dentro dos bounds. Classifica cada aresta por tipo de inclusão (`_determineEdgeTypes`).

2. **Identificação de vértices** (`_identifyVertices`): Consolida todos os vértices das arestas identificadas no mapa de vértices.

3. **Identificação de interseções** (`_identifyIntersections`): Adiciona vértices nos pontos onde arestas se cruzam.

4. **Ordenação de vértices** (`_sortVertices`): Ordena vértices em sentido horário (clockwise) a partir de um raio inicial apontado para oeste (ângulo 0 = oeste).

5. **Sweep** (`_executeSweep`): Varre os vértices em ordem angular:
   - Para cada vértice: atualiza as arestas ativas (`_updateActiveEdges`) — remove arestas counter-clockwise concluídas, adiciona arestas clockwise iniciadas.
   - Testa se o vértice está ocluído por arestas ativas (`_isVertexBehindActiveEdges`).
   - Se não ocluído, determina o resultado da varredura (`_determineSweepResult`) e acumula pontos do polígono.
   - Quando a aresta ativa mais próxima muda, registra a troca (`_switchEdge`).

6. **Aplicação de constraints** (`applyConstraint`): O polígono resultante pode ser intersectado com shapes de constraint (Rectangle, Circle, Polygon) para aplicar range máximo ou ângulo de cone.

**Quadtree**: Walls são indexadas em uma quadtree espacial para recuperação eficiente das arestas relevantes para cada origem, evitando testar todas as walls da cena.

### 5.2 Algoritmo de Visibilidade 2D — Fundamentos Gerais

O ClockwiseSweepPolygon é uma implementação do padrão de **visibility polygon por angular sweep**, descrito publicamente em recursos como o Red Blob Games. O conceito geral:

1. A partir do ponto de origem, identificam-se todos os ângulos onde walls iniciam ou terminam.
2. Para cada ângulo, dispara-se um raio e encontra-se a wall mais próxima intersectada.
3. O conjunto de pontos de interseção (ordenados por ângulo) forma o polígono de visibilidade.
4. Para performance, mantém-se um conjunto de "arestas ativas" durante a varredura — arestas que cruzam o raio atual — evitando testar todas as walls para cada ângulo.

**Complexidade**: O(n log n) para n arestas (walls), dominado pela ordenação de vértices.

### 5.3 Rendering com WebGL/PIXI.js

A visibilidade não é renderizada diretamente no canvas — ela é usada como máscara:

1. O polígono de visão de cada token ativo (e o polígono de cada fonte de luz) é renderizado como sprite branco em uma render texture off-screen.
2. Essa textura de visibilidade é usada como máscara sobre a camada de Fog of War.
3. O Fog of War é uma camada opaca (geralmente preta semitransparente) que cobre toda a cena.
4. Onde a textura de visibilidade é branca, o FoW é transparente (área visível). Onde é preta, o FoW é opaco.

A exploração persistente é acumulada em outra render texture — a textura do FogManager — que só cresce (pixels brancos nunca voltam a preto, exceto no reset).

### 5.4 Diferença entre LOS Polygon e Fog Exploration

| Aspecto | LOS Polygon | Fog Exploration |
|---|---|---|
| Cálculo | Real-time, a cada frame | Acumulativo, atualizado ao mover |
| Armazenamento | Apenas na memória (GPU) | Persistido no banco como imagem |
| Conteúdo | O que o token AGORA enxerga | Tudo que o token JÁ explorou |
| Por usuário? | Sim (POV por token controlado) | Sim (por usuário e cena) |

---

## 6. Scene Regions (v12+)

### 6.1 Introdução

Scene Regions são uma feature introduzida no Foundry v12 que permite definir áreas geométricas da cena com comportamentos configuráveis. Uma Region pode ter múltiplos **Shapes** (retângulo, elipse, polígono) e múltiplos **Behaviors** (efeitos que se aplicam na área).

### 6.2 Shapes

- **Retangular**: definido por posição e dimensões.
- **Elíptico**: definido por centro e raios.
- **Poligonal**: polígono arbitrário desenhado pelo GM.

Shapes de uma mesma região são combinados em união — a área efetiva é a união de todos os shapes.

### 6.3 Elevation (Elevação)

Cada Region tem uma faixa de elevação (bottom elevation, top elevation). Tokens com elevação fora dessa faixa não interagem com a região. Isso permite criar regiões que só afetam tokens "no chão" vs. tokens "voando", possibilitando cenários multi-andar sem precisar de tiles.

A partir do v12, o range de elevação é definido no nível da Region (não dos shapes individuais).

### 6.4 Behaviors Relevantes para Iluminação e Visão

#### Adjust Darkness Level
Modifica o darkness level dentro da região, independente do darkness level global da cena. A partir do v12.320:
- Se o darkness level da região ultrapassar o **Global Illumination Threshold** da cena, a área é tratada mecanicamente como não iluminada.
- Tokens sem darkvision, detect invisibility ou outra fonte de luz não enxergam dentro da região.
- Isso permite criar, por exemplo, uma masmorra escura dentro de uma cena de exterior claro.

**Bug histórico (issue #11048)**: O Vision Mode "Darkvision" não interagia corretamente com o GI threshold de Scene Regions em versões iniciais do v12. Corrigido posteriormente.

#### Suppress Weather
Impede que efeitos de clima (weather) sejam renderizados dentro da região. Útil para áreas cobertas sem precisar de tiles de telhado.

#### Modify Movement Cost
Aplica multiplicador (0–5 em incrementos de 0.25) ao custo de movimento de tokens dentro da região. Modela terreno difícil ou bônus de movimento.

### 6.5 Behaviors Baseados em Eventos

Behaviors de evento são disparados por eventos específicos:

| Evento | Descrição |
|---|---|
| Token Enters | Disparado quando token entra na região |
| Token Exits | Disparado quando token sai da região |
| Token Moves In/Out/Within | Disparado durante movimento dentro/fora/através da região |
| Token Animates In/Out | Disparado durante animações de entrada/saída |
| Combat Turn/Round | Disparado em mudanças de turno ou round de combate |
| Region Boundary Change | Disparado quando a geometria da região muda |

Behaviors de evento incluem: Teleport Token, Execute Macro/Script, Pause Game, Display Scrolling Text, Toggle Behavior.

### 6.6 Arquitetura Técnica das Regions

- Regions são documentos com embedded Behavior documents.
- Shapes são armazenados como arrays dentro do documento da região (não como documentos embedded separados).
- O sistema é extensível: sistemas e módulos podem registrar novos tipos de Behavior.

---

## 7. Arquitetura de Renderização

### 7.1 Stack Tecnológica

Foundry usa **PIXI.js** (WebGL 2) como engine de renderização do canvas. O canvas é estruturado em layers (camadas PIXI.Container) ordenadas:

```
BackgroundLayer
DrawingsLayer (Tiles foreground/background)
GridLayer
TemplateLayer
TokenLayer
NotesLayer
LightingLayer ← luz e visão
SightLayer    ← fog of war
SoundsLayer
EffectsLayer  ← weather, efeitos visuais
WallsLayer    ← apenas visível no modo edição
ControlsLayer
```

(Ordem aproximada — layers inferiores são renderizadas primeiro.)

### 7.2 Grupos de Canvas (v12+)

A partir do v12, o canvas é organizado em grupos além de layers:
- **PrimaryCanvasGroup**: conteúdo da cena (background, tokens, tiles).
- **EffectsCanvasGroup**: iluminação, visão, clima — modifica visualmente o PrimaryCanvasGroup.
- **InterfaceCanvasGroup**: UI, controles, cursor.

### 7.3 PointSource e RenderedPointSource

Toda fonte de percepção (luz ou visão) no canvas é um `PointSource`. A hierarquia:

```
PointSource
  └── RenderedPointSource     ← fontes com representação visual
        ├── PointLightSource  ← fontes de luz (ambient e token lights)
        └── PointVisionSource ← visão de tokens
```

`RenderedPointSource` renderiza até três layers (camadas de mesh):
- **background**: efeito no background da cena.
- **coloration**: coloração aplicada sobre a área iluminada.
- **illumination**: a iluminação propriamente dita.

### 7.4 VisionMode e seu papel no pipeline

Quando um Vision Mode é ativado em um `PointVisionSource`:
- `VisionMode.activate(source)` é chamado, podendo modificar shaders ou parâmetros do source.
- A cada frame enquanto ativo, `VisionMode.animate(dt)` permite animações frame-a-frame.
- Quando desativado (token muda de modo ou é desselecionado), `VisionMode.deactivate(source)` limpa as modificações.

`VisionMode` tem um accessor `perceivesLight` — retorna `false` apenas em modos que desabilitam iluminação inteiramente (ex.: um modo hipotético onde o token literalmente não percebe fontes de luz).

---

## 8. Implementações Open-Source de Referência

### 8.1 Algoritmo Red Blob Games

O artigo público "2D Visibility" de Amit Patel (Red Blob Games) descreve o algoritmo de visibility polygon por angular sweep com complexidade O(n log n). É a base conceitual para implementações como o ClockwiseSweepPolygon do Foundry e bibliotecas open-source como:

- `Silverwolf90/2d-visibility` (MIT): implementação JavaScript portada diretamente do artigo.
- `ncase/sight-and-light` (CC0): tutorial interativo com implementação completa.

### 8.2 Módulos Open-Source do Ecossistema Foundry (licenças permissivas)

Esses módulos, com código aberto, oferecem insights sobre como estender ou replicar funcionalidades:

| Repositório | Licença | Relevância |
|---|---|---|
| `caewok/fvtt-elevated-vision` | MIT | Visão baseada em elevação de token/terrain, modifica ClockwiseSweepPolygon |
| `caewok/fvtt-token-visibility` | MIT | Regras avançadas de visibilidade de token (tamanho do token, cover) |
| `dev7355608/perfect-vision` | MIT | Visão e iluminação avançadas, desenhos como fontes de luz/escuridão |
| `dev7355608/vision-5e` | MIT | Detection modes para D&D 5e (blindsight, truesight, devil's sight) |
| `dev7355608/limits` | MIT | Limita range de sight/light/darkness/sound dentro de regions |
| `trdischat/lessfog` | MIT | Modificações no fog of war para visibilidade do GM |
| `caewok/fvtt-light-mask` | MIT | Máscara de luz usando walls temporárias |

### 8.3 Alternativas Open-Source para Implementação em Fusion

Para uma implementação própria, as opções open-source mais relevantes:

1. **visibility-polygon.js** (domínio público): biblioteca JavaScript de visibility polygon, O(n log n), usada em jogos HTML5.
2. **PIXI.js** (MIT): engine de renderização — se Fusion usar WebGL, PIXI é a escolha natural para replicar o padrão do Foundry.
3. **Three.js** (MIT): alternativa WebGL mais voltada a 3D mas usável para 2D com shaders.
4. **Geotic / polygon-clipping**: bibliotecas para operações booleanas em polígonos (necessárias para combinar múltiplos LOS polygons de tokens diferentes).

---

## 9. Fontes

### Documentação Oficial Foundry VTT
- [Walls — Knowledge Base](https://foundryvtt.com/article/walls/)
- [Lighting — Knowledge Base](https://foundryvtt.com/article/lighting/)
- [Scene Regions — Knowledge Base](https://foundryvtt.com/article/scene-regions/)
- [Version 12 Feature Preview](https://foundryvtt.com/article/v12-preview/)
- [Release 12.320 — Notas de versão](https://foundryvtt.com/releases/12.320)
- [Release 14.360 — Notas de versão](https://foundryvtt.com/releases/14.360)

### Documentação da API Foundry VTT
- [ClockwiseSweepPolygon — API v12](https://foundryvtt.com/api/v12/classes/client.ClockwiseSweepPolygon.html)
- [ClockwiseSweepPolygon — API v13](https://foundryvtt.com/api/v13/classes/foundry.canvas.geometry.ClockwiseSweepPolygon.html)
- [FogManager — API v13](https://foundryvtt.com/api/v13/classes/foundry.canvas.perception.FogManager.html)
- [FogExploration — API v10](https://foundryvtt.com/api/v10/classes/client.FogExploration.html)
- [VisionMode — API v13](https://foundryvtt.com/api/classes/foundry.canvas.perception.VisionMode.html)
- [DetectionModeInvisibility — API v13](https://foundryvtt.com/api/v13/classes/foundry.canvas.perception.DetectionModeInvisibility.html)
- [CanvasVisibility — API v14](https://foundryvtt.com/api/classes/foundry.canvas.groups.CanvasVisibility.html)

### Issues Públicas do GitHub (foundryvtt/foundryvtt)
- [Issue #7324 — Proximity threshold walls (Windows)](https://github.com/foundryvtt/foundryvtt/issues/7324)
- [Issue #7801 — Detection Modes (proposta original)](https://github.com/foundryvtt/foundryvtt/issues/7801)
- [Issue #8122 — Fog reset com exploração local não salva](https://github.com/foundryvtt/foundryvtt/issues/8122)
- [Issue #8807 — Reverse Proximity wall sense type](https://github.com/foundryvtt/foundryvtt/issues/8807)
- [Issue #8435 — Vision Modes com Detection Modes padrão](https://github.com/foundryvtt/foundryvtt/issues/8435)
- [Issue #9363 — Proximity walls não respeitam direção](https://github.com/foundryvtt/foundryvtt/issues/9363)
- [Issue #5880 — FogExploration com JPEG vs PNG](https://github.com/foundryvtt/foundryvtt/issues/5880)
- [Issue #5935 — Terrain walls com vértices compartilhados](https://github.com/foundryvtt/foundryvtt/issues/5935)
- [Issue #11048 — Darkvision + GI threshold em Scene Regions](https://github.com/foundryvtt/foundryvtt/issues/11048)

### Recursos de Algoritmo
- [Red Blob Games: 2D Visibility](https://www.redblobgames.com/articles/visibility/)
- [Sight & Light — ncase.me (CC0)](https://ncase.me/sight-and-light/)
- [Silverwolf90/2d-visibility (MIT)](https://github.com/Silverwolf90/2d-visibility)

### Módulos Open-Source
- [caewok/fvtt-elevated-vision](https://github.com/caewok/fvtt-elevated-vision)
- [caewok/fvtt-token-visibility](https://github.com/caewok/fvtt-token-visibility)
- [dev7355608/perfect-vision](https://github.com/dev7355608/perfect-vision)
- [dev7355608/vision-5e](https://github.com/dev7355608/vision-5e)
- [dev7355608/limits](https://github.com/dev7355608/limits)

### Comunidade
- [Walls — Foundry VTT Community Wiki](https://foundryvtt.wiki/en/basics/Walls)
- [DeepWiki: Walls and Tiles](https://deepwiki.com/foundryvtt/foundryvtt/3.4-walls-and-tiles)
- [Token Vision in Foundry VTT — joshua.law](https://writing.joshua.law/token-vision-in-foundry-vtt)
