/**
 * tileController.ts — the GM's operations on the images a scene is made of.
 *
 * Pure TS, no Svelte, no PIXI — safe for Vitest.
 *
 * A scene is rarely one picture: the room before and after, the trapdoor that
 * opens mid-fight, the floor below. Each is a tile the GM adds once and then
 * shows or hides. `hidden` is the "when it appears" control, and the server
 * strips hidden tiles from every player payload — so revealing one is a real
 * reveal, not a client-side blindfold.
 *
 * All four operations are GM-only, enforced server-side (GM_ONLY_EMBEDDED in
 * doc-handlers). These functions build the ops; they do not re-check the role,
 * because a client-side check is a UI affordance, never a permission.
 */

import type { Socket } from "socket.io-client";
import type { SceneDocument, TileDocument } from "@fusion/shared";
import { sendOp } from "../docs/sendOp.js";

/** What the GM fills in when adding an image to the scene. */
export interface TileFormData {
  name: string;
  texture: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Add an image to the scene.
 *
 * The `_id` is generated server-side (embedded documents always are), so none
 * is sent here.
 */
export async function addTile(
  socket: Socket,
  sceneId: string,
  data: TileFormData,
  sort: number,
): Promise<void> {
  await sendOp(socket, {
    type: "doc:create",
    payload: {
      documentType: "Tile",
      data: [
        {
          name: data.name.trim(),
          texture: data.texture.trim() || null,
          x: data.x,
          y: data.y,
          width: data.width,
          height: data.height,
          // New images start hidden: the GM adds the "after" picture while the
          // party is still looking at the "before" one, and an image that
          // appeared the instant it was uploaded would spoil exactly the
          // reveal it was prepared for.
          hidden: true,
          sort,
        },
      ],
      parent: { type: "Scene", id: sceneId },
    },
  });
}

/** Show or hide one image — the "when it appears" control. */
export async function setTileHidden(
  socket: Socket,
  sceneId: string,
  tileId: string,
  hidden: boolean,
): Promise<void> {
  await updateTile(socket, sceneId, tileId, { hidden });
}

/** Patch any subset of a tile's fields. */
export async function updateTile(
  socket: Socket,
  sceneId: string,
  tileId: string,
  diff: Partial<Record<keyof TileDocument, unknown>>,
): Promise<void> {
  await sendOp(socket, {
    type: "doc:update",
    payload: {
      documentType: "Tile",
      updates: [{ _id: tileId, diff, embedded: { type: "Tile", id: sceneId } }],
    },
  });
}

/** Remove an image from the scene for good. */
export async function deleteTile(socket: Socket, sceneId: string, tileId: string): Promise<void> {
  await sendOp(socket, {
    type: "doc:delete",
    payload: {
      documentType: "Tile",
      ids: [tileId],
      parent: { type: "Scene", id: sceneId },
    },
  });
}

/**
 * Move an image one step up or down the stack.
 *
 * Swaps `sort` with the neighbour rather than renumbering the whole list: two
 * writes instead of N, and the other tiles keep the numbers they had.
 */
export async function reorderTile(
  socket: Socket,
  sceneId: string,
  tiles: readonly TileDocument[],
  tileId: string,
  direction: "up" | "down",
): Promise<void> {
  const ordered = sortTiles(tiles);
  const index = ordered.findIndex((t) => t._id === tileId);
  if (index < 0) return;

  const neighbourIndex = direction === "up" ? index + 1 : index - 1;
  const tile = ordered[index];
  const neighbour = ordered[neighbourIndex];
  if (!tile || !neighbour) return;

  // Equal sort values would make the swap a no-op; nudge past instead.
  const [tileSort, neighbourSort] =
    tile.sort === neighbour.sort
      ? direction === "up"
        ? [neighbour.sort + 1, neighbour.sort]
        : [neighbour.sort - 1, neighbour.sort]
      : [neighbour.sort, tile.sort];

  await updateTile(socket, sceneId, tile._id, { sort: tileSort });
  await updateTile(socket, sceneId, neighbour._id, { sort: neighbourSort });
}

/**
 * The scene's tiles in draw order — bottom first, matching what the canvas
 * does with `zIndex`. Ties break by id so the list never reshuffles under the
 * GM between renders.
 */
export function sortTiles(tiles: readonly TileDocument[]): TileDocument[] {
  return [...tiles].sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
}

/** Read a scene's tiles defensively — scenes predating tiles have no array. */
export function tilesOf(scene: SceneDocument | null | undefined): TileDocument[] {
  if (!scene) return [];
  const raw = (scene as { tiles?: unknown }).tiles;
  return Array.isArray(raw) ? (raw as TileDocument[]) : [];
}

/** The `sort` a newly added image should take to land on top of the stack. */
export function nextTileSort(tiles: readonly TileDocument[]): number {
  if (tiles.length === 0) return 0;
  return Math.max(...tiles.map((t) => t.sort)) + 1;
}

/**
 * The rectangle the scene's background occupies, in scene coordinates.
 *
 * Scene coordinates do NOT start at (0,0): `sceneLoader` places the background
 * sprite at (padX, padY), the padding border that surrounds the map. An image
 * meant to sit ON the map therefore starts at the padding, not at the origin —
 * placing it at (0,0) puts it exactly one padding up and to the left, which is
 * what the first version of this feature did (250px off on a 1000×1000 scene
 * with the default 0.25 padding).
 *
 * This is the sensible default for a new image and the target of "align to
 * map", so both callers derive it from here rather than recomputing it.
 */
export function defaultTileRect(scene: { width: number; height: number; padding?: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  // Scenes persisted before `padding` existed have none; sceneLoader falls
  // back the same way by reading a missing padding as 0.
  const padding = typeof scene.padding === "number" ? scene.padding : 0;
  return {
    x: Math.round(scene.width * padding),
    y: Math.round(scene.height * padding),
    width: scene.width,
    height: scene.height,
  };
}

/** Snap one image back onto the scene's background rectangle. */
export async function alignTileToMap(
  socket: Socket,
  scene: SceneDocument,
  tileId: string,
): Promise<void> {
  await updateTile(socket, scene._id, tileId, defaultTileRect(scene));
}
