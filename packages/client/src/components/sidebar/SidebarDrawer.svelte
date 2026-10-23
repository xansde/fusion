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
  <!-- Plain container, not `role="tabpanel"`: the rail is a group of toggle buttons and
       not an ARIA tablist (REQ-GAV-041, DEC-GAV-05), so there is no tab for a panel to
       belong to and nothing to point at with `aria-controls`. Claiming the role — and
       the `tabindex="-1"` that goes with it — would promise a tab/panel relationship
       that no markup here establishes. The panel's own heading is the tab's business
       (spec 36 §7). -->
  <div class="sidebar-drawer" data-active-tab={activeTabId}>
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
    /* REQ-GAV-005/A010 (prototype variant C, `.C .panel`): the outer edge against
       the canvas lives here, not on the rail — `.sidebar-rail` paints no fill or
       border of its own (A010), so the panel is the only box left to draw it. The
       accent token (not the neutral `--fusion-border`) is deliberate: it frames the
       open tab, and `.sidebar-rail__button--active`'s box-shadow (SidebarRail.svelte)
       erases exactly the segment behind the active button so the seam still reads
       as one continuous shape. */
    border-left: 1px solid var(--fusion-accent);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    /* REQ-GAV-013: the drawer takes the pointer; the shell around it does not. */
    pointer-events: auto;
  }

  /* G015 owns the narrow-screen rule (REQ-GAV-040); the drawer only makes sure it
     never grows past the token on a normal viewport. */
</style>
