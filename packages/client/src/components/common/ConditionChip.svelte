<script lang="ts">
  /**
   * ConditionChip.svelte — one condition, drawn by contract (spec 39 §5.4, G063).
   *
   * Shared by the Contacts (39), Combat (40) and NPCs (42) tabs: REQ-CTT-030..038,
   * REQ-CBA-050/051 and REQ-NPC-033 all describe this same chip, so it lives in
   * `components/common/` and none of them draws its own.
   *
   * What the chip is, and why:
   *  - **Text, no icon** (REQ-CTT-030): the `img` of a `ConditionDefinition` points
   *    at Paizo artwork, which this project may not ship. `ConditionView` does not
   *    even carry it.
   *  - **Color from `tone`** (REQ-CTT-031, DEC-CTT-11): green helps, red hinders,
   *    purple is a situation. Never from severity — no declared datum supports
   *    that judgement.
   *  - **Critical is emphasis** (REQ-CTT-032): the chip fills with its OWN tone
   *    color. There is no fourth hue in this stylesheet, by construction.
   *  - **The value is part of the label** (REQ-CTT-033): "Amedrontado 2", in
   *    tabular numerals so a column of chips does not jitter. Never a second tag.
   *  - **Drawn tooltip** (REQ-CTT-034): a `role="tooltip"` element of our own, not
   *    the native `title` — which cannot be styled, cannot be reached by keyboard
   *    on hover-only devices, and appears after a delay we do not control. It is
   *    rendered in the markup and revealed by `:hover`/`:focus-visible`, so it
   *    needs no script and no portal.
   *  - **Fail open** (REQ-CTT-035): no `help` → no tooltip; no `tone` → situation;
   *    an undeclared condition still gets a chip. Nothing here can hide one.
   *  - **Truncation keeps the whole label** (REQ-CTT-038): the label is clipped
   *    with an ellipsis by CSS, and the tooltip repeats it in full. When the
   *    system declared no help, the tooltip appears only once the label really is
   *    clipped — measured at runtime, since only the browser knows the width.
   */

  import type { ConditionView } from "$lib/conditions/conditionView.js";
  import { t } from "../../lib/i18n/i18n.js";

  interface Props {
    condition: ConditionView;
    /** Unique id for the tooltip element, so the chip can point at it. */
    tooltipId?: string;
  }

  const { condition, tooltipId }: Props = $props();

  /** Element that carries the (possibly clipped) label — measured below. */
  let labelEl = $state<HTMLElement | null>(null);
  let clipped = $state(false);

  $effect(() => {
    const el = labelEl;
    // Re-measure whenever the drawn text changes.
    void condition.label;
    if (!el) return;
    clipped = el.scrollWidth > el.clientWidth + 1;
  });

  /** REQ-CTT-034 / REQ-CTT-035 / REQ-CTT-038. */
  const hasTooltip = $derived(condition.help !== null || clipped);
  const describedBy = $derived(hasTooltip ? (tooltipId ?? `condition-${condition.slug}`) : undefined);

  /**
   * The tone (and the emphasis) in words. Color alone says nothing to a screen
   * reader — and says nothing to a colorblind reader either — so the chip always
   * carries a hidden textual equivalent alongside the hue.
   */
  const toneWord = $derived(
    condition.tone === "benefit"
      ? t("FUSION.Conditions.Tone.Benefit")
      : condition.tone === "harm"
        ? t("FUSION.Conditions.Tone.Harm")
        : t("FUSION.Conditions.Tone.Special"),
  );
  const meaning = $derived(
    condition.critical ? `${toneWord}, ${t("FUSION.Conditions.Critical")}` : toneWord,
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- The chip is the tooltip's trigger, and a tooltip trigger has to be reachable
     by keyboard (REQ-CTT-034) — otherwise the declared help exists only for a
     mouse. It is NOT a control: activating it does nothing, so a <button> would
     promise an action that isn't there. Hence a focusable span, and the tabindex
     only when there is in fact a tooltip to reveal. -->
<span
  class="condition-chip condition-chip--{condition.tone}"
  class:condition-chip--critical={condition.critical}
  data-condition={condition.slug}
  data-tone={condition.tone}
  data-critical={condition.critical ? "true" : "false"}
  tabindex={hasTooltip ? 0 : undefined}
  aria-describedby={describedBy}
>
  <span class="condition-chip__label" bind:this={labelEl}>{condition.label}</span>
  <!-- Hidden equivalent of the hue and of the filled emphasis. -->
  <span class="condition-chip__meaning">{meaning}</span>

  {#if hasTooltip}
    <span class="condition-chip__tooltip" id={describedBy} role="tooltip">
      <!-- The whole label, even when the chip above had to clip it (REQ-CTT-038). -->
      <span class="condition-chip__tooltip-label">{condition.label}</span>
      {#if condition.help !== null}
        <span class="condition-chip__tooltip-help">{condition.help}</span>
      {/if}
    </span>
  {/if}
</span>

<style>
  /* -------------------------------------------------------------------------
     Tone (REQ-CTT-031). Three hues, and only three in this whole stylesheet:
     the critical variant below reuses `--chip-ink` instead of adding a fourth
     (REQ-CTT-032).
     ------------------------------------------------------------------------- */
  .condition-chip--benefit {
    --chip-ink: var(--fusion-success);
    --chip-wash: var(--fusion-success-dim);
  }

  .condition-chip--harm {
    --chip-ink: var(--fusion-danger);
    --chip-wash: var(--fusion-danger-dim);
  }

  .condition-chip--special {
    --chip-ink: var(--fusion-accent);
    --chip-wash: var(--fusion-accent-dim);
  }

  .condition-chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    box-sizing: border-box;
    padding: 1px 7px;
    border: 1px solid var(--chip-ink);
    border-radius: var(--fusion-radius-pill);
    background: var(--chip-wash);
    color: var(--chip-ink);
    font-family: var(--fusion-font);
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
    cursor: default;
  }

  /* Emphasis, not a fourth color: the same ink, now as the fill. */
  .condition-chip--critical {
    background: var(--chip-ink);
    color: var(--fusion-bg);
    font-weight: 700;
  }

  .condition-chip:focus-visible {
    outline: 2px solid var(--fusion-accent-hover);
    outline-offset: 1px;
  }

  /* Value glued to the name, in tabular numerals (REQ-CTT-033); clipped with an
     ellipsis when the card is too narrow (REQ-CTT-038). */
  .condition-chip__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* Reachable by assistive tech, invisible on screen and out of the layout. */
  .condition-chip__meaning {
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

  /* -------------------------------------------------------------------------
     The drawn tooltip (REQ-CTT-034) — ours, not the native `title`.
     ------------------------------------------------------------------------- */
  .condition-chip__tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: max-content;
    max-width: 220px;
    box-sizing: border-box;
    padding: 6px 8px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    font-size: 11px;
    font-weight: 400;
    line-height: 1.35;
    white-space: normal;
    box-shadow: var(--fusion-shadow-modal);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }

  .condition-chip:hover .condition-chip__tooltip,
  .condition-chip:focus-visible .condition-chip__tooltip {
    opacity: 1;
    visibility: visible;
  }

  .condition-chip__tooltip-label {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .condition-chip__tooltip-help {
    color: var(--fusion-text-muted);
  }
</style>
