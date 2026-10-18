import { describe, it, expect } from "vitest";
import { SquareGrid } from "@fusion/shared";
import {
  actorSpeedFt,
  buildDragRuler,
  moveTier,
  DEFAULT_SPEED_FT,
  TIER_COLORS,
} from "../dragRuler.js";

const grid = new SquareGrid({
  type: "square",
  size: 100,
  distance: 5,
  units: "ft",
  color: "#000",
  alpha: 0.4,
  diagonalRule: "alternating_1",
});

describe("actorSpeedFt", () => {
  it("prefers the derived speed", () => {
    expect(actorSpeedFt({ derived: { speed: { value: 30 } }, speed: { value: 25 } })).toBe(30);
  });

  it("falls back to the authored speed, then to an NPC attribute", () => {
    expect(actorSpeedFt({ speed: { value: 20 } })).toBe(20);
    expect(actorSpeedFt({ attributes: { speed: { value: "35" } } })).toBe(35);
  });

  it("uses 25 when the actor declares nothing usable", () => {
    expect(actorSpeedFt(undefined)).toBe(DEFAULT_SPEED_FT);
    expect(actorSpeedFt({ derived: { speed: { value: 0 } } })).toBe(DEFAULT_SPEED_FT);
    expect(actorSpeedFt({ derived: {} })).toBe(DEFAULT_SPEED_FT);
  });
});

describe("moveTier", () => {
  it("is green up to one Stride, yellow up to two, red beyond", () => {
    expect(moveTier(25, 25)).toBe("walk");
    expect(moveTier(30, 25)).toBe("double");
    expect(moveTier(50, 25)).toBe("double");
    expect(moveTier(55, 25)).toBe("far");
  });
});

describe("buildDragRuler", () => {
  const c = (i: number, j: number) => ({ x: i * 100 + 50, y: j * 100 + 50 });

  it("measures with 5-10 and colours by the actor speed", () => {
    // 3 squares diagonal = 20 ft: inside a 25 ft Stride.
    const near = buildDragRuler(grid, [c(0, 0), c(3, 3)], 25);
    expect(near.distanceFt).toBe(20);
    expect(near.tier).toBe("walk");
    expect(near.color).toBe(TIER_COLORS.walk);

    // 6 squares straight = 30 ft: needs two actions.
    const mid = buildDragRuler(grid, [c(0, 0), c(6, 0)], 25);
    expect(mid.distanceFt).toBe(30);
    expect(mid.tier).toBe("double");

    // 11 squares straight = 55 ft: beyond two Strides.
    const far = buildDragRuler(grid, [c(0, 0), c(11, 0)], 25);
    expect(far.tier).toBe("far");
    expect(far.color).toBe(TIER_COLORS.far);
  });

  it("accumulates the diagonal count across waypoints", () => {
    const view = buildDragRuler(grid, [c(0, 0), c(1, 1), c(2, 2)], 25);
    expect(view.distanceFt).toBe(15); // 5 + 10
  });

  it("reads zero before the token has moved", () => {
    expect(buildDragRuler(grid, [c(0, 0)], 25).distanceFt).toBe(0);
  });
});
