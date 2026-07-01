/**
 * @fusion/system-sf2e — Derivation helper utilities.
 *
 * Mirrors `systems/pf2e/src/derivations/helpers.ts` verbatim (REQ-SF2-004):
 * ability modifier formula, TEML proficiency bonus, statistic resolution and
 * MAP penalties are IDENTICAL between PF2e and SF2e — both delegate to the
 * shared `@fusion/engine-2e` core. No SF2e-specific override exists for any
 * of these helpers.
 *
 * Pure functions used by both character and NPC derivation steps.
 * No side effects; no imports from Svelte or browser APIs.
 *
 * REQ-SF2-004, REQ-SF2-200 (mirrors REQ-PF2-200/202).
 */

import {
  resolveModifiersForSelector,
  resolveStacking,
  calculateProficiencyBonus,
  calculateMapPenalty,
} from "@fusion/engine-2e";
import type { Synthetics } from "@fusion/system-api";
import type { DerivedStatistic, ModifierBreakdown } from "./types.js";

// ---------------------------------------------------------------------------
// Ability modifier formula — identical to PF2e.
// ---------------------------------------------------------------------------

/**
 * Compute ability modifier from raw score.
 * mod = floor((score - 10) / 2).
 *
 * The engine-2e does not expose an ability-mod helper, so this stays here.
 */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

// ---------------------------------------------------------------------------
// Proficiency bonus — delegated to engine-2e (single source of truth).
// ---------------------------------------------------------------------------

/**
 * Compute TEML proficiency bonus.
 * Untrained (rank 0) = +0 (level NOT added).
 * Trained..Legendary = rank * 2 + level.
 *
 * Thin re-export of `calculateProficiencyBonus` from @fusion/engine-2e,
 * validated by the teml-proficiency golden fixtures. REQ-SF2-004.
 */
export function proficiencyBonus(rank: number, level: number): number {
  return calculateProficiencyBonus(rank, level);
}

// ---------------------------------------------------------------------------
// Resolve a statistic from base + synthetics
// ---------------------------------------------------------------------------

/**
 * Resolve a DerivedStatistic by combining a base value with modifiers from
 * the Synthetics accumulator for the given selector.
 */
export function resolveStatistic(
  slug: string,
  base: number,
  selector: string,
  synthetics: Synthetics,
  rollOptions: ReadonlySet<string>,
): DerivedStatistic {
  const resolved = resolveModifiersForSelector(selector, synthetics, rollOptions);

  const modifiers: ModifierBreakdown[] = resolved.map((m) => ({
    slug: m.slug,
    label: m.label,
    type: m.type,
    value: m.value,
  }));

  const modSum = resolveStacking(resolved);
  const total = base + modSum;

  return {
    slug,
    base,
    modifiers,
    total,
    dc: 10 + total,
  };
}

// ---------------------------------------------------------------------------
// Multi-selector statistic (e.g. saving-throw matches both "fortitude" and
// the generic "saving-throw" selector)
// ---------------------------------------------------------------------------

/**
 * Resolve a statistic by combining modifiers from multiple selectors.
 *
 * SF2e conditions often apply to broad selectors like "saving-throw" (all
 * three saves) or "skill-check" (all skills), same as PF2e. This helper
 * merges all matching selectors' modifiers before applying stacking.
 */
export function resolveStatisticMulti(
  slug: string,
  base: number,
  selectors: string[],
  synthetics: Synthetics,
  rollOptions: ReadonlySet<string>,
): DerivedStatistic {
  const seen = new Set<string>();
  const allResolved: {
    slug: string;
    label: string;
    type: string;
    value: number;
    selector: string;
    source: string;
  }[] = [];

  for (const sel of selectors) {
    const resolved = resolveModifiersForSelector(sel, synthetics, rollOptions);
    for (const m of resolved) {
      if (!seen.has(m.slug)) {
        seen.add(m.slug);
        allResolved.push(m);
      }
    }
  }

  const modifiers: ModifierBreakdown[] = allResolved.map((m) => ({
    slug: m.slug,
    label: m.label,
    type: m.type,
    value: m.value,
  }));

  const modSum = resolveStacking(allResolved);
  const total = base + modSum;

  return {
    slug,
    base,
    modifiers,
    total,
    dc: 10 + total,
  };
}

// ---------------------------------------------------------------------------
// Striking rune extra dice count — used by Analog weapons only (REQ-SF2-021).
// ---------------------------------------------------------------------------

/**
 * Number of extra weapon dice from the Striking rune (Analog weapons only —
 * Tech weapons use `grade` instead, see actions/strikes.ts).
 *
 * striking 0 → 1d (base weapon die, no extra)
 * striking 1 → 2d (adds 1 die)
 * striking 2 → 3d (adds 2 dice)
 * striking 3 → 4d (adds 3 dice)
 */
export function strikingDiceCount(strikingLevel: number): number {
  return Math.max(1, 1 + strikingLevel);
}

// ---------------------------------------------------------------------------
// MAP (Multiple Attack Penalty) values — identical to PF2e (REQ-SF2-004).
// ---------------------------------------------------------------------------

/**
 * Return the three MAP penalty values for a weapon.
 *
 * agile trait → 0 / −4 / −8.
 * normal      → 0 / −5 / −10.
 *
 * Delegates to `calculateMapPenalty` from @fusion/engine-2e (single source of
 * truth, validated by the map golden fixtures) for each of the three attacks.
 */
export function mapPenalties(isAgile: boolean): [0, number, number] {
  return [
    calculateMapPenalty(1, isAgile) as 0,
    calculateMapPenalty(2, isAgile),
    calculateMapPenalty(3, isAgile),
  ];
}
