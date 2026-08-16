<script lang="ts">
  /**
   * SidebarBadge.svelte — the badge drawn in the corner of a rail icon.
   *
   * Spec 36 (`specs/36-gaveta-lateral.md`) §5.3 / DEC-GAV-06:
   *  - one badge per tab, either a counter (`99+` above 99) or a state dot,
   *    never both (REQ-GAV-020);
   *  - drawn whenever the value exists — including on the active, open tab and
   *    with the drawer collapsed (REQ-GAV-021). That is structural here: this
   *    component takes the value and nothing about the drawer's state;
   *  - it never writes the value. Whoever lights it up and puts it out is the
   *    owning child tab (REQ-GAV-022, REQ-GAV-023);
   *  - it appears and disappears, and does nothing else: no sound, no blink, no
   *    entrance animation — hence no transition and no `animation` below
   *    (REQ-GAV-024).
   *
   * Drop it inside the rail button (which is already `position: relative`):
   *   <SidebarBadge value={tab.badge?.value ?? null} />
   */

  import { formatSidebarBadge } from "../../lib/sidebar/badges.svelte.js";
  import type { SidebarBadgeValue } from "../../lib/sidebar/registry.js";

  interface Props {
    /** The badge store's current value; `null`/`false`/`0` draw nothing. */
    value: SidebarBadgeValue | undefined;
  }

  const { value }: Props = $props();

  const display = $derived(formatSidebarBadge(value));
</script>

{#if display.kind === "counter"}
  <!-- The tab name is the button's accessible name (REQ-GAV-002); the count is
       decoration on top of it, so it is not announced a second time here. -->
  <span class="sidebar-badge sidebar-badge--counter" data-badge-kind="counter" aria-hidden="true"
    >{display.text}</span
  >
{:else if display.kind === "dot"}
  <span class="sidebar-badge sidebar-badge--dot" data-badge-kind="dot" aria-hidden="true"></span>
{/if}

<style>
  /* Corner of the icon (REQ-GAV-021); the rail button is the positioned ancestor. */
  .sidebar-badge {
    position: absolute;
    top: 1px;
    right: 1px;
    box-sizing: border-box;
    pointer-events: none;
  }

  .sidebar-badge--counter {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 8px;
    background: var(--fusion-accent);
    color: var(--fusion-surface);
    font-family: var(--fusion-font);
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
  }

  .sidebar-badge--dot {
    display: block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fusion-accent);
  }
</style>
