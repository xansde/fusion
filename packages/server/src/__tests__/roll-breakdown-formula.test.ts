/**
 * `formulaFlatPart` — the number the card's decomposition must add up to (ui-fundacao, 22/10/2026).
 * A formula this reading does not understand gives `null`: no decomposition beats a wrong one.
 */
import { describe, expect, it } from "vitest";
import { formulaFlatPart } from "../chat/roll-resolution.js";

describe("formulaFlatPart", () => {
  it("sums the number terms and leaves the dice out", () => {
    expect(formulaFlatPart("1d20+12 # Ofício")).toBe(12);
    expect(formulaFlatPart("1d20-1")).toBe(-1);
    expect(formulaFlatPart("1d8 + 4 - 1")).toBe(3);
    expect(formulaFlatPart("2d6")).toBe(0);
    expect(formulaFlatPart("1d20+0")).toBe(0);
  });

  it("refuses what it does not read", () => {
    expect(formulaFlatPart("(1d6+4)*2")).toBeNull();
    expect(formulaFlatPart("4d6kh3")).toBeNull();
    expect(formulaFlatPart("")).toBeNull();
  });
});
