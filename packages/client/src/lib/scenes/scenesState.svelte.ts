/**
 * scenesState.svelte.ts — Svelte 5 reactive store for the world's scene list.
 *
 * Holds ONE thing: the live list of SceneDocuments sourced from worldMirror. It is
 * world data, not UI state — the Cenas tab renders it, but so could anything else.
 *
 * What used to live here and does not anymore (plan G017): the drawer's `open` and
 * `activeTab`. They were parked in this module by accident of history, back when the
 * only sidebar was the scenes one. The drawer of spec 36 owns them now, persisted per
 * world+user in `lib/sidebar/preferences.ts` and driven by `lib/sidebar/drawerState`
 * — and the only collapse gesture is the rail's active tab (REQ-GAV-011/014).
 */

import type { SceneDocument } from "@fusion/shared";
import { worldMirror } from "../docs/worldSync.js";
import { listScenes } from "./sceneController.js";
import type { SceneShelfFolder } from "./sceneShelf.js";

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

export const sceneListState: {
  /** Live list of scenes from the mirror, sorted by name. */
  scenes: SceneDocument[];
  /**
   * Live list of `Folder` documents, for the archive's grouping (REQ-CEN-030).
   *
   * They are world data like the scenes and travel in the same snapshot; the archive
   * needs them to name a group with the folder's name instead of its id.
   */
  folders: SceneShelfFolder[];
} = $state({
  scenes: [],
  folders: [],
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function refreshSceneList(): void {
  sceneListState.scenes = listScenes(worldMirror);
}

export function refreshFolderList(): void {
  sceneListState.folders = worldMirror.getByType<SceneShelfFolder>("Folder");
}

// ---------------------------------------------------------------------------
// Mirror subscription
// ---------------------------------------------------------------------------

/**
 * Attach mirror subscription for Scene type changes.
 * Returns a cleanup function.
 * Called once from the root app after worldSync is active.
 */
export function attachSceneListSync(): () => void {
  // Prime both lists immediately
  refreshSceneList();
  refreshFolderList();
  const unsubscribeScenes = worldMirror.subscribe<SceneDocument>("Scene", () => {
    refreshSceneList();
  });
  const unsubscribeFolders = worldMirror.subscribe<SceneShelfFolder>("Folder", () => {
    refreshFolderList();
  });
  return () => {
    unsubscribeScenes();
    unsubscribeFolders();
  };
}
