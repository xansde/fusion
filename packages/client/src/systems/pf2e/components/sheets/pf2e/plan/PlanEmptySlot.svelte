<script lang="ts">
  /**
   * PlanEmptySlot.svelte — an unchosen slot in a LevelCard: dashed border,
   * accent on hover. Clicking opens the slot's picker (caller-provided).
   *
   * Ports the design contract's `EmptySlot`
   * (.fusion-build/r10-design/claude-design/components/plan/LevelCard.jsx).
   */

  interface Props {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }

  let { label, onClick, disabled = false }: Props = $props();
</script>

<button type="button" class="plan-empty-slot" {disabled} onclick={onClick}>
  {label}
</button>

<style>
  .plan-empty-slot {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 8px;
    border: 1px dashed var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    font-size: 12px;
    font-family: var(--fusion-font);
    cursor: pointer;
    background: transparent;
    width: 100%;
    transition: border-color 0.12s, color 0.12s;
  }

  .plan-empty-slot:hover:not(:disabled),
  .plan-empty-slot:focus-visible:not(:disabled) {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent-hover);
  }

  .plan-empty-slot:disabled {
    cursor: default;
    opacity: 0.55;
  }
</style>
