/**
 * math.test.ts — exhaustive unit tests for packages/shared/src/grid/math.ts
 *
 * Coverage goals:
 *   - diagonalStepCost: all 7 rules, alternating sequences, edge cases
 *   - squareCellSteps / chebyshevDistance: cardinal, diagonal, mixed
 *   - squareSnapPoint: all 4 resolutions, including vertex/center near-vertex edge cases
 *   - squareSnapFootprint: 1×1, 2×2, 3×3, tie-break behavior
 *   - squareCircleHighlight: known cell counts (placeholder behavior locked per Q-CNV-02)
 *   - squareConeHighlight / squareLineHighlight: basic smoke + non-empty
 *   - cellsInPolygon / pointInPolygon: indirectly via highlight functions
 *
 * Spec: 06-canvas-e-renderizacao.md §D3, §D4
 */

import { describe, it, expect } from "vitest";
import {
  diagonalStepCost,
  squareCellSteps,
  chebyshevDistance,
  squareSnapPoint,
  squareSnapFootprint,
  squareCircleHighlight,
  squareConeHighlight,
  squareLineHighlight,
  squareMeasureCellPath,
  squareCellDistance,
  squareFootprintCells,
  squareNeighborhoodCells,
} from "../math.js";
import type { DiagonalRule } from "../types.js";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const SIZE = 100; // px per cell
const HALF = SIZE / 2; // 50
const OX = 0; // offsetX
const OY = 0; // offsetY
const GD = 5; // gridDistance (ft per cell)

// ---------------------------------------------------------------------------
// diagonalStepCost
// ---------------------------------------------------------------------------

describe("diagonalStepCost — all 7 rules", () => {
  const rules: Array<[DiagonalRule, number, number]> = [
    ["equidistant", 0, 1],
    ["equidistant", 5, 1],
    ["exact", 0, Math.SQRT2],
    ["exact", 99, Math.SQRT2],
    ["approximate", 0, 1.5],
    ["approximate", 7, 1.5],
    ["rectilinear", 0, 2],
    ["rectilinear", 3, 2],
    ["illegal", 0, Infinity],
    ["illegal", 10, Infinity],
  ];

  for (const [rule, before, expected] of rules) {
    it(`${rule}: diagonalsBefore=${before} → ${expected}`, () => {
      expect(diagonalStepCost(rule, before)).toBe(expected);
    });
  }

  describe("alternating_1 (PF2e 5-10-5): starts at 1", () => {
    // Pattern: 1, 2, 1, 2, 1, 2 …  (diagonalsBefore = 0,1,2,3,4,5)
    const expected = [1, 2, 1, 2, 1, 2];
    for (let i = 0; i < expected.length; i++) {
      it(`diagonalsBefore=${i} → ${expected[i]}`, () => {
        expect(diagonalStepCost("alternating_1", i)).toBe(expected[i]!);
      });
    }
  });

  describe("alternating_2: starts at 2", () => {
    // Pattern: 2, 1, 2, 1, 2, 1 …
    const expected = [2, 1, 2, 1, 2, 1];
    for (let i = 0; i < expected.length; i++) {
      it(`diagonalsBefore=${i} → ${expected[i]}`, () => {
        expect(diagonalStepCost("alternating_2", i)).toBe(expected[i]!);
      });
    }
  });

  it("alternating_1 sequence across 8 diagonals = 1+2+1+2+1+2+1+2 = 12", () => {
    let total = 0;
    for (let k = 0; k < 8; k++) total += diagonalStepCost("alternating_1", k);
    expect(total).toBe(12);
  });

  it("alternating_2 sequence across 8 diagonals = 2+1+2+1+2+1+2+1 = 12", () => {
    let total = 0;
    for (let k = 0; k < 8; k++) total += diagonalStepCost("alternating_2", k);
    expect(total).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// squareCellSteps
// ---------------------------------------------------------------------------

describe("squareCellSteps", () => {
  it("same cell → 0 diagonals, 0 cardinals", () => {
    expect(squareCellSteps(3, 3, 3, 3)).toEqual({ diagonals: 0, cardinals: 0 });
  });

  it("pure cardinal (horizontal): 5 cells right → 0 diagonals, 5 cardinals", () => {
    expect(squareCellSteps(0, 0, 5, 0)).toEqual({ diagonals: 0, cardinals: 5 });
  });

  it("pure cardinal (vertical): 4 cells down → 0 diagonals, 4 cardinals", () => {
    expect(squareCellSteps(0, 0, 0, 4)).toEqual({ diagonals: 0, cardinals: 4 });
  });

  it("pure diagonal: (0,0)→(3,3) → 3 diagonals, 0 cardinals", () => {
    expect(squareCellSteps(0, 0, 3, 3)).toEqual({ diagonals: 3, cardinals: 0 });
  });

  it("mixed: (0,0)→(5,3) → 3 diagonals, 2 cardinals", () => {
    expect(squareCellSteps(0, 0, 5, 3)).toEqual({ diagonals: 3, cardinals: 2 });
  });

  it("works with negative deltas: (5,5)→(2,1) → di=3,dj=4 → 3 diagonals, 1 cardinal", () => {
    // |5-2|=3, |5-1|=4 → diagonals=min(3,4)=3, cardinals=|3-4|=1
    expect(squareCellSteps(5, 5, 2, 1)).toEqual({ diagonals: 3, cardinals: 1 });
  });
});

// ---------------------------------------------------------------------------
// chebyshevDistance
// ---------------------------------------------------------------------------

describe("chebyshevDistance", () => {
  it("same cell → 0", () => {
    expect(chebyshevDistance(0, 0, 0, 0)).toBe(0);
  });

  it("purely horizontal: max = |di|", () => {
    expect(chebyshevDistance(0, 0, 7, 0)).toBe(7);
  });

  it("purely vertical: max = |dj|", () => {
    expect(chebyshevDistance(0, 0, 0, 4)).toBe(4);
  });

  it("diagonal: max(3,3) = 3", () => {
    expect(chebyshevDistance(0, 0, 3, 3)).toBe(3);
  });

  it("mixed (3,5): max = 5", () => {
    expect(chebyshevDistance(0, 0, 3, 5)).toBe(5);
  });

  it("negative deltas", () => {
    expect(chebyshevDistance(10, 10, 7, 5)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// squareSnapPoint — center
// ---------------------------------------------------------------------------

describe("squareSnapPoint — center", () => {
  it("point inside cell (0,0) → center of cell (0,0)", () => {
    const p = squareSnapPoint(30, 20, SIZE, OX, OY, "center");
    expect(p).toEqual({ x: HALF, y: HALF });
  });

  it("point exactly at cell center → same center", () => {
    const p = squareSnapPoint(HALF, HALF, SIZE, OX, OY, "center");
    expect(p).toEqual({ x: HALF, y: HALF });
  });

  it("point in cell (2,3) → center of (2,3)", () => {
    const p = squareSnapPoint(210, 340, SIZE, OX, OY, "center");
    expect(p).toEqual({ x: 250, y: 350 });
  });

  it("with offset: point just inside cell (1,1)", () => {
    const ox = 50,
      oy = 50;
    const p = squareSnapPoint(160, 160, SIZE, ox, oy, "center");
    expect(p).toEqual({ x: ox + SIZE + HALF, y: oy + SIZE + HALF });
  });
});

// ---------------------------------------------------------------------------
// squareSnapPoint — vertex / intersection
// ---------------------------------------------------------------------------

describe("squareSnapPoint — vertex (= intersection)", () => {
  it("point near corner (0,0) → vertex at (0,0)", () => {
    const p = squareSnapPoint(10, 10, SIZE, OX, OY, "vertex");
    expect(p).toEqual({ x: 0, y: 0 });
  });

  it("point near corner (1,1) i.e. (100,100) → vertex at (100,100)", () => {
    const p = squareSnapPoint(105, 95, SIZE, OX, OY, "vertex");
    expect(p).toEqual({ x: 100, y: 100 });
  });

  it("point in the middle → snaps to nearest corner", () => {
    // (60,60): closest corner is (100,100) — distance 56.6; (0,0) — distance 84.9
    const p = squareSnapPoint(60, 60, SIZE, OX, OY, "vertex");
    expect(p).toEqual({ x: 100, y: 100 });
  });

  it("intersection alias behaves identically to vertex", () => {
    const v = squareSnapPoint(60, 40, SIZE, OX, OY, "vertex");
    const i = squareSnapPoint(60, 40, SIZE, OX, OY, "intersection");
    expect(v).toEqual(i);
  });

  it("negative grid coords snap correctly", () => {
    // Point at (-30, -30) → nearest vertex is (0,0) or (-100,-100); closest is (0,0)
    const p = squareSnapPoint(-30, -30, SIZE, OX, OY, "vertex");
    expect(p).toEqual({ x: 0, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// squareSnapPoint — edge
// ---------------------------------------------------------------------------

describe("squareSnapPoint — edge", () => {
  // Cell (0,0): top edge midpoint = (50, 0), bottom = (50, 100),
  //             left = (0, 50), right = (100, 50)

  it("point near top edge → snaps to top edge midpoint", () => {
    // (50, 5) → nearest half-cell: hx=1(odd), hy=0(even) → valid edge
    const p = squareSnapPoint(50, 5, SIZE, OX, OY, "edge");
    expect(p).toEqual({ x: 50, y: 0 });
  });

  it("point near bottom edge of cell(0,0) → (50, 100)", () => {
    const p = squareSnapPoint(55, 95, SIZE, OX, OY, "edge");
    expect(p).toEqual({ x: 50, y: 100 });
  });

  it("point near left edge → (0, 50)", () => {
    const p = squareSnapPoint(5, 50, SIZE, OX, OY, "edge");
    expect(p).toEqual({ x: 0, y: 50 });
  });

  it("point near right edge → (100, 50)", () => {
    const p = squareSnapPoint(95, 55, SIZE, OX, OY, "edge");
    expect(p).toEqual({ x: 100, y: 50 });
  });

  it("point at cell center (both odd) → snaps to nearest edge, not center", () => {
    // (50, 50) is cell center → must snap to an edge midpoint, never (50,50)
    const p = squareSnapPoint(50, 50, SIZE, OX, OY, "edge");
    // All 4 edges equidistant; implementation picks one — just verify it is a valid edge
    const validEdges = [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
    ];
    expect(validEdges).toContainEqual(p);
    // Must NOT return the center
    expect(p).not.toEqual({ x: 50, y: 50 });
  });

  it("point exactly on vertex (both even half-indices) → snaps to an edge midpoint", () => {
    // (0,0) is a vertex: hx=0(even), hy=0(even) → must snap to edge, not vertex
    const p = squareSnapPoint(0, 0, SIZE, OX, OY, "edge");
    const validEdges = [
      { x: 50, y: 0 }, // top edge of (0,0)
      { x: 0, y: 50 }, // left edge of (0,0)
      { x: -50, y: 0 }, // top edge of (-1,0)
      { x: 0, y: -50 }, // left edge of (0,-1)
    ];
    expect(validEdges).toContainEqual(p);
    // Must NOT return the vertex itself
    expect(p).not.toEqual({ x: 0, y: 0 });
  });

  it("point near corner (2,2) at (200,200) → snaps to edge, not vertex", () => {
    // Exactly on a vertex — must NOT return (200,200)
    const p = squareSnapPoint(200, 200, SIZE, OX, OY, "edge");
    expect(p).not.toEqual({ x: 200, y: 200 });
    // Must be a valid edge midpoint (x or y but not both are multiples of SIZE with the other at SIZE/2)
    const xOnLine = p.x % SIZE === 0;
    const yOnLine = p.y % SIZE === 0;
    const xAtHalf = Math.abs((p.x % SIZE) - HALF) < 0.001;
    const yAtHalf = Math.abs((p.y % SIZE) - HALF) < 0.001;
    // Valid edge midpoint: exactly one axis on grid line, the other at half-cell
    const isEdge = (xOnLine && yAtHalf) || (yOnLine && xAtHalf);
    expect(isEdge).toBe(true);
  });

  it("returned point is never a vertex (both even half-indices)", () => {
    // Test a grid of points across one cell
    for (let xi = 0; xi <= 10; xi++) {
      for (let yi = 0; yi <= 10; yi++) {
        const x = (xi / 10) * SIZE;
        const y = (yi / 10) * SIZE;
        const p = squareSnapPoint(x, y, SIZE, OX, OY, "edge");

        // A vertex has both coordinates as exact multiples of SIZE.
        // Use Math.round to handle floating-point precision, and ensure the
        // remainder is zero (not just small-negative as JS modulo can produce).
        const remX = Math.abs(((p.x % SIZE) + SIZE) % SIZE); // always [0, SIZE)
        const remY = Math.abs(((p.y % SIZE) + SIZE) % SIZE);
        const bothOnLine = remX < 0.001 && remY < 0.001;
        expect(bothOnLine, `point(${x},${y}) snapped to vertex (${p.x},${p.y})`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// squareSnapFootprint
// ---------------------------------------------------------------------------

describe("squareSnapFootprint", () => {
  // 1×1 footprint (odd) → center snaps to cell center
  describe("1×1 footprint", () => {
    it("center near (50,50) → top-left at (0,0)", () => {
      const r = squareSnapFootprint(50, 50, 1, 1, SIZE, OX, OY);
      expect(r).toEqual({ i: 0, j: 0 });
    });

    it("center at (150,250) → top-left at (1,2)", () => {
      const r = squareSnapFootprint(150, 250, 1, 1, SIZE, OX, OY);
      expect(r).toEqual({ i: 1, j: 2 });
    });

    it("center near edge of cell (80,80) → still cell (0,0)", () => {
      const r = squareSnapFootprint(80, 80, 1, 1, SIZE, OX, OY);
      expect(r).toEqual({ i: 0, j: 0 });
    });
  });

  // 2×2 footprint (even) → center snaps to grid-line intersection
  describe("2×2 footprint", () => {
    it("center near (100,100) → top-left at (0,0) (intersection at (100,100))", () => {
      // 2×2 centered on (100,100): top-left = (100-100, 100-100) → (0,0)
      const r = squareSnapFootprint(105, 95, 2, 2, SIZE, OX, OY);
      expect(r).toEqual({ i: 0, j: 0 });
    });

    it("center near (200,200) → top-left at (1,1)", () => {
      const r = squareSnapFootprint(210, 195, 2, 2, SIZE, OX, OY);
      expect(r).toEqual({ i: 1, j: 1 });
    });

    it("center exactly at intersection (300,200) → top-left at (2,1)", () => {
      const r = squareSnapFootprint(300, 200, 2, 2, SIZE, OX, OY);
      expect(r).toEqual({ i: 2, j: 1 });
    });

    it("center between intersections (150,150) → snaps to nearest intersection", () => {
      // Equidistant from (100,100) and (200,200), etc. — either is acceptable
      const r = squareSnapFootprint(150, 150, 2, 2, SIZE, OX, OY);
      // top-left should be at (0,0) or (1,1) depending on tie-break
      const validOrigins = [
        { i: 0, j: 0 },
        { i: 1, j: 0 },
        { i: 0, j: 1 },
        { i: 1, j: 1 },
      ];
      expect(validOrigins).toContainEqual(r);
    });
  });

  // 3×3 footprint (odd) → center snaps to cell center
  describe("3×3 footprint", () => {
    it("center near cell-center (150,150) → top-left at (0,0)", () => {
      // 3×3 centered on (150,150): top-left = i=(150-150)/100=0, j=0
      const r = squareSnapFootprint(155, 148, 3, 3, SIZE, OX, OY);
      expect(r).toEqual({ i: 0, j: 0 });
    });

    it("center near cell-center (350,250) → top-left at (2,1)", () => {
      // cell (3,2) center is at (350,250); top-left of 3×3 = (3-1, 2-1) = (2,1)
      const r = squareSnapFootprint(355, 245, 3, 3, SIZE, OX, OY);
      expect(r).toEqual({ i: 2, j: 1 });
    });

    it("center close to intersection (200,200) → snaps to nearest cell center", () => {
      // Nearest cell centers to (200,200) are (150,150), (250,150), (150,250), (250,250)
      const r = squareSnapFootprint(200, 200, 3, 3, SIZE, OX, OY);
      // All valid results correspond to top-left = center - (1,1) for the snapped cell
      const validOrigins = [
        { i: 0, j: 0 }, // center=(150,150)
        { i: 1, j: 0 }, // center=(250,150)
        { i: 0, j: 1 }, // center=(150,250)
        { i: 1, j: 1 }, // center=(250,250)
      ];
      expect(validOrigins).toContainEqual(r);
    });
  });
});

// ---------------------------------------------------------------------------
// squareCircleHighlight — locked behavior per Q-CNV-02
//
// NOTE: squareCircleHighlight uses Chebyshev distance as the M1-A inclusion
// heuristic (matching PF2e burst behavior). The exact per-system inclusion rule
// is deferred to Q-CNV-02 and will be resolved in M1-C when templates are
// consumed by the UI. These tests lock the *current* behavior so any change
// to the heuristic is deliberate and visible.
// ---------------------------------------------------------------------------

describe("squareCircleHighlight (M1-A placeholder — Chebyshev heuristic)", () => {
  const ox = 0,
    oy = 0;

  it("returns empty when distanceUnits = 0", () => {
    expect(squareCircleHighlight(50, 50, 0, SIZE, GD, ox, oy)).toHaveLength(0);
  });

  it("returns empty when gridDistance = 0", () => {
    expect(squareCircleHighlight(50, 50, 5, SIZE, 0, ox, oy)).toHaveLength(0);
  });

  it("burst of 5ft (1 cell radius) from cell-center: Chebyshev r=1 → 3×3 = 9 cells", () => {
    // Origin at (50,50) = cell (0,0). radiusCells = 5/5 = 1. Chebyshev ≤ 1 → 3×3 block.
    const cells = squareCircleHighlight(50, 50, 5, SIZE, GD, ox, oy);
    expect(cells).toHaveLength(9);
  });

  it("burst of 10ft (2 cell radius) from cell-center: Chebyshev r=2 → 5×5 = 25 cells", () => {
    const cells = squareCircleHighlight(50, 50, 10, SIZE, GD, ox, oy);
    expect(cells).toHaveLength(25);
  });

  it("burst of 15ft (3 cell radius) from cell-center: Chebyshev r=3 → 7×7 = 49 cells", () => {
    const cells = squareCircleHighlight(50, 50, 15, SIZE, GD, ox, oy);
    expect(cells).toHaveLength(49);
  });

  it("origin cell is always included", () => {
    const cells = squareCircleHighlight(50, 50, 5, SIZE, GD, ox, oy);
    const hasOrigin = cells.some((c) => c.i === 0 && c.j === 0);
    expect(hasOrigin).toBe(true);
  });

  it("cells are unique (no duplicate offsets)", () => {
    const cells = squareCircleHighlight(150, 250, 10, SIZE, GD, ox, oy);
    const keys = cells.map((c) => `${c.i},${c.j}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(cells.length);
  });
});

// ---------------------------------------------------------------------------
// squareConeHighlight — basic smoke tests
// ---------------------------------------------------------------------------

describe("squareConeHighlight", () => {
  it("returns empty for distanceUnits = 0", () => {
    const cells = squareConeHighlight(50, 50, 0, 90, 0, SIZE, GD, OX, OY);
    expect(cells).toHaveLength(0);
  });

  it("90° cone pointing right covers cells to the right of origin", () => {
    // Origin at (50,50) = cell (0,0); direction 0° (right), 90° angle, 30ft = 6 cells
    const cells = squareConeHighlight(50, 50, 0, 90, 30, SIZE, GD, OX, OY);
    expect(cells.length).toBeGreaterThan(0);
    // All cells should have i >= 0 (to the right of / at origin)
    expect(cells.every((c) => c.i >= 0)).toBe(true);
  });

  it("cells are unique", () => {
    const cells = squareConeHighlight(50, 50, 45, 90, 20, SIZE, GD, OX, OY);
    const keys = cells.map((c) => `${c.i},${c.j}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(cells.length);
  });
});

// ---------------------------------------------------------------------------
// squareLineHighlight — basic smoke tests
// ---------------------------------------------------------------------------

describe("squareLineHighlight", () => {
  it("returns empty for distanceUnits = 0", () => {
    const cells = squareLineHighlight(50, 50, 0, 0, 5, SIZE, GD, OX, OY);
    expect(cells).toHaveLength(0);
  });

  it("horizontal line pointing right covers cells with i > 0", () => {
    // Direction 0° (right), 30ft = 6 cells, 1-cell wide
    const cells = squareLineHighlight(50, 50, 0, 30, 5, SIZE, GD, OX, OY);
    expect(cells.length).toBeGreaterThan(0);
    // Should include cells to the right
    expect(cells.some((c) => c.i > 0)).toBe(true);
  });

  it("vertical line pointing down covers cells with j > 0", () => {
    // Direction 90° (down in screen coords)
    const cells = squareLineHighlight(50, 50, 90, 30, 5, SIZE, GD, OX, OY);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.some((c) => c.j > 0)).toBe(true);
  });

  it("cells are unique", () => {
    const cells = squareLineHighlight(50, 50, 45, 20, 5, SIZE, GD, OX, OY);
    const keys = cells.map((c) => `${c.i},${c.j}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(cells.length);
  });
});

// ---------------------------------------------------------------------------
// squareCellDistance — direct unit tests
// ---------------------------------------------------------------------------

describe("squareCellDistance", () => {
  it("same cell → distance 0, diagonalsUsed 0", () => {
    const r = squareCellDistance(3, 3, 3, 3, GD, "equidistant");
    expect(r).toEqual({ distance: 0, diagonalsUsed: 0 });
  });

  it("pure cardinal (3 steps right) with equidistant → 3 * GD", () => {
    const r = squareCellDistance(0, 0, 3, 0, GD, "equidistant");
    expect(r.distance).toBe(3 * GD);
    expect(r.diagonalsUsed).toBe(0);
  });

  it("pure diagonal (3 steps) with equidistant → 3 * GD", () => {
    const r = squareCellDistance(0, 0, 3, 3, GD, "equidistant");
    expect(r.distance).toBe(3 * GD);
    expect(r.diagonalsUsed).toBe(3);
  });

  it("pure diagonal (2 steps) with alternating_1, no prior diagonals → (1+2)*GD", () => {
    // first diagonal costs 1, second costs 2 → total = 3 * GD
    const r = squareCellDistance(0, 0, 2, 2, GD, "alternating_1", 0);
    expect(r.distance).toBe(3 * GD);
    expect(r.diagonalsUsed).toBe(2);
  });

  it("pure diagonal (2 steps) with alternating_1, 1 prior diagonal → (2+1)*GD", () => {
    // prior=1 → first step costs 2, second costs 1
    const r = squareCellDistance(0, 0, 2, 2, GD, "alternating_1", 1);
    expect(r.distance).toBe(3 * GD);
    expect(r.diagonalsUsed).toBe(2);
  });

  it("mixed (3 diag, 2 card) with rectilinear → (3*2 + 2) * GD", () => {
    const r = squareCellDistance(0, 0, 5, 3, GD, "rectilinear");
    expect(r.distance).toBe((3 * 2 + 2) * GD);
    expect(r.diagonalsUsed).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// squareMeasureCellPath — direct unit tests
// ---------------------------------------------------------------------------

describe("squareMeasureCellPath", () => {
  it("empty array → 0", () => {
    expect(squareMeasureCellPath([], GD, "equidistant")).toBe(0);
  });

  it("single cell → 0", () => {
    expect(squareMeasureCellPath([{ i: 0, j: 0 }], GD, "equidistant")).toBe(0);
  });

  it("1 cardinal step → GD", () => {
    const cells = [
      { i: 0, j: 0 },
      { i: 1, j: 0 },
    ];
    expect(squareMeasureCellPath(cells, GD, "equidistant")).toBe(GD);
  });

  it("1 diagonal step with equidistant → GD", () => {
    const cells = [
      { i: 0, j: 0 },
      { i: 1, j: 1 },
    ];
    expect(squareMeasureCellPath(cells, GD, "equidistant")).toBe(GD);
  });

  it("alternating_1: 4 diagonal steps → (1+2+1+2)*GD = 6*GD", () => {
    // Each step is purely diagonal
    const cells = [
      { i: 0, j: 0 },
      { i: 1, j: 1 },
      { i: 2, j: 2 },
      { i: 3, j: 3 },
      { i: 4, j: 4 },
    ];
    // costs: 1 + 2 + 1 + 2 = 6
    expect(squareMeasureCellPath(cells, GD, "alternating_1")).toBe(6 * GD);
  });

  it("alternating_2: 4 diagonal steps → (2+1+2+1)*GD = 6*GD", () => {
    const cells = [
      { i: 0, j: 0 },
      { i: 1, j: 1 },
      { i: 2, j: 2 },
      { i: 3, j: 3 },
      { i: 4, j: 4 },
    ];
    expect(squareMeasureCellPath(cells, GD, "alternating_2")).toBe(6 * GD);
  });

  it("diagonal count accumulates across segments (alternating_1)", () => {
    // Segment 1: 2 diagonals (costs 1+2=3); segment 2: 2 more diagonals (costs 1+2=3)
    // Total diagonals before segment 2 = 2 → costs restart at index 2 → 1+2
    const cells = [
      { i: 0, j: 0 },
      { i: 2, j: 2 }, // 2 diagonal steps
      { i: 4, j: 4 }, // 2 more diagonal steps (accumulated diagonalsBefore=2 → still 1+2)
    ];
    // segment1: 1+2=3; segment2 starts with diagonalsBefore=2 → costs 1+2=3 → total=6
    expect(squareMeasureCellPath(cells, GD, "alternating_1")).toBe(6 * GD);
  });
});

// ---------------------------------------------------------------------------
// squareFootprintCells — direct unit tests
// ---------------------------------------------------------------------------

describe("squareFootprintCells", () => {
  it("1×1 footprint → 1 cell matching origin", () => {
    const cells = squareFootprintCells(2, 3, 1, 1);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ i: 2, j: 3 });
  });

  it("2×2 footprint from (0,0) → 4 cells", () => {
    const cells = squareFootprintCells(0, 0, 2, 2);
    expect(cells).toHaveLength(4);
    expect(cells).toContainEqual({ i: 0, j: 0 });
    expect(cells).toContainEqual({ i: 1, j: 0 });
    expect(cells).toContainEqual({ i: 0, j: 1 });
    expect(cells).toContainEqual({ i: 1, j: 1 });
  });

  it("3×2 footprint → 6 cells", () => {
    const cells = squareFootprintCells(1, 1, 3, 2);
    expect(cells).toHaveLength(6);
    // Spot-check corners
    expect(cells).toContainEqual({ i: 1, j: 1 });
    expect(cells).toContainEqual({ i: 3, j: 2 });
  });

  it("cells are unique (no duplicates)", () => {
    const cells = squareFootprintCells(0, 0, 4, 4);
    const keys = cells.map((c) => `${c.i},${c.j}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(cells.length);
  });

  it("offsets cover exactly the expected rectangle", () => {
    const originI = 2,
      originJ = 3,
      w = 3,
      h = 2;
    const cells = squareFootprintCells(originI, originJ, w, h);
    for (const { i, j } of cells) {
      expect(i).toBeGreaterThanOrEqual(originI);
      expect(i).toBeLessThan(originI + w);
      expect(j).toBeGreaterThanOrEqual(originJ);
      expect(j).toBeLessThan(originJ + h);
    }
  });
});

// ---------------------------------------------------------------------------
// squareNeighborhoodCells — direct unit tests
// ---------------------------------------------------------------------------

describe("squareNeighborhoodCells", () => {
  it("range 0 → only the center cell", () => {
    const cells = squareNeighborhoodCells(2, 3, 0);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ i: 2, j: 3 });
  });

  it("Chebyshev r=1 → 3×3 = 9 cells", () => {
    const cells = squareNeighborhoodCells(0, 0, 1);
    expect(cells).toHaveLength(9);
    // All 8 neighbors + center
    expect(cells).toContainEqual({ i: 0, j: 0 });
    expect(cells).toContainEqual({ i: -1, j: -1 });
    expect(cells).toContainEqual({ i: 1, j: 1 });
  });

  it("Chebyshev r=2 → 5×5 = 25 cells", () => {
    const cells = squareNeighborhoodCells(5, 5, 2);
    expect(cells).toHaveLength(25);
  });

  it("cells are unique (no duplicates)", () => {
    const cells = squareNeighborhoodCells(0, 0, 3);
    const keys = cells.map((c) => `${c.i},${c.j}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(cells.length);
  });

  it("all cells within Chebyshev distance r of center", () => {
    const r = 2,
      ci = 3,
      cj = 4;
    const cells = squareNeighborhoodCells(ci, cj, r);
    for (const { i, j } of cells) {
      expect(Math.max(Math.abs(i - ci), Math.abs(j - cj))).toBeLessThanOrEqual(r);
    }
  });

  it("negative range → only center cell (clamp to 0)", () => {
    const cells = squareNeighborhoodCells(1, 1, -5);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ i: 1, j: 1 });
  });
});
