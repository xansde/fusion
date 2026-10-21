import { describe, it, expect } from "vitest";
import {
  AREA_PALETTE,
  DEFAULT_AREA_STYLE,
  normalizeAreaStyle,
  parseAreaTemplate,
  footprintFromAnchor,
  anchoredTemplate,
} from "../templates.js";

describe("area style", () => {
  it("has a six color palette and readable defaults", () => {
    expect(AREA_PALETTE).toHaveLength(6);
    expect(DEFAULT_AREA_STYLE.border).toBe("medium");
    expect(DEFAULT_AREA_STYLE.fill).toBeCloseTo(0.3);
  });

  it("normalizes untrusted style, clamping fill and rejecting junk", () => {
    expect(normalizeAreaStyle(undefined)).toEqual(DEFAULT_AREA_STYLE);
    expect(normalizeAreaStyle({ color: "#ff0000", border: "thick", fill: 0.9 })).toEqual({
      color: "#ff0000",
      border: "thick",
      fill: 0.7,
    });
    expect(normalizeAreaStyle({ color: "red", border: "huge", fill: 0.01 })).toEqual({
      ...DEFAULT_AREA_STYLE,
      fill: 0.1,
    });
  });

  it("parseAreaTemplate keeps tokenId and style, and stays valid without them", () => {
    const base = { kind: "emanation", sizeFt: 10, origin: { x: 1, y: 2 }, direction: 0 };
    expect(parseAreaTemplate(base)?.style).toBeUndefined();
    expect(parseAreaTemplate(base)?.tokenId).toBeUndefined();
    const t = parseAreaTemplate({
      ...base,
      tokenId: "tok1",
      style: { color: "#00ff00", border: "thin", fill: 0.5 },
    });
    expect(t?.tokenId).toBe("tok1");
    expect(t?.style).toEqual({ color: "#00ff00", border: "thin", fill: 0.5 });
  });
});

describe("anchored emanation", () => {
  const grid = { size: 100, ox: 0, oy: 0 };
  it("recomputes footprint and origin from the token position and size", () => {
    const fp = footprintFromAnchor({ x: 200, y: 300 }, { width: 2, height: 2 }, grid);
    expect(fp).toEqual({ i: 2, j: 3, width: 2, height: 2 });
  });

  it("re-anchors a template on a moved token keeping size and style", () => {
    const t = {
      kind: "emanation" as const,
      sizeFt: 10,
      origin: { x: 50, y: 50 },
      direction: 0,
      tokenId: "t1",
      style: DEFAULT_AREA_STYLE,
    };
    const moved = anchoredTemplate(t, { i: 4, j: 1, width: 1, height: 1 }, grid);
    expect(moved.footprint).toEqual({ i: 4, j: 1, width: 1, height: 1 });
    expect(moved.origin).toEqual({ x: 450, y: 150 });
    expect(moved.tokenId).toBe("t1");
    expect(moved.style).toBe(DEFAULT_AREA_STYLE);
  });
});
