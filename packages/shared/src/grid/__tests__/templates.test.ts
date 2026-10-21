import { describe, it, expect } from "vitest";
import { SquareGrid } from "../SquareGrid.js";
import {
  directionDeg,
  normalizeAreaSize,
  snapToCornerOrEdge,
  snapToIntersection,
  targetsInCells,
  templateCells,
  templateTitle,
  type AreaTemplate,
} from "../templates.js";

const grid = new SquareGrid({
  type: "square",
  size: 100,
  distance: 5,
  units: "ft",
  color: "#000",
  alpha: 0.4,
  diagonalRule: "alternating_1",
});
const key = (cells: { i: number; j: number }[]): string[] =>
  cells.map((c) => `${String(c.i)},${String(c.j)}`).sort();
const burst = (sizeFt: number): AreaTemplate => ({
  kind: "burst",
  sizeFt,
  origin: { x: 500, y: 500 },
  direction: 0,
});

describe("snapping", () => {
  it("snaps a burst centre to the nearest intersection", () => {
    expect(snapToIntersection(grid, { x: 538, y: 461 })).toEqual({ x: 500, y: 500 });
    expect(snapToIntersection(grid, { x: 560, y: 449 })).toEqual({ x: 600, y: 400 });
  });

  it("snaps an origin to a corner or an edge midpoint, never a square centre", () => {
    expect(snapToCornerOrEdge(grid, { x: 510, y: 495 })).toEqual({ x: 500, y: 500 });
    expect(snapToCornerOrEdge(grid, { x: 548, y: 505 })).toEqual({ x: 550, y: 500 });
    const c = snapToCornerOrEdge(grid, { x: 560, y: 540 }); // inside square (5,5)
    const onCentre = (c.x - 50) % 100 === 0 && (c.y - 50) % 100 === 0;
    expect(onCentre).toBe(false);
  });

  it("snaps direction to 45 degrees", () => {
    expect(directionDeg({ x: 0, y: 0 }, { x: 100, y: 30 }, true)).toBe(0);
    expect(directionDeg({ x: 0, y: 0 }, { x: 100, y: 80 }, true)).toBe(45);
    expect(directionDeg({ x: 0, y: 0 }, { x: -100, y: 0 }, true)).toBe(180);
    expect(directionDeg({ x: 0, y: 0 }, { x: 0, y: -100 }, true)).toBe(270);
  });
});

describe("normalizeAreaSize", () => {
  it("rounds to steps of 5 and clamps", () => {
    expect(normalizeAreaSize(12)).toBe(10);
    expect(normalizeAreaSize(13)).toBe(15);
    expect(normalizeAreaSize(0)).toBe(5);
    expect(normalizeAreaSize(9999)).toBe(500);
    expect(normalizeAreaSize(Number.NaN)).toBe(5);
  });
});

describe("burst (5-10, centre of the square within the radius)", () => {
  it("5 ft covers the 2x2 around the intersection", () => {
    expect(key(templateCells(burst(5), grid))).toEqual(["4,4", "4,5", "5,4", "5,5"]);
  });

  it("10 ft is the 4x4 minus its four corners (12 squares)", () => {
    const cells = templateCells(burst(10), grid);
    expect(cells).toHaveLength(12);
    const k = key(cells);
    expect(k).not.toContain("3,3");
    expect(k).not.toContain("6,6");
    expect(k).toContain("3,4");
    expect(k).toContain("6,5");
  });

  it("is symmetric around the intersection", () => {
    const cells = templateCells(burst(20), grid);
    const set = new Set(key(cells));
    for (const c of cells) expect(set.has(`${String(9 - c.i)},${String(9 - c.j)}`)).toBe(true);
  });
});

describe("cone", () => {
  const cone = (dir: number, ft = 15): AreaTemplate => ({
    kind: "cone",
    sizeFt: ft,
    origin: { x: 500, y: 500 },
    direction: dir,
  });

  it("opens away from the origin and never behind it", () => {
    const cells = templateCells(cone(0), grid);
    expect(cells.length).toBeGreaterThan(6);
    for (const c of cells) expect(c.i).toBeGreaterThanOrEqual(5);
  });

  it("is mirrored across the axis when facing east", () => {
    const set = new Set(key(templateCells(cone(0), grid)));
    for (const k of set) {
      const [i, j] = k.split(",").map(Number) as [number, number];
      expect(set.has(`${String(i)},${String(9 - j)}`)).toBe(true);
    }
  });

  it("a diagonal cone fills the quadrant, reaching the square next to the origin", () => {
    const set = new Set(key(templateCells(cone(45), grid)));
    expect(set.has("5,5")).toBe(true);
    for (const k of set) {
      const [i, j] = k.split(",").map(Number) as [number, number];
      expect(i).toBeGreaterThanOrEqual(5);
      expect(j).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("line", () => {
  it("is one square wide and N/5 squares long", () => {
    const t: AreaTemplate = { kind: "line", sizeFt: 30, origin: { x: 500, y: 550 }, direction: 0 };
    expect(key(templateCells(t, grid))).toEqual(["5,5", "6,5", "7,5", "8,5", "9,5", "10,5"].sort());
  });
});

describe("emanation", () => {
  const around = (w: number, h: number, ft: number): AreaTemplate => ({
    kind: "emanation",
    sizeFt: ft,
    origin: { x: 0, y: 0 },
    direction: 0,
    footprint: { i: 5, j: 5, width: w, height: h },
  });

  it("5 ft around a Medium token is the 8 neighbours", () => {
    const cells = templateCells(around(1, 1, 5), grid);
    expect(cells).toHaveLength(8);
    expect(key(cells)).not.toContain("5,5");
  });

  it("10 ft around a Medium token drops the far corners (5-10)", () => {
    const k = key(templateCells(around(1, 1, 10), grid));
    expect(k).toHaveLength(24 - 4);
    expect(k).not.toContain("3,3");
    expect(k).toContain("3,4");
  });

  it("grows from the edges of a Large token", () => {
    const k = key(templateCells(around(2, 2, 5), grid));
    expect(k).toHaveLength(12);
    expect(k).toContain("4,4");
    expect(k).toContain("7,7");
    expect(k).not.toContain("5,5");
  });
});

describe("labels and targets", () => {
  it("titles with the size in feet", () => {
    expect(templateTitle({ kind: "cone", sizeFt: 15 })).toBe("Cone 15 pés");
    expect(templateTitle({ kind: "burst", sizeFt: 10 })).toBe("Explosão 10 pés");
  });

  it("lists tokens touched by any of their squares", () => {
    const cells = templateCells(burst(5), grid);
    const names = targetsInCells(cells, [
      { name: "Goblin", i: 5, j: 5, width: 1, height: 1 },
      { name: "Ogro", i: 6, j: 6, width: 2, height: 2 },
      { name: "Longe", i: 9, j: 9, width: 1, height: 1 },
    ]);
    expect(names).toEqual(["Goblin"]);
    expect(targetsInCells(cells, [{ name: "Grande", i: 3, j: 3, width: 2, height: 2 }])).toEqual([
      "Grande",
    ]);
  });
});
