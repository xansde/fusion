/**
 * gridRecalibration.ts — what has to move when a scene's grid is recalibrated.
 *
 * Everything placed on a scene (tokens, walls, notes, lights) is stored in scene
 * coordinates, whose origin is the corner of the PADDED area; `sceneContentOffset`
 * rounds that padding UP to whole cells, so a new cell size changes the padding and the
 * map image moves inside those coordinates. Calibrating without touching the placed
 * things made every token "slide" over the art (the pendency of the 18/10 rounds).
 *
 * Rule (provisional — decided by the orchestrator, 21/10):
 *   - a TOKEN stays on the same point of the map (its centre, in image coordinates) and
 *     is re-seated on the nearest square of the new grid;
 *   - walls, notes and lights are bound to the IMAGE: they follow it by the change of the
 *     padding and are never snapped.
 *
 * Pure: the caller reads the scene and a footprint resolver, and sends what comes back.
 */

import { parseMapNotes, type Envelope, type SceneDocument, type Wall } from "@fusion/shared";
import {
  effectiveGridSize,
  sceneContentOffset,
  sceneGridOffset,
  type SceneDimensionsInput,
  type SceneGridInput,
} from "../canvas/sceneCoords.js";

export interface RecalibrationScene extends SceneDimensionsInput, SceneGridInput {
  tokens?: ReadonlyArray<{ _id: string; x: number; y: number; actorId: string }> | undefined;
  walls?: ReadonlyArray<Pick<Wall, "_id" | "a" | "b">> | undefined;
  notes?: ReadonlyArray<{ id: string; x: number; y: number }> | undefined;
  lights?: ReadonlyArray<{ _id: string; x: number; y: number }> | undefined;
}

/** The grid being written: whole-pixel size and the offset from the map corner. */
export interface RecalibrationGrid {
  size: number;
  offsetX: number;
  offsetY: number;
}

export interface GridRecalibrationPlan {
  /** Tokens that change place: their new top-left. */
  tokens: Array<{ _id: string; x: number; y: number }>;
  walls: Array<{ _id: string; a: { x: number; y: number }; b: { x: number; y: number } }>;

  notes: Array<{ id: string; x: number; y: number }>;
  lights: Array<{ _id: string; x: number; y: number }>;
  /**
   * How far the pinned areas (kept by the server, not in the scene document the client
   * holds) have to move: the same change of padding as the walls. `null` when nothing moves.
   */
  areaShift: { dx: number; dy: number } | null;
}

/** Footprint (in cells) of a token, from the actor behind it. */
export type FootprintResolver = (token: { _id: string; actorId: string }) => {
  width: number;
  height: number;
};

function wrapOffset(offset: number, size: number): number {
  return sceneGridOffset({ grid: { size }, gridOffsetX: offset, gridOffsetY: 0 }).x;
}

/** Nearest lattice line to `v` for a lattice that starts at `origin` with step `size`. */
function nearestLine(v: number, origin: number, size: number): number {
  return origin + Math.round((v - origin) / size) * size;
}

/** What to move so the placed things keep their place on the map when the grid changes. */
export function planGridRecalibration(
  scene: RecalibrationScene,
  next: RecalibrationGrid,
  footprintOf: FootprintResolver,
): GridRecalibrationPlan {
  const oldSize = effectiveGridSize(scene);
  const oldPad = sceneContentOffset(scene);
  const newPad = sceneContentOffset({ ...scene, grid: { size: next.size } });
  const dx = newPad.padX - oldPad.padX;
  const dy = newPad.padY - oldPad.padY;

  const originX = wrapOffset(next.offsetX, next.size);
  const originY = wrapOffset(next.offsetY, next.size);

  const plan: GridRecalibrationPlan = {
    tokens: [],
    walls: [],
    notes: [],
    lights: [],
    areaShift: null,
  };

  for (const token of scene.tokens ?? []) {
    const fp = footprintOf(token);
    // Centre on the map before: top-left + half the OLD footprint; the image moved by (dx, dy).
    const cx = token.x + (fp.width * oldSize) / 2 + dx;
    const cy = token.y + (fp.height * oldSize) / 2 + dy;
    // Back to a top-left with the NEW footprint, then onto the nearest square corner.
    const x = nearestLine(cx - (fp.width * next.size) / 2, originX, next.size);
    const y = nearestLine(cy - (fp.height * next.size) / 2, originY, next.size);
    if (x !== token.x || y !== token.y) plan.tokens.push({ _id: token._id, x, y });
  }

  if (dx === 0 && dy === 0) return plan;
  plan.areaShift = { dx, dy };

  for (const wall of scene.walls ?? []) {
    plan.walls.push({
      _id: wall._id,
      a: { x: wall.a.x + dx, y: wall.a.y + dy },
      b: { x: wall.b.x + dx, y: wall.b.y + dy },
    });
  }
  for (const note of scene.notes ?? []) {
    plan.notes.push({ id: note.id, x: note.x + dx, y: note.y + dy });
  }
  for (const light of scene.lights ?? []) {
    plan.lights.push({ _id: light._id, x: light.x + dx, y: light.y + dy });
  }
  return plan;
}

/** One op to send, in the shape the server implements for that collection. */
export interface RecalibrationOp {
  readonly type: Envelope["type"];
  readonly payload: Record<string, unknown>;
}

/**
 * The ops that carry a plan out: ONE op per collection (a note has no batch op, so one
 * `scene:noteUpdate` per pin). Walls and lights have their own ops, tokens go through the
 * embedded `doc:update` the drag already uses.
 */
export function buildRecalibrationOps(
  sceneId: string,
  plan: GridRecalibrationPlan,
): RecalibrationOp[] {
  const ops: RecalibrationOp[] = [];
  if (plan.tokens.length > 0) {
    ops.push({
      type: "doc:update",
      payload: {
        documentType: "Token",
        updates: plan.tokens.map((t) => ({
          _id: t._id,
          diff: { x: t.x, y: t.y },
          embedded: { type: "Token", id: sceneId },
        })),
      },
    });
  }
  if (plan.walls.length > 0) {
    ops.push({
      type: "wall:update",
      payload: {
        documentType: "Wall",
        updates: plan.walls.map((w) => ({
          _id: w._id,
          diff: { a: w.a, b: w.b },
          embedded: { type: "Wall", id: sceneId },
        })),
      },
    });
  }
  if (plan.lights.length > 0) {
    ops.push({
      type: "light:update",
      payload: {
        documentType: "Light",
        updates: plan.lights.map((l) => ({
          _id: l._id,
          diff: { x: l.x, y: l.y },
          embedded: { type: "Light", id: sceneId },
        })),
      },
    });
  }
  for (const note of plan.notes) {
    ops.push({
      type: "scene:noteUpdate",
      payload: { sceneId, noteId: note.id, patch: { x: note.x, y: note.y } },
    });
  }
  return ops;
}

/** What the planner reads off a Scene document (pins are parsed: the schema keeps them loose). */
export function recalibrationSceneOf(scene: SceneDocument): RecalibrationScene {
  return {
    width: scene.width,
    height: scene.height,
    padding: scene.padding,
    grid: scene.grid,
    gridOffsetX: scene.gridOffsetX,
    gridOffsetY: scene.gridOffsetY,
    tokens: scene.tokens,
    walls: scene.walls,
    notes: parseMapNotes(scene.notes),
    lights: scene.lights,
  };
}
