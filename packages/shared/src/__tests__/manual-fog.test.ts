import { describe, it, expect } from "vitest";
import {
  ManualFogSchema,
  MANUAL_FOG_LIMITS,
  appendFogOp,
  defaultManualFog,
  isFogCovered,
  resetFog,
  undoFogOp,
  type ManualFog,
} from "../manual-fog.js";

const on = (over: Partial<ManualFog> = {}): ManualFog => ({
  ...defaultManualFog(),
  enabled: true,
  ...over,
});

describe("isFogCovered", () => {
  it("is false when the fog is off or absent", () => {
    expect(isFogCovered(undefined, 10, 10)).toBe(false);
    expect(isFogCovered(defaultManualFog(), 10, 10)).toBe(false);
  });

  it("covers everything by default once enabled", () => {
    expect(isFogCovered(on(), 5, 5)).toBe(true);
    expect(isFogCovered(on({ base: "revealed" }), 5, 5)).toBe(false);
  });

  it("reveals inside a rect and keeps the outside covered", () => {
    const fog = on({ ops: [{ t: "rect", m: "reveal", x: 0, y: 0, w: 100, h: 100 }] });
    expect(isFogCovered(fog, 50, 50)).toBe(false);
    expect(isFogCovered(fog, 150, 50)).toBe(true);
  });

  it("lets the last shape win (cover again over a revealed area)", () => {
    const fog = on({
      ops: [
        { t: "rect", m: "reveal", x: 0, y: 0, w: 100, h: 100 },
        { t: "rect", m: "cover", x: 40, y: 40, w: 20, h: 20 },
      ],
    });
    expect(isFogCovered(fog, 10, 10)).toBe(false);
    expect(isFogCovered(fog, 50, 50)).toBe(true);
  });

  it("handles polygons", () => {
    const fog = on({ ops: [{ t: "poly", m: "reveal", p: [0, 0, 100, 0, 0, 100] }] });
    expect(isFogCovered(fog, 20, 20)).toBe(false);
    expect(isFogCovered(fog, 80, 80)).toBe(true);
  });

  it("handles brush strokes and single dabs by radius", () => {
    const stroke = on({ ops: [{ t: "brush", m: "reveal", r: 10, p: [0, 0, 100, 0] }] });
    expect(isFogCovered(stroke, 50, 8)).toBe(false);
    expect(isFogCovered(stroke, 50, 12)).toBe(true);
    const dab = on({ ops: [{ t: "brush", m: "reveal", r: 10, p: [0, 0] }] });
    expect(isFogCovered(dab, 5, 5)).toBe(false);
    expect(isFogCovered(dab, 20, 0)).toBe(true);
  });
});

describe("ManualFogSchema", () => {
  it("fills defaults", () => {
    expect(ManualFogSchema.parse({})).toEqual({ enabled: false, base: "covered", ops: [] });
  });

  it("rejects a polygon with fewer than three vertices", () => {
    expect(
      ManualFogSchema.safeParse({ ops: [{ t: "poly", m: "reveal", p: [0, 0, 1, 1] }] }).success,
    ).toBe(false);
  });

  it("rejects too many shapes", () => {
    const ops = Array.from({ length: MANUAL_FOG_LIMITS.maxOps + 1 }, () => ({
      t: "rect" as const,
      m: "reveal" as const,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    }));
    expect(ManualFogSchema.safeParse({ ops }).success).toBe(false);
  });

  it("rejects a list that blows the coordinate budget", () => {
    const p = Array.from({ length: MANUAL_FOG_LIMITS.maxBrushPoints * 2 }, (_, i) => i);
    const ops = Array.from({ length: 60 }, () => ({
      t: "brush" as const,
      m: "reveal" as const,
      r: 5,
      p,
    }));
    expect(ManualFogSchema.safeParse({ ops }).success).toBe(false);
  });
});

describe("edits", () => {
  it("appends, undoes and resets", () => {
    const op = { t: "rect", m: "reveal", x: 0, y: 0, w: 10, h: 10 } as const;
    const added = appendFogOp(on(), op);
    expect(added.ok && added.fog.ops).toHaveLength(1);
    if (!added.ok) throw new Error("unreachable");
    expect(undoFogOp(added.fog).ops).toHaveLength(0);
    expect(resetFog(added.fog, "revealed")).toMatchObject({
      base: "revealed",
      ops: [],
      enabled: true,
    });
  });

  it("refuses an append past the budget without mutating", () => {
    const full = on({
      ops: Array.from({ length: MANUAL_FOG_LIMITS.maxOps }, () => ({
        t: "rect" as const,
        m: "reveal" as const,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      })),
    });
    const res = appendFogOp(full, { t: "rect", m: "cover", x: 0, y: 0, w: 1, h: 1 });
    expect(res).toEqual({ ok: false, reason: "too-complex" });
    expect(full.ops).toHaveLength(MANUAL_FOG_LIMITS.maxOps);
  });
});
