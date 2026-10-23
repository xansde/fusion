/**
 * wallOps.ts — the ops the wall tool sends, in the shapes the server implements.
 *
 * Walls are an embedded collection of the Scene. The server has dedicated ops for them
 * (`wall:create`, `wall:delete`, `scene:doorState` — net/handlers/vision-handlers.ts);
 * the generic `doc:update` has no `$push`/`$pull` operator (documents/merge.ts only
 * knows object-merge and array-replace), so a `{ walls: { $push: wall } }` diff replaced
 * the whole `walls` array with a plain object and nothing was ever saved (#83). Same
 * lesson as tokens: see `lib/docs/tokenCreateOp.ts`.
 */

import type { DoorState } from "@fusion/shared";

/** The fields a new wall carries. The server assigns the `_id`. */
export type NewWallFields = Record<string, unknown>;

export interface WallCreateOp {
  readonly type: "wall:create";
  readonly payload: {
    readonly documentType: "Wall";
    readonly data: readonly NewWallFields[];
    readonly parent: { readonly type: "Scene"; readonly id: string };
  };
}

export interface WallDeleteOp {
  readonly type: "wall:delete";
  readonly payload: {
    readonly documentType: "Wall";
    readonly ids: readonly string[];
    readonly parent: { readonly type: "Scene"; readonly id: string };
  };
}

export interface DoorStateOp {
  readonly type: "scene:doorState";
  readonly payload: {
    readonly sceneId: string;
    readonly wallId: string;
    readonly state: DoorState;
  };
}

/** Create one wall on a scene. */
export function buildWallCreateOp(sceneId: string, wall: NewWallFields): WallCreateOp {
  return {
    type: "wall:create",
    payload: { documentType: "Wall", data: [wall], parent: { type: "Scene", id: sceneId } },
  };
}

/** Delete walls from a scene. */
export function buildWallDeleteOp(sceneId: string, ids: readonly string[]): WallDeleteOp {
  return {
    type: "wall:delete",
    payload: { documentType: "Wall", ids: [...ids], parent: { type: "Scene", id: sceneId } },
  };
}

/** Open, close, lock or unlock a door. */
export function buildDoorStateOp(sceneId: string, wallId: string, state: DoorState): DoorStateOp {
  return { type: "scene:doorState", payload: { sceneId, wallId, state } };
}
