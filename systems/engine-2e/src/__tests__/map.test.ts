/**
 * Multiple Attack Penalty (MAP) — golden fixture tests.
 *
 * Validates all 12 cases from systems/engine-2e/fixtures/map.json.
 *
 * verify:true case:
 *   map-011 (verify:true) — Mixed-weapon turn: MAP step is based on total attacks made,
 *              regardless of which weapon was used. Agile penalty applies to the current
 *              attack's weapon. Implementation: `attackNumber` is the total attack count
 *              this turn; `weaponAgile` is the current weapon. Confirmed per PF2e RAW.
 *
 * Notes on special fixture fields:
 *   map-009: also asserts appliesTo="attackRoll" and appliesToDamage=false.
 *            These are semantic metadata, not computed by calculateMapPenalty.
 *            The penalty value is the only output we validate.
 *   map-010: turnsElapsed=1 indicates a new turn; attackNumber=1 resets MAP.
 *   map-012: priorActionsThisTurn includes non-Attack-trait actions (Stride).
 *            attackNumber=2 means one prior Strike (Attack-trait), so MAP step 2.
 *
 * Source: docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §1.4
 */
import { describe, it, expect } from "vitest";
import { calculateMapPenalty } from "../map.js";
import fixtureData from "../../fixtures/map.json" with { type: "json" };

const { cases } = fixtureData;

describe("Multiple Attack Penalty — golden fixtures", () => {
  it.each(cases)("$id: $description", ({ weaponAgile, attackNumber, expected }) => {
    const result = calculateMapPenalty(attackNumber, weaponAgile);
    expect(result).toBe(expected.mapPenalty);
  });
});
