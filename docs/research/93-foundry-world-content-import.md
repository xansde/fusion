# 93 — Import de Mundos e Conteúdo Foundry/Roll20 para o Fusion

> Documento de pesquisa para o projeto Fusion — VTT web proprietário com abordagem clean-room.
> Data de elaboração: 2026-06-11
> Metodologia: estudo de Knowledge Base pública, API docs e repositórios open-source. Nenhum código proprietário do Foundry foi copiado.

---

## Índice

1. [Estrutura Física de um Mundo Foundry em Disco](#1-estrutura-física-de-um-mundo-foundry-em-disco)
2. [Extração via foundryvtt-cli](#2-extração-via-foundryvtt-cli)
3. [Mapeamento do Schema de Documents Foundry](#3-mapeamento-do-schema-de-documents-foundry)
4. [PF2e — Estrutura do Campo `system` e ETL para o Fusion](#4-pf2e--estrutura-do-campo-system-e-etl-para-o-fusion)
5. [Import de Cenas: Mapas, Walls, Lights e Assets](#5-import-de-cenas-mapas-walls-lights-e-assets)
6. [Adventure Documents — Importação de Aventuras Completas](#6-adventure-documents--importação-de-aventuras-completas)
7. [Import de Roll20](#7-import-de-roll20)
8. [Universal VTT (UVTT / DD2VTT) — Padrão de Mercado para Mapas](#8-universal-vtt-uvtt--dd2vtt--padrão-de-mercado-para-mapas)
9. [Limites Legais — O que pode ser importado](#9-limites-legais--o-que-pode-ser-importado)
10. [Pipeline de Importação Recomendado para o Fusion](#10-pipeline-de-importação-recomendado-para-o-fusion)
11. [Gaps e Open Questions](#11-gaps-e-open-questions)
12. [Fontes](#12-fontes)

---

## 1. Estrutura Física de um Mundo Foundry em Disco

### 1.1 Diretório de Dados do Usuário

O Foundry VTT armazena todo o conteúdo criado pelo usuário em um **User Data Directory** que é separado do diretório de instalação do software. Os caminhos padrão por sistema operacional são:

- **Windows:** `%localappdata%\FoundryVTT\`
- **macOS:** `~/Library/Application Support/FoundryVTT`
- **Linux:** `~/.local/share/FoundryVTT`

Dentro do User Data Directory, a estrutura de alto nível é:

```
<UserDataPath>/
├── Config/
│   └── options.json          Configurações globais do servidor
├── Data/
│   ├── systems/              Game systems instalados
│   ├── modules/              Módulos instalados
│   └── worlds/               Mundos criados pelo GM
└── Logs/
```

### 1.2 Estrutura de um Mundo Individual

Cada mundo reside em `Data/worlds/<world-id>/`. A estrutura dentro do diretório do mundo inclui:

```
Data/worlds/meu-mundo/
├── world.json                Manifesto do mundo (metadados)
├── data/                     Banco de dados do mundo (LevelDB)
│   ├── actors/               Coleção de Actors (pasta LevelDB)
│   ├── cards/                Coleção de Cards
│   ├── combats/              Coleção de Combats
│   ├── folders/              Pastas organizacionais
│   ├── items/                Coleção de Items
│   ├── journal/              Coleção de JournalEntries
│   ├── macros/               Coleção de Macros
│   ├── messages/             Coleção de ChatMessages
│   ├── playlists/            Coleção de Playlists
│   ├── scenes/               Coleção de Scenes
│   ├── settings/             World settings
│   ├── tables/               Coleção de RollTables
│   └── users/                Usuários do mundo
├── packs/                    Compendiums do mundo (também LevelDB)
└── <assets>/                 Assets carregados pelo GM (imagens, áudios, etc.)
```

**Nota importante:** Em versões anteriores ao Foundry v11, cada coleção era um arquivo NeDB com extensão `.db` (ex.: `actors.db`), contendo um documento JSON por linha. A partir do v11, cada coleção é uma **pasta LevelDB** contendo múltiplos arquivos binários (SSTables + arquivos de suporte). O banco é incompatível com acesso direto fora da API do LevelDB — qualquer modificação manual resulta em corrupção.

### 1.3 O Arquivo `world.json`

O `world.json` é o manifesto do mundo e implementa a interface `WorldManifestData`. Campos obrigatórios:

| Campo           | Tipo      | Descrição                                     |
| --------------- | --------- | --------------------------------------------- |
| `id`            | string    | Identificador único (kebab-case, sem espaços) |
| `title`         | string    | Nome legível do mundo                         |
| `type`          | `"world"` | Constante que identifica o tipo de pacote     |
| `coreVersion`   | string    | Versão do core Foundry na última abertura     |
| `system`        | string    | ID do game system (ex.: `"pf2e"`)             |
| `systemVersion` | string    | Versão do sistema na última abertura          |
| `version`       | string    | Versão do mundo (dot-separated)               |

Campos opcionais relevantes:

| Campo           | Tipo   | Descrição                          |
| --------------- | ------ | ---------------------------------- |
| `authors`       | array  | Co-autores com nomes               |
| `description`   | string | Descrição em HTML                  |
| `packs`         | array  | Compendiums do próprio mundo       |
| `packFolders`   | array  | Organização dos compendiums (v11+) |
| `nextSession`   | string | ISO datetime para próxima sessão   |
| `flags`         | object | Dados customizados por namespace   |
| `relationships` | object | Dependências de módulos/sistemas   |

### 1.4 LevelDB — Formato Binário e Sublevels

A partir do Foundry v11, o armazenamento usa **ClassicLevel** (wrapper Node.js para LevelDB). Características técnicas:

- Dados armazenados em SSTables (Sorted String Tables), formato binário comprimido — **não legível** fora da API
- O banco é **lockado**: apenas um processo pode escrever por vez. Tentativa de acesso simultâneo ou em network drives causa falha (`LEVEL_ITERATOR_NOT_OPEN`)
- Usa **sublevels** para documentos embedded: ao atualizar um `ActiveEffect` dentro de um `Actor`, apenas o registro do efeito é reescrito, não o ator inteiro — melhoria de performance em relação ao NeDB
- Cada coleção de documentos primários (`actors`, `scenes`, etc.) é um sublevel separado dentro do banco principal do mundo

**Para o Fusion:** O Fusion não deve tentar ler bancos LevelDB de mundos Foundry ativos. O pipeline de importação correto é: (a) extrair via `foundryvtt-cli` quando o mundo estiver fechado, ou (b) usar a funcionalidade de exportação de JSON/Adventure nativa do Foundry com o mundo aberto.

---

## 2. Extração via foundryvtt-cli

### 2.1 O que é o foundryvtt-cli

O `foundryvtt-cli` é a **CLI oficial** publicada pela Foundry Gaming LLC em `https://github.com/foundryvtt/foundryvtt-cli`. É a ferramenta canônica para converter bancos LevelDB em arquivos JSON/YAML legíveis, e vice-versa. Instalação via npm:

```bash
npm install -g @foundryvtt/foundryvtt-cli
```

### 2.2 Comandos Principais

**Unpack (extração LevelDB → JSON/YAML):**

```bash
# Descompacta um compendium pack para a pasta de saída
fvtt package unpack "nome-do-pack" --out ./extracted/

# Com estrutura de pastas espelhando a árvore de Folders do Foundry
fvtt package unpack "nome-do-pack" --out ./extracted/ --folders

# Expandir Adventure documents para arquivos individuais por tipo
fvtt package unpack "nome-do-pack" --out ./extracted/ --expandAdventures

# Processar subdiretórios recursivamente
fvtt package unpack "nome-do-pack" --out ./extracted/ --recursive

# Omitir campos voláteis (timestamps, modification metadata)
fvtt package unpack "nome-do-pack" --out ./extracted/ --omitVolatile
```

**Pack (JSON/YAML → LevelDB):**

```bash
fvtt package pack "nome-do-pack" --in ./extracted/ --out ./packs/
```

### 2.3 Arquivos Gerados pelo Unpack

Cada documento primário gera um arquivo separado, com nome derivado do nome e `_id` do documento:

```
My_Item_Name_hPLXDSGyHzlupBS2.json
```

Quando `--folders` é usado, os `Folder` documents são escritos em seus diretórios correspondentes como `_Folder.json` (ou `_Folder.yml`). Exemplo de estrutura extraída:

```
extracted/
├── _Folder.json              Pasta raiz
├── Bestiary/
│   ├── _Folder.json
│   ├── Goblin_Warrior_abc123.json
│   └── Dragon_Red_xyz789.json
└── Spells/
    ├── Fireball_def456.json
    └── Magic_Missile_ghi012.json
```

### 2.4 Compatibilidade com Mundos (não apenas compendiums)

O `foundryvtt-cli` foi projetado primariamente para **compendium packs** (diretório `packs/` de um módulo ou sistema). Para **world data** (diretório `data/` do mundo), a CLI pode operar com as mesmas coleções LevelDB, mas a documentação não cobre esse caso explicitamente. Na prática, o pipeline funciona porque o formato LevelDB é o mesmo — o usuário aponta `--in` para o diretório de uma coleção do mundo (ex.: `data/worlds/meu-mundo/data/actors/`) e a CLI extrai os JSON.

**Limitação conhecida:** Para mundos grandes com muitos documentos embedded profundamente aninhados (ex.: tokens com ActorDeltas em cenas com muitos objetos), o processo pode ser lento e os arquivos JSON resultantes são grandes.

### 2.5 Transformação Durante Extração

A CLI suporta um `transformSerialized` hook (adicionado no v3.0.3) que permite modificar o conteúdo serializado antes de escrita em disco. Útil para filtrar campos desnecessários, normalizar caminhos de assets, ou converter formatos durante a extração.

---

## 3. Mapeamento do Schema de Documents Foundry

### 3.1 Hierarquia de Documents

O Foundry define 34 tipos de documentos concretos (v14). Para import ao Fusion, os mais relevantes são:

**Documentos Primários (têm coleção própria no mundo):**

| Document       | Relevância para Import                         |
| -------------- | ---------------------------------------------- |
| `Actor`        | Personagens, NPCs, criaturas                   |
| `Item`         | Itens, feats, magias, equipamentos             |
| `Scene`        | Mapas com walls, lights, tokens, tiles         |
| `JournalEntry` | Notas, handouts, lore                          |
| `Macro`        | Comandos e automações                          |
| `RollTable`    | Tabelas de resultado aleatório                 |
| `Playlist`     | Trilha sonora                                  |
| `Folder`       | Organização hierárquica                        |
| `Adventure`    | Container com múltiplos documentos empacotados |

**Documentos Embedded (vivem dentro de um pai):**

| Document Embedded  | Pai         |
| ------------------ | ----------- |
| `ActiveEffect`     | Actor, Item |
| `Item` (owned)     | Actor       |
| `TokenDocument`    | Scene       |
| `AmbientLight`     | Scene       |
| `AmbientSound`     | Scene       |
| `MeasuredTemplate` | Scene       |
| `Note`             | Scene       |
| `Region`           | Scene       |
| `Tile`             | Scene       |
| `Wall`             | Scene       |
| `Drawing`          | Scene       |

### 3.2 Campos Comuns a Todos os Documents

Todo documento Foundry compartilha estes campos independente do tipo:

| Campo       | Tipo                     | Notas                                                                                      |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `_id`       | string (16 chars base62) | Identificador único imutável; gerado uma vez                                               |
| `name`      | string                   | Nome legível                                                                               |
| `type`      | string                   | Subtipo dentro do document type                                                            |
| `img`       | string (path)            | Caminho para imagem/ícone                                                                  |
| `flags`     | object                   | Dados arbitrários por namespace (`flags.<namespace>.<key>`)                                |
| `folder`    | string \| null           | `_id` da Folder pai                                                                        |
| `sort`      | integer                  | Ordem de exibição                                                                          |
| `ownership` | object                   | Permissões por `userId` → nível                                                            |
| `_stats`    | object                   | Metadados: `coreVersion`, `systemVersion`, `createdTime`, `modifiedTime`, `lastModifiedBy` |

### 3.3 O Campo `system`

O campo `system` é um `TypeDataField` que contém todos os dados específicos do sistema de jogo. Ele é validado contra um `TypeDataModel` definido pelo sistema. Seu conteúdo varia completamente entre sistemas (PF2e, D&D5e, SF2e, etc.) e entre subtipos do documento (um `Actor` de tipo `"character"` tem `system` diferente de um `Actor` de tipo `"npc"`).

**Estratégia para o Fusion:** O mapeador de import deve tratar `system` como um bloco opaco a ser convertido para o schema equivalente do Fusion. Para PF2e, o TypeScript schema está disponível no repositório open-source `foundryvtt/pf2e` (Apache-2.0), que pode ser estudado e citado.

### 3.4 O Campo `flags`

`flags` segue a convenção `flags.<namespace>.<chave>`. Por exemplo:

- `flags.core.*` — dados internos do Foundry core
- `flags.pf2e.*` — dados do sistema PF2e
- `flags.my-module.*` — dados de um módulo específico

No contexto de import, o Fusion deve:

1. **Ignorar** flags de módulos específicos (ex.: `flags.midi-qol`, `flags.tidy5e-sheet`) que não têm equivalente
2. **Mapear** flags com semântica universal (ex.: `flags.core.initiativeBonus`) se relevante
3. **Preservar** flags em um campo genérico de metadados para não perder dados do usuário

### 3.5 Embedded Documents: Profundidade e Encoding

A hierarquia de embedding pode ser profunda. O exemplo mais extremo no Foundry:

```
Scene
└── TokenDocument (canvas token)
    └── ActorDelta (override sobre um Actor)
        ├── Item (owned item do token)
        │   └── ActiveEffect (efeito do item)
        └── ActiveEffect (efeito direto no token)
```

No banco LevelDB, graças ao uso de sublevels, cada nível é armazenado separadamente. Na extração JSON, os embedded documents são nested inline no JSON do pai.

---

## 4. PF2e — Estrutura do Campo `system` e ETL para o Fusion

### 4.1 Schema Top-Level de um Item PF2e

Todo item no compendium PF2e segue este schema de alto nível:

```json
{
  "_id": "PodajLVxqYSAqVox",
  "name": "Natural Ambition",
  "type": "feat",
  "img": "icons/sundries/books/book-red-exclamation.webp",
  "system": {
    "publication": {
      "license": "ORC",
      "remaster": true,
      "title": "Pathfinder Player Core"
    },
    "rules": [ ... ],
    "traits": { ... },
    "description": { "value": "<p>...</p>" },
    "level": { "value": 1 },
    "actionType": { "value": "passive" },
    "category": "class"
  },
  "folder": "hFVleadZ20Wc5Hkc"
}
```

### 4.2 Campo `publication` — Bloco de Licença

Cada entrada do compendium PF2e contém um bloco `system.publication` com:

| Campo      | Valores            | Significado                                            |
| ---------- | ------------------ | ------------------------------------------------------ |
| `license`  | `"ORC"` ou `"OGL"` | Licença sob a qual o conteúdo mecânico foi publicado   |
| `remaster` | `true` ou `false`  | Se é conteúdo do Remaster (Player Core, GM Core, etc.) |
| `title`    | string             | Nome exato do livro fonte                              |

**Para o pipeline ETL do Fusion:** Este bloco deve ser preservado. Ele é essencial para determinar quais itens podem ser incluídos nos compendiums abertos do Fusion e sob qual licença.

### 4.3 Campo `rules` — Rule Elements

`system.rules` é um array de objetos JSON. Cada objeto é um **Rule Element** — instrução executável que modifica a ficha de personagem em runtime. Exemplos:

```json
"rules": [
  { "key": "FlatModifier", "selector": "attack", "value": 2 },
  { "key": "GrantItem", "uuid": "Compendium.pf2e.feats-srd.Item.abc123" },
  { "key": "ChoiceSet", "choices": ["fire", "cold", "electricity"] }
]
```

O Fusion precisará de um motor equivalente de Rule Elements para que o conteúdo PF2e importado funcione corretamente. A lista completa de Rule Elements está documentada na wiki do repositório `foundryvtt/pf2e`.

### 4.4 Pipeline ETL LevelDB → SQLite (ou banco do Fusion)

O pipeline de importação de compendiums PF2e recomendado para o Fusion:

```
Repositório pf2e (GitHub)
  └── packs/ (pastas LevelDB)
      │
      ↓ foundryvtt-cli unpack
      │
      ├── *.json (um arquivo por documento)
      │
      ↓ ETL Script (Node.js/Python)
      │  - Normalizar paths de imagens
      │  - Mapear campos Foundry → schema Fusion
      │  - Extrair bloco publication para licensing table
      │  - Converter Rule Elements para formato Fusion
      │  - Resolver referências por UUID
      │
      ↓ Banco de dados do Fusion (ex.: SQLite ou DuckDB)
```

Este pipeline é técnica e legalmente viável porque:

1. O repositório `foundryvtt/pf2e` é open-source (Apache-2.0)
2. O conteúdo mecânico dos compendiums está sob ORC/OGL
3. O `foundryvtt-cli` é open-source (MIT) e pode ser usado em pipelines de build

---

## 5. Import de Cenas: Mapas, Walls, Lights e Assets

### 5.1 Estrutura do Document `Scene`

Uma Scene no Foundry é o container de todos os elementos visuais do mapa. O schema `SceneData` (v13/v14) inclui:

**Campos de configuração:**

| Campo                            | Tipo    | Descrição                        |
| -------------------------------- | ------- | -------------------------------- |
| `_id`, `name`, `flags`, `_stats` | comuns  | Campos universais                |
| `backgroundColor`                | string  | Cor de fundo do canvas           |
| `width`, `height`                | number  | Dimensões do canvas em pixels    |
| `padding`                        | number  | Espaço de buffer proporcional    |
| `thumb`                          | string  | Thumbnail em baixa resolução     |
| `active`                         | boolean | Se é a cena ativa                |
| `navigation`                     | boolean | Se aparece na barra de navegação |

**Camada de imagem:**

| Campo                 | Tipo          | Descrição                                  |
| --------------------- | ------------- | ------------------------------------------ |
| `background`          | TextureData   | Imagem de fundo (caminho + transformações) |
| `foreground`          | string (path) | Imagem de sobreposição (acima dos tokens)  |
| `foregroundElevation` | number        | Elevação da camada foreground              |

**Grid:**

| Campo  | Tipo     | Descrição                                      |
| ------ | -------- | ---------------------------------------------- |
| `grid` | GridData | Tipo (square/hex), tamanho em pixels, unidades |

**Visão e iluminação:**

| Campo            | Tipo                 | Descrição                                               |
| ---------------- | -------------------- | ------------------------------------------------------- |
| `tokenVision`    | boolean              | Se tokens precisam de visão para ver                    |
| `fogExploration` | boolean              | Se fog of war é rastreada                               |
| `darkness`       | number               | Nível de escuridão (0 = luz plena, 1 = escuridão total) |
| `environment`    | SceneEnvironmentData | Efeitos ambientais aplicados                            |

**Coleções embedded:**

| Campo       | Tipo                   | Descrição                           |
| ----------- | ---------------------- | ----------------------------------- |
| `walls`     | WallData[]             | Segmentos de parede/porta           |
| `lights`    | AmbientLightData[]     | Fontes de luz ambientes             |
| `tokens`    | TokenDocumentData[]    | Tokens de ator na cena              |
| `tiles`     | TileData[]             | Tiles (imagens não-background)      |
| `drawings`  | DrawingData[]          | Desenhos do GM                      |
| `notes`     | NoteData[]             | Pins de notas                       |
| `sounds`    | AmbientSoundData[]     | Fontes de som ambientes             |
| `templates` | MeasuredTemplateData[] | Templates de medição                |
| `regions`   | RegionData[]           | Regiões (novo em v12) com behaviors |

### 5.2 Schema `WallData` — Paredes e Portas

O `WallData` é a estrutura mais crítica para importação de cenas com iluminação dinâmica:

| Campo       | Tipo              | Descrição                                                         |
| ----------- | ----------------- | ----------------------------------------------------------------- |
| `_id`       | string            | ID único do wall                                                  |
| `c`         | number[4]         | Coordenadas `[x0, y0, x1, y1]` em pixels no canvas                |
| `move`      | number (enum)     | Restrição de movimento: 0=nenhum, 1=normal                        |
| `sight`     | number (enum)     | Restrição de visão: 0=nenhum, 1=normal, 2=limitado, 3=proximidade |
| `light`     | number (enum)     | Restrição de luz: 0=nenhum, 1=normal, 2=limitado, 3=proximidade   |
| `sound`     | number (enum)     | Restrição de som: 0=nenhum, 1=normal, 2=limitado, 3=proximidade   |
| `dir`       | number            | Direção do efeito (0=ambos os lados, 1=esquerda, 2=direita)       |
| `door`      | number            | Tipo de porta: 0=nenhuma, 1=porta normal, 2=porta secreta         |
| `ds`        | number            | Estado da porta: 0=fechada, 1=aberta, 2=travada                   |
| `doorSound` | string            | ID do sound profile para a porta                                  |
| `threshold` | WallThresholdData | Configuração de threshold para walls de proximidade               |
| `flags`     | object            | Flags por namespace                                               |

**Para importação de UVTT/mapas externos:** O mapeamento mais crítico é converter os segmentos de `line_of_sight` do formato UVTT para o array `c` do `WallData`. As coordenadas no UVTT são em unidades de "squares" (decimais), enquanto o Foundry usa pixels — a conversão requer multiplicar por `grid.size` (pixels por grid).

### 5.3 Assets e Caminhos de Arquivo

Dentro de uma Scene (e de outros documents), caminhos de arquivo como `background.src` são armazenados **relativos à raiz do User Data Directory**. Exemplos:

```
worlds/meu-mundo/scenes/dungeon-map.webp
modules/module-name/art/portrait.webp
```

**Implicação para import no Fusion:** O importador deve:

1. Detectar se o arquivo referenciado existe no sistema de arquivos do usuário
2. Copiar (ou criar link simbólico) para o diretório de assets do Fusion
3. Atualizar o path no documento importado para o novo local
4. Lidar com imagens embarcadas em base64 (comum no formato UVTT)

---

## 6. Adventure Documents — Importação de Aventuras Completas

### 6.1 O Que é um Adventure Document

Introduzido no Foundry v10, o `Adventure` document é um **container** que agrupa múltiplos documentos de diferentes tipos em um único documento importável. Um Adventure pode conter:

- Actors
- Items
- Scenes
- Roll Tables
- Journal Entries
- Cards
- Playlists

Os documentos dentro de um Adventure **mantêm seus `_id` originais**, garantindo que ao reimportar uma aventura, os documentos existentes sejam sobrescritos em vez de duplicados.

### 6.2 Empacotamento e Distribuição

Adventures são sempre armazenados dentro de um **Compendium Pack** (de um módulo ou do próprio mundo). O formato de distribuição é um compendium LevelDB com documentos do tipo `Adventure`.

Ao usar `foundryvtt-cli unpack` com `--expandAdventures`, cada Adventure é desempacotado em subpastas com os documentos individuais organizados por tipo:

```
extracted-adventure/
├── _Adventure.json            Metadados do Adventure
├── actors/
│   ├── Goblin_King_abc123.json
│   └── ...
├── scenes/
│   ├── Throne_Room_xyz789.json
│   └── ...
└── journal/
    └── ...
```

### 6.3 Limitação Crítica: Assets

Os assets de mídia (imagens de fundo de cena, portraits, tiles) **não são incluídos** no Adventure document. Eles ficam referenciados por caminho no sistema de arquivos. Para um import completo para o Fusion, é necessário:

1. Identificar todos os caminhos de assets referenciados nos documents
2. Copiar os assets para o storage do Fusion
3. Reescrever os paths nos documentos

Módulos da comunidade como `fvtt-adventure-bundler` lidam com esse problema empacotando assets junto com o Adventure em um ZIP.

---

## 7. Import de Roll20

### 7.1 Processo de Exportação do Roll20

O Roll20 não oferece exportação nativa de campanha completa pelo aplicativo. A exportação requer a extensão de browser **R20Exporter** (repositório: `github.com/ooshhub/r20Exporter`). O processo:

1. GM instala R20Exporter como extensão do Chrome/Firefox
2. Com a campanha aberta, aciona a exportação
3. R20Exporter exporta:
   - Personagens (characters) com seus atributos
   - Tokens com dados padrão e GMNotes
   - Handouts
   - Imagens e áudios (opcionalmente como ZIP separado)
   - Campaign JSON linkando assets para caminhos locais

### 7.2 Estrutura do Export Roll20

O export produz um arquivo `campaign.json` (ou ZIP contendo-o) com estrutura aproximada:

```json
{
  "schema_version": 2,
  "characters": [
    {
      "id": "...",
      "name": "Nome do Personagem",
      "attributes": [
        { "id": "...", "name": "strength", "current": 16, "max": 16 }
      ],
      "abilities": [
        { "id": "...", "name": "Ataque Corpo a Corpo", "action": "..." }
      ],
      "bio": "...",
      "defaulttoken": "{ base64 ou JSON do token }",
      "gmnotes": "..."
    }
  ],
  "handouts": [ ... ],
  "pages": [
    {
      "id": "...",
      "name": "Mapa do Calabouço",
      "graphics": [ ... ],
      "paths": [ ... ]
    }
  ]
}
```

**Limitações importantes:**

- O schema varia conforme a versão da sheet usada (OGL 5e, Shaped, etc.)
- NPCs e personagens de sistemas não-D&D5e terão estrutura completamente diferente
- Tokens em páginas de mapas têm posições em pixels mas sem walls/lights (as Dynamic Lighting do Roll20 são um sistema proprietário não exportado via R20Exporter)
- Macros Roll20 usam sintaxe específica incompatível com outros VTTs

### 7.3 Conversão Roll20 → Foundry (R20Converter)

A ferramenta **R20Converter** (Python, open-source: `github.com/kakaroto/R20Converter`) converte o export do R20Exporter em um mundo Foundry VTT. Funciona **apenas** com campanhas D&D 5e (OGL sheet ou Shaped sheet). O processo:

1. Lê o ZIP/JSON do R20Exporter
2. Mapeia personagens para Actors Foundry do tipo apropriado
3. Converte handouts para JournalEntries
4. Cria tokens nas cenas correspondentes

**Para o Fusion:** Não é necessário suportar o R20Converter diretamente. O import de Roll20 pode ser feito em duas etapas: (a) converter Roll20 → Foundry via R20Converter, e (b) importar o mundo Foundry resultante para o Fusion via o pipeline LevelDB → JSON. Esta abordagem reutiliza trabalho existente em vez de reimplementar o mapeamento Roll20.

### 7.4 Ausência de Walls/Lights no Export Roll20

O Roll20 usa um sistema proprietário de **Dynamic Lighting** que não é exportado por nenhuma ferramenta de comunidade. Isso significa que mapas migrados do Roll20 chegam ao Fusion sem walls, sem fog of war e sem fontes de luz. O usuário precisaria redesenhar as walls manualmente, ou o mapa original do cartógrafo (se disponível em formato UVTT) pode ser usado para obter as walls.

---

## 8. Universal VTT (UVTT / DD2VTT) — Padrão de Mercado para Mapas

### 8.1 O Que é o Formato Universal VTT

O **Universal VTT** (UVTT) é um formato de arquivo criado pela Megasploot (desenvolvedora do Wonderdraft e Dungeondraft) para exportar mapas de ferramentas de cartografia com seus metadados de VTT (walls, portas, fontes de luz). É o **padrão de facto** da indústria para interoperabilidade de mapas entre VTTs.

Extensões de arquivo:

- `.dd2vtt` — export nativo do Dungeondraft
- `.df2vtt` — export do Dungeonfog
- `.uvtt` — formato genérico (mesmo conteúdo)

**Todos os três formatos são JSON** com a mesma estrutura interna.

### 8.2 Schema JSON do Formato UVTT

```json
{
  "format": 0.3,
  "resolution": {
    "map_origin": { "x": 0, "y": 0 },
    "map_size": { "x": 32, "y": 22 },
    "pixels_per_grid": 140
  },
  "line_of_sight": [
    [
      { "x": 1.0, "y": 0.0 },
      { "x": 1.0, "y": 5.5 },
      { "x": 3.5, "y": 5.5 }
    ],
    [
      { "x": 8.0, "y": 0.0 },
      { "x": 8.0, "y": 8.0 }
    ]
  ],
  "objects_line_of_sight": [
    [
      { "x": 4.5, "y": 3.0 },
      { "x": 5.5, "y": 3.0 },
      { "x": 5.5, "y": 4.0 }
    ]
  ],
  "portals": [
    {
      "position": { "x": 3.5, "y": 2.0 },
      "bounds": [
        { "x": 3.0, "y": 2.0 },
        { "x": 4.0, "y": 2.0 }
      ],
      "rotation": 0.0,
      "closed": true,
      "freestanding": false
    }
  ],
  "environment": {
    "baked_lighting": false,
    "ambient_light": "#ffffff"
  },
  "lights": [
    {
      "position": { "x": 10.5, "y": 7.5 },
      "range": 4.0,
      "intensity": 1.0,
      "color": "#ff8800",
      "shadows": true
    }
  ],
  "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."
}
```

**Campos explicados:**

| Campo                        | Tipo               | Descrição                                                                                                                            |
| ---------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `format`                     | decimal            | Versão do schema UVTT                                                                                                                |
| `resolution.map_origin`      | `{x, y}`           | Origem do mapa (geralmente 0,0)                                                                                                      |
| `resolution.map_size`        | `{x, y}`           | Tamanho em **squares** (unidades de grid)                                                                                            |
| `resolution.pixels_per_grid` | integer            | Pixels por unidade de grid                                                                                                           |
| `line_of_sight`              | array de polylines | Cada polyline é um array de `{x,y}` em **squares**. Representa paredes e obstáculos de LOS                                           |
| `objects_line_of_sight`      | array de polylines | LOS para objetos/móveis (mesas, pilares) — separado das paredes estruturais                                                          |
| `portals`                    | array              | Portas e janelas. `position` e `bounds` em squares; `rotation` em radianos; `closed` boolean; `freestanding` = portal de área aberta |
| `environment.baked_lighting` | boolean            | Se o mapa tem iluminação pré-renderizada (baked)                                                                                     |
| `environment.ambient_light`  | hex color          | Cor da luz ambiente                                                                                                                  |
| `lights`                     | array              | Fontes de luz. `range` em squares; `intensity` 0-1; `color` hex; `shadows` boolean                                                   |
| `image`                      | string             | Base64 da imagem do mapa (PNG ou WEBP)                                                                                               |

### 8.3 Conversão UVTT → Scene Foundry

O mapeamento UVTT → Foundry para walls é:

```
UVTT line_of_sight[i] (polyline de N pontos)
→ N-1 WallData, cada um com:
  c: [
    ponto[j].x * pixels_per_grid,    // x0
    ponto[j].y * pixels_per_grid,    // y0
    ponto[j+1].x * pixels_per_grid,  // x1
    ponto[j+1].y * pixels_per_grid   // y1
  ]
  sight: 1, light: 1, move: 1
```

Para portals (portas):

```
UVTT portal
→ WallData com:
  c: [bounds[0].x * pxg, bounds[0].y * pxg, bounds[1].x * pxg, bounds[1].y * pxg]
  door: 1 (porta normal)
  ds: portal.closed ? 0 : 1
```

Para luzes:

```
UVTT lights[i]
→ AmbientLightData com:
  x: lights[i].position.x * pixels_per_grid
  y: lights[i].position.y * pixels_per_grid
  config.bright: lights[i].range * pixels_per_grid
  config.color: lights[i].color
```

### 8.4 Suporte a UVTT em VTTs Existentes

O formato é suportado nativamente por:

- Foundry VTT (via módulo Universal Importer)
- Roll20 (via script UniversalVTTImporter — requer Pro subscription)
- MapTool, Owlbear Rodeo, e outros VTTs menores

**Recomendação para o Fusion:** Implementar import nativo de UVTT é relativamente simples (parse de JSON + conversão de coordenadas) e cobre o caso de uso mais comum de cartógrafos digitais (Dungeondraft, Dungeonfog, Inkarnate). É provavelmente o import de mapa de maior ROI para implementar primeiro.

---

## 9. Limites Legais — O que pode ser importado

### 9.1 Dados do Mundo do Próprio Usuário

O EULA do Foundry VTT (Software License) estabelece explicitamente:

> _"You retain ownership to any personal data created within the software even if you relinquish or transfer your license."_

Isso significa que:

- Qualquer coisa criada pelo GM no mundo (notas, mapas desenhados à mão, descrições originais, personagens originais) pertence ao GM
- O GM tem todo o direito de exportar, migrar, importar em outro software e modificar esses dados
- O Fusion pode receber esses dados livremente

**Atenção:** O EULA cobre a **propriedade dos dados**, mas o GM continua responsável por respeitar direitos de terceiros. Se o GM copiou texto de um livro publicado para dentro do Foundry, o texto ainda está protegido por copyright — o EULA não muda isso.

### 9.2 Conteúdo Proprietário Paizo em Mundos Foundry

Muitos GMs compram módulos oficiais Paizo (ex.: Abomination Vaults, Kingmaker) no marketplace do Foundry. Esse conteúdo inclui:

- Texto de história, NPCs com stats e descrições de livros publicados
- Mapas criados por artistas contratados pela Paizo
- Tokens de personagem de artistas específicos

**Status legal para import no Fusion:**

- **Conteúdo mecânico (stats de NPCs, dados de itens) sob ORC/OGL:** Pode ser importado se o usuário cria sua própria implementação. A licença ORC cobre o conteúdo mecânico das regras.
- **Texto narrativo/lore:** Protegido por copyright Paizo. Pode ser armazenado localmente pelo usuário para uso pessoal, mas o Fusion não deve facilitar redistribuição.
- **Arte/imagens:** Cada asset tem sua própria licença (tipicamente All Rights Reserved para arte de módulos pagos). O Fusion pode armazenar e exibir para o usuário que comprou, mas não pode redistribuir.
- **Módulos comprados:** A licença Foundry permite ao usuário usar o conteúdo em seu jogo pessoal, mas a migração para outro VTT entra em zona cinzenta — tecnicamente é "uso pessoal" do conteúdo que o usuário pagou.

**Abordagem recomendada para o Fusion:** Fornecer ferramentas de import para que o usuário migre **seus próprios dados**. Documentar que o Fusion não redistribui conteúdo protegido e que o usuário é responsável por respeitar os termos das licenças dos módulos que usa. Não incluir conteúdo de módulos pagos nos compendiums default do Fusion.

### 9.3 Compendiums Open-Source PF2e/SF2e

Os compendiums do repositório `foundryvtt/pf2e` (GitHub, Apache-2.0) contêm conteúdo sob:

- **ORC License:** Conteúdo do Remaster (Player Core, GM Core, Monster Core, etc.)
- **OGL v1.0a:** Conteúdo pré-Remaster

**O que pode ser feito:**

- Extrair os JSON dos compendiums e incluí-los no Fusion como biblioteca de conteúdo
- Redistribuir o conteúdo mecânico (stats, mecânicas) sob ORC/OGL
- Referenciar as fontes corretamente (bloco `publication` em cada item)

**O que NÃO pode:**

- Incluir arte dos livros Paizo (cada imagem tem licença separada)
- Incluir flavor text que seja IP exclusivo da Golarion (ex.: nomes de locais, personagens de lore)

### 9.4 Código do Foundry VTT (Sistema de Jogo)

O Foundry VTT core é **software proprietário**. O código JavaScript/Electron do Foundry não pode ser copiado. Porém:

- A API pública (API docs em `foundryvtt.com/api/`) documenta comportamento — pode ser estudada e implementada de forma independente
- O sistema PF2e (`foundryvtt/pf2e`) é Apache-2.0 — pode ser estudado, citado em pequenos trechos, e reimplementado

---

## 10. Pipeline de Importação Recomendado para o Fusion

### 10.1 Módulo de Import: Casos de Uso Prioritários

Baseado na análise acima, os casos de uso de import ordenados por viabilidade e valor:

| Prioridade | Caso de Uso                                   | Complexidade                                  | Valor                     |
| ---------- | --------------------------------------------- | --------------------------------------------- | ------------------------- |
| 1          | Import UVTT (mapas com walls/lights)          | Baixa (parse JSON + conversão)                | Alto (cartógrafos)        |
| 2          | Import de compendiums PF2e open-source        | Média (ETL + mapeamento de schema)            | Alto (conteúdo base)      |
| 3          | Import de Adventure JSON exportado do Foundry | Média (mapeamento de schema Foundry → Fusion) | Alto (preservar mundos)   |
| 4          | Import de mundo Foundry completo (via CLI)    | Alta (ETL completo + assets)                  | Alto (migração total)     |
| 5          | Import de campanha Roll20 (via R20Exporter)   | Alta (mapeamento diferente)                   | Médio (usuários migrando) |

### 10.2 Arquitetura do Importador

```
[Input]                    [Parser]              [Mapper]                [Output]
────────────────────────────────────────────────────────────────────────────────
UVTT file (.dd2vtt)  ──→  UVTT Parser      ──→  UVTT→Scene Mapper  ──→  Scene Fusion
Foundry World JSON   ──→  FVTT JSON Parser ──→  FVTT→Fusion Mapper ──→  World Fusion
PF2e Pack JSON       ──→  PF2e Pack Parser ──→  PF2e→Fusion Mapper ──→  Compendium Fusion
Roll20 JSON          ──→  R20 Parser       ──→  R20→Fusion Mapper  ──→  World Fusion
```

### 10.3 Considerações de Implementação

**Resolução de assets:**

- Manter um mapa `{ original_path → fusion_path }` durante o import
- Verificar se assets existem no filesystem local antes de copiar
- Para assets em base64 (UVTT), extrair e salvar como arquivo

**Resolução de referências por UUID:**

- No Foundry, documentos se referenciam por UUID: `Compendium.pf2e.feats-srd.Item.abc123`
- No import, manter um mapa de UUIDs Foundry → IDs Fusion
- Resolver referências dentro de Rule Elements e em links de JournalEntries

**Migração incremental:**

- Suportar re-import: se um documento com o mesmo `_id` Foundry já existe no Fusion, oferecer opção de sobrescrever ou duplicar
- Para mundos grandes, processar em batches para não travar a UI

**Validação pós-import:**

- Verificar que todos os assets referenciados existem
- Verificar que todas as referências UUID foram resolvidas
- Reportar ao usuário quais elementos não puderam ser mapeados (ex.: Rule Elements sem equivalente)

---

## 11. Gaps e Open Questions

1. **Profundidade exata das coleções de mundo:** A documentação pública não confirma os nomes exatos de todas as subpastas LevelDB em `data/worlds/<id>/data/`. A lista foi inferida a partir de nomes de coleções na API. Confirmação requer inspecionar um mundo real com o Foundry fechado.

2. **foundryvtt-cli com world data:** A CLI foi projetada para compendium packs. O suporte a world collections (`data/actors/`, etc.) não está documentado explicitamente — precisa ser testado.

3. **Formato de `ActorDelta` em tokens sintéticos:** Quando um token em cena tem overrides sobre o Actor base (ActorDelta), a estrutura JSON da cena pode ser complexa. Mapeamento para o Fusion precisa de estudo mais aprofundado.

4. **Versioning e migração de schema:** O Foundry tem um sistema de migration (`_stats.systemVersion`) para atualizar documentos antigos. No Fusion, decidir se imports de mundos antigos passam por um processo de migration ou se o importador normaliza tudo para o schema atual.

5. **Roll20 Dynamic Lighting:** Nenhuma ferramenta disponível publicamente exporta as walls de Dynamic Lighting do Roll20. GMs migrando do Roll20 precisam redesenhar manualmente ou usar o mapa original com um arquivo UVTT.

6. **Licença de arte em módulos pagos:** A zona cinzenta legal em torno de "o usuário comprou o módulo e quer migrar para outro VTT" não foi resolvida pelo setor. O Fusion deve se proteger documentando que é responsabilidade do usuário.

7. **Tamanho do compendium PF2e:** O repositório PF2e (~137 pastas de packs) é volumoso. Decidir se o Fusion distribui o conteúdo pré-processado como parte do instalador ou se o usuário roda o pipeline ETL localmente.

8. **Formato de Scenes com Regiões (v12+):** O tipo `Region` com `RegionBehavior` embedded é novo a partir do Foundry v12 e não tem equivalente estabelecido em outros VTTs. Definir se o Fusion implementa Regions e como mapeá-las no import.

9. **Compatibilidade UVTT com Arkenforge e outras ferramentas:** O UVTT foi expandido com campos proprietários por algumas ferramentas (ex.: `software`, `creator` adicionados pela Arkenforge). O parser do Fusion deve ser tolerante a campos desconhecidos.

10. **Import de playlists e áudio:** Caminhos de arquivos de áudio seguem a mesma lógica de assets, mas as playlists do Foundry têm estrutura própria de tracks, volume, modo de reprodução. Mapear para o modelo de áudio do Fusion.

---

## 12. Fontes

- [GitHub — foundryvtt/foundryvtt-cli (MIT)](https://github.com/foundryvtt/foundryvtt-cli)
- [foundryvtt-cli CHANGELOG](https://github.com/foundryvtt/foundryvtt-cli/blob/main/CHANGELOG.md)
- [Foundry VTT — Version 11 Content Packaging Changes (LevelDB)](https://foundryvtt.com/article/v11-leveldb-packs/)
- [Foundry VTT — Managing User Data](https://foundryvtt.com/article/user-data/)
- [Foundry VTT — User Data Backup](https://foundryvtt.com/article/user-data-backup/)
- [Foundry VTT — API Documentation v14](https://foundryvtt.com/api/)
- [Foundry VTT — Actor API v14](https://foundryvtt.com/api/classes/foundry.documents.Actor.html)
- [Foundry VTT — Item API v14](https://foundryvtt.com/api/classes/foundry.documents.Item.html)
- [Foundry VTT — SceneData Interface v13](https://foundryvtt.com/api/interfaces/foundry.documents.types.SceneData.html)
- [Foundry VTT — WallData Interface v13](https://foundryvtt.com/api/interfaces/foundry.documents.types.WallData.html)
- [Foundry VTT — WorldManifestData v14](https://foundryvtt.com/api/v14/interfaces/foundry.packages.types.WorldManifestData.html)
- [Foundry VTT — Adventure Documents](https://foundryvtt.com/article/adventure/)
- [Foundry VTT — Software License (EULA)](https://foundryvtt.com/article/license/)
- [Foundry VTT — Licensing Guide para Packages](https://foundryvtt.com/article/licensing-guide/)
- [Foundry VTT — Walls (artigo oficial)](https://foundryvtt.com/article/walls/)
- [Foundry VTT — Scenes (artigo oficial)](https://foundryvtt.com/article/scenes/)
- [Foundry VTT Community Wiki — Document](https://foundryvtt.wiki/en/development/api/document)
- [GitHub — foundryvtt/foundryvtt (issue #5065 — migração NeDB → LevelDB)](https://github.com/foundryvtt/foundryvtt/issues/5065)
- [GitHub — foundryvtt/foundryvtt (issue #9766 — actors database)](https://github.com/foundryvtt/foundryvtt/issues/9766)
- [GitHub — foundryvtt/pf2e (sistema open-source Apache-2.0)](https://github.com/foundryvtt/pf2e)
- [PF2e Wiki — Creating a PF2e Content Module](https://github.com/foundryvtt/pf2e/wiki/Creating-a-PF2e-Content-Module)
- [PF2e Docs — Adding Compendium Content](https://mintlify.wiki/foundryvtt/pf2e/guides/adding-compendium-content)
- [Arkenforge — Universal VTT Files (formato UVTT)](https://arkenforge.com/universal-vtt-files/)
- [Dungeondraft Encyclopaedia — Universal VTT export](https://dungeondraft-encyclopaedia.gitbook.io/guide/final-steps/exporting-your-map/universal-vtt)
- [Roll20 — UniversalVTTImporter Script](https://app.roll20.net/forum/post/8824428/script-universalvttimporter--import-dd2vtt-files-to-create-dynamic-lighting-lines-and-lights/)
- [GitHub — kakaroto/R20Converter (Roll20 → Foundry)](https://github.com/kakaroto/R20Converter)
- [GitHub — ooshhub/r20Exporter (exportador Roll20)](https://github.com/ooshhub/r20Exporter)
- [GitHub — nathan-sain/foundry-world-tools (tools para worlds)](https://github.com/nathan-sain/foundry-world-tools)
- [GitHub — bytewright/FoundryVtt-LevelDB-Creator](https://github.com/bytewright/FoundryVtt-LevelDB-Creator)
- [The Forge Blog — Multiple Levels of Challenge (LevelDB in Foundry)](https://blog.forge-vtt.com/multiple-levels-of-challenge/)
- [DeepWiki — Foundry VTT Compendium Packs](https://deepwiki.com/foundryvtt/foundryvtt/4.3-compendium-packs)
- [DeepWiki — Foundry VTT Walls and Tiles](https://deepwiki.com/foundryvtt/foundryvtt/3.4-walls-and-tiles)
