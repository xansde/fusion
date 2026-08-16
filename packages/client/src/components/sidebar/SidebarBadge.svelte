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
   * Accessibility (REQ-A11-010, spec 23): the badge is the *only* carrier of two
   * dynamic states once the drawer is collapsed — "there are unread messages" and
   * "a combat is running". A shape in the corner of an icon says nothing to a
   * screen reader, so alongside the drawn span this component renders a
   * visually-hidden textual equivalent, which the rail button points at with
   * `aria-describedby` (`descriptionId`). It is a *description*, not the name:
   * REQ-GAV-002 reserves the accessible name for the tab name alone, and the
   * existing `aria-label` is left untouched. No `aria-live` here on purpose — an
   * unsolicited announcement per incoming message is the chat's call to make
   * (REQ-CHT-039, spec 38), not the container's, and REQ-GAV-023 keeps every
   * badge rule out of the rail.
   *
   * Drop it inside the rail button (which is already `position: relative`):
   *   <SidebarBadge value={tab.badge?.value ?? null} descriptionId={`x-${tab.id}`} />
   */

  import {
    SIDEBAR_BADGE_OVERFLOW_TEXT,
    formatSidebarBadge,
  } from "../../lib/sidebar/badges.svelte.js";
  import type { SidebarBadgeValue } from "../../lib/sidebar/registry.js";
  import { t } from "../../lib/i18n/i18n.js";

  interface Props {
    /** The badge store's current value; `null`/`false`/`0` draw nothing. */
    value: SidebarBadgeValue | undefined;
    /**
     * Id given to the hidden textual equivalent, so the owning button can point
     * at it with `aria-describedby` (REQ-A11-010). Omitted when the caller has
     * no button to describe.
     */
    descriptionId?: string | undefined;
  }

  const { value, descriptionId }: Props = $props();

  const display = $derived(formatSidebarBadge(value));

  /**
   * The counter as a word, for the hidden description. Unlike the drawn text it
   * does not stop at `99+` when the real number is known: "150 novidades" is more
   * use than "99+" to someone who cannot see the corner of the icon.
   */
  const spokenCount = $derived(
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : SIDEBAR_BADGE_OVERFLOW_TEXT,
  );

  /** Textual equivalent of what is drawn — generic, because the badge is (REQ-GAV-023). */
  const description = $derived.by(() => {
    if (display.kind === "counter") {
      return spokenCount === 1
        ? t("FUSION.Sidebar.Badge.CounterOne")
        : t("FUSION.Sidebar.Badge.CounterMany", { count: spokenCount });
    }
    if (display.kind === "dot") return t("FUSION.Sidebar.Badge.Dot");
    return "";
  });
</script>

{#if display.kind === "counter"}
  <!-- The tab name is the button's accessible name (REQ-GAV-002); the drawn count
       is decoration on top of it, so the visual span stays out of the a11y tree
       and the hidden sibling below carries the state instead (REQ-A11-010). -->
  <span class="sidebar-badge sidebar-badge--counter" data-badge-kind="counter" aria-hidden="true"
    >{display.text}</span
  >
{:else if display.kind === "dot"}
  <span class="sidebar-badge sidebar-badge--dot" data-badge-kind="dot" aria-hidden="true"></span>
{/if}

{#if display.kind !== "none"}
  <!-- REQ-A11-010 / REQ-GAV-021: the state a sighted user reads in the corner of
       the icon, in words, present with the drawer collapsed just the same. -->
  <span class="sidebar-badge-description" id={descriptionId} data-badge-description
    >{description}</span
  >
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

  /* Reachable by assistive tech, invisible on screen and out of the layout — the
     rail draws no text (REQ-GAV-001). Clipped rather than `display: none`, which
     would take it out of the accessibility tree as well. */
  .sidebar-badge-description {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
</style>
