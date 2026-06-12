# Foundry VTT — Modelo de Documentos e Persistência

> Documento de pesquisa para o projeto Fusion (VTT próprio, clean-room).
> Abordagem: estudo do comportamento e APIs públicas do Foundry VTT; nenhum código proprietário foi copiado.

---

## Sumário

1. [Arquitetura Geral](#1-arquitetura-geral)
2. [Hierarquia de Classes Base](#2-hierarquia-de-classes-base)
3. [Documentos Primários](#3-documentos-primários)
4. [Documentos Embedded](#4-documentos-embedded)
5. [Relações e Embedding](#5-relações-e-embedding)
6. [Sistema de Schema (DataModel / DataFields)](#6-sistema-de-schema-datamodel--datafields)
7. [Validação, Limpeza e Migração](#7-validação-limpeza-e-migração)
8. [TypeDataModel e Subtypes](#8-typedatamodel-e-subtypes)
9. [Flags por Módulo/Sistema](#9-flags-por-módulossistema)
10. [Ownership e Permissões](#10-ownership-e-permissões)
11. [Persistência — LevelDB e Estrutura em Disco](#11-persistência--leveldb-e-estrutura-em-disco)
12. [Compendium Packs](#12-compendium-packs)
13. [Ciclo CRUD e Hooks](#13-ciclo-crud-e-hooks)
14. [UUID e Referências entre Documentos](#14-uuid-e-referências-entre-documentos)
15. [Ciclo de Preparação de Dados (prepareData)](#15-ciclo-de-preparação-de-dados-preparedata)
16. [Fontes](#16-fontes)

---

## 1. Arquitetura Geral

O Foundry VTT organiza toda informação persistida em torno do conceito de **Document**. Um Document é uma extensão de `DataModel` que reside no banco de dados e é referenciado por `_id`. Há dois grandes grupos:

- **Primary Documents**: documentos raiz, armazenados em suas próprias coleções no banco (ex.: `Actor`, `Item`, `Scene`). Cada coleção tem seu próprio namespace no LevelDB.
- **Embedded Documents**: documentos que vivem inteiramente dentro de um documento pai (ex.: `ActiveEffect` dentro de `Actor`, `TokenDocument` dentro de `Scene`). Só existem enquanto o documento pai existir.

O embedding pode ser profundamente aninhado. Exemplo canônico: `Scene` → `TokenDocument` → `ActorDelta` → `Item` → `ActiveEffect`.

A API v14 (versão mais recente em junho de 2026) define **34 tipos de documentos concretos** no namespace `foundry.documents`, além de classes base (`Base*`) que encapsulam a lógica compartilhada entre cliente e servidor.

---

## 2. Hierarquia de Classes Base

```
DataModel (foundry.abstract.DataModel)
└── Document (foundry.abstract.Document)
    ├── [Primary Documents] — Actor, Item, Scene, …
    └── [Embedded Documents] — ActiveEffect, TokenDocument, …
```

Cada tipo de documento possui:
- Uma classe **Base** (ex.: `BaseActor`, `BaseItem`) que define o schema e comportamentos comuns entre cliente e servidor. O servidor roda apenas as classes Base.
- Uma classe **cliente** (ex.: `Actor`, `Item`) que estende a Base via `ClientDocumentMixin` e acrescenta lógica de renderização, interação com canvas, etc.

---

## 3. Documentos Primários

Os documentos primários são armazenados em coleções próprias e acessíveis via `game.<collection>` (ex.: `game.actors`, `game.scenes`).

### 3.1 Actor

**Papel**: representa qualquer entidade "personagem" no mundo — PCs, NPCs, criaturas, veículos, etc.

**Campos principais** (via `defineSchema`):

| Campo | Tipo de Field | Descrição |
|---|---|---|
| `_id` | DocumentIdField | Identificador único |
| `_stats` | DocumentStatsField | Metadados de versão/auditoria |
| `name` | StringField | Nome do ator |
| `type` | DocumentTypeField | Subtipo (ex.: "character", "npc") |
| `img` | FilePathField | Caminho para artwork |
| `system` | TypeDataField | Dados específicos do sistema/subtipo |
| `prototypeToken` | EmbeddedDataField | Config padrão de token |
| `ownership` | DocumentOwnershipField | Permissões por usuário |
| `folder` | ForeignDocumentField | Pasta pai |
| `sort` | IntegerSortField | Ordem de exibição |
| `flags` | DocumentFlagsField | Dados arbitrários por namespace |

**Embedded collections**:
- `items` → coleção de `Item` embedded
- `effects` → coleção de `ActiveEffect` embedded

**Propriedades importantes**:
- `statuses`: Set de status effects aplicados
- `overrides`: Alterações aplicadas por active effects (in-memory)
- `itemTypes`: Record `<type, Item[]>` para acesso agrupado por subtipo

### 3.2 Item

**Papel**: representa qualquer "objeto" do sistema — arma, feitiço, habilidade, equipamento, feat, etc.

**Campos principais**:

| Campo | Tipo de Field | Descrição |
|---|---|---|
| `_id` | DocumentIdField | Identificador único |
| `_stats` | DocumentStatsField | Metadados |
| `name` | StringField | Nome do item |
| `type` | DocumentTypeField | Subtipo (ex.: "weapon", "spell") |
| `img` | FilePathField | Ícone |
| `system` | TypeDataField | Dados do sistema |
| `ownership` | DocumentOwnershipField | Permissões |
| `folder` | ForeignDocumentField | Pasta pai |
| `sort` | IntegerSortField | Ordem |
| `flags` | DocumentFlagsField | Flags arbitrários |

**Embedded collections**:
- `effects` → coleção de `ActiveEffect`

Items podem existir como documentos mundiais independentes ou embedded dentro de um `Actor`.

### 3.3 Scene

**Papel**: representa um mapa/cena com todos os seus elementos — tokens, paredes, luzes, sons, tiles, etc.

**Campos de configuração**:

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | StringField | Nome da cena |
| `active` | BooleanField | Se é a cena ativa |
| `width`, `height` | NumberField | Dimensões em pixels |
| `padding` | NumberField | Padding relativo |
| `grid` | GridData (SchemaField) | Config do grid |
| `tokenVision` | BooleanField | Habilita visão de token |
| `fog` | SchemaField | Config de fog of war (mode, colors, reset) |
| `environment` | SchemaField | Efeitos ambientais |
| `backgroundColor` | ColorField | Cor de fundo |
| `initial` | SchemaField | Vista inicial (x, y, scale) |
| `navigation` | BooleanField | Exibir na nav bar |
| `navName` | StringField | Nome na navegação |
| `playlist`, `playlistSound` | ForeignDocumentField | Áudio vinculado |
| `journal`, `journalEntryPage` | ForeignDocumentField | Journal vinculado |
| `thumb` | FilePathField | Thumbnail |
| `transition` | SchemaField | Animação de transição |
| `weather` | StringField | Efeito de clima |
| `shiftX`, `shiftY` | NumberField | Deslocamento de canvas |

**Embedded collections** (todas referenciadas diretamente pelo Scene):

| Coleção | Tipo de documento | Descrição |
|---|---|---|
| `tokens` | TokenData[] | Tokens posicionados |
| `walls` | WallData[] | Paredes/obstáculos |
| `lights` | AmbientLightData[] | Fontes de luz |
| `sounds` | AmbientSoundData[] | Sons ambientes |
| `tiles` | TileData[] | Tiles/imagens de mapa |
| `drawings` | DrawingData[] | Formas desenhadas |
| `notes` | NoteData[] | Pins de journal |
| `regions` | RegionData[] | Regiões com comportamentos |
| `levels` | LevelData[] | Níveis verticais (v14+) |

### 3.4 JournalEntry

**Papel**: notas, lore, handouts, regras, descrições de locais.

**Embedded collections**:
- `pages` → coleção de `JournalEntryPage`
- `categories` → coleção de `JournalEntryCategory` (para organização por abas)

### 3.5 JournalEntryPage

**Papel**: cada página dentro de um JournalEntry. Suporta múltiplos tipos de conteúdo.

**Campos principais**:

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | StringField | Título da página |
| `type` | DocumentTypeField | Tipo de conteúdo |
| `category` | DocumentIdField | Categoria/aba vinculada |
| `text` | SchemaField | Conteúdo textual |
| `image` | SchemaField | Dados de imagem (caption) |
| `video` | SchemaField | Dados de vídeo (loop, autoplay, volume, timestamp) |
| `src` | StringField | Fonte do arquivo (img/video/pdf) |
| `title` | SchemaField | Configuração de exibição do título |
| `ownership` | DocumentOwnershipField | Permissões individuais por página |
| `sort` | IntegerSortField | Ordem |
| `system` | TypeDataField | Dados de sistema |

**Tipos de página nativos**: `text`, `image`, `video`, `pdf` (e tipos personalizados via módulos/sistemas).

### 3.6 Macro

**Papel**: scripts executáveis (JavaScript ou chat command) vinculados à hotbar.

**Campos principais**: `name`, `type` ("script" | "chat"), `scope`, `command` (JavaScriptField), `img`, `ownership`, `flags`.

### 3.7 RollTable / TableResult

**Papel**: tabelas de resultado aleatório (loot, encontros, eventos).

- `RollTable`: campos `name`, `formula`, `replacement` (bool), `displayRoll` (bool), `results` (embedded collection de `TableResult`).
- `TableResult`: campos `type` (DocumentTypeField — anteriormente NumberField), `text`, `img`, `documentCollection`, `documentId`, `weight`, `range` (min/max), `drawn` (bool).

### 3.8 Playlist / PlaylistSound

**Papel**: gerenciamento de trilha sonora e efeitos.

- `Playlist`: campos `name`, `mode`, `playing`, `fade`, `folder`, `sounds` (embedded collection de `PlaylistSound`).
- `PlaylistSound`: campos `name`, `path` (FilePathField), `volume`, `repeat`, `fade`, `playing`, `pausedTime`.

### 3.9 ChatMessage

**Papel**: mensagem no chat de jogo. Inclui narração, resultados de dados, ações.

**Campos principais**:

| Campo | Tipo | Descrição |
|---|---|---|
| `author` | DocumentAuthorField | Usuário autor |
| `timestamp` | NumberField | Timestamp Unix |
| `type` | DocumentTypeField | Tipo da mensagem |
| `style` | NumberField | Estilo de exibição |
| `content` | HTMLField | Conteúdo HTML |
| `flavor` | HTMLField | Texto de sabor |
| `title` | StringField | Título opcional |
| `rolls` | ArrayField(JSONField) | Dados serializados (Roll objects) |
| `sound` | FilePathField | Efeito sonoro |
| `speaker` | SchemaField | Origem (scene, actor, token, alias) |
| `whisper` | ArrayField(ForeignDocumentField) | IDs de usuários destinatários |
| `blind` | BooleanField | Rolar blind (só GM vê) |
| `emote` | BooleanField | Ação de emote |
| `system` | TypeDataField | Dados de sistema |

**Modos de roll**: `public` (whisper=[], blind=false), `self` (whisper=[userId], blind=false), `gm` (whisper=[gmIds], blind=false), `blind` (whisper=[gmIds], blind=true).

### 3.10 Combat / Combatant / CombatantGroup

**Papel**: rastreador de combate e iniciativa.

- `Combat`: contém a embedded collection `combatants`. Campos: `scene` (ForeignDocumentField), `active` (bool), `round`, `turn`, `sort`.
- `Combatant`: vincula um Token/Actor ao combate. Campos: `tokenId`, `sceneId`, `actorId`, `name`, `img`, `initiative`, `hidden`, `defeated`. Desde v12, suporta `system` (TypeDataField).
- `CombatantGroup`: agrupa combatants (grupo de monstros compartilhando iniciativa). Introduzido em v12.

### 3.11 User

**Papel**: representa um usuário conectado ao servidor Foundry.

**Campos principais**: `name`, `role` (NumberField — ver seção 10), `password`, `avatar`, `color`, `character` (ForeignDocumentField para Actor padrão), `permissions` (ObjectField), `hotbar` (ObjectField — mapa de slot para Macro), `flags`.

**Roles** (CONST.USER_ROLES):
| Valor | Nome | Descrição |
|---|---|---|
| 0 | NONE | Bloqueado/banido |
| 1 | PLAYER | Jogador padrão |
| 2 | TRUSTED | Jogador com permissões extras |
| 3 | ASSISTANT | Assistente de GM |
| 4 | GAMEMASTER | GM completo |

### 3.12 Folder

**Papel**: organização hierárquica de documentos primários na sidebar.

**Campos principais**: `name`, `type` (tipo de documento que contém), `parent` (ForeignDocumentField para Folder pai), `sort`, `sorting` ("a" alphabetical | "m" manual), `color`, `flags`.

Folders são documentos primários mas não aparecem no canvas. São apenas estrutura organizacional.

### 3.13 Setting

**Papel**: armazenamento de configurações de mundo e módulo/sistema.

**Campos principais**: `key` (StringField — formato `"namespace.key"`), `value` (JSONField). Settings de mundo são persistidas como documentos; settings de cliente são armazenadas em `localStorage`.

### 3.14 Cards / Card

**Papel**: baralhos, mãos e pilhas de cartas (introduzido em v9).

- `Cards`: documento raiz representando deck, hand ou pile. Campos: `name`, `type` ("deck" | "hand" | "pile"), `description`, `img`, `width`, `height`, `cards` (embedded collection de `Card`).
- `Card`: campo individual. Campos: `name`, `type`, `description`, `suit`, `value`, `back`, `faces` (ArrayField de imagens), `origin` (id do baralho de origem), `drawn` (bool).

### 3.15 FogExploration

**Papel**: persistência da exploração de fog of war por usuário por cena.

**Campos principais**: `scene` (ForeignDocumentField), `user` (ForeignDocumentField), `explored` (StringField — imagem base64 PNG do estado explorado), `timestamp`.

Cada combinação scene+user tem seu próprio documento `FogExploration`. São gerados automaticamente pelo canvas ao explorar.

### 3.16 Adventure

**Papel**: bundle de múltiplos documentos para distribuição de aventuras em compêndios.

**Campos**: `name`, `img`, `caption` (HTMLField), `description` (HTMLField), `sort`, `folder`, `flags`.

**Embedded collections** (SetField de documentos completos):
`actors`, `items`, `scenes`, `journal`, `tables`, `macros`, `playlists`, `combats`, `cards`, `folders`.

O documento Adventure é sempre armazenado dentro de um Compendium Pack e importado como uma operação atômica.

---

## 4. Documentos Embedded

### 4.1 ActiveEffect

**Papel**: efeito ativo que modifica atributos de um Actor (ou Item).

**Campos principais**:

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | StringField | Nome do efeito |
| `img` | FilePathField | Ícone |
| `type` | DocumentTypeField | Subtipo |
| `system` | TypeDataField | Dados de sistema |
| `changes` | ArrayField(SchemaField) | Modificações (key, value, mode, priority) |
| `disabled` | BooleanField | Se está desabilitado |
| `duration` | SchemaField | Duração (rounds, seconds, turns, etc.) |
| `description` | HTMLField | Descrição |
| `origin` | DocumentUUIDField | Origem (UUID do Item que gerou) |
| `tint` | ColorField | Tint do ícone |
| `transfer` | BooleanField | Se transfere do Item para o Actor |
| `statuses` | SetField(StringField) | Status IDs associados |

**Como funciona**: `changes` contém uma lista de modificações, cada uma com um `key` (caminho no objeto do actor como `"system.attributes.hp.value"`), `value`, `mode` (CUSTOM=0, MULTIPLY=1, ADD=2, DOWNGRADE=3, UPGRADE=4, OVERRIDE=5) e `priority`.

Os efeitos são aplicados em `Actor#applyActiveEffects()` durante o ciclo `prepareData`, alterando propriedades in-memory sem mudar os dados persistidos.

**Transferência para Actor**: quando `transfer: true`, o ActiveEffect de um Item é transferido para o Actor ao equipar/adicionar. Com `legacyTransferral`, os efeitos são copiados fisicamente; com o modo padrão atual, `allApplicableEffects()` retorna efeitos de itens sem copiá-los.

### 4.2 TokenDocument

**Papel**: um token posicionado em uma cena. Embedded em `Scene`.

**Campos principais**:

| Campo | Tipo | Descrição |
|---|---|---|
| `_id` | DocumentIdField | ID único no contexto da cena |
| `name` | StringField | Nome exibido |
| `displayName` | NumberField | Modo de exibição do nome |
| `actorId` | ForeignDocumentField | Referência ao Actor base |
| `actorLink` | BooleanField | Se é linked ao Actor base |
| `delta` | EmbeddedDocumentField(ActorDelta) | Diferencial para unlinked tokens |
| `x`, `y` | NumberField | Posição no canvas |
| `elevation` | NumberField | Elevação vertical |
| `width`, `height` | NumberField | Dimensão em tiles de grid |
| `img` | FilePathField | Artwork do token |
| `displayBars` | NumberField | Modo de exibição das barras |
| `bar1`, `bar2` | SchemaField | Config das barras de atributo |
| `light` | SchemaField | Config de luz emitida |
| `sight` | SchemaField | Config de visão |
| `ring` | SchemaField | Config do anel animado |
| `hidden` | BooleanField | Se está oculto para jogadores |
| `locked` | BooleanField | Se está travado |
| `disposition` | NumberField | Amigo/Neutro/Hostil |
| `rotation` | AngleField | Rotação |
| `alpha` | AlphaField | Transparência |
| `texture` | SchemaField | Config de textura |
| `flags` | DocumentFlagsField | Flags por namespace |

**Token vinculado (linked)**: `actorLink: true` — o token aponta para o Actor mundial. Toda mudança no token modifica o Actor.

**Token desvinculado (unlinked / synthetic)**: `actorLink: false` — o token tem seu próprio `ActorDelta` que armazena apenas as diferenças em relação ao Actor base.

### 4.3 ActorDelta

**Papel**: armazena o diff entre um token desvinculado e seu Actor base. Introduced em v11 substituindo o campo `actorData` (plain object).

**Como funciona**: O ActorDelta é praticamente um mini-Actor — possui suas próprias collections de `Item` e `ActiveEffect` embedded. Só armazena o que mudou; itens não modificados "herdam" do Actor base.

O "Synthetic Actor" (ator sintético/token actor) é reconstruído em tempo de execução: toma o Actor base como template e aplica as alterações do ActorDelta. Esta operação ocorre in-memory e não gera um documento persistido separado.

Atualizações no Actor sintético são traduzidas server-side em atualizações do ActorDelta, disparando o ciclo CRUD normal.

### 4.4 Wall

**Papel**: obstáculo que bloqueia movimento, visão ou som. Embedded em Scene.

**Campos principais**: `c` (ArrayField de 4 números — coordenadas x1,y1,x2,y2), `door` (NumberField — 0=wall, 1=door, 2=secret), `ds` (NumberField — door state: closed/open/locked), `move` (NumberField — bloqueio de movimento), `sense` (NumberField — bloqueio de sentidos), `light` (NumberField — bloqueio de luz), `sound` (NumberField — bloqueio de som), `dir` (NumberField — direção da parede), `threshold` (SchemaField).

### 4.5 AmbientLight

**Papel**: fonte de luz posicionada na cena. Embedded em Scene.

**Campos principais**: `x`, `y` (posição), `rotation` (AngleField), `walls` (BooleanField — se é bloqueado por paredes), `vision` (BooleanField), `config` (SchemaField com intensity, color, angle, luminosity, etc.), `hidden`, `flags`.

### 4.6 AmbientSound

**Papel**: emissor de som ambiente posicionado na cena. Embedded em Scene.

**Campos principais**: `x`, `y` (posição), `radius` (NumberField), `path` (FilePathField), `volume` (AlphaField), `repeat` (BooleanField), `hidden`, `walls` (BooleanField — afetado por paredes), `easing` (BooleanField), `flags`.

### 4.7 Tile

**Papel**: imagem posicionada no canvas (background, foreground ou objeto). Embedded em Scene.

**Campos principais**: `x`, `y`, `width`, `height`, `rotation` (AngleField), `alpha` (AlphaField), `texture` (SchemaField — src, scaleX, scaleY, offsetX, offsetY, fit, tint, alphaThreshold), `overhead` (BooleanField — se é tile overhead), `occlusion` (SchemaField — mode, alpha, radius), `hidden`, `locked`, `restrictions` (SchemaField), `elevation` (SchemaField), `sort` (IntegerSortField), `flags`.

### 4.8 Drawing

**Papel**: forma geométrica ou texto desenhado por um usuário no canvas. Embedded em Scene.

**Campos principais**: `author` (DocumentAuthorField), `shape` (SchemaField — type, width, height, radius, points, bezierFactor), `x`, `y`, `elevation`, `sort`, `rotation`, `bezierFactor`, `fillType`, `fillColor`, `fillAlpha`, `strokeWidth`, `strokeColor`, `strokeAlpha`, `text`, `fontFamily`, `fontSize`, `textColor`, `textAlpha`, `hidden`, `locked`, `flags`.

### 4.9 MeasuredTemplate

**Papel**: template de área de efeito (cone, círculo, raio, retângulo). Embedded em Scene.

**Campos principais**: `author` (DocumentAuthorField), `t` (StringField — "circle" | "cone" | "ray" | "rect"), `x`, `y`, `elevation`, `distance`, `width`, `angle`, `direction`, `borderColor`, `fillColor`, `texture`, `hidden`, `flags`.

### 4.10 Note

**Papel**: pin/marcador no mapa vinculado a um JournalEntry ou JournalEntryPage. Embedded em Scene.

**Campos principais**: `entryId` (ForeignDocumentField para JournalEntry), `pageId` (ForeignDocumentField para JournalEntryPage), `x`, `y`, `elevation`, `icon` (FilePathField), `iconSize`, `text` (StringField — tooltip), `fontFamily`, `fontSize`, `textColor`, `textAnchor`, `global` (BooleanField — visível para jogadores sem ownership), `flags`.

### 4.11 RegionDocument (Region)

**Papel**: região geométrica em uma cena que pode conter comportamentos disparados por eventos. Introduced em v12.

**Campos principais**: `name` (StringField), `color` (ColorField), `visibility` (NumberField), `elevation` (SchemaField com bottom/top), `shapes` (ArrayField de SchemaField — não são embedded documents, mas dados inline), `behaviors` (embedded collection de `RegionBehavior`), `flags`.

**Shapes suportados**: retangular, elíptico, poligonal. "Holes" funcionam como shapes negativos.

**Events suportados**: TOKEN_ENTER, TOKEN_EXIT, TOKEN_MOVE, TOKEN_MOVE_IN, TOKEN_MOVE_OUT, TOKEN_ANIMATE_IN, TOKEN_ANIMATE_OUT, TOKEN_TURN_START, TOKEN_TURN_END, TOKEN_ROUND_START, TOKEN_ROUND_END, BEHAVIOR_STATUS, REGION_BOUNDARY.

### 4.12 RegionBehavior

**Papel**: comportamento vinculado a uma Region, disparado por eventos. Embedded em `RegionDocument`.

**Campos principais**: `type` (DocumentTypeField), `system` (TypeDataField), `disabled` (BooleanField), `events` (SetField — eventos que disparam o behavior).

**Tipos nativos**: AdjustDarkness, SuppressWeather, ModifyMovementCost, DisplayScrollingText, ExecuteMacro, ExecuteScript, PauseGame, TeleportToken, ToggleBehavior.

### 4.13 Level

**Papel**: nível vertical (andar/piso) em uma cena. Introduced em v14 como recurso nativo (antes existia como módulo de terceiro). Embedded em Scene.

**Campos**: `name`, `elevation` (SchemaField com range superior/inferior), `sort` (IntegerSortField), `background`, `foreground`, `textures`, `fog`, `visibility`, `flags`.

### 4.14 TableResult

**Papel**: resultado individual dentro de um RollTable. Embedded em RollTable.

**Campos**: `type` (DocumentTypeField — era NumberField até v12), `text`, `img`, `documentCollection`, `documentId`, `weight` (NumberField), `range` (ArrayField de 2 números — min/max), `drawn` (BooleanField), `flags`.

### 4.15 PlaylistSound

Ver seção 3.8.

### 4.16 JournalEntryPage / JournalEntryCategory

Ver seções 3.5 e 3.4.

---

## 5. Relações e Embedding

### 5.1 Hierarquia completa de embedding

```
[Primary Documents]
├── Actor
│   ├── items: Item[]
│   │   └── effects: ActiveEffect[]
│   └── effects: ActiveEffect[]
├── Item
│   └── effects: ActiveEffect[]
├── Scene
│   ├── tokens: TokenDocument[]
│   │   └── delta: ActorDelta
│   │       ├── items: Item[]
│   │       │   └── effects: ActiveEffect[]
│   │       └── effects: ActiveEffect[]
│   ├── walls: WallDocument[]
│   ├── lights: AmbientLightDocument[]
│   ├── sounds: AmbientSoundDocument[]
│   ├── tiles: TileDocument[]
│   ├── drawings: DrawingDocument[]
│   ├── notes: NoteDocument[]
│   ├── regions: RegionDocument[]
│   │   └── behaviors: RegionBehavior[]
│   └── levels: Level[]
├── JournalEntry
│   ├── pages: JournalEntryPage[]
│   └── categories: JournalEntryCategory[]
├── RollTable
│   └── results: TableResult[]
├── Playlist
│   └── sounds: PlaylistSound[]
├── Combat
│   └── combatants: Combatant[]
├── Cards
│   └── cards: Card[]
└── Adventure
    ├── actors: Actor[] (snapshot)
    ├── items: Item[]
    ├── scenes: Scene[]
    ├── journal: JournalEntry[]
    ├── tables: RollTable[]
    ├── macros: Macro[]
    ├── playlists: Playlist[]
    ├── combats: Combat[]
    ├── cards: Cards[]
    └── folders: Folder[]
```

### 5.2 EmbeddedCollection

Todos os documentos embedded são gerenciados por instâncias de `EmbeddedCollection`, que:
- Mantém referência ao array `_source` do documento pai
- Sincroniza instâncias de Document com os dados fonte via `initialize()`
- Indexa documentos por `_id`
- Rastreia documentos inválidos em `invalidDocumentIds`
- Agrupa por subtipo via `documentsByType`

A subclasse `EmbeddedCollectionDelta` é usada especificamente para a collection de `ActorDelta`, permitindo diff incremental em relação a uma collection base.

### 5.3 Propriedade `parent` e `isEmbedded`

Todo Document tem `parent` (referência imutável ao DataModel pai) e `isEmbedded` (bool). Documentos embedded herdam ownership do pai (não têm ownership próprio, exceto `JournalEntryPage` que tem ownership individual).

### 5.4 Referências externas (ForeignDocumentField)

Documentos podem referenciar outros documentos primários por `_id` via `ForeignDocumentField`, sem embedding físico. Ex.: `Folder.parent`, `Actor.folder`, `Note.entryId`.

---

## 6. Sistema de Schema (DataModel / DataFields)

### 6.1 DataModel

`foundry.abstract.DataModel` é a classe base para toda estrutura de dados validada. Características:
- Define o schema via método estático `defineSchema()` que retorna um objeto `DataSchema`
- O schema é computado na primeira acesso e cacheado
- Suporta herança: `static defineSchema() { const schema = super.defineSchema(); schema.newField = ...; return schema; }`
- Dados são limpos, validados e inicializados na construção
- `_source` armazena os dados brutos originais (sealed após construção)

### 6.2 Taxonomia completa de DataFields

A API v14 define os seguintes tipos de field em `foundry.data.fields`:

**Fields primitivos**:
| Field | Descrição |
|---|---|
| `DataField` | Classe base abstrata |
| `StringField` | Texto (com trim automático) |
| `NumberField` | Numérico (com min/max) |
| `BooleanField` | Booleano |
| `ObjectField` | Objeto genérico |
| `AnyField` | Aceita qualquer tipo |

**Fields de valores especializados**:
| Field | Descrição |
|---|---|
| `AngleField` | Ângulo (0-360°) |
| `AlphaField` | Valor de opacidade (0-1) |
| `HueField` | Valor de matiz de cor |
| `ColorField` | Cor (hex string) |
| `IntegerSortField` | Inteiro para ordenação |
| `HTMLField` | HTML sanitizado |
| `JavaScriptField` | Código JavaScript |
| `JSONField` | JSON serializado |
| `FilePathField` | Caminho para arquivo de mídia |

**Fields de coleção**:
| Field | Descrição |
|---|---|
| `ArrayField` | Array ordenado |
| `SetField` | Conjunto de valores únicos |

**Fields de schema/modelo**:
| Field | Descrição |
|---|---|
| `SchemaField` | Objeto com schema aninhado |
| `EmbeddedDataField` | Instância de DataModel nested |
| `EmbeddedDocumentField` | Document embedded individual |
| `EmbeddedCollectionField` | Coleção de Documents embedded |
| `EmbeddedCollectionDeltaField` | Coleção delta (ActorDelta) |
| `DataModelSchemaField` | Schema de DataModel |
| `TypedSchemaField` | Schema condicional por tipo |
| `TypedObjectField` | Object com validação por tipo |

**Fields de referência de documento**:
| Field | Descrição |
|---|---|
| `DocumentIdField` | `_id` de documento |
| `DocumentUUIDField` | UUID de documento |
| `ForeignDocumentField` | Referência a document externo por id |
| `DocumentTypeField` | Tipo/subtipo de documento |
| `DocumentAuthorField` | Autor do documento |
| `DocumentOwnershipField` | Mapa de ownership |
| `DocumentFlagsField` | Flags por namespace |
| `DocumentStatsField` | Metadados `_stats` |
| `TypeDataField` | Field `system` tipado |

**Fields de geometria/canvas**:
| Field | Descrição |
|---|---|
| `GridOffsetField` | Offset de posição no grid |
| `GridOffsetsField` | Múltiplos offsets |
| `SceneLevelsSetField` | Set de levels de cena |
| `ShapesField` | Dados de geometria (Region shapes) |
| `ShaderField` | Código/referência de shader |

---

## 7. Validação, Limpeza e Migração

### 7.1 Fluxo de construção de um Document

```
Dados brutos (disco/rede)
    ↓
DataModel._initializeSource()
    ├── migrateDataSafe()   ← migração com try/catch (não falha)
    ├── cleanData()         ← limpeza e coerção de tipos
    │   ├── _preCleanData()
    │   ├── [limpeza de cada field]
    │   └── _cleanData()
    └── shimData()          ← aliases de retrocompatibilidade
    ↓
_source (sealed)
    ↓
_initialize()              ← copia dados para propriedades de instância
    ↓
Document pronto
```

### 7.2 Validação

- `validate(changes?, options?)`: valida o modelo completo ou um diff parcial
- `validateJoint(data)`: validação cruzada entre campos (ex.: min <= max)
- `validationFailures`: accessor com erros por campo e erros conjuntos
- Campos podem ter `validate` customizado: `(value, options) => boolean`
- Retornar `false` equivale a lançar `DataModelValidationFailure`
- Em modo `strict`, falha de validação lança erro; caso contrário, substitui pelo valor default

### 7.3 Migração

- `migrateData(source)`: método estático para transformar dados legados. Chamado antes da validação, tanto na leitura do disco quanto na aplicação de update deltas.
- `migrateDataSafe(source)`: wrapper com try/catch para evitar falha na construção de documentos com dados malformados.

Padrão de uso:
```
// Exemplo conceitual (não é código do Foundry)
static migrateData(source) {
  // converter "data.attributes" para "system.attributes"
  if (source.data) { source.system = source.data; delete source.data; }
  return super.migrateData(source);
}
```

As migrações são encadeadas via herança: sempre chamar `super.migrateData(source)`.

---

## 8. TypeDataModel e Subtypes

### 8.1 Conceito

`TypeDataModel` é uma subclasse especializada de `DataModel` projetada para representar os dados específicos do tipo de um documento. Sistemas e módulos que definem subtypes de Actor, Item, etc. devem estender `TypeDataModel` em vez do `DataModel` base.

A instância do TypeDataModel é acessível como `document.system`. O documento pai é acessível de dentro do model via `this.parent`.

### 8.2 Registro

No manifest (`system.json` ou `module.json`):
```json
{
  "documentTypes": {
    "Actor": { "character": {}, "npc": {} },
    "Item": { "weapon": {}, "spell": {} }
  }
}
```

No código (hook `init`):
```javascript
// Exemplo conceitual
Hooks.on("init", () => {
  CONFIG.Actor.dataModels.character = CharacterDataModel;
  CONFIG.Item.dataModels.weapon = WeaponDataModel;
});
```

### 8.3 Métodos de preparação de dados

- `prepareBaseData()`: inicializa valores base antes de effects serem aplicados (ex.: `this.hp = { value: 0, max: 0 }`)
- `prepareDerivedData()`: computa valores derivados após effects (ex.: `this.hp.bloodied = Math.floor(this.hp.max / 2)`)

Esses métodos são chamados em ordem pelo ciclo `prepareData` do documento pai.

### 8.4 Documentos que suportam TypeDataModel

Via v12+, os seguintes documentos suportam subtypes com TypeDataModel:
- `Actor`, `Item`: suporte original (v10)
- `JournalEntryPage`: suporte para custom page types
- `ChatMessage`: custom message types
- `Combat`, `Combatant`: suporte adicionado em v12
- `RegionBehavior`: tipo principal do sistema de behaviors
- `Cards`, `Card`: custom card types

### 8.5 Campos especiais do sistema

- `htmlFields` no manifest: declara campos do `system` que contêm HTML e precisam de sanitização
- `filePathFields` no manifest: campos com caminhos de arquivo que podem receber dados base64

---

## 9. Flags por Módulos/Sistemas

### 9.1 Estrutura

O campo `flags` é um `DocumentFlagsField` (ObjectField) com estrutura de dois níveis:

```json
{
  "flags": {
    "core": { ... },
    "world": { ... },
    "my-module-id": { "someKey": "someValue" },
    "my-system-id": { "systemData": true }
  }
}
```

### 9.2 Namespaces

- `core`: usado pelo software core do Foundry
- `world`: dados específicos do mundo
- `<packageId>`: o id canônico do módulo ou sistema (ex.: `"pf2e"`, `"midi-qol"`)

### 9.3 API

```javascript
// Ler
const value = document.getFlag("my-module", "myKey");

// Escrever (retorna Promise<Document>)
await document.setFlag("my-module", "myKey", "myValue");

// Deletar
await document.unsetFlag("my-module", "myKey");
// ou setar null
await document.setFlag("my-module", "myKey", null);
```

### 9.4 Comportamento especial

- `setFlag` com um objeto como valor faz **merge** (não substitui) o objeto existente
- Para substituir um objeto inteiro, usar `unsetFlag` antes ou usar `update({ flags: { scope: { key: valor } } })`
- Flags são persistidas no banco junto com o documento
- Flags **não são validadas** pelo schema core — são dados arbitrários (ObjectField)

### 9.5 Flags vs campo `system`

| Aspecto | `flags` | `system` |
|---|---|---|
| Propósito | Extensão arbitrária por módulo | Dados tipados do sistema de jogo |
| Validação | Nenhuma (ObjectField) | Schema definido via TypeDataModel |
| Namespace | Por packageId | Único por tipo de documento |
| Performance | Merge atômico | Parte do schema completo |
| Validação no servidor | Não | Não (TypeDataModel é client-side) |

---

## 10. Ownership e Permissões

### 10.1 Níveis de ownership (CONST.DOCUMENT_OWNERSHIP_LEVELS)

| Valor | Nome | Descrição |
|---|---|---|
| -1 | INHERIT | Herda da Folder pai |
| 0 | NONE | Documento invisível para o usuário |
| 1 | LIMITED | Acesso básico (sidebar + dados limitados) |
| 2 | OBSERVER | Visualização completa sem edição |
| 3 | OWNER | Visualização e edição completa |

### 10.2 Estrutura do campo ownership

```json
{
  "ownership": {
    "default": 0,
    "userId123": 3,
    "userId456": 2
  }
}
```

- `default`: nível para todos os usuários não listados explicitamente
- Chaves adicionais: `userId` → nível de ownership específico

### 10.3 Documentos que suportam ownership

Actor, Item, JournalEntry, JournalEntryPage (own por página), RollTable, Cards, Macro, Scene, Playlist.

Documentos **sem** ownership próprio: a maioria dos embedded documents (herdam do pai), ChatMessage, Combat, User, Folder, Setting, FogExploration.

### 10.4 Hierarquia de permissões

1. GM sempre tem acesso total a todos os documentos
2. Ownership por userId tem precedência sobre `default`
3. `INHERIT (-1)` faz o documento herdar da Folder pai
4. Por default, todos os documentos iniciam com `{ default: 0 }` (visível apenas para GMs)

### 10.5 API de verificação de permissão

```javascript
// Testar nível de ownership
document.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER);

// Obter nível do usuário atual
document.getUserLevel(game.user);

// Testar se usuário pode criar
Actor.canUserCreate(game.user);

// Testar se usuário pode modificar (com ação específica)
document.canUserModify(game.user, "update");
```

---

## 11. Persistência — LevelDB e Estrutura em Disco

### 11.1 Histórico

- **Até v10**: NeDB (append-only, arquivos `.db` com JSON line-delimited, human-readable)
- **v11+**: LevelDB (ClassicLevel — chave/valor binário, SSTable-based, alta performance)

A migração de NeDB para LevelDB ocorre automaticamente na primeira carga do mundo em v11+. Arquivos `.db` legados são preservados durante a migração, mas devem ser removidos manualmente após confirmar que a migração foi bem-sucedida.

### 11.2 Estrutura de diretórios

```
<UserDataPath>/
├── Config/
│   └── options.json          ← configurações do servidor Foundry
├── Data/
│   ├── worlds/
│   │   └── <world-id>/
│   │       ├── world.json     ← manifest do mundo
│   │       ├── data/          ← LevelDB para dados do mundo
│   │       │   ├── actors/    ← LevelDB dir (binary)
│   │       │   ├── cards/
│   │       │   ├── combat/
│   │       │   ├── fog/
│   │       │   ├── folders/
│   │       │   ├── items/
│   │       │   ├── journal/
│   │       │   ├── macros/
│   │       │   ├── messages/
│   │       │   ├── playlists/
│   │       │   ├── settings/
│   │       │   ├── scenes/
│   │       │   ├── tables/
│   │       │   └── users/
│   │       └── packs/         ← Compendium packs do mundo
│   │           └── <pack-name>/   ← LevelDB dir por pack
│   ├── systems/
│   │   └── <system-id>/
│   │       ├── system.json
│   │       └── packs/
│   │           └── <pack-name>/   ← LevelDB dir por pack
│   ├── modules/
│   │   └── <module-id>/
│   │       ├── module.json
│   │       └── packs/
│   └── [assets e uploads do usuário]
└── Logs/
```

### 11.3 LevelDB — Características

- **Formato binário**: não editável diretamente. Alterações manuais nos arquivos corrompem o banco.
- **Locking**: o banco é travado enquanto o processo Foundry está rodando. Só um processo pode escrever por vez.
- **Sublevels**: LevelDB suporta particionamento hierárquico via sublevels. O Foundry usa sublevels para armazenar embedded documents de forma granular, permitindo atualizar um embedded document sem reescrever o documento pai inteiro.
- **SSTables**: dados são armazenados em tabelas imutáveis de log-estruturado (Sorted String Tables) gerenciadas internamente.

Vantagens sobre NeDB:
- Atualização granular de embedded documents sem reescrever o documento inteiro
- Suporte a "grandchildren" (documentos 2+ níveis abaixo)
- Melhor performance em operações bulk
- Indexação aprimorada de compêndios

### 11.4 world.json

```json
{
  "id": "my-world",
  "title": "My World",
  "system": "pf2e",
  "coreVersion": "14.0.0",
  "version": "1.0.0",
  "compatibility": {
    "minimum": "12",
    "verified": "14"
  },
  "authors": [{ "name": "GM Name" }],
  "description": "..."
}
```

### 11.5 Backup

- Ferramenta built-in de backup disponível desde v11.5
- Prioridade: `Data/worlds/` (crítico), `Data/modules/` (recomendado), `Data/systems/` (raramente necessário), `Config/` (opcional)
- **IMPORTANTE**: Serviços de sync de arquivo (OneDrive, Dropbox, Google Drive) são incompatíveis com LevelDB — podem corromper o banco ao copiar arquivos durante operações de escrita.

### 11.6 Acesso programático ao LevelDB

O Foundry CLI (`foundryvtt-cli`) provê acesso seguro:
- `unpack`: lê um LevelDB e exporta cada documento como arquivo `.json` ou `.yaml` separado
- `pack`: lê um diretório de arquivos exportados e cria um LevelDB

Arquivos desempacotados são nomeados no padrão: `<DocumentName>_<documentId>.json` (subtipo como prefixo para Actor e Item, ex.: `npc_GoblinWarrior_abc123.json`).

Opção `omitVolatile: true` exclui campos como `_stats.modifiedTime` e `_stats.lastModifiedBy` do export, útil para armazenar em git.

---

## 12. Compendium Packs

### 12.1 Conceito

Compendium Packs são coleções de documentos pré-fabricados, gerenciados por LevelDB, que ficam fora do mundo ativo. O conteúdo fica em estado de "lazy loading" — apenas o índice é carregado, e os documentos completos são buscados do banco sob demanda.

### 12.2 Definição no manifest

```json
{
  "packs": [
    {
      "name": "monsters",
      "label": "Monster Compendium",
      "path": "packs/monsters",
      "type": "Actor",
      "system": "pf2e"
    }
  ]
}
```

**Tipos de document suportados**: `Actor`, `Item`, `Scene`, `JournalEntry`, `RollTable`, `Macro`, `Playlist`, `Cards`, `Adventure`.

**Escopo**: `world` (criados no mundo), `system` (do sistema de jogo), `module` (de módulos).

### 12.3 Índice (lazy loading)

```javascript
// Obtém índice leve (apenas _id, name, img + campos solicitados)
const index = await pack.getIndex({ fields: ["system.level"] });

// Cada entrada no índice tem a forma:
// { _id: "abc123", name: "Goblin", img: "...", uuid: "Compendium.world.monsters.Actor.abc123" }
```

O índice permite busca/listagem sem carregar os dados completos. Documentos completos são carregados via `pack.getDocument(id)` ou `fromUuid(uuid)`.

### 12.4 UUID de compêndio

Formato: `Compendium.<packageId>.<packName>.<DocumentType>.<documentId>`

Exemplo: `Compendium.pf2e.bestiary-1.Actor.goblinWarrior123`

### 12.5 Export/Import

- **Export**: `CompendiumCollection.exportFolder()` — exporta pasta de documentos para o compêndio
- **Import**: `pack.importDocument(doc)` — importa documento do compêndio para o mundo
- **Folders em compêndios**: documentos `Folder` são armazenados junto com os outros documentos no LevelDB, usando o prefixo `_Folder` no nome do arquivo quando desempacotado via CLI.

---

## 13. Ciclo CRUD e Hooks

### 13.1 Métodos CRUD

**Create**:
```
Document.create(data, operation?)           → cria documento primário
Document.createDocuments(data[], operation?) → criação em batch
document.createEmbeddedDocuments(type, data[], operation?) → cria embedded
```

**Read**:
```
collection.get(id, options?)               → busca por ID
fromUuid(uuid)                             → busca por UUID (async)
fromUuidSync(uuid)                         → busca síncrona (só world docs)
```

**Update**:
```
document.update(data, operation?)          → atualiza documento (diff parcial)
Document.updateDocuments(updates[], op?)   → batch update
document.updateEmbeddedDocuments(type, updates[], op?) → atualiza embedded
document.updateSource(changes, options?)   → atualiza in-memory sem persistir
```

**Delete**:
```
document.delete(operation?)                → deleta documento
Document.deleteDocuments(ids[], op?)       → batch delete
document.deleteEmbeddedDocuments(type, ids[], op?) → deleta embedded
```

### 13.2 Diffs parciais

O sistema de atualização calcula automaticamente o diff mínimo entre o update solicitado e o estado atual em `_source`. Apenas as mudanças reais são enviadas ao servidor, reduzindo tráfego de rede.

### 13.3 Hooks — Nomenclatura

Os hooks seguem o padrão: `{pre|}{action}{DocumentType}`.

**Hooks genéricos** (disparam para qualquer tipo de documento):

| Hook | Quando dispara | Cancelável |
|---|---|---|
| `preCreateDocument` | Antes de criar | Sim (return false) |
| `createDocument` | Após criar (todos os clientes) | Não |
| `preUpdateDocument` | Antes de atualizar | Sim (return false) |
| `updateDocument` | Após atualizar (todos os clientes) | Não |
| `preDeleteDocument` | Antes de deletar | Sim (return false) |
| `deleteDocument` | Após deletar (todos os clientes) | Não |

**Hooks específicos por tipo** (substituir "Document" pelo tipo): `preCreateActor`, `createActor`, `preUpdateToken`, `updateToken`, etc.

### 13.4 Assinatura dos hooks

```javascript
// Hooks.on com hook específico
Hooks.on("preUpdateActor", (document, changed, options, userId) => {
  // document: a instância do Document
  // changed: objeto com o diff a ser aplicado (modificável)
  // options: DatabaseUpdateOperation
  // userId: id do usuário que iniciou a operação
  
  // Para cancelar: return false
  // Para modificar o diff: alterar `changed` diretamente
});

// Após criação (todos os clientes recebem)
Hooks.on("createActor", (document, options, userId) => {
  // document: o Document criado
});
```

### 13.5 Comportamento cliente/servidor

- **Hooks `pre*`**: disparam **apenas** no cliente que iniciou a operação, **antes** de enviar para o servidor. São o ponto para cancelar ou modificar dados.
- **Hooks pós (createDocument, etc.)**: disparam **em todos os clientes** após o servidor processar e broadcast a mudança.
- **Hooks nunca são awaited**: funções async retornam Promise (não boolean), então não podem cancelar operações. Apenas funções síncronas que retornam `false` cancelam.

### 13.6 Hooks.call vs Hooks.callAll

- `Hooks.call(event, ...args)`: para se qualquer listener retornar `false`
- `Hooks.callAll(event, ...args)`: executa todos os listeners independente de retorno; não pode ser cancelado

### 13.7 Outros hooks relevantes para o ciclo de dados

| Hook | Contexto |
|---|---|
| `preImportAdventure` / `importAdventure` | Importação de Adventure |
| `updateCompendium` | Mudança em compêndio |
| `applyActiveEffect` | Aplicação de ActiveEffect |
| `combatStart`, `combatRound`, `combatTurn` | Ciclo de combate |
| `moveToken` / `preMoveToken` | Movimento de token |
| `dropCanvasData` | Drop de dados no canvas |

---

## 14. UUID e Referências entre Documentos

### 14.1 Formato de UUID

UUIDs são identificadores universais que permitem localizar qualquer documento em qualquer contexto (mundo, compêndio, embedded).

**Padrões de formato**:

| Contexto | Formato |
|---|---|
| Documento primário no mundo | `Actor.{actorId}` |
| Documento embedded | `Scene.{sceneId}.Token.{tokenId}` |
| Embedded aninhado | `Actor.{actorId}.Item.{itemId}.ActiveEffect.{effectId}` |
| Compêndio | `Compendium.{packId}.{DocType}.{docId}` |
| Synthetic Actor (token) | `Scene.{sceneId}.Token.{tokenId}.Actor.{actorId}` |

### 14.2 Funções de resolução

```javascript
// Assíncrono (funciona com compêndios e mundo)
const doc = await fromUuid("Actor.abc123");

// Síncrono (apenas documentos já carregados no mundo)
const doc = fromUuidSync("Actor.abc123");

// Parsing em partes
const parts = parseUuid("Scene.sceneId.Token.tokenId");
// → { collection, type, id, embedded: [...] }
```

---

## 15. Ciclo de Preparação de Dados (prepareData)

O ciclo `prepareData` é fundamental para entender como dados persistidos se tornam os dados funcionais usados no jogo.

### 15.1 Ordem de execução para Actor

```
Actor.prepareData()
  ├── 1. reset()                         → reverte overrides para _source
  ├── 2. system.prepareBaseData()        → base do TypeDataModel
  ├── 3. this.prepareBaseData()          → base do Actor
  ├── 4. this.prepareEmbeddedDocuments()
  │       ├── items.forEach(item.prepareData())
  │       └── effects (preparação de duração, etc.)
  ├── 5. this.applyActiveEffects()       → aplica changes dos effects
  ├── 6. system.prepareDerivedData()     → derivados do TypeDataModel
  └── 7. this.prepareDerivedData()       → derivados do Actor
```

### 15.2 Princípio fundamental

Dados persistidos (`_source`) **nunca** são alterados pelos active effects ou pelo prepareData. Todos os overrides são aplicados em-memory sobre os dados de instância. Isso permite reverter facilmente e calcular diffs precisos na hora do update.

### 15.3 DocumentStats (_stats)

Todos os documentos primários possuem o campo `_stats` (DocumentStatsField), gerenciado pelo servidor:

| Campo | Tipo | Descrição |
|---|---|---|
| `coreVersion` | string | Versão do Foundry na criação/atualização |
| `systemId` | string | ID do sistema de jogo |
| `systemVersion` | string | Versão do sistema |
| `createdTime` | number | Timestamp Unix de criação |
| `modifiedTime` | number | Timestamp Unix de última modificação |
| `lastModifiedBy` | string | userId de quem fez a última modificação |

Campos marcados como **voláteis** (excluídos por padrão ao fazer export via CLI com `omitVolatile: true`): `createdTime`, `modifiedTime`, `lastModifiedBy`, `systemVersion`, `coreVersion`.

---

## 16. Fontes

- [Foundry VTT API Documentation - Version 14](https://foundryvtt.com/api/)
- [Document class - API v14](https://foundryvtt.com/api/classes/foundry.abstract.Document.html)
- [DataModel class - API v14](https://foundryvtt.com/api/classes/foundry.abstract.DataModel.html)
- [TypeDataModel class - API v14](https://foundryvtt.com/api/classes/foundry.abstract.TypeDataModel.html)
- [Actor class - API v14](https://foundryvtt.com/api/classes/foundry.documents.Actor.html)
- [ActiveEffect class - API v14](https://foundryvtt.com/api/classes/foundry.documents.ActiveEffect.html)
- [TokenDocument class - API v14](https://foundryvtt.com/api/classes/foundry.documents.TokenDocument.html)
- [Level document - API v14](https://foundryvtt.com/api/v14/classes/foundry.documents.Level.html)
- [Adventure document - API v14](https://foundryvtt.com/api/classes/foundry.documents.Adventure.html)
- [JournalEntryPage class - API v13](https://foundryvtt.com/api/v13/classes/foundry.documents.JournalEntryPage.html)
- [ChatMessage class - API v14](https://foundryvtt.com/api/classes/foundry.documents.ChatMessage.html)
- [EmbeddedCollection class - API v13](https://foundryvtt.com/api/classes/foundry.abstract.EmbeddedCollection.html)
- [foundry.documents module - API v14](https://foundryvtt.com/api/modules/foundry.documents.html)
- [foundry.data.fields module - API v14](https://foundryvtt.com/api/modules/foundry.data.fields.html)
- [hookEvents module - API v14](https://foundryvtt.com/api/modules/hookEvents.html)
- [Hooks class - API v14](https://foundryvtt.com/api/classes/foundry.helpers.Hooks.html)
- [SceneData interface - API v13](https://foundryvtt.com/api/interfaces/foundry.documents.types.SceneData.html)
- [DocumentStatsField - API v13](https://foundryvtt.com/api/classes/foundry.data.fields.DocumentStatsField.html)
- [DOCUMENT_OWNERSHIP_LEVELS - API v14](https://foundryvtt.com/api/variables/CONST.DOCUMENT_OWNERSHIP_LEVELS.html)
- [Introduction to System Data Models](https://foundryvtt.com/article/system-data-models/)
- [Version 10 Data Model Changes](https://foundryvtt.com/article/v10-data-model/)
- [Version 11 Content Packaging Changes (LevelDB)](https://foundryvtt.com/article/v11-leveldb-packs/)
- [Version 11 Token Changes (ActorDelta)](https://foundryvtt.com/article/v11-actor-delta/)
- [Scene Regions article](https://foundryvtt.com/article/scene-regions/)
- [Adventure Documents article](https://foundryvtt.com/article/adventure/)
- [Users and Permissions article](https://foundryvtt.com/article/users/)
- [User Data management article](https://foundryvtt.com/article/user-data/)
- [User Data Backup article](https://foundryvtt.com/article/user-data-backup/)
- [foundry-vtt-cli (GitHub)](https://github.com/foundryvtt/foundryvtt-cli)
- [NEDB to LevelDB migration issue #5065](https://github.com/foundryvtt/foundryvtt/issues/5065)
- [DeepWiki — Compendium Packs](https://deepwiki.com/foundryvtt/foundryvtt/4.3-compendium-packs)
- [Forge VTT Blog — Multiple Levels of Challenge (LevelDB internals)](https://blog.forge-vtt.com/multiple-levels-of-challenge/)
- [Foundry VTT Community Wiki — Active Effect](https://foundryvtt.wiki/en/development/api/document/active-effect)
- [parseUuid function - API v14](https://foundryvtt.com/api/functions/foundry.utils.parseUuid.html)
