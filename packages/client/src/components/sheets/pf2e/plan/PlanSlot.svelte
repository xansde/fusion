<script lang="ts">
  /**
   * PlanSlot.svelte — a single filled choice slot inside a LevelCard.
   *
   * Ports the design contract's `Slot` (.fusion-build/r10-design/claude-design/
   * components/plan/LevelCard.jsx) to Svelte 5: green check + name/type
   * caption, hover-revealed remove (x). Optional badge slot (e.g. the amber
   * "Regra opcional ativa" tag for a Free Archetype feat) via the `badge`
   * snippet prop.
   *
   * R12 item 1: when `onEdit` is supplied the whole slot body becomes a
   * button that re-opens the slot's dialog pre-populated (in-place re-editing
   * of an already-filled ability-boost/skill-training slot), and a pencil
   * affordance appears on hover next to the remove (×).
   *
   * R12 (details): slots WITHOUT an in-place re-edit path (feats/hybrid
   * study — reversible only via remove + re-pick) instead accept `onDetails`,
   * which makes the body a button that opens the read-only details dialog
   * ("what does this feat do?") and shows an info (ⓘ) affordance on hover.
   * `onEdit` takes precedence when both are given. Passing neither keeps the
   * body non-clickable. Neither affordance interferes with the × remove
   * button (its click is stopPropagation'd).
   */

  import type { Snippet } from "svelte";

  interface Props {
    name: string;
    type: string;
    onRemove?: (() => void) | undefined;
    onEdit?: (() => void) | undefined;
    onDetails?: (() => void) | undefined;
    badge?: Snippet | undefined;
  }

  let { name, type, onRemove, onEdit, onDetails, badge }: Props = $props();

  // Edit is the primary body action when available (ability boosts / skill
  // trainings); details is the fallback for non-editable filled slots (feats).
  const bodyAction = $derived(onEdit ?? onDetails);
  const bodyIsEdit = $derived(onEdit !== undefined);
  const bodyLabel = $derived(bodyIsEdit ? `Editar: ${name}` : `Detalhes: ${name}`);
</script>

<div class="plan-slot" class:plan-slot--editable={bodyAction !== undefined}>
  {#if bodyAction}
    <button
      type="button"
      class="plan-slot__body"
      onclick={bodyAction}
      aria-label={bodyLabel}
    >
      <span class="plan-slot__check" aria-hidden="true">&#10003;</span>
      <span class="plan-slot__main">
        <span class="plan-slot__name">
          {name}
          {#if badge}{@render badge()}{/if}
        </span>
        <span class="plan-slot__type">{type}</span>
      </span>
      <span class="plan-slot__edit" aria-hidden="true">{bodyIsEdit ? "✎" : "ⓘ"}</span>
    </button>
  {:else}
    <span class="plan-slot__check" aria-hidden="true">&#10003;</span>
    <div class="plan-slot__main">
      <div class="plan-slot__name">
        {name}
        {#if badge}{@render badge()}{/if}
      </div>
      <div class="plan-slot__type">{type}</div>
    </div>
  {/if}
  {#if onRemove}
    <button
      type="button"
      class="plan-slot__remove"
      onclick={(e) => { e.stopPropagation(); onRemove?.(); }}
      aria-label={name}
    >
      &#215;
    </button>
  {/if}
</div>

<style>
  .plan-slot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    transition: background 0.12s;
  }

  .plan-slot:hover {
    background: var(--fusion-surface);
  }

  .plan-slot__body {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    text-align: left;
    cursor: pointer;
    font-family: var(--fusion-font);
    color: inherit;
  }

  .plan-slot__check {
    color: var(--fusion-success);
    font-size: 12px;
    flex-shrink: 0;
  }

  .plan-slot__main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .plan-slot__edit {
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
    color: var(--fusion-text-subtle);
    font-size: 12px;
    flex-shrink: 0;
  }

  .plan-slot--editable:hover .plan-slot__edit,
  .plan-slot__body:focus-visible .plan-slot__edit {
    opacity: 1;
  }

  .plan-slot__body:hover .plan-slot__name,
  .plan-slot__body:focus-visible .plan-slot__name {
    color: var(--fusion-accent-hover);
  }

  .plan-slot__name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .plan-slot__type {
    font-size: 10px;
    color: var(--fusion-text-subtle);
  }

  .plan-slot__remove {
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
    color: var(--fusion-text-subtle);
    cursor: pointer;
    font-size: 13px;
    padding: 2px 4px;
    flex-shrink: 0;
    background: transparent;
    border: none;
    font-family: var(--fusion-font);
  }

  .plan-slot:hover .plan-slot__remove,
  .plan-slot__remove:focus-visible {
    opacity: 1;
  }

  .plan-slot__remove:hover,
  .plan-slot__remove:focus-visible {
    color: var(--fusion-danger);
  }
</style>
