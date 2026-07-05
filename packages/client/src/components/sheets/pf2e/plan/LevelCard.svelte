<script lang="ts">
  /**
   * LevelCard.svelte — one card per character level in the Plan column:
   * accent-wash header ("Nível N"), the level's slots (filled/empty), and a
   * strip of locked AutoChips for features the class grants automatically.
   *
   * Ports the design contract's `LevelCard`
   * (.fusion-build/r10-design/claude-design/components/plan/LevelCard.jsx).
   */

  import type { LevelPlanModel, PlanSlotModel } from "../../../../lib/sheets/pf2e/planVM.js";
  import PlanSlot from "./PlanSlot.svelte";
  import PlanEmptySlot from "./PlanEmptySlot.svelte";
  import PlanAutoChip from "./PlanAutoChip.svelte";
  import PlanOptionalBadge from "./PlanOptionalBadge.svelte";
  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    levelPlan: LevelPlanModel;
    editable: boolean;
    slotLabel: (slot: PlanSlotModel) => string;
    onSlotClick: (slot: PlanSlotModel) => void;
    onSlotRemove: (slot: PlanSlotModel) => void;
  }

  let { levelPlan, editable, slotLabel, onSlotClick, onSlotRemove }: Props = $props();
</script>

<div class="level-card">
  <div class="level-card__header">
    {t("FUSION.Sheet.Plan.LevelHeader", { level: String(levelPlan.level) })}
  </div>
  <div class="level-card__body">
    {#each levelPlan.slots as slot (slot.slotId)}
      {#if slot.filled}
        <PlanSlot
          name={slot.choiceName ?? slot.label}
          type={slot.label}
          onRemove={editable ? () => onSlotRemove(slot) : undefined}
        >
          {#snippet badge()}
            {#if slot.optional}<PlanOptionalBadge />{/if}
          {/snippet}
        </PlanSlot>
      {:else}
        <PlanEmptySlot label={slotLabel(slot)} disabled={!editable} onClick={() => onSlotClick(slot)} />
      {/if}
    {/each}

    {#if levelPlan.autoFeatures.length > 0}
      <div class="level-card__auto">
        {#each levelPlan.autoFeatures as feature (feature.name)}
          <PlanAutoChip name={feature.name} />
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .level-card {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    overflow: hidden;
  }

  .level-card__header {
    background: var(--fusion-accent-dim);
    color: var(--fusion-accent);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 8px 12px;
    border-bottom: 1px solid var(--fusion-border);
  }

  .level-card__body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
  }

  .level-card__auto {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px;
    margin-top: 2px;
    border-top: 1px dashed var(--fusion-border);
  }
</style>
