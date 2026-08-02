<script lang="ts">
  /**
   * ABCCard.svelte — Ancestry/Heritage/Background/Class card at the top of
   * the Plan column. Green check when filled, uppercase type-label, chosen
   * name, optional sub-line (e.g. the Magus's Hybrid Study pick).
   *
   * Ports the design contract's `ABCCard`
   * (.fusion-build/r10-design/claude-design/components/plan/ABCCard.jsx).
   * Clicking an unfilled card (or an editable filled one) opens the matching
   * compendium picker — the caller decides via `onClick`.
   *
   * r20-X4: an ABC card can carry a strip of LOCKED chips below it — the
   * auto-conceded features from the doc's `system.items` map (Unusual Anatomy,
   * Sharp Teeth, Fascinating Performance…) plus informative ancestry scalars
   * (Size, Vision). Rendered as siblings BELOW the card button (never nested,
   * to keep valid button markup). A chip with an `onClick` is clickable
   * (opens the read-only details dialog); informative chips are static.
   */

  import PlanAutoChip from "./PlanAutoChip.svelte";

  /** A locked chip shown under the card (already bilingual-split by the caller). */
  export interface AbcChipDisplay {
    key: string;
    name: string;
    subName?: string | undefined;
    onClick?: (() => void) | undefined;
  }

  interface Props {
    typeLabel: string;
    name?: string | undefined;
    /** EN subtitle beside the pt-BR name — always shown when present (r14). */
    subName?: string | undefined;
    subLine?: string | undefined;
    filled: boolean;
    editable: boolean;
    onClick: () => void;
    /** Locked auto-feature / scalar chips shown under the card (r20-X4). */
    chips?: AbcChipDisplay[] | undefined;
    /**
     * Frente 3 (DEC-BC-05): a readable "requirements not met" reason (e.g. a
     * heritage whose declared ancestry no longer matches the character's
     * current ancestry) — when set, the card gets a red-border marker
     * instead of being hidden or blocked; it's still fully re-selectable.
     */
    issueText?: string | undefined;
  }

  let { typeLabel, name, subName, subLine, filled, editable, onClick, chips, issueText }: Props = $props();
</script>

<div class="abc-card-wrap">
  <button
    type="button"
    class="abc-card"
    class:abc-card--clickable={editable}
    class:abc-card--has-chips={chips && chips.length > 0}
    class:abc-card--invalid={issueText !== undefined}
    disabled={!editable}
    onclick={onClick}
  >
    <span class="abc-card__badge" class:abc-card__badge--done={filled} aria-hidden="true">
      {#if filled}&#10003;{/if}
    </span>
    <span class="abc-card__body">
      <span class="abc-card__label">{typeLabel}</span>
      <span class="abc-card__name">
        {name ?? "—"}
        {#if subName}<span class="abc-card__name-en">{subName}</span>{/if}
      </span>
      {#if subLine}<span class="abc-card__subline">{subLine}</span>{/if}
      {#if issueText}<span class="abc-card__issue">{issueText}</span>{/if}
    </span>
  </button>

  {#if chips && chips.length > 0}
    <div class="abc-card__chips">
      {#each chips as chip (chip.key)}
        <PlanAutoChip name={chip.name} subName={chip.subName} onClick={chip.onClick} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .abc-card-wrap {
    display: flex;
    flex-direction: column;
  }

  .abc-card {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    font-family: var(--fusion-font);
    cursor: default;
  }

  /* When chips hang below, square off the card's bottom corners so the strip
     reads as one block with the card. */
  .abc-card--has-chips {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-bottom: none;
  }

  .abc-card__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 10px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-top: 1px dashed var(--fusion-border);
    border-bottom-left-radius: var(--fusion-radius);
    border-bottom-right-radius: var(--fusion-radius);
  }

  .abc-card--clickable {
    cursor: pointer;
    transition: border-color 0.12s;
  }

  /* Frente 3 (DEC-BC-05): a red border MARKS a card whose pick no longer
     meets its requirement — it never disappears and is never blocked. */
  .abc-card--invalid {
    border-color: var(--fusion-danger);
  }

  .abc-card__issue {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--fusion-danger);
    margin-top: 2px;
  }

  .abc-card--clickable:hover,
  .abc-card--clickable:focus-visible {
    border-color: var(--fusion-accent);
  }

  .abc-card__badge {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: transparent;
    border: 1px dashed var(--fusion-border);
    color: var(--fusion-success);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .abc-card__badge--done {
    background: var(--fusion-success-dim);
    border: none;
  }

  .abc-card__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .abc-card__label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-subtle);
  }

  .abc-card__name {
    font-size: 13px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  /* EN subtitle beside the pt-BR ABC name (r14). */
  .abc-card__name-en {
    margin-left: 6px;
    font-size: 10.5px;
    font-weight: 400;
    color: var(--fusion-text-subtle);
  }

  .abc-card__subline {
    font-size: 11px;
    color: var(--fusion-text-muted);
    margin-top: 2px;
  }
</style>
