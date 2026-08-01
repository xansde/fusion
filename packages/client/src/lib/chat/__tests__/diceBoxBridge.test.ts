/**
 * Tests for diceBoxBridge mapping logic (pure functions only — no WebGL).
 */

import { describe, it, expect } from "vitest";
import {
  mapRollToDiceBoxNotations,
  normalizeAssetPath,
  DEFAULT_ASSET_PATH,
} from "../diceBoxBridge.js";
import type { RollResultData } from "@fusion/shared";

const makeRoll = (overrides: Partial<RollResultData> = {}): RollResultData => ({
  rollId: "r1",
  formula: "2d6",
  expandedFormula: "2d6",
  total: 7,
  terms: [
    {
      type: "dice",
      expression: "2d6",
      total: 7,
      number: 2,
      faces: 6,
      results: [
        { result: 3, active: true },
        { result: 4, active: true },
      ],
    },
  ],
  rollMode: "public",
  timestamp: 1700000000000,
  warnings: [],
  ...overrides,
});

describe("mapRollToDiceBoxNotations", () => {
  it("extracts notation and results from dice term", () => {
    const notations = mapRollToDiceBoxNotations(makeRoll());
    expect(notations).toHaveLength(1);
    expect(notations[0]?.notation).toBe("2d6");
    expect(notations[0]?.results).toEqual([3, 4]);
  });

  it("returns empty for rolls with no dice terms", () => {
    const roll = makeRoll({
      terms: [{ type: "numeric", expression: "5", total: 5 }],
    });
    expect(mapRollToDiceBoxNotations(roll)).toHaveLength(0);
  });

  it("handles multiple dice terms", () => {
    const roll = makeRoll({
      formula: "1d20+2d6",
      terms: [
        {
          type: "dice",
          expression: "1d20",
          total: 15,
          number: 1,
          faces: 20,
          results: [{ result: 15, active: true }],
        },
        { type: "operator", expression: "+", total: 0 },
        {
          type: "dice",
          expression: "2d6",
          total: 7,
          number: 2,
          faces: 6,
          results: [
            { result: 3, active: true },
            { result: 4, active: true },
          ],
        },
      ],
    });
    const notations = mapRollToDiceBoxNotations(roll);
    expect(notations).toHaveLength(2);
    expect(notations[0]?.notation).toBe("1d20");
    expect(notations[1]?.notation).toBe("2d6");
  });

  it("includes all dice values including discarded", () => {
    const roll = makeRoll({
      terms: [
        {
          type: "dice",
          expression: "4d6kh3",
          total: 13,
          number: 4,
          faces: 6,
          results: [
            { result: 5, active: true },
            { result: 4, active: true },
            { result: 4, active: true },
            { result: 1, active: false, discarded: true },
          ],
        },
      ],
    });
    const notations = mapRollToDiceBoxNotations(roll);
    expect(notations[0]?.notation).toBe("4d6");
    expect(notations[0]?.results).toEqual([5, 4, 4, 1]);
  });

  // FIX-3 (d): a real RollResultData with pre-defined results (matching the
  // server-side converter output) must produce non-empty notations whose preset
  // results equal the rolled values — so the 3D animation lands on the server
  // values exactly (REQ-ROL-043). This is the regression guard for the bug where
  // the server emitted dice terms with no `results[]`, making this map empty.
  it("produces non-empty notations with preset results for a server-shaped roll", () => {
    // Shape mirrors RollService.convertRollToTerms output for "2d20 + 1d6":
    const roll = makeRoll({
      formula: "2d20 + 1d6",
      expandedFormula: "2d20 + 1d6",
      total: 27,
      terms: [
        {
          type: "dice",
          expression: "2d20",
          total: 21,
          number: 2,
          faces: 20,
          results: [
            { result: 20, active: true, success: true },
            { result: 1, active: true, failure: true },
          ],
        },
        { type: "operator", expression: "+", total: 0 },
        {
          type: "dice",
          expression: "1d6",
          total: 6,
          number: 1,
          faces: 6,
          results: [{ result: 6, active: true, exploded: false }],
        },
      ],
    });

    const notations = mapRollToDiceBoxNotations(roll);
    expect(notations.length).toBeGreaterThan(0);
    expect(notations).toHaveLength(2);
    expect(notations[0]).toMatchObject({ notation: "2d20", results: [20, 1] });
    expect(notations[1]).toMatchObject({ notation: "1d6", results: [6] });
    // Every notation carries a non-empty, fully-populated results array.
    for (const n of notations) {
      expect(Array.isArray(n.results)).toBe(true);
      expect(n.results.length).toBeGreaterThan(0);
      expect(n.results.every((v) => typeof v === "number")).toBe(true);
    }
  });
});

// Regression guard (r12 verification): dice-box builds request URLs by naive
// string concatenation — `${origin}${assetPath}themes/...` and
// `${assetPath}ammo/ammo.wasm.wasm` — with no separator inserted. A missing
// trailing slash on assetPath therefore produced malformed URLs like
// ".../dice-boxammo.wasm.wasm", which 401/404'd (worse: the old default
// "/assets/dice-box" also collided with the server's authenticated
// world-upload route at GET /assets/*, see assets/routes.ts). This suite
// pins the join behavior so a regression is caught without a browser.
describe("normalizeAssetPath", () => {
  it("returns the default asset path when no config is supplied", () => {
    expect(normalizeAssetPath(undefined)).toBe(DEFAULT_ASSET_PATH);
  });

  it("default asset path ends with a trailing slash", () => {
    expect(DEFAULT_ASSET_PATH.endsWith("/")).toBe(true);
  });

  it("default asset path does not live under the authenticated /assets/* route", () => {
    expect(DEFAULT_ASSET_PATH.startsWith("/assets/")).toBe(false);
  });

  it("appends a trailing slash when the caller omits one", () => {
    expect(normalizeAssetPath("/custom/path")).toBe("/custom/path/");
  });

  it("does not double the trailing slash when the caller already supplies one", () => {
    expect(normalizeAssetPath("/custom/path/")).toBe("/custom/path/");
  });

  it("falls back to the default for an empty string", () => {
    expect(normalizeAssetPath("")).toBe(DEFAULT_ASSET_PATH);
  });

  it("joins with the dice-box concatenation contract without a malformed path", () => {
    // Mirrors dice-box's own `${origin}${assetPath}ammo/ammo.wasm.wasm`.
    const origin = "http://localhost:33000";
    const joined = `${origin}${normalizeAssetPath(undefined)}ammo/ammo.wasm.wasm`;
    expect(joined).toBe("http://localhost:33000/dice-assets/ammo/ammo.wasm.wasm");
    // Never produces the historical malformed shape (missing "/" between dir and file).
    expect(joined).not.toContain("dice-assetsammo");
  });
});
