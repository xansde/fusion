<script lang="ts">
  /**
   * LevelCard.svelte — one card per character level in the Plan column:
   * accent-wash header ("Nível N"), the level's slots (filled/empty), and a
   * strip of locked AutoChips for features the class grants automatically.
   *
   * Ports the design contract's `LevelCard`
   * (.fusion-build/r10-design/claude-design/components/plan/LevelCard.jsx).
   */

  import type { LevelPlanModel, PlanSlotModel, AutoFeatureModel, AbilityGridCell } from "../../../../lib/sheets/pf2e/planVM.js";
  import { detailsRequestForSlot } from "../../../../lib/sheets/pf2e/planVM.js";
  import PlanSlot from "./PlanSlot.svelte";
  import PlanEmptySlot from "./PlanEmptySlot.svelte";
  import PlanAutoChip from "./PlanAutoChip.svelte";
  import PlanOptionalBadge from "./PlanOptionalBadge.svelte";
  import { t } from "../../../../lib/i18n/i18n.js";

  /** Bilingual display parts for a filled slot (r14: pt-BR main + EN subtitle for both name and type). */
  export interface SlotDisplay {
    name: string;
    subName?: string | undefined;
    type: string;
    subType?: string | undefined;
    /** For a filled abilityBoosts slot (r14 #6): the 3×2 net-per-ability grid to render instead of `name`. */
    grid?: AbilityGridCell[] | undefined;
    /** pt-BR ability short-labels keyed by slug (FOR/DES/CON/INT/SAB/CAR) for the grid header. */
    gridLabels?: Record<string, string> | undefined;
  }

  /** Bilingual display parts for a locked auto-feature chip (r14). */
  export interface AutoFeatureDisplay {
    name: string;
    subName?: string | undefined;
  }

  interface Props {
    levelPlan: LevelPlanModel;
    editable: boolean;
    slotLabel: (slot: PlanSlotModel) => string;
    /** Resolve a FILLED slot's bilingual name + type parts (r14). */
    slotDisplay: (slot: PlanSlotModel) => SlotDisplay;
    /** Resolve a locked auto-feature chip's bilingual parts (r14). */
    autoFeatureDisplay: (feature: AutoFeatureModel) => AutoFeatureDisplay;
    onSlotClick: (slot: PlanSlotModel) => void;
    onSlotRemove: (slot: PlanSlotModel) => void;
    /** Open the read-only details dialog for a filled feat/hybrid-study slot (R12). */
    onSlotDetails: (slot: PlanSlotModel) => void;
    /** Open the read-only details dialog for a locked auto-feature chip (R12). */
    onAutoFeatureClick: (feature: AutoFeatureModel) => void;
  }

  let {
    levelPlan,
    editable,
    slotLabel,
    slotDisplay,
    autoFeatureDisplay,
    onSlotClick,
    onSlotRemove,
    onSlotDetails,
    onAutoFeatureClick,
  }: Props = $props();

  // R12 item 1 / Frente 3: every FILLED slot supports in-place re-editing
  // (re-open the same dialog/picker, pre-populated with the current pick) —
  // ability boosts and skill trainings/increases read straight off the live
  // ledger, and every item-backed slot (feat/hybrid study/kinetic gate/…)
  // now REPLACES its pick on re-selection instead of accreting a duplicate
  // (see planVM.ts's chooseFeat doc comment), so re-opening the picker on a
  // filled card is safe generically — no per-type whitelist needed anymore.
  function canEdit(slot: PlanSlotModel): boolean {
    // A locked fixed-grant chip (B2 r14) is never editable — its lifecycle
    // follows the granter (removeChoice on the granter cascades to it).
    if (slot.lockedGrant) return false;
    return editable;
  }

  // A filled, NON-editable slot (read-only visitor, or a locked grant) still
  // gets a details click when it maps to a compendium document.
  function hasDetails(slot: PlanSlotModel): boolean {
    return !canEdit(slot) && detailsRequestForSlot(slot) !== null;
  }

  // A locked fixed-grant chip shows NO remove affordance (removed via its
  // granter), unlike a normal filled slot which is removable when editable.
  function canRemove(slot: PlanSlotModel): boolean {
    return editable && !slot.lockedGrant;
  }

  /**
   * Frente 3 (DEC-BC-05): a filled slot whose backing item no longer meets
   * its requirement gets a readable pt-BR/EN reason instead of just
   * disappearing or blocking re-selection — see planVM.ts's
   * `checkSlotRequirement`.
   */
  function requirementText(slot: PlanSlotModel): string | undefined {
    if (!slot.requirementIssue) return undefined;
    return t(slot.requirementIssue.reasonKey, slot.requirementIssue.params);
  }
</script>

<div class="level-card">
  <div class="level-card__header">
    {t("FUSION.Sheet.Plan.LevelHeader", { level: String(levelPlan.level) })}
  </div>
  <div class="level-card__body">
    {#each levelPlan.slots as slot (slot.slotId)}
      <!--
        A grantedFeat sub-slot (W1-D — e.g. Basic Concoction's nested
        alchemist feat pick) carries `parentSlotId` and is wrapped indented
        directly under its parent, matching the Pathbuilder-style nested card
        the user referenced (print 2).
      -->
      <div class="level-card__slot" class:level-card__slot--nested={slot.parentSlotId !== undefined}>
        {#if slot.filled}
          {@const display = slotDisplay(slot)}
          <PlanSlot
            name={display.name}
            subName={display.subName}
            type={display.type}
            subType={display.subType}
            grid={display.grid}
            gridLabels={display.gridLabels}
            onRemove={canRemove(slot) ? () => onSlotRemove(slot) : undefined}
            onEdit={canEdit(slot) ? () => onSlotClick(slot) : undefined}
            onDetails={hasDetails(slot) ? () => onSlotDetails(slot) : undefined}
            issueText={requirementText(slot)}
          >
            {#snippet badge()}
              {#if slot.optional}<PlanOptionalBadge />{/if}
            {/snippet}
          </PlanSlot>
        {:else}
          <PlanEmptySlot label={slotLabel(slot)} disabled={!editable} onClick={() => onSlotClick(slot)} />
        {/if}
      </div>
    {/each}

    {#if levelPlan.autoFeatures.length > 0}
      <div class="level-card__auto">
        <!--
          Keyed by name + archetype: an Isekai blessing can share a name with
          a class feature on the same card (both layers hand out things called
          "Feat de Classe"), and a bare-name key would collide and drop one.
        -->
        {#each levelPlan.autoFeatures as feature (`${feature.isekai?.archetypeId ?? "class"}:${feature.name}`)}
          {@const chip = autoFeatureDisplay(feature)}
          <PlanAutoChip
            name={chip.name}
            subName={chip.subName}
            accent={feature.isekai?.color}
            onClick={() => onAutoFeatureClick(feature)}
          />
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

  .level-card__slot {
    display: contents;
  }

  .level-card__slot--nested {
    display: block;
    margin-left: 18px;
    padding-left: 8px;
    border-left: 2px solid var(--fusion-border);
  }
</style>
