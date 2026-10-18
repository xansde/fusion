/**
 * Keyboard nudge, keep-square and the numeric <-> box round trip of the grid
 * calibration tool.
 */
import { describe, it, expect } from "vitest";
import {
  gridLinePositions,
  nudgeRect,
  nudgeStep,
  rectFromGrid,
  squareUpRect,
} from "../gridCalibrationRect.js";

describe("nudge", () => {
  it("moves the box by the given pixels without resizing it", () => {
    expect(nudgeRect({ x: 10, y: 20, width: 100, height: 90 }, 1, -1)).toEqual({
      x: 11,
      y: 19,
      width: 100,
      height: 90,
    });
  });

  it("steps 1 px, or 10 px with Shift", () => {
    expect(nudgeStep(false)).toBe(1);
    expect(nudgeStep(true)).toBe(10);
  });
});

describe("squareUpRect", () => {
  it("grows the short side to the long one, keeping the top-left corner", () => {
    expect(squareUpRect({ x: 5, y: 6, width: 100, height: 130 })).toEqual({
      x: 5,
      y: 6,
      width: 130,
      height: 130,
    });
    expect(squareUpRect({ x: 5, y: 6, width: 140, height: 90 })).toEqual({
      x: 5,
      y: 6,
      width: 140,
      height: 140,
    });
  });

  it("normalizes a backwards drag first", () => {
    expect(squareUpRect({ x: 200, y: 200, width: -100, height: -120 })).toEqual({
      x: 100,
      y: 80,
      width: 120,
      height: 120,
    });
  });
});

describe("gridLinePositions", () => {
  it("lists the lines from the first one at/after zero up to the extent", () => {
    expect(gridLinePositions(100, 30, 350)).toEqual([30, 130, 230, 330]);
  });

  it("wraps a negative or oversized offset into one cell", () => {
    expect(gridLinePositions(100, -70, 250)).toEqual([30, 130, 230]);
    expect(gridLinePositions(100, 230, 250)).toEqual([30, 130, 230]);
  });

  it("returns nothing for a degenerate grid", () => {
    expect(gridLinePositions(0, 0, 500)).toEqual([]);
    expect(gridLinePositions(100, 0, 0)).toEqual([]);
  });
});

describe("rectFromGrid", () => {
  const origin = { x: 1000, y: 800 };

  it("places the box on the cell of the typed grid nearest to the current box", () => {
    const near = { x: 1330, y: 1010, width: 100, height: 100 };
    const r = rectFromGrid(120, { x: 20, y: 40 }, origin, near);
    expect((r.x - origin.x - 20) % 120).toBe(0);
    expect((r.y - origin.y - 40) % 120).toBe(0);
    expect(Math.abs(r.x - near.x)).toBeLessThanOrEqual(60);
    expect(Math.abs(r.y - near.y)).toBeLessThanOrEqual(60);
    expect(r.width).toBe(120);
    expect(r.height).toBe(120);
  });

  it("spans several cells when asked", () => {
    const r = rectFromGrid(100, { x: 0, y: 0 }, origin, { x: 1000, y: 800, width: 1, height: 1 }, 3, 2);
    expect(r.width).toBe(300);
    expect(r.height).toBe(200);
  });
});
