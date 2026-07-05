<script lang="ts">
  /**
   * PlanAutoChip.svelte — locked automatic feature chip (padlock glyph).
   * Represents a feature the class grants automatically at a level (e.g.
   * "Arcane Spellcasting", "Spellstrike"), not a player choice — the padlock
   * still signals "not editable".
   *
   * R12: the chip is now CLICKABLE to explain what it does (feedback, print
   * 2 — "continua difícil de saber o que estou selecionando"). When `onClick`
   * is supplied the chip renders as a button that opens the read-only
   * PlanDetailsDialog; a `title`/`aria-label` hint appears on hover/focus.
   * With no `onClick` it stays the original non-interactive div (keeps the
   * component usable in read-only contexts).
   *
   * Ports the design contract's `AutoChip`
   * (.fusion-build/r10-design/claude-design/components/plan/LevelCard.jsx).
   */

  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    name: string;
    onClick?: (() => void) | undefined;
  }

  let { name, onClick }: Props = $props();

  const hint = $derived(t("FUSION.Sheet.Plan.Details.ChipHint", { name }));
</script>

{#if onClick}
  <button
    type="button"
    class="plan-auto-chip plan-auto-chip--button"
    onclick={onClick}
    title={hint}
    aria-label={hint}
  >
    <span class="plan-auto-chip__lock" aria-hidden="true">&#128274;</span>
    {name}
  </button>
{:else}
  <div class="plan-auto-chip">
    <span class="plan-auto-chip__lock" aria-hidden="true">&#128274;</span>
    {name}
  </div>
{/if}

<style>
  .plan-auto-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
    font-size: 11px;
    padding: 4px 9px;
    border-radius: var(--fusion-radius-pill);
    cursor: default;
    font-family: var(--fusion-font);
  }

  .plan-auto-chip--button {
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s;
  }

  .plan-auto-chip--button:hover,
  .plan-auto-chip--button:focus-visible {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .plan-auto-chip__lock {
    font-size: 9px;
    color: var(--fusion-text-subtle);
  }
</style>
