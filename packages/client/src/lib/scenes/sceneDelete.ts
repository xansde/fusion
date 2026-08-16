/**
 * sceneDelete.ts — what the delete confirmation of a scene says (spec 44 §5.7).
 *
 * Pure: no socket, no DOM, no window manager. It lives apart from
 * `sceneWindows.ts` because the confirmation COMPONENT needs it and
 * `sceneWindows.ts` imports that component — putting the rule here is what keeps
 * the two from importing each other.
 *
 * Two requirements:
 *  - REQ-CEN-063: the confirmation names what the deletion takes with it and what it
 *    leaves alone. The presences, walls, lights, sounds and drawings are EMBEDDED in
 *    the scene's own document (DEC-PER-02), so they go with it; the actors are their
 *    own documents and stay.
 *  - REQ-CEN-064: the scene ON AIR is refused, with the reason and the way out. The
 *    refusal is a projection of the pointer — it is never a flag someone sets.
 */

import type { SceneDocument } from "@fusion/shared";

/** Everything the delete confirmation says. */
export const SCENE_DELETE_KEYS = {
  question: "FUSION.Scene.Delete.Confirm",
  cascadeTitle: "FUSION.Scene.Delete.CascadeTitle",
  presences: "FUSION.Scene.Delete.CascadePresences",
  walls: "FUSION.Scene.Delete.CascadeWalls",
  lights: "FUSION.Scene.Delete.CascadeLights",
  sounds: "FUSION.Scene.Delete.CascadeSounds",
  drawings: "FUSION.Scene.Delete.CascadeDrawings",
  kept: "FUSION.Scene.Delete.Kept",
  blockedReason: "FUSION.Scene.Delete.BlockedReason",
  blockedPath: "FUSION.Scene.Delete.BlockedPath",
} as const;

/**
 * The embedded collections a Scene owns, in the order REQ-CEN-063 names them.
 */
export const SCENE_DELETE_CASCADE_KEYS: readonly string[] = [
  SCENE_DELETE_KEYS.presences,
  SCENE_DELETE_KEYS.walls,
  SCENE_DELETE_KEYS.lights,
  SCENE_DELETE_KEYS.sounds,
  SCENE_DELETE_KEYS.drawings,
];

export interface SceneDeleteVM {
  sceneId: string;
  name: string;
  /** True while this scene is the one on air — the delete is refused (REQ-CEN-064). */
  blocked: boolean;
  /** Why it is refused (null when it is not). */
  reasonKey: string | null;
  /** How to get out of the refusal (null when it is not refused). */
  pathKey: string | null;
  questionKey: string;
  cascadeTitleKey: string;
  /** What the deletion takes with it, named one by one (REQ-CEN-063). */
  cascadeKeys: readonly string[];
  /** What it does NOT take: the actors (REQ-CEN-063). */
  keptKey: string;
}

export interface SceneDeleteInput {
  scene: Pick<SceneDocument, "_id" | "name">;
  activeSceneId: string | null;
}

export function buildSceneDeleteVM(input: SceneDeleteInput): SceneDeleteVM {
  const blocked = input.activeSceneId !== null && input.activeSceneId === input.scene._id;
  return {
    sceneId: input.scene._id,
    name: input.scene.name,
    blocked,
    reasonKey: blocked ? SCENE_DELETE_KEYS.blockedReason : null,
    pathKey: blocked ? SCENE_DELETE_KEYS.blockedPath : null,
    questionKey: SCENE_DELETE_KEYS.question,
    cascadeTitleKey: SCENE_DELETE_KEYS.cascadeTitle,
    cascadeKeys: SCENE_DELETE_CASCADE_KEYS,
    keptKey: SCENE_DELETE_KEYS.kept,
  };
}
