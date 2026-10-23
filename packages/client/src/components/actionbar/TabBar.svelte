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
  import Icon from "../common/Icon.svelte";
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
    <Icon name="chevron-down" size={20} />
  </button>
</div>

<style>
  .ab-tabs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--fusion-space-1);
    padding: 6px 10px;
    border-top: 1px solid var(--fusion-border);
  }

  /* 40 px tall: the touch-target floor (`--fusion-target`). */
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--fusion-target);
    padding: 0 var(--fusion-space-3);
    border: 1px solid transparent;
    border-radius: var(--fusion-radius);
    background: transparent;
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-sm);
    cursor: pointer;
    transition:
      color var(--fusion-transition),
      background-color var(--fusion-transition);
  }

  .tab__ic {
    display: block;
  }

  .tab__ic :global(svg) {
    display: block;
    width: 18px;
    height: 18px;
  }

  .tab:hover {
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }

  .tab.is-active {
    border-color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
    color: var(--fusion-text);
  }

  .tab.is-active .tab__ic {
    color: var(--fusion-accent);
  }

  .ab-collapse {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--fusion-target);
    height: var(--fusion-target);
    margin-left: auto;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
  }

  .ab-collapse:hover {
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }
</style>
