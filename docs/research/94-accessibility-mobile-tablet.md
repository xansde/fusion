# 94 — Acessibilidade, Suporte a Tablet/Touch e Responsividade

> Documento de pesquisa para o projeto Fusion (VTT clean-room).
> Fontes consultadas em junho de 2026. Termos técnicos mantidos em inglês.
> Este documento responde às open questions do doc 08 sobre acessibilidade e mobile.

---

## 1. Estado da Acessibilidade no Foundry VTT

### 1.1 O que o Foundry oferece nativamente

O Foundry VTT **não possui uma estratégia de acessibilidade nativa abrangente**. O suporte existente é pontual e limitado:

- **ApplicationV2 (v12+):** A migração do framework UI para ApplicationV2 melhorou a semântica HTML estrutural — janelas de diálogo usam a tag `<form>` corretamente; o elemento-raiz é configurável via `options.tag`. No entanto, **ARIA roles explícitos, focus traps e anúncios de live regions não são documentados como recursos do framework**.
- **Tema adaptativo (v13.341):** O Foundry agora detecta a preferência do sistema operacional ou navegador (dark/light mode) e adapta automaticamente o tema da interface. Isso beneficia usuários com baixa visão que configuram high contrast no OS.
- **CSS Layers (v13):** A adoção de CSS Layers facilita a personalização de estilos por módulos e sistemas, permitindo que mods de acessibilidade façam overrides sem batalhas de especificidade.
- **Navegação por teclado parcial:** Tokens podem ser movidos pelo teclado; o `TAB` cicla tipos de movimento em movimentos com waypoints; setas movem tokens no grid. Porém, a navegação de teclado na UI (sidebar, sheets, hotbar) não está sistematicamente documentada.

### 1.2 Módulos de Acessibilidade da Comunidade

A ausência de suporte nativo gerou um ecossistema de módulos comunitários:

| Módulo                         | Funcionalidades principais                                                                                                                                                                                   | Sistema-alvo               | Status (2026)                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------- |
| **Accessibility Enhancements** | Alternativas a drag-and-drop para adicionar itens; audio feedback (pop ao abrir janela, som de criação de item); high-contrast character sheets (dark/light PF2e); preview enlargement no compendium browser | PF2e (parcial) + agnóstico | Última atualização: 2 anos atrás; verificado até v12 |
| **Accessibility: Chatfinder**  | Navegação no chat via teclado/screen reader                                                                                                                                                                  | Agnóstico                  | Ativo                                                |
| **Minimal UI**                 | Simplificação da interface, ocultação de elementos não essenciais                                                                                                                                            | Agnóstico                  | Ativo                                                |
| **Gaming Table Player**        | Oculta toda a UI do Foundry para a tela de mesa compartilhada                                                                                                                                                | Agnóstico                  | Ativo                                                |

**Conclusão crítica:** O Foundry nunca declarou uma meta de conformidade WCAG. Acessibilidade é tratada como responsabilidade de módulos, não do core. Para o Fusion, essa é uma oportunidade de diferenciação.

### 1.3 ARIA no Canvas do Foundry

O canvas do Foundry é renderizado pelo PixiJS em um elemento `<canvas>`. Por definição, o conteúdo de um `<canvas>` é **invisível a screen readers** — não há semântica DOM. O Foundry não documenta nenhuma camada de acessibilidade sobre o canvas.

---

## 2. Nível WCAG Praticável para um VTT

### 2.1 Hierarquia WCAG

O W3C mantém três níveis de conformidade:

| Nível   | Critérios (WCAG 2.2)    | Descrição                                                             |
| ------- | ----------------------- | --------------------------------------------------------------------- |
| **A**   | 30 critérios            | Mínimo absoluto; não conformar torna conteúdo inacessível para muitos |
| **AA**  | 50 critérios adicionais | Padrão legal amplamente adotado; requisito ADA, EAA, Section 508      |
| **AAA** | Restantes               | Aspiracional; não exigido globalmente                                 |

**WCAG 2.2 AA** (outubro de 2023) é o padrão atual recomendado — é totalmente retrocompatível com 2.1 AA. Os 9 critérios novos do 2.2 incluem: `Focus Not Obscured` (2.4.11), `Focus Appearance` (2.4.12), `Target Size` (2.5.8, mínimo 24×24 px para alvos de clique), e `Accessible Authentication` (3.3.8).

### 2.2 O Problema do Canvas em VTTs

Aplicações canvas-based (jogos, VTTs) enfrentam uma tensão fundamental com WCAG:

- **Critério 4.1.2 (Name, Role, Value):** Exige que todos os componentes UI tenham nome, role e valor programaticamente determináveis. Um `<canvas>` em branco falha completamente.
- **Critério 2.1.1 (Keyboard):** Toda funcionalidade deve ser operável por teclado. O canvas de token/scene manipulation é intrinsecamente espacial e dificulta navegação por teclado pura.
- **Prática aceita:** Pesquisa acadêmica confirma que "web-based games can only be optimised to follow WCAG within limits of game rules" — existe um gap documentado. A solução é fornecer **alternativas** acessíveis para ações críticas, não necessariamente tornar o canvas em si acessível.

### 2.3 Meta de Conformidade Recomendada para Fusion

```
UI / formulários / sheets / chat / sidebar:    WCAG 2.2 AA
Canvas do mapa (tokens, ícones, layers):       Acessibilidade via alternativas (fallback textual, ARIA overlay)
Modais / diálogos:                             WCAG 2.2 AA (focus trap, Esc, role=dialog)
```

**Estratégia prática:**

1. Todo texto de UI deve ter contraste ≥ 4,5:1 (AA) ou 3:1 para texto grande (≥18pt ou ≥14pt bold).
2. Nenhuma informação crítica deve ser transmitida **apenas** por cor.
3. Todos os controles interativos da UI (não canvas) devem ser alcançáveis por teclado com indicador de foco visível.
4. O canvas deve ter `role="img"` e `aria-label` descrevendo a cena atual para screen readers.
5. Target size mínimo de 24×24 px para todos os botões (critério 2.5.8 WCAG 2.2).

---

## 3. Suporte Touch e Tablet — Análise do Foundry

### 3.1 Suporte Nativo no Foundry Core

O Foundry não oferece suporte touch nativo completo. A versão 13.341 corrigiu "issues with multitouch interfaces" — especificamente o pinch-to-zoom que tentava rotacionar tokens em vez de fazer zoom. Esse foi um fix pontual, não uma iniciativa de suporte touch sistemático.

### 3.2 Ecossistema de Módulos Touch

**TouchVTT** é o módulo de referência para touch no Foundry:

| Gesto                         | Ação mapeada                    |
| ----------------------------- | ------------------------------- |
| Arrastar 1 dedo (sobre token) | Mover token                     |
| Pinch 2 dedos                 | Zoom do canvas                  |
| Pan 2 dedos                   | Navegar o canvas (configurável) |
| Pan 3 dedos                   | Modo alternativo de navegação   |
| Long-press (0,5s)             | Right-click / menu de contexto  |
| Tap em token hostil           | Target                          |
| Ruler + waypoints             | Navegação com régua             |

**Implementação técnica do TouchVTT:**

- Versão 2.0.0 foi reescrita completamente usando **Pointer Events API** (migração de Touch Events).
- Usa a biblioteca `libWrapper` para interceptar métodos do Foundry sem quebrar outros módulos.
- Dois modos de câmera: combinado (zoom+pan no mesmo gesto) e separado (zoom=2 dedos, pan=3 dedos) para mitigar jitter em sensores de toque menos precisos.
- Botões de token enlargement configuravelmente para facilitar toque em áreas pequenas.

**Mobile Improvements** (v2.0.0, Foundry 13+):

- Overhaul completo da UI core para mobile/tablet.
- Character sheets "flexíveis" que adaptam ao tamanho de tela.
- Janelas em full-screen em telas pequenas.
- Barra de macros/ações otimizada para touch.
- Integra-se com TouchVTT para controle do canvas.
- Modo "tablet view" (ainda marcado como work-in-progress).

**Conclusão:** O suporte tablet no Foundry existe, mas é **totalmente dependente de módulos de terceiros**. A UI core não foi desenhada para touch.

---

## 4. Arquitetura de Input Unificado: Pointer Events API

### 4.1 Por que Pointer Events (não Touch Events)

A **Pointer Events API** (W3C standard, suportada em todos os browsers modernos) é a abordagem correta para o Fusion:

```
mouse     ──┐
touch     ──┼──► PointerEvent ──► handler único
caneta    ──┘
```

**Vantagens:**

- Um único conjunto de handlers (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) funciona para mouse, touch e caneta.
- `event.pointerType` informa o tipo de dispositivo: `'mouse'`, `'touch'`, ou `'pen'`.
- Suporte a multi-touch via `event.pointerId` (cada dedo tem um ID único).
- Propriedades de hardware: `pressure`, `width`, `height`, `tiltX`, `tiltY` para canetas.
- `pointerover`/`pointerout` para hover — mas **apenas mouse gera hover genuíno**.

### 4.2 O Problema dos Hover-Only Affordances

Este é um problema arquitetural crítico para VTTs em touch:

**Padrões hover-only que precisam de alternativa em touch:**

| Padrão problemático                      | Alternativa para touch                    |
| ---------------------------------------- | ----------------------------------------- |
| Tooltip ao hover sobre token             | Long-press (0,5s) ou tap para abrir sheet |
| Botões de ação que aparecem ao hover     | Menu de contexto via long-press           |
| Roll de dados ao hover para ver fórmulas | Texto permanentemente visível em mobile   |
| Preview de spell/item ao hover           | Tap para expandir                         |
| Cursor custom indicando ferramenta ativa | Ícone de UI permanente indicando modo     |

**Detecção de capacidade hover:**

```css
/* CSS Media Query para detectar dispositivos sem hover fino */
@media (hover: none) and (pointer: coarse) {
  /* tablet/touch: mostrar alternativas para hover-only UI */
}

@media (hover: hover) and (pointer: fine) {
  /* mouse: habilitar interações hover */
}
```

O Svelte 5 expõe `MediaQuery` como classe reativa — pode-se criar um store global `isTouchDevice` para adaptar componentes.

### 4.3 touch-action e iOS Safari

Para o canvas do VTT, é obrigatório controlar o comportamento de touch padrão do browser:

```css
canvas#game-canvas {
  touch-action: none; /* desabilita todos os gestos padrão do browser */
}
```

**Problema com iOS Safari:** Safari tem suporte limitado a `touch-action` — apenas `auto` e `manipulation` funcionam de forma confiável. O valor `none` pode não funcionar como esperado.

**Solução recomendada para iOS:**

1. Usar `touch-action: manipulation` no canvas (desabilita double-tap zoom, mantém scroll nativo).
2. Registrar event listeners com `{ passive: false }` para chamar `preventDefault()` em gestos que o app gerencia.
3. Listeners passivos (padrão em browsers modernos) **não podem** chamar `preventDefault()`.

---

## 5. UI Responsiva para Tablets

### 5.1 Breakpoints Relevantes para um VTT

Um VTT tem dois modos principais de uso:

- **GM em desktop** (1280px+): UI completa, todas as ferramentas visíveis.
- **Jogador em tablet** (768–1200px): UI simplificada, canvas maximizado.

**Breakpoints recomendados:**

| Nome         | min-width | Descrição                                                |
| ------------ | --------- | -------------------------------------------------------- |
| `mobile`     | 0px       | Telas < 640px (não suportado como modo de jogo completo) |
| `tablet`     | 640px     | iPad mini, tablets Android médios                        |
| `tablet-lg`  | 1024px    | iPad Pro 11", iPad Air                                   |
| `desktop`    | 1280px    | Laptops, desktops                                        |
| `desktop-xl` | 1536px    | Monitores wide, 4K                                       |

**Viewports reais de iPads (CSS pixels, landscape):**

| Modelo          | Viewport (landscape) | DPR |
| --------------- | -------------------- | --- |
| iPad mini 6     | 1024 × 768           | 2×  |
| iPad Air M3     | 1180 × 820           | 2×  |
| iPad Pro 11" M4 | 1194 × 834           | 2×  |
| iPad Pro 13" M4 | 1366 × 1024          | 2×  |

### 5.2 Container Queries vs. Media Queries

Para componentes de UI de um VTT (character sheets, sidebar panels, token HUD), **CSS Container Queries** são superiores a media queries:

```css
/* Character sheet responde ao tamanho do seu container, não da viewport */
.character-sheet {
  container-type: inline-size;
}

@container (max-width: 480px) {
  .sheet-columns {
    flex-direction: column; /* single column em sheet estreita */
  }
}
```

Container Queries têm **93,92% de suporte global** em dezembro de 2025 e são production-ready. Em Svelte 5, components podem combinar container queries com runes reativas para comportamento adaptativo.

### 5.3 Modo Jogador vs. Modo GM

**Proposta de arquitetura de dois modos:**

```
┌─────────────────────────────────────────────┐
│            MODO GM (desktop)                │
│  [Nav] [Scene Controls] [Canvas] [Sidebar]  │
│  [Player List] [Hotbar] [Notifications]     │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│         MODO JOGADOR TABLET                 │
│  [Canvas — maximizado, 100% da tela]        │
│  [Bottom sheet: HUD do personagem ativo]    │
│  [FAB: abrir chat / sheet / rolls]          │
└─────────────────────────────────────────────┘
```

O modo jogador-tablet deve:

- Ocultar Scene Controls (ferramenta de GM).
- Sidebar colapsada por padrão, acessível via swipe from edge ou FAB.
- Hotbar de macros como bottom bar compacta (touch targets ≥ 44×44 px — Apple HIG).
- Character sheet como bottom sheet deslizante (drawer), não janela flutuante.
- Notificações / toasts na parte superior (acima do conteúdo, não sobre o canvas).

---

## 6. Safe Area, Viewport e Teclado Virtual

### 6.1 Safe Area Insets (Notch / Dynamic Island / Home Bar)

iPads com Face ID/Home Bar expõem variáveis CSS de safe area:

```css
.ui-chrome {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

Requer `<meta name="viewport" content="..., viewport-fit=cover">` para ativar.

### 6.2 Teclado Virtual e Sobreposição

Quando o jogador toca num campo de texto (chat, sheet) em tablet, o teclado virtual aparece e pode cobrir parte da UI. Estratégias:

**VirtualKeyboard API (Chrome 94+):**

```js
navigator.virtualKeyboard.overlaysContent = true;
// CSS expõe:
// env(keyboard-inset-height) — altura do teclado visível
```

**Meta viewport `interactive-widget`** (Chrome 108+, Firefox 132+):

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1,
  interactive-widget=resizes-visual"
/>
```

- `resizes-visual`: apenas o viewport visual encolhe (melhor para canvas-based apps — o canvas não recalcula, só o UI overlay).
- `resizes-content`: ambos os viewports encolhem (comportamento padrão, problemático para canvas).
- `overlays-content`: nenhum viewport encolhe (app gerencia tudo manualmente).

**Para o Fusion:** `resizes-visual` é a opção mais adequada — o canvas permanece estável enquanto campos de texto sobem para acima do teclado.

**Unidade CSS `dvh` (dynamic viewport height):**

```css
.game-container {
  height: 100dvh; /* atualiza quando teclado aparece/desaparece */
}
```

Evitar `100vh` em mobile Safari (inclui a barra de endereço, causando overflow).

---

## 7. PWA para Jogadores em Tablet

### 7.1 Benefícios de uma PWA para o Fusion

O Fusion roda como servidor local do GM que jogadores acessam pelo browser. Oferecer um manifesto PWA permite que jogadores "instalem" a sessão no tablet sem app store:

```json
{
  "name": "Fusion VTT",
  "short_name": "Fusion",
  "start_url": "/",
  "display": "standalone",
  "orientation": "landscape",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "background_color": "#1a1a2e",
  "theme_color": "#1a1a2e"
}
```

**Benefícios:**

- Modo `standalone` remove a barra de URL do browser (mais imersivo).
- Ícone na home screen.
- Splash screen durante carregamento.
- Fullscreen sem chrome do browser.

### 7.2 Limitações PWA em iOS/iPadOS (Crítico)

| Limitação                                                         | Impacto para Fusion                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **EU (iOS 17.4+):** PWAs não rodam em standalone; abrem no Safari | Jogadores europeus não têm vantagem de fullscreen                                |
| Sem install prompt automático                                     | Usuário precisa: Share → "Adicionar à Tela de Início" — não intuitivo            |
| Service worker com cache de 7 dias e 50MB                         | Limitado para assets de VTT, mas caching de assets fixos (tokens, maps) é viável |
| Sem Background Sync/Periodic Background Sync                      | Não relevante para uso em sessão ativa                                           |
| `100vh` inclui a barra do Safari                                  | Usar `100dvh` + `viewport-fit=cover`                                             |
| Sem File System Access API                                        | Jogadores não importam assets locais no iOS                                      |
| Sem WebGL2 garantido (raro, mas antigos iPads)                    | Fallback para WebGL1 necessário                                                  |

**Service Worker para caching de assets estáticos:**
Mesmo com as limitações, um service worker é útil para cachear:

- O app shell (HTML, JS, CSS).
- Tokens e icons do sistema PF2e/SF2e (assets estáticos).
- Rulebook images do compendium.

O servidor de jogo ativo (WebSocket) não usa service worker — é uma conexão em tempo real.

### 7.3 Offline e Conectividade

Um VTT é fundamentalmente online (jogadores conectam ao servidor do GM). O service worker deve:

- Servir o app shell em cache quando o servidor não está acessível (mostrando erro amigável, não tela em branco).
- **Não** tentar cachear dados de jogo ao vivo (scene state, tokens, etc.) — isso é responsabilidade do WebSocket.

---

## 8. Performance em GPUs Móveis com PixiJS

### 8.1 Limitações de Memória de Textura em iOS

| Limite                                                                         | Impacto                                                              |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `MAX_TEXTURE_SIZE` em iOS: geralmente 4096×4096                                | Texturas de mapa acima de 4096px em qualquer dimensão quebram em iOS |
| Crash documentado com texturas 4096×4096 no iOS 15                             | Reduzir para 3840×3840 ou usar tiles para mapas grandes              |
| `gl.MAX_TEXTURE_IMAGE_UNITS` (concurrent textures em shader): tipicamente 8–16 | Batching limitado a 16 texturas diferentes por draw call             |
| Memória GPU total (iPad vs desktop): ~2–4 GB vs ~8–24 GB                       | Budget de textura muito menor em mobile                              |

### 8.2 Compressão de Texturas com PixiJS v8

PixiJS v8 suporta **KTX2 com Basis Universal** — transcoding automático para o melhor formato suportado pelo dispositivo:

| Formato GPU | Plataforma principal       | Compressão |
| ----------- | -------------------------- | ---------- |
| ASTC 4×4    | iOS (A8+), Android moderno | Alta       |
| ETC2        | Android (OpenGL ES 3.0)    | Boa        |
| BC7         | Desktop (DX11+)            | Alta       |
| DXT/BC1     | Desktop legacy             | Moderada   |

**Workflow recomendado:**

1. Buildar assets com **AssetPack** (CLI oficial do PixiJS).
2. Gerar variantes KTX2/Basis de cada textura.
3. Manifesto de assets com múltiplos formatos; PixiJS seleciona automaticamente.
4. Fallback PNG para browsers sem suporte a texturas comprimidas.

**Ganho típico:** Texturas não comprimidas = 100 MB GPU; comprimidas = 30 MB GPU (-70%).

### 8.3 Configurações PixiJS para Mobile

```js
// Inicialização do Renderer para mobile
const app = new PIXI.Application({
  antialias: false, // desabilitar MSAA em GPUs mobile (custo alto)
  useContextAlpha: false, // sem alpha channel no framebuffer principal
  resolution: window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio,
  // não usar devicePixelRatio puro em iPads com DPR=2+ — muito custoso
});
```

**Limites de contextos WebGL em iOS:**
iOS limita o número de contextos WebGL ativos para ~16. Criar contextos sem destruir os antigos causa refresh ou crash da página. O Fusion deve:

- Usar **um único contexto WebGL** para toda a aplicação.
- Destruir texturas não utilizadas explicitamente (`.destroy()`).
- Usar destruição com delay aleatório para evitar freezes ao destruir múltiplas texturas simultâneas.
- Implementar **Texture Garbage Collector** do PixiJS (ativo por padrão, configurável).

### 8.4 Text e `PIXI.Text` em Mobile

Cada instância de `PIXI.Text` cria um canvas 2D separado. Múltiplos textos (nomes de tokens, HP labels) aumentam o número de contextos 2D consumindo memória. Em mobile:

- Preferir `PIXI.BitmapText` (usa textura única pré-gerada).
- Limitar `PIXI.Text` dinâmico a elementos de alta prioridade.
- Reusar instâncias de `PIXI.Text` em vez de criar/destruir por frame.

---

## 9. Acessibilidade no PixiJS v8

O PixiJS v8 possui um sistema de acessibilidade embutido que cria uma **camada DOM overlay** sobre o canvas:

### 9.1 Como funciona

```
┌─────────────────────────────────────────┐
│   <canvas> (PixiJS render)              │
│                                         │
│   [Token 1] [Token 2] [Button A]        │
└─────────────────────────────────────────┘
     ↑ invisível para screen readers

┌─────────────────────────────────────────┐
│   <div> aria-overlay (posicionada sobre)│
│   <div role="button" aria-label="Goblin│
│        Warrior" tabindex="0">           │
│   <div role="button" aria-label="Token │
│        PC: Valeria" tabindex="0">       │
└─────────────────────────────────────────┘
     ↑ visível para screen readers e teclado
```

### 9.2 API de Acessibilidade PixiJS

```js
// Habilitar acessibilidade em um DisplayObject
token.accessible = true;
token.accessibleTitle = "Goblin Warrior"; // aria-label
token.accessibleHint = "HP: 12/30. Clique para selecionar."; // aria-description
token.accessibleType = "button"; // tipo do elemento DOM criado
token.tabIndex = 0; // ordem de foco no teclado
```

O sistema é **opt-in por padrão** (não ativa automaticamente para todos os objetos) para minimizar o bundle. Para o Fusion, tokens de jogador e controles de UI no canvas devem ser explicitamente marcados como acessíveis.

**Ativação:**

```js
import { AccessibilitySystem } from "pixi.js";
app.renderer.accessibility.enabledByDefault = true;
app.renderer.accessibility.activateOnTab = true; // ativa ao pressionar Tab
```

---

## 10. Acessibilidade na UI HTML (Svelte 5)

### 10.1 Recursos do Svelte 5 / SvelteKit

O Svelte 5 tem acessibilidade integrada no compilador:

- **Compiler warnings:** O compilador alerta sobre imagens sem `alt`, elementos interativos sem labels, uso incorreto de ARIA roles.
- **SvelteKit focus management:** Após navegação client-side, o SvelteKit recoloca o foco no `<body>` (simulando comportamento de MPA). Customizável via `afterNavigate`.
- **Live regions automáticas:** SvelteKit injeta um live region para anunciar mudanças de página para screen readers.
- **`MediaQuery` reativa:**
  ```js
  import { MediaQuery } from "svelte/reactivity";
  const isTablet = new MediaQuery("(max-width: 1024px) and (pointer: coarse)");
  // isTablet.current → boolean reativo
  ```

### 10.2 Padrões Obrigatórios para Componentes Fusion

**Focus Trap em modais:**
O padrão nativo `<dialog>` com `.showModal()` fornece:

- Focus trap automático.
- Fechamento com `Escape`.
- `role="dialog"` implícito.
- Backdrop acessível.

Para o Fusion, todos os modais (character sheets como janelas flutuantes, confirm dialogs, compendium browser) devem usar `<dialog>` nativo.

**Skip link:**

```html
<a href="#main-content" class="skip-link">Ir para o conteúdo principal</a>
```

O skip link deve ser o primeiro elemento focável da página (visível apenas ao receber foco).

**Indicador de foco:**

```css
:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
:focus:not(:focus-visible) {
  outline: none; /* remove outline para cliques com mouse */
}
```

**Hover + focus em parallel:**

```css
/* Elemento que aparece só em hover DEVE também aparecer em focus */
.token-action-buttons {
  display: none;
}
.token:hover .token-action-buttons,
.token:focus-within .token-action-buttons {
  display: flex;
}
```

### 10.3 Checklist WCAG 2.2 AA Aplicado ao Fusion

| Critério                     | Requisito                        | Aplicação no Fusion                                 |
| ---------------------------- | -------------------------------- | --------------------------------------------------- |
| 1.1.1 Non-text Content       | Alternativa textual para imagens | `alt` em tokens, portraits, map images              |
| 1.3.1 Info and Relationships | Semântica HTML adequada          | `<nav>`, `<main>`, `<section>`, `<dialog>` corretos |
| 1.4.1 Use of Color           | Não usar cor como único meio     | Condições de status: ícone + cor, não só cor        |
| 1.4.3 Contrast               | 4,5:1 para texto normal          | Testar todos os temas (dark/light)                  |
| 1.4.4 Resize Text            | Texto redimensionável até 200%   | Usar `rem`/`em`, evitar `px` fixo para texto        |
| 1.4.11 Non-text Contrast     | 3:1 para ícones de UI            | Tokens de HP, botões de ação                        |
| 2.1.1 Keyboard               | Toda funcionalidade por teclado  | Canvas: tab entre tokens; UI: tab completo          |
| 2.4.3 Focus Order            | Ordem lógica de foco             | Sheets abertas recebem foco antes de background     |
| 2.4.7 Focus Visible          | Foco sempre visível              | `:focus-visible` em todos os elementos              |
| 2.4.11 Focus Not Obscured    | Foco não totalmente coberto      | Sticky bottom bar não pode cobrir elemento focado   |
| 2.5.8 Target Size            | Mínimo 24×24 px                  | Todos os botões; preferencialmente 44×44 px         |
| 4.1.2 Name, Role, Value      | ARIA correto                     | `role`, `aria-label`, `aria-expanded`, `aria-live`  |

---

## 11. Game Accessibility Guidelines — Aplicadas ao Fusion

O site **gameaccessibilityguidelines.com** categoriza diretrizes por nível (Basic, Intermediate, Advanced) e tipo de deficiência. Itens diretamente aplicáveis ao Fusion:

### 11.1 Nível Basic (obrigatório)

- **Touch targets grandes:** Elementos interativos e controles virtuais em telas touch devem ser grandes e bem espaçados.
- **Contraste:** Alto contraste entre texto/UI e fundo.
- **Remapeamento de controles:** Permitir reconfiguração de atalhos de teclado.
- **Fonte legível:** Tamanho de fonte padrão legível; opção de aumentar.
- **Cor não é único meio:** Status de tokens, indicadores de combate — sempre ícone ou texto junto.
- **Acessar toda a UI pelo mesmo input:** Se tab funciona para tudo exceto o canvas, o canvas precisa de alternativa.

### 11.2 Nível Intermediate (recomendado)

- **Ajuste de sensibilidade de controles.**
- **Suporte a múltiplos tipos de input simultâneos** (mouse + teclado, touch + teclado físico).
- **Elementos interativos que exigem precisão devem ser estacionários** (sem targets que se movem).
- **Suporte a screen reader no mobile** (iOS VoiceOver, Android TalkBack) para menus e UI fora do canvas.
- **Redimensionamento de interface.**

### 11.3 Nível Advanced (aspiracional)

- Screen reader completo incluindo canvas.
- Áudio descritivo.
- Compatibilidade com switch control / eye tracking.

---

## 12. Síntese Arquitetural para o Fusion

### 12.1 Decisões de Arquitetura Recomendadas

1. **Input layer:** Implementar toda interação com o canvas via **Pointer Events API** — nenhum código que use `MouseEvent` ou `TouchEvent` diretamente no canvas. Isso garante suporte a mouse, touch e caneta sem branching.

2. **Gestos do canvas:** Biblioteca de gestos (ex.: `@use-gesture/vanilla` ou implementação própria) sobre Pointer Events para: pan, pinch-zoom, long-press, tap. Configurar `touch-action: none` no canvas + listeners com `{ passive: false }`.

3. **Hover-only affordances:** Implementar design "touch-first aware" — qualquer ação que hoje é hover-only no Foundry deve ter um modo alternativo ativável por tap/long-press. Detectar via `(hover: none)` CSS media query + store reativo Svelte.

4. **PWA:** Incluir Web App Manifest básico desde o início. Service worker para cache do app shell. O modo `standalone` é bonus, não requisito.

5. **Modo jogador simplificado:** Definir uma variante de layout para telas ≤ 1024px com `pointer: coarse`. Nesse layout: canvas ocupa 100% do viewport; controles de GM ocultados; sheets como bottom drawers; sidebar acessível por swipe/FAB.

6. **PixiJS e mobile:** Limitar texturas de mapa a 3840px de lado (não 4096px) para evitar crash em iOS. Usar KTX2/Basis para todos os assets de produção. Inicializar renderer com `antialias: false` em dispositivos com `devicePixelRatio ≥ 2` (detecção de GPU mobile). Usar `BitmapText` em vez de `Text` para labels de tokens.

7. **WCAG meta:** WCAG 2.2 AA para toda a UI HTML (Svelte); acessibilidade "best effort" para o canvas usando a API de acessibilidade do PixiJS (overlay DOM) para tokens e controles principais.

8. **Teclado virtual:** Usar `interactive-widget=resizes-visual` no viewport meta e `100dvh` para altura. Implementar VirtualKeyboard API para campos de chat/texto ao receber foco em dispositivos touch.

9. **Safe areas:** Todo layout deve respeitar `env(safe-area-inset-*)` com `viewport-fit=cover` para iPads com Face ID e iPhone.

10. **`<dialog>` nativo:** Usar o elemento `<dialog>` do HTML com `.showModal()` para todos os modais/sheets — focus trap e Esc gratuitos.

### 12.2 O que NÃO fazer (Anti-padrões)

- ❌ Usar `addEventListener('touchstart', ..., { passive: true })` e depois chamar `preventDefault()` — vai gerar erro silencioso.
- ❌ Fazer `touch-action: none` sem fallback para iOS Safari (só `manipulation` é confiável).
- ❌ Depender de hover para mostrar informações críticas de jogo sem alternativa touch.
- ❌ Textura de mapa única de 4096×4096 em produção sem tile system.
- ❌ Criar instâncias de `PIXI.Text` em loop por frame para labels de tokens.
- ❌ Usar `100vh` para height em Safari/iOS — usar `100dvh`.
- ❌ Assumir que `display: standalone` funciona para todos os usuários iOS (especialmente UE).
- ❌ Usar apenas cor para indicar estado de token (daltônico não distingue).

---

## 13. Fontes

- [TouchVTT — Foundry VTT Package](https://foundryvtt.com/packages/touch-vtt)
- [TouchVTT — GitHub (Oromis)](https://github.com/Oromis/touch-vtt)
- [Mobile Improvements — Foundry VTT Package](https://foundryvtt.com/packages/mobile-improvements)
- [Swipe - Mobile VTT — Foundry VTT Package](https://foundryvtt.com/packages/swipe-vtt)
- [Accessibility Enhancements — Foundry VTT Package](https://foundryvtt.com/packages/accessibility-enhancements)
- [Accessibility: Chatfinder — Foundry VTT Package](https://foundryvtt.com/packages/a11y-chatfinder)
- [Foundry VTT Release 13.341](https://foundryvtt.com/releases/13.341)
- [Foundry VTT Release Notes](https://foundryvtt.com/releases/)
- [ApplicationV2 — Foundry VTT Community Wiki](https://foundryvtt.wiki/en/development/api/applicationv2)
- [PixiJS v8 — Accessibility Guide](https://pixijs.com/8.x/guides/components/accessibility)
- [PixiJS v8 — Compressed Textures](https://pixijs.com/8.x/guides/components/assets/compressed-textures)
- [PixiJS v8 — Performance Tips](https://pixijs.com/8.x/guides/concepts/performance-tips)
- [PixiJS GitHub — iOS Out of Memory Discussion #8000](https://github.com/pixijs/pixijs/discussions/8000)
- [SvelteKit — Accessibility Docs](https://svelte.dev/docs/kit/accessibility)
- [Svelte — Accessibility Warnings](https://svelte.dev/docs/accessibility-warnings)
- [W3C — WCAG 2 Overview](https://www.w3.org/WAI/standards-guidelines/wcag/)
- [W3C — WCAG 2.2 Level AA Conformance](https://www.w3.org/WAI/WCAG2AA-Conformance)
- [WCAG 2.2 Checklist — Level Access](https://www.levelaccess.com/blog/wcag-2-2-aa-summary-and-checklist-for-website-owners/)
- [Game Accessibility Guidelines — Full List](https://gameaccessibilityguidelines.com/full-list/)
- [Game Accessibility Guidelines — Touch Screens](https://gameaccessibilityguidelines.com/ensure-interactive-elements-virtual-controls-are-large-and-well-spaced-particularly-on-small-or-touch-screens/)
- [Pointer Events — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [touch-action — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action)
- [VirtualKeyboard API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API)
- [PWA iOS Limitations — MagicBell (2026)](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [PWA on iOS — Brainhub (2025)](https://brainhub.eu/library/pwa-on-ios)
- [Making PWAs Installable — MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [iPad Viewport Sizes 2026 — ScreenSizeChecker](https://screensizechecker.com/devices/ipad-viewport-sizes)
- [Safe Area Insets CSS — Medium](https://medium.com/@developerr.ayush/understanding-env-safe-area-insets-in-css-from-basics-to-react-and-tailwind-a0b65811a8ab)
- [Canvas Accessibility — PaulJAdam Demo](https://pauljadam.com/demos/canvas.html)
- [HTML5 Canvas Accessibility — Medium (Dr Abstract)](https://drabstract.medium.com/your-guide-to-accessibility-on-the-canvas-with-javascript-ff58074c30c8)
- [WebGL Cross Platform Issues — WebGL2 Fundamentals](https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html)
- [Uncompressed Textures — Pal's Blog (PixiJS)](https://www.shukantpal.com/do-not-use-uncompressed-textures/)
- [CSS Container Queries — Builder.io](https://www.builder.io/blog/css-2024-nesting-layers-container-queries)
- [Responsive Breakpoints 2025 — BrowserStack](https://www.browserstack.com/guide/responsive-design-breakpoints)
- [Using Forge/Foundry on Tablets — Forge Forums](https://forums.forge-vtt.com/t/using-forge-foundry-on-tablets/17552)
- [Game Accessibility and WCAG Gap Analysis — Springer](https://link.springer.com/chapter/10.1007/978-3-319-94277-3_43)
- [Accessibility Terms for Game Developers WCAG 2.1 — Filament Games](https://www.filamentgames.com/blog/accessibility-terms-for-game-developers-a-wcag-2-1-aa-glossary/)
