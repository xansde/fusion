/**
 * SquareGrid — behaviour of the first GridStrategy implementation.
 *
 * These tests exercise the STRATEGY contract, not the square* primitives:
 * they assert what a caller of GridStrategy is entitled to, so that a future
 * HexGrid can be held to the same expectations where they are type-agnostic.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-014, REQ-CNV-016, REQ-CNV-018,
 *       REQ-CNV-019, REQ-CNV-023.
 */

import { describe, it, expect, vi } from "vitest";
import { SquareGrid } from "../SquareGrid.js";
import { createGridStrategy } from "../factory.js";
import type { GridConfig, FootprintShape, TemplateShape } from "../types.js";

function makeConfig(overrides: Partial<GridConfig> = {}): GridConfig {
  return {
    type: "square",
    size: 100,
    distance: 5,
    units: "ft",
    color: "#000000",
    alpha: 0.4,
    diagonalRule: "alternating_1",
    ...overrides,
  };
}

describe("SquareGrid — construction", () => {
  it("exposes the config it was built with", () => {
    const config = makeConfig();
    const grid = new SquareGrid(config);
    expect(grid.config).toBe(config);
  });

  it("defaults the origin to (0,0) when no offset is given", () => {
    const grid = new SquareGrid(makeConfig());
    expect(grid.cellToPixel({ i: 0, j: 0 })).toEqual({ x: 50, y: 50 });
  });

  it("keeps the offset out of GridConfig — it comes from the constructor", () => {
    const grid = new SquareGrid(makeConfig(), { x: 25, y: 40 });
    // The offset must NOT leak into the shared config object (D2).
    expect(grid.config).not.toHaveProperty("offsetX");
    expect(grid.cellToPixel({ i: 0, j: 0 })).toEqual({ x: 75, y: 90 });
  });
});

describe("SquareGrid — pixelToCell / cellToPixel", () => {
  it("maps a point to the cell that contains it", () => {
    const grid = new SquareGrid(makeConfig());
    expect(grid.pixelToCell({ x: 0, y: 0 })).toEqual({ i: 0, j: 0 });
    expect(grid.pixelToCell({ x: 99, y: 99 })).toEqual({ i: 0, j: 0 });
    expect(grid.pixelToCell({ x: 100, y: 250 })).toEqual({ i: 1, j: 2 });
  });

  it("accepts negative coordinates (cells left/above the origin)", () => {
    const grid = new SquareGrid(makeConfig());
    expect(grid.pixelToCell({ x: -1, y: -1 })).toEqual({ i: -1, j: -1 });
  });

  it("honours the grid origin offset", () => {
    const grid = new SquareGrid(makeConfig(), { x: 30, y: 30 });
    expect(grid.pixelToCell({ x: 29, y: 29 })).toEqual({ i: -1, j: -1 });
    expect(grid.pixelToCell({ x: 30, y: 30 })).toEqual({ i: 0, j: 0 });
  });

  it("round-trips: the center of a cell maps back to that cell", () => {
    const grid = new SquareGrid(makeConfig({ size: 70 }), { x: 13, y: -7 });
    for (const cell of [
      { i: 0, j: 0 },
      { i: 3, j: 5 },
      { i: -2, j: 4 },
    ]) {
      expect(grid.pixelToCell(grid.cellToPixel(cell))).toEqual(cell);
    }
  });
});

describe("SquareGrid — getSnappedPoint", () => {
  it("snaps to the center of the containing cell", () => {
    const grid = new SquareGrid(makeConfig());
    expect(grid.getSnappedPoint({ x: 10, y: 10 }, "center")).toEqual({ x: 50, y: 50 });
    expect(grid.getSnappedPoint({ x: 190, y: 10 }, "center")).toEqual({ x: 150, y: 50 });
  });

  it("snaps to the nearest vertex", () => {
    const grid = new SquareGrid(makeConfig());
    expect(grid.getSnappedPoint({ x: 90, y: 10 }, "vertex")).toEqual({ x: 100, y: 0 });
  });

  it("treats intersection as vertex on a square grid", () => {
    const grid = new SquareGrid(makeConfig());
    expect(grid.getSnappedPoint({ x: 90, y: 10 }, "intersection")).toEqual(
      grid.getSnappedPoint({ x: 90, y: 10 }, "vertex"),
    );
  });

  it("snaps to an edge midpoint — exactly one axis on a grid line", () => {
    const grid = new SquareGrid(makeConfig());
    const p = grid.getSnappedPoint({ x: 48, y: 8 }, "edge");
    const onLineX = p.x % 100 === 0;
    const onLineY = p.y % 100 === 0;
    expect(onLineX !== onLineY).toBe(true);
  });
});

describe("SquareGrid — measureDistance", () => {
  it("returns 0 for an empty or single-point path", () => {
    const grid = new SquareGrid(makeConfig());
    expect(grid.measureDistance([])).toBe(0);
    expect(grid.measureDistance([{ x: 10, y: 10 }])).toBe(0);
  });

  it("measures cardinal movement in game units, not pixels", () => {
    const grid = new SquareGrid(makeConfig());
    // three cells to the right = 15 ft at 5 ft/cell
    expect(
      grid.measureDistance([
        { x: 50, y: 50 },
        { x: 350, y: 50 },
      ]),
    ).toBe(15);
  });

  it("applies the configured diagonal rule (PF2e 5-10-5)", () => {
    const grid = new SquareGrid(makeConfig({ diagonalRule: "alternating_1" }));
    // two diagonal steps: 1 + 2 cells = 3 cells = 15 ft
    expect(
      grid.measureDistance([
        { x: 50, y: 50 },
        { x: 250, y: 250 },
      ]),
    ).toBe(15);
  });

  it("uses a different rule when the config says so", () => {
    const grid = new SquareGrid(makeConfig({ diagonalRule: "equidistant" }));
    // two diagonal steps at cost 1 each = 2 cells = 10 ft
    expect(
      grid.measureDistance([
        { x: 50, y: 50 },
        { x: 250, y: 250 },
      ]),
    ).toBe(10);
  });

  it("accumulates the diagonal alternance across the WHOLE path (REQ-CNV-019)", () => {
    const grid = new SquareGrid(makeConfig({ diagonalRule: "alternating_1" }));
    const oneLeg = grid.measureDistance([
      { x: 50, y: 50 },
      { x: 150, y: 150 },
    ]);
    const twoLegs = grid.measureDistance([
      { x: 50, y: 50 },
      { x: 150, y: 150 },
      { x: 250, y: 250 },
    ]);
    expect(oneLeg).toBe(5); // first diagonal costs 1 cell
    expect(twoLegs).toBe(15); // second diagonal costs 2 cells — NOT reset to 1
  });

  it("defaults to the PF2e rule when the config omits diagonalRule (REQ-CNV-020)", () => {
    const config = makeConfig();
    delete config.diagonalRule;
    const grid = new SquareGrid(config);
    expect(
      grid.measureDistance([
        { x: 50, y: 50 },
        { x: 250, y: 250 },
      ]),
    ).toBe(15);
  });

  it("honours the grid origin offset", () => {
    const grid = new SquareGrid(makeConfig(), { x: 40, y: 40 });
    // (90,90) and (240,90) sit in cells i=0 and i=2 of the offset grid
    expect(
      grid.measureDistance([
        { x: 90, y: 90 },
        { x: 240, y: 90 },
      ]),
    ).toBe(10);
  });
});

describe("SquareGrid — getHighlightCells", () => {
  it("returns every cell of a footprint", () => {
    const grid = new SquareGrid(makeConfig());
    const shape: FootprintShape = { origin: { i: 2, j: 3 }, width: 2, height: 2 };
    expect(grid.getHighlightCells(shape)).toEqual([
      { i: 2, j: 3 },
      { i: 3, j: 3 },
      { i: 2, j: 4 },
      { i: 3, j: 4 },
    ]);
  });

  it("returns a single cell for a 1×1 footprint", () => {
    const grid = new SquareGrid(makeConfig());
    const shape: FootprintShape = { origin: { i: 0, j: 0 }, width: 1, height: 1 };
    expect(grid.getHighlightCells(shape)).toEqual([{ i: 0, j: 0 }]);
  });

  it("throws for a template shape instead of returning a wrong answer (D5)", () => {
    const grid = new SquareGrid(makeConfig());
    const shape: TemplateShape = {
      kind: "circle",
      origin: { x: 0, y: 0 },
      direction: 0,
      distance: 20,
    };
    expect(() => grid.getHighlightCells(shape)).toThrow(/TemplateShape/);
  });
});

describe("createGridStrategy", () => {
  it("builds a SquareGrid for type 'square'", () => {
    const grid = createGridStrategy(makeConfig());
    expect(grid).toBeInstanceOf(SquareGrid);
    expect(grid.config.type).toBe("square");
  });

  it("passes the origin through to the instance", () => {
    const grid = createGridStrategy(makeConfig(), { x: 25, y: 40 });
    expect(grid.cellToPixel({ i: 0, j: 0 })).toEqual({ x: 75, y: 90 });
  });

  it("falls back to a square grid for an unimplemented type, and reports it (D3)", () => {
    const onFallback = vi.fn();
    const grid = createGridStrategy(makeConfig({ type: "hex" }), undefined, onFallback);
    expect(grid).toBeInstanceOf(SquareGrid);
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("hex"));
    // The instance must not keep claiming to be a hex grid.
    expect(grid.config.type).toBe("square");
  });

  it("survives a legacy scene with no grid block at all (D3)", () => {
    const onFallback = vi.fn();
    const grid = createGridStrategy(null, undefined, onFallback);
    expect(grid).toBeInstanceOf(SquareGrid);
    expect(onFallback).toHaveBeenCalled();
    // A usable default, not a crash: 100 px cells at 5 ft each.
    expect(grid.config.size).toBe(100);
    expect(
      grid.measureDistance([
        { x: 50, y: 50 },
        { x: 250, y: 50 },
      ]),
    ).toBe(10);
  });

  it("does not require a reporter — the fallback still works silently", () => {
    expect(() => createGridStrategy(null)).not.toThrow();
    expect(createGridStrategy(makeConfig({ type: "gridless" })).config.type).toBe("square");
  });
});
