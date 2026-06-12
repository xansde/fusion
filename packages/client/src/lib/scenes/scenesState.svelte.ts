/**
 * scenesState.svelte.ts — Svelte 5 reactive store for the scenes sidebar.
 *
 * Holds:
 *   - The live list of SceneDocuments (sourced from worldMirror).
 *   - Sidebar open/collapsed state.
 *   - Active tab key (extensible for future sidebar tabs).
 *
 * The sidebar is only rendered for GMs (role 4). This module is UI-agnostic;
 * gating is done in the component.
 */

import type { SceneDocument } from "@fusion/shared";
import { worldMirror } from "../docs/worldSync.js";
import { listScenes } from "./sceneController.js";

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

export const sidebarState: {
  /** Whether the sidebar panel is open. */
  open: boolean;
  /** Current active tab. */
  activeTab: "scenes";
  /** Live list of scenes from the mirror, sorted by name. */
  scenes: SceneDocument[];
} = $state({
  open: true,
  activeTab: "scenes",
  scenes: [],
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function toggleSidebar(): void {
  sidebarState.open = !sidebarState.open;
}

export function openSidebar(): void {
  sidebarState.open = true;
}

export function refreshSceneList(): void {
  sidebarState.scenes = listScenes(worldMirror);
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
  // Prime the list immediately
  refreshSceneList();
  return worldMirror.subscribe<SceneDocument>("Scene", () => {
    refreshSceneList();
  });
}
