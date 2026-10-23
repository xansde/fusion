import { describe, it, expect } from "vitest";
import {
  addBrushSample,
  buildBrushOp,
  buildPolyOp,
  buildRectOp,
  effectiveMode,
  isNearFirstVertex,
} from "../fogDraw.js";

describe("effectiveMode", () => {
  it("Alt flips the mode", () => {
    expect(effectiveMode("reveal", false)).toBe("reveal");
    expect(effectiveMode("reveal", true)).toBe("cover");
    expect(effectiveMode("cover", true)).toBe("reveal");
  });
});

describe("buildRectOp", () => {
  it("normalizes a drag in any direction", () => {
    expect(buildRectOp("reveal", { x: 200, y: 150 }, { x: 100, y: 50 }, null)).toEqual({
      t: "rect",
      m: "reveal",
      x: 100,
      y: 50,
      w: 100,
      h: 100,
    });
  });

  it("snaps the corners to the grid lattice", () => {
    expect(buildRectOp("cover", { x: 130, y: 40 }, { x: 260, y: 170 }, 100)).toEqual({
      t: "rect",
      m: "cover",
      x: 100,
      y: 0,
      w: 200,
      h: 200,
    });
  });

  it("a snapped drag inside a single cell still selects that cell", () => {
    const op = buildRectOp("reveal", { x: 110, y: 110 }, { x: 140, y: 130 }, 100);
    expect(op).toMatchObject({ x: 100, y: 100, w: 100, h: 100 });
  });

  it("ignores a stray click", () => {
    expect(buildRectOp("reveal", { x: 10, y: 10 }, { x: 11, y: 11 }, null)).toBeNull();
  });
});

describe("buildPolyOp", () => {
  it("needs three distinct vertices", () => {
    expect(
      buildPolyOp("reveal", [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBeNull();
    expect(
      buildPolyOp("reveal", [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10.2, y: 0.2 },
      ]),
    ).toBeNull();
  });

  it("drops the duplicate vertex a double click adds", () => {
    const op = buildPolyOp("cover", [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ]);
    expect(op).toEqual({ t: "poly", m: "cover", p: [0, 0, 100, 0, 100, 100] });
  });
});

describe("brush", () => {
  it("thins samples that are too close", () => {
    let pts = addBrushSample([], { x: 0, y: 0 }, 40);
    pts = addBrushSample(pts, { x: 5, y: 0 }, 40);
    expect(pts).toHaveLength(1);
    pts = addBrushSample(pts, { x: 30, y: 0 }, 40);
    expect(pts).toHaveLength(2);
  });

  it("builds a dab from one sample and rounds the radius", () => {
    expect(buildBrushOp("reveal", 40.4, [{ x: 10.2, y: 20.7 }])).toEqual({
      t: "brush",
      m: "reveal",
      r: 40,
      p: [10, 21],
    });
    expect(buildBrushOp("reveal", 40, [])).toBeNull();
  });
});

describe("isNearFirstVertex", () => {
  it("only closes with at least three vertices", () => {
    const v = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ];
    expect(isNearFirstVertex(v, { x: 1, y: 1 }, 10)).toBe(false);
    expect(isNearFirstVertex([...v, { x: 50, y: 50 }], { x: 1, y: 1 }, 10)).toBe(true);
  });
});
