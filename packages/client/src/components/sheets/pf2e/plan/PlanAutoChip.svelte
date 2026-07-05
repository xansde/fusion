<script lang="ts">
  /**
   * PlanAutoChip.svelte — locked automatic feature chip (padlock glyph).
   * Non-interactive — represents a feature the class grants automatically at
   * a level (e.g. "Arcane Spellcasting", "Spellstrike"), not a player choice.
   *
   * Ports the design contract's `AutoChip`
   * (.fusion-build/r10-design/claude-design/components/plan/LevelCard.jsx).
   */

  interface Props {
    name: string;
  }

  let { name }: Props = $props();
</script>

<div class="plan-auto-chip">
  <span class="plan-auto-chip__lock" aria-hidden="true">&#128274;</span>
  {name}
</div>

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
  }

  .plan-auto-chip__lock {
    font-size: 9px;
    color: var(--fusion-text-subtle);
  }
</style>
