<script lang="ts">
  /**
   * SidebarRail.svelte — the icon-only rail of the side drawer.
   *
   * Spec 36 (`specs/36-gaveta-lateral.md`) §5.1:
   *  - a vertical column of icon-only buttons, hugging the left edge of the drawer
   *    and travelling with it (REQ-GAV-001);
   *  - the tab name reaches the user by `aria-label` and by a drawn tooltip, which
   *    is the only text in the rail (REQ-GAV-002);
   *  - three blocks in the order of DEC-GAV-01: group "all", then — visually
   *    separated — group "gm", and Settings anchored to the footer, DEC-GAV-09
   *    (REQ-GAV-003), with gm tabs absent for non-privileged roles (REQ-GAV-004);
   *  - the active tab is visually continuous with the panel while the drawer is
   *    open, and no tab reads as active once it is collapsed (REQ-GAV-005).
   *
   * Icons are drawn SVG, never emoji (REQ-NPC-094 / DEC-ACH-04) — see `./icons.ts`.
   *
   * The rail decides nothing: it draws what the registry lists and reports the
   * click. Open/switch/collapse is the drawer's (G012), and badge values belong to
   * the owning child tab (REQ-GAV-023) — this component never writes one.
   */

  import { getVisibleSidebarTabs } from "../../lib/sidebar/registry.js";
  import type { SidebarTabEntry } from "../../lib/sidebar/registry.js";
  import { isSidebarBadgeVisible } from "../../lib/sidebar/badges.svelte.js";
  import SidebarBadge from "./SidebarBadge.svelte";
  import { t } from "../../lib/i18n/i18n.js";

  interface Props {
    /** Whether the local user's role is privileged — mirrors `isRolePrivileged`. */
    isGm: boolean;
    /** Whether the drawer is open; collapsed means no tab is shown as active. */
    open: boolean;
    /** Id of the tab the drawer is showing, or null. */
    activeTabId: string | null;
    /** Reported on every click; the drawer decides open, switch or collapse. */
    onSelect: (tabId: string) => void;
  }

  const { isGm, open, activeTabId, onSelect }: Props = $props();

  const tabs = $derived(getVisibleSidebarTabs(isGm));

  /** REQ-GAV-005: nothing is active while the drawer is collapsed. */
  function isActive(id: string): boolean {
    return open && activeTabId === id;
  }

  /**
   * Id of the badge's hidden textual equivalent, so the button can describe
   * itself with it (REQ-A11-010). Reading the value to decide whether the badge
   * exists is still only reading — the rail writes no badge (REQ-GAV-022).
   */
  function badgeDescriptionId(tabId: string): string {
    return `sidebar-badge-desc-${tabId}`;
  }
</script>

{#snippet railButton(tab: SidebarTabEntry)}
  {@const hasBadge = isSidebarBadgeVisible(tab.badge?.value)}
  <!-- A toggle button, NOT `role="tab"`: the ARIA tabs pattern promises arrow-key
       navigation and a roving tabindex, which DEC-GAV-05 and REQ-GAV-041 deliberately
       do not implement (the rail is Tab/Enter/Espaço and nothing else). Announcing a
       pattern whose keyboard is absent strands the reader; `aria-pressed` says exactly
       what the button does — one gesture that shows or collapses this tab's panel
       (REQ-GAV-011) — and is a dynamic state a screen reader reads (REQ-A11-010).
       The generic `Tabs` component of spec 11 ("Componentes base") is where the full
       tablist pattern, arrow keys included, belongs; this rail is not it. -->
  <button
    type="button"
    class="sidebar-rail__button"
    class:sidebar-rail__button--active={isActive(tab.id)}
    data-tab-id={tab.id}
    aria-pressed={isActive(tab.id)}
    aria-label={t(tab.label)}
    aria-describedby={hasBadge ? badgeDescriptionId(tab.id) : undefined}
    onclick={() => onSelect(tab.id)}
  >
    <!-- Drawn icon (REQ-NPC-094): inline SVG authored in ./icons.ts, never a glyph. -->
    <span class="sidebar-rail__icon" aria-hidden="true">{@html tab.icon}</span>
    <!-- REQ-GAV-002: the tooltip is the only text in the rail; the accessible name
         is carried by aria-label, so the tooltip itself is hidden from a11y. -->
    <span class="sidebar-rail__tooltip" aria-hidden="true">{t(tab.label)}</span>
    <!-- REQ-GAV-021: the badge is drawn whenever the tab's store has a value — the
         active, open tab included. Reading `.value` here is the only thing the rail
         ever does with a badge; it never writes one (REQ-GAV-022, REQ-GAV-023).
         `descriptionId` gives the badge's hidden wording an anchor for the button's
         aria-describedby, so the state survives for a screen reader (REQ-A11-010). -->
    <SidebarBadge value={tab.badge?.value ?? null} descriptionId={badgeDescriptionId(tab.id)} />
  </button>
{/snippet}

<!-- A named group of buttons, not a `role="tablist"`: the label still reaches assistive
     technology, but nothing here announces the arrow-key navigation of the ARIA tabs
     pattern, which this rail does not have (REQ-GAV-041, DEC-GAV-05). -->
<div class="sidebar-rail" role="group" aria-label={t("FUSION.Sidebar.Rail.Label")}>
  <!-- Block 1 — every user (REQ-GAV-003) -->
  <div class="sidebar-rail__group" data-rail-group="all">
    {#each tabs.all as tab (tab.id)}
      {@render railButton(tab)}
    {/each}
  </div>

  <!-- Block 2 — GM group, separated by a rule; simply absent otherwise (REQ-GAV-004) -->
  {#if tabs.gm.length > 0}
    <div class="sidebar-rail__group sidebar-rail__group--gm" data-rail-group="gm">
      {#each tabs.gm as tab (tab.id)}
        {@render railButton(tab)}
      {/each}
    </div>
  {/if}

  <!-- Block 3 — anchored to the foot of the rail, same position for every role (DEC-GAV-09) -->
  {#if tabs.footer.length > 0}
    <div class="sidebar-rail__group sidebar-rail__group--footer" data-rail-group="footer">
      {#each tabs.footer as tab (tab.id)}
        {@render railButton(tab)}
      {/each}
    </div>
  {/if}
</div>

<style>
  /* 44px of rail (REQ-GAV-012); the panel's 300px are the drawer's business. */
  .sidebar-rail {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    width: var(--fusion-sidebar-rail-width, 44px);
    height: 100%;
    box-sizing: border-box;
    padding: 6px 0;
    gap: 6px;
    background: var(--fusion-surface-alt);
    border-left: 1px solid var(--fusion-border);
    /* REQ-GAV-013: the rail takes pointer events even with the drawer collapsed. */
    pointer-events: auto;
  }

  .sidebar-rail__group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  /* The visual separation REQ-GAV-003 asks for between the two groups. */
  .sidebar-rail__group--gm {
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--fusion-border);
  }

  /* DEC-GAV-09: Settings sits at the foot, in the same place for every role. */
  .sidebar-rail__group--footer {
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid var(--fusion-border);
  }

  .sidebar-rail__button {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    transition: var(--fusion-transition);
  }

  .sidebar-rail__button:hover {
    background: var(--fusion-surface);
    color: var(--fusion-text);
  }

  .sidebar-rail__button:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: -2px;
  }

  /* REQ-GAV-005: the active tab merges into the panel — same fill, and the seam
     on the panel side is erased so the button and the drawer read as one shape. */
  .sidebar-rail__button--active {
    width: 40px;
    margin-right: -2px;
    background: var(--fusion-surface);
    border-color: var(--fusion-border);
    border-right-color: var(--fusion-surface);
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    color: var(--fusion-accent);
  }

  .sidebar-rail__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
  }

  .sidebar-rail__icon :global(svg) {
    width: 20px;
    height: 20px;
    display: block;
  }

  /* Drawn tooltip (REQ-GAV-002) — to the left of the rail, since the rail lives on
     the right edge of the screen. Hidden until hover/focus; never announced twice,
     the accessible name is the button's aria-label. */
  .sidebar-rail__tooltip {
    position: absolute;
    right: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
    padding: 3px 8px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 12px;
    line-height: 1.4;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity var(--fusion-transition);
    z-index: 1;
  }

  .sidebar-rail__button:hover .sidebar-rail__tooltip,
  .sidebar-rail__button:focus-visible .sidebar-rail__tooltip {
    opacity: 1;
    visibility: visible;
  }
</style>
