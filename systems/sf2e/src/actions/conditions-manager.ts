/**
 * @fusion/system-sf2e — Condition manager.
 *
 * Mirrors `systems/pf2e/src/actions/conditions-manager.ts` verbatim
 * (REQ-SF2-006: condition apply/remove/toggle/increase/decrease/set rules
 * are IDENTICAL between PF2e and SF2e). The only SF2e-specific piece is the
 * lookup source: `getSf2eConditionBySlug` only resolves the SF2e-exclusive
 * conditions (untethered/glitching/suppressed) defined in `../conditions.js`
 * — callers composing the full system registration are expected to fall
 * back to PF2e's `getConditionBySlug` for the inherited base set (blinded,
 * frightened, off-guard, dying, etc.), same as `index.ts`'s module
 * docstring documents for `registrar.condition()`.
 *
 * Pure functions for managing SF2e conditions on an actor's embedded items
 * list. Conditions are stored as embedded items of subtype "condition" with
 * a `slug` and optional `value` (for valued conditions like glitching).
 *
 * Rules implemented here:
 *   - Valued conditions: stacking by highest value only.
 *   - Immunity check: condition blocked if actor has matching immunity in IWR.
 *   - toggleCondition: apply if not present; remove if already present.
 *   - increaseCondition / decreaseCondition: increment/decrement value by 1
 *     (clamp to 0 = removal).
 *   - setCondition: force a specific value.
 *
 * This module is PURE (no I/O). The server applies the resulting mutations
 * to the actor document via the CRUD layer.
 *
 * Clean-room: REQ-SF2-006, REQ-SF2-022; ORC/OGL mechanics.
 */

import { getSf2eConditionBySlug } from "../conditions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A minimal condition item as stored on an actor.
 * Matches the ConditionSystemSchema shape (but we only need a subset here).
 */
export interface ConditionItem {
  _id: string;
  name: string;
  type: "Item";
  system: {
    slug: string;
    /** Numeric value for valued conditions. Absent or null for non-valued. */
    value?: number | null;
  };
}

/**
 * An actor's IWR block (immunities only — we check for condition immunity).
 * Matches the IwrBlockSchema shape.
 */
export interface ActorIwrBlock {
  immunities: Array<{ type: string; value?: number }>;
  weaknesses: Array<{ type: string; value?: number }>;
  resistances: Array<{ type: string; value?: number }>;
}

/**
 * Result of a condition mutation — a new conditions array plus a change log.
 */
export interface ConditionMutationResult {
  /** The updated conditions list (immutable result; caller replaces the actor's list). */
  conditions: ConditionItem[];
  /** What happened (for logging / chat). */
  log: Array<{
    action: "added" | "removed" | "updated" | "blocked";
    slug: string;
    value?: number;
    reason?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Generate a deterministic fake id for new condition items (caller replaces with UUID). */
function tempId(slug: string): string {
  return `condition:${slug}:${Date.now().toString(36)}`;
}

/**
 * Look up a condition definition by slug, preferring the SF2e-exclusive set
 * and falling back to a generic label when the slug belongs to the inherited
 * PF2e base set (whose definitions live in `systems/pf2e`, not duplicated
 * here — REQ-SF2-006).
 */
function lookupConditionLabel(slug: string): string {
  return getSf2eConditionBySlug(slug)?.label ?? slug;
}

/**
 * Check whether the actor's IWR grants immunity to a condition slug.
 */
export function isImmuneToCondition(slug: string, iwr: ActorIwrBlock): boolean {
  return iwr.immunities.some((entry) => entry.type === slug || entry.type === "condition");
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Apply a condition to the actor's conditions list.
 *
 * Rules:
 *   - If immune (via IWR), condition is blocked.
 *   - If valued: takes the highest value (e.g. `glitching`).
 *   - If non-valued: no-op if already present; add if absent.
 *   - ToggleCondition effects from the conditions themselves are NOT processed
 *     here — they're handled by the effects engine during prepareData.
 *
 * @param conditions - Current embedded conditions on the actor.
 * @param slug       - Condition slug to apply.
 * @param value      - Value for valued conditions (required if condition is valued).
 * @param iwr        - Actor's IWR (for immunity check). Pass null to skip immunity check.
 */
export function applyCondition(
  conditions: readonly ConditionItem[],
  slug: string,
  value: number | null,
  iwr: ActorIwrBlock | null,
): ConditionMutationResult {
  const condDef = getSf2eConditionBySlug(slug);
  const newConditions = [...conditions];
  const log: ConditionMutationResult["log"] = [];

  // Immunity check
  if (iwr && isImmuneToCondition(slug, iwr)) {
    log.push({ action: "blocked", slug, reason: "immunity" });
    return { conditions: newConditions, log };
  }

  const isValued = condDef?.valued === true;
  const existing = newConditions.find((c) => c.system.slug === slug);

  if (!existing) {
    // Add new condition
    const newItem: ConditionItem = {
      _id: tempId(slug),
      name: lookupConditionLabel(slug),
      type: "Item",
      system: {
        slug,
        ...(isValued && value !== null ? { value } : {}),
      },
    };
    newConditions.push(newItem);
    if (value !== null) {
      log.push({ action: "added", slug, value });
    } else {
      log.push({ action: "added", slug });
    }
  } else if (isValued && value !== null) {
    // Valued condition: take the highest value
    const existingValue = existing.system.value ?? 0;
    if (value > existingValue) {
      const idx = newConditions.indexOf(existing);
      newConditions[idx] = {
        ...existing,
        system: { ...existing.system, value },
      };
      log.push({ action: "updated", slug, value });
    } else {
      // Existing is already equal or higher — no change
      log.push({ action: "blocked", slug, reason: "existing value is higher or equal" });
    }
  } else {
    // Non-valued, already present — no-op
    log.push({ action: "blocked", slug, reason: "already present" });
  }

  return { conditions: newConditions, log };
}

/**
 * Remove a condition from the actor's conditions list.
 *
 * @param conditions - Current embedded conditions on the actor.
 * @param slug       - Condition slug to remove.
 */
export function removeCondition(
  conditions: readonly ConditionItem[],
  slug: string,
): ConditionMutationResult {
  const newConditions = conditions.filter((c) => c.system.slug !== slug);
  const removed = conditions.length !== newConditions.length;
  const log: ConditionMutationResult["log"] = removed
    ? [{ action: "removed", slug }]
    : [{ action: "blocked", slug, reason: "not present" }];
  return { conditions: newConditions, log };
}

/**
 * Toggle a condition: apply if not present, remove if already present.
 *
 * For valued conditions, `value` is required when applying.
 */
export function toggleCondition(
  conditions: readonly ConditionItem[],
  slug: string,
  value: number | null = null,
  iwr: ActorIwrBlock | null = null,
): ConditionMutationResult {
  const existing = conditions.find((c) => c.system.slug === slug);
  if (existing) {
    return removeCondition(conditions, slug);
  }
  return applyCondition(conditions, slug, value, iwr);
}

/**
 * Increase a valued condition by 1 (or set to 1 if not present).
 *
 * Primary use case: `glitching` badge tracking (REQ-SF2 delta condition).
 */
export function increaseCondition(
  conditions: readonly ConditionItem[],
  slug: string,
  iwr: ActorIwrBlock | null = null,
): ConditionMutationResult {
  const existing = conditions.find((c) => c.system.slug === slug);
  const newValue = (existing?.system.value ?? 0) + 1;
  return applyCondition(conditions, slug, newValue, iwr);
}

/**
 * Decrease a valued condition by 1; remove it when value reaches 0.
 */
export function decreaseCondition(
  conditions: readonly ConditionItem[],
  slug: string,
): ConditionMutationResult {
  const existing = conditions.find((c) => c.system.slug === slug);
  if (!existing) {
    return {
      conditions: [...conditions],
      log: [{ action: "blocked", slug, reason: "not present" }],
    };
  }
  const currentValue = existing.system.value;
  if (currentValue === undefined || currentValue === null) {
    // Non-valued: just remove
    return removeCondition(conditions, slug);
  }
  const newValue = currentValue - 1;
  if (newValue <= 0) {
    return removeCondition(conditions, slug);
  }
  // Update value
  const newConditions = conditions.map((c) =>
    c.system.slug === slug ? { ...c, system: { ...c.system, value: newValue } } : c,
  );
  return {
    conditions: newConditions,
    log: [{ action: "updated", slug, value: newValue }],
  };
}

/**
 * Set a valued condition to a specific value.
 * If value <= 0, the condition is removed.
 */
export function setCondition(
  conditions: readonly ConditionItem[],
  slug: string,
  value: number,
  iwr: ActorIwrBlock | null = null,
): ConditionMutationResult {
  if (value <= 0) {
    return removeCondition(conditions, slug);
  }
  const newConditions = [...conditions];
  const existingIdx = newConditions.findIndex((c) => c.system.slug === slug);

  if (iwr && isImmuneToCondition(slug, iwr)) {
    return {
      conditions: newConditions,
      log: [{ action: "blocked", slug, reason: "immunity" }],
    };
  }

  if (existingIdx >= 0) {
    const existing = newConditions[existingIdx];
    if (existing !== undefined) {
      newConditions[existingIdx] = {
        ...existing,
        system: { ...existing.system, value },
      };
    }
  } else {
    newConditions.push({
      _id: tempId(slug),
      name: lookupConditionLabel(slug),
      type: "Item",
      system: { slug, value },
    });
  }

  return {
    conditions: newConditions,
    log: [{ action: "updated", slug, value }],
  };
}

// ---------------------------------------------------------------------------
// Collect active condition modifiers for use in prepareData
// ---------------------------------------------------------------------------

/**
 * Expand valued condition effects, multiplying placeholder `-1` values by
 * the actual condition value.
 *
 * The ConditionDefinition stores placeholder value `-1` for valued conditions
 * (e.g., `glitching -1` as template). This function returns the actual
 * modifier value for use in the effects engine.
 */
export function resolveConditionModifierValue(
  conditionValue: number,
  templateValue: number,
): number {
  // If template is -1 (placeholder), multiply: e.g., condition value 2 → modifier = -2
  if (templateValue === -1) {
    return -conditionValue;
  }
  return templateValue;
}
