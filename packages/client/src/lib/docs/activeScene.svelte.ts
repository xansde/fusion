/**
 * activeScene.svelte.ts — Svelte 5 runes store for the active scene.
 *
 * Spec: 06-canvas-e-renderizacao.md (scene config / activation)
 * REQ-NET-005: broadcast world:activeScene when GM activates a scene.
 *
 * Responsibilities:
 *   - Track the _id of the currently active scene (from world:activeScene broadcast).
 *   - Derive the full SceneDocument from DocumentMirror whenever activeSceneId or
 *     the Scene collection changes.
 *   - Expose a reactive `activeScene` (SceneDocument | null) for the canvas.
 *
 * Usage:
 *   import { activeSceneState, setActiveSceneId, syncActiveSceneFromMirror }
 *     from "$lib/docs/activeScene.svelte.js";
 *
 *   // In Svelte component:
 *   $effect(() => {
 *     const scene = activeSceneState.scene;
 *     if (scene) canvas.loadScene(scene);
 *   });
 */

import type { SceneDocument } from "@fusion/shared";
import type { DocumentMirror } from "./DocumentMirror.js";

// ---------------------------------------------------------------------------
// Reactive state (Svelte 5 $state rune)
// ---------------------------------------------------------------------------

export const activeSceneState: {
  /** The _id of the currently active scene, or null. */
  id: string | null;
  /** The full SceneDocument, derived from the mirror. Null when no scene is active. */
  scene: SceneDocument | null;
} = $state({
  id: null,
  scene: null,
});

// ---------------------------------------------------------------------------
// Mutators (plain TS functions, called from socket event handlers)
// ---------------------------------------------------------------------------

/**
 * Called when a world:activeScene broadcast arrives.
 * Updates the active scene id and re-derives the document.
 */
export function setActiveSceneId(sceneId: string | null, mirror: DocumentMirror): void {
  activeSceneState.id = sceneId;
  _resync(mirror);
}

/**
 * Re-derive the active SceneDocument from the mirror.
 * Call this whenever the Scene collection changes (doc:create/update/delete).
 */
export function syncActiveSceneFromMirror(mirror: DocumentMirror): void {
  _resync(mirror);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _resync(mirror: DocumentMirror): void {
  const id = activeSceneState.id;
  if (!id) {
    activeSceneState.scene = null;
    return;
  }
  const doc = mirror.getDoc<SceneDocument>("Scene", id);
  activeSceneState.scene = doc ?? null;
}
