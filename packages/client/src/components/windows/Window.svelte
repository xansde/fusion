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
  import { isIconName } from "@fusion/shared";
  import Icon from "../common/Icon.svelte";

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
    {#if entry.icon !== undefined && isIconName(entry.icon)}
      <span class="fusion-window__icon" aria-hidden="true"><Icon name={entry.icon} size={18} /></span>
    {/if}
    <span class="fusion-window__title">{entry.title}</span>

    {#each entry.headerActions ?? [] as action (action.id)}
      <button
        type="button"
        class="fusion-window__action"
        title={action.title ?? action.label}
        onclick={action.onclick}
        onpointerdown={(e) => e.stopPropagation()}
      >
        {#if action.icon !== undefined && isIconName(action.icon)}<Icon name={action.icon} size={18} />{/if}
        <span>{action.label}</span>
      </button>
    {/each}

    <div class="fusion-window__controls">
      {#if entry.minimizable}
        <button
          class="fusion-window__btn fusion-window__btn--minimize"
          aria-label={entry.minimized ? "Restaurar janela" : "Minimizar janela"}
          onclick={() => entry.minimized ? windowManager.restore(entry.id) : windowManager.minimize(entry.id)}
          onpointerdown={(e) => e.stopPropagation()}
        >
          <Icon name={entry.minimized ? "chevron-up" : "chevron-down"} size={20} />
        </button>
      {/if}
      <button
        class="fusion-window__btn fusion-window__btn--close"
        aria-label="Fechar janela"
        onclick={onClose}
        onpointerdown={(e) => e.stopPropagation()}
      >
        <Icon name="x" size={20} />
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
  /* One floating layer: the theme's surface, one border, the one modal shadow
     (`--fusion-shadow-modal`), a title you can read (16 px) and 40 px controls. */
  .fusion-window {
    --_resize-size: 6px;

    display: flex;
    flex-direction: column;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border-strong);
    border-radius: var(--fusion-radius-lg);
    box-shadow: var(--fusion-shadow-modal);
    color: var(--fusion-text);
    overflow: hidden;
    contain: layout;
    user-select: none;
    outline: none;
  }

  .fusion-window:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 2px;
  }

  /* ---- Title bar ---- */
  .fusion-window__titlebar {
    display: flex;
    align-items: center;
    gap: var(--fusion-space-2);
    padding: var(--fusion-space-1) var(--fusion-space-1) var(--fusion-space-1) var(--fusion-space-3);
    background: var(--fusion-surface-alt);
    border-bottom: 1px solid var(--fusion-border);
    cursor: move;
    min-height: 48px;
    flex-shrink: 0;
  }

  .fusion-window__icon {
    display: inline-flex;
    color: var(--fusion-text-muted);
  }

  .fusion-window__title {
    flex: 1;
    min-width: 0;
    font-size: var(--fusion-text-md);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fusion-window__controls {
    display: flex;
    gap: var(--fusion-space-1);
    flex-shrink: 0;
  }

  .fusion-window__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--fusion-target);
    height: var(--fusion-target);
    background: transparent;
    border: none;
    border-radius: var(--fusion-radius);
    color: var(--fusion-text-muted);
    cursor: pointer;
    transition:
      color var(--fusion-transition),
      background-color var(--fusion-transition);
  }

  .fusion-window__btn:hover {
    background: var(--fusion-surface);
    color: var(--fusion-text);
  }

  .fusion-window__action {
    display: inline-flex;
    align-items: center;
    gap: var(--fusion-space-1);
    min-height: 32px;
    padding: 0 var(--fusion-space-2);
    background: transparent;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text);
    cursor: pointer;
    font-size: var(--fusion-text-sm);
  }

  .fusion-window__action:hover {
    background: var(--fusion-surface);
    border-color: var(--fusion-border-strong);
  }

  .fusion-window__btn--close:hover {
    background: var(--fusion-danger-dim);
    color: var(--fusion-danger);
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
