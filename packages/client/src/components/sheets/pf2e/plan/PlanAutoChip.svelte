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
    /** EN subtitle beside the pt-BR chip name — always shown when present (r14). */
    subName?: string | undefined;
    onClick?: (() => void) | undefined;
    /**
     * `#rrggbb` accent for a chip that belongs to a NAMED source rather than
     * to the class (an Isekai blessing). Two archetypes land chips on the same
     * card, so colour is what tells the player which one granted what.
     * Undefined keeps the neutral class-feature look.
     */
    accent?: string | undefined;
  }

  let { name, subName, onClick, accent }: Props = $props();

  const hint = $derived(t("FUSION.Sheet.Plan.Details.ChipHint", { name }));
</script>

{#if onClick}
  <button
    type="button"
    class="plan-auto-chip plan-auto-chip--button"
    class:plan-auto-chip--accented={accent !== undefined}
    style={accent ? `--chip-accent: ${accent}` : undefined}
    onclick={onClick}
    title={hint}
    aria-label={hint}
  >
    <span class="plan-auto-chip__lock" aria-hidden="true">&#128274;</span>
    {name}
    {#if subName}<span class="plan-auto-chip__en">{subName}</span>{/if}
  </button>
{:else}
  <div
    class="plan-auto-chip"
    class:plan-auto-chip--accented={accent !== undefined}
    style={accent ? `--chip-accent: ${accent}` : undefined}
  >
    <span class="plan-auto-chip__lock" aria-hidden="true">&#128274;</span>
    {name}
    {#if subName}<span class="plan-auto-chip__en">{subName}</span>{/if}
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

  /*
   * A chip from a named source (Isekai archetype): the accent tints the
   * border and the text, and a left bar makes the source scannable when two
   * archetypes drop chips on the same level card.
   */
  .plan-auto-chip--accented {
    border-color: color-mix(in srgb, var(--chip-accent) 55%, transparent);
    color: var(--fusion-text);
    border-left: 3px solid var(--chip-accent);
    padding-left: 7px;
  }

  .plan-auto-chip--accented .plan-auto-chip__lock {
    color: var(--chip-accent);
  }

  .plan-auto-chip--accented.plan-auto-chip--button:hover,
  .plan-auto-chip--accented.plan-auto-chip--button:focus-visible {
    border-color: var(--chip-accent);
    background: color-mix(in srgb, var(--chip-accent) 12%, var(--fusion-surface));
  }

  /* EN subtitle beside the pt-BR chip name (r14). */
  .plan-auto-chip__en {
    font-size: 9.5px;
    font-weight: 400;
    color: var(--fusion-text-subtle);
    opacity: 0.75;
  }
</style>
