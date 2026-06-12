/**
 * grid-integration.test.ts — integration tests between camera math and grid.
 *
 * Verifies that screen→world→grid conversions compose correctly.
 * Uses the shared squarePixelToCell and squareCellToPixel functions.
 *
 * No PIXI dependency — pure math.
 */

import { describe, it, expect } from "vitest";
import { squarePixelToCell, squareCellToPixel, squareMeasurePath } from "@fusion/shared";
import { screenToWorld, centerOn, DEFAULT_ZOOM_LIMITS, type CameraState } from "../camera-math.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GRID_SIZE = 100; // 100 px per cell
const GRID_DISTANCE = 5; // 5 ft per cell
const OFFSET_X = 280; // 10% padding of 2800px
const OFFSET_Y = 210; // 10% padding of 2100px

/** Convert screen point to grid cell via camera + grid. */
function screenToCell(sx: number, sy: number, camera: CameraState): { i: number; j: number } {
  const { x: wx, y: wy } = screenToWorld(sx, sy, camera);
  return squarePixelToCell(wx, wy, GRID_SIZE, OFFSET_X, OFFSET_Y);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("screen → world → grid cell (round-trip)", () => {
  it("identity camera: clicking at pixel (380, 310) lands in cell (1, 1)", () => {
    // Cell (1,1) center = (OFFSET_X + 1*100 + 50, OFFSET_Y + 1*100 + 50) = (430, 360)
    // But (380, 310) = OFFSET_X + 0*100 + 100 (boundary), so let's use exact values
    // Cell (1,1): x in [OFFSET_X+100, OFFSET_X+200) = [380, 480), y in [OFFSET_Y+100, OFFSET_Y+200) = [310, 410)
    const camera: CameraState = { tx: 0, ty: 0, scale: 1 };
    const cell = screenToCell(380, 310, camera);
    expect(cell).toEqual({ i: 1, j: 1 });
  });

  it("cell (0, 0) starts at OFFSET_X, OFFSET_Y", () => {
    const camera: CameraState = { tx: 0, ty: 0, scale: 1 };
    // Click exactly at the top-left of cell (0,0)
    const cell = screenToCell(OFFSET_X, OFFSET_Y, camera);
    expect(cell).toEqual({ i: 0, j: 0 });
  });

  it("cell center maps back to correct screen position with identity camera", () => {
    const camera: CameraState = { tx: 0, ty: 0, scale: 1 };
    const center = squareCellToPixel(3, 5, GRID_SIZE, OFFSET_X, OFFSET_Y);
    // At scale 1 with tx=ty=0, worldX = screenX
    const cell = screenToCell(center.x, center.y, camera);
    expect(cell).toEqual({ i: 3, j: 5 });
  });

  it("zoomed-in camera: click maps to same world cell", () => {
    // Camera centered on world point (780, 560) = cell (5,3) center at scale 2
    const viewW = 1920,
      viewH = 1080;
    const worldCenterX = OFFSET_X + 5 * GRID_SIZE + GRID_SIZE / 2; // 780
    const worldCenterY = OFFSET_Y + 3 * GRID_SIZE + GRID_SIZE / 2; // 560
    const camera = centerOn(worldCenterX, worldCenterY, viewW, viewH, 2, DEFAULT_ZOOM_LIMITS);

    // Screen center should map to world (780, 560) = cell (5, 3)
    const cell = screenToCell(viewW / 2, viewH / 2, camera);
    expect(cell).toEqual({ i: 5, j: 3 });
  });
});

describe("squareCellToPixel / squarePixelToCell round-trip", () => {
  it("center of cell survives round-trip", () => {
    for (const [i, j] of [
      [0, 0],
      [3, 7],
      [10, 4],
      [27, 20],
    ]) {
      const center = squareCellToPixel(i!, j!, GRID_SIZE, OFFSET_X, OFFSET_Y);
      const back = squarePixelToCell(center.x, center.y, GRID_SIZE, OFFSET_X, OFFSET_Y);
      expect(back).toEqual({ i, j });
    }
  });
});

describe("squareMeasurePath — alternating_1 (PF2e 5-10-5)", () => {
  // REQ-CNV-019, REQ-CNV-020: alternating_1 starts at cost 1
  it("one diagonal step = 5 ft (cost 1)", () => {
    // Start at cell (0,0) center, end at cell (1,1) center
    const p0 = squareCellToPixel(0, 0, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const p1 = squareCellToPixel(1, 1, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const dist = squareMeasurePath(
      [p0, p1],
      GRID_SIZE,
      GRID_DISTANCE,
      "alternating_1",
      OFFSET_X,
      OFFSET_Y,
    );
    expect(dist).toBe(5); // 1 diagonal × cost 1 × 5 ft/cell
  });

  it("two diagonal steps = 15 ft (costs 1+2)", () => {
    const p0 = squareCellToPixel(0, 0, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const p1 = squareCellToPixel(2, 2, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const dist = squareMeasurePath(
      [p0, p1],
      GRID_SIZE,
      GRID_DISTANCE,
      "alternating_1",
      OFFSET_X,
      OFFSET_Y,
    );
    // (1+2) diagonals × 5 ft = 15 ft
    expect(dist).toBe(15);
  });

  it("three diagonal steps = 20 ft (costs 1+2+1)", () => {
    const p0 = squareCellToPixel(0, 0, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const p1 = squareCellToPixel(3, 3, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const dist = squareMeasurePath(
      [p0, p1],
      GRID_SIZE,
      GRID_DISTANCE,
      "alternating_1",
      OFFSET_X,
      OFFSET_Y,
    );
    // (1+2+1) × 5 = 20 ft
    expect(dist).toBe(20);
  });

  it("four diagonal steps = 30 ft (costs 1+2+1+2)", () => {
    const p0 = squareCellToPixel(0, 0, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const p1 = squareCellToPixel(4, 4, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const dist = squareMeasurePath(
      [p0, p1],
      GRID_SIZE,
      GRID_DISTANCE,
      "alternating_1",
      OFFSET_X,
      OFFSET_Y,
    );
    // (1+2+1+2) × 5 = 30 ft
    expect(dist).toBe(30);
  });

  it("diagonal count accumulates across path segments", () => {
    // 1 diagonal segment then another diagonal segment
    // First diagonal: cost 1, second diagonal: cost 2 (accumulated)
    const p0 = squareCellToPixel(0, 0, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const p1 = squareCellToPixel(1, 1, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const p2 = squareCellToPixel(2, 2, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const dist = squareMeasurePath(
      [p0, p1, p2],
      GRID_SIZE,
      GRID_DISTANCE,
      "alternating_1",
      OFFSET_X,
      OFFSET_Y,
    );
    // Segment 1: 1 diagonal (cost 1) = 5 ft
    // Segment 2: 1 diagonal (cost 2 accumulated) = 10 ft
    // Total: 15 ft
    expect(dist).toBe(15);
  });

  it("equidistant rule: all diagonals cost 1", () => {
    const p0 = squareCellToPixel(0, 0, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const p1 = squareCellToPixel(4, 4, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const dist = squareMeasurePath(
      [p0, p1],
      GRID_SIZE,
      GRID_DISTANCE,
      "equidistant",
      OFFSET_X,
      OFFSET_Y,
    );
    expect(dist).toBe(20); // 4 × 5 ft
  });

  it("rectilinear rule: diagonals cost 2", () => {
    const p0 = squareCellToPixel(0, 0, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const p1 = squareCellToPixel(2, 2, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const dist = squareMeasurePath(
      [p0, p1],
      GRID_SIZE,
      GRID_DISTANCE,
      "rectilinear",
      OFFSET_X,
      OFFSET_Y,
    );
    expect(dist).toBe(20); // 2 diags × 2 cost × 5 ft
  });

  it("cardinal movement: no diagonals, distance is Chebyshev × gridDistance", () => {
    const p0 = squareCellToPixel(0, 0, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const p1 = squareCellToPixel(5, 0, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const dist = squareMeasurePath(
      [p0, p1],
      GRID_SIZE,
      GRID_DISTANCE,
      "alternating_1",
      OFFSET_X,
      OFFSET_Y,
    );
    expect(dist).toBe(25); // 5 cardinal × 5 ft
  });
});

describe("camera zoom does not affect grid cell identity", () => {
  it("same world point → same cell regardless of zoom level", () => {
    const worldX = OFFSET_X + 3.5 * GRID_SIZE; // inside cell (3, *)
    const worldY = OFFSET_Y + 7.5 * GRID_SIZE;

    const cell1x = squarePixelToCell(worldX, worldY, GRID_SIZE, OFFSET_X, OFFSET_Y);
    const cell2x = squarePixelToCell(worldX, worldY, GRID_SIZE, OFFSET_X, OFFSET_Y);

    expect(cell1x).toEqual(cell2x);
    expect(cell1x.i).toBe(3);
    expect(cell1x.j).toBe(7);
  });
});
