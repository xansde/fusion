/**
 * @fusion/system-pf2e — Apply damage pipeline.
 *
 * Handles the full pipeline for applying damage to an actor:
 *   1. Apply temp HP first (REQ-PF2-022).
 *   2. Apply Hardness (for shielded/item targets) (REQ-PF2-023).
 *   3. IWR pipeline via engine-2e (Immunity → Weakness → Resistance) (REQ-PF2-060).
 *   4. Apply final damage to HP (REQ-PF2-070..072 for dying/wounded sequencing).
 *
 * For basic saving throws, computes damage by degree (REQ-PF2-041).
 *
 * Clean-room: spec 17 DEC-PF2-08; ORC/OGL mechanics.
 * REQ-PF2-022, REQ-PF2-023, REQ-PF2-041, REQ-PF2-060, REQ-PF2-062.
 */

import { applyIwrMultiple, type IwrSet, type DamageInstance } from "@fusion/engine-2e";
import type { DegreeOfSuccess } from "@fusion/engine-2e";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single damage component with type and amount.
 */
export interface DamageComponent {
  /** Amount (positive = damage, negative = healing). */
  amount: number;
  /** Damage type slug (e.g., "fire", "slashing"). */
  type: string;
  /** Additional traits (e.g., "magical", "silver") for IWR exception matching. */
  traits?: string[];
}

/**
 * Target's current HP state before damage application.
 */
export interface TargetHpState {
  value: number;
  max: number;
  temp: number;
}

/**
 * Result of applying damage to a target's HP.
 */
export interface ApplyDamageResult {
  /** New HP value after damage. */
  newHp: number;
  /** New temp HP value after damage. */
  newTempHp: number;
  /** Final damage actually applied to HP (after temp HP absorption). */
  hpDamage: number;
  /** The total final damage from all components after IWR. */
  finalDamagePre: number;
  /** Whether the target reached 0 HP from this hit. */
  droppedToZero: boolean;
  /** Full breakdown for audit display. */
  breakdown: DamageBreakdownStep[];
}

/**
 * A step in the damage breakdown (displayed in chat card).
 */
export interface DamageBreakdownStep {
  step: "input" | "iwr" | "temp-hp" | "hp-apply" | "hardness";
  label: string;
  amount: number;
  note?: string;
}

// ---------------------------------------------------------------------------
// Basic saving throw damage multiplier (REQ-PF2-041)
// ---------------------------------------------------------------------------

/**
 * Scale damage based on degree of success for a basic saving throw.
 *
 * PF2e Remaster (§2.3):
 *   CriticalSuccess → 0× (no damage)
 *   Success         → ½× (halved, rounded down)
 *   Failure         → 1× (full damage)
 *   CriticalFailure → 2× (double damage)
 *
 * REQ-PF2-041.
 */
export function scaleBasicSaveDamage(baseAmount: number, degree: DegreeOfSuccess): number {
  switch (degree) {
    case "CriticalSuccess":
      return 0;
    case "Success":
      return Math.floor(baseAmount / 2);
    case "Failure":
      return baseAmount;
    case "CriticalFailure":
      return baseAmount * 2;
  }
}

// ---------------------------------------------------------------------------
// Full apply-damage pipeline
// REQ-PF2-022, REQ-PF2-060
// ---------------------------------------------------------------------------

/**
 * Apply one or more damage components to a target.
 *
 * Pipeline:
 *   1. IWR (per component). REQ-PF2-060.
 *   2. Hardness reduction (if provided). REQ-PF2-023.
 *   3. Temp HP absorption (REQ-PF2-022).
 *   4. HP reduction.
 *
 * @param components  - Damage components (may include multiple types).
 * @param target      - Target's current HP state.
 * @param targetIwr   - Target's IWR (optional; skipped if null).
 * @param hardness    - Hardness to subtract before applying (e.g., shield, object). Default 0.
 */
export function applyDamagePipeline(
  components: DamageComponent[],
  target: TargetHpState,
  targetIwr: IwrSet | null,
  hardness = 0,
): ApplyDamageResult {
  const breakdown: DamageBreakdownStep[] = [];

  // --- Step 1: IWR per component ---
  let finalDamagePre = 0;
  for (const comp of components) {
    breakdown.push({
      step: "input",
      label: `${comp.type} damage`,
      amount: comp.amount,
    });
    if (targetIwr) {
      const iwrInstance: DamageInstance =
        comp.traits !== undefined
          ? { amount: comp.amount, type: comp.type, traits: comp.traits }
          : { amount: comp.amount, type: comp.type };
      const iwrResult = applyIwrMultiple([iwrInstance], targetIwr);
      const afterIwr = iwrResult.total;
      for (const r of iwrResult.breakdown) {
        if (r.note) {
          breakdown.push({
            step: "iwr",
            label: `${r.type} (${r.note})`,
            amount: r.finalDamage,
            note: r.note,
          });
        }
      }
      finalDamagePre += afterIwr;
    } else {
      finalDamagePre += comp.amount;
    }
  }

  // --- Step 2: Hardness (REQ-PF2-023) ---
  if (hardness > 0) {
    const reduced = Math.max(finalDamagePre - hardness, 0);
    breakdown.push({
      step: "hardness",
      label: `Hardness ${String(hardness)}`,
      amount: reduced,
      note: `−${String(hardness)} hardness`,
    });
    finalDamagePre = reduced;
  }

  // --- Step 3: Temp HP absorption (REQ-PF2-022) ---
  let remainingDamage = finalDamagePre;
  let newTempHp = target.temp;
  if (newTempHp > 0 && remainingDamage > 0) {
    const tempAbsorbed = Math.min(newTempHp, remainingDamage);
    newTempHp -= tempAbsorbed;
    remainingDamage -= tempAbsorbed;
    breakdown.push({
      step: "temp-hp",
      label: `Temp HP absorbed`,
      amount: tempAbsorbed,
      note: `${String(tempAbsorbed)} temp HP consumed`,
    });
  }

  // --- Step 4: HP reduction ---
  const hpDamage = remainingDamage;
  const newHp = Math.max(target.value - hpDamage, 0);
  const droppedToZero = target.value > 0 && newHp === 0;
  breakdown.push({
    step: "hp-apply",
    label: `HP damage`,
    amount: hpDamage,
    note: `${String(target.value)} → ${String(newHp)} HP`,
  });

  return {
    newHp,
    newTempHp,
    hpDamage,
    finalDamagePre,
    droppedToZero,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Healing utility
// ---------------------------------------------------------------------------

/**
 * Apply healing to a target (increases HP, capped at max; does not restore temp HP).
 *
 * Healing in PF2e never restores temp HP directly — it only affects HP.
 */
export function applyHealing(
  target: TargetHpState,
  amount: number,
): { newHp: number; actualHealing: number } {
  const newHp = Math.min(target.value + amount, target.max);
  return { newHp, actualHealing: newHp - target.value };
}
