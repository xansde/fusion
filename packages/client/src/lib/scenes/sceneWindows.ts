/**
 * sceneWindows.ts — the scene dialogs as WINDOWS of the window manager
 * (spec 44 §5.7, DEC-CEN-09).
 *
 * The drawer is 300px wide and never widens (REQ-GAV-012, DEC-GAV-04), so anything
 * with a form in it opens OUTSIDE the drawer. Until this module existed the dialogs
 * that already existed in `components/scenes/` were mounted inline by the
 * tab as their own `<dialog>` + backdrop — a second, private window system living
 * next to `lib/windows/window-manager.ts` (REQ-UIF-009). This module is the wiring
 * the plan asked for: the same components, opened as real windows.
 *
 * Three windows, three singleton keys (REQ-UIF-014 — asking twice focuses the one
 * that is already open instead of stacking a duplicate):
 *   - create  (REQ-CEN-060)  one per world, no scene attached yet;
 *   - config  (REQ-CEN-061)  one per scene;
 *   - delete  (REQ-CEN-063)  one per scene.
 *
 * DEC-SEP-05 (F2, 2026-08-23): a fourth window used to live here — perception
 * (REQ-CEN-062, `ScenePerceptionDialog`), the UI that tuned darkness/fog/global
 * light/token vision on a Scene. It was removed along with the rest of the
 * fog/vision pipeline (`docs/design/separacao-repos/design.md`); the fields it
 * used to write (`darkness`, `fogEnabled`, `globalLight`, `globalLightThreshold`,
 * `tokenVision`) stay on the Scene schema, inert, for the eventual rebuild.
 *
 * What the delete confirmation SAYS (REQ-CEN-063/064) is a pure rule and lives in
 * `sceneDelete.ts`, so the confirmation component can read it without importing this
 * module back.
 */

import type { Socket } from "socket.io-client";
import type { SceneDocument } from "@fusion/shared";

import { windowManager } from "../windows/window-manager.js";
import { t } from "../i18n/i18n.js";
import SceneCreateDialog from "../../components/scenes/SceneCreateDialog.svelte";
import SceneDeleteConfirm from "../../components/scenes/SceneDeleteConfirm.svelte";

// ---------------------------------------------------------------------------
// i18n keys
// ---------------------------------------------------------------------------

/** Window titles. */
export const SCENE_WINDOW_KEYS = {
  create: "FUSION.Scene.Window.Create",
  config: "FUSION.Scene.Window.Config",
  delete: "FUSION.Scene.Window.Delete",
} as const;

// ---------------------------------------------------------------------------
// Singleton keys
// ---------------------------------------------------------------------------

export type SceneWindowKind = "create" | "config" | "delete";

/**
 * The key that makes a second request focus the open window instead of opening a
 * twin (REQ-UIF-014). Creation has no scene, so it is one window per world; the
 * other three are one window per scene.
 */
export function sceneWindowKey(kind: SceneWindowKind, sceneId?: string | null): string {
  if (kind === "create") return "scene:create";
  return `scene:${kind}:${sceneId ?? ""}`;
}

/** Default geometry per window kind — a form, not a sheet. */
const SIZES: Readonly<Record<SceneWindowKind, { width: number; height: number }>> = {
  create: { width: 460, height: 520 },
  config: { width: 460, height: 560 },
  delete: { width: 420, height: 380 },
};

// ---------------------------------------------------------------------------
// Opening and closing
// ---------------------------------------------------------------------------

/** Close the window carrying this singleton key, if it is open. */
export function closeSceneWindow(kind: SceneWindowKind, sceneId?: string | null): void {
  const key = sceneWindowKey(kind, sceneId);
  for (const entry of windowManager.windows.values()) {
    if (entry.singletonKey === key) {
      windowManager.close(entry.id);
      return;
    }
  }
}

/** True while a window of this kind is open — used by the tests and by nothing else. */
export function isSceneWindowOpen(kind: SceneWindowKind, sceneId?: string | null): boolean {
  const key = sceneWindowKey(kind, sceneId);
  for (const entry of windowManager.windows.values()) {
    if (entry.singletonKey === key) return true;
  }
  return false;
}

/**
 * REQ-CEN-060: creating a scene opens a floating window.
 *
 * REQ-CEN-065 lives here by omission and on purpose: nothing in this path activates
 * the new scene. The dialog calls `createScene`, which writes `active: false`, and
 * putting a scene on air stays the separate gesture it is (DEC-CEN-02).
 */
export function openSceneCreateWindow(socket: Socket): void {
  const close = (): void => {
    closeSceneWindow("create");
  };
  windowManager.open({
    singletonKey: sceneWindowKey("create"),
    title: t(SCENE_WINDOW_KEYS.create),
    position: SIZES.create,
    component: SceneCreateDialog,
    componentProps: { mode: "create", socket, onClose: close, onSuccess: close },
  });
}

/** REQ-CEN-061: name, folder, dimensions, fill, grid and background, in a window. */
export function openSceneConfigWindow(socket: Socket, scene: SceneDocument): void {
  const close = (): void => {
    closeSceneWindow("config", scene._id);
  };
  windowManager.open({
    singletonKey: sceneWindowKey("config", scene._id),
    title: t(SCENE_WINDOW_KEYS.config, { name: scene.name }),
    position: SIZES.config,
    component: SceneCreateDialog,
    componentProps: {
      mode: "edit",
      scene,
      socket,
      onClose: close,
      onSuccess: close,
    },
  });
}

/** REQ-CEN-063/064: the confirmation that names the cascade — and the refusal. */
export function openSceneDeleteWindow(socket: Socket, scene: SceneDocument): void {
  const close = (): void => {
    closeSceneWindow("delete", scene._id);
  };
  windowManager.open({
    singletonKey: sceneWindowKey("delete", scene._id),
    title: t(SCENE_WINDOW_KEYS.delete, { name: scene.name }),
    position: SIZES.delete,
    component: SceneDeleteConfirm,
    componentProps: { scene, socket, onClose: close, onSuccess: close },
  });
}
