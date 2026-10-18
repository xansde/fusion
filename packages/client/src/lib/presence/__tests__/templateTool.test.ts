import { describe, it, expect } from "vitest";
import { SquareGrid } from "@fusion/shared";
import { areaLabel, buildAreaTemplate, isAreaMode } from "../templateTool.js";

const grid = new SquareGrid({
  type: "square",
  size: 100,
  distance: 5,
  units: "ft",
  color: "#000",
  alpha: 0.4,
  diagonalRule: "alternating_1",
});
const P = { x: 510, y: 495 };

describe("buildAreaTemplate", () => {
  it("a burst follows the cursor, snapped to an intersection", () => {
    const t = buildAreaTemplate("burst", 10, P, { x: 742, y: 331 }, grid, null);
    expect(t).toMatchObject({ kind: "burst", sizeFt: 10, origin: { x: 700, y: 300 } });
  });

  it("a cone anchors at the press and aims by the cursor in 45 degree steps", () => {
    const t = buildAreaTemplate("cone", 15, P, { x: 900, y: 560 }, grid, null);
    expect(t?.origin).toEqual({ x: 500, y: 500 });
    expect(t?.direction).toBe(0);
    const diag = buildAreaTemplate("cone", 15, P, { x: 900, y: 940 }, grid, null);
    expect(diag?.direction).toBe(45);
  });

  it("a line keeps the free direction", () => {
    const t = buildAreaTemplate("line", 30, P, { x: 900, y: 600 }, grid, null);
    expect(t?.direction).not.toBe(0);
    expect(t?.direction).toBeCloseTo((Math.atan2(100, 400) * 180) / Math.PI, 5);
  });

  it("an emanation needs a selected token and grows from its footprint", () => {
    expect(buildAreaTemplate("emanation", 10, P, P, grid, null)).toBeNull();
    const fp = { i: 5, j: 5, width: 2, height: 2 };
    const t = buildAreaTemplate("emanation", 10, P, P, grid, fp);
    expect(t?.footprint).toEqual(fp);
    expect(t?.origin).toEqual({ x: 600, y: 600 });
  });
});

describe("areaLabel", () => {
  it("shows only the title when nobody is inside", () => {
    expect(areaLabel({ kind: "cone", sizeFt: 15 }, [])).toBe("Cone 15 pés");
  });

  it("lists up to three names and counts the rest", () => {
    expect(areaLabel({ kind: "burst", sizeFt: 20 }, ["A", "B"])).toBe("Explosão 20 pés · A, B");
    expect(areaLabel({ kind: "burst", sizeFt: 20 }, ["A", "B", "C", "D", "E"])).toBe(
      "Explosão 20 pés · A, B, C +2",
    );
  });
});

describe("isAreaMode", () => {
  it("separates the ruler and the off state from the areas", () => {
    expect(isAreaMode("cone")).toBe(true);
    expect(isAreaMode("ruler")).toBe(false);
    expect(isAreaMode(null)).toBe(false);
  });
});
