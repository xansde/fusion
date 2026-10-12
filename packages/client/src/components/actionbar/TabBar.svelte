<script lang="ts">
  /**
   * TabBar.svelte — the tabs of the action bar and its fold button (BAR-F1-04; spec 53 REQ-BAR-026,
   * REQ-BAR-033, D-BA07; prototype `.ab-tabs`).
   *
   * Favorites plus the six tabs of `ActionBarTab` — Golpes, Magias, Ações, Itens, Reações, Testes.
   * An empty tab is still a tab: it says it is empty instead of disappearing (REQ-BAR-026). Each
   * button is a toggle of a group (`aria-pressed`), and a pointer click gives the focus back to the
   * canvas (`releaseFocusAfterPointer`, Q-BAR-07), or the number keys would stay silent behind it.
   */

  import { t } from "../../lib/i18n/i18n.js";
  import { releaseFocusAfterPointer } from "../../lib/actionbar/slotFocus.js";
  import type { ActionBarTab } from "../../lib/actionbar/types.js";
  import { TAB_ICON, iconSvg } from "./icons.js";

  interface Props {
    active: ActionBarTab | "favorites";
    onselect: (tab: ActionBarTab | "favorites") => void;
    oncollapse: () => void;
  }

  const { active, onselect, oncollapse }: Props = $props();

  const TABS: ReadonlyArray<{ id: ActionBarTab | "favorites"; label: string }> = [
    { id: "favorites", label: "FUSION.ActionBar.Tabs.Favorites" },
    { id: "strikes", label: "FUSION.ActionBar.Tabs.Strikes" },
    { id: "spells", label: "FUSION.ActionBar.Tabs.Spells" },
    { id: "actions", label: "FUSION.ActionBar.Tabs.Actions" },
    { id: "items", label: "FUSION.ActionBar.Tabs.Items" },
    { id: "reactions", label: "FUSION.ActionBar.Tabs.Reactions" },
    { id: "checks", label: "FUSION.ActionBar.Tabs.Checks" },
  ];

  function select(event: MouseEvent, tab: ActionBarTab | "favorites"): void {
    releaseFocusAfterPointer(event, document);
    onselect(tab);
  }

  function collapse(event: MouseEvent): void {
    releaseFocusAfterPointer(event, document);
    oncollapse();
  }
</script>

<div class="ab-tabs" role="group" aria-label={t("FUSION.ActionBar.Tabs.Label")}>
  {#each TABS as tab (tab.id)}
    <button
      type="button"
      class="tab"
      class:is-active={active === tab.id}
      aria-pressed={active === tab.id ? "true" : "false"}
      data-tab={tab.id}
      onclick={(event) => {
        select(event, tab.id);
      }}
    >
      <span class="tab__ic" aria-hidden="true">{@html iconSvg(TAB_ICON[tab.id])}</span>
      {t(tab.label)}
    </button>
  {/each}

  <button
    type="button"
    class="ab-collapse"
    aria-label={t("FUSION.ActionBar.Collapse")}
    data-action="collapse"
    onclick={collapse}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  </button>
</div>

<style>
  .ab-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border-top: 1px solid var(--fusion-border);
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font);
    font-size: 12px;
    cursor: pointer;
    transition: var(--fusion-transition);
  }

  .tab :global(svg) {
    display: block;
    width: 14px;
    height: 14px;
  }

  .tab:hover {
    color: var(--fusion-text);
  }

  .tab.is-active {
    border-color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
    color: var(--fusion-accent-hover);
  }

  .tab:focus-visible,
  .ab-collapse:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }

  .ab-collapse {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    margin-left: auto;
    padding: 0;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
  }

  .ab-collapse:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .ab-collapse svg {
    display: block;
    width: 16px;
    height: 16px;
  }
</style>
