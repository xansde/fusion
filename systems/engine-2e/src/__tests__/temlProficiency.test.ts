/**
 * TEML Proficiency Bonus — golden fixture tests.
 *
 * Validates all 15 cases from systems/engine-2e/fixtures/teml-proficiency.json.
 *
 * verify:true case:
 *   teml-015 — Negative level NPC: Trained rank=1, level=-1 → bonus = 2 + (-1) = 1.
 *              The fixture expected value is 1 (not 0), meaning no floor at 0.
 *              The formula applies as-is: rank*2 + level.
 *              Implementation: calculateProficiencyBonus(rankValue, level) with no floor.
 *
 * Source: docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §3.1
 */
import { describe, it, expect } from "vitest";
import {
  calculateProficiencyBonus,
  PROFICIENCY_RANK_VALUE,
  type ProficiencyRank,
} from "../temlProficiency.js";
import fixtureData from "../../fixtures/teml-proficiency.json" with { type: "json" };

type FixtureCase = {
  id: string;
  description: string;
  rank: ProficiencyRank;
  rankValue: number;
  level: number;
  expected: { proficiencyBonus: number };
  verify?: boolean;
  verifyNote?: string;
};

const cases = (fixtureData as { cases: FixtureCase[] }).cases;

describe("TEML Proficiency Bonus — golden fixtures", () => {
  it.each(cases)(
    "$id: $description",
    ({ rank, rankValue, level, expected, verify, verifyNote }) => {
      // verify:true (teml-015): negative level NPC. We implement: no floor, formula as-is.
      // Resolved: expected.proficiencyBonus = 1 (rank*2 + level = 2 + (-1) = 1).
      void verify;
      void verifyNote;

      // Verify that our rankValue mapping matches fixture's rankValue
      const resolvedRankValue = PROFICIENCY_RANK_VALUE[rank];
      expect(resolvedRankValue, `rank mapping for ${rank}`).toBe(rankValue);

      const result = calculateProficiencyBonus(rankValue, level);
      expect(result).toBe(expected.proficiencyBonus);
    },
  );
});
