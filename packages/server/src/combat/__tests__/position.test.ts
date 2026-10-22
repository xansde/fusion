/**
 * BHR-F5-01 (cut of GUE-F3-01) — server-side position queries.
 *
 * Assertions follow the PF2e remaster rules, written here:
 * - space by size: tiny, small and medium take 1 square per side (a tiny
 *   creature has a space smaller than a square but counts as 1 square for
 *   distance), large 2, huge 3, gargantuan 4;
 * - distance between creatures runs from the nearest square of one to the
 *   nearest square of the other (edge to edge), at 5 ft per square, with the
 *   diagonal alternation 5 / 10 / 5 / 10 across the path;
 * - a creature is adjacent to another when it is within 5 ft of its space,
 *   diagonals included.
 */

import { describe, it, expect } from "vitest";
import {
  sizeSideCells,
  sizeRank,
  tokenCells,
  distanceBetween,
  areAdjacent,
  type PositionGrid,
  type PositionedToken,
} from "../position.js";

const GRID: PositionGrid = { size: 100, distance: 5 };

/** A token at cell (i, j) of the test grid. */
function at(i: number, j: number, size: string, id = `t-${i}-${j}`): PositionedToken {
  return { id, x: i * 100, y: j * 100, size };
}

describe("sizeSideCells", () => {
  it.each([
    ["tiny", 1],
    ["sm", 1],
    ["med", 1],
    ["lg", 2],
    ["huge", 3],
    ["grg", 4],
  ])("%s occupies %i square(s) per side", (size, side) => {
    expect(sizeSideCells(size)).toBe(side);
  });

  it("accepts the vendor words as well as the sheet codes", () => {
    expect(sizeSideCells("small")).toBe(1);
    expect(sizeSideCells("medium")).toBe(1);
    expect(sizeSideCells("large")).toBe(2);
    expect(sizeSideCells("gargantuan")).toBe(4);
  });

  it("refuses an unknown size instead of guessing one", () => {
    expect(() => sizeSideCells("colossal")).toThrow(RangeError);
    expect(() => sizeSideCells("constructor")).toThrow(RangeError);
  });
});

describe("sizeRank", () => {
  it("orders tiny < sm < med < lg < huge < grg", () => {
    expect(["tiny", "sm", "med", "lg", "huge", "grg"].map(sizeRank)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("lets the mount rule compare sizes (Small rider, Medium mount: +1)", () => {
    expect(sizeRank("med") - sizeRank("sm")).toBe(1);
    expect(sizeRank("sm") - sizeRank("sm")).toBe(0);
  });

  it("refuses an unknown size", () => {
    expect(() => sizeRank("giant")).toThrow(RangeError);
  });
});

describe("tokenCells", () => {
  it("a Large token at the top-left cell covers a 2x2 block", () => {
    expect(tokenCells(at(3, 4, "lg"), GRID)).toEqual([
      { i: 3, j: 4 },
      { i: 4, j: 4 },
      { i: 3, j: 5 },
      { i: 4, j: 5 },
    ]);
  });

  it("a tiny token covers one cell", () => {
    expect(tokenCells(at(2, 2, "tiny"), GRID)).toEqual([{ i: 2, j: 2 }]);
  });

  it("honours the grid origin offset", () => {
    const grid: PositionGrid = { size: 100, distance: 5, offsetX: 50, offsetY: 50 };
    expect(tokenCells({ id: "a", x: 150, y: 250, size: "med" }, grid)).toEqual([{ i: 1, j: 2 }]);
  });

  it("snaps a token dropped off-grid to the cell holding its top-left corner", () => {
    expect(tokenCells({ id: "a", x: 130, y: 170, size: "med" }, GRID)).toEqual([{ i: 1, j: 1 }]);
  });
});

describe("distanceBetween", () => {
  it("counts edge to edge: Large (2x2) and Small two squares past its edge = 10 ft", () => {
    // Large covers columns 0-1; Small at column 3 leaves column 2 between them.
    expect(distanceBetween(at(0, 0, "lg"), at(3, 0, "sm"), GRID)).toBe(10);
  });

  it("is symmetric", () => {
    const a = at(0, 0, "lg");
    const b = at(5, 3, "sm");
    expect(distanceBetween(a, b, GRID)).toBe(distanceBetween(b, a, GRID));
  });

  it("counts from ANY occupied square: the bottom row of a Huge is as near as the top", () => {
    // Huge covers columns 0-2 and rows 0-2; Medium on row 2 (its bottom row).
    expect(distanceBetween(at(0, 0, "huge"), at(3, 2, "med"), GRID)).toBe(5);
    expect(distanceBetween(at(0, 0, "huge"), at(4, 2, "med"), GRID)).toBe(10);
  });

  it("adjacent medium tokens are 5 ft apart", () => {
    expect(distanceBetween(at(0, 0, "med"), at(1, 0, "med"), GRID)).toBe(5);
  });

  it("applies the PF2e diagonal alternation 5/10/5: 2 diagonal squares = 15 ft", () => {
    expect(distanceBetween(at(0, 0, "med"), at(2, 2, "med"), GRID)).toBe(15);
  });

  it("one diagonal square = 5 ft, three = 20 ft (5+10+5)", () => {
    expect(distanceBetween(at(0, 0, "med"), at(1, 1, "med"), GRID)).toBe(5);
    expect(distanceBetween(at(0, 0, "med"), at(3, 3, "med"), GRID)).toBe(20);
  });

  it("mixes straight and diagonal squares", () => {
    // 3 columns, 1 row: 1 diagonal (5) + 2 straight (10) = 15.
    expect(distanceBetween(at(0, 0, "med"), at(3, 1, "med"), GRID)).toBe(15);
  });

  it("a tiny token counts as a full square for distance", () => {
    expect(distanceBetween(at(0, 0, "tiny"), at(2, 0, "tiny"), GRID)).toBe(10);
  });

  it("uses the scene's distance per square", () => {
    const grid: PositionGrid = { size: 100, distance: 1.5 };
    expect(distanceBetween(at(0, 0, "med"), at(3, 0, "med"), grid)).toBeCloseTo(4.5);
  });

  it("is 0 when the footprints overlap", () => {
    expect(distanceBetween(at(0, 0, "lg"), at(1, 1, "med"), GRID)).toBe(0);
  });

  it("honours the diagonal rule of the scene (equidistant: 2 diagonals = 10 ft)", () => {
    const grid: PositionGrid = { size: 100, distance: 5, diagonalRule: "equidistant" };
    expect(distanceBetween(at(0, 0, "med"), at(2, 2, "med"), grid)).toBe(10);
  });

  it("measures with the grid origin offset", () => {
    const grid: PositionGrid = { size: 100, distance: 5, offsetX: 50, offsetY: 50 };
    const a: PositionedToken = { id: "a", x: 150, y: 150, size: "med" };
    const b: PositionedToken = { id: "b", x: 450, y: 150, size: "med" };
    expect(distanceBetween(a, b, grid)).toBe(15);
  });

  it("refuses a grid that is not square", () => {
    const hex: PositionGrid = { size: 100, distance: 5, type: "hex" };
    expect(() => distanceBetween(at(0, 0, "med"), at(1, 0, "med"), hex)).toThrow(RangeError);
  });
});

describe("areAdjacent", () => {
  it("orthogonal neighbours are adjacent", () => {
    expect(areAdjacent(at(0, 0, "med"), at(1, 0, "med"), GRID)).toBe(true);
  });

  it("diagonal neighbours are adjacent", () => {
    expect(areAdjacent(at(0, 0, "med"), at(1, 1, "med"), GRID)).toBe(true);
  });

  it("a gap of one square is not adjacent", () => {
    expect(areAdjacent(at(0, 0, "med"), at(2, 0, "med"), GRID)).toBe(false);
  });

  it("a Small rider is adjacent to a Medium mount's diagonal corner", () => {
    expect(areAdjacent(at(2, 2, "sm"), at(1, 1, "med"), GRID)).toBe(true);
  });

  it("a Large token is adjacent from any of its edge squares", () => {
    const big = at(0, 0, "lg");
    expect(areAdjacent(big, at(2, 1, "med"), GRID)).toBe(true);
    expect(areAdjacent(big, at(1, 2, "med"), GRID)).toBe(true);
    expect(areAdjacent(big, at(2, 2, "med"), GRID)).toBe(true);
    expect(areAdjacent(big, at(3, 0, "med"), GRID)).toBe(false);
  });

  it("distinct tokens whose footprints overlap count as adjacent (within 5 ft)", () => {
    expect(areAdjacent(at(0, 0, "lg", "a"), at(1, 1, "med", "b"), GRID)).toBe(true);
  });

  it("a token is never adjacent to itself", () => {
    const a = at(0, 0, "med", "same");
    expect(areAdjacent(a, { ...a }, GRID)).toBe(false);
  });
});
