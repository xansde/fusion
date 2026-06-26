/**
 * Degrees of Success — golden fixture tests.
 *
 * Validates all 20 cases from systems/engine-2e/fixtures/degrees-of-success.json.
 * All cases pass (no verify:true cases in this fixture).
 *
 * Source: docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §2 — Graus de Sucesso.
 */
import { describe, it, expect } from "vitest";
import { calculateDegreeOfSuccess } from "../degreesOfSuccess.js";
import fixtureData from "../../fixtures/degrees-of-success.json" with { type: "json" };

const { cases } = fixtureData;

describe("Degrees of Success — golden fixtures", () => {
  it.each(cases)("$id: $description", ({ check, dc, dieNatural, expected }) => {
    const result = calculateDegreeOfSuccess(check, dc, dieNatural);
    expect(result).toBe(expected);
  });
});
