<script lang="ts">
  /**
   * ConditionChips.svelte — the row of condition chips on a card (spec 39 §5.4).
   *
   * Draws at most two chips plus a "+N" indicator; pressing the indicator expands
   * the rest **in the card itself** (REQ-CTT-037): no window opens, and the drawer
   * keeps the single width it has for every tab (DEC-GAV-04) — which is why the
   * row wraps instead of growing sideways.
   *
   * Order (criticals → penalties → situations → benefits, alphabetical inside each
   * group, REQ-CTT-036) and the split itself are decided by the pure functions in
   * `$lib/conditions/conditionView.ts`; this component only draws the result.
   */

  import ConditionChip from "./ConditionChip.svelte";
  import {
    sortConditions,
    splitConditionsForDisplay,
    type ConditionView,
  } from "$lib/conditions/conditionView.js";
  import { t } from "../../lib/i18n/i18n.js";

  interface Props {
    conditions: readonly ConditionView[];
    /** Distinguishes tooltip ids when several cards are on screen at once. */
    idPrefix?: string;
  }

  const { conditions, idPrefix = "conditions" }: Props = $props();

  let expanded = $state(false);

  const ordered = $derived(sortConditions(conditions));
  const split = $derived(splitConditionsForDisplay(ordered, { expanded }));
  const moreLabel = $derived(
    split.hidden === 1
      ? t("FUSION.Conditions.ShowMoreOne")
      : t("FUSION.Conditions.ShowMoreMany", { count: split.hidden }),
  );
</script>

{#if ordered.length > 0}
  <div class="condition-chips" data-expanded={expanded ? "true" : "false"}>
    {#each split.shown as condition (condition.slug)}
      <ConditionChip {condition} tooltipId={`${idPrefix}-${condition.slug}`} />
    {/each}

    {#if split.hidden > 0}
      <button
        type="button"
        class="condition-chips__more"
        aria-expanded="false"
        aria-label={moreLabel}
        onclick={() => {
          expanded = true;
        }}
      >
        {t("FUSION.Conditions.More", { count: split.hidden })}
      </button>
    {:else if expanded && ordered.length > 2}
      <button
        type="button"
        class="condition-chips__more"
        aria-expanded="true"
        aria-label={t("FUSION.Conditions.ShowLess")}
        onclick={() => {
          expanded = false;
        }}
      >
        {t("FUSION.Conditions.ShowLess")}
      </button>
    {/if}
  </div>
{/if}

<style>
  /* Wraps inside the card: expanding adds a line, never width (REQ-CTT-037). */
  .condition-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .condition-chips__more {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border: 1px dashed var(--fusion-border);
    border-radius: var(--fusion-radius-pill);
    background: transparent;
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font);
    font-size: 11px;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .condition-chips__more:hover {
    color: var(--fusion-text);
    border-color: var(--fusion-text-muted);
  }

  .condition-chips__more:focus-visible {
    outline: 2px solid var(--fusion-accent-hover);
    outline-offset: 1px;
  }
</style>
