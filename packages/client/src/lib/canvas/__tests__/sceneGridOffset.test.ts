/**
 * A calibrated scene starts its grid somewhere other than the map corner. The
 * drawn lines, the measuring grid and the token snap must all agree on where.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SceneDocument } from "@fusion/shared";
import { sceneGridOffset, sceneGridSignature } from "../sceneCoords.js";

describe("sceneGridOffset", () => {
  it("is zero for a scene never calibrated", () => {
    expect(sceneGridOffset({ grid: { size: 100 } })).toEqual({ x: 0, y: 0 });
    expect(sceneGridOffset({})).toEqual({ x: 0, y: 0 });
    expect(sceneGridOffset({ grid: { size: 100 }, gridOffsetX: null, gridOffsetY: null })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("returns the stored offset", () => {
    expect(sceneGridOffset({ grid: { size: 100 }, gridOffsetX: 31, gridOffsetY: 77 })).toEqual({
      x: 31,
      y: 77,
    });
  });

  it("wraps an offset that is not inside one cell (hand-edited document)", () => {
    expect(sceneGridOffset({ grid: { size: 100 }, gridOffsetX: 231, gridOffsetY: -10 })).toEqual({
      x: 31,
      y: 90,
    });
  });
});

describe("sceneGridSignature", () => {
  const base = { grid: { size: 100, color: "#000000", alpha: 0.2, distance: 5, units: "ft" } };

  it("is stable for an unchanged grid", () => {
    expect(sceneGridSignature(base)).toBe(sceneGridSignature({ ...base }));
  });

  it.each([
    ["size", { grid: { ...base.grid, size: 120 } }],
    ["offset", { ...base, gridOffsetX: 5 }],
    ["alpha", { grid: { ...base.grid, alpha: 0.5 } }],
    ["color", { grid: { ...base.grid, color: "#ffffff" } }],
    ["distance", { grid: { ...base.grid, distance: 10 } }],
    ["units", { grid: { ...base.grid, units: "m" } }],
  ])("changes when the %s changes", (_name, next) => {
    expect(sceneGridSignature(next)).not.toBe(sceneGridSignature(base));
  });

  it("ignores everything that is not the grid", () => {
    expect(sceneGridSignature({ ...base, name: "x" } as never)).toBe(sceneGridSignature(base));
  });
});

// ---- loader: draw + measure from the offset origin ----

const fromGridConfig = vi.fn();
vi.mock("pixi.js", () => {
  class Graphics {
    label = "";
    rect() {
      return this;
    }
    fill() {
      return this;
    }
    destroy = vi.fn();
  }
  return { Sprite: class {}, Graphics, Assets: { load: vi.fn() } };
});
vi.mock("../../api.js", () => ({ fusionApi: { getToken: vi.fn(), getFreshToken: vi.fn() } }));
vi.mock("../../session.svelte.js", () => ({ session: { user: { id: "u1" } } }));
vi.mock("../../assets/assetApi.js", () => ({ resolveAssetUrl: vi.fn() }));
vi.mock("../GridRenderer.js", () => ({
  GridRenderer: { fromGridConfig: (...a: unknown[]) => fromGridConfig(...a) },
}));

import { loadSceneDocument } from "../sceneLoader.js";

function fakeCanvas() {
  const layer = { addChild: vi.fn() };
  return {
    setGridStrategy: vi.fn(),
    canvas: {
      getLayer: () => layer,
      setGrid: vi.fn(),
      clearGridIf: vi.fn(),
      setGridStrategy: vi.fn(),
      panTo: vi.fn(),
      fitToScene: vi.fn(),
    },
  };
}

describe("loadSceneDocument — calibrated grid origin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromGridConfig.mockReturnValue({ size: 100 });
  });

  const scene = {
    _id: "s",
    name: "Travessia",
    width: 2000,
    height: 1000,
    padding: 0.25,
    background: null,
    backgroundColor: "#000000",
    grid: { type: "square", size: 100, distance: 5, units: "ft", color: "#000000", alpha: 0.2 },
    gridOffsetX: 30,
    gridOffsetY: 45,
  } as unknown as SceneDocument;

  it("draws the grid from the padding corner PLUS the stored offset", async () => {
    const { canvas } = fakeCanvas();
    await loadSceneDocument(canvas as never, scene);
    // padding is rounded up to whole cells: 500 x 300 here.
    const args = fromGridConfig.mock.calls[0] as unknown[];
    expect(args[3]).toBe(500 + 30);
    expect(args[4]).toBe(300 + 45);
  });

  it("hands the measuring grid the same origin, so a measurement lands on the lines", async () => {
    const { canvas } = fakeCanvas();
    await loadSceneDocument(canvas as never, scene);
    const strategy = canvas.setGridStrategy.mock.calls[0]?.[0] as {
      cellToPixel: (c: { i: number; j: number }) => { x: number; y: number };
    };
    // cellToPixel returns the cell CENTER: origin + half a cell.
    expect(strategy.cellToPixel({ i: 0, j: 0 })).toEqual({ x: 580, y: 395 });
  });

  it("keeps the old behaviour (origin = padding corner) without an offset", async () => {
    const { canvas } = fakeCanvas();
    await loadSceneDocument(
      canvas as never,
      { ...scene, gridOffsetX: null, gridOffsetY: null } as never,
    );
    const args = fromGridConfig.mock.calls[0] as unknown[];
    expect(args[3]).toBe(500);
    expect(args[4]).toBe(300);
  });
});
