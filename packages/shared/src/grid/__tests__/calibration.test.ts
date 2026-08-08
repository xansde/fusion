/**
 * calibration — deriving a square grid from a rectangle drawn over the map.
 *
 * The promise the feature makes is narrow and checkable: whatever rectangle
 * the GM drags over one cell of a map image, the resulting grid must land ON
 * that rectangle — same size, same corners. So most of these tests assert a
 * round trip: calibrate from a rectangle, then ask the grid math where cell
 * (0,0) is, and demand the rectangle back.
 */

import { describe, it, expect } from "vitest";
import { calibrateSquareGrid, MIN_CALIBRATION_SIZE } from "../calibration.js";
import { squareCellTopLeft, squarePixelToCell } from "../math.js";

describe("one rectangle over one cell", () => {
  it("takes the side of the square as the cell size", () => {
    const result = calibrateSquareGrid({ x: 0, y: 0, width: 120, height: 120 });
    expect(result.size).toBe(120);
  });

  it("puts the grid origin on the rectangle's top-left corner", () => {
    const result = calibrateSquareGrid({ x: 340, y: 260, width: 100, height: 100 });
    // 340 and 260 are both multiples of 100 plus 40/60.
    expect(result.offsetX).toBe(40);
    expect(result.offsetY).toBe(60);
  });

  it("round trips: cell (0,0) lands exactly on the drawn rectangle", () => {
    const rect = { x: 337, y: 219, width: 96, height: 96 };
    const { size, offsetX, offsetY } = calibrateSquareGrid(rect);
    const corner = squareCellTopLeft(
      ...cellOf(rect.x + 1, rect.y + 1, size, offsetX, offsetY),
      size,
      offsetX,
      offsetY,
    );
    expect(corner.x).toBeCloseTo(rect.x, 6);
    expect(corner.y).toBeCloseTo(rect.y, 6);
  });

  it("keeps the offset inside one cell — the grid repeats, the number should not grow", () => {
    const result = calibrateSquareGrid({ x: 5000, y: 9999, width: 100, height: 100 });
    expect(result.offsetX).toBeGreaterThanOrEqual(0);
    expect(result.offsetX).toBeLessThan(result.size);
    expect(result.offsetY).toBeGreaterThanOrEqual(0);
    expect(result.offsetY).toBeLessThan(result.size);
  });
});

describe("a rectangle dragged over several cells", () => {
  it("divides by the cell count — the error divides with it", () => {
    // 5 cells of 100px drawn as one 500px rectangle.
    const result = calibrateSquareGrid({ x: 0, y: 0, width: 500, height: 500 }, 5, 5);
    expect(result.size).toBe(100);
  });

  it("still lands the grid on the rectangle's corner", () => {
    const rect = { x: 73, y: 41, width: 400, height: 400 };
    const { size, offsetX, offsetY } = calibrateSquareGrid(rect, 4, 4);
    expect(size).toBe(100);
    expect(offsetX).toBe(73 % 100);
    expect(offsetY).toBe(41 % 100);
  });

  it("counts columns and rows independently", () => {
    const result = calibrateSquareGrid({ x: 0, y: 0, width: 300, height: 200 }, 3, 2);
    expect(result.size).toBe(100);
    expect(result.squareness).toBeCloseTo(1, 6);
  });
});

describe("a rectangle that is not square", () => {
  it("averages the two sides rather than silently trusting one", () => {
    const result = calibrateSquareGrid({ x: 0, y: 0, width: 100, height: 120 });
    expect(result.size).toBe(110);
  });

  it("reports how square it was, so the UI can warn instead of guessing", () => {
    const square = calibrateSquareGrid({ x: 0, y: 0, width: 100, height: 100 });
    const oblong = calibrateSquareGrid({ x: 0, y: 0, width: 100, height: 150 });
    expect(square.squareness).toBeCloseTo(1, 6);
    expect(oblong.squareness).toBeCloseTo(100 / 150, 6);
  });

  it("reports squareness the same way regardless of which side is longer", () => {
    const tall = calibrateSquareGrid({ x: 0, y: 0, width: 100, height: 150 });
    const wide = calibrateSquareGrid({ x: 0, y: 0, width: 150, height: 100 });
    expect(tall.squareness).toBeCloseTo(wide.squareness, 6);
  });
});

describe("rectangles drawn backwards", () => {
  it("accepts a drag that started at the bottom-right", () => {
    // Normalized by the caller into a positive-extent rect; negative extents
    // must not survive into a grid size.
    const result = calibrateSquareGrid({ x: 400, y: 300, width: -100, height: -100 });
    expect(result.size).toBe(100);
    // Origin is the true top-left, i.e. 300/200 — both multiples of 100.
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  it("round trips a backwards drag onto the same cell", () => {
    const { size, offsetX, offsetY } = calibrateSquareGrid({
      x: 455,
      y: 388,
      width: -90,
      height: -90,
    });
    const corner = squareCellTopLeft(
      ...cellOf(366, 299, size, offsetX, offsetY),
      size,
      offsetX,
      offsetY,
    );
    expect(corner.x).toBeCloseTo(365, 6);
    expect(corner.y).toBeCloseTo(298, 6);
  });
});

describe("rectangles that cannot define a grid", () => {
  it("refuses a zero-area drag instead of producing a size of 0", () => {
    expect(calibrateSquareGrid({ x: 10, y: 10, width: 0, height: 0 }).ok).toBe(false);
  });

  it("refuses a cell smaller than the schema's minimum", () => {
    const result = calibrateSquareGrid({ x: 0, y: 0, width: 20, height: 20 });
    expect(result.ok).toBe(false);
    expect(result.size).toBeLessThan(MIN_CALIBRATION_SIZE);
  });

  it("accepts exactly the minimum", () => {
    const result = calibrateSquareGrid({
      x: 0,
      y: 0,
      width: MIN_CALIBRATION_SIZE,
      height: MIN_CALIBRATION_SIZE,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a cell count of zero rather than dividing by it", () => {
    expect(calibrateSquareGrid({ x: 0, y: 0, width: 300, height: 300 }, 0, 3).ok).toBe(false);
    expect(calibrateSquareGrid({ x: 0, y: 0, width: 300, height: 300 }, 3, 0).ok).toBe(false);
  });

  it("refuses a fractional cell count", () => {
    expect(calibrateSquareGrid({ x: 0, y: 0, width: 300, height: 300 }, 1.5, 3).ok).toBe(false);
  });

  it("refuses non-finite input rather than writing NaN into the scene", () => {
    expect(calibrateSquareGrid({ x: 0, y: 0, width: Number.NaN, height: 100 }).ok).toBe(false);
    expect(
      calibrateSquareGrid({ x: Number.POSITIVE_INFINITY, y: 0, width: 100, height: 100 }).ok,
    ).toBe(false);
  });
});

describe("rounding", () => {
  it("rounds the size to whole pixels — the schema stores an integer", () => {
    const result = calibrateSquareGrid({ x: 0, y: 0, width: 100.4, height: 100.4 });
    expect(Number.isInteger(result.size)).toBe(true);
    expect(result.size).toBe(100);
  });

  it("keeps the offset consistent with the ROUNDED size, not the raw one", () => {
    // If the offset were computed against the unrounded size, the grid would
    // drift a little away from the rectangle the GM actually drew.
    const rect = { x: 250.7, y: 130.2, width: 100.4, height: 100.4 };
    const { size, offsetX, offsetY } = calibrateSquareGrid(rect);
    expect(offsetX).toBeCloseTo(((rect.x % size) + size) % size, 6);
    expect(offsetY).toBeCloseTo(((rect.y % size) + size) % size, 6);
  });
});

/** Cell indices of a point, as a tuple for spreading into squareCellTopLeft. */
function cellOf(
  x: number,
  y: number,
  size: number,
  offsetX: number,
  offsetY: number,
): [number, number] {
  const cell = squarePixelToCell(x, y, size, offsetX, offsetY);
  return [cell.i, cell.j];
}
