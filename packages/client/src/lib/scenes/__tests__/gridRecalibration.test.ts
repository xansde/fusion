/**
 * gridRecalibration — recalibrating the grid of a scene that already has things on it.
 *
 * Everything on a scene lives in scene coordinates, whose origin is the corner of the
 * PADDED area; the padding is rounded up to whole cells, so a new cell size moves the
 * map image inside those coordinates. Before this, tokens kept their old coordinates and
 * "slid" over the art the moment the Master calibrated. The rule (provisional, decided by
 * the orchestrator): every token stays on the same point OF THE MAP and is re-seated on
 * the nearest square of the new grid; walls, notes and lights are bound to the image and
 * move with it, never snapped.
 */

import { describe, it, expect } from "vitest";
import { sceneContentOffset } from "../../canvas/sceneCoords.js";
import {
  buildRecalibrationOps,
  planGridRecalibration,
  type RecalibrationScene,
} from "../gridRecalibration.js";

const ONE_BY_ONE = (): { width: number; height: number } => ({ width: 1, height: 1 });

function scene(over: Partial<RecalibrationScene> = {}): RecalibrationScene {
  return {
    width: 2000,
    height: 1500,
    padding: 0.25,
    grid: { size: 100 },
    gridOffsetX: 0,
    gridOffsetY: 0,
    tokens: [],
    walls: [],
    notes: [],
    lights: [],
    ...over,
  };
}

/** Map-image coordinates of a scene point (the art is drawn at the padding corner). */
function imagePoint(s: RecalibrationScene, p: { x: number; y: number }, size: number) {
  const pad = sceneContentOffset({ ...s, grid: { size } });
  return { x: p.x - pad.padX, y: p.y - pad.padY };
}

describe("planGridRecalibration — tokens", () => {
  it("a token stays on the same map point and lands on the nearest square", () => {
    const old = scene({ tokens: [{ _id: "t1", x: 600, y: 400, actorId: "a" }] });
    const plan = planGridRecalibration(old, { size: 70, offsetX: 0, offsetY: 0 }, ONE_BY_ONE);

    const moved = plan.tokens[0];
    expect(moved?._id).toBe("t1");
    // Centre on the map before: scene (650, 450) minus the old padding.
    const before = imagePoint(old, { x: 650, y: 450 }, 100);
    // Centre on the map after, from the plan: top-left + half a (new) cell, minus new padding.
    const after = imagePoint(old, { x: (moved?.x ?? 0) + 35, y: (moved?.y ?? 0) + 35 }, 70);
    // Re-seated on a square: at most half a new cell away from where it was.
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(35);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(35);
  });

  it("the new position is on a square of the new, calibrated grid", () => {
    const old = scene({ tokens: [{ _id: "t1", x: 600, y: 400, actorId: "a" }] });
    const next = { size: 70, offsetX: 23, offsetY: 11 };
    const plan = planGridRecalibration(old, next, ONE_BY_ONE);
    const moved = plan.tokens[0];
    expect(((moved?.x ?? 0) - next.offsetX) % next.size).toBe(0);
    expect(((moved?.y ?? 0) - next.offsetY) % next.size).toBe(0);
  });

  it("changing only the offset keeps the token on the map and moves it to the nearest square", () => {
    const old = scene({ tokens: [{ _id: "t1", x: 600, y: 400, actorId: "a" }] });
    const plan = planGridRecalibration(old, { size: 100, offsetX: 30, offsetY: 0 }, ONE_BY_ONE);
    // Same cell size: same padding. The square nearest to x=650 (centre) in a lattice that
    // starts 30 px in has its centre at 680: top-left 630.
    expect(plan.tokens[0]).toEqual({ _id: "t1", x: 630, y: 400 });
  });

  it("a token already on a square of the new grid is not touched", () => {
    const old = scene({ tokens: [{ _id: "t1", x: 600, y: 400, actorId: "a" }] });
    const plan = planGridRecalibration(old, { size: 100, offsetX: 0, offsetY: 0 }, ONE_BY_ONE);
    expect(plan.tokens).toEqual([]);
  });

  it("a large token keeps its centre on the map", () => {
    // 2x2 token at top-left (600, 400): centre (700, 500).
    const old = scene({ tokens: [{ _id: "big", x: 600, y: 400, actorId: "a" }] });
    const plan = planGridRecalibration(old, { size: 100, offsetX: 20, offsetY: 0 }, () => ({
      width: 2,
      height: 2,
    }));
    const moved = plan.tokens[0];
    // Centre moves to the nearest square centre of the shifted lattice (720): top-left 620.
    expect((moved?.x ?? 0) + 100).toBeCloseTo(720, 5);
  });
});

describe("planGridRecalibration — things bound to the image", () => {
  it("walls, notes and lights follow the image when the padding changes", () => {
    const old = scene({
      walls: [{ _id: "w1", a: { x: 500, y: 500 }, b: { x: 700, y: 500 } } as never],
      notes: [{ id: "n1", x: 800, y: 900, title: "x", text: "", gmOnly: false } as never],
      lights: [{ _id: "l1", x: 1000, y: 1000 } as never],
    });
    const next = { size: 70, offsetX: 0, offsetY: 0 };
    const oldPad = sceneContentOffset(old);
    const newPad = sceneContentOffset({ ...old, grid: { size: next.size } });
    const dx = newPad.padX - oldPad.padX;
    const dy = newPad.padY - oldPad.padY;
    expect(dx).not.toBe(0);

    const plan = planGridRecalibration(old, next, ONE_BY_ONE);
    // Pinned areas follow the image by the same change of padding (the server moves them).
    expect(plan.areaShift).toEqual({ dx, dy });
    expect(plan.walls).toEqual([
      { _id: "w1", a: { x: 500 + dx, y: 500 + dy }, b: { x: 700 + dx, y: 500 + dy } },
    ]);
    expect(plan.notes).toEqual([{ id: "n1", x: 800 + dx, y: 900 + dy }]);
    expect(plan.lights).toEqual([{ _id: "l1", x: 1000 + dx, y: 1000 + dy }]);
  });

  it("same cell size, same padding: they are not touched even if the offset changes", () => {
    const old = scene({
      walls: [{ _id: "w1", a: { x: 500, y: 500 }, b: { x: 700, y: 500 } } as never],
      notes: [{ id: "n1", x: 800, y: 900, title: "x", text: "", gmOnly: false } as never],
    });
    const plan = planGridRecalibration(old, { size: 100, offsetX: 40, offsetY: 40 }, ONE_BY_ONE);
    expect(plan.walls).toEqual([]);
    expect(plan.notes).toEqual([]);
    expect(plan.lights).toEqual([]);
    expect(plan.areaShift).toBeNull();
  });

  it("a scene with nothing on it moves nothing in the document", () => {
    const plan = planGridRecalibration(scene(), { size: 64, offsetX: 5, offsetY: 5 }, ONE_BY_ONE);
    expect(plan).toMatchObject({ tokens: [], walls: [], notes: [], lights: [] });
    // (the pinned areas live on the server: the shift is still announced)
    expect(plan.areaShift).not.toBeNull();
  });
});

describe("buildRecalibrationOps", () => {
  const plan = {
    tokens: [{ _id: "t1", x: 10, y: 20 }],
    walls: [{ _id: "w1", a: { x: 1, y: 2 }, b: { x: 3, y: 4 } }],
    notes: [
      { id: "n1", x: 5, y: 6 },
      { id: "n2", x: 7, y: 8 },
    ],
    lights: [{ _id: "l1", x: 9, y: 10 }],
    areaShift: null,
  };

  it("one embedded op per collection, in the shapes the server implements", () => {
    const ops = buildRecalibrationOps("scene00000000001", plan);
    expect(ops.map((o) => o.type)).toEqual([
      "doc:update",
      "wall:update",
      "light:update",
      "scene:noteUpdate",
      "scene:noteUpdate",
    ]);
    expect(ops[0]?.payload).toEqual({
      documentType: "Token",
      updates: [
        { _id: "t1", diff: { x: 10, y: 20 }, embedded: { type: "Token", id: "scene00000000001" } },
      ],
    });
    expect(ops[1]?.payload).toEqual({
      documentType: "Wall",
      updates: [
        {
          _id: "w1",
          diff: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } },
          embedded: { type: "Wall", id: "scene00000000001" },
        },
      ],
    });
    expect(ops[3]?.payload).toEqual({
      sceneId: "scene00000000001",
      noteId: "n1",
      patch: { x: 5, y: 6 },
    });
  });

  it("an empty plan sends nothing", () => {
    expect(
      buildRecalibrationOps("s", { tokens: [], walls: [], notes: [], lights: [], areaShift: null }),
    ).toEqual([]);
  });
});
