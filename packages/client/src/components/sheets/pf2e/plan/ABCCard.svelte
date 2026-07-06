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
   */

  interface Props {
    typeLabel: string;
    name?: string | undefined;
    /** EN subtitle beside the pt-BR name — always shown when present (r14). */
    subName?: string | undefined;
    subLine?: string | undefined;
    filled: boolean;
    editable: boolean;
    onClick: () => void;
  }

  let { typeLabel, name, subName, subLine, filled, editable, onClick }: Props = $props();
</script>

<button
  type="button"
  class="abc-card"
  class:abc-card--clickable={editable}
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
  </span>
</button>

<style>
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

  .abc-card--clickable {
    cursor: pointer;
    transition: border-color 0.12s;
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
