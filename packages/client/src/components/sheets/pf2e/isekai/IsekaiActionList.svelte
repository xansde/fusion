<script lang="ts">
  /**
   * IsekaiActionList.svelte — everything the character can spend right now.
   *
   * One row per ability that costs actions, a reaction or Focus, filtered to
   * the character's level and ordered by the level that unlocked it. An
   * ability whose Focus cost is above what is currently spendable renders
   * dimmed with its cost still legible: "can't afford it yet" is information,
   * "it vanished from the list" is not.
   */

  import type { IsekaiActionRow } from "../../../../lib/sheets/pf2e/isekai/index.js";
  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    actions: IsekaiActionRow[];
    /** Focus available to spend right now — drives the affordable/dimmed state. */
    focusAvailable: number;
  }

  let { actions, focusAvailable }: Props = $props();

  /** The action-cost glyph: ⬥ per action, ↻ for a reaction, ◇ for a free action. */
  function costGlyph(cost: IsekaiActionRow["action"]["cost"]): string {
    switch (cost) {
      case "1":
        return "⬥";
      case "2":
        return "⬥⬥";
      case "3":
        return "⬥⬥⬥";
      case "reaction":
        return "↻";
      case "free":
        return "◇";
      default:
        return "—";
    }
  }

  function costLabel(cost: IsekaiActionRow["action"]["cost"]): string {
    return t(`FUSION.Sheet.Isekai.Cost.${cost}`);
  }
</script>

<section class="isekai-actions">
  <h3 class="isekai-actions__title">{t("FUSION.Sheet.Isekai.Actions.Title")}</h3>

  {#if actions.length === 0}
    <p class="isekai-actions__empty">{t("FUSION.Sheet.Isekai.Actions.Empty")}</p>
  {:else}
    <ul class="isekai-actions__list">
      {#each actions as row (`${row.archetype.id}:${row.action.id}`)}
        {@const unaffordable = row.action.focus > focusAvailable}
        <li
          class="isekai-action"
          class:isekai-action--dim={unaffordable}
          style={`--accent: ${row.archetype.color}`}
        >
          <span class="isekai-action__cost" title={costLabel(row.action.cost)} aria-label={costLabel(row.action.cost)}>
            {costGlyph(row.action.cost)}
          </span>
          <span class="isekai-action__body">
            <span class="isekai-action__name">{row.action.name}</span>
            <span class="isekai-action__text">{row.action.text}</span>
            {#if row.action.frequency}
              <span class="isekai-action__freq">{row.action.frequency}</span>
            {/if}
          </span>
          <span class="isekai-action__right">
            {#if row.action.focus > 0}
              <span class="isekai-action__focus">
                {t("FUSION.Sheet.Isekai.Actions.FocusCost", { n: String(row.action.focus) })}
              </span>
            {/if}
            <span class="isekai-action__level">
              {t("FUSION.Sheet.Isekai.Actions.Level", { n: String(row.action.level) })}
            </span>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .isekai-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .isekai-actions__title {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-text-muted);
  }

  .isekai-actions__empty {
    margin: 0;
    font-size: 11.5px;
    font-style: italic;
    color: var(--fusion-text-subtle);
  }

  .isekai-actions__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .isekai-action {
    display: grid;
    grid-template-columns: 34px 1fr auto;
    align-items: start;
    gap: 8px;
    padding: 7px 9px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-left: 3px solid var(--accent);
    border-radius: var(--fusion-radius);
  }

  .isekai-action--dim {
    opacity: 0.5;
  }

  .isekai-action__cost {
    font-size: 12px;
    color: var(--accent);
    letter-spacing: -1px;
    padding-top: 1px;
  }

  .isekai-action__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .isekai-action__name {
    font-size: 12px;
    font-weight: 700;
    color: var(--fusion-text);
  }

  .isekai-action__text {
    font-size: 11px;
    line-height: 1.4;
    color: var(--fusion-text-muted);
  }

  .isekai-action__freq {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-subtle);
  }

  .isekai-action__right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    white-space: nowrap;
  }

  .isekai-action__focus {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--accent);
  }

  .isekai-action__level {
    font-size: 9.5px;
    color: var(--fusion-text-subtle);
  }
</style>
