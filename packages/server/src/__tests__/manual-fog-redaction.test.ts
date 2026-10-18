import { describe, it, expect } from "vitest";
import { stripHiddenTokens, tokenIsHiddenFromViewer } from "../net/redaction.js";

const fog = {
  enabled: true,
  base: "covered",
  ops: [{ t: "rect", m: "reveal", x: 0, y: 0, w: 300, h: 300 }],
};

const scene = (manualFog: unknown): Record<string, unknown> => ({
  _id: "s",
  grid: { size: 100 },
  manualFog,
  tokens: [
    { _id: "in", x: 100, y: 100 },
    { _id: "out", x: 600, y: 100 },
  ],
});

describe("stripHiddenTokens with manual fog", () => {
  it("drops tokens whose anchor cell is under the fog", () => {
    const ids = (stripHiddenTokens(scene(fog)) as { tokens: { _id: string }[] }).tokens.map((t) => t._id);
    expect(ids).toEqual(["in"]);
  });

  it("keeps every token when the fog is off or absent", () => {
    for (const f of [undefined, { ...fog, enabled: false }]) {
      const s = scene(f);
      expect(stripHiddenTokens(s)).toBe(s);
    }
  });

  it("uses the token's first-cell centre, scaled by the scene grid", () => {
    const s = { ...scene(fog), grid: { size: 200 } }; // anchor of "in" = (200, 200): still inside
    const ids = (stripHiddenTokens(s) as { tokens: { _id: string }[] }).tokens.map((t) => t._id);
    expect(ids).toEqual(["in"]);
    const edge = { ...scene(fog), tokens: [{ _id: "edge", x: 250, y: 0 }] }; // anchor 300 -> boundary inside
    expect((stripHiddenTokens(edge) as { tokens: unknown[] }).tokens).toHaveLength(1);
    const past = { ...scene(fog), tokens: [{ _id: "past", x: 260, y: 0 }] }; // anchor 310 -> covered
    expect((stripHiddenTokens(past) as { tokens: unknown[] }).tokens).toHaveLength(0);
  });
});

describe("tokenIsHiddenFromViewer stays about hidden/seenBy", () => {
  it("is not affected by the fog on its own", () => {
    expect(tokenIsHiddenFromViewer({ x: 900, y: 900 }, "u")).toBe(false);
  });
});
