<script lang="ts">
  /**
   * PopoutWindow.svelte — host-side stand-in for a window detached into its own
   * browser window (see `$lib/windows/popout.ts` for the approach).
   *
   * Rendered by WindowHost instead of <Window> while `entry.poppedOut` is true.
   * It draws nothing in the table; on mount it takes the browser window opened by
   * `requestPopout()`, prepares its document (stylesheets, theme) and mounts
   * PopoutBody there — forwarding this component's Svelte contexts so the content
   * sees exactly what it would see inside the floating window.
   *
   * Lifecycle:
   *  - the user closes the browser window → the window comes back inside (popIn);
   *  - "Voltar para a mesa" in the popup → popIn → this component unmounts and
   *    closes the browser window;
   *  - the window is closed from the table (windowManager.close) → same;
   *  - focusing the window again (e.g. re-opening the same sheet) raises the popup.
   */

  import { getAllContexts, mount, onMount, unmount, untrack } from "svelte";
  import { windowManager, type WindowEntry } from "$lib/windows/window-manager.js";
  import { closePopoutWindow, popoutWindowOf, prepareChildDocument } from "$lib/windows/popout.js";
  import PopoutBody from "./PopoutBody.svelte";

  interface Props {
    entry: WindowEntry;
  }

  let { entry }: Props = $props();

  const contexts = getAllContexts();
  let child = $state<Window | undefined>(undefined);

  onMount(() => {
    const id = entry.id;
    const win = popoutWindowOf(id);
    if (!win) {
      windowManager.popIn(id);
      return;
    }

    let disposed = false;
    const { target, dispose } = prepareChildDocument(win, entry.title);
    const app = mount(PopoutBody, { target, props: { id }, context: contexts });
    child = win;

    // The user closed the browser window (its X, Alt+F4...): the window comes back inside.
    const onChildGone = (): void => {
      if (disposed) return;
      setTimeout(() => {
        if (!disposed && win.closed) windowManager.popIn(id);
      }, 0);
    };
    win.addEventListener("pagehide", onChildGone);
    // `pagehide` is not guaranteed on every close path: poll as the safety net.
    const poll = setInterval(() => {
      if (!disposed && win.closed) windowManager.popIn(id);
    }, 500);
    win.focus();

    return () => {
      disposed = true;
      clearInterval(poll);
      try {
        void unmount(app);
      } catch {
        // the child document may already be torn down
      }
      dispose();
      child = undefined;
      closePopoutWindow(id);
    };
  });

  // Keep the browser window's title in step with the sheet's.
  $effect(() => {
    const title = entry.title;
    if (child && !child.closed) child.document.title = title;
  });

  // focus() on a detached window (same sheet opened again) raises its browser window.
  let lastZ = untrack(() => entry.zIndex);
  $effect(() => {
    const z = entry.zIndex;
    if (z === lastZ) return;
    lastZ = z;
    if (child && !child.closed) child.focus();
  });
</script>
