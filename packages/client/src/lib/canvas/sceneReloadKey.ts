/**
 * sceneReloadKey.ts — when does the canvas actually need to reload a scene?
 *
 * Tokens, walls, lights and doors are EMBEDDED in the Scene document. Every
 * time one of them changes, the mirror hands out a fresh SceneDocument object,
 * and any reactive effect that depends on "the scene" re-runs.
 *
 * That is fine for the orchestrator, which subscribes to those changes and
 * updates the affected sprites. It is ruinous for the scene LOADER: reloading
 * means destroying the background sprite, awaiting Assets.load() again and
 * refitting the camera. Dragging one token across the map fired a full reload
 * per position update, so the map blinked out for as long as each reload took
 * — found live on 2026-08-07, right after token dragging started working.
 *
 * This function reduces a SceneDocument to only what loadSceneDocument()
 * actually consumes. Same key ⇒ nothing to reload, no matter how many tokens
 * moved.
 *
 * `tokenVision`/`fogEnabled` are the exception to "only what the loader
 * reads": loadSceneDocument() itself ignores them, but TableScreen's
 * _createOrchestrator() reads them once, at orchestrator-creation time, to
 * decide whether a FogState exists at all (REQ-VIS-085). The orchestrator is
 * only rebuilt when this key changes, so without these two fields here, the
 * GM flipping either flag live (ScenePerceptionDialog → doc:update) would
 * have no effect until some unrelated reload happened to fire.
 */

import type { SceneDocument } from "@fusion/shared";

/**
 * Build a comparison key for a scene's render-relevant fields.
 *
 * Returns null when there is no active scene.
 *
 * Deliberately excludes every embedded collection — tokens, walls, lights,
 * sounds, tiles, drawings, templates, notes — because none of them is read by
 * loadSceneDocument(); they are driven by SceneOrchestrator instead.
 */
export function sceneReloadKey(scene: SceneDocument | null | undefined): string | null {
  if (!scene) return null;

  // `grid` can be runtime-absent on scenes persisted before it existed (r7.1),
  // hence the defensive read rather than a direct property access. Same for
  // `tokenVision`/`fogEnabled` on scenes persisted before REQ-VIS-085.
  const grid = (scene as { grid?: unknown }).grid ?? null;
  const tokenVision = (scene as { tokenVision?: boolean }).tokenVision ?? false;
  const fogEnabled = (scene as { fogEnabled?: boolean }).fogEnabled ?? false;

  return JSON.stringify([
    scene._id,
    scene.width,
    scene.height,
    scene.padding,
    scene.background,
    scene.backgroundColor,
    scene.initialView,
    grid,
    // Calibrating the grid changes only these two numbers; without them here
    // the canvas would keep drawing the old alignment until something else
    // happened to change.
    scene.gridOffsetX ?? null,
    scene.gridOffsetY ?? null,
    tokenVision,
    fogEnabled,
  ]);
}
