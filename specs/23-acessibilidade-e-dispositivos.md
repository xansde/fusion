# 23 — Acessibilidade e Dispositivos

- **Título:** Acessibilidade e Suporte a Dispositivos
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/94-accessibility-mobile-tablet.md`

> **Aviso clean-room.** Esta spec descreve decisões de design originais do Fusion. Onde menciona o Foundry VTT ou módulos de terceiros (TouchVTT, Mobile Improvements, Accessibility Enhancements), refere-se apenas a comportamentos e abordagens observáveis publicamente, usados como referência. Nenhum código proprietário é reproduzido.

---

## Objetivo

Definir as metas de acessibilidade (a11y) e os requisitos de suporte a dispositivos do Fusion VTT: conformidade WCAG 2.2 AA para a UI HTML, acessibilidade prática do canvas via overlay DOM, suporte a tablets touch como modo de jogo de primeira classe para jogadores, e toggles de qualidade gráfica para hardware de baixo desempenho. Esta spec também estabelece os critérios de teste de a11y por release.

O Fusion tem uma oportunidade clara de diferenciação: o Foundry VTT não possui estratégia de acessibilidade nativa abrangente, delegando tudo a módulos de terceiros. O Fusion integra acessibilidade no core.

---

## Escopo

### O que esta spec inclui

- Meta de conformidade WCAG 2.2 AA para toda a UI HTML (Svelte): contraste, teclado, ARIA, foco, atalhos remapeáveis.
- Alternativas acessíveis ao canvas: navegação por teclado entre tokens, lista de tokens navegável, ações via sheet e combat tracker.
- Limites práticos de acessibilidade do canvas (elemento `<canvas>` é opaco a screen readers) e a estratégia de overlay DOM via PixiJS accessibility system.
- Suporte a tablets e touch: Pointer Events API, gestos pan/zoom/drag/long-press, hit targets, layout responsivo do shell, bottom drawer, safe areas, teclado virtual.
- Modo "companion" em telefones [V2]: visualizar ficha e rolar dados.
- Performance em hardware fraco: toggles de qualidade de renderização.
- PWA (Progressive Web App) para jogadores em tablet.
- Critérios de teste de a11y por release.

### O que esta spec NÃO inclui

- Algoritmos de visão/iluminação/fog → `07-visao-iluminacao-fog.md`.
- Detalhes de renderização PixiJS (camadas, grupos, performance geral do canvas) → `06-canvas-e-renderizacao.md`.
- Theming dark/light e CSS custom properties → `11-ui-framework-e-fichas.md`.
- Pipeline de assets e formatos de textura (KTX2/Basis) → `20-assets-e-midia.md`.
- Segurança de inputs e sanitização → `21-seguranca.md`.
- Distribuição e instalação do servidor → `22-instalacao-e-distribuicao.md`.
- Layout detalhado do shell de UI (sidebar, hotbar, window manager) → `11-ui-framework-e-fichas.md`.

---

## Conceitos e terminologia

| Termo | Definição no Fusion |
|---|---|
| **WCAG 2.2 AA** | Web Content Accessibility Guidelines versão 2.2, nível AA — padrão legal amplamente adotado (ADA, EAA, Section 508). Meta de conformidade do Fusion para toda a UI HTML. |
| **Pointer Events API** | Standard W3C que unifica eventos de mouse, touch e caneta em um único modelo (`pointerdown`, `pointermove`, `pointerup`). Input layer obrigatório do canvas no Fusion. |
| **PixiJS Accessibility System** | Sistema opt-in do PixiJS v8 que cria uma div overlay com elementos DOM acessíveis (`role`, `aria-label`, `tabindex`) posicionados sobre os objetos no canvas, tornando-os alcançáveis por teclado e screen readers. |
| **touch-action** | Propriedade CSS que controla o comportamento de gestos nativo do browser sobre um elemento. O canvas deve usar `touch-action: none` (com tratamento especial para iOS Safari). |
| **safe-area-inset** | Variáveis CSS (`env(safe-area-inset-*)`) que expõem as margens seguras de dispositivos com notch/home bar (iPad com Face ID). Requer `viewport-fit=cover`. |
| **dvh** | Dynamic Viewport Height — unidade CSS que recalcula ao aparecer/ocultar o teclado virtual. Preferida sobre `vh` em Safari/iOS. |
| **Bottom drawer** | Painel deslizante a partir da borda inferior da tela — padrão mobile para conteúdo secundário (sheet do personagem, sidebar) sem cobrir o canvas. |
| **FAB** | Floating Action Button — botão circular flutuante para ações primárias em layout touch (abrir chat, sheet, rolls). |
| **Companion view** | Modo de visualização reduzido para telefones (telas < 640px): acesso à ficha do personagem e rolagem de dados sem canvas completo. Meta [V2]. |
| **Container Query** | CSS feature que permite que um componente responda ao tamanho do seu próprio container (não da viewport). Superior a media queries para componentes reutilizáveis como sheets. |
| **VirtualKeyboard API** | API web (Chrome 94+) que permite controlar a sobreposição do teclado virtual e acessar sua altura via `env(keyboard-inset-height)`. |
| **KTX2/Basis Universal** | Formato de textura comprimida que o PixiJS v8 transcreve automaticamente para ASTC (iOS), ETC2 (Android) ou BC7 (desktop), reduzindo uso de memória GPU em até 70%. |
| **BitmapText** | Alternativa ao `PIXI.Text` que usa uma textura de fonte pré-gerada em vez de criar um canvas 2D por instância. Preferido para labels de tokens em mobile. |
| **reduced-motion** | Preferência do SO (`prefers-reduced-motion`) que o Fusion respeita desativando animações não essenciais (zoom springs, transições de cena, partículas). |
| **focus-visible** | Pseudo-classe CSS que mostra o indicador de foco apenas para navegação por teclado, não para cliques com mouse. |

---

## Decisões

### DECISÃO-A11-01: Meta de conformidade — WCAG 2.2 AA para UI HTML; best-effort para canvas

**Decisão:** Toda a UI HTML (Svelte) do Fusion deve atingir conformidade WCAG 2.2 AA. O canvas PixiJS adota estratégia de "acessibilidade via alternativas": overlay DOM do PixiJS accessibility system para tokens e controles principais; opções textuais equivalentes (lista de tokens, combat tracker, sheets) para usuários que não podem interagir com o canvas.

**Alternativas rejeitadas:**
- *WCAG AAA completo:* aspiracional e não exigido legalmente; critérios de nível AAA impõem restrições incompatíveis com VTTs (ex.: nenhum limite de tempo).
- *Ignorar a11y no canvas:* o PixiJS v8 possui sistema de acessibilidade embutido de baixo custo; não usar seria desperdício e excluiria usuários com necessidades de teclado.
- *Conformidade apenas nível A:* insuficiente; não cobriria contraste (1.4.3), resize de texto (1.4.4), target size (2.5.8) ou focus visible (2.4.7).

**Racional:** Um `<canvas>` é opaco a screen readers por definição (critério 4.1.2 falha nativamente). Pesquisa acadêmica confirma que "web-based games can only be optimised to follow WCAG within limits of game rules" — gap documentado. A solução aceita pela indústria é prover alternativas acessíveis, não tentar tornar o canvas em si totalmente conforme. O Fusion opta por atingir o padrão legal AA na UI e usar as ferramentas disponíveis no canvas.

---

### DECISÃO-A11-02: Input layer unificado via Pointer Events API

**Decisão:** Toda a interação com o canvas usa exclusivamente a **Pointer Events API** (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`). Não haverá código que use `MouseEvent` ou `TouchEvent` diretamente no canvas.

**Alternativas rejeitadas:**
- *MouseEvent + TouchEvent separados:* duplicação de código, bugs de sincronização, não cobre canetas stylus.
- *Biblioteca de gesture de alto nível (Hammer.js):* abandonada; sem suporte ativo em 2026.

**Racional:** A Pointer Events API é o standard W3C com suporte universal em todos os browsers modernos. Fornece `event.pointerType` ('mouse'/'touch'/'pen'), suporte a multi-touch via `pointerId`, e propriedades de hardware para canetas. O módulo TouchVTT (referência do ecossistema Foundry) migrou completamente para Pointer Events em sua versão 2.0. A unificação elimina branching de código e garante comportamento consistente independentemente do dispositivo de entrada.

---

### DECISÃO-A11-03: Layout responsivo em dois modos — GM desktop e Jogador tablet

**Decisão:** O Fusion define dois modos de layout baseados em media query composta `(max-width: 1024px) and (pointer: coarse)`:
- **Modo GM (desktop):** layout completo — sidebar, scene controls, hotbar, player list, todas as ferramentas visíveis.
- **Modo Jogador Tablet:** canvas ocupa 100% da viewport; scene controls de GM ocultos; sidebar colapsada por padrão, acessível via FAB ou swipe from edge; sheets como bottom drawers; notificações no topo.

A detecção é feita via `MediaQuery` reativa do Svelte 5 (`import { MediaQuery } from 'svelte/reactivity'`), exposta como store global `$deviceMode: 'desktop' | 'tablet' | 'mobile'`. O modo `mobile` usa a media query `(hover: none) and (pointer: coarse) and (max-width: 639px)` — combinação de tipo de ponteiro e largura — em vez de `window.innerWidth` imperativo, garantindo reatividade a resize sem listener adicional.

**Alternativas rejeitadas:**
- *Apenas media queries em CSS:* não permite lógica condicional em componentes Svelte (ex.: renderizar drawer em vez de janela flutuante).
- *Breakpoint só por largura:* tablets com mouse externo (iPad + Magic Keyboard) usariam layout touch erroneamente; `pointer: coarse` discrimina melhor o tipo de input.
- *`window.innerWidth` imperativo no derived:* não reage a resize sem listener registrado manualmente; MediaQuery reativa do Svelte 5 resolve o mesmo problema de forma idiomática e sem efeitos colaterais.

**Racional:** O Foundry nunca projetou sua UI para touch; toda adaptação é via módulos (Mobile Improvements). O Fusion faz a distinção no core, sem camada de compatibilidade. O critério `pointer: coarse` identifica a presença de tela touch como input principal, não o tamanho de tela.

---

### DECISÃO-A11-04: `<dialog>` nativo para modais bloqueantes; window manager próprio para janelas flutuantes

**Decisão:** O Fusion separa dois mecanismos de janela conforme a natureza do conteúdo (ver **DEC-UIF-02** em `11-ui-framework-e-fichas.md`):

- **`<dialog>` com `.showModal()`:** usado exclusivamente para modais bloqueantes — confirm dialogs, compendium browser quando bloqueante e file picker. Provê gratuitamente focus trap automático, fechamento com Escape, `role="dialog"` implícito e backdrop acessível.
- **Window manager próprio em Svelte:** usado para janelas flutuantes não-modais — character sheets, browsers de Document e qualquer Application que possa coexistir empilhada com outras. O window manager controla posição, z-index e foco (ver `11-ui-framework-e-fichas.md`, REQ-UIF-009..016). A acessibilidade dessas janelas (ordem de foco ao abrir, devolução de foco ao fechar, Escape para fechar) é responsabilidade do próprio window manager, não do `.showModal()`.

**Alternativas rejeitadas:**
- *Tudo em `<dialog>.showModal()`:* `.showModal()` trava o foco e impede múltiplas janelas não-modais sobrepostas — o caso de uso central do VTT (várias sheets abertas ao mesmo tempo). Um modal bloqueia interação com o resto da UI, que é incompatível com o fluxo de jogo.
- *`<dialog>` não-modal para janelas flutuantes:* não dá z-index/foco coordenado entre instâncias; não tem focus trap automático; não é suportado como solução robusta para window managers.
- *Biblioteca externa de modal (ex.: Radix, Headless UI):* overhead desnecessário dado que Svelte 5 compila componentes sem virtual DOM; `<dialog>` nativo cobre os modais bloqueantes com custo zero.

**Racional:** Separar as duas necessidades — janelas persistentes empilháveis (manager próprio) vs. modais bloqueantes acessíveis (`<dialog>` nativo) — dá o melhor de cada mecanismo. Isso atende critérios WCAG 2.4.3 (Focus Order) e 2.1.1 (Keyboard) sem código adicional nos modais, e dá controle total de UX nas janelas flutuantes.

---

### DECISÃO-A11-05: `touch-action: none` no canvas com fallback para iOS Safari

**Decisão:** O canvas recebe `touch-action: none` via CSS. Para iOS Safari (onde `none` pode não funcionar de forma confiável), event listeners são registrados com `{ passive: false }` para chamar `preventDefault()` nos gestos gerenciados pelo app.

**Alternativas rejeitadas:**
- *Apenas `touch-action: manipulation`:* desabilita double-tap zoom mas permite scroll nativo, que interfere com pan do canvas.
- *Confiar apenas em `touch-action: none`:* documentado como não confiável no iOS Safari; causaria scroll/zoom indesejado do browser.

**Racional:** A Pointer Events API não controla automaticamente o comportamento de gestos nativo do browser. `touch-action: none` é necessário para suprimir pan/zoom do browser durante interações com o canvas. O iOS Safari exige a abordagem de `preventDefault()` como fallback. A combinação das duas estratégias cobre todos os browsers suportados.

---

### DECISÃO-A11-06: Altura com `dvh` e `viewport-fit=cover`

**Decisão:** A altura do container principal da aplicação usa `100dvh` (Dynamic Viewport Height). O viewport meta inclui `viewport-fit=cover` e o layout respeita `env(safe-area-inset-*)`.

```html
<meta name="viewport" content="width=device-width, initial-scale=1,
  viewport-fit=cover, interactive-widget=resizes-visual">
```

**Alternativas rejeitadas:**
- *`100vh`:* No Safari/iOS inclui a barra de endereço e causa overflow visual; incompatível com Full Screen Mode.
- *`interactive-widget=resizes-content`:* Faz o canvas recalcular quando o teclado virtual aparece, causando reflow custoso.

**Racional:** `dvh` foi criado exatamente para o problema de `vh` em mobile browsers. `resizes-visual` permite que o canvas permaneça estável enquanto apenas a região visual encolhe quando o teclado virtual aparece — comportamento ideal para aplicações canvas.

---

### DECISÃO-A11-07: KeybindingRegistry com defaults fixos no MVP; remapeamento em [V2]

**Decisão:** Um registro central de keybindings (`KeybindingRegistry`) mapeia `action` → `(key, modifiers)`. No MVP, cada ação tem um default fixo não-remapeável pelo usuário. Em [V2], o usuário poderá sobrescrever via painel de configurações, com persistência por usuário no banco (REQ-A11-021..022).

**Alternativas rejeitadas:**
- *Atalhos completamente hardcoded (sem registro central):* não permite adicionar o remapeamento em [V2] sem refatoração; impossibilita suspensão contextual de atalhos (REQ-A11-023).
- *Remapeamento completo no MVP:* o painel de UI de remapeamento com detecção de conflitos não é necessário para jogar uma sessão de PF2e; a complexidade é desproporcionada ao valor para o MVP.
- *Apenas documentar os atalhos:* não resolve o problema de acessibilidade; a remapagem deve ser nativa — mas pode aguardar [V2].

**Racional:** Centralizar os bindings no `KeybindingRegistry` desde o MVP garante que a suspensão contextual de atalhos (REQ-A11-023) e a futura UI de remapeamento [V2] sejam implementadas sobre a mesma infraestrutura. Game Accessibility Guidelines listam remapeamento como diretriz "Basic" — o MVP cumpre o requisito com defaults corretos; o painel de configuração expande isso em [V2].

---

### DECISÃO-A11-08: Toggles de qualidade de renderização

**Decisão:** O Fusion expõe um painel de configurações de qualidade gráfica com toggles independentes, persistidos por usuário:
- `lights.animated` — animar luzes (flickering, pulsating); default `true`.
- `fog.quality` — qualidade do fog of war: `'full'` | `'simplified'` | `'off'`; default `'full'`.
- `canvas.antialias` — antialiasing do renderer PixiJS; default `false` em `devicePixelRatio >= 2`.
- `canvas.resolution` — resolução de renderização: `1.0` | `0.75` | `0.5`; default `window.devicePixelRatio` capped em `2`.
- `tokens.animatedPortraits` — animar portraits (vídeos/GIFs) nos tokens; default `true`.
- `canvas.particleEffects` — efeitos de partículas (chuva, névoa animada, faíscas); default `true`.

**Alternativas rejeitadas:**
- *Preset único "baixa qualidade":* menos granular; pode desabilitar algo que o usuário quer manter (ex.: quer fog simplificado mas não quer perder animação de luz).
- *Detecção automática sem controle do usuário:* heurísticas de GPU são não confiáveis; melhor deixar o usuário decidir.

**Racional:** Dispositivos de jogadores variam enormemente — desde iPads M4 recentes a laptops com GPUs integradas de 5 anos. Toggles independentes dão controle preciso sem obrigar o usuário a escolher entre "tudo" e "nada". `prefers-reduced-motion` do OS é respeitado automaticamente como ponto de partida (se ativo, `lights.animated` e `canvas.particleEffects` iniciam como `false`).

---

### DECISÃO-A11-09: PWA com Web App Manifest [V2]

**Decisão:** O Fusion servirá, em V2, um `manifest.webmanifest` com `display: standalone`, `orientation: landscape` e ícones, e registrará um Service Worker que cacheia o app shell. Dados de jogo ao vivo (state, tokens, mapa) não são cacheados pelo Service Worker.

**Por que [V2]:** A definição de MVP é "jogar uma sessão de PF2e com mapa+grid, tokens, visão/fog, fichas, rolagens, chat e combat tracker". PWA e Service Worker não são necessários para jogar essa sessão — são polimento que melhora a experiência de instalação e recarga offline, mas não desbloqueiam nenhuma funcionalidade de jogo. O research 94 §12.1 item 4 afirma explicitamente que "o modo standalone é bonus, não requisito".

**Alternativas rejeitadas:**
- *Sem PWA nunca:* jogadores perdem a opção de instalar na home screen e fullscreen imersivo no longo prazo.
- *Service Worker cacheando dados de jogo:* dados ao vivo mudam continuamente via WebSocket; cachear causaria inconsistências.

**Racional:** PWA melhora a experiência do jogador em tablet sem exigir app store, mas é um incremento de polimento. As limitações do iOS (EU: PWA abre no Safari; sem install prompt automático; cache de 7 dias/50MB) reduzem ainda mais o impacto no público primário. Priorizar MVP funcional antes de investir na infraestrutura de Service Worker.

---

## Requisitos funcionais

### Acessibilidade geral — UI HTML (Svelte)

**REQ-A11-001** [MVP] O Fusion deve incluir um skip link como primeiro elemento focável da página com texto "Ir para o conteúdo principal", visível apenas ao receber foco, que transporta o foco para `#main-content`.

**REQ-A11-002** [MVP] Todo texto de UI deve ter razão de contraste mínima de 4,5:1 em relação ao fundo (WCAG 1.4.3 AA para texto normal) e 3:1 para texto grande (≥18pt ou ≥14pt bold). Isso se aplica a ambos os temas dark e light.

**REQ-A11-003** [MVP] Ícones e elementos não-texto de UI (botões de ação, indicadores de status de token, barras de HP, ícones de condição) devem ter contraste mínimo de 3:1 em relação ao fundo adjacente (WCAG 1.4.11).

**REQ-A11-004** [MVP] Nenhuma informação crítica de jogo deve ser transmitida exclusivamente por cor. As cinco condições de combate básicas do MVP (atordoado, caído, agarrado, morrendo, inconsciente), estado de HP (saudável/ferido/morto), indicadores de turno no combat tracker e resultados de rolagem (sucesso/falha/crítico) devem usar ícone ou texto junto à cor. O conjunto canônico de condições PF2e (maior que este subconjunto mínimo) é definido em `17-sistema-pf2e.md`.

**REQ-A11-005** [MVP] Toda a UI HTML (sidebar, sheets, diálogos, chat, hotbar, scene controls) deve ser totalmente navegável por teclado via Tab/Shift+Tab, com indicador de foco visível (`:focus-visible`) em todos os elementos interativos.

**REQ-A11-006** [MVP] A ordem de foco por Tab deve ser logicamente consistente com a ordem visual. Sheets abertas devem receber foco antes do conteúdo de fundo; o foco não deve "vazar" para elementos cobertos por modais.

**REQ-A11-007** [MVP] Modais bloqueantes (diálogos de confirmação, compendium browser quando bloqueante, file picker) devem usar `<dialog>` nativo com `.showModal()`, garantindo focus trap automático e fechamento via Escape. Character sheets e demais janelas flutuantes são geridas pelo window manager próprio (ver DEC-UIF-02 em `11-ui-framework-e-fichas.md`); sua acessibilidade — foco ao abrir, devolução de foco ao fechar, fechamento via Escape — é responsabilidade do window manager.

**REQ-A11-008** [MVP] Todo elemento interativo da UI deve ter nome acessível via `aria-label`, `aria-labelledby` ou texto visível. Botões de ícone sem texto visível devem ter `aria-label` descritivo (ex.: `aria-label="Rolar dados"`).

**REQ-A11-009** [MVP] Regiões semânticas da página devem usar elementos HTML corretos: `<nav>` para a sidebar de navegação, `<main>` para a área do canvas + painel principal, `<section>` para grupos de controles nomeados, `<dialog>` para modais.

**REQ-A11-010** [MVP] Estados dinâmicos de componentes devem ser anunciados via ARIA: `aria-expanded` em accordions/dropdowns, `aria-live="polite"` no chat e em notificações não urgentes, `aria-live="assertive"` para alertas críticos (ex.: personagem atingiu 0 HP), `aria-disabled` em controles inabilitados.

**REQ-A11-011** [MVP] O texto da interface deve ser redimensionável até 200% via zoom do browser sem perda de conteúdo ou funcionalidade (WCAG 1.4.4). Usar unidades `rem`/`em` para tipografia; evitar `px` fixo em tamanhos de fonte.

**REQ-A11-012** [MVP] O Fusion deve respeitar a preferência `prefers-reduced-motion` do sistema operacional. Quando ativa, desativar automaticamente: animações de zoom springs no canvas, transições de abertura/fechamento de janelas, efeitos de partículas, animação de luzes (flickering), animações de portraits.

**REQ-A11-013** [MVP] O Fusion deve suportar o modo de alto contraste do sistema operacional (`prefers-contrast: more`) sem quebrar a interface. Testar com Windows High Contrast Mode e macOS Increase Contrast.

**REQ-A11-014** [MVP] Todos os campos de formulário (sheets, configurações, diálogos) devem ter `<label>` associado via `for`/`id` ou `aria-labelledby`. Campos obrigatórios devem ter `aria-required="true"`. Erros de validação devem ser anunciados via `aria-describedby` ou `aria-errormessage`.

**REQ-A11-015** [MVP] Imagens de conteúdo (portraits de personagem, artwork de itens, ilustrações de spell) devem ter `alt` descritivo. Imagens decorativas devem ter `alt=""`.

**REQ-A11-016** [MVP] O compilador Svelte 5 emite warnings de acessibilidade em tempo de build (imagens sem `alt`, labels ausentes, roles incorretos). Nenhum warning de a11y do compilador deve ser suprimido sem justificativa documentada no código.

---

### Atalhos de teclado e remapeamento

**REQ-A11-020** [MVP] O Fusion deve implementar um `KeybindingRegistry` centralizado que mapeia ações nomeadas para combinações de tecla padrão fixas. Ações obrigatórias incluem: navegar entre tokens no canvas (`Tab`/`Shift+Tab`), mover token selecionado (setas), abrir sheet do token selecionado (`Enter`/`E`), abrir chat (`C`), abrir combat tracker (`I`), fechar janela ativa (`Escape`), deselecionar tudo (`Escape` sem foco em campo). No MVP os bindings são os defaults do registry — sem UI de remapeamento.

**REQ-A11-021** [V2] O usuário deve poder remapear qualquer ação do `KeybindingRegistry` via painel de configurações de controles. A configuração é persistida por usuário no banco.

**REQ-A11-022** [V2] O painel de remapeamento deve detectar e avisar sobre conflitos de atalho (mesma combinação mapeada para duas ações no mesmo contexto).

**REQ-A11-023** [MVP] Atalhos de teclado não devem interferir com a digitação normal em campos de texto. O sistema deve suspender atalhos de cena quando o foco está em `<input>`, `<textarea>`, `[contenteditable]` ou dentro de `<dialog>`.

**REQ-A11-024** [V2] O Fusion deve expor um painel de referência de todos os atalhos ativos, acessível via `?` ou menu de ajuda, com os bindings atuais do usuário.

---

### Acessibilidade do canvas

**REQ-A11-030** [MVP] O elemento `<canvas>` do mapa deve ter `role="img"` e `aria-label` descrevendo a cena ativa (ex.: `aria-label="Mapa: Taverna do Cervo Negro"`), atualizado ao trocar de cena.

**REQ-A11-031** [MVP] O PixiJS Accessibility System deve ser habilitado no renderer do canvas (`enabledByDefault: true`, `activateOnTab: true`). Tokens de jogador devem ter `accessible = true`, `accessibleTitle` com o nome do token, `accessibleHint` com HP atual e condições relevantes, `accessibleType = 'button'` e `tabIndex` definido.

**REQ-A11-032** [MVP] Tokens de NPCs visíveis ao jogador devem ser acessíveis via overlay DOM com `accessibleTitle` (nome) e `accessibleHint` (informações públicas: nível de ameaça, condições visíveis). Tokens ocultos (hidden layer) devem ser excluídos do overlay de acessibilidade para não-GMs.

**REQ-A11-033** [MVP] A navegação por Tab entre tokens no canvas deve seguir uma ordem lógica (esquerda-para-direita, topo-para-baixo por posição na cena). O token focado deve ter indicador visual de foco (ring de destaque) além do overlay DOM.

**REQ-A11-034** [MVP] Deve existir uma **Lista de Tokens** (token list panel) na sidebar que exiba todos os tokens da cena com nome, HP, condições e botões de ação (selecionar, abrir sheet, rolar ataque). Esta lista é a alternativa acessível primária ao canvas para usuários que não podem interagir com o elemento gráfico.

**REQ-A11-035** [MVP] O Combat Tracker deve ser operável inteiramente por teclado: navegar entre combatentes por setas, avançar turno via `Enter` ou botão com label acessível, acessar ações do combatente via menu de contexto ativável por teclado.

**REQ-A11-036** [MVP] Toda ação disponível via drag-and-drop no canvas ou UI deve ter uma alternativa não-drag: adicionar item a personagem via botão/menu no compendium, mover token para célula via campo de coordenadas na sheet, aplicar condição via menu de contexto.

---

### Suporte touch e tablet

**REQ-A11-040** [MVP] Toda interação com o canvas deve usar exclusivamente a **Pointer Events API**. Nenhum handler direto de `TouchEvent` ou `MouseEvent` deve existir no canvas (ver DECISÃO-A11-02).

**REQ-A11-041** [MVP] O canvas deve suportar os seguintes gestos touch fundamentais via Pointer Events:

| Gesto | Ação | Nível |
|---|---|---|
| Arrastar 1 dedo sobre token (logo após `pointerdown`) | Mover token (se owner/GM) | [MVP] |
| Pinch 2 dedos | Zoom do canvas (inward = zoom in, outward = zoom out) | [MVP] |
| Pan 2 dedos | Navegar o canvas | [MVP] |
| Tap em token | Selecionar token | [MVP] |
| Tap fora de token | Deselecionar | [MVP] |
| Long-press 500ms sobre token | Abrir menu de contexto (equivalente ao right-click) | [MVP-stretch] |
| Double-tap em token | Abrir sheet do token | [MVP-stretch] |

**[MVP-stretch]:** Implementar se validado em hardware real antes do freeze de MVP; caso contrário promovido a [V2]. O zoom via pinch com âncora no ponto médio dos dois dedos (Questão 2) requer validação em dispositivos reais — no MVP o zoom pode usar o centro da tela como âncora se a âncora de gesto não for validada a tempo.

**REQ-A11-042** [MVP] O canvas deve ter `touch-action: none` via CSS, com listeners registrados como `{ passive: false }` para suporte a iOS Safari (ver DECISÃO-A11-05).

**REQ-A11-043** [MVP] O layout em modo tablet (`deviceMode === 'tablet'`) deve: maximizar o canvas para 100% da viewport; ocultar scene controls de GM; colapsar a sidebar por padrão; renderizar um FAB no canto inferior direito para acesso rápido a chat/sheet/rolls; exibir sheets como bottom drawers, não como janelas flutuantes.

**REQ-A11-044** [MVP] Todo elemento interativo da UI (botões, tabs, inputs, ícones de ação, macros da hotbar) deve ter área de toque mínima de 44×44 CSS pixels (Apple HIG) em modo tablet e 24×24 CSS pixels em modo desktop (WCAG 2.5.8). Usar padding para aumentar área de toque sem alterar tamanho visual quando necessário.

**REQ-A11-045** [MVP] A sidebar em modo tablet deve ser colapsável/expansível via: swipe from the right edge (gesto de pan a partir de ≤ 24px da borda direita), toque no FAB, e botão dedicado no topo. O estado (colapsada/expandida) é persistido por sessão.

**REQ-A11-046** [MVP] A UI deve detectar hover-only affordances e prover alternativas para touch. Especificamente:
- Tooltips que aparecem ao hover devem também aparecer ao long-press.
- Botões de ação que aparecem ao hover sobre um token devem ter representação permanente no HUD do token quando em modo tablet.
- Fórmulas de dados visíveis ao hover devem ser exibidas permanentemente em modo tablet.

**REQ-A11-047** [MVP] A detecção de modo touch deve usar CSS media query `(hover: none) and (pointer: coarse)` via `MediaQuery` reativa do Svelte 5, exposta como `$isTouchDevice`. Componentes devem usar essa flag para adaptar comportamento (não apenas CSS).

**REQ-A11-048** [MVP] O viewport meta deve incluir `interactive-widget=resizes-visual` para evitar reflow do canvas quando o teclado virtual aparece. A altura do container deve usar `100dvh`.

**REQ-A11-049** [MVP] O layout deve respeitar `env(safe-area-inset-*)` com `viewport-fit=cover` para iPads com Face ID. Nenhum controle de UI deve ser posicionado na área de notch ou home bar.

**REQ-A11-050** [MVP] Quando um campo de texto (chat input, campo de busca, campo em sheet) receber foco em dispositivo touch, o campo deve scrollar para cima para ficar visível acima do teclado virtual. Implementar via VirtualKeyboard API (`navigator.virtualKeyboard.overlaysContent = true`) quando disponível, com fallback de scroll nativo.

**REQ-A11-051** [MVP] O zoom do canvas via pinch deve respeitar os limites mínimo/máximo de zoom da cena. O eixo focal do pinch (ponto de convergência dos dedos) deve ser o ponto de referência do zoom (zoom centrado no gesto, não no centro da tela).

**REQ-A11-052** [V2] Em tablets com stylus (Apple Pencil, Samsung S Pen), o Fusion deve detectar `event.pointerType === 'pen'` e ativar ferramentas de drawing (freehand, shapes) automaticamente quando o stylus é detectado na área do canvas.

---

### Modo companion para telefones

**REQ-A11-060** [V2] O Fusion deve oferecer um modo "companion" para viewports < 640px (telefones). Neste modo: o canvas completo não é exibido; o jogador pode visualizar e interagir com a ficha do personagem ativo; pode enviar mensagens no chat; pode executar rolagens de dados; recebe notificações de turno no combat tracker.

**REQ-A11-061** [V2] No modo companion, o layout deve ser single-column, com navegação por tabs na parte inferior (Ficha | Rolagens | Chat | Inventário). Todas as ações de combate básicas (atacar, defender, usar item) devem ser acessíveis via botões na aba "Rolagens".

**REQ-A11-062** [V2] O modo companion deve funcionar em orientação portrait e landscape.

---

### Performance em hardware fraco

**REQ-A11-070** [MVP] O Fusion deve expor um painel de configurações de qualidade gráfica acessível via menu de configurações → "Desempenho". Os toggles definidos em DECISÃO-A11-08 devem ser persistidos por usuário.

**REQ-A11-071** [MVP] Ao detectar `prefers-reduced-motion: reduce` no sistema operacional, o Fusion deve inicializar com `lights.animated = false` e `canvas.particleEffects = false`. O usuário pode sobrescrever via painel de desempenho.

**REQ-A11-072** [MVP] O renderer PixiJS v8 deve ser inicializado via `await app.init({ antialias: false, resolution, preference: 'webgpu' })` com `antialias: false` quando `window.devicePixelRatio >= 2` (heurística de GPU mobile). Em WebGL o custo de MSAA difere do WebGPU — o toggle deve desativar antialias independentemente do backend detectado. O usuário pode habilitar antialias via painel de desempenho.

**REQ-A11-073** [MVP] A resolução de renderização do canvas deve ser cap em `2.0` independentemente do `devicePixelRatio` real do dispositivo, para limitar o custo de fill rate em dispositivos com DPR alto (ex.: iPad Pro DPR=2). Configurável no painel de desempenho. Exemplo de inicialização:

```typescript
const app = new Application();
await app.init({
  antialias: canvasAntialias,
  resolution: Math.min(window.devicePixelRatio, 2),
  preference: 'webgpu', // fallback automático para WebGL se WebGPU indisponível
});
```

**REQ-A11-074** [MVP] Labels de tokens (nameplate, HP, condições) devem usar `PIXI.BitmapText` em vez de `PIXI.Text` para evitar proliferação de contextos 2D em dispositivos com limite de contextos (especialmente iOS, que limita a ~16 contextos WebGL). Ver `06-canvas-e-renderizacao.md`.

**REQ-A11-075** [MVP] Quando a qualidade do fog estiver em `'simplified'`, o motor de fog deve renderizar apenas a área não explorada como overlay sólido semi-opaco sem union de polígonos clip. O algoritmo de visibility polygon continua rodando, mas sem o passo de clipper union. Ver `07-visao-iluminacao-fog.md`.

**REQ-A11-076** [MVP] Quando `fog.quality === 'off'`, o fog of war é desabilitado completamente e todos os tiles/tokens ficam visíveis (útil para hardware muito limitado ou preferência do GM em sessões de teste).

**REQ-A11-077** [MVP] O Fusion deve exibir um aviso na primeira vez que um usuário abre uma cena com mapa de alta resolução em dispositivo com `devicePixelRatio >= 2` e memória GPU estimada baixa (`navigator.deviceMemory < 4`), sugerindo reduzir a qualidade das texturas.

---

### PWA

**REQ-A11-080** [V2] O servidor Fusion deve servir um `manifest.webmanifest` válido com `display: standalone`, `orientation: landscape`, ícones nas resoluções 192×192 e 512×512 (PNG), `background_color` e `theme_color` alinhados ao tema dark do Fusion.

**REQ-A11-081** [V2] O Fusion deve registrar um Service Worker que cacheia o app shell (HTML principal, bundle JS/CSS, fontes, ícones de UI) usando estratégia Cache First. Assets de sistema PF2e/SF2e/Etmos (tokens, portraits padrão, ícones de condição) devem ser cacheados com estratégia Stale While Revalidate.

**REQ-A11-082** [V2] O Service Worker não deve cachear dados de jogo ao vivo: state da cena, tokens dinâmicos, mensagens de chat, uploads de assets do usuário. Esses dados trafegam via WebSocket e são responsabilidade do servidor.

**REQ-A11-083** [V2] Quando o servidor não está acessível e o app shell está em cache, o Service Worker deve exibir uma tela de erro amigável com mensagem de que o servidor está offline — não uma tela em branco.

---

## Requisitos não-funcionais

**REQ-A11-NF-001** O carregamento inicial do app shell (HTML + JS bundle principal) deve completar em < 3s em conexão 4G simulada (25 Mbps download). [V2] O Service Worker deve reduzir recargas subsequentes para < 500ms.

**REQ-A11-NF-002** Em dispositivos com `navigator.deviceMemory <= 2` GB (tablets entry-level), o Fusion deve manter uso de memória GPU abaixo de 400 MB em cenas de tamanho normal (mapa ≤ 4096×4096 px, ≤ 50 tokens).

**REQ-A11-NF-003** O painel de desempenho com todos os toggles de qualidade no nível mais baixo deve permitir que o Fusion rode de forma jogável (≥ 30 fps) em hardware de 5 anos com GPU integrada (ex.: Intel UHD 620).

**REQ-A11-NF-004** Nenhum teste de a11y automatizado (axe-core) pode falhar na suite CI para os componentes de UI HTML. Warnings são permitidos apenas com `data-a11y-skip` e comentário justificando.

**REQ-A11-NF-005** O WCAG 2.2 AA checklist completo (50 critérios) deve ser revisado manualmente a cada milestone de release por pelo menos um membro da equipe.

---

## Modelo de dados

```typescript
// packages/shared/src/types/accessibility.ts

/** Configurações de qualidade gráfica por usuário */
export interface UserQualitySettings {
  /** Animar luzes (flickering, pulsating). Default: true */
  lightsAnimated: boolean;
  /** Qualidade do fog of war. Default: 'full' */
  fogQuality: 'full' | 'simplified' | 'off';
  /** Antialiasing do renderer PixiJS. Default: false em DPR >= 2 */
  canvasAntialias: boolean;
  /** Resolução de renderização (fração do devicePixelRatio). Default: 1.0 capped em DPR 2 */
  canvasResolution: 1.0 | 0.75 | 0.5;
  /** Animar portraits de tokens (GIFs/vídeos). Default: true */
  tokensAnimatedPortraits: boolean;
  /** Efeitos de partículas no canvas. Default: true */
  canvasParticleEffects: boolean;
}

/** Configuração de keybinding de uma ação */
export interface KeybindingEntry {
  /** Identificador único da ação (ex: 'canvas.nextToken', 'window.close') */
  actionId: string;
  /** Tecla principal (ex: 'Tab', 'Enter', 'ArrowLeft', 'c', 'Escape') */
  key: string;
  /** Modificadores ativos */
  modifiers: {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
  };
}

/** Registro de customização de atalhos de um usuário */
export interface UserKeybindings {
  userId: string;
  /** Overrides dos defaults; ações sem entrada usam o default do KeybindingRegistry */
  bindings: KeybindingEntry[];
}

/** Ação registrável no KeybindingRegistry */
export interface KeybindingAction {
  actionId: string;
  /** Label legível para exibir no painel de controles */
  label: string; // i18n key
  /** Contexto em que o atalho é ativo */
  context: 'global' | 'canvas' | 'chat' | 'sheet';
  /** Default binding */
  default: Omit<KeybindingEntry, 'actionId'>;
  /** Callback a executar quando o binding é acionado */
  handler: () => void | Promise<void>;
}

/** Modo de dispositivo detectado */
export type DeviceMode = 'desktop' | 'tablet' | 'mobile';

/** Store reativo global de estado de dispositivo */
export interface DeviceState {
  mode: DeviceMode;
  isTouchDevice: boolean;
  hasHover: boolean;
  /** CSS pixels — viewport atual */
  viewportWidth: number;
  viewportHeight: number;
  /** devicePixelRatio, capped em 2 para cálculos de performance */
  dpr: number;
}
```

---

## API e eventos

### Store global de dispositivo

```typescript
// packages/client/src/stores/device.ts
import { MediaQuery } from 'svelte/reactivity';

const touchQuery = new MediaQuery('(hover: none) and (pointer: coarse)');
const tabletQuery = new MediaQuery('(max-width: 1024px) and (pointer: coarse)');
// Usa MediaQuery para reagir a resize sem polling imperativo.
// O gate de 'mobile' combina largura E altura para cobrir telefones em
// landscape (largura > 640px mas altura pequena) sem falso-positivo em
// desktop redimensionado com mouse (touchQuery exclui pointer: fine).
const mobileQuery = new MediaQuery(
  '(hover: none) and (pointer: coarse) and (max-width: 639px)'
);

export const deviceMode: Readable<DeviceMode> = derived(
  [mobileQuery, tabletQuery],
  ([$mobile, $tablet]) => {
    if ($mobile.current) return 'mobile';
    if ($tablet.current) return 'tablet';
    return 'desktop';
  }
);

export const isTouchDevice: Readable<boolean> = derived(
  touchQuery,
  ($q) => $q.current
);
```

### KeybindingRegistry

```typescript
// packages/client/src/services/KeybindingRegistry.ts

class KeybindingRegistry {
  /** Registra uma ação com seu default binding */
  register(action: KeybindingAction): void;

  /** Aplica customizações de um usuário */
  applyUserBindings(bindings: UserKeybindings): void;

  /** Detecta conflitos no contexto */
  getConflicts(context: KeybindingAction['context']): Array<{
    actionA: string;
    actionB: string;
    binding: KeybindingEntry;
  }>;

  /** Retorna a entrada atualizada para exibir no painel */
  getAll(): KeybindingAction[];

  /** Handler global de keydown — dispatcher central */
  handleKeyDown(event: KeyboardEvent): void;
}

export const keybindings = new KeybindingRegistry();
```

### Eventos de acessibilidade do canvas

```typescript
// Emitidos pelo CanvasAccessibilityBridge (wrapper do PixiJS a11y system)

/** Emitido quando o foco de teclado muda de token */
interface TokenFocusEvent {
  type: 'token:focus';
  tokenId: string;
  tokenName: string;
  hp: { current: number; max: number } | null;
  conditions: string[];
}

/** Emitido quando token recebe "click" via teclado (Enter/Space) */
interface TokenActivateEvent {
  type: 'token:activate';
  tokenId: string;
}
```

---

## Dependências

- **`06-canvas-e-renderizacao.md`** — hierarquia de grupos PixiJS, modelo de tokens e interação; o sistema de acessibilidade do PixiJS é uma camada sobre a renderização de tokens definida lá.
- **`07-visao-iluminacao-fog.md`** — a qualidade `fog.quality` afeta o algoritmo de fog; a spec de fog deve expor um modo `'simplified'` e um modo `'off'` compatíveis com os toggles definidos aqui.
- **`11-ui-framework-e-fichas.md`** — shell da aplicação, window manager, theming; os layouts tablet (bottom drawer, FAB, sidebar colapsável) são variantes do shell definido lá.
- **`05-usuarios-e-permissoes.md`** — `KeybindingRegistry` e `UserQualitySettings` são dados por usuário persistidos no banco; a autenticação e o modelo de usuário são definidos lá.
- **`20-assets-e-midia.md`** — compressão de texturas (KTX2/Basis), limite de 3840px para texturas de mapa, uso de BitmapText são tratados como pipeline de assets; esta spec apenas consume as decisões de lá.
- **`10-combate-e-iniciativa.md`** — Combat Tracker é uma das alternativas acessíveis ao canvas (REQ-A11-035); sua navegação por teclado é dependência desta spec.
- **`04-rede-e-sincronizacao.md`** — [V2] Service Worker não deve cachear dados de jogo ao vivo que trafegam via WebSocket.
- **`22-instalacao-e-distribuicao.md`** — [V2] o servidor deve servir o `manifest.webmanifest` e os headers corretos (`Content-Type: application/manifest+json`) para instalação de PWA.

---

## Critérios de aceitação

### Milestone MVP

- [ ] axe-core rodando como parte da suite de testes unitários; zero falhas de nível "critical" ou "serious" nos componentes de UI.
- [ ] Navegação completa da sidebar, chat, combat tracker e sheet de personagem PF2e com apenas teclado (Tab, setas, Enter, Escape), sem usar mouse.
- [ ] Canvas navegável por Tab entre tokens; token focado tem indicador visual de foco; ações básicas (abrir sheet, rolar ataque) executáveis via teclado no canvas.
- [ ] Contraste de todos os textos e ícones de UI verificado com ferramenta de contraste (ex.: WebAIM Contrast Checker ou axe DevTools) nos temas dark e light — zero violações AA.
- [ ] Cinco condições de combate básicas (atordoado, caído, agarrado, morrendo, inconsciente) exibidas com ícone + cor no token e no combat tracker.
- [ ] Todos os modais fecham com Escape e devolvem o foco ao elemento que os abriu.
- [ ] Em iPad Air (1180×820, touch), canvas visível em fullscreen, sidebar colapsada, bottom drawer de sheet funcionando, hit targets ≥ 44px verificados com overlay de inspeção.
- [ ] Gestos fundamentais (arrastar token, pinch-zoom, pan 2 dedos, tap para selecionar) funcionando no canvas do iPad sem ativar zoom do browser.
- [ ] Long-press 500ms e double-tap: implementados e testados em hardware real se [MVP-stretch] for validado antes do freeze; caso contrário promovidos a [V2].
- [ ] `prefers-reduced-motion: reduce` desabilita animações de luz e partículas; verificado via DevTools emulation.
- [ ] Toggles de qualidade gráfica (fog simplificado, desligar animações de luz) funcionam e são persistidos entre sessões.
- [ ] WCAG 2.2 AA checklist revisado manualmente para os componentes do MVP.

### Milestone V2

- [ ] Modo companion em telefone (< 640px): ficha, rolagens e chat funcionando em portrait e landscape.
- [ ] Stylus (Apple Pencil): detecção de `pointerType === 'pen'`, ativação automática de ferramentas de drawing.
- [ ] Remapeamento de atalhos: painel de configurações de controles (REQ-A11-021), detecção de conflitos (REQ-A11-022), persistência por usuário no banco.
- [ ] PWA: `manifest.webmanifest` válido servido; app "instalável" no Chrome Android e no Safari iOS (via Share → Adicionar à Tela de Início) (REQ-A11-080).
- [ ] Service Worker cacheando app shell; recarregamento sem servidor retorna tela de erro amigável, não tela em branco (REQ-A11-081..083).
- [ ] Teste com VoiceOver (iOS) e TalkBack (Android) nos menus principais, chat e sheet — zero erros críticos de anúncio.

---

## Questões em aberto

1. **Gesture library:** A implementação de gestos (pan, pinch, long-press) deve usar uma biblioteca existente (`@use-gesture/vanilla`) ou ser implementação própria sobre Pointer Events? `@use-gesture/vanilla` tem ~13kb gzip e é bem mantida; a implementação própria oferece mais controle para o caso específico do VTT. Decisão pendente de avaliação de bundle size vs. complexidade.

2. **Zoom do pinch com âncora de gestos:** O algoritmo de zoom centrado no ponto médio entre dois dedos requer calcular a posição em scene coordinates dos dois pointers ativos. Isso exige rastrear dois `pointerId` simultaneamente. A implementação deve ser validada em dispositivos reais (especialmente Samsung tablets com Android, que têm comportamentos de `pointerId` distintos do iOS).

3. **Suporte VoiceOver/TalkBack no canvas:** O PixiJS Accessibility System cria divs posicionados absolutamente sobre o canvas. Em testes com VoiceOver (iOS), há relatos de que a leitura dos elementos overlay pode ser inconsistente dependendo da densidade de tokens. Precisamos validar com dispositivo real antes de garantir o suporte.

4. **PWA offline — tela de erro:** O design da tela de erro que o Service Worker exibe quando o servidor está offline está em aberto. Deve incluir: nome do mundo (se disponível em cache), última cena ativa, instrução para verificar a conexão com o GM.

5. **`navigator.deviceMemory` para detecção de hardware fraco:** A API `navigator.deviceMemory` é suportada no Chrome/Edge mas não no Safari (retorna `undefined`). Em Safari mobile, a heurística de detecção de hardware fraco precisará de fallback (ex.: `devicePixelRatio` + `navigator.hardwareConcurrency`). O comportamento do REQ-A11-077 depende disso.

6. **Daltonismo no fog de guerra:** O fog usa gradientes de opacidade para a área "explorada mas fora de visão". Em modos de daltonismo (deuteranopia, protanopia), a distinção entre "visível agora" e "explorado mas escuro" pode não ser suficiente por opacidade sozinha. Avaliar se é necessário um padrão hachura ou ícone adicional para indicar o estado "explorado/escuro" além de opacidade.

7. **Bottom drawer em iPads com home bar:** A bottom bar do Fusion (hotbar) deve respeitar `env(safe-area-inset-bottom)`. Mas quando o bottom drawer está aberto, a safe area deve aplicar ao drawer, não à hotbar. O CSS de empilhamento precisará ser validado em iPad com home bar físico (não apenas Face ID).

8. **Modo companion [V2] — sincronização parcial:** O companion view precisa apenas de uma fração dos dados da cena (HP do personagem, condições, inventário para rolagens). Definir o subconjunto de eventos socket.io necessários para esse modo sem incorrer no custo de sincronizar o estado completo da cena. Isso pode requerer um canal dedicado ou subscription parcial — coordinar com `04-rede-e-sincronizacao.md`.

---

## Referências

- `docs/research/94-accessibility-mobile-tablet.md` — pesquisa completa sobre acessibilidade, touch e performance mobile para VTTs.
- [WCAG 2.2 Overview — W3C](https://www.w3.org/WAI/standards-guidelines/wcag/)
- [Game Accessibility Guidelines — Full List](https://gameaccessibilityguidelines.com/full-list/)
- [PixiJS v8 — Accessibility Guide](https://pixijs.com/8.x/guides/components/accessibility)
- [Pointer Events — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [VirtualKeyboard API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API)
- [SvelteKit — Accessibility Docs](https://svelte.dev/docs/kit/accessibility)
- [touch-action — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action)
- Game Accessibility and WCAG Gap Analysis — Springer (documentado em research/94)
