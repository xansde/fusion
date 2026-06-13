<script lang="ts">
  /**
   * Window.svelte — Floating window shell.
   *
   * Svelte 5 Runes component.
   * Implements REQ-UIF-010..013 from spec 11-ui-framework-e-fichas.md.
   *
   * Responsibilities:
   *  - Render title bar with icon, title, minimize and close buttons
   *  - Drag by title bar (Pointer Events — REQ-UIF-NF-010)
   *  - Resize from 8 handle regions (corners + edges), clamped by the manager
   *  - Delegate all math to windowManager.setPosition()
   *  - ARIA: role="dialog" (non-modal), managed focus on open
   *
   * Props:
   *  - entry: WindowEntry  (reactive slice from windowManager.windows)
   *  - onClose: () => void
   *  - onFocus: () => void
   */

  import type { WindowEntry } from "$lib/windows/window-manager.js";
  import { windowManager } from "$lib/windows/window-manager.js";

  interface Props {
    entry: WindowEntry;
    onClose: () => void;
    onFocus: () => void;
    children?: import("svelte").Snippet;
  }

  let { entry, onClose, onFocus, children }: Props = $props();

  // -------------------------------------------------------------------------
  // Drag state
  // -------------------------------------------------------------------------
  let dragging = $state(false);
  let dragStartX = $state(0);
  let dragStartY = $state(0);
  let dragStartLeft = $state(0);
  let dragStartTop = $state(0);

  function onTitlebarPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // only primary button
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartLeft = entry.left;
    dragStartTop = entry.top;
    onFocus();
  }

  function onTitlebarPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    windowManager.setPosition(entry.id, {
      left: dragStartLeft + dx,
      top: dragStartTop + dy,
    });
  }

  function onTitlebarPointerUp(_e: PointerEvent) {
    dragging = false;
  }

  // -------------------------------------------------------------------------
  // Resize state
  // -------------------------------------------------------------------------
  type ResizeEdge =
    | "n" | "s" | "e" | "w"
    | "ne" | "nw" | "se" | "sw";

  let resizing = $state(false);
  let resizeEdge = $state<ResizeEdge>("se");
  let resStartX = $state(0);
  let resStartY = $state(0);
  let resStartLeft = $state(0);
  let resStartTop = $state(0);
  let resStartWidth = $state(0);
  let resStartHeight = $state(0);

  function onResizePointerDown(e: PointerEvent, edge: ResizeEdge) {
    if (e.button !== 0 || !entry.resizable) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    resizing = true;
    resizeEdge = edge;
    resStartX = e.clientX;
    resStartY = e.clientY;
    resStartLeft = entry.left;
    resStartTop = entry.top;
    resStartWidth = entry.width;
    resStartHeight = entry.height;
    onFocus();
  }

  function onResizePointerMove(e: PointerEvent) {
    if (!resizing) return;
    const dx = e.clientX - resStartX;
    const dy = e.clientY - resStartY;

    let top = resStartTop;
    let left = resStartLeft;
    let width = resStartWidth;
    let height = resStartHeight;

    if (resizeEdge.includes("e")) width = resStartWidth + dx;
    if (resizeEdge.includes("s")) height = resStartHeight + dy;
    if (resizeEdge.includes("w")) { left = resStartLeft + dx; width = resStartWidth - dx; }
    if (resizeEdge.includes("n")) { top = resStartTop + dy; height = resStartHeight - dy; }

    windowManager.setPosition(entry.id, { top, left, width, height });
  }

  function onResizePointerUp(_e: PointerEvent) {
    resizing = false;
  }

  // -------------------------------------------------------------------------
  // Combined pointer-move / pointer-up on window (captures both drag+resize)
  // -------------------------------------------------------------------------
  function onWindowPointerMove(e: PointerEvent) {
    if (dragging) onTitlebarPointerMove(e);
    if (resizing) onResizePointerMove(e);
  }

  function onWindowPointerUp(e: PointerEvent) {
    if (dragging) onTitlebarPointerUp(e);
    if (resizing) onResizePointerUp(e);
  }

  // -------------------------------------------------------------------------
  // Focus on click anywhere in the window
  // -------------------------------------------------------------------------
  function onWindowPointerDown(_e: PointerEvent) {
    onFocus();
  }

  // -------------------------------------------------------------------------
  // Keyboard: close on Escape when focused
  // -------------------------------------------------------------------------
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }

  // -------------------------------------------------------------------------
  // Computed style
  // -------------------------------------------------------------------------
  const style = $derived(
    `position:absolute;` +
    `top:${entry.top}px;` +
    `left:${entry.left}px;` +
    `width:${entry.width}px;` +
    `height:${entry.minimized ? "auto" : entry.height + "px"};` +
    `z-index:${entry.zIndex};`
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="fusion-window"
  class:minimized={entry.minimized}
  class:resizable={entry.resizable}
  role="dialog"
  aria-label={entry.title}
  aria-modal="false"
  tabindex="0"
  {style}
  onpointerdown={onWindowPointerDown}
  onpointermove={onWindowPointerMove}
  onpointerup={onWindowPointerUp}
  onkeydown={onKeydown}
>
  <!-- Title bar -->
  <div
    class="fusion-window__titlebar"
    onpointerdown={onTitlebarPointerDown}
    role="presentation"
  >
    {#if entry.icon}
      <span class="fusion-window__icon" aria-hidden="true">{entry.icon}</span>
    {/if}
    <span class="fusion-window__title">{entry.title}</span>

    <div class="fusion-window__controls">
      {#if entry.minimizable}
        <button
          class="fusion-window__btn fusion-window__btn--minimize"
          aria-label={entry.minimized ? "Restaurar janela" : "Minimizar janela"}
          onclick={() => entry.minimized ? windowManager.restore(entry.id) : windowManager.minimize(entry.id)}
          onpointerdown={(e) => e.stopPropagation()}
        >
          {entry.minimized ? "▲" : "▼"}
        </button>
      {/if}
      <button
        class="fusion-window__btn fusion-window__btn--close"
        aria-label="Fechar janela"
        onclick={onClose}
        onpointerdown={(e) => e.stopPropagation()}
      >
        ✕
      </button>
    </div>
  </div>

  <!-- Content slot -->
  {#if !entry.minimized}
    <div class="fusion-window__content">
      {@render children?.()}
    </div>
  {/if}

  <!-- Resize handles (only when not minimized and resizable) -->
  {#if entry.resizable && !entry.minimized}
    {#each ["n","s","e","w","ne","nw","se","sw"] as edge}
      <div
        class="fusion-window__resize fusion-window__resize--{edge}"
        role="presentation"
        onpointerdown={(e) => onResizePointerDown(e, edge as ResizeEdge)}
      ></div>
    {/each}
  {/if}
</div>

<style>
  .fusion-window {
    --_win-bg: var(--fusion-color-surface, #1a1a2e);
    --_win-border: var(--fusion-color-border, #3a3a5c);
    --_win-titlebar-bg: var(--fusion-color-surface-raised, #16213e);
    --_win-titlebar-fg: var(--fusion-color-text-primary, #e0e0ff);
    --_win-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    --_resize-size: 6px;

    display: flex;
    flex-direction: column;
    background: var(--_win-bg);
    border: 1px solid var(--_win-border);
    border-radius: var(--fusion-radius-md, 6px);
    box-shadow: var(--_win-shadow);
    overflow: hidden;
    contain: layout;
    user-select: none;
    outline: none;
  }

  .fusion-window:focus-visible {
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
    outline-offset: 2px;
  }

  /* ---- Title bar ---- */
  .fusion-window__titlebar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: var(--_win-titlebar-bg);
    border-bottom: 1px solid var(--_win-border);
    cursor: move;
    min-height: 36px;
    flex-shrink: 0;
  }

  .fusion-window__icon {
    font-size: 14px;
    line-height: 1;
  }

  .fusion-window__title {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--_win-titlebar-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fusion-window__controls {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .fusion-window__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--_win-titlebar-fg);
    cursor: pointer;
    font-size: 11px;
    opacity: 0.7;
    transition: opacity 0.15s, background 0.15s;
  }

  .fusion-window__btn:hover,
  .fusion-window__btn:focus-visible {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .fusion-window__btn--close:hover {
    background: rgba(220, 50, 50, 0.3);
  }

  /* ---- Content ---- */
  .fusion-window__content {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  /* ---- Resize handles ---- */
  .fusion-window__resize {
    position: absolute;
    z-index: 10;
  }

  .fusion-window__resize--n  { top: 0; left: var(--_resize-size); right: var(--_resize-size); height: var(--_resize-size); cursor: n-resize; }
  .fusion-window__resize--s  { bottom: 0; left: var(--_resize-size); right: var(--_resize-size); height: var(--_resize-size); cursor: s-resize; }
  .fusion-window__resize--e  { right: 0; top: var(--_resize-size); bottom: var(--_resize-size); width: var(--_resize-size); cursor: e-resize; }
  .fusion-window__resize--w  { left: 0; top: var(--_resize-size); bottom: var(--_resize-size); width: var(--_resize-size); cursor: w-resize; }
  .fusion-window__resize--ne { top: 0; right: 0; width: var(--_resize-size); height: var(--_resize-size); cursor: ne-resize; }
  .fusion-window__resize--nw { top: 0; left: 0; width: var(--_resize-size); height: var(--_resize-size); cursor: nw-resize; }
  .fusion-window__resize--se { bottom: 0; right: 0; width: var(--_resize-size); height: var(--_resize-size); cursor: se-resize; }
  .fusion-window__resize--sw { bottom: 0; left: 0; width: var(--_resize-size); height: var(--_resize-size); cursor: sw-resize; }
</style>
