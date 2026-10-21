/**
 * sceneCoords.test.ts — `effectiveGridSize` and `sceneContentOffset`
 * (`lib/canvas/sceneCoords.ts`).
 *
 * Defect 1 of the Fase 1 e2e (spec 41) traced back to two things this module
 * now owns:
 *   - a token created via `TokenAddDialog.svelte` used to default to `(0, 0)`
 *     — a corner of the scene's padding margin (REQ-CNV-066), not the map
 *     itself — because nothing computed where the padded area's content
 *     actually starts. `sceneContentOffset` is that formula, shared instead
 *     of re-derived at each call site (`sceneLoader.ts`, `TableScreen.svelte`).
 *   - `scene.grid?.size ?? 100` only guards a MISSING `grid` (REQ-CNV-067);
 *     a `grid.size` that is present but non-positive slipped through
 *     unchanged and would zero `token-visuals.ts`'s `footprint × gridSize`.
 *     `effectiveGridSize` closes that gap too, and is what fixed the
 *     "Grade quadrada · 0 px" label bug in `scenesTabVM.ts` (a DIFFERENT,
 *     undocumented `?? 0` fallback that used to live there).
 */

import { describe, expect, it } from "vitest";
import { effectiveGridSize, sceneContentOffset } from "../sceneCoords.js";

describe("effectiveGridSize", () => {
  it("REQ-CNV-067: returns the scene's own grid.size when it is a positive number", () => {
    expect(effectiveGridSize({ grid: { size: 140 } })).toBe(140);
  });

  it("defaults to 100 when grid is entirely absent (legacy scene, r7.1)", () => {
    expect(effectiveGridSize({})).toBe(100);
    expect(effectiveGridSize(undefined)).toBe(100);
    expect(effectiveGridSize(null)).toBe(100);
  });

  it("defaults to 100 when grid is present but size is 0 — `??` alone would not catch this", () => {
    expect(effectiveGridSize({ grid: { size: 0 } })).toBe(100);
  });

  it("defaults to 100 when grid.size is negative (defensive — never a validated value)", () => {
    expect(effectiveGridSize({ grid: { size: -10 } })).toBe(100);
  });

  it("defaults to 100 when grid itself is null", () => {
    expect(effectiveGridSize({ grid: null })).toBe(100);
  });
});

describe("sceneContentOffset", () => {
  it("computes padX/padY as round(width * padding) / round(height * padding)", () => {
    expect(sceneContentOffset({ width: 4000, height: 2400, padding: 0.25 })).toEqual({
      padX: 1000,
      padY: 600,
    });
  });

  it("is (0, 0) for a scene with no padding", () => {
    expect(sceneContentOffset({ width: 4000, height: 4000, padding: 0 })).toEqual({
      padX: 0,
      padY: 0,
    });
  });

  it("rounds the padding up to whole grid cells, so the drawn grid and the snap (anchored at the scene origin) share one lattice", () => {
    // 999 * 0.25 = 249.75 → 3 cells of the default 100 px.
    expect(sceneContentOffset({ width: 999, height: 999, padding: 0.25 })).toEqual({
      padX: 300,
      padY: 300,
    });
  });

  it("uses the scene's own grid size for that rounding", () => {
    // 2048 * 0.25 = 512 → 7 cells of 84 = 588; 632 * 0.25 = 158 → 2 cells = 168.
    const offset = sceneContentOffset({
      width: 2048,
      height: 632,
      padding: 0.25,
      grid: { size: 84 },
    });
    expect(offset).toEqual({ padX: 588, padY: 168 });
    expect(offset.padX % 84).toBe(0);
    expect(offset.padY % 84).toBe(0);
  });
});
