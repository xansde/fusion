<script lang="ts">
  /**
   * Sidebar.svelte — the side drawer as a whole: rail plus panel.
   *
   * Spec 36 (`specs/36-gaveta-lateral.md`). This is the only piece the table shell
   * mounts; everything else about the drawer hangs off it:
   *  - `SidebarRail` draws the icon-only tabs and reports clicks (REQ-GAV-001..005);
   *  - `SidebarDrawer` holds the one panel that is mounted (REQ-GAV-012, REQ-GAV-017);
   *  - `SidebarDrawerState` owns the single gesture and the local preference
   *    (REQ-GAV-010, REQ-GAV-011, REQ-GAV-014..016, RNF-GAV-02).
   *
   * Layout: the whole thing is an overlay pinned under the header on the right edge,
   * so opening or collapsing it never reflows the shell and never resizes the canvas
   * (REQ-GAV-013, RNF-GAV-01). Visual order is `[rail][panel]`, the rail hugging the
   * left edge of the drawer and travelling with it (REQ-GAV-001).
   *
   * There is no collapse control here either — clicking the active tab in the rail is
   * the whole vocabulary (REQ-GAV-011), and `Esc` is left to the canvas.
   */

  import { untrack } from "svelte";

  import SidebarRail from "./SidebarRail.svelte";
  import SidebarDrawer from "./SidebarDrawer.svelte";
  import { listVisibleSidebarTabs } from "../../lib/sidebar/registry.js";
  import type { SidebarPanelProps } from "../../lib/sidebar/registry.js";
  import { SidebarDrawerState } from "../../lib/sidebar/drawerState.svelte.js";

  /** The drawer takes exactly what it hands every panel (registry, REQ-GAV-030). */
  const { socket, worldId, userId, isGm, activeSceneId }: SidebarPanelProps = $props();

  // Read once, on purpose (hence `untrack`): the seat does not change identity while
  // the table is mounted — the registry is populated at startup, and a role change
  // means a new session. The drawer's own state is what is reactive from here on.
  const drawer = untrack(
    () =>
      new SidebarDrawerState({
        worldId,
        userId,
        isGm,
        visibleTabIds: listVisibleSidebarTabs(isGm).map((tab) => tab.id),
      }),
  );

  const panelProps = $derived<SidebarPanelProps>({
    socket,
    worldId,
    userId,
    isGm,
    activeSceneId,
  });
</script>

<aside class="fusion-sidebar" class:fusion-sidebar--open={drawer.open}>
  <SidebarRail
    {isGm}
    open={drawer.open}
    activeTabId={drawer.activeTabId}
    onSelect={(tabId) => drawer.select(tabId)}
  />
  <SidebarDrawer
    open={drawer.open}
    activeTabId={drawer.activeTabId}
    panel={drawer.panel}
    {panelProps}
  />
</aside>

<style>
  /* RNF-GAV-01 / REQ-GAV-013: an overlay, not a column of the shell. The canvas keeps
     its box whatever the drawer does, so opening it fires no resize; the drawer sits
     under the header and above the canvas in the shell's z stack (REQ-UIF-008). */
  .fusion-sidebar {
    position: absolute;
    top: var(--fusion-header-height);
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: row;
    z-index: 90;
    /* The empty area left of the rail belongs to the canvas; the rail and the panel
       switch pointer events back on for themselves. */
    pointer-events: none;
  }

  /* REQ-GAV-040 — narrow viewport: below 900px there is no room for a map AND a
     300px panel, so the open drawer takes everything left of the rail, still as an
     overlay on the canvas. `899.98px` is "below 900px" including fractional widths.

     Two things deliberately do NOT change: the rail keeps its 44px and its one
     gesture (clicking the active tab collapses, REQ-GAV-011), and the panel keeps
     reading its width from `--fusion-sidebar-width` (REQ-GAV-012) — the token is
     retuned for this subtree instead of the panel's own rules being overridden, so
     there is still exactly one place that decides how wide a tab is. This is what
     replaces, for the drawer, the FAB/swipe of REQ-UIF-062 and of spec 23: no extra
     control appears, and the markup is the same at every width. */
  @media (max-width: 899.98px) {
    .fusion-sidebar--open {
      left: 0;
      --fusion-sidebar-width: calc(100% - var(--fusion-sidebar-rail-width, 44px));
    }
  }
</style>
