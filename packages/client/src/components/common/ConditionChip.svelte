<script lang="ts">
  /**
   * ConditionChip.svelte — one condition, drawn the way the system declared it.
   *
   * Shared surface: the combat tab draws it on the turn head and in the queue
   * (REQ-CBA-050..053), and the contacts tab draws the same chip on a card
   * (REQ-CTT-030..038). Whoever changes the look changes it in one place, which is the
   * point of DEC-CTT-11 — the panel knows no condition by name, it paints a declaration.
   *
   *  - **No icon** (REQ-CTT-030, REQ-CBA-050): the `img` of a condition registration points
   *    at system art, and Paizo art is forbidden in this project. Text only.
   *  - **Colour from `tone`** (REQ-CTT-031): green helps, red hinders, purple is a
   *    situation. Never derived from the condition's effects, never from its gravity.
   *  - **Critical fills the chip** (REQ-CTT-032): emphasis on the tone it already has, not
   *    a fourth colour — and the word is in the accessible name, so the state does not live
   *    in the fill alone (REQ-CBA-094).
   *  - **The value is part of the label** (REQ-CTT-033), in tabular numerals so a column of
   *    chips does not wobble.
   *  - **Drawn tooltip, never `title`** (REQ-CTT-034): the native tooltip cannot be styled,
   *    is unreachable by keyboard on many browsers, and vanishes on touch. A chip with a
   *    declared `help` is focusable, and shows the tip on hover AND on focus.
   *  - **Fail open** (REQ-CTT-035): no `help` means no tooltip, no `tone` means a situation
   *    — the chip is still drawn.
   *  - **Truncation keeps the whole label reachable** (REQ-CTT-038): the visible text ends
   *    in an ellipsis, and the tip repeats the label in full.
   */

  import type { ConditionTone } from "../../lib/conditions/conditionChip.js";
  import { t } from "../../lib/i18n/i18n.js";

  interface Props {
    /** What is drawn: name and value already composed (REQ-CTT-033). */
    label: string;
    /** Declared effect on the bearer; anything absent is a situation (REQ-CTT-035). */
    tone?: ConditionTone | undefined;
    /** Declared as taking the character out of the scene (REQ-CTT-032). */
    critical?: boolean | undefined;
    /** Declared help text, or `null` for no tooltip (REQ-CTT-034/035). */
    help?: string | null | undefined;
  }

  const { label, tone = "special", critical = false, help = null }: Props = $props();

  const toneWord = $derived(
    tone === "benefit"
      ? t("FUSION.Condition.Tone.Benefit")
      : tone === "harm"
        ? t("FUSION.Condition.Tone.Harm")
        : t("FUSION.Condition.Tone.Special"),
  );

  /** The accessible name says the label, the tone and the criticality — never colour alone. */
  const accessibleName = $derived(
    critical ? `${label} — ${toneWord} — ${t("FUSION.Condition.Critical")}` : `${label} — ${toneWord}`,
  );
</script>

<!-- A chip with a declared help is a tooltip trigger, and a trigger has to be reachable
     without a pointer (REQ-CBA-093, REQ-UIF-064) — so it renders as a real button, which is
     focusable by itself. A chip with no help is inert text and renders as a span: giving a
     non-interactive element a tab stop would put an empty stop in the tab order. -->
<svelte:element
  this={help !== null ? "button" : "span"}
  type={help !== null ? "button" : undefined}
  class="condition-chip condition-chip--{tone}"
  class:condition-chip--critical={critical}
  class:condition-chip--tipped={help !== null}
  role="note"
  aria-label={accessibleName}
>
  <span class="condition-chip__label">{label}</span>

  {#if help !== null}
    <!-- REQ-CTT-034: drawn, not `title`. REQ-CTT-038: the full label lives here, so a
         truncated chip never hides what it says. -->
    <span class="condition-chip__tip" role="tooltip">
      <span class="condition-chip__tip-label">{label}</span>
      <span class="condition-chip__tip-help">{help}</span>
    </span>
  {/if}
</svelte:element>

<style>
  .condition-chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    /* The tipped chip is a <button>; these keep it looking exactly like the inert <span>. */
    background: none;
    font-family: var(--fusion-font);
    text-align: left;
    padding: 0.05rem 0.3rem;
    border: 1px solid var(--chip-color);
    border-radius: var(--fusion-radius-sm);
    color: var(--chip-color);
    font-size: 0.625rem;
    line-height: 1.35;
    font-variant-numeric: tabular-nums;
  }

  /* REQ-CTT-031: three tones, three colours, and nothing else decides them. */
  .condition-chip--benefit {
    --chip-color: var(--fusion-condition-benefit);
    --chip-fill: var(--fusion-condition-benefit-dim);
  }

  .condition-chip--harm {
    --chip-color: var(--fusion-condition-harm);
    --chip-fill: var(--fusion-condition-harm-dim);
  }

  .condition-chip--special {
    --chip-color: var(--fusion-condition-special);
    --chip-fill: var(--fusion-condition-special-dim);
  }

  /* REQ-CTT-032: filled, in the tone it already had. */
  .condition-chip--critical {
    background: var(--chip-fill);
    font-weight: 700;
  }

  /* REQ-CTT-038: what does not fit ends in an ellipsis on one line — the tip has it whole. */
  .condition-chip__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .condition-chip--tipped {
    cursor: help;
  }

  .condition-chip:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 1px;
  }

  /* The drawn tooltip: hidden until the chip is hovered or focused, and never a `title`. */
  .condition-chip__tip {
    position: absolute;
    bottom: calc(100% + 0.25rem);
    left: 0;
    z-index: 20;
    display: none;
    flex-direction: column;
    gap: 0.1rem;
    width: max-content;
    max-width: 14rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    box-shadow: var(--fusion-shadow-modal);
    color: var(--fusion-text);
    font-size: 0.6875rem;
    font-weight: 400;
    white-space: normal;
  }

  .condition-chip:hover .condition-chip__tip,
  .condition-chip:focus-visible .condition-chip__tip {
    display: flex;
  }

  .condition-chip__tip-label {
    color: var(--chip-color);
    font-weight: 600;
  }

  .condition-chip__tip-help {
    color: var(--fusion-text-muted);
  }
</style>
