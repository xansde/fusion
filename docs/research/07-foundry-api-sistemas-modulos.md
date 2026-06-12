# Foundry VTT — API de Game Systems e Modules

> Pesquisa para o projeto Fusion (VTT próprio, clean-room). Nenhum código proprietário do Foundry foi copiado. Comportamentos, conceitos e formatos são descritos com palavras próprias. Versão de referência principal: Foundry VTT v14 (2025-2026).

---

## 1. Anatomia de um Game System

### 1.1 Estrutura de Diretórios

Um game system reside em `{userData}/Data/systems/<id>/`. O nome da pasta deve coincidir exatamente com o campo `id` do manifest. A convenção recomendada é usar letras minúsculas separadas por hifens.

```
sistemas/
└── meu-sistema/
    ├── system.json       ← manifest obrigatório
    ├── template.json     ← legado (descontinuado no v14)
    ├── meu-sistema.mjs   ← entry point ES module
    ├── styles/
    │   └── meu-sistema.css
    ├── templates/
    │   └── actor-sheet.hbs
    ├── lang/
    │   └── en.json
    └── packs/
        └── monsters/     ← diretório LevelDB (desde v11)
```

### 1.2 system.json — Campos do Manifest

O `system.json` é o contrato entre o sistema e o Foundry. Abaixo todos os campos documentados na API oficial.

#### Campos Obrigatórios

| Campo         | Tipo   | Descrição                                                             |
| ------------- | ------ | --------------------------------------------------------------------- |
| `id`          | string | Identificador único em minúsculas; deve coincidir com o nome da pasta |
| `title`       | string | Nome legível exibido nos menus de criação de mundo                    |
| `description` | string | Texto de apresentação; aceita HTML                                    |
| `version`     | string | Versão do sistema (qualquer esquema: semver, data, etc.)              |

#### Campos de Código e Estilo

| Campo       | Tipo     | Descrição                                                        |
| ----------- | -------- | ---------------------------------------------------------------- |
| `esmodules` | string[] | Arquivos JS importados como ES6 modules (preferível a `scripts`) |
| `scripts`   | string[] | Arquivos JS tradicionais carregados via `<script>`               |
| `styles`    | string[] | Arquivos CSS aplicados ao cliente                                |

#### Compatibilidade e Autoria

| Campo                    | Tipo     | Descrição                                                  |
| ------------------------ | -------- | ---------------------------------------------------------- |
| `compatibility.minimum`  | string   | Versão mínima do Foundry suportada                         |
| `compatibility.verified` | string   | Versão testada e verificada                                |
| `compatibility.maximum`  | string   | Versão máxima (omitir permite execução em versões futuras) |
| `authors`                | object[] | Array com name, email, discord, url de cada autor          |
| `url`                    | string   | URL pública de documentação                                |
| `manifest`               | string   | URL raw do system.json para atualização automática         |
| `download`               | string   | URL do zip para instalação automática                      |

#### Conteúdo e Idiomas

| Campo         | Tipo     | Descrição                                          |
| ------------- | -------- | -------------------------------------------------- |
| `packs`       | object[] | Compendium packs (name, label, system, type, path) |
| `packFolders` | object[] | Organização hierárquica dos packs em pastas        |
| `languages`   | object[] | Arquivos de localização (lang, name, path)         |

#### Definição de Tipos e Mecânicas

| Campo                     | Tipo    | Descrição                                                                            |
| ------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `documentTypes`           | object  | Define subtipos de Actor/Item/etc. e seus schemas; **necessário para TypeDataModel** |
| `initiative`              | string  | Fórmula de dados padrão para ordem de turno no combate                               |
| `grid`                    | object  | Unidade de medida e distância das cenas (distance, units)                            |
| `primaryTokenAttribute`   | string  | Caminho do atributo exibido como barra primária no token                             |
| `secondaryTokenAttribute` | string  | Caminho do atributo exibido como barra secundária no token                           |
| `socket`                  | boolean | Ativa namespace dedicado no socket.io para o sistema                                 |

#### Exemplo de `documentTypes`

```json
"documentTypes": {
  "Actor": {
    "character": {},
    "npc": {},
    "vehicle": {}
  },
  "Item": {
    "weapon": {},
    "spell": {},
    "feat": {}
  }
}
```

Cada sub-objeto pode conter `htmlFields` (array de caminhos que precisam de sanitização HTML) e `filePathFields` (object com caminhos e categorias de mídia).

---

## 2. template.json Legado vs. DataModels

### 2.1 Abordagem Legada (template.json)

O arquivo `template.json` era o mecanismo original para declarar a estrutura de dados de Actors e Items. Definia campos diretamente como JSON com valores padrão:

```json
{
  "Actor": {
    "types": ["character", "npc"],
    "templates": {
      "base": {
        "hp": { "value": 10, "min": 0, "max": 10 }
      }
    },
    "character": { "templates": ["base"] },
    "npc": { "templates": ["base"] }
  }
}
```

**Status (2026):** O `template.json` entrou em período de depreciação formal no v14 (issue #13429). Os sistemas devem migrar para `TypeDataModel`. O suporte será removido em versão futura.

### 2.2 DataModel — Abordagem Moderna

O `TypeDataModel` é uma subclasse especializada de `DataModel` (introduzida no v10) que deve ser usada para dados específicos de subtipo de documento.

#### Vantagens sobre template.json

- Validação em tempo de execução (type coercion)
- Migrações declarativas (`migrateData()`)
- Métodos e lógica de negócio embutidos na classe
- `prepareDerivedData()` para calcular valores derivados
- Acesso ao documento pai via `this.parent`

#### Anatomia de um TypeDataModel

```javascript
// Exemplo simplificado — conceitual, não código proprietário
class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const { fields } = foundry.data;
    return {
      hp: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, min: 0 }),
      }),
      biography: new fields.HTMLField({ required: false, blank: true }),
      level: new fields.NumberField({ integer: true, min: 1, max: 20, initial: 1 }),
    };
  }

  prepareDerivedData() {
    // Lógica de cálculo de atributos derivados
  }

  static migrateData(source) {
    // Transformar dados legados antes da instanciação
    return super.migrateData(source);
  }
}
```

#### Tipos de DataField Disponíveis

| Tipo                | Uso                                                      |
| ------------------- | -------------------------------------------------------- |
| `StringField`       | Texto simples                                            |
| `NumberField`       | Números, suporta `min`, `max`, `integer`, `initial`      |
| `BooleanField`      | true/false                                               |
| `HTMLField`         | HTML com sanitização automática                          |
| `SchemaField`       | Objeto aninhado com sub-schema                           |
| `ArrayField`        | Coleção de valores                                       |
| `SetField`          | Conjunto sem duplicatas                                  |
| `ObjectField`       | Objeto livre sem schema definido                         |
| `FilePathField`     | Caminhos de mídia, com `categories` (IMAGE, VIDEO, etc.) |
| `DocumentUUIDField` | UUID de documento vinculado                              |
| `EmbeddedDataField` | DataModel aninhado                                       |

#### Registro dos DataModels

O registro ocorre dentro do hook `init`:

```javascript
Hooks.on("init", () => {
  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.dataModels.npc = NpcData;
  CONFIG.Item.dataModels.weapon = WeaponData;
});
```

---

## 3. Entry Point e Inicialização do Sistema

O arquivo principal (listado em `esmodules`) é responsável por toda a configuração do sistema durante a inicialização. A sequência de hooks de inicialização é:

1. **`init`** — primeiro hook chamado; registra DataModels, sheets, settings, keybindings, configura `CONFIG.*`
2. **`i18nInit`** — após strings de idioma serem carregadas
3. **`setup`** — após documentos prepararem seus dados pela primeira vez
4. **`ready`** — após tudo inicializado; acesso seguro a `game.actors`, `game.items`, etc.

### Exemplo de estrutura do entry point

```javascript
// Entry point conceitual
Hooks.on("init", async () => {
  // 1. Registrar DataModels
  CONFIG.Actor.dataModels.character = CharacterData;

  // 2. Registrar sheets por subtipo
  Actors.registerSheet("meu-sistema", MinhaActorSheet, {
    types: ["character"],
    makeDefault: true,
    label: "MEUSISTEMA.SheetLabels.Character"
  });

  // 3. Configurar atributos rastreáveis (barras de token)
  CONFIG.Actor.trackableAttributes = {
    character: { bar: [["hp"]], value: [["level"]] }
  };

  // 4. Pré-carregar templates Handlebars
  await preloadTemplates([
    "systems/meu-sistema/templates/actor-sheet.hbs"
  ]);

  // 5. Registrar settings
  game.settings.register("meu-sistema", "iniciativa", { ... });
});
```

---

## 4. Registro de Sheets (ActorSheet / ItemSheet)

### 4.1 Método de Registro

O registro de sheets usa `DocumentCollection.registerSheet()` (acessível via `Actors.registerSheet`, `Items.registerSheet`):

```javascript
Actors.registerSheet(namespace, SheetClass, {
  types: ["character", "npc"], // subtipos que essa sheet atende
  makeDefault: true, // sheet padrão para o(s) tipo(s)
  label: "MEUSISTEMA.SheetLabels.Actor",
});
```

- `namespace`: identificador do pacote (system id ou module id)
- `types`: omitir = sheet disponível para todos os subtipos
- `makeDefault`: `false` por padrão — a sheet aparece como opção mas não é a padrão

### 4.2 ApplicationV1 (legado) vs. ApplicationV2 (atual)

#### ApplicationV1 / FormApplication (legado)

O sistema de aplicações original usava classes como `ActorSheet extends FormApplication`. Renderização via Handlebars em `getData()`, com `activateListeners()` para eventos jQuery.

#### ApplicationV2 (moderno — v12+)

Introduzido no v12, tornou-se o padrão em v13 (todas as UIs do core convertidas).

**Características principais:**

- `static DEFAULT_OPTIONS` — configura window title, classes CSS, dimensões, etc.
- `static PARTS` — define as "partes" do HTML (cada parte é um template Handlebars separado)
- `_prepareContext(options)` — substitui `getData()`; retorna objeto de contexto para os templates
- `_preparePartContext(partId, context, options)` — contexto específico por parte
- Lifecycle: `_preRender → _renderHTML → _replaceHTML → _postRender → _onFirstRender → _onRender`
- `_onRender(context, options)` — pós-render; registrar listeners
- `_onClose(options)` — pós-fechamento

**Sistema de Actions:**

Elementos HTML com `data-action="nomeDaAcao"` disparam handlers registrados em `static DEFAULT_OPTIONS.actions`:

```javascript
static DEFAULT_OPTIONS = {
  actions: {
    deleteItem: MinhaSheet._onDeleteItem,
    rollDice: MinhaSheet._onRollDice
  }
};
```

**HandlebarsApplicationMixin:**

Mixin que adiciona suporte a Handlebars ao `ApplicationV2`. Necessário para usar templates `.hbs`:

```javascript
class MinhaActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static PARTS = {
    header: { template: "systems/x/templates/header.hbs" },
    body: { template: "systems/x/templates/body.hbs" },
  };
}
```

**ActorSheetV2 e ItemSheetV2:**

Subclasses de `DocumentSheetV2` específicas para Actors e Items. `ActorSheetV2` já inclui:

- Setup automático de drag & drop (elementos com `data-item-id`, `data-effect-id`)
- Verificações de permissão para drag
- Ordenação de items dentro do mesmo actor

#### Uso do EventEmitter em ApplicationV2

`ApplicationV2` herda de `EventEmitter`. Eventos emitidos: `"prerender"`, `"render"`, `"close"`, `"position"`. Registro via `addEventListener(type, listener)`.

---

## 5. Sistema de Hooks

### 5.1 API dos Hooks

```javascript
// Registrar handler permanente
const id = Hooks.on("hookName", (arg1, arg2) => { ... });

// Registrar handler de uso único
Hooks.once("hookName", callback);

// Remover handler
Hooks.off("hookName", id);  // por ID
Hooks.off("hookName", fn);  // por referência

// Disparar hook (cancelável — retorno false interrompe)
Hooks.call("hookName", ...args);

// Disparar hook (não cancelável — todos os handlers executam)
Hooks.callAll("hookName", ...args);
```

**Diferença crítica entre `call` e `callAll`:**

- `Hooks.call()` para a execução se qualquer handler retornar `false`
- `Hooks.callAll()` executa todos os handlers independentemente do retorno

### 5.2 Categorias de Hooks

#### Inicialização (sequência garantida, executam uma vez por sessão)

| Hook           | Momento                                        |
| -------------- | ---------------------------------------------- |
| `init`         | Primeira chamada; registrar configs do sistema |
| `i18nInit`     | Após carregamento das strings de idioma        |
| `setup`        | Após preparação inicial dos documentos         |
| `canvasConfig` | Configuração do canvas (se habilitado)         |
| `ready`        | Sistema pronto; dados de mundo disponíveis     |

#### CRUD de Documentos (substituem por tipo específico)

O padrão é `<pre><NomeDoc>` para hooks canceláveis e `<NomeDoc>` para hooks de notificação. Exemplos com `Actor`:

| Hook             | Cancelável? | Descrição                                             |
| ---------------- | ----------- | ----------------------------------------------------- |
| `preCreateActor` | Sim         | Antes da criação; permite modificar dados ou cancelar |
| `createActor`    | Não         | Após criação confirmada                               |
| `preUpdateActor` | Sim         | Antes de update; permite modificar diff ou cancelar   |
| `updateActor`    | Não         | Após update confirmado                                |
| `preDeleteActor` | Sim         | Antes de deleção; pode cancelar                       |
| `deleteActor`    | Não         | Após deleção                                          |

Outros tipos seguem o mesmo padrão: `Item`, `Scene`, `JournalEntry`, `Combat`, `Combatant`, etc.

Hooks genéricos também existem: `preCreateDocument`, `createDocument`, `preUpdateDocument`, `updateDocument`, `preDeleteDocument`, `deleteDocument`.

#### Hooks de Render

| Hook                    | Descrição                              |
| ----------------------- | -------------------------------------- |
| `renderApplicationV2`   | Ao renderizar qualquer app V2          |
| `preRenderApplication`  | Antes de renderizar app V2             |
| `renderChatMessageHTML` | Ao renderizar HTML de mensagem no chat |

O padrão `render<NomeApp>` (ex.: `renderActorSheet`) permite interceptar sheets específicas.

#### Hooks de Canvas

| Hook             | Descrição                              |
| ---------------- | -------------------------------------- |
| `canvasInit`     | Inicialização do canvas                |
| `canvasDraw`     | Desenho do canvas                      |
| `canvasReady`    | Canvas pronto para uso                 |
| `canvasPan`      | Quando o usuário movimenta a câmera    |
| `canvasTearDown` | Destruição do canvas (mudança de cena) |
| `dropCanvasData` | Dado arrastado sobre o canvas          |
| `drawLayer`      | Ao desenhar uma layer                  |

#### Hooks de Combate

| Hook               | Descrição                                  |
| ------------------ | ------------------------------------------ |
| `combatStart`      | Início do combate                          |
| `combatRound`      | Mudança de round                           |
| `combatTurn`       | Mudança de turno                           |
| `combatTurnChange` | Transição de turno (detalhes da transição) |

#### Outros Hooks Importantes

| Hook                   | Descrição                                      |
| ---------------------- | ---------------------------------------------- |
| `hotbarDrop`           | Item arrastado para a hotbar                   |
| `userConnected`        | Usuário conecta/desconecta                     |
| `chatMessage`          | Mensagem enviada no chat (pré-processamento)   |
| `pauseGame`            | Jogo pausado/retomado                          |
| `modifyTokenAttribute` | Atributo do token modificado (clique na barra) |
| `targetToken`          | Token alvo marcado/desmarcado                  |
| `dropCanvasData`       | Drop de dados no canvas                        |

---

## 6. Settings API

### 6.1 Registro de Settings

```javascript
game.settings.register(namespace, key, {
  name: "MEUSISTEMA.Settings.NomeDaSetting", // chave de i18n
  hint: "MEUSISTEMA.Settings.NomeDaSettingHint",
  type: Boolean, // ou Number, String, Array, ou uma DataField class
  scope: "world", // "world" | "client" | "user"
  config: true, // aparece na tela de configurações?
  default: false, // valor padrão
  requiresReload: false, // pede reload ao mudar?
  onChange: (value) => {
    // callback disparado ao mudar (em todos os clientes para world-scope)
    console.log("Setting changed:", value);
  },
  choices: {
    // opcional — cria dropdown
    option1: "MEUSISTEMA.Choice1",
    option2: "MEUSISTEMA.Choice2",
  },
});
```

### 6.2 Escopos

| Scope    | Armazenamento             | Quem pode modificar | Sincronização                   |
| -------- | ------------------------- | ------------------- | ------------------------------- |
| `world`  | Banco de dados do mundo   | GMs e Assistant GMs | Todos os clientes               |
| `user`   | Dado do usuário           | O próprio usuário   | Qualquer dispositivo do usuário |
| `client` | localStorage do navegador | Qualquer usuário    | Apenas o dispositivo local      |

**Nota:** O callback `onChange` dispara em todos os clientes para `world`, mas apenas localmente para `client`.

### 6.3 Get e Set

```javascript
// Ler
const valor = game.settings.get("meu-sistema", "minha-setting");

// Escrever
await game.settings.set("meu-sistema", "minha-setting", novoValor);
```

### 6.4 Menus de Configuração

Para settings complexas, é possível registrar sub-menus com formulário próprio:

```javascript
game.settings.registerMenu("meu-sistema", "config-avancada", {
  name: "Configurações Avançadas",
  label: "Abrir",
  icon: "fas fa-cog",
  type: MinhaConfigSheet, // ApplicationV2 subclass
  restricted: true, // apenas GMs
});
```

---

## 7. Keybindings API

```javascript
game.keybindings.register("meu-sistema", "rollInitiative", {
  name: "MEUSISTEMA.Keybindings.RollInitiative",
  hint: "MEUSISTEMA.Keybindings.RollInitiativeHint",
  editable: [{ key: "KeyI", modifiers: ["Control"] }],
  uneditable: [],            // bindings fixas que o usuário não pode alterar
  onDown: () => { ... },     // handler ao pressionar
  onUp: () => { ... },       // handler ao soltar
  repeat: false,             // ativar em keydown repetido?
  restricted: true,          // apenas GMs?
  precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  reservedModifiers: []
});
```

---

## 8. Internacionalização (i18n)

### 8.1 Declaração no Manifest

```json
"languages": [
  { "lang": "en", "name": "English", "path": "lang/en.json" },
  { "lang": "pt-BR", "name": "Português (Brasil)", "path": "lang/pt-BR.json" }
]
```

- `lang`: código ISO 639-1 (dois caracteres) ou ISO 639-2 em minúsculas
- `name`: nome legível do idioma
- `path`: caminho relativo à raiz do sistema

### 8.2 Estrutura do Arquivo de Idioma

Arquivos JSON planos ou hierárquicos. A comunidade recomenda namespacing pelo ID do sistema em maiúsculas:

```json
{
  "MEUSISTEMA.Title": "Meu RPG",
  "MEUSISTEMA.Actor.TypeCharacter": "Personagem",
  "MEUSISTEMA.Item.TypeWeapon": "Arma",
  "MEUSISTEMA.HP": "Pontos de Vida",
  "MEUSISTEMA.Errors.InvalidRoll": "Rolagem inválida: {reason}"
}
```

Suporte a hierarquia de objetos JSON e dot-notation; ambos são intercambiáveis.

### 8.3 Uso no Código e Templates

```javascript
// JavaScript
game.i18n.localize("MEUSISTEMA.Title");

// Com variáveis
game.i18n.format("MEUSISTEMA.Errors.InvalidRoll", { reason: "dado inválido" });
```

```handlebars
{{! Templates Handlebars }}
<h1>{{localize "MEUSISTEMA.Title"}}</h1>
```

**Ordem de carregamento:** Core → System → Modules ativos. Módulos podem sobrescrever strings de sistemas (usado para tradução por módulos de idioma).

---

## 9. Documentos, Subtipos e Flags

### 9.1 Hierarquia de Documentos

Os tipos de documento nativos do Foundry são:

| Documento        | Embedded Em      | Tem `system` field? | Suporta Subtipos? |
| ---------------- | ---------------- | ------------------- | ----------------- |
| Actor            | —                | Sim                 | Sim               |
| Item             | Actor (embedded) | Sim                 | Sim               |
| ActiveEffect     | Actor, Item      | Sim (v14+)          | Não               |
| JournalEntry     | —                | Não                 | Não               |
| JournalEntryPage | JournalEntry     | Sim                 | Sim               |
| Scene            | —                | Não                 | Não               |
| Combat           | —                | Não                 | Não               |
| Combatant        | Combat           | Não                 | Não               |
| ChatMessage      | —                | Sim                 | Sim               |
| Macro            | —                | Não                 | Não               |
| RollTable        | —                | Não                 | Não               |
| Playlist         | —                | Não                 | Não               |
| Cards            | —                | Não                 | Sim               |

### 9.2 CRUD de Documentos

```javascript
// Criar
const actor = await Actor.create({ name: "Herói", type: "character", system: { ... } });

// Atualizar (delta — apenas campos que mudaram)
await actor.update({ "system.hp.value": 15 });

// Deletar
await actor.delete();

// Batch
await Actor.createDocuments([...]);
await Actor.updateDocuments([{ _id: "...", name: "novo" }]);
await Actor.deleteDocuments(["id1", "id2"]);
```

### 9.3 Documentos Embedded

```javascript
// Criar items embutidos em actor
await actor.createEmbeddedDocuments("Item", [{ name: "Espada", type: "weapon" }]);

// Atualizar
await actor.updateEmbeddedDocuments("Item", [{ _id: "...", "system.damage": "1d8" }]);

// Deletar
await actor.deleteEmbeddedDocuments("Item", ["id1"]);
```

### 9.4 Flags — Armazenamento Arbitrário

Flags são pares chave-valor acessíveis em qualquer documento, com namespace obrigatório:

```javascript
// Escrever
await document.setFlag("meu-sistema", "customData", { foo: "bar" });
await document.setFlag("meu-modulo", "processed", true);

// Ler
const data = document.getFlag("meu-sistema", "customData");

// Remover
await document.unsetFlag("meu-sistema", "customData");
```

**Diferença entre `system` e `flags`:**

- `system`: dados estruturados definidos pelo sistema via TypeDataModel; validados e migrados
- `flags`: dados arbitrários sem schema definido; qualquer pacote pode escrever em seu namespace

### 9.5 Module Sub-Types (v11+)

A partir do v11, módulos também podem declarar subtipos de documentos em seu `module.json`:

```json
"documentTypes": {
  "JournalEntryPage": {
    "quest": {
      "htmlFields": ["description.long"],
      "filePathFields": { "img": ["IMAGE"] }
    }
  }
}
```

**Prefixação automática:** O subtipo `"quest"` em um módulo de ID `"quest-pages"` fica disponível como `"quest-pages.quest"`. O registro do DataModel deve usar o nome prefixado:

```javascript
CONFIG.JournalEntryPage.dataModels["quest-pages.quest"] = QuestModel;
```

**Limitações dos module sub-types:**

- Sistemas têm controle total sobre quais subtipos reconhecem; erros podem ocorrer se o sistema não suportar o tipo do módulo
- Ao desativar o módulo, documentos com esse subtipo ficam invisíveis (mas não são deletados)
- Reativar o módulo restaura a visibilidade

### 9.6 Modelo de Ownership/Permissão

```javascript
// Verificar permissão
document.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER);

// Obter nível de permissão do usuário atual
const level = document.getUserLevel(game.user);

// Níveis disponíveis em CONST.DOCUMENT_OWNERSHIP_LEVELS:
// NONE, LIMITED, OBSERVER, OWNER
```

---

## 10. Active Effects

### 10.1 Conceito

O sistema de Active Effects aplica modificadores temporários a Actors de forma não-destrutiva. O valor base é preservado; a mudança é aplicada em uma cópia para exibição.

### 10.2 Modos de Mudança

| Modo      | Constante | Comportamento                                             |
| --------- | --------- | --------------------------------------------------------- |
| Custom    | 0         | Lógica definida pelo sistema/módulo                       |
| Multiply  | 1         | Multiplica o atributo pelo valor fornecido                |
| Add       | 2         | Soma (ou subtrai com valor negativo)                      |
| Downgrade | 3         | Reduz apenas se o valor atual for maior que o fornecido   |
| Upgrade   | 4         | Aumenta apenas se o valor atual for menor que o fornecido |
| Override  | 5         | Substitui o atributo pelo valor fornecido                 |

### 10.3 Mudanças no v14

- `ActiveEffect#origin` agora é `DocumentUUIDField` (era `StringField`)
- `ActiveEffect#changes` migrou para `ActiveEffect#system#changes`
- Active Effects agora podem ser armazenados em compendiums
- Controle de expiração expandido (por evento, round, turno)

---

## 11. Compendium Packs

### 11.1 Declaração no Manifest

```json
"packs": [
  {
    "name": "monsters",
    "label": "Monstros",
    "system": "meu-sistema",
    "type": "Actor",
    "path": "packs/monsters"
  }
]
```

### 11.2 Formato de Armazenamento

**v10 e anterior:** arquivo único `.db` em formato NeDB (JSON line-delimited).

**v11+:** diretório LevelDB (pasta sem extensão). Internamente usa ClassicLevel (binding Node.js para LevelDB). Migração automática ao abrir pacotes legados.

**Para desenvolvimento e controle de versão:** usar o CLI oficial `@foundryvtt/foundryvtt-cli` para extrair o LevelDB em arquivos JSON/YAML individuais (um por documento) e recompilar para distribuição.

```bash
# Extrair
fvtt package unpack --in packs/monsters --out src/monsters --yaml

# Compilar
fvtt package pack --in src/monsters --out packs/monsters
```

### 11.3 Tipos de Documentos em Packs

Qualquer tipo de documento pode ser armazenado: Actor, Item, Scene, JournalEntry, Macro, RollTable, Playlist, Adventure, Cards.

---

## 12. Modules vs. Systems

### 12.1 Diferenças Fundamentais

| Aspecto                        | System               | Module                              |
| ------------------------------ | -------------------- | ----------------------------------- |
| Define subtipos de documentos  | Sim (campo `system`) | Sim (desde v11, com prefixo)        |
| Carregado sem sistema ativo    | Não                  | Sim                                 |
| Pode afetar tela de Setup/Join | Sim                  | Não                                 |
| Define `initiative`, `grid`    | Sim                  | Não                                 |
| `library: true`                | Não                  | Sim                                 |
| Restricão por sistema          | N/A                  | Via campo `system: ["meu-sistema"]` |

### 12.2 O que Módulos Podem Alterar

- Qualquer configuração global via `CONFIG.*`
- Registrar sheets alternativas para qualquer documento
- Adicionar hooks para interceptar criação/update/delete de documentos
- Monkey-patching de métodos (desencorajado; usar libWrapper)
- Adicionar novos tipos de documentos via module sub-types
- Injetar HTML em qualquer sheet via hook `render*`
- Sobrescrever strings de i18n

### 12.3 Módulos de Biblioteca (Library Modules)

Módulos com `"library": true` no manifest:

- Carregam antes dos módulos normais
- Não aparecem em listagens públicas
- Uso típico: fornecer APIs compartilhadas para outros módulos

### 12.4 libWrapper

Biblioteca da comunidade para monkey-patching seguro. Detecta e notifica sobre conflitos entre módulos. Três modos de wrapping disponíveis:

- `WRAPPER`: executa antes/depois do método original (mais seguro)
- `MIXED`: pode ou não chamar o original
- `OVERRIDE`: substitui completamente o método original (risco de conflito)

Padrão de uso recomendado: preferir hooks nativos. Usar libWrapper apenas quando hooks não forem suficientes.

### 12.5 socketlib

Biblioteca que simplifica o uso do socket.io para comunicação entre clientes. Abstrai o namespace do módulo e oferece:

- `socketlib.registerModule(moduleId)` para registrar
- Execução de funções em clientes específicos (GM, todos, outros)
- Padrão de RPC entre cliente e servidor

### 12.6 API de Socket Nativa

Com `"socket": true` no manifest, o sistema recebe namespace dedicado: `system.<id>` ou `module.<id>`.

```javascript
// No hook init, após socket disponível
game.socket.on("system.meu-sistema", (data) => {
  console.log("Recebido:", data);
});

// Emitir (todos os outros clientes recebem; emissor não)
game.socket.emit("system.meu-sistema", { tipo: "sync", payload: {...} });
```

**Nota:** O socket não é ponto-a-ponto; o servidor Foundry atua como relay. O emissor não recebe sua própria mensagem.

### 12.7 API Pública vs. Privada

O Foundry documenta uma política clara de estabilidade:

- **Métodos `#privados`** (hash prefix): inacessíveis em JavaScript; erros de syntax se acessados
- **Métodos `_underscore`** não documentados: tratados como privados; sem garantias de estabilidade, sem período de depreciação
- **API Pública documentada**: estabilidade garantida; mudanças breaking apenas em fases específicas de versão com período de depreciação
- **Deprecation period**: mudanças breaking no público são sinalizadas com `@deprecated` antes de remover

---

## 13. Compatibilidade Entre Versões

### 13.1 Versioning do Foundry

O Foundry usa versões numéricas (`v10`, `v11`, `v12`, `v13`, `v14`). O campo `compatibility` no manifest define suporte:

```json
"compatibility": {
  "minimum": "12",
  "verified": "14",
  "maximum": "14"
}
```

Omitir `maximum` permite que usuários tentem executar em versões futuras (arriscado, mas prático para distribuição).

### 13.2 Histórico de Mudanças Impactantes

| Versão | Mudança Relevante para Sistemas/Módulos                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| v10    | Introdução do DataModel; mudanças no modelo de dados de documentos                                                                       |
| v11    | NeDB → LevelDB em compendiums; module sub-types introduzidos                                                                             |
| v12    | ApplicationV2 introduzido como alternativa ao ApplicationV1                                                                              |
| v13    | Todas as UIs do core migradas para ApplicationV2; scope `user` em settings                                                               |
| v14    | `template.json` entra em depreciação; Measured Templates removidos; ActiveEffect v2; ApplicationV1 movido para `foundry.appv1` namespace |

### 13.3 Compatibilidade do Sistema PF2e (Referência)

O sistema PF2e (open-source, Apache-2.0 para código) usa TypeDataModels extensivamente, serve como referência de arquitetura para sistemas complexos. Branch `v14-dev` indica migração ativa. Dados dos compendiums sob OGL/ORC (usáveis no Fusion).

---

## 14. Lições para o Design da API do Fusion

### 14.1 O que o Foundry faz bem

- **DataModel com schema declarativo**: validação automática, migrations integradas, campos tipados
- **Hooks event-driven**: desacoplamento total entre sistema e core
- **Separação clara system/module**: sistemas definem dados, módulos estendem comportamento
- **Compendiums versionáveis**: dados em JSON/YAML no repositório, LevelDB em runtime
- **Settings com escopos**: world/client/user cobre a maioria dos casos

### 14.2 Pontos de Atrito e Oportunidades de Melhoria

1. **Dois sistemas de UI em coexistência (AppV1 + AppV2)**: O Fusion pode partir direto com uma única arquitetura de UI moderna (ex.: baseada em componentes Web, Vue, ou React), evitando dívida técnica de manter duas gerações de API.

2. **template.json legado**: Desnecessário se o Fusion nasce já com DataModels. Não há razão para emular esse artefato.

3. **Monkey-patching como padrão de extensão para módulos**: libWrapper é workaround para limitações da API. O Fusion pode oferecer pontos de extensão (extension points) formais — ex.: lifecycle hooks em classes específicas, middleware system — eliminando a necessidade de patching.

4. **Namespace de flags não estruturado**: Qualquer módulo pode escrever qualquer chave em qualquer documento. Fusion pode exigir registro explícito de extensões de schema, mantendo integridade dos dados.

5. **Ausência de tipagem forte**: Foundry é JavaScript puro; comunidade usa `foundry-vtt-types` não-oficial. O Fusion pode ser TypeScript-first, oferecendo tipos nativos para sistema e módulo developers.

6. **Socket como relay simples**: A arquitetura Foundry não suporta chamadas cliente-para-cliente diretamente (sempre via servidor). O Fusion pode avaliar se WebRTC ou outro mecanismo oferece vantagens para determinados casos.

7. **Dependência de Handlebars**: ApplicationV2 ainda usa Handlebars por padrão. O Fusion pode usar templating mais moderno (Lit, VDOM, ou HTML nativo com `<template>`).

8. **Gerenciamento de Active Effects**: O modo `Custom` requer que o sistema implemente lógica própria de aplicação. Uma API de modificadores mais expressiva (ex.: suporte nativo a fórmulas condicionais) reduziria a necessidade de código boilerplate em sistemas.

9. **Ausência de reatividade nativa**: Sheets precisam ser re-renderizadas manualmente via `render()`. Um sistema reativo (tipo signal/observable no dado) eliminaria essa necessidade.

10. **Complexidade do canvas para novos desenvolvedores**: Sistema de camadas (layers), placeables, controls e interações é difícil de estender. Simplificar a API de extensão do canvas é oportunidade significativa.

---

## Fontes

- [Introduction to System Development | Foundry Virtual Tabletop](https://foundryvtt.com/article/system-development/)
- [Introduction to System Data Models | Foundry Virtual Tabletop](https://foundryvtt.com/article/system-data-models/)
- [Introduction to Module Development | Foundry Virtual Tabletop](https://foundryvtt.com/article/module-development/)
- [Introduction to Module Sub-Types | Foundry Virtual Tabletop](https://foundryvtt.com/article/module-sub-types/)
- [hookEvents | Foundry Virtual Tabletop - API Documentation v14](https://foundryvtt.com/api/modules/hookEvents.html)
- [Hooks | Foundry Virtual Tabletop - API Documentation v14](https://foundryvtt.com/api/classes/foundry.helpers.Hooks.html)
- [ApplicationV2 | Foundry Virtual Tabletop - API Documentation v14](https://foundryvtt.com/api/classes/foundry.applications.api.ApplicationV2.html)
- [ActorSheetV2 | Foundry Virtual Tabletop - API Documentation v14](https://foundryvtt.com/api/classes/foundry.applications.sheets.ActorSheetV2.html)
- [HandlebarsApplicationMixin | Foundry Virtual Tabletop - API Documentation v13](https://foundryvtt.com/api/functions/foundry.applications.api.HandlebarsApplicationMixin.html)
- [TypeDataModel | Foundry Virtual Tabletop - API Documentation v14](https://foundryvtt.com/api/classes/foundry.abstract.TypeDataModel.html)
- [DataModel | Foundry Virtual Tabletop - API Documentation v14](https://foundryvtt.com/api/classes/foundry.abstract.DataModel.html)
- [Document | Foundry Virtual Tabletop - API Documentation v14](https://foundryvtt.com/api/classes/foundry.abstract.Document.html)
- [ClientSettings | Foundry Virtual Tabletop - API Documentation v13](https://foundryvtt.com/api/classes/foundry.helpers.ClientSettings.html)
- [Languages and Localization | Foundry Virtual Tabletop](https://foundryvtt.com/article/localization/)
- [Active Effects | Foundry Virtual Tabletop](https://foundryvtt.com/article/active-effects/)
- [Version 11 Content Packaging Changes | Foundry Virtual Tabletop](https://foundryvtt.com/article/v11-leveldb-packs/)
- [Release 14.359 | Foundry Virtual Tabletop](https://foundryvtt.com/releases/14.359)
- [Begin deprecation of legacy template.json · Issue #13429](https://github.com/foundryvtt/foundryvtt/issues/13429)
- [ApplicationV2 Conversion Guide | Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/guides/applicationV2-conversion-guide)
- [Hooks Listening & Calling | Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/guides/Hooks_Listening_Calling)
- [Library Modules | Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/library-modules)
- [libWrapper | Foundry Virtual Tabletop (packages)](https://foundryvtt.com/packages/lib-wrapper)
- [socketlib | Foundry Virtual Tabletop (packages)](https://foundryvtt.com/packages/socketlib)
- [GitHub — foundryvtt/pf2e (Apache-2.0)](https://github.com/foundryvtt/pf2e)
- [GitHub — foundryvtt/foundryvtt-cli](https://github.com/foundryvtt/foundryvtt-cli)
- [GitHub — League-of-Foundry-Developers/foundry-vtt-types](https://github.com/League-of-Foundry-Developers/foundry-vtt-types)
