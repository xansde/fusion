import { describe, it, expect } from "vitest";
import { labelCounterScale } from "../RulerLayer.js";

describe("labelCounterScale", () => {
  it("cancels the camera zoom so the label keeps its on-screen size", () => {
    for (const zoom of [0.25, 0.5, 1, 2, 3]) {
      expect(zoom * labelCounterScale(zoom)).toBeCloseTo(1, 10);
    }
  });

  it("falls back to 1 for a degenerate scale", () => {
    expect(labelCounterScale(0)).toBe(1);
    expect(labelCounterScale(-2)).toBe(1);
    expect(labelCounterScale(Number.NaN)).toBe(1);
  });
});
