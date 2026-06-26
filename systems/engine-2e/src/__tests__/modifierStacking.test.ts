/**
 * Modifier Stacking — golden fixture tests.
 *
 * Validates all 15 cases from systems/engine-2e/fixtures/modifier-stacking.json.
 *
 * verify:true cases handled:
 *   ms-009 (verify:false in fixture) — untyped bonuses: highest wins. Confirmed.
 *   ms-010 (verify:true) — untyped penalties stack. PF2e RAW: MAP + range are additive.
 *              Implementation: untyped penaltyBehaviour="additive" in PF2E_STACKING_TABLE.
 *   ms-011 (verify:true) — same-type bonus+penalty: resolved independently, then summed.
 *              Implementation: bonus path and penalty path are separate loops in resolveStacking.
 *
 * Source: docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §3.2
 */
import { describe, it, expect } from "vitest";
import { resolveStacking } from "../modifierStacking.js";
import fixtureData from "../../fixtures/modifier-stacking.json" with { type: "json" };

const { cases } = fixtureData;

describe("Modifier Stacking — golden fixtures", () => {
  it.each(cases)("$id: $description", ({ id, modifiers, expected, verify, verifyNote }) => {
    // verify:true cases: we implement based on resolved interpretation (see file header).
    // Log the note for documentation but do not skip — we have implemented these.
    if (verify && verifyNote) {
      // Note: verify:true means the source was ambiguous; we resolved it per PF2e RAW.
      // See module doc in modifierStacking.ts for the rationale.
      void id; // prevent unused var warning
    }

    const result = resolveStacking(modifiers);
    expect(result).toBe(expected.total);
  });
});
