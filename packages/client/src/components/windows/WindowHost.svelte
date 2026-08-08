<script lang="ts">
  /**
   * WindowHost.svelte — Portal/container that renders all open windows.
   *
   * Svelte 5 Runes component.
   * Implements REQ-UIF-009 (registry), REQ-UIF-016 (modais).
   *
   * Mounted once inside TableScreen (M3-C). It:
   *  - Tracks windowManager.windows reactively (SvelteMap → $derived)
   *  - Renders one <Window> per entry; mounts the dynamic sheet component
   *    (WindowEntry.component) when present (REQ-UIF-019)
   *  - Listens to viewport resize and forwards to windowManager
   *  - Renders pending modals (ConfirmDialog / PromptDialog)
   *
   * r21-Y1: the old rAF-based polling loop is gone. `windowManager.windows` is
   * a `SvelteMap` and `pendingDialogs` is a `$state` array, so the two derived
   * lists below re-compute automatically on open/close/focus/move/minimize and
   * on dialog push/remove — instantly and independent of `requestAnimationFrame`
   * / tab visibility (headless browsers where `document.hidden === true` never
   * fire rAF used to leave newly-opened windows stuck out of the DOM).
   */

  import { onMount } from "svelte";
  import { windowManager } from "$lib/windows/window-manager.js";
  import { pendingDialogs, removePendingDialog } from "$lib/windows/dialogs.svelte.js";
  import Window from "./Window.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import PromptDialog from "./PromptDialog.svelte";

  // -------------------------------------------------------------------------
  // Reactive views over the manager state.
  //
  // Reading `windowManager.windows.values()` inside a $derived subscribes to
  // the SvelteMap; any set()/delete() (open/close/focus/move/minimize) re-runs
  // it. Reading `pendingDialogs` subscribes to the $state array; push/splice
  // (confirm/prompt/remove) re-runs it. No polling.
  // -------------------------------------------------------------------------

  const windowEntries = $derived(
    [...windowManager.windows.values()].sort((a, b) => a.zIndex - b.zIndex),
  );
  const dialogs = $derived([...pendingDialogs]);

  /**
   * Push the current viewport size into windowManager, guarding against a
   * 0x0 read (window.innerWidth/innerHeight can legitimately be 0 for a
   * frame or two before the browser has completed layout — e.g. very first
   * paint, or a headless/embedded webview). A 0x0 viewport would otherwise
   * get baked into clampToViewport() at windowManager.open() time and
   * PERMANENTLY shrink every window opened in that window to
   * DEFAULT_MIN_WIDTH/HEIGHT (200x100) — clampToViewport only ever shrinks
   * geometry on subsequent resizes, it never grows it back. Verified via a
   * real boot() + browser session (M5-D E2E): the very first sheet opened
   * after login came out 200x100 instead of its configured 820x640 because
   * this ran while window.innerWidth was still 0.
   */
  function pushViewportSize(): void {
    const width = window.innerWidth || windowManager.viewport.width || 1280;
    const height = window.innerHeight || windowManager.viewport.height || 800;
    windowManager.onViewportResize({ width, height });
  }

  onMount(() => {
    // Viewport resize — pushed once on mount, then on every window resize.
    pushViewportSize();
    window.addEventListener("resize", pushViewportSize);

    return () => {
      window.removeEventListener("resize", pushViewportSize);
    };
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function handleClose(id: string) {
    windowManager.close(id);
  }

  function handleFocus(id: string) {
    windowManager.focus(id);
  }

  function handleDialogSettled(dialog: typeof dialogs[number]) {
    removePendingDialog(dialog);
  }
</script>

<div class="fusion-window-host" aria-label="Janelas" role="region">
  <!-- Floating windows -->
  {#each windowEntries as entry (entry.id)}
    <Window
      {entry}
      onClose={() => handleClose(entry.id)}
      onFocus={() => handleFocus(entry.id)}
    >
      {#if entry.component}
        <!-- REQ-UIF-019: mount the registered sheet component dynamically.
             Svelte 5 runes: dynamic components use {@const} + direct render. -->
        {@const SheetComponent = entry.component}
        <SheetComponent {...(entry.componentProps ?? {})} />
      {/if}
    </Window>
  {/each}

  <!-- Modal dialogs -->
  {#each dialogs as dialog (dialog)}
    {#if dialog.kind === "confirm"}
      <ConfirmDialog
        pending={dialog}
        onSettled={() => handleDialogSettled(dialog)}
      />
    {:else if dialog.kind === "prompt"}
      <PromptDialog
        pending={dialog}
        onSettled={() => handleDialogSettled(dialog)}
      />
    {/if}
  {/each}
</div>

<style>
  .fusion-window-host {
    /* Positioned container for all floating windows. Sits above canvas layers
       but below context menus/tooltips/modals (z-index from REQ-UIF-008). */
    position: fixed;
    inset: 0;
    pointer-events: none; /* let clicks through to canvas */
    /* REQ-UIF-008: the fallback literal is gone — the scale is declared once,
       in base.css. A missing token should surface as a visible stacking bug,
       not be silently papered over by a duplicate magic number here. */
    z-index: var(--fusion-z-windows);
  }

  /* Windows and dialogs re-enable pointer events on themselves */
  .fusion-window-host :global(.fusion-window),
  .fusion-window-host :global(dialog) {
    pointer-events: all;
  }
</style>
