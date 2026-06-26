/**
 * @fusion/system-pf2e — Derivation helper utilities.
 *
 * Pure functions used by both character and NPC derivation steps.
 * No side effects; no imports from Svelte or browser APIs.
 *
 * REQ-PF2-200: deterministic, pure.
 * REQ-PF2-202: no browser/Svelte dependency.
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
// Ability modifier formula (REQ-PF2-010)
// ---------------------------------------------------------------------------

/**
 * Compute ability modifier from raw score.
 * PF2e Remaster: mod = floor((score - 10) / 2).
 *
 * The engine-2e does not expose an ability-mod helper, so this stays here.
 *
 * REQ-PF2-010.
 */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

// ---------------------------------------------------------------------------
// Proficiency bonus (REQ-PF2-011) — delegated to engine-2e
// ---------------------------------------------------------------------------

/**
 * Compute TEML proficiency bonus.
 * Untrained (rank 0) = +0 (level NOT added).
 * Trained..Legendary = rank * 2 + level.
 *
 * Thin re-export of `calculateProficiencyBonus` from @fusion/engine-2e (the
 * single source of truth, validated by the teml-proficiency golden fixtures).
 * Kept as a named alias so existing derivation steps and tests can keep using
 * `proficiencyBonus(rank, level)`.
 *
 * REQ-PF2-011.
 */
export function proficiencyBonus(rank: number, level: number): number {
  return calculateProficiencyBonus(rank, level);
}

// ---------------------------------------------------------------------------
// Resolve a statistic from base + synthetics (REQ-SYS-083)
// ---------------------------------------------------------------------------

/**
 * Resolve a DerivedStatistic by combining a base value with modifiers from
 * the Synthetics accumulator for the given selector.
 *
 * Uses the PF2e stacking table via `aggregateModifiers`.
 *
 * @param slug       - Canonical identifier for this statistic.
 * @param base       - Pre-computed base value (abilityMod + proficiency).
 * @param selector   - The synthetics selector key (e.g. "ac", "reflex").
 * @param synthetics - Populated Synthetics from the effects engine.
 * @param rollOptions - Current roll options set.
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
 * PF2e conditions often apply to broad selectors like "saving-throw" (all
 * three saves) or "skill-check" (all skills). This helper merges all
 * matching selectors' modifiers before applying stacking.
 *
 * Stacking is applied across the merged set (a frightened-penalty on
 * "saving-throw" only contributes once even if two selectors hit it,
 * because the slug deduplication in aggregateModifiers handles it).
 *
 * @param slug         - Canonical identifier for this statistic.
 * @param base         - Pre-computed base value.
 * @param selectors    - All selector keys to merge (specific first, broad last).
 * @param synthetics   - Populated Synthetics.
 * @param rollOptions  - Current roll options.
 */
export function resolveStatisticMulti(
  slug: string,
  base: number,
  selectors: string[],
  synthetics: Synthetics,
  rollOptions: ReadonlySet<string>,
): DerivedStatistic {
  // Collect modifiers from all selectors, then deduplicate by slug.
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
      // Deduplicate by slug: a condition that applies to both "saving-throw"
      // and "fortitude" must not count twice.
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
// Striking rune extra dice count (REQ-PF2-033, REQ-PF2-130)
// ---------------------------------------------------------------------------

/**
 * Number of extra weapon dice from the Striking rune.
 *
 * striking 0 → 1d (base weapon die, no extra)
 * striking 1 → 2d (adds 1 die)
 * striking 2 → 3d (adds 2 dice)
 * striking 3 → 4d (adds 3 dice)
 *
 * REQ-PF2-130.
 */
export function strikingDiceCount(strikingLevel: number): number {
  return Math.max(1, 1 + strikingLevel);
}

// ---------------------------------------------------------------------------
// MAP (Multiple Attack Penalty) values (REQ-PF2-031)
// ---------------------------------------------------------------------------

/**
 * Return the three MAP penalty values for a weapon.
 *
 * agile trait → 0 / −4 / −8.
 * normal      → 0 / −5 / −10.
 *
 * Delegates to `calculateMapPenalty` from @fusion/engine-2e (single source of
 * truth, validated by the map golden fixtures) for each of the three attacks.
 *
 * REQ-PF2-031.
 */
export function mapPenalties(isAgile: boolean): [0, number, number] {
  return [
    calculateMapPenalty(1, isAgile) as 0,
    calculateMapPenalty(2, isAgile),
    calculateMapPenalty(3, isAgile),
  ];
}
