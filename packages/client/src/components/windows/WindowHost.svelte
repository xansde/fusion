<script lang="ts">
  /**
   * WindowHost.svelte — Portal/container that renders all open windows.
   *
   * Svelte 5 Runes component.
   * Implements REQ-UIF-009 (registry), REQ-UIF-016 (modais).
   *
   * Mounted once inside TableScreen (M3-C). It:
   *  - Tracks windowManager.windows reactively via $state
   *  - Renders one <Window> per entry; mounts the dynamic sheet component
   *    (WindowEntry.component) when present (REQ-UIF-019)
   *  - Listens to viewport resize and forwards to windowManager
   *  - Renders pending modals (ConfirmDialog / PromptDialog)
   *
   * TODO (next batch): migrate windowManager to expose a Svelte $state so the
   * rAF-based polling loop can be replaced with proper reactive subscriptions.
   */

  import { onMount } from "svelte";
  import { windowManager } from "$lib/windows/window-manager.js";
  import { pendingDialogs, removePendingDialog } from "$lib/windows/dialogs.js";
  import Window from "./Window.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import PromptDialog from "./PromptDialog.svelte";

  // -------------------------------------------------------------------------
  // Reactive mirror of the windowManager registry.
  //
  // WindowManager.windows is a plain Map mutated in place. To make Svelte 5
  // react to it we keep a reactive version by observing a tick counter that
  // increments whenever the manager mutates the map. In a full integration the
  // manager would store a Svelte $state directly; here we bridge the plain
  // object to Svelte reactivity with a minimal approach that avoids modifying
  // the pure manager.
  //
  // We expose two reactive arrays: `openWindows` (sorted by zIndex) and
  // `dialogs` (from pendingDialogs).
  // -------------------------------------------------------------------------

  // $state snapshots
  let windowEntries = $state([...windowManager.windows.values()]);
  let dialogs = $state([...pendingDialogs]);

  // Sync on every animation frame — lightweight for typical window counts (<20)
  // A proper integration would hook into a Svelte store or use $state in the manager.
  let rafId: number;

  function syncState() {
    windowEntries = [...windowManager.windows.values()].sort((a, b) => a.zIndex - b.zIndex);
    dialogs = [...pendingDialogs];
    rafId = requestAnimationFrame(syncState);
  }

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
    rafId = requestAnimationFrame(syncState);

    // Viewport resize
    pushViewportSize();
    window.addEventListener("resize", pushViewportSize);

    return () => {
      cancelAnimationFrame(rafId);
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
    z-index: var(--fusion-z-windows, 200);
  }

  /* Windows and dialogs re-enable pointer events on themselves */
  .fusion-window-host :global(.fusion-window),
  .fusion-window-host :global(dialog) {
    pointer-events: all;
  }
</style>
