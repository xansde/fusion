/**
 * @fusion/system-pf2e — Balance invariants of the "class levels" variant.
 *
 * This file is the enforcement of REQ-MCL-200: the sweep over ALL 204
 * `(class level, character level)` pairs, never a sample.
 *
 * Why exhaustive matters here, concretely: in the originating project the
 * first version of the summon cap passed human review and still violated the
 * floor in 50 of the 204 pairs — with a dip handing out 0% of the free
 * dedication route at level 20. A spot check of "level 1, level 10, level 20"
 * would have shown green. An invariant holds on every pair or it is not an
 * invariant.
 *
 * Axes covered:
 *   - summoning rank (REQ-MCL-062) — floor AND ceiling, all 204 pairs;
 *   - granted actor level (REQ-MCL-063) — ceiling and RAW collapse;
 *   - effective spell rank (REQ-MCL-061) — reproduces the published curve.
 *
 * REQ-MCL-201: any NEW capped axis must add its own sweep here, reusing
 * `invariantPairs()` so it cannot silently degrade into sampling.
 *
 * Clean-room: house rule by Igor (Wayfinder project), used with the author's
 * permission and with attribution. PF2e cadences are ORC/OGL facts.
 *
 * Spec: 30-multiclasse-por-niveis.md §7.1 (REQ-MCL-200..203), CA-MCL-03/04.
 */

import { describe, it, expect } from "vitest";
import {
  dedicationSpellRank,
  effectiveSpellRank,
  grantedActorLevel,
  invariantPairs,
  summonSpellRank,
} from "../variants/classLevels/formulas.js";
import { MAX_CHARACTER_LEVEL } from "../variants/classLevels/params.js";

const PAIRS = invariantPairs();

describe("invariant sweep — enumeration", () => {
  it("covers exactly the 204 pairs the spec names", () => {
    // Σ(level) for level 4..20 = 210 − 6 = 204. If this count ever changes,
    // either MAX_CHARACTER_LEVEL moved (a deliberate act) or the enumeration
    // regressed (not) — either way the sweep below is measuring a different
    // population than the spec describes, and that must be noticed.
    expect(PAIRS).toHaveLength(204);
  });

  it("enumerates only legal pairs (1 ≤ classLevel ≤ characterLevel ≤ max)", () => {
    for (const { classLevel, characterLevel } of PAIRS) {
      expect(classLevel).toBeGreaterThanOrEqual(1);
      expect(classLevel).toBeLessThanOrEqual(characterLevel);
      expect(characterLevel).toBeLessThanOrEqual(MAX_CHARACTER_LEVEL);
    }
  });

  it("includes every single-class pair (the RAW diagonal)", () => {
    for (let level = 4; level <= MAX_CHARACTER_LEVEL; level++) {
      expect(PAIRS).toContainEqual({ classLevel: level, characterLevel: level });
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-MCL-200 — the balance floor, on the summoning axis
// ---------------------------------------------------------------------------

describe("REQ-MCL-200 — a class level never pays less than the free dedication route", () => {
  it("holds on all 204 pairs (summoning rank ≥ dedication rank)", () => {
    const violations: Array<{
      classLevel: number;
      characterLevel: number;
      got: number;
      floor: number;
    }> = [];

    for (const { classLevel, characterLevel } of PAIRS) {
      const got = summonSpellRank(classLevel, characterLevel);
      const floor = dedicationSpellRank(characterLevel);
      if (got < floor) violations.push({ classLevel, characterLevel, got, floor });
    }

    // Report the offending pairs, not just a boolean — when this fails the
    // shape of the violation (which corner of the grid) is the diagnosis.
    expect(violations).toEqual([]);
  });

  it("holds hardest at the corner that broke in the origin project (dip at level 20)", () => {
    // Fighter 19 / Cleric 1 at character level 20: the 1-level dip must still
    // summon at least at the free archetype route's rank 8.
    expect(summonSpellRank(1, 20)).toBeGreaterThanOrEqual(dedicationSpellRank(20));
    expect(dedicationSpellRank(20)).toBe(8);
  });

  it("never exceeds the character's own effective rank (the ceiling clause)", () => {
    for (const { classLevel, characterLevel } of PAIRS) {
      expect(summonSpellRank(classLevel, characterLevel)).toBeLessThanOrEqual(
        effectiveSpellRank(characterLevel),
      );
    }
  });

  it("is monotonic in class level — more investment never pays less", () => {
    for (let characterLevel = 4; characterLevel <= MAX_CHARACTER_LEVEL; characterLevel++) {
      for (let classLevel = 2; classLevel <= characterLevel; classLevel++) {
        expect(summonSpellRank(classLevel, characterLevel)).toBeGreaterThanOrEqual(
          summonSpellRank(classLevel - 1, characterLevel),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-MCL-202 — single class must reproduce RAW exactly
// ---------------------------------------------------------------------------

describe("REQ-MCL-202 — single class is bit-for-bit RAW", () => {
  it("Summoner 20 pure → summons at rank 10", () => {
    expect(summonSpellRank(20, 20)).toBe(10);
  });

  it("Ranger 12 pure → companion at level 12", () => {
    expect(grantedActorLevel(12, 12)).toBe(12);
  });

  it("Wizard 5 pure → zero elevation (effective rank equals the native curve)", () => {
    expect(effectiveSpellRank(5)).toBe(3);
    expect(summonSpellRank(5, 5)).toBe(3);
  });

  it("granted actor collapses to the master's level for every single-class level", () => {
    for (let level = 1; level <= MAX_CHARACTER_LEVEL; level++) {
      expect(grantedActorLevel(level, level)).toBe(level);
    }
  });

  it("effective rank reproduces the published max-rank-by-level curve", () => {
    // Full caster: rank 1 at levels 1–2, rank 2 at 3–4, … rank 10 at 19–20.
    const expected = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10];
    for (let level = 1; level <= MAX_CHARACTER_LEVEL; level++) {
      expect(effectiveSpellRank(level)).toBe(expected[level - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-MCL-063 — granted actors (companion, familiar, eidolon)
// ---------------------------------------------------------------------------

describe("REQ-MCL-063 — granted actor level", () => {
  it("never exceeds the character level, on all 204 pairs", () => {
    for (const { classLevel, characterLevel } of PAIRS) {
      expect(grantedActorLevel(classLevel, characterLevel)).toBeLessThanOrEqual(characterLevel);
    }
  });

  it("never falls below the class level that granted it", () => {
    for (const { classLevel, characterLevel } of PAIRS) {
      expect(grantedActorLevel(classLevel, characterLevel)).toBeGreaterThanOrEqual(
        Math.min(classLevel, characterLevel),
      );
    }
  });

  it("gives a dip a +2 head start until the character level caps it", () => {
    // Ranger 1 / Fighter 9 at character level 10 → companion level 3.
    expect(grantedActorLevel(1, 10)).toBe(3);
    // Ranger 9 / Fighter 1 at level 10 → capped at 10, not 11.
    expect(grantedActorLevel(9, 10)).toBe(10);
  });

  it("is monotonic in class level", () => {
    for (let characterLevel = 4; characterLevel <= MAX_CHARACTER_LEVEL; characterLevel++) {
      for (let classLevel = 2; classLevel <= characterLevel; classLevel++) {
        expect(grantedActorLevel(classLevel, characterLevel)).toBeGreaterThanOrEqual(
          grantedActorLevel(classLevel - 1, characterLevel),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The dedication staircase itself (the floor's own shape)
// ---------------------------------------------------------------------------

describe("dedication spell rank — the floor's staircase", () => {
  it("grants nothing below character level 4", () => {
    for (let level = 1; level <= 3; level++) {
      expect(dedicationSpellRank(level)).toBe(0);
    }
  });

  it("matches the published archetype cadence at each threshold", () => {
    const thresholds: Array<[number, number]> = [
      [4, 1],
      [6, 2],
      [8, 3],
      [12, 4],
      [14, 5],
      [16, 6],
      [18, 7],
      [20, 8],
    ];
    for (const [level, rank] of thresholds) {
      expect(dedicationSpellRank(level)).toBe(rank);
    }
  });

  it("holds its value between thresholds instead of interpolating", () => {
    expect(dedicationSpellRank(5)).toBe(1);
    expect(dedicationSpellRank(7)).toBe(2);
    expect(dedicationSpellRank(9)).toBe(3);
    expect(dedicationSpellRank(10)).toBe(3);
    expect(dedicationSpellRank(11)).toBe(3);
    expect(dedicationSpellRank(13)).toBe(4);
  });

  it("never exceeds the character's effective rank — else the floor would be unreachable", () => {
    // If the floor ever rose above the ceiling, summonSpellRank's min() would
    // silently clamp BELOW the floor and REQ-MCL-200 would become
    // unsatisfiable by construction rather than by a bad parameter.
    for (let level = 1; level <= MAX_CHARACTER_LEVEL; level++) {
      expect(dedicationSpellRank(level)).toBeLessThanOrEqual(effectiveSpellRank(level));
    }
  });
});
