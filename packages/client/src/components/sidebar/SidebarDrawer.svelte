<script lang="ts">
  /**
   * SidebarDrawer.svelte — the panel half of the side drawer.
   *
   * Spec 36 (`specs/36-gaveta-lateral.md`) §5.2:
   *  - one fixed width for every tab, from a theme token, never resized by the user
   *    (REQ-GAV-012 / DEC-GAV-04): switching tabs cannot change the drawer's size;
   *  - overlaid on the canvas, reserving no layout (REQ-GAV-013, RNF-GAV-01) — the
   *    absolute positioning lives in `Sidebar.svelte`, which owns the whole overlay;
   *  - the panel of the active tab is the only thing mounted, and it is unmounted the
   *    moment the user switches or collapses (REQ-GAV-017).
   *
   * This component holds NO collapse control: no ✕, no chevron, no `Esc` handler. The
   * only way to collapse is clicking the active tab in the rail (REQ-GAV-011,
   * DEC-GAV-03), and `Esc` stays the canvas' cancel gesture.
   *
   * It also renders no header and no chrome of its own — the header of a tab belongs
   * to that tab's child spec (spec 36 §7), which is why the panel is a bare slot.
   */

  import type { SidebarPanelComponent, SidebarPanelProps } from "../../lib/sidebar/registry.js";

  interface Props {
    /** Whether the drawer is expanded; collapsed renders nothing at all. */
    open: boolean;
    /** Id of the tab being shown — surfaced for styling and tests, never for width. */
    activeTabId: string;
    /** Resolved panel component of the active tab, or null while it loads. */
    panel: SidebarPanelComponent | null;
    /** The contract every panel receives (registry, REQ-GAV-030). */
    panelProps: SidebarPanelProps;
  }

  const { open, activeTabId, panel, panelProps }: Props = $props();
</script>

{#if open}
  <div class="sidebar-drawer" data-active-tab={activeTabId} role="tabpanel" tabindex="-1">
    {#if panel}
      <!-- REQ-GAV-017: exactly one panel is mounted; switching tabs destroys this
           subtree, so panel state that must survive lives in the tab's own store. -->
      {@const Panel = panel}
      <Panel {...panelProps} />
    {/if}
  </div>
{/if}

<style>
  /* REQ-GAV-012: the one width, from the theme token, for every tab. Nothing here is
     conditional on which tab is showing, and there is no resize handle. */
  .sidebar-drawer {
    flex: 0 0 var(--fusion-sidebar-width);
    width: var(--fusion-sidebar-width);
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--fusion-surface);
    /* No border on the rail side: REQ-GAV-005 wants the active tab and the panel to
       read as one shape. The rail already carries the outer edge against the canvas. */
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    /* REQ-GAV-013: the drawer takes the pointer; the shell around it does not. */
    pointer-events: auto;
  }

  /* G015 owns the narrow-screen rule (REQ-GAV-040); the drawer only makes sure it
     never grows past the token on a normal viewport. */
</style>
