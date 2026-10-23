import { describe, expect, it, vi, afterEach } from "vitest";
import { SquareGrid } from "@fusion/shared";
import {
  areaSelectable,
  areaSelection,
  loadTargetMode,
  resolveAreaRelease,
  resolveTargetClick,
  saveTargetMode,
  tokenIdsInCells,
} from "../targetMode.js";

describe("resolveTargetClick", () => {
  it("single: a click replaces the aim", () => {
    expect(resolveTargetClick("single", false, "c", ["a", "b"])).toEqual(["c"]);
  });
  it("single: a click on the only aimed token clears it", () => {
    expect(resolveTargetClick("single", false, "a", ["a"])).toEqual([]);
  });
  it("single: a click on one of several aimed tokens keeps just that one", () => {
    expect(resolveTargetClick("single", false, "a", ["a", "b"])).toEqual(["a"]);
  });
  it("single + Shift accumulates (toggles that token only)", () => {
    expect(resolveTargetClick("single", true, "c", ["a"])).toEqual(["a", "c"]);
    expect(resolveTargetClick("single", true, "a", ["a", "b"])).toEqual(["b"]);
  });
  it("multi accumulates; Shift replaces", () => {
    expect(resolveTargetClick("multi", false, "c", ["a"])).toEqual(["a", "c"]);
    expect(resolveTargetClick("multi", false, "a", ["a", "b"])).toEqual(["b"]);
    expect(resolveTargetClick("multi", true, "c", ["a", "b"])).toEqual(["c"]);
    expect(resolveTargetClick("multi", true, "a", ["a"])).toEqual([]);
  });
});

describe("tokenIdsInCells", () => {
  const cells = [
    { i: 1, j: 1 },
    { i: 2, j: 1 },
  ];
  const tokens = [
    { id: "in", i: 1, j: 1, width: 1, height: 1 },
    { id: "big-edge", i: 2, j: 0, width: 2, height: 2 },
    { id: "out", i: 5, j: 5, width: 1, height: 1 },
  ];
  it("keeps tokens with at least one square inside, large ones included", () => {
    expect(tokenIdsInCells(cells, tokens)).toEqual(["in", "big-edge"]);
  });
});

describe("resolveAreaRelease", () => {
  it("replaces the aim; Shift adds without duplicating", () => {
    expect(resolveAreaRelease(false, ["a"], ["b", "c"])).toEqual(["b", "c"]);
    expect(resolveAreaRelease(true, ["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("defaults to single, round-trips, and survives blocked storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(loadTargetMode()).toBe("single");
    saveTargetMode("multi");
    expect(loadTargetMode()).toBe("multi");
    store.set("fusion.targetMode", "garbage");
    expect(loadTargetMode()).toBe("single");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadTargetMode()).toBe("single");
    expect(() => {
      saveTargetMode("multi");
    }).not.toThrow();
  });
});

describe("areaSelection (real templates on a 100px / 5ft grid)", () => {
  const grid = new SquareGrid({
    type: "square",
    size: 100,
    distance: 5,
    units: "ft",
    color: "#000",
    alpha: 0.4,
    diagonalRule: "alternating_1",
  });
  const at = (id: string, i: number, j: number) => ({ id, i, j, width: 1, height: 1 });
  // Origin at the corner between cells (5,5); everything below is relative to it.
  const tokens = [
    at("east-near", 6, 5),
    at("east-mid", 7, 5),
    at("east-far", 12, 5),
    at("behind", 3, 5),
    at("north-far", 6, 0),
    at("diag", 7, 6),
  ];

  it("cone 15 ft pointing east: takes the tokens ahead inside the reach, not those behind or beyond", () => {
    const cone = { kind: "cone", sizeFt: 15, origin: { x: 500, y: 500 }, direction: 0 } as const;
    const ids = areaSelection(cone, grid, tokens, [], false);
    expect(ids).toContain("east-near");
    expect(ids).toContain("east-mid");
    expect(ids).not.toContain("east-far");
    expect(ids).not.toContain("behind");
    expect(ids).not.toContain("north-far");
  });

  it("line 30 ft along a row takes the tokens on it up to its length, not the ones off-axis", () => {
    const line = { kind: "line", sizeFt: 30, origin: { x: 500, y: 550 }, direction: 0 } as const;
    const ids = areaSelection(line, grid, tokens, [], false);
    expect(ids).toContain("east-near");
    expect(ids).toContain("east-mid");
    expect(ids).not.toContain("east-far");
    expect(ids).not.toContain("north-far");
    expect(ids).not.toContain("behind");
  });

  it("burst 10 ft around an intersection takes the squares around it, replacing the old aim", () => {
    const burst = { kind: "burst", sizeFt: 10, origin: { x: 700, y: 600 }, direction: 0 } as const;
    expect(areaSelection(burst, grid, tokens, ["east-far"], false).sort()).toEqual(
      ["diag", "east-mid", "east-near"].sort(),
    );
  });

  it("Shift on release keeps the previous aim and adds the area", () => {
    const burst = { kind: "burst", sizeFt: 10, origin: { x: 700, y: 600 }, direction: 0 } as const;
    expect(areaSelection(burst, grid, tokens, ["east-far"], true).sort()).toEqual(
      ["diag", "east-far", "east-mid", "east-near"].sort(),
    );
  });
});

describe("areaSelectable", () => {
  it("hides hidden tokens from players, not from the GM", () => {
    expect(areaSelectable({ hidden: true }, false)).toBe(false);
    expect(areaSelectable({ hidden: false }, false)).toBe(true);
    expect(areaSelectable({}, false)).toBe(true);
    expect(areaSelectable({ hidden: true }, true)).toBe(true);
  });
});
