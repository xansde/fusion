# 08 — UI, Janelas e Aplicações do Foundry VTT

> Documento de pesquisa para o projeto Fusion (VTT clean-room).
> Fontes consultadas em junho de 2026. Termos técnicos mantidos em inglês.

---

## 1. Estrutura Geral da Interface

A interface do Foundry VTT, a partir da versão 13 (com consolidação total no v14), é composta por **regiões fixas** e **janelas flutuantes** (popouts). Todos os elementos de UI foram migrados para o framework **ApplicationV2** no v13, eliminando dívida técnica do framework anterior (ApplicationV1/FormApplication).

### 1.1 Mapa das Regiões da Tela (in-game)

```
┌─────────────────────────────────────────────────────────────┐
│  Scene Navigation Bar (topo, horizontal)                    │
├──────┬──────────────────────────────────────────────────────┤
│      │                                                      │
│Scene │          Canvas (PIXI.js)                            │
│Ctrls │         Área central principal                       │
│(left │                                                      │
│vert) ├──────────────────────────────────────────────────────┤
│      │                                                      │
├──────┴──────────────────────────────────────────────────────┤
│ Player List │  Macro Hotbar (5 páginas × 10 slots)  │ Rolls│
└─────────────────────────────────────────────────────────────┘
                                              ▲
                                      Sidebar (direita, colapsável)
```

**Singletons no namespace `ui`** (registrados em `foundry.ui`):

| Chave           | Descrição                                          |
|-----------------|----------------------------------------------------|
| `ui.sidebar`    | Sidebar principal (colapsável, direita)            |
| `ui.chat`       | Chat log (primeira aba da sidebar)                 |
| `ui.combat`     | Combat tracker                                     |
| `ui.controls`   | SceneControls (toolbar esquerda)                   |
| `ui.hotbar`     | Macro hotbar (barra inferior)                      |
| `ui.nav`        | SceneNavigation (barra de cenas, topo)             |
| `ui.notifications` | Toast notifications                             |
| `ui.players`    | Lista de jogadores (canto inferior esquerdo)       |
| `ui.pause`      | Indicador de pausa (relógio giratório centralizado)|
| `ui.menu`       | Menu principal                                     |
| `ui.windows`    | Registry de todas as janelas abertas (por ID)      |
| `ui.activeWindow` | Janela atualmente em foco                        |

---

## 2. Sidebar

### 2.1 Estrutura

A Sidebar estende `ApplicationV2` via mixin `HandlebarsApplication`. É **colapsável** (no v13, começa collapsed por padrão). Possui um método `toggleExpanded()` e acessores `expanded` / `collapsed`.

**Abas disponíveis** (11 tabs no total):

| Tab | Ícone (Font Awesome) | Conteúdo |
|-----|----------------------|----------|
| Chat | fa-comments | Chat log, histórico de mensagens e rolls |
| Combat | fa-fist-raised | Combat tracker |
| Scenes | fa-map | Diretório de cenas |
| Actors | fa-users | Diretório de atores (personagens, NPCs) |
| Items | fa-suitcase | Diretório de itens |
| Journal | fa-book-open | Journal entries e páginas |
| Tables | fa-table | Rollable tables |
| Cards | fa-cards | Decks, mãos e pilhas de cartas |
| Playlists | fa-music | Playlists + controles de volume global |
| Compendium | fa-atlas | Browser de compendium packs |
| Settings | fa-cogs | Configurações, keybindings, invitation links |

Cada aba pode ser **popada em janela separada** via right-click no ícone da tab.

### 2.2 Popouts de Sidebar

Qualquer aba da sidebar pode ser "popada" (destacada como janela flutuante independente), mantendo a aba também visível na sidebar. Isso permite, por exemplo, ter o Combat Tracker aberto em janela separada enquanto usa outra aba da sidebar.

### 2.3 Aba de Chat

- Campo de texto na parte inferior com atalho `Enter` para enviar, `Shift+Enter` para nova linha, `↑` para recuperar mensagem anterior.
- **Tipos de mensagem**: in-character (`/ic`), out-of-character (`/ooc`), emote (`/emote`, `/me`), whisper (`/w`, `/whisper`), rolls (`/roll`, `/gmroll`, `/blindroll`, `/selfroll`).
- **Roll modes**: dropdown que configura o modo de roll padrão (público, GM, blind, self).
- **Chat bubbles**: mensagens IC ou emote de tokens posicionados geram balões de fala sobre o token no canvas.
- Botões: Export (floppy disk) e Clear (lixeira).

### 2.4 Aba de Combat (Combat Tracker)

- Lista de combatants com thumbnail, nome, valor de iniciativa (editável diretamente).
- Indicadores visuais de `hidden` e `defeated`.
- Controles exclusivos do GM: criar/deletar encounter, Previous/Next Encounter, Toggle Link to Scene, Roll All/Roll NPCs, Begin/End Combat.
- Controles do player: Roll Initiative para o próprio personagem, End Turn quando for sua vez.
- Round management: Previous Round, Next Round, Previous Turn, Next Turn.
- Opção "Skip Defeated" para pular combatants mortos.
- Right-click em combatant abre context menu com opções (limpar iniciativa, re-roll, marcar como derrotado, esconder).

### 2.5 Aba de Playlists e Áudio

**3 sliders de volume global** (client-side, não sincronizados entre jogadores):
1. Playlists — volume mestre de playlists tocadas pelo GM.
2. Ambient — volume de sons ambiente posicionados na cena.
3. Interface — volume de sons de UI (notificações, chat, rolls).

Playlists suportam organização em pastas. Faixas individuais têm controles de volume, loop, fade, e preloading.

### 2.6 Aba de Compendium

- Filtro por tipo de documento e busca por nome.
- Três categorias de origem: World (criado pelo usuário), Module, System.
- Tipos de conteúdo por pack: Actors, Items, Journal Entries, Macros, Playlists, Rollable Tables, Scenes (cada pack contém apenas um tipo, exceto Adventure).
- Importação/exportação: drag-and-drop de documentos para dentro/fora do pack; importação individual ou em massa.
- **Lazy loading**: dados de compendiums NÃO são carregados no cliente até serem necessários — otimização de performance.

### 2.7 Aba de Journal

- Suporte a múltiplos tipos de **página** por entrada:
  - **Text** — ProseMirror rich-text (padrão).
  - **Image** — handouts visuais.
  - **Video** — arquivos locais ou URLs externas (YouTube etc.).
  - **PDF** — documentos PDF (sem suporte a form-fillable PDFs).
- **Table of Contents** hierárquico na sidebar com controle de indent por nível.
- **ProseMirror**: edição colaborativa em tempo real, auto-save a cada 60s, blocos secretos (visíveis apenas ao GM), HTML raw, tabelas, colapsáveis (details), drag-and-drop de documentos para criar links inline, ajuste de font-size e cor.
- Toggle entre modo single-page e multipage.

### 2.8 Aba de Cards

- Tipos de stack: **Deck** (baralho fonte), **Hand** (mão do jogador — faces visíveis apenas ao dono), **Pile** (descarte/pilha geral).
- Operações: shuffle, deal (com dialog de configuração de quantidade e destinatários), draw, pass, play.

---

## 3. Scene Controls (Toolbar Esquerda)

### 3.1 Estrutura

A classe `SceneControls` estende `ApplicationV2` e organiza controles em **duas hierarquias**:

1. **Controls** (layers) — cada botão principal ativa uma layer do canvas.
2. **Tools** — ferramentas disponíveis dentro da layer ativa.

Estrutura de um `SceneControl`:
```
{
  name: string,           // identificador único
  title: string,          // localization path
  layer: string,          // nome da CanvasLayer associada
  icon: string,           // classes Font Awesome
  visible: boolean,
  tools: Record<string, SceneControlTool>,
  activeTool: string,
  onChange?: Function,
  onToolChange?: Function
}
```

O PARTS estático define dois templates: `layers` (coluna de layers) e `tools` (ferramentas da layer ativa). `activate(options)` minimiza re-renders ao trocar de layer ou ferramenta.

### 3.2 Layers e Ferramentas Disponíveis

| Layer | Ícone | Ferramentas principais |
|-------|-------|------------------------|
| Token (Actors) | fa-user-alt | Selecionar, TargetAll, Toggle combat |
| Measurement | fa-ruler-combined | Circle, Cone, Rectangle, Ray, Clear |
| Tiles | fa-cubes | Select, Place, Overhead toggle |
| Drawings | fa-pencil-alt | Select, Rect, Circle, Polygon, Freehand, Text |
| Walls | fa-university | Select, Wall, Door, Secret Door, Terrain, etc. |
| Lighting | fa-lightbulb | Select, Place Light Source |
| Sound (Ambient) | fa-volume-up | Select, Place Sound |
| Notes | fa-bookmark | Select, Create Note |
| Scene Regions | fa-draw-polygon | Select, Draw, Rectangle, Circle, Polygon |

No v14, cada layer (exceto Tokens) ganhou um botão de **Placeables Palette** para edição em massa de objetos selecionados. Uma nova aba da sidebar — **Placeables Sidebar Tab** — permite visualizar, filtrar e interagir com objetos de cada layer sem tocar no canvas.

### 3.3 Token HUD

Aparece ao **right-click** em token controlado pelo usuário:
- Barras de recurso (2 barras configuráveis, valores editáveis inline).
- Campo de elevação (seta para cima/baixo).
- Targeting (designar como alvo).
- Status effects (grid de ícones configuráveis pelo sistema; right-click em ícone → overlay grande).
- Toggle de visibilidade, defeat, combate.

---

## 4. Scene Navigation Bar

- Barra horizontal no topo da janela, exibe cenas marcadas como "shown in navigation".
- Mostra apenas: cena ativa, cena sendo vista pelo usuário atual, cenas com jogadores presentes.
- No v14, pips indicam qual nível (Scene Level) o usuário está visualizando.
- `SceneNavigation` expõe ação `toggleExpand` e `viewScene`.
- Thumbnails de 300×100px gerados automaticamente do background da cena.

---

## 5. Hotbar de Macros

- Barra horizontal na parte inferior da tela.
- **5 páginas** de macros, cada página com **10 slots** numerados.
- Atalhos de teclado: teclas `1`–`0` ativam slots da página atual.
- Left-click executa a macro; right-click abre context menu (edit, delete, clear).
- Macros são arrastadas e soltas para reorganizar.
- Suporta minimize/maximize (`minimize()` / `maximize()`).
- `cyclePage(direction)` para navegar entre páginas.
- Propriedade `locked` para travar o hotbar contra edições acidentais.

---

## 6. Player List

- Canto inferior esquerdo, lista usuários conectados com sua cor e avatar.
- Right-click no nome → abre **User Configuration**:
  - Imagem de perfil do usuário.
  - Cor do cursor/drawings.
  - Seleção de ator padrão controlado.
- GMs podem configurar qualquer usuário; players apenas o próprio.
- Gerenciamento de usuários (adicionar, remover, senhas, roles) via Settings → User Management.

---

## 7. Application Framework (ApplicationV2)

### 7.1 Visão Geral

`ApplicationV2` estende `EventEmitter` e é a base de toda a UI do Foundry desde o v13. Subclasses principais:

```
ApplicationV2
├── HandlebarsApplicationMixin(ApplicationV2)   ← maioria das apps
│   ├── DocumentSheetV2                         ← sheets de documentos
│   │   ├── ActorSheetV2
│   │   └── ItemSheetV2
│   ├── DialogV2
│   ├── FilePicker
│   ├── Sidebar (e cada aba)
│   ├── SceneControls
│   ├── SceneNavigation
│   ├── Hotbar
│   └── ImagePopout
└── ApplicationV2 (puro, sem Handlebars)
```

### 7.2 Ciclo de Vida de Renderização

```
_canRender()          → validação; retornar false cancela o render
_configureRenderOptions() → modifica opções antes de renderizar
_prepareContext()     → prepara dados para os templates
_preRender()          → ações aguardadas antes do render
_renderHTML()         → método abstrato (HandlebarsApplicationMixin implementa)
_replaceHTML()        → insere HTML renderizado no DOM
_postRender()         → finalização
_onRender()           → hook pós-render (implementar em subclasses)
_onFirstRender()      → executado apenas na primeira renderização
```

Todos os renders e closes são **enfileirados em semáforo**, garantindo processamento sequencial (sem race conditions).

**Eventos emitidos** (via EventEmitter):
- `prerender`, `render`, `close`, `position`

Podem ser interceptados via:
1. Método protegido na subclasse (`_onRender`).
2. Hook global: `Hooks.on("renderMyApplication", fn)`.
3. Listener de instância específica.

### 7.3 Sistema de Parts (Renderização Parcial)

A `HandlebarsApplicationMixin` usa um **registro de parts** (`static PARTS`) para dividir o template em fragmentos independentes:

```js
static PARTS = {
  header: { template: 'modules/my-module/templates/header.hbs' },
  body:   { template: 'modules/my-module/templates/body.hbs', scrollable: ['.body-content'] },
  footer: { template: 'modules/my-module/templates/footer.hbs' },
}
```

- **Renderização seletiva**: `this.render({ parts: ['body'] })` atualiza apenas o fragmento `body`, preservando posição de scroll dos containers marcados como `scrollable`.
- `_preparePartContext(partName, context, options)` — prepara contexto específico para um part.

### 7.4 Configuração de Janela (`ApplicationWindowConfiguration`)

```js
static DEFAULT_OPTIONS = {
  window: {
    title: "Application.Title",
    icon: "fa-solid fa-star",
    resizable: true,
    minimizable: true,
    contentTag: "section",
    contentClasses: ["standard-form"],
  }
}
```

A janela ApplicationV2 tem:
- Header com título, ícone, botões de controle (minimize, close) e context menus.
- Handle de resize (se `resizable: true`).
- Área de conteúdo.

### 7.5 Gerenciamento de Janelas

- `setPosition({ top, left, width, height })` — posiciona/dimensiona a janela.
- `bringToFront()` — aumenta z-index para trazer ao topo.
- `minimize()` / `maximize()` — colapsar/restaurar.
- `render()` / `close()` — abrir/fechar com limpeza.
- `renderChild(app)` — registra aplicação filha (vincula ciclo de vida).
- `submit()` — submissão programática de formulário.

**Z-index e foco**: `ui.windows` mantém registry de todas as janelas abertas por ID. Ao clicar em uma janela, `bringToFront()` é chamado automaticamente.

### 7.6 Detached Windows (Pop-out em janela separada — v14)

No v14, ApplicationV2 implementa suporte nativo a **pop-out em janela de browser separada**:

```js
// Detach para janela separada
await myApp.detachWindow();

// Re-attach à janela principal
await myApp.attachWindow();
```

- `render({ window: { detached: true, windowId: "..." } })` — opção de render.
- Aplicação detachada perde botão Close e handle de resize (redimensiona com a janela do browser).
- Registry de janelas detachadas: `foundry.applications.detached.windows`.
- Apps legadas (ApplicationV1) **não** suportam este recurso — incentivo de migração.

### 7.7 Sistema de Tabs (Abas Internas)

Tabs em ApplicationV2 são configuradas via `static TABS`:

```js
static TABS = {
  primary: {
    tabs: [
      { id: "overview", label: "Overview", icon: "fa-user" },
      { id: "stats",    label: "Stats",    icon: "fa-dice" },
    ],
    initial: "overview",
    labelAttr: "label",
    group: "primary",
  }
}
```

- `tabGroups` (instância): mapeamento de grupo → aba ativa (`null` = nenhuma ativa).
- `changeTab(id, group, options)` — navega para uma aba com opções de animação e scroll.
- `_prepareTabs(group)` — prepara objeto de ApplicationTab para o contexto do template.
- Template padrão disponível em `templates/generic/tab-navigation.hbs` (espera campo `tabs`).

### 7.8 Formulários (Form Handling)

Para aplicações que são formulários:

```js
static DEFAULT_OPTIONS = {
  tag: "form",            // tag raiz do conteúdo
  form: {
    handler: MyApp._onSubmit,   // função executada no submit
    submitOnChange: true,        // submete quando campo muda
    closeOnSubmit: false,        // fecha ao submeter
  }
}
```

`DocumentSheetV2` implementa isso automaticamente. Para apps não-document, configurar manualmente.

---

## 8. DialogV2

`DialogV2` é uma aplicação leve para criar dialogs com formulário e botões. Estende `ApplicationV2`.

### 8.1 Métodos Estáticos

| Método | Propósito | Retorno |
|--------|-----------|---------|
| `DialogV2.confirm(options)` | Dialog sim/não | `true`/`false` |
| `DialogV2.prompt(options)` | Confirmação simples | id do botão ou resultado do callback |
| `DialogV2.input(options)` | Formulário de entrada | objeto com dados do form |
| `DialogV2.wait(options)` | Dialog genérico | id do botão ou resultado do callback |
| `DialogV2.query(user, type, config)` | Apresenta dialog a usuário específico | resposta ou null |

### 8.2 Configuração de Botões

```js
{
  buttons: [
    {
      action: "confirm",       // identificador
      label: "Confirmar",      // texto exibido
      default: true,           // botão padrão (Enter)
      callback: async (event, button, dialog) => {
        // acesso aos dados via button.form.elements
      }
    }
  ],
  window: { title: "Título do Dialog", modal: true },
  content: "<p>HTML do corpo</p>",
  rejectClose: false,          // se false, fechar resolve com null
  closeOnSubmit: true,         // fecha ao clicar botão
}
```

- Dialog envolve conteúdo em `<form>`.
- `_onKeyDown()` processa Enter (botão padrão) e Escape (fechar).
- Pattern moderno usa `await` (Promise-based).

---

## 9. Drag & Drop

### 9.1 Classe `DragDrop`

Controller para workflows de drag-and-drop. Configuração:

```js
new DragDrop({
  dragSelector: ".item",          // o que pode ser arrastado
  dropSelector: ".inventory",     // onde pode ser solto
  permissions: {
    dragstart: (selector) => true,
    drop: (selector) => true,
  },
  callbacks: {
    dragstart: this._onDragStart.bind(this),
    dragover:  this._onDragOver.bind(this),
    dragenter: this._onDragEnter.bind(this),
    dragleave: this._onDragLeave.bind(this),
    dragend:   this._onDragEnd.bind(this),
    drop:      this._onDrop.bind(this),
  }
})
```

- `bind(element)` — vincula listeners ao elemento HTML.
- `DragDrop.createDragImage(imgElement, width, height)` — cria imagem de preview durante arraste.

### 9.2 Padrões de Drag & Drop na UI

- **Sidebar → Canvas**: arrastar Actor da sidebar cria token na cena.
- **Sidebar → Sidebar**: arrastar documento entre diretórios o move/copia.
- **Sheet → Sheet**: arrastar item de uma sheet de ator para outra (comportamento padrão: clonar; módulos alteram para mover).
- **Sidebar → Editor (ProseMirror)**: cria link dinâmico inline para o documento.
- **Compendium**: arrastar documentos para dentro (exportar) ou para fora (importar).
- **Hotbar**: arrastar macro da sidebar ou de uma sheet para o hotbar.
- Comportamento nativo do Foundry: items são **clonados** ao mover entre sheets — módulos como Drag'n'Transfer alteram para movimento destrutivo.

---

## 10. Componentes de UI Utilitários

### 10.1 Draggable

`Draggable` é a classe que torna janelas arrastáveis. Aceita:
- `application` — referência à ApplicationV2.
- `element` — elemento HTML raiz.
- `handle` — elemento de drag handle (header).
- `resizable` — configuração de resize.

Gerencia eventos de drag/float e resize como handlers separados.

### 10.2 ContextMenu

```js
new ContextMenu(container, ".item", [
  {
    name: "Edit",
    icon: '<i class="fa-solid fa-edit"></i>',
    condition: (li) => game.user.isGM,
    callback: (li) => this._onEdit(li),
  },
  { name: "Delete", icon: '...', callback: ... }
], {
  onOpen: (target) => {},
  onClose: (menu) => {},
})
```

- `render(target)` — renderiza iterando os items, verificando condição de visibilidade.
- `close(options)` — fecha com animação, retorna Promise.
- `ContextMenu.create(application, html, selector, menuItems)` — método estático que integra com ApplicationV2 e dispara hooks.

### 10.3 Notifications (`ui.notifications`)

Toast system com fila:
- `MAX_ACTIVE = 5` notificações simultâneas.
- `LIFETIME_MS = 5000` ms de duração padrão.
- Métodos: `info()`, `warn()`, `error()`, `success()`, `notify()`.
- Opções: `permanent`, `localize`, `format`, `progress`, `console`.
- Retorna ID para `remove()` programático.
- `update(id, options)` — atualiza progress bar de uma notificação existente.

### 10.4 FilePicker

```js
FilePicker.fromButton(buttonElement);
// ou
new FilePicker({ type: "image", current: "/path/to/file" }).render();
```

- Navega no servidor de arquivos público (fontes: `data`, `public`, `S3`).
- Modos de display: list, grid, etc.
- Métodos: `browse(target)`, `upload()`, `createDirectory()`.
- Atributos HTML: `data-target` (input destino), `data-type` (image, audio, video, etc.).
- `FILE_TYPES` estático define tipos aceitos.

### 10.5 Custom HTML Elements

Foundry v14 expõe elementos HTML customizados (form-associated) para uso em templates:

| Elemento | Tag HTML | Propósito |
|----------|----------|-----------|
| `HTMLColorPickerElement` | `<color-picker>` | Seletor de cor (par de inputs linked) |
| `HTMLFilePickerElement` | `<file-picker>` | Seletor de arquivo |
| `HTMLProseMirrorElement` | `<prose-mirror>` | Editor rich-text |
| `HTMLMultiSelectElement` | `<multi-select>` | Dropdown multi-seleção |
| `HTMLMultiCheckboxElement` | `<multi-checkbox>` | Grupo de checkboxes |
| `HTMLStringTagsElement` | `<string-tags>` | Input de tags (lista de strings) |
| `HTMLDocumentTagsElement` | `<document-tags>` | Tags de documentos vinculados |
| `HTMLSecretBlockElement` | — | Blocos secretos (visíveis só ao GM) |
| `HTMLFormulaInputElement` | `<formula-input>` | Input de fórmulas de dado |
| `HTMLRangePickerElement` | `<range-picker>` | Seletor de faixa numérica |
| `HTMLHueSelectorSlider` | — | Slider de matiz (hue) |
| `HTMLCodeMirrorElement` | `<code-mirror>` | Editor de código |
| `HTMLEnrichedContentElement` | — | Renderização de rich text/HTML |

Todos estendem `AbstractFormInputElement` e são **form-associated** (participam da submissão do form nativo).

---

## 11. Theming e CSS

### 11.1 Arquitetura CSS (v13+)

O Foundry v13 introduziu **CSS Cascade Layers** completo. Layers definidas (ordem de especificidade, do mais genérico ao mais específico):

```
reset → variables.base → variables.themes → variables.x
→ base → general → specific → exceptions
→ layouts.x → elements.x → blocks.x
→ applications → modules → system → compatibility
```

- `modules` e `system` são layers específicos para modules e game systems sobrescreverem estilos sem precisar igualar ou superar a especificidade do core.
- Antes do v13, sobrescrever estilos do Foundry exigia seletores de alta especificidade.

### 11.2 Temas

Foundry v13 implementou **ThemeV2** com suporte a light e dark mode:

```js
// Constante em CONST.CSS_THEMES
CSS_THEMES = {
  dark:    { id: "dark",    label: "...", theme: "foundry" },
  fantasy: { id: "fantasy", label: "...", theme: "fantasy" },
  scifi:   { id: "scifi",   label: "...", theme: "scifi"   },
}
```

- A UI detecta automaticamente a preferência do sistema operacional/browser (prefers-color-scheme) e aplica dark ou light.
- É possível sobrescrever o tema de uma sheet individual.
- CSS variables são usadas para todas as cores, tipografia e espaçamentos — facilitando a criação de temas customizados.

### 11.3 Escala e Acessibilidade

- Foundry v13 adicionou sliders de escala de fonte (`font-size` global da interface), opacidade e outras preferências de usuário.
- Não há suporte nativo robusto a screen readers; a comunidade criou módulos como **Accessibility Enhancements** (add-to-character sem drag-and-drop, cues sonoros) e **Accessibility: Chatfinder** (shortcut `Shift+C` para o chatbox).
- Keybindings completamente configuráveis via Settings → Configure Controls.
- Detecção de conflitos de keybind com ícone de aviso amarelo no painel de configuração.

### 11.4 Performance de UI

- Worlds com centenas de documentos ativos causam lentidão de carregamento — recomendação: manter conteúdo não-ativo em compendiums (lazy loaded).
- O módulo **Prime Performance** otimiza o token UI layer com batching de draw calls.
- Hardware Acceleration obrigatório (Foundry usa GPU via PIXI.js para o canvas).
- A maior fonte de lag de UI é o número de módulos ativos — diagnóstico via Safe Configuration.
- v14 trouxe melhorias de 3–25% de performance em operações comuns.

---

## 12. Telas de Setup e Login

### 12.1 Tela de Setup (pré-world)

Disponível ao acessar o servidor Foundry antes de entrar em um mundo. Estrutura de abas:

| Aba | Conteúdo |
|-----|----------|
| Worlds | Lista todos os mundos criados, ordenados por último uso; botão Launch World |
| Game Systems | Sistemas instalados; botão Install System + Update |
| Add-on Modules | Módulos instalados; botão Install Module + Update |
| Configuration | Configurações do servidor (porta, SSL, UPnP, path de dados) |

- Refresh v11: nova tela de setup responsiva, seção News, Featured Content.
- O Admin Password protege o acesso à tela de setup (encriptado, armazenado no Config folder).

### 12.2 Tela de Login / Join

Após um mundo ser iniciado pelo GM, jogadores acessam via URL convite:
- **LAN**: IP local + porta (ex: `http://192.168.1.10:30000`).
- **Internet**: IP público + porta.
- Tela de Join lista usuários configurados no mundo, campo de senha (opcional), botão "Join Game Session".

**Invitation Links**: disponíveis via Settings → Invitation Links na sidebar. Dois links gerados automaticamente (LAN e Internet). O módulo **Foundry Redirect** gera URLs estáticas que persistem mesmo com mudança de IP.

### 12.3 Usuários e Roles

Roles disponíveis: `NONE` (0), `PLAYER` (1), `TRUSTED` (2), `ASSISTANT` (3), `GAMEMASTER` (4).
- GMs têm acesso a todas as ferramentas e layers.
- Roles controlam quais layers do canvas são visíveis e editáveis.

---

## 13. ProseMirror como Editor Rich-Text

Foundry usa **ProseMirror** como editor padrão desde o v10. No v14, o TinyMCE foi removido completamente.

**Funcionalidades**:
- Formatação: headers (H1–H6), bold, italic, underline, strikethrough.
- Tabelas (insert, delete, merge cells).
- Blocos colapsáveis (Details plugin).
- Font-size e cor via menu do ProseMirror.
- Seções secretas (ocultas de players).
- Edição de HTML raw.
- Edição colaborativa em tempo real (múltiplos usuários no mesmo texto, auto-save 60s).
- Drag-and-drop de documentos da sidebar → cria link inline `@UUID[...]`.
- Seleção de texto + drop → usa texto como label do link.

**API**: `foundry.prosemirror` module com plugins e helpers para extensão do editor.

---

## 14. Críticas de UX e Oportunidades para o Fusion

### 14.1 Problemas Documentados da Comunidade

| Problema | Descrição | Oportunidade para o Fusion |
|----------|-----------|---------------------------|
| **Curva de aprendizado íngreme** | Setup "front-loaded": visão, compendiums, automação requerem estudo antes de funcionar | Onboarding guiado, tooltips contextuais, templates prontos |
| **Gestão de janelas caótica** | Muitas janelas abertas sobrepostas sem sistema de organização nativo | Sistema de tiles/abas nativo, snap-to-grid de janelas, workspace por cena |
| **Token Linking confuso** | Distinção prototype token vs. placed token não é óbvia; editar ator nem sempre atualiza token no mapa | Sincronização mais transparente, indicadores visuais de status de link |
| **Permissões não-intuitivas** | Handouts aparecem em branco porque a permissão padrão é "none" — confunde novos GMs | Permissões com defaults mais permissivos ou wizard de configuração |
| **Configuração de visão** | Configurar walls+lighting+vision requer múltiplos menus aninhados | Editor de cena integrado, "quick setup" de visão |
| **Módulos causam cascata de falhas** | Atualizações criam incompatibilidades entre módulos interdependentes | Sistema de plugins com contratos de API versionados |
| **Muitas janelas e z-index** | ApplicationV1 e ApplicationV2 tinham z-index mal coordenado (corrigido no v13) | Sistema de z-index unificado desde o início |
| **Tabs de sidebar não pesquisáveis** | Busca de compendium só por nome do pack, não conteúdo (corrigido no v14) | Busca full-text integrada em todos os diretórios |
| **Falta de suporte a acessibilidade** | Sem suporte nativo a screen readers ou navegação completa por teclado | Implementar ARIA desde o início, navegação por teclado nativa |
| **Sidebar começa colapsada (v13)** | Mudança de comportamento que gerou módulos de restauração | Configuração de estado inicial como preferência do usuário |

### 14.2 Elogios de UX (Preservar no Fusion)

- **Combat Tracker** claro e eficiente — indicação visual de turno atual sem poluição visual.
- **Fog of War / Line of Sight** em tempo real, sem latência perceptível.
- **Character sheets interativas** — maioria das ações acessível sem navegar entre janelas.
- **ProseMirror** colaborativo e robusto para journal entries.
- **Sistema de compendiums** — lazy loading inteligente melhora muito a performance.
- **Hotbar de 5 páginas** — gestão de macros flexível sem ocupar muito espaço.

---

## 15. Canvas Layers (Referência)

Ordem de renderização (base → topo):

1. **Background Image** — imagem de fundo da cena.
2. **Standard Tiles** — tiles sem flag Overhead (chão, móveis).
3. **Token (Actors)** — personagens, NPCs, monstros.
4. **Overhead Tiles** — tiles com flag Overhead (tetos, segundo plano).
5. **Foreground Image** — imagem de foreground (mesma dimensão da cena).
6. **Weather** — efeitos de clima.
7. **Effects (Lighting/Vision)** — calcula e renderiza visibilidade e iluminação.
8. **Template** — medições, áreas de efeito. (Removido no v14; substituído por Scene Regions.)
9. **GM Layers** (Sound, Walls, Notes) — visíveis apenas a GM/Assistant GM.

---

## Fontes

- [Foundry VTT API v13 — Sidebar](https://foundryvtt.com/api/v13/classes/foundry.applications.sidebar.Sidebar.html)
- [Foundry VTT API v14 — ApplicationV2](https://foundryvtt.com/api/classes/foundry.applications.api.ApplicationV2.html)
- [Foundry VTT API v14 — DialogV2](https://foundryvtt.com/api/classes/foundry.applications.api.DialogV2.html)
- [Foundry VTT API v14 — SceneControls](https://foundryvtt.com/api/classes/foundry.applications.ui.SceneControls.html)
- [Foundry VTT API v14 — Hotbar](https://foundryvtt.com/api/v14/classes/foundry.applications.ui.Hotbar.html)
- [Foundry VTT API v14 — DragDrop](https://foundryvtt.com/api/classes/foundry.applications.ux.DragDrop.html)
- [Foundry VTT API v14 — Notifications](https://foundryvtt.com/api/classes/foundry.applications.ui.Notifications.html)
- [Foundry VTT API v14 — FilePicker](https://foundryvtt.com/api/v13/classes/foundry.applications.apps.FilePicker.html)
- [Foundry VTT API v14 — ContextMenu](https://foundryvtt.com/api/v13/classes/foundry.applications.ux.ContextMenu.html)
- [Foundry VTT API v14 — HTMLColorPickerElement](https://foundryvtt.com/api/classes/foundry.applications.elements.HTMLColorPickerElement.html)
- [Foundry VTT API v14 — Custom Elements (módulo)](https://foundryvtt.com/api/modules/foundry.applications.elements.html)
- [Foundry VTT API v14 — ui namespace](https://foundryvtt.com/api/variables/foundry.ui.html)
- [Foundry VTT API — SceneNavigation v14](https://foundryvtt.com/api/classes/foundry.applications.ui.SceneNavigation.html)
- [Foundry VTT API v13 — Hotbar](https://foundryvtt.com/api/v13/classes/foundry.applications.ui.Hotbar.html)
- [Foundry VTT API — CSS_THEMES](https://foundryvtt.com/api/variables/CONST.CSS_THEMES.html)
- [Foundry VTT API — DocumentSheetV2 v14](https://foundryvtt.com/api/classes/foundry.applications.api.DocumentSheetV2.html)
- [Foundry VTT API — Draggable v14](https://foundryvtt.com/api/classes/foundry.applications.ux.Draggable.html)
- [Foundry VTT KB — Canvas Layers](https://foundryvtt.com/article/canvas-layers/)
- [Foundry VTT KB — Combat](https://foundryvtt.com/article/combat/)
- [Foundry VTT KB — Chat](https://foundryvtt.com/article/chat/)
- [Foundry VTT KB — Journal](https://foundryvtt.com/article/journal/)
- [Foundry VTT KB — Compendium](https://foundryvtt.com/article/compendium/)
- [Foundry VTT KB — Cards](https://foundryvtt.com/article/cards/)
- [Foundry VTT KB — Playlists](https://foundryvtt.com/article/playlists/)
- [Foundry VTT KB — Player Orientation](https://foundryvtt.com/article/player-orientation/)
- [Foundry VTT KB — Game Worlds](https://foundryvtt.com/article/game-worlds/)
- [Foundry VTT KB — Configuration](https://foundryvtt.com/article/configuration/)
- [Foundry VTT KB — v10 Text Editor Changes](https://foundryvtt.com/article/v10-text-editor/)
- [Foundry VTT Community Wiki — ApplicationV2 Conversion Guide](https://foundryvtt.wiki/en/development/guides/applicationV2-conversion-guide)
- [Foundry VTT Community Wiki — CSS Cascade Layers](https://foundryvtt.wiki/en/development/guides/css-cascade-layers)
- [Foundry VTT Year in Review 2025](https://foundryvtt.com/article/year-in-review-2025/)
- [Foundry VTT Release 14.359 (Stable)](https://foundryvtt.com/releases/14.359)
- [Foundry VTT Release 13.332](https://foundryvtt.com/releases/13.332)
- [GitHub — Foundry VTT Issues](https://github.com/foundryvtt/foundryvtt/issues)
- [Advanced RPGs — Foundry VTT Review (Pain Points)](https://advancedrpgs.com/foundry-vtt-review-best-features-pain-points-and-who-should-buy-it/)
- [ApplicationV2 Development Guide — Rayners Dev](https://docs.rayners.dev/seasons-and-stars/applicationv2-development/)
- [DeepWiki — Foundry Walls and Tiles](https://deepwiki.com/foundryvtt/foundryvtt/3.4-walls-and-tiles)
- [The Forge — February 2026 Developer Update](https://blog.forge-vtt.com/february-2026-developer-update/)
