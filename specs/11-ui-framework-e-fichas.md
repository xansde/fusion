# 11 — UI Framework e Fichas

- **Título:** UI Framework e Fichas (Sheets)
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/08-foundry-ui-aplicacoes.md`
  - `docs/research/94-accessibility-mobile-tablet.md`

> **Aviso clean-room.** Esta spec descreve o framework de UI do Fusion, próprio,
> construído em Svelte 5 (Runes). Onde menciona o Foundry VTT (ApplicationV2,
> Sidebar, SceneControls, DialogV2, ProseMirror etc.), refere-se apenas a
> comportamento e conceitos observáveis publicamente, usados como referência de
> design. Nenhum código proprietário do Foundry é reproduzido. O Fusion não usa
> Handlebars, ApplicationV2 nem ProseMirror diretamente: a UI é toda Svelte 5 e o
> rich text é TipTap (ProseMirror por baixo, mas via TipTap, não a stack do
> Foundry).

---

## Objetivo

Definir o **framework de interface do Fusion**: o shell da aplicação (layout das
regiões fixas da tela), o **window manager** próprio em Svelte (janelas
flutuantes arrastáveis/redimensionáveis/minimizáveis com foco e z-index), o
**sistema de Sheets** (fichas) que a API de sistemas usa para registrar
componentes Svelte por `(documentType, subtype)`, a biblioteca de **componentes
base** (dialogs, forms com binding a Documents e autosave, tabs, context menus,
tooltips, FilePicker, color picker, drag&drop), o **editor rich text TipTap**
com extensões próprias (@links de documento, secrets de GM, inline rolls), o
**theming** dark/light via CSS custom properties, a **i18n** (pt-BR primário, en
secundário) e a **responsividade mínima para tablet**.

Esta spec é o contrato de UI sobre o qual todas as telas concretas do Fusion são
construídas. Ela define **como** a UI é montada e estendida; o **conteúdo** de
cada subsistema vive nas specs irmãs (chat, combate, journal, etc.).

---

## Escopo

### O que esta spec inclui

- **Shell da aplicação**: mapa de regiões da tela (canvas fullscreen + sidebar
  direita com tabs + scene controls à esquerda + hotbar inferior + scene
  navigation no topo + player list), camadas de z-index e a hierarquia de
  empilhamento.
- **Window manager** próprio em Svelte: ciclo de vida de uma janela flutuante,
  arrasto, resize, minimize/maximize, foco, registry global, persistência de
  posição por usuário; pop-out em janela de browser separada é **[V2]**.
- **Sistema de Sheets**: contrato de registro pela system API por
  `(documentType, subtype)`, contrato de props/eventos do componente de sheet,
  modos `edit`/`play`, sheets default da engine para Documents genéricos.
- **Componentes base**: `Dialog` (confirm/prompt/input), `Form` com binding a
  Document e **autosave com debounce**, `Tabs`, `ContextMenu`, `Tooltip` (com
  preview de Document), `FilePicker` (integra `ver 20-assets-e-midia.md`),
  `ColorPicker`, framework de **drag & drop** (Document → canvas/sheet/hotbar).
- **Editor rich text TipTap**: extensões próprias de @link de Document, blocos
  secretos visíveis só ao GM, inline rolls; integração com autosave.
- **Theming** dark/light com CSS custom properties; estrutura de tokens de
  design.
- **i18n**: estrutura de chaves, fallback en→chave, formatação, pluralização.
- **Responsividade mínima** para tablet e modo jogador simplificado (detalhes
  completos de acessibilidade/touch em `ver 23-acessibilidade-e-dispositivos.md`).

### O que esta spec NÃO inclui

- Renderização do **canvas PIXI** e suas layers (tokens, tiles, grid) →
  `ver 06-canvas-e-renderizacao.md`.
- Visão, iluminação e fog → `ver 07-visao-iluminacao-fog.md`.
- **Conteúdo** funcional das abas da sidebar: chat (`ver 09-chat-e-mensagens.md`),
  combat tracker (`ver 10-combate-e-iniciativa.md`), journal/tables/cards
  (`ver 12-journal-tabelas-cartas.md`), playlists (`ver 13-audio-e-playlists.md`),
  compendiums (`ver 16-compendiums-e-importacao.md`).
- **Schema** dos Documents que as sheets editam → `ver 02-modelo-de-dados.md`.
- **Roles, ownership e a avaliação de permissões** → `ver 05-usuarios-e-permissoes.md`
  (esta spec só consome o resultado da avaliação para gatear UI).
- **Protocolo de fio** de updates de Document, ack/broadcast e reconciliação
  otimista → `ver 04-rede-e-sincronizacao.md` (o autosave desta spec emite
  updates por esse protocolo).
- **Motor de rolagens** e parsing de fórmulas → `ver 08-motor-de-rolagens.md`
  (inline rolls do TipTap apenas referenciam fórmulas; a execução é lá).
- O **conteúdo concreto** das sheets de cada sistema (layout do character sheet
  PF2e etc.) → `ver 17-sistema-pf2e.md`, `18-sistema-sf2e.md`, `19-sistema-etmos.md`.
- Detalhamento completo de acessibilidade WCAG, gestos touch, PWA, safe areas →
  `ver 23-acessibilidade-e-dispositivos.md` (esta spec define o mínimo e aponta).
- FilePicker como browser de arquivos do servidor (segurança de upload, tipos
  permitidos) → `ver 20-assets-e-midia.md` e `ver 21-seguranca.md`.

---

## Conceitos e terminologia

| Termo                | Definição no Fusion                                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shell**            | O conjunto de regiões fixas da UI que sempre existem em um mundo aberto (sidebar, scene controls, hotbar, nav, player list) mais o `<canvas>`. Componente raiz `<GameShell>`.                                         |
| **Region**           | Uma área fixa do shell ancorada a uma borda da viewport (top/left/bottom/right) com z-index e comportamento próprios.                                                                                                 |
| **Window** (janela)  | Uma superfície flutuante gerenciada pelo window manager: arrastável, redimensionável, minimizável, com header e foco. Toda sheet, dialog e popout vive em uma Window.                                                 |
| **Window manager**   | Serviço Svelte singleton (`windowManager`) que mantém o registry de Windows abertas, resolve z-index/foco e persiste posições.                                                                                        |
| **Application**      | Termo genérico para o **conteúdo** de uma Window (uma sheet, um dialog, um browser). No Fusion não há classe `Application` (clean-room): uma Application é apenas um componente Svelte conforme um contrato de props. |
| **Sheet** (ficha)    | Application especializada que edita/exibe um Document. Registrada pela system API por `(documentType, subtype)`.                                                                                                      |
| **DocumentType**     | O tipo primário de Document (`Actor`, `Item`, `Scene`, `JournalEntry`, etc.), conforme `ver 02-modelo-de-dados.md`.                                                                                                   |
| **Subtype**          | O discriminador de `system` (campo `type` do Document; ex.: Actor `"character"` vs `"npc"`), conforme `ver 02-modelo-de-dados.md`.                                                                                    |
| **Modo edit / play** | Estado de uma sheet: `play` (interativa, executa ações/rolls, campos read-only exceto inputs de jogo) vs `edit` (campos de configuração desbloqueados para montar a ficha).                                           |
| **Autosave**         | Persistência automática de mudanças de campo de uma sheet via update parcial de Document, com debounce, sem botão "Salvar".                                                                                           |
| **SheetContext**     | Objeto reativo passado a toda sheet com o Document, o resultado de permissão, o modo, helpers de autosave e o tema.                                                                                                   |
| **Design token**     | Variável CSS (`--fusion-*`) que parametriza cor, tipografia, espaçamento e raio. Theming troca os valores, não os componentes.                                                                                        |
| **i18n key**         | Identificador hierárquico de string traduzível (ex.: `FUSION.Sheet.Tab.Inventory`). Resolvido pela função `t()`/store `$t`.                                                                                           |
| **Player mode**      | Variante de layout para telas `≤ 1024px` com `pointer: coarse` (tablet do jogador), com canvas maximizado e UI simplificada.                                                                                          |

---

## Decisões

Cada decisão lista alternativas rejeitadas e o racional.

### DEC-UIF-01 — Toda a UI em Svelte 5 (Runes); nenhuma reimplementação de ApplicationV2/Handlebars

A camada de apresentação do Fusion é **inteiramente Svelte 5** com Runes
(`$state`, `$derived`, `$effect`, `$props`). Não há um framework de "Application"
no estilo do Foundry (ApplicationV2/Handlebars): uma "Application" é apenas um
componente Svelte que satisfaz um contrato de props. O window manager,
descrito abaixo, é o equivalente funcional do registro de janelas
(`ui.windows`/`bringToFront`) do Foundry (research 08 §7.5), porém escrito do
zero em Svelte.

- **Alternativas rejeitadas:**
  - _Portar o modelo ApplicationV2 (lifecycle `_prepareContext`/`_renderHTML`/PARTS)_:
    é arquitetura acoplada a Handlebars e a um ciclo de render manual (research 08
    §7.2–7.3). Svelte já dá reatividade fina e render parcial nativos; replicar o
    ciclo seria reinventar o que o compilador resolve. Além disso seria copiar
    design proprietário sem ganho.
  - _React/Vue_: a stack está fixada em Svelte 5. Svelte produz menos runtime
    overhead e integra bem com o canvas PIXI (montagem imperativa via `mount()`).
- **Racional:** Svelte 5 entrega reatividade granular, compiler warnings de
  acessibilidade (research 94 §10.1) e bundle pequeno. O contrato de "componente
  Svelte por `(documentType, subtype)`" é mais simples e mais testável que uma
  hierarquia de classes.

### DEC-UIF-02 — Window manager próprio em Svelte, não `<dialog>` nativo para janelas; `<dialog>` nativo só para modais

Janelas flutuantes (sheets, browsers, popouts) são gerenciadas por um
**window manager Svelte próprio**, que controla posição, z-index, foco e
persistência. Elas **não** são modais e podem coexistir empilhadas. Já os
**modais** (confirm/prompt/input, e o compendium browser quando bloqueante)
usam o elemento `<dialog>` nativo com `.showModal()`, ganhando focus trap,
fechamento por `Escape` e backdrop de graça (research 94 §10.2).

- **Alternativas rejeitadas:**
  - _Tudo em `<dialog>` nativo_: `<dialog>` modal trava o foco e impede ter
    múltiplas janelas não-modais sobrepostas (o caso de uso central do VTT:
    várias sheets abertas ao mesmo tempo — research 08 §14.2 "ações acessíveis
    sem navegar entre janelas"). `<dialog>` não-modal não dá z-index/foco
    coordenado entre instâncias.
  - _Biblioteca de janelas de terceiros_: dependência grande, difícil de
    integrar com Runes e theming; o conjunto de features (drag/resize/snap) é
    pequeno o bastante para implementar.
- **Racional:** Separar as duas necessidades — janelas persistentes empilháveis
  (manager próprio) vs. modais bloqueantes acessíveis (`<dialog>` nativo) — dá o
  melhor de cada: controle total de UX onde precisamos, e acessibilidade
  gratuita onde o padrão da plataforma já é correto. Resolve a crítica de
  "z-index mal coordenado" e "gestão de janelas caótica" do Foundry (research 08
  §14.1) desde o início, com z-index unificado.

### DEC-UIF-03 — Sheets registradas pela system API por `(documentType, subtype)`; engine fornece defaults

O componente que renderiza uma sheet é resolvido pelo par
`(documentType, subtype)`, exatamente como o schema de `system` é selecionado
(`ver 02-modelo-de-dados.md`). A system API registra o componente
(`ver 15-api-de-sistemas.md`). Quando nenhum componente está registrado para o
par, a **engine fornece uma sheet default genérica** (key-value editor sobre o
schema do Document), garantindo que todo Document seja sempre abrível.

- **Alternativas rejeitadas:**
  - _Sheet única configurável por dados (sem código)_: insuficiente para a riqueza
    de PF2e/SF2e (research 08 §14.2 elogia "character sheets interativas"). A
    automação de uma ficha PF2e exige lógica, não só layout.
  - _Registro só por `documentType` (sem subtype)_: um Actor `character` e um
    Actor `npc` têm fichas radicalmente diferentes; sem subtype, o sistema
    teria que ramificar dentro de um componente gigante.
- **Racional:** Espelha a granularidade do schema (`02`) e da system API (`15`),
  mantendo a fronteira engine↔sistema limpa. A default genérica resolve a
  crítica de "handout aparece em branco" (research 08 §14.1) — sempre há uma
  sheet utilizável.

### DEC-UIF-04 — Autosave com debounce, sem botão "Salvar"

Sheets persistem mudanças automaticamente: ao alterar um campo, a sheet emite um
**update parcial de Document** (apenas o diff) após um debounce (default
**400 ms**), via o protocolo de `ver 04-rede-e-sincronizacao.md`. Não há botão
"Salvar". O servidor é autoritativo: valida, persiste e faz broadcast; a sheet
reflete o Document atualizado reativamente.

- **Alternativas rejeitadas:**
  - _Botão "Salvar" explícito_: gera estado "sujo" divergente, risco de perda de
    edição e fricção. O Foundry usa `submitOnChange` (research 08 §7.8) — autosave
    é o padrão esperado de VTT.
  - _Salvar em cada keystroke (sem debounce)_: gera tempestade de updates na rede
    e no SQLite; ruim em campos de texto.
- **Racional:** Autosave com debounce é o comportamento que usuários de VTT
  esperam e minimiza perda de dados. O debounce agrupa rajadas de digitação em um
  único diff. Conflitos concorrentes são resolvidos pelo servidor autoritativo
  (último update válido vence no nível de campo; ver `04`).

### DEC-UIF-05 — Rich text com TipTap, não ProseMirror cru nem o editor do Foundry

O editor rich text é **TipTap** (que encapsula ProseMirror). Extensões próprias
do Fusion: @link de Document, blocos secretos de GM e inline rolls. O conteúdo é
HTML serializado, armazenado no campo do Document; a renderização "enriquecida"
(resolver @links, esconder secrets de não-GM, tornar inline rolls clicáveis)
acontece em um componente `<EnrichedContent>`.

- **Alternativas rejeitadas:**
  - _ProseMirror cru_ (o que o Foundry usa, research 08 §13): TipTap dá uma API de
    extensões muito mais ergonômica e integra melhor com Svelte; ProseMirror cru
    exigiria reescrever schema/commands/plugins manualmente.
  - _Editor markdown simples (ex.: textarea + render)_: insuficiente para tabelas,
    blocos colapsáveis, secrets e drag-and-drop de @links (research 08 §13).
- **Racional:** A stack fixou TipTap. Ele cobre formatação, tabelas, colapsáveis e
  é extensível para os três recursos próprios. ProseMirror por baixo garante
  robustez. (Edição colaborativa em tempo real fica como **[V2]** — ver Questões.)

### DEC-UIF-06 — Theming por CSS custom properties (design tokens), dark default + light

Todo estilo usa **design tokens** (`--fusion-color-*`, `--fusion-space-*`,
`--fusion-font-*`, `--fusion-radius-*`). Trocar de tema troca os valores das
variáveis em um escopo raiz, nunca os componentes. O tema default é **dark**;
**light** é suportado; a preferência segue o OS (`prefers-color-scheme`) e pode
ser sobrescrita por preferência do usuário. Sistemas podem registrar **skins**
(conjuntos de tokens) por escopo de sheet.

- **Alternativas rejeitadas:**
  - _Cores hard-coded por componente_: impossibilita temas e overrides de sistema.
  - _CSS-in-JS_: Svelte já tem `<style>` escopado; tokens em CSS variables são mais
    performáticos e inspecionáveis.
- **Racional:** CSS variables são a abordagem do Foundry v13 (research 08 §11.2) e
  a recomendada para acessibilidade/high-contrast (research 94 §1.1). Permitem
  light/dark e skins de sistema sem batalha de especificidade.

### DEC-UIF-07 — i18n com chaves hierárquicas, fallback en e dois bundles primários

Strings são identificadas por **chaves hierárquicas** (`FUSION.<area>.<...>`).
A resolução é: locale ativo (pt-BR ou en) → fallback en → a própria chave (para
detectar faltantes). Engine e cada sistema contribuem bundles de tradução
(`pt-BR.json`, `en.json`). Suporte a interpolação de variáveis e pluralização.

- **Alternativas rejeitadas:**
  - _Hard-code de strings pt-BR_: bloqueia en e qualquer futura localização.
  - _Biblioteca i18n pesada (i18next completo)_: overkill; um resolver simples de
    chave + interpolação + plural cobre o MVP.
- **Racional:** pt-BR primário e en secundário estão fixados. Chaves hierárquicas
  espelham a estrutura de UI e facilitam contribuição por sistema. Fallback para a
  chave torna óbvia toda string não traduzida em desenvolvimento.

### DEC-UIF-08 — Responsividade mínima para tablet via container queries + player mode; pop-out de browser é V2

O shell é **responsivo o suficiente** para um jogador em tablet
(`≤ 1024px`, `pointer: coarse`): há um **player mode** com canvas maximizado,
scene controls de GM ocultos, sidebar colapsada acessível por swipe/FAB e sheets
como bottom drawers. Componentes de sheet usam **container queries** para se
adaptar à largura da própria janela, não da viewport (research 94 §5.2). O
detalhamento completo (gestos, PWA, safe areas, WCAG) é de
`ver 23-acessibilidade-e-dispositivos.md`. **Pop-out** de janela em browser
separado é **[V2]** (research 08 §7.6).

- **Alternativas rejeitadas:**
  - _Só desktop no MVP_: o material de pesquisa dedica um doc inteiro a tablet
    (research 94) e jogadores em tablet são caso de uso explícito do projeto.
  - _App mobile nativo_: fora de escopo; PWA/browser cobre o jogador
    (`ver 23-acessibilidade-e-dispositivos.md`).
- **Racional:** Atender o jogador-tablet sem complicar o MVP. Container queries são
  production-ready (research 94 §5.2) e desacoplam a sheet do tamanho de tela.

### DEC-UIF-09 — Drag & Drop unificado por payload tipado de Document

Há um framework único de drag & drop: o que é arrastado carrega um **payload
tipado** (UUID + documentType + subtype + origem). Drop zones declaram que tipos
aceitam. Os fluxos canônicos: Document da sidebar → canvas (cria token/nota),
Document → sheet (adiciona item/embedded), Document → editor TipTap (cria @link),
macro/Document → hotbar (cria slot).

- **Alternativas rejeitadas:**
  - _HTML5 DnD nativo com `dataTransfer` de texto solto_: frágil, sem tipagem,
    difícil de validar permissão antes do drop.
  - _Eventos de pointer ad-hoc por componente_: duplicação e inconsistência.
- **Racional:** Um payload tipado central (research 08 §9) permite validar
  permissão e tipo no `dragover` (rejeitar antes de soltar) e reaproveitar a mesma
  máquina em todas as zonas. Implementado sobre **Pointer Events** para funcionar
  em touch também (research 94 §4.1).

### DEC-UIF-10 — Persistência de preferências de usuário: fronteira client-side vs. server-side

As preferências de usuário se dividem em duas classes com destinos distintos:

**Client-side (esta spec, `ClientUIPreferences`):** preferências dependentes do
dispositivo/tela do usuário — geometria de janelas (posição, tamanho,
minimizado), sidebar expandida/colapsada e página do hotbar. Essas preferências
não fazem sentido transportar entre dispositivos porque dependem do tamanho e
resolução de cada tela. Armazenadas localmente (storage concreto definido em
`ver 23-acessibilidade-e-dispositivos.md`).

**Server-side (persistidas por `userId` no banco, definidas em
`ver 23-acessibilidade-e-dispositivos.md` e `ver 05-usuarios-e-permissoes.md`):**
preferências lógicas portáveis entre dispositivos do mesmo usuário — keybindings
(`UserKeybindings`), configurações de qualidade gráfica (`UserQualitySettings`),
tema dark/light e locale. Essas preferências viajam com o usuário ao trocar de
dispositivo ou ao reabrir uma sessão em outra máquina. O servidor carrega e
distribui essas preferências no handshake de autenticação (ver `05`).

A reabertura de uma sheet do mesmo Document reusa a geometria de janela
(client-side). Keybindings e tema são aplicados assim que o servidor fornece os
dados do usuário autenticado.

- **Alternativas rejeitadas:**
  - _Tudo client-side_: keybindings e tema perdidos ao trocar de dispositivo;
    hostil para usuários que usam tablet + desktop.
  - _Tudo server-side_: geometria de janela server-side seria inútil em telas de
    tamanhos diferentes; aumenta round-trips desnecessários para dados
    puramente locais.
- **Racional:** A divisão pela portabilidade da preferência (depende do
  dispositivo vs. depende do usuário) resolve a tensão entre a spec 11
  (client-side) e a spec 23 (server-side) sem duplicar donos do mesmo dado.
  `ClientUIPreferences` cobre apenas geometria e estado de layout local;
  keybindings e qualidade gráfica pertencem ao modelo de usuário de `05`/`23`.
  Reconcilia DEC-UIF-10 com DEC-A11-07 e REQ-A11-021 de
  `ver 23-acessibilidade-e-dispositivos.md`.

---

## Requisitos funcionais

Cada requisito é testável. Tags `[MVP]`/`[V2]` alinhadas à definição de MVP
global (jogar uma sessão de PF2e: mapa+grid, tokens, visão/fog, fichas, rolagens,
chat, combat tracker).

### Shell da aplicação

- **REQ-UIF-001** [MVP] O componente raiz `<GameShell>` deve renderizar, em um
  mundo aberto, as regiões fixas: o `<canvas>` ocupando 100% da viewport ao fundo;
  a **scene navigation** ancorada ao topo; os **scene controls** ancorados à
  esquerda; a **sidebar** ancorada à direita; a **player list** no canto inferior
  esquerdo; a **hotbar** centralizada na parte inferior; e a área de
  **notifications** (toasts).
- **REQ-UIF-002** [MVP] A **sidebar** deve conter um conjunto de **tabs** e ser
  colapsável/expansível, com o estado (expandida/colapsada) persistido por usuário
  (DEC-UIF-10). As tabs do MVP são: Chat, Combat, Scenes, Actors, Items, Journal,
  Compendium, Settings. As tabs Tables, Cards e Playlists são **[V2]** no shell,
  mas o slot de registro de tab deve existir desde o MVP.
  > **Concretizado pela spec 36** (`36-gaveta-lateral.md`, DEC-GAV-01/07, 2026-08-15):
  > a lista efetiva do MVP passa a ser Chat, Contatos, Combate, Compêndio (todos) +
  > NPCs, Cenas, Configurações (GM); Items e Journal ficam como slot sem aba no MVP.
  > O "slot de registro" é `registerSidebarTab` (REQ-GAV-030).
- **REQ-UIF-003** [MVP] Os **scene controls** (toolbar esquerda) devem expor uma
  coluna de "controls" (cada um ativa uma layer do canvas — ver
  `06-canvas-e-renderizacao.md`) e, para o control ativo, sua lista de "tools".
  Trocar de control ou de tool deve emitir um evento que o canvas consome, sem
  re-render do shell inteiro.
- **REQ-UIF-004** [MVP] Os controls/tools visíveis nos scene controls devem ser
  **filtrados por role/permissão** do usuário (ver `05-usuarios-e-permissoes.md`):
  layers exclusivas de GM (Walls, Lighting, Sound) não aparecem para players sem a
  capacidade correspondente.
- **REQ-UIF-005** [MVP] A **scene navigation** (topo) DEVE listar as cenas marcadas
  como visíveis na navegação e indicar a **cena no ar** (a cena ativa do mundo). Ela
  NÃO DEVE oferecer cena diferente por usuário: no MVP, quem não está preparando
  renderiza sempre a cena no ar. Trocar de cena a partir dela DEVE ser um de dois
  gestos, ambos restritos a papel privilegiado — (a) **pôr no ar**, global, executado
  pelo evento dedicado de cena ativa (REQ-CNV-070, REQ-CEN-040, REQ-CEN-041), ou
  (b) **preparo local**, que troca apenas o canvas de quem prepara, não altera a cena
  no ar e não é gravado no servidor (REQ-CNV-070a, REQ-CEN-050, REQ-CEN-051). A
  navegação DEVE distinguir "a cena que o usuário está vendo" da cena no ar apenas
  enquanto houver preparo em curso; para todo usuário sem papel privilegiado as duas
  DEVEM coincidir sempre, e o clique NÃO DEVE trocar a cena renderizada. Deve ser
  colapsável.

  > **Emenda obrigada pela spec 44** (`44-aba-cenas.md`, DEC-CEN-02, DEC-CEN-03 e §12,
  > 2026-08-16): a redação anterior mandava a navegação "indicar a cena ativa e a cena
  > que o usuário está vendo, e permitir trocar de cena com um clique", sem restrição de
  > papel — o que é navegação divergente por usuário, exatamente a alternativa que a
  > DEC-CEN-03 recusa no MVP (exigiria cena na presença, que `05-usuarios-e-permissoes.md`
  > não carrega; reabre em Q-CEN-05). _(A redação acima substitui a metade de "trocar de
  > cena com um clique" e a de "a cena que o usuário está vendo"; listar as cenas visíveis
  > na navegação, indicar a cena ativa e ser colapsável permanecem inalterados.)_

- **REQ-UIF-006** [MVP] A **hotbar** deve exibir uma página de **10 slots**
  numerados; clicar (ou tecla `1`–`0`) executa a macro do slot; deve suportar
  **5 páginas** navegáveis e arrastar macros entre slots. Right-click em um slot
  abre context menu (editar/limpar). Conteúdo e execução de macros: ver
  `14-macros-e-automacao.md`.
- **REQ-UIF-007** [MVP] A **player list** deve listar os usuários conectados com
  nome e cor, indicar quem está online/offline e quem é GM, e abrir (right-click)
  a configuração do usuário (própria para players; qualquer uma para GM — gating
  em `05`).
- **REQ-UIF-008** [MVP] O sistema de **z-index** do shell deve ser unificado e
  declarado em um único lugar (tokens de camada): canvas < regiões fixas <
  janelas flutuantes < janela em foco < context menus/tooltips < modais <
  notifications. Nenhum componente deve hard-codar z-index fora dessa escala.
- **REQ-UIF-008a** [MVP] Deve existir um **Token HUD** como componente de UI
  HTML (overlay DOM ancorado ao token no canvas), exibido ao right-click em um
  token controlado pelo usuário. O Token HUD deve fornecer, no mínimo: edição
  inline das **barras de recurso** configuradas (valores numéricos), campo de
  **elevação**, botão de **targeting**, grade de **status effects** (ícones;
  right-click em ícone abre overlay de seleção ampliado) e toggles de
  visibilidade/derrota/combate. O HUD é gerado pela camada de UI (esta spec);
  os dados do token e o posicionamento no canvas são fornecidos por
  `ver 06-canvas-e-renderizacao.md`. Em modo tablet, o Token HUD deve ter
  representação permanente (sem depender de hover), conforme
  `ver 23-acessibilidade-e-dispositivos.md` (REQ-A11-046).

### Window manager

- **REQ-UIF-009** [MVP] O `windowManager` deve abrir uma Window dado um componente
  Application e suas props, retornando um handle com `id`, e deve manter um
  **registry** reativo de todas as Windows abertas indexado por `id`.
- **REQ-UIF-010** [MVP] Uma Window deve ter um **header** com título, ícone
  opcional e botões de controle (minimizar, fechar); o corpo renderiza a
  Application. O botão fechar dispara o teardown da Application.
- **REQ-UIF-011** [MVP] Uma Window deve ser **arrastável** pelo header e
  **redimensionável** pelas bordas/cantos quando `resizable` (default `true`),
  respeitando tamanho mínimo configurável e mantendo-se dentro da viewport visível
  (não pode ser arrastada totalmente para fora da tela).
- **REQ-UIF-012** [MVP] Clicar em qualquer parte de uma Window deve trazê-la ao
  **foco** (maior z-index entre as janelas) e marcar `windowManager.activeWindow`.
  Apenas uma Window é a ativa por vez.
- **REQ-UIF-013** [MVP] Uma Window deve poder ser **minimizada** (colapsa para só o
  header) e restaurada, e o estado minimizado deve persistir por usuário
  (DEC-UIF-10).
- **REQ-UIF-014** [MVP] Abrir uma Application para um Document que **já tem uma
  Window aberta** deve trazer a Window existente ao foco em vez de abrir uma
  duplicata (singleton por `(applicationType, documentUuid)`).
- **REQ-UIF-015** [MVP] Posição e tamanho de uma Window devem ser **persistidos
  por usuário** e restaurados na reabertura da mesma Application/Document
  (DEC-UIF-10). Se a posição salva cair fora da viewport atual, a Window é
  recolocada na área visível.
- **REQ-UIF-016** [MVP] O window manager deve suportar **modais** via Window
  bloqueante baseada em `<dialog>` nativo (`.showModal()`), com focus trap,
  fechamento por `Escape` e backdrop, conforme DEC-UIF-02.
- **REQ-UIF-017** [V2] Uma Window deve poder ser **destacada (pop-out)** para uma
  janela de browser separada e re-anexada à janela principal, perdendo o handle de
  resize próprio (passa a redimensionar com a janela do SO).

### Sistema de Sheets

- **REQ-UIF-018** [MVP] A system API deve expor `registerSheet(documentType,
subtype, component, options)` para associar um componente Svelte a um par
  `(documentType, subtype)`. O par `subtype = "*"` (ou ausência) registra um
  fallback para todos os subtypes daquele documentType. Contrato detalhado em
  `ver 15-api-de-sistemas.md`.
- **REQ-UIF-019** [MVP] Abrir a sheet de um Document deve resolver o componente na
  ordem: `(documentType, subtype)` exato → `(documentType, "*")` → **sheet default
  da engine**. A resolução nunca falha: a default genérica sempre existe.
- **REQ-UIF-020** [MVP] A engine deve fornecer **sheets default genéricas** para
  todo Document sem sheet registrada: um editor que lista os campos do schema
  (`ver 02-modelo-de-dados.md`) com inputs apropriados ao tipo, mais o editor de
  flags e ownership (este último só para quem tem permissão).
- **REQ-UIF-021** [MVP] Todo componente de sheet recebe um **`SheetContext`**
  (objeto de props/contexto reativo) contendo: o `document` (reativo), o
  `permission` (nível de ownership avaliado para o usuário atual, de `05`), o
  `mode` (`"play"`/`"edit"`), helpers de `autosave`, o `theme` ativo e o resolver
  de i18n. O contrato exato de props está em **Modelo de dados** abaixo.
- **REQ-UIF-022** [MVP] Uma sheet deve respeitar a **permissão** recebida: com
  nível `OBSERVER` ou inferior, todos os inputs são read-only e ações mutativas
  ficam desabilitadas; com `OWNER` (ou GM), edição é permitida. A UI nunca deve
  ser a única barreira — o servidor revalida (ver `05`).
- **REQ-UIF-023** [MVP] Uma sheet deve suportar os modos **play** e **edit**,
  alternáveis por quem tem permissão de edição. Em `play`, a ficha prioriza
  ações/rolls e exibe valores derivados; em `edit`, expõe os campos de
  configuração da ficha. O modo é estado de UI (não persiste no Document).
- **REQ-UIF-024** [MVP] Mudanças de campo em uma sheet devem disparar **autosave
  com debounce** (DEC-UIF-04), emitindo um update parcial (diff) do Document pelo
  protocolo de `04`, sem botão "Salvar". Enquanto um autosave está em voo, a sheet
  deve indicar estado "salvando"/"salvo".
- **REQ-UIF-025** [MVP] Uma sheet aberta deve **reagir a updates externos** do seu
  Document (vindos do servidor/outros usuários) atualizando os campos exibidos sem
  perder o foco/seleção do campo que o usuário está editando localmente.
- **REQ-UIF-026** [MVP] Uma sheet deve ser **drop target** para Documents
  compatíveis (ex.: soltar um Item em uma sheet de Actor cria o embedded Item),
  usando o framework de drag & drop (REQ-UIF-046) e validando permissão/tipo antes
  de aceitar.

> **Onde vive (emenda F3, 2026-08-23).** A ficha de cada sistema é um pacote
> registrado via `sheetRegistry` (REQ-UIF-018/019); o core mantém só o
> framework (window manager, `sheetRegistry`, sheet default genérica). A ficha
> PF2e vive em `packages/client/src/systems/pf2e/`, atrás de um entry point
> único (`systems/pf2e/index.ts`) — o core nunca importa o restante daquele
> diretório diretamente (regra `client-core-must-not-import-system-sheets` no
> `.dependency-cruiser.cjs`). Ver `docs/design/separacao-repos/design.md`
> (DEC-SEP-02/03, fase F3/F4).

### Componentes base — Dialogs

- **REQ-UIF-027** [MVP] Deve existir `Dialog.confirm({ title, content })` que
  resolve uma Promise para `true`/`false`, com botões Confirmar/Cancelar, botão
  default acionável por `Enter` e fechamento por `Escape`/backdrop.
- **REQ-UIF-028** [MVP] Deve existir `Dialog.prompt({ title, content, ok })` que
  apresenta uma confirmação simples e resolve quando o usuário confirma.
- **REQ-UIF-029** [MVP] Deve existir `Dialog.input({ title, fields })` que
  apresenta um formulário e resolve com um objeto contendo os valores dos campos
  (ou `null` se cancelado).
- **REQ-UIF-030** [MVP] Todos os dialogs devem ser **modais** (`<dialog>` nativo,
  DEC-UIF-02): focus trap, retorno de foco ao elemento anterior ao fechar, e
  `role="dialog"`.

### Componentes base — Forms

- **REQ-UIF-031** [MVP] Deve existir um componente `Form`/conjunto de inputs com
  **two-way binding a um path do Document** (ex.: `bind:value` a
  `system.attributes.hp.value`), que ao mudar dispara o autosave (REQ-UIF-024) com
  o diff mínimo.
- **REQ-UIF-032** [MVP] Os inputs base disponíveis devem incluir, no mínimo: texto,
  número (com min/max/step), checkbox, select, textarea, e os componentes
  especializados ColorPicker (REQ-UIF-043), FilePicker (REQ-UIF-040) e editor rich
  text (REQ-UIF-047). Todos devem ser acessíveis (label associado, foco visível).
- **REQ-UIF-033** [MVP] Inputs devem refletir **validação**: ao receber rejeição do
  servidor (update inválido por schema, ver `02`), o input volta ao valor
  persistido e exibe o erro de validação de forma acessível (não apenas cor —
  research 94 §10.3).

### Componentes base — Tabs, ContextMenu, Tooltip

- **REQ-UIF-034** [MVP] Deve existir um componente `Tabs` com navegação por
  teclado (setas, Home/End), `role="tablist"`/`role="tab"`/`role="tabpanel"`
  corretos e indicação visível da aba ativa.
- **REQ-UIF-035** [MVP] Deve existir um `ContextMenu` acionável por right-click (e
  por tecla de menu/long-press em touch) que recebe uma lista de itens, cada um com
  `label`, `icon`, `condition` (visibilidade) e `callback`. Itens cuja `condition`
  é falsa não são exibidos.
- **REQ-UIF-036** [MVP] Deve existir um `Tooltip` que aparece em hover/foco de um
  elemento, com delay configurável, posicionamento que evita sair da viewport, e
  que também aparece ao **foco por teclado** (não apenas hover — research 94
  §10.2).
- **REQ-UIF-037** [MVP] O tooltip deve suportar um modo **preview de Document**:
  ao apontar para um @link de Document (no chat, no journal, na sheet), exibir um
  resumo do Document referenciado (nome, imagem, campos-chave), respeitando a
  permissão do usuário (não vazar dados de Document sem acesso).

### Componentes base — Notifications

- **REQ-UIF-038** [MVP] Deve existir `notifications` (toast) com métodos `info`,
  `warn`, `error`, `success`, exibindo no máximo **5** toasts simultâneos
  (excedente enfileirado), duração default de **5 s**, opção `permanent`, e retorno
  de um id para remoção programática.
- **REQ-UIF-039** [MVP] Toasts devem ser anunciados a leitores de tela via
  `aria-live` (`polite` para info/success, `assertive` para error), conforme
  research 94 §10.2.

### Componentes base — FilePicker, ColorPicker

- **REQ-UIF-040** [MVP] Deve existir um `FilePicker` que navega os arquivos
  servidos pelo mundo (assets), filtrável por tipo (image/audio/video), com modos
  de visualização lista e grade, e que retorna o caminho selecionado a um input. A
  semântica de armazenamento, upload e tipos permitidos é de
  `ver 20-assets-e-midia.md`; a segurança de upload é de `ver 21-seguranca.md`.
- **REQ-UIF-041** [MVP] O FilePicker deve permitir **upload** de um arquivo
  (quando o usuário tem permissão) e **criar diretório**, delegando a operação ao
  servidor (`20`/`21`) e refletindo o resultado.
- **REQ-UIF-042** [V2] O FilePicker deve suportar fontes de assets externas
  configuradas (ex.: bucket S3-compatível), conforme `20-assets-e-midia.md`.
- **REQ-UIF-043** [MVP] Deve existir um `ColorPicker` (par swatch + input hex
  sincronizados) acessível por teclado, retornando uma cor em formato hex a um
  input bindável.

### Drag & Drop

- **REQ-UIF-044** [MVP] O framework de drag & drop deve transportar um **payload
  tipado** mínimo: `{ uuid, documentType, subtype, origin }` (DEC-UIF-09).
- **REQ-UIF-045** [MVP] Uma **drop zone** deve declarar os tipos que aceita; no
  `dragover`/`pointermove` sobre a zona, o sistema deve validar tipo **e permissão**
  e dar feedback visual de aceitação/rejeição **antes** do drop.
- **REQ-UIF-046** [MVP] Os fluxos de drag & drop do MVP são: (a) Document da
  sidebar → **canvas** (ex.: Actor cria Token — ver `06`); (b) Document → **sheet**
  (cria embedded — REQ-UIF-026); (c) Document → **editor TipTap** (cria @link —
  REQ-UIF-048); (d) macro/Document → **hotbar** (cria slot — REQ-UIF-006). Cada
  fluxo valida permissão antes de efetivar.
- **REQ-UIF-046b** [MVP] O drag & drop deve ser implementado sobre **Pointer
  Events** (não Touch/Mouse Events específicos), funcionando com mouse, caneta e
  touch (research 94 §4.1); em touch, o início do arraste usa long-press para não
  conflitar com pan/scroll.

### Editor rich text (TipTap)

- **REQ-UIF-047** [MVP] Deve existir um editor rich text baseado em **TipTap** com,
  no mínimo: parágrafos, headings, negrito/itálico/sublinhado/tachado, listas,
  links, tabelas e blocos colapsáveis; o conteúdo é serializado como HTML no campo
  do Document; mudanças disparam autosave (REQ-UIF-024).
- **REQ-UIF-048** [MVP] O editor deve ter uma extensão de **@link de Document**:
  soltar um Document (drag & drop) ou usar um comando insere um link
  `@UUID[...]{label}`; o `<EnrichedContent>` resolve o link para um chip clicável
  que abre a sheet/preview do Document referenciado.
- **REQ-UIF-049** [MVP] O editor deve ter uma extensão de **bloco secreto**: um
  trecho marcado como secreto é **visível apenas para o GM**; para
  não-GMs, o `<EnrichedContent>` omite o bloco. A omissão é feita na **renderização
  com base na permissão**; o conteúdo secreto não deve ser enviado a clientes sem
  permissão quando o documento é distribuído (coordenar com `04`/`05`).
- **REQ-UIF-050** [MVP] O editor deve ter uma extensão de **inline roll**: um
  trecho `[[fórmula]]` (ou comando) vira um botão clicável que, ao acionar, dispara
  uma rolagem pelo motor de `ver 08-motor-de-rolagens.md` (a execução é
  server-side; o editor apenas referencia a fórmula).
- **REQ-UIF-051** [MVP] O componente `<EnrichedContent>` deve renderizar HTML de
  Document resolvendo @links (REQ-UIF-048), aplicando a regra de secrets
  (REQ-UIF-049) e ativando inline rolls (REQ-UIF-050), e deve **sanitizar** o HTML
  contra XSS antes de inserir no DOM (ver `21-seguranca.md`).
- **REQ-UIF-052** [V2] O editor deve suportar **edição colaborativa em tempo real**
  (múltiplos usuários no mesmo texto) e blocos de HTML raw.

### Theming

- **REQ-UIF-053** [MVP] Todas as cores, espaçamentos, raios e tipografia da UI
  devem derivar de **design tokens** CSS (`--fusion-*`). Nenhum componente deve
  hard-codar valores de cor.
- **REQ-UIF-054** [MVP] A UI deve oferecer temas **dark** (default) e **light**,
  seguindo `prefers-color-scheme` por padrão e permitindo override por
  **preferência do usuário** persistida server-side por `userId` (ver
  `05-usuarios-e-permissoes.md` e `23-acessibilidade-e-dispositivos.md`,
  DEC-UIF-10).
- **REQ-UIF-055** [MVP] Os temas devem satisfazer **contraste WCAG 2.2 AA**
  (≥ 4,5:1 para texto normal; ≥ 3:1 para texto grande e ícones de UI) em ambos os
  modos (research 94 §2.3, §10.3). Nenhuma informação crítica de jogo deve ser
  transmitida apenas por cor.
- **REQ-UIF-056** [V2] Um sistema deve poder registrar **skins** (conjuntos de
  tokens) aplicáveis ao escopo das suas sheets, sem afetar o resto da UI.

### i18n

- **REQ-UIF-057** [MVP] Deve existir um resolver de i18n `t(key, vars?)` (e store
  reativo `$t`) que resolve uma chave hierárquica no locale ativo, com **fallback**
  para en e, em último caso, retorna a própria chave.
- **REQ-UIF-058** [MVP] Engine e cada sistema devem contribuir **bundles** de
  tradução (`pt-BR.json`, `en.json`) mesclados em runtime; chaves de sistema vivem
  sob um namespace do sistema para evitar colisão.
- **REQ-UIF-059** [MVP] O resolver deve suportar **interpolação** de variáveis
  (`t("FUSION.Greeting", { name })`) e **pluralização** (formas por contagem).
- **REQ-UIF-060** [MVP] O **locale primário é pt-BR**; en é o secundário. O locale
  ativo é preferência portável do usuário, persistida server-side por `userId`
  (ver `05-usuarios-e-permissoes.md` e `23-acessibilidade-e-dispositivos.md`,
  DEC-UIF-10); default pt-BR.

### Responsividade / tablet

- **REQ-UIF-061** [MVP] Componentes de sheet devem usar **container queries**
  (`container-type: inline-size`) para adaptar o layout à largura da própria janela
  (ex.: colapsar de duas colunas para uma quando estreita), independentemente da
  viewport (research 94 §5.2).
- **REQ-UIF-062** [MVP] Deve existir um **player mode** ativado para telas
  `≤ 1024px` com `pointer: coarse`: canvas maximizado, scene controls de GM
  ocultos, sidebar colapsada acessível por FAB/swipe, e sheets apresentadas como
  **bottom drawers** em vez de janelas flutuantes. Detalhes em
  `ver 23-acessibilidade-e-dispositivos.md`.
- **REQ-UIF-063** [MVP] Todos os alvos de toque interativos devem ter no mínimo
  **24×24 px** (WCAG 2.2 §2.5.8), preferencialmente **44×44 px** em player mode
  (research 94 §2.3, §5.3).
- **REQ-UIF-064** [MVP] A UI HTML (não o canvas) deve ser totalmente **operável por
  teclado**: foco visível (`:focus-visible`), ordem de foco lógica, skip link para
  o conteúdo principal, e nenhum affordance dependente apenas de hover sem
  equivalente em foco (research 94 §10.2). Acessibilidade do canvas é tratada em
  `ver 06-canvas-e-renderizacao.md` e `ver 23-acessibilidade-e-dispositivos.md`.

---

## Requisitos não-funcionais

- **REQ-UIF-NF-001** [MVP] **Performance de abertura de sheet:** abrir uma sheet de
  Actor (com sua árvore de embedded items típica) deve renderizar em < 150 ms em
  hardware-alvo de desktop, sem travar o canvas (o render da sheet não bloqueia o
  loop do canvas).
- **REQ-UIF-NF-002** [MVP] **Autosave responsivo:** o debounce default de autosave é
  400 ms; o usuário deve ver indicação de "salvando"/"salvo" em < 100 ms após o fim
  do debounce. Atualizações remotas concorrentes não devem causar perda de foco no
  campo em edição (REQ-UIF-025).
- **REQ-UIF-NF-003** [MVP] **Reatividade do shell:** trocar de control/tool ou de
  cena não deve re-renderizar regiões não afetadas do shell (render parcial via
  reatividade Svelte).
- **REQ-UIF-NF-004** [MVP] **Acessibilidade:** a UI HTML deve atingir **WCAG 2.2 AA**
  para contraste, foco, target size e nome/role/valor (research 94 §2.3, §10.3). O
  canvas usa acessibilidade best-effort via overlay (fora desta spec).
- **REQ-UIF-NF-005** [MVP] **Theming sem flash:** a troca de tema (dark/light) deve
  aplicar-se sem recarregar a página e sem flash de tema incorreto no boot
  (resolver `prefers-color-scheme`/preferência antes do primeiro paint).
- **REQ-UIF-NF-006** [MVP] **Internacionalização completa:** nenhuma string de UI da
  engine pode estar hard-coded; toda string visível passa pelo resolver i18n. Um
  lint/teste deve detectar strings não traduzidas (chave retornada crua).
- **REQ-UIF-NF-007** [MVP] **Sanitização:** todo HTML de rich text renderizado por
  `<EnrichedContent>` deve ser sanitizado contra XSS (ver `21-seguranca.md`); o
  editor nunca executa scripts de conteúdo de usuário.
- **REQ-UIF-NF-008** [MVP] **Isolamento de estilo:** estilos de uma sheet de sistema
  não devem vazar para o shell nem para outras sheets (escopo Svelte +
  skins escopadas). Tokens globais são o único canal de influência cruzada.
- **REQ-UIF-NF-009** [MVP] **Robustez de janela:** o crash do componente de uma
  Application não deve derrubar o shell; um error boundary fecha/sinaliza a Window
  com erro e mantém o resto da UI utilizável.
- **REQ-UIF-NF-010** [MVP] **Input unificado:** toda interação de ponteiro na UI usa
  **Pointer Events**; nenhum componente usa `TouchEvent`/`MouseEvent` exclusivos,
  garantindo paridade mouse/touch/caneta (research 94 §4.1).

---

## Modelo de dados

Interfaces TypeScript do contrato de UI. Não são Documents persistidos (exceto as
preferências de cliente, que são client-side); são contratos de runtime entre
engine, system API e componentes.

```ts
/** Tipos de Document e o discriminador de subtype vêm de 02-modelo-de-dados.md. */
import type { DocumentTypeName, FusionDocument, OwnershipLevel } from "@fusion/shared";
/** Component: tipo exportado pelo Svelte 5 para componentes montados via mount(). */
import type { Component } from "svelte";

/** ---------- Window manager ---------- */

export type WindowId = string;

export interface WindowConfig {
  /** Componente Svelte 5 da Application (montado via mount()). */
  component: Component<Record<string, unknown>>;
  props: Record<string, unknown>;
  title: string; // i18n key ou texto já resolvido
  icon?: string; // nome de ícone
  resizable?: boolean; // default true
  minimizable?: boolean; // default true
  modal?: boolean; // default false -> usa <dialog> showModal (DEC-UIF-02)
  minWidth?: number;
  minHeight?: number;
  /** Chave de singleton: reabrir com a mesma key foca a janela existente (REQ-UIF-014). */
  singletonKey?: string; // ex.: `sheet:${documentUuid}`
}

export interface WindowState {
  id: WindowId;
  top: number;
  left: number;
  width: number;
  height: number;
  minimized: boolean;
  zIndex: number;
  focused: boolean;
}

export interface WindowHandle {
  readonly id: WindowId;
  bringToFront(): void;
  minimize(): void;
  restore(): void;
  setPosition(p: Partial<Pick<WindowState, "top" | "left" | "width" | "height">>): void;
  close(): Promise<void>;
}

export interface WindowManager {
  /** Registry reativo (Svelte rune store) de todas as janelas abertas. */
  readonly windows: ReadonlyMap<WindowId, WindowState>;
  readonly activeWindow: WindowId | null;
  open(config: WindowConfig): WindowHandle;
  get(id: WindowId): WindowHandle | undefined;
  focus(id: WindowId): void;
  closeAll(): Promise<void>;
}

/** ---------- Sheets ---------- */

export type SheetMode = "play" | "edit";

/** Props/contexto que toda sheet recebe (REQ-UIF-021). */
export interface SheetContext<D extends FusionDocument = FusionDocument> {
  /** Document reativo; muda quando o servidor faz broadcast de update. */
  document: D;
  /** Nível de ownership avaliado p/ o usuário atual (ver 05). */
  permission: OwnershipLevel;
  /** true se o usuário pode editar (OWNER ou GM). */
  editable: boolean;
  mode: SheetMode;
  setMode(mode: SheetMode): void;
  /** Autosave: emite update parcial com debounce (DEC-UIF-04). */
  autosave: {
    /** Atualiza um path do document; agenda o flush com debounce. */
    update(path: string, value: unknown): void;
    /** Força o flush imediato dos diffs pendentes. */
    flush(): Promise<void>;
    /** Estado p/ a UI de "salvando"/"salvo". */
    readonly status: "idle" | "saving" | "saved" | "error";
  };
  /** Resolver i18n já no escopo (engine + sistema). */
  t: (key: string, vars?: Record<string, unknown>) => string;
  /** Tema ativo. */
  theme: "dark" | "light";
}

/** Opções no registro de uma sheet pela system API (detalhe em 15). */
export interface SheetRegistration {
  documentType: DocumentTypeName;
  subtype: string | "*"; // "*" = fallback p/ todos os subtypes
  /** Componente Svelte 5 (montado via mount()). */
  component: Component<Record<string, unknown>>;
  /** Tamanho inicial sugerido da janela. */
  defaultSize?: { width: number; height: number };
  /** Se múltiplas sheets registradas, qual é a default selecionável. */
  default?: boolean;
}

/** ---------- Drag & Drop ---------- */

export interface DragPayload {
  uuid: string; // UUID do Document (ver 02)
  documentType: DocumentTypeName;
  subtype?: string;
  origin: "sidebar" | "sheet" | "canvas" | "hotbar" | "compendium";
}

export interface DropZoneConfig {
  /** Tipos aceitos; "*" aceita qualquer. */
  accepts: (DocumentTypeName | "*")[];
  /** Validação adicional (permissão/regra) antes de aceitar. */
  canDrop(payload: DragPayload): boolean;
  onDrop(payload: DragPayload, position?: { x: number; y: number }): void | Promise<void>;
}

/** ---------- Dialogs ---------- */

export interface DialogButton {
  action: string;
  label: string; // i18n key
  default?: boolean; // acionável por Enter
}

export interface InputFieldSpec {
  name: string;
  label: string; // i18n key
  type: "text" | "number" | "checkbox" | "select" | "textarea";
  options?: { value: string; label: string }[]; // p/ select
  value?: unknown;
}

/** ---------- i18n ---------- */

export interface I18n {
  readonly locale: "pt-BR" | "en";
  setLocale(locale: "pt-BR" | "en"): void;
  t(key: string, vars?: Record<string, unknown>): string;
  /** Mescla um bundle (engine ou sistema). */
  registerBundle(locale: "pt-BR" | "en", namespace: string, table: Record<string, string>): void;
}

/**
 * ---------- Preferências de cliente (client-side, por dispositivo) ----------
 * Persistidas localmente (localStorage ou IndexedDB — ver 23).
 * Cobrem apenas preferências dependentes do dispositivo/tela (DEC-UIF-10).
 * Preferências portáveis entre dispositivos (keybindings, tema, locale,
 * qualidade gráfica) são server-side em UserKeybindings / UserQualitySettings
 * definidos em 23-acessibilidade-e-dispositivos.md e 05-usuarios-e-permissoes.md.
 */
export interface ClientUIPreferences {
  /** Estado de layout da sidebar neste dispositivo. */
  sidebarExpanded: boolean;
  /** Página ativa do hotbar neste dispositivo. */
  hotbarPage: number;
  /** Geometria de janelas por singletonKey (depende do tamanho de tela). */
  windowGeometry: Record<
    string,
    Pick<WindowState, "top" | "left" | "width" | "height" | "minimized">
  >;
}
```

---

## API e eventos

Superfície que a system API e os componentes consomem. O registro formal pela
system API está em `ver 15-api-de-sistemas.md`; aqui ficam apenas as assinaturas
relevantes à UI.

### Serviços globais (client)

| Serviço         | Forma                                                                       | Propósito                                                        |
| --------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `windowManager` | `WindowManager`                                                             | Abrir/focar/fechar Windows; registry reativo (REQ-UIF-009..016). |
| `sheets`        | `registerSheet(...)` / `openSheet(document)`                                | Registro e abertura de sheets (REQ-UIF-018..019).                |
| `dialogs`       | `Dialog.confirm/prompt/input`                                               | Modais utilitários (REQ-UIF-027..030).                           |
| `notifications` | `info/warn/error/success/remove`                                            | Toasts (REQ-UIF-038..039).                                       |
| `dnd`           | `registerDropZone(el, DropZoneConfig)` / `startDrag(el, () => DragPayload)` | Drag & drop tipado (REQ-UIF-044..046b).                          |
| `i18n`          | `I18n` (`t`, `$t`, `registerBundle`)                                        | Tradução (REQ-UIF-057..060).                                     |
| `theme`         | `get()/set()` + tokens CSS                                                  | Theming (REQ-UIF-053..056).                                      |
| `filePicker`    | `FilePicker.pick({ type, current })`                                        | Selecionar/upload de asset (REQ-UIF-040..042).                   |

### Eventos de UI (emitidos no client)

| Evento                                          | Quando                                   | Payload                  |
| ----------------------------------------------- | ---------------------------------------- | ------------------------ |
| `window:open` / `window:close` / `window:focus` | ciclo de vida de Window                  | `{ id, singletonKey? }`  |
| `sheet:render`                                  | sheet (re)renderizada                    | `{ documentUuid, mode }` |
| `control:change` / `tool:change`                | troca de control/tool nos scene controls | `{ control, tool }`      |
| `scene:view`                                    | usuário troca a cena visualizada         | `{ sceneId }`            |
| `drag:start` / `drop`                           | drag & drop                              | `{ payload, zone? }`     |

> Estes são **eventos de cliente** (UI local), distintos do protocolo de fio do
> servidor (`ver 04-rede-e-sincronizacao.md`). O autosave da sheet **consome** o
> protocolo de `04` para emitir updates de Document; não inventa canal próprio.

### Pontos de extensão para sistemas

- `registerSheet(documentType, subtype, component, options)` — REQ-UIF-018.
- `registerBundle(locale, namespace, table)` — bundles de i18n por sistema (REQ-UIF-058).
- `registerSkin(scope, tokens)` — **[V2]** skins de tema por sistema (REQ-UIF-056).
- Registro de **scene controls/tools** adicionais por um sistema — coordenado com
  `ver 06-canvas-e-renderizacao.md` (a layer é do canvas; o botão é da UI).

---

## Dependências (specs irmãs)

- `ver 01-arquitetura-geral.md` — boot do cliente até `game.ready`; o shell monta
  após o cliente carregar o mundo.
- `ver 02-modelo-de-dados.md` — Documents, `(documentType, subtype)`, UUID,
  ownership levels, diff parcial que o autosave emite.
- `ver 04-rede-e-sincronizacao.md` — protocolo de update de Document que o autosave
  usa; updates remotos que as sheets refletem (REQ-UIF-024..025).
- `ver 05-usuarios-e-permissoes.md` — roles, avaliação de ownership que gateia
  sheets, controls e tooltips (REQ-UIF-004, 022, 037, 049).
- `ver 06-canvas-e-renderizacao.md` — layers ativadas pelos scene controls;
  drop de Document no canvas; acessibilidade do canvas.
- `ver 08-motor-de-rolagens.md` — execução server-side das inline rolls do editor
  (REQ-UIF-050).
- `ver 09-chat-e-mensagens.md`, `10-combate-e-iniciativa.md`,
  `12-journal-tabelas-cartas.md`, `13-audio-e-playlists.md` — conteúdo das tabs da
  sidebar.
- `ver 14-macros-e-automacao.md` — execução das macros da hotbar.
- `ver 15-api-de-sistemas.md` — contrato formal de `registerSheet` e demais
  registros que a UI expõe.
- `ver 16-compendiums-e-importacao.md` — compendium browser (tab da sidebar / modal).
- `ver 20-assets-e-midia.md` — backend do FilePicker (armazenamento, upload, tipos).
- `ver 21-seguranca.md` — sanitização de rich text e segurança de upload.
- `ver 23-acessibilidade-e-dispositivos.md` — detalhamento de WCAG, gestos touch,
  player mode, PWA, safe areas, teclado virtual; esta spec define o mínimo e aponta.
- `ver 44-aba-cenas.md` — painel de cenas da gaveta; pôr no ar (global, papel
  privilegiado) vs. preparo local, que delimitam o que a scene navigation pode fazer
  (REQ-UIF-005); diálogos de cena como janelas do window manager (DEC-CEN-09).

---

## Critérios de aceitação

1. Com um mundo aberto, o `<GameShell>` exibe canvas fullscreen, sidebar com tabs,
   scene controls, hotbar, scene navigation e player list; a sidebar colapsa/expande
   e o estado persiste após reload (REQ-UIF-001..002, 010).
2. É possível abrir duas sheets diferentes simultaneamente, arrastá-las,
   redimensioná-las, minimizar/restaurar, e clicar em uma traz ao foco (z-index
   correto). Reabrir a sheet de um Document já aberto foca a janela existente
   (REQ-UIF-009..016).
3. Editar um campo numa sheet persiste automaticamente (sem botão Salvar) com
   debounce; a UI mostra "salvando"/"salvo"; um update remoto do mesmo Document
   aparece na sheet sem derrubar o foco do campo em edição (REQ-UIF-024..025).
4. Um Document sem sheet registrada abre na sheet default genérica e é editável por
   quem tem permissão; um Document com `OBSERVER` abre read-only (REQ-UIF-019..022).
5. `Dialog.confirm` retorna `true`/`false`, é modal, fecha com `Esc`, e devolve o
   foco ao elemento anterior; toasts respeitam o limite de 5 e são anunciados por
   `aria-live` (REQ-UIF-027..030, 038..039).
6. Arrastar um Actor da sidebar para o canvas cria um token; arrastar um Item para
   uma sheet de Actor cria embedded; arrastar um Document para o editor cria um
   @link; cada fluxo valida permissão antes (REQ-UIF-026, 044..048).
7. No editor, um bloco secreto não aparece para um usuário não-GM, um @link abre o
   preview/sheet do Document, e um inline roll dispara uma rolagem server-side
   (REQ-UIF-048..051).
8. Alternar entre dark e light troca o tema sem reload e sem flash; ambos passam em
   contraste AA; nenhuma cor é o único portador de informação crítica
   (REQ-UIF-053..055, NF-005).
9. Trocar o locale para en traduz a UI; uma chave inexistente cai no fallback en e,
   por fim, exibe a própria chave; um teste detecta strings hard-coded
   (REQ-UIF-057..060, NF-006).
10. Em uma viewport de tablet (`≤ 1024px`, `pointer: coarse`), o player mode oculta
    scene controls de GM, maximiza o canvas e apresenta sheets como bottom drawers;
    alvos de toque têm ≥ 24×24 px; a UI é navegável por teclado com foco visível
    (REQ-UIF-061..064, NF-004).

---

## Questões em aberto

- **QA-UIF-01 — Edição colaborativa de rich text no MVP.** O research 08 §13
  documenta edição colaborativa em tempo real no Foundry (ProseMirror), mas a
  marcamos como **[V2]** (REQ-UIF-052). Confirmar se o MVP precisa apenas de
  "último a salvar vence" no campo de texto (mais simples) ou se a colaboração em
  tempo real é desejável já no MVP — decisão de produto.
- **QA-UIF-02 — Snap-to-grid / tiling de janelas.** O research 08 §14.1 sugere
  "sistema de tiles/abas nativo" e "snap-to-grid de janelas" como oportunidade.
  Decidir se entra no MVP (além de drag/resize livre) ou fica [V2]. Não
  especificado aqui além de manter a janela dentro da viewport (REQ-UIF-011).
- **QA-UIF-03 — Workspace por cena.** O research 08 §14.1 menciona "workspace por
  cena" (lembrar quais janelas estavam abertas por cena). Avaliar como feature de
  conveniência [V2]; impacto na persistência de janelas (DEC-UIF-10).
- **QA-UIF-04 — Mecanismo de "secret" no fio.** REQ-UIF-049 exige que conteúdo
  secreto não chegue a clientes sem permissão. Definir com `04`/`05`/`12` se o
  servidor filtra o HTML por usuário ao distribuir o Document (mais seguro, mais
  custoso) ou se o secret é apenas ocultado no cliente (mais simples, vazável via
  devtools). Recomendação preliminar: filtrar no servidor para Documents sensíveis
  (handouts/journal), decidir caso a caso em `12`.
- **QA-UIF-05 — Limite de debounce do autosave.** Default proposto: 400 ms. Validar
  empiricamente contra digitação em campos de texto longos vs. responsividade
  percebida; possivelmente diferente para inputs numéricos (flush mais cedo) vs.
  textareas.
- **QA-UIF-06 — Biblioteca de gestos touch.** O research 94 §12.1 sugere
  `@use-gesture/vanilla` ou implementação própria sobre Pointer Events para
  pan/pinch/long-press. A escolha concreta é de `ver 23-acessibilidade-e-dispositivos.md`;
  esta spec apenas exige Pointer Events (REQ-UIF-046b, NF-010).
- **QA-UIF-07 — Storage das preferências de cliente.** `ClientUIPreferences`
  (geometria de janelas, sidebar, hotbar) precisa de um backing store local
  (localStorage vs. IndexedDB). A escolha concreta fica em
  `ver 23-acessibilidade-e-dispositivos.md`. Preferências portáveis
  (keybindings, tema, locale, qualidade gráfica) são persistidas server-side
  por `userId` conforme DEC-A11-07 e REQ-A11-021 de `23` — não há dois
  donos: `ClientUIPreferences` cobre apenas dados de dispositivo local.

---

## Referências

Documentos de pesquisa usados (em `docs/research/`):

- `08-foundry-ui-aplicacoes.md` — estrutura de regiões da tela, sidebar/tabs, scene
  controls, hotbar, player list, scene navigation, framework de janelas
  (ApplicationV2 como referência conceitual), DialogV2, drag & drop, ContextMenu,
  Notifications, FilePicker, custom HTML elements, theming/CSS variables,
  ProseMirror, e as críticas de UX (gestão de janelas, z-index, acessibilidade) que
  orientam nossas decisões.
- `94-accessibility-mobile-tablet.md` — meta WCAG 2.2 AA, Pointer Events, hover-only
  affordances, container queries, player mode tablet, target size, `<dialog>`
  nativo, `:focus-visible`, `aria-live`, safe areas e teclado virtual.

Specs irmãs citadas ao longo do texto: `01`, `02`, `04`, `05`, `06`, `08`, `09`,
`10`, `12`, `13`, `14`, `15`, `16`, `20`, `21`, `23`.
