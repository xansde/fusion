/**
 * Modifier stacking rules — PF2e Remaster.
 *
 * Clean-room implementation based on:
 *   docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §3.2 — Fórmula Geral de Check
 *   specs/17-sistema-pf2e.md §Conceitos (ModifierType)
 *   Archives of Nethys (ORC license).
 *
 * Stacking rules:
 *   - Same-type BONUSES: only the highest applies (no stacking).
 *   - Same-type PENALTIES: only the most-negative applies (no stacking).
 *   - Different types: all sum (bonuses add to bonuses, penalties to penalties).
 *   - "untyped" BONUSES: do NOT stack — highest wins (PF2e RAW).
 *   - "untyped" PENALTIES: DO stack (additive) — MAP and range penalties are additive.
 *
 * Note: bonuses and penalties of the same type are resolved independently
 * (best bonus + worst penalty) then summed. See ms-011 for rationale.
 *
 * This module exposes the PF2e-specific stacking table and a stacking resolver
 * for standalone use. The generic `aggregateModifiers` function from
 * `@fusion/system-api` is used under the hood.
 */

export interface Modifier {
  readonly slug: string;
  readonly type: string;
  readonly value: number;
}

/**
 * PF2e canonical stacking table.
 *
 * - circumstance, item, status, proficiency, ability, potency: highest bonus / most-negative penalty.
 * - untyped: highest bonus (PF2e RAW: untyped bonuses don't stack) / additive penalty.
 *
 * The engine (aggregateModifiers) treats any type absent from the table as fully
 * additive for both bonuses and penalties. Since "untyped" has asymmetric behaviour
 * (bonus=highest-only, penalty=additive), it must appear in the table explicitly.
 */
export const PF2E_STACKING_TABLE = [
  { type: "circumstance", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
  { type: "item", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
  { type: "status", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
  { type: "proficiency", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
  { type: "ability", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
  { type: "potency", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
  // untyped: bonuses do NOT stack (highest wins); penalties DO stack (additive — MAP, range)
  { type: "untyped", bonusBehaviour: "highest-only", penaltyBehaviour: "additive" },
] as const;

type BonusBehaviour = "highest-only" | "additive";
type PenaltyBehaviour = "lowest-only" | "additive";

interface StackingRule {
  readonly type: string;
  readonly bonusBehaviour: BonusBehaviour;
  readonly penaltyBehaviour: PenaltyBehaviour;
}

/**
 * Resolve the total modifier from a list of modifiers, applying PF2e stacking rules.
 *
 * Uses the provided stacking table (defaulting to PF2E_STACKING_TABLE).
 * Any modifier type absent from the table is treated as fully additive for
 * both bonuses and penalties.
 *
 * @param modifiers    - List of modifiers to resolve.
 * @param stackingTable - Stacking rules (defaults to PF2E_STACKING_TABLE).
 */
export function resolveStacking(
  modifiers: readonly Modifier[],
  stackingTable: readonly StackingRule[] = PF2E_STACKING_TABLE,
): number {
  const rulesByType = new Map<string, StackingRule>();
  for (const rule of stackingTable) {
    rulesByType.set(rule.type, rule);
  }

  // Group bonuses and penalties by type independently (per PF2e RAW: ms-011).
  const bonusesByType = new Map<string, number[]>();
  const penaltiesByType = new Map<string, number[]>();

  for (const mod of modifiers) {
    if (mod.value >= 0) {
      const arr = bonusesByType.get(mod.type) ?? [];
      arr.push(mod.value);
      bonusesByType.set(mod.type, arr);
    } else {
      const arr = penaltiesByType.get(mod.type) ?? [];
      arr.push(mod.value);
      penaltiesByType.set(mod.type, arr);
    }
  }

  let total = 0;

  // Resolve bonuses per type
  for (const [type, values] of bonusesByType) {
    const rule = rulesByType.get(type);
    const behaviour: BonusBehaviour = rule?.bonusBehaviour ?? "additive";
    if (behaviour === "highest-only") {
      total += Math.max(...values);
    } else {
      total += values.reduce((a, b) => a + b, 0);
    }
  }

  // Resolve penalties per type
  for (const [type, values] of penaltiesByType) {
    const rule = rulesByType.get(type);
    const behaviour: PenaltyBehaviour = rule?.penaltyBehaviour ?? "additive";
    if (behaviour === "lowest-only") {
      // Most-negative (lowest value) wins
      total += Math.min(...values);
    } else {
      // additive — all stack
      total += values.reduce((a, b) => a + b, 0);
    }
  }

  return total;
}
