/**
 * prepareState.svelte.ts — "preparar" is local to the Master (spec 44, §5.6; DEC-CEN-03).
 *
 * The Cenas tab has two different gestures over a scene and they must never be confused:
 *
 *  - **pôr no ar** is global. It writes the world's single source of truth and changes
 *    what every client renders (DEC-CEN-02, REQ-CEN-040/041) — it lives in
 *    `sceneController.activateScene`;
 *  - **preparar** is local. It changes what THIS Master's canvas renders, and nothing
 *    else: the scene on air does not move, no client is told, and nothing is written to
 *    the server (REQ-CEN-050/051, RNF-CEN-03).
 *
 * That is why the whole module has exactly one function that takes a `Socket`, and it is
 * the one that stops preparing by putting the prepared scene on air (REQ-CEN-044).
 * Entering and leaving the prepare have no socket in their signature at all — the
 * requirement "entering and leaving emits no write" is a fact of the type, not a promise
 * of a comment.
 *
 * Two ways a prepare ends without the Master asking, both of them silent (REQ-CEN-054,
 * REQ-CEN-055): the prepared scene going on air from any origin, and the prepared scene
 * being deleted. Neither is an error — the canvas simply goes back to the scene on air.
 * `reconcileScenePrepare` is that rule, kept as a plain function so the one `$effect`
 * that owns the canvas can call it.
 *
 * The `.svelte.ts` extension is required, not decorative: `$state` is a compiler rune
 * (same reason as `lib/sidebar/badges.svelte.ts`). Importers use `./prepareState.svelte.js`.
 */

import type { Socket } from "socket.io-client";
import type { SceneDocument } from "@fusion/shared";
import { activeSceneState } from "../docs/activeScene.svelte.js";
import type { SidebarBadgeStore } from "../sidebar/registry.js";
import { activateScene } from "./sceneController.js";
import type { SceneHeadLine } from "./scenesTabVM.js";

// ---------------------------------------------------------------------------
// i18n keys
// ---------------------------------------------------------------------------

export const SCENE_PREPARE_KEYS = {
  /** Accessible name of the persistent canvas notice (REQ-CEN-052). */
  notice: "FUSION.Scene.Prepare.Notice",
  /** "You are preparing <scene>" — the title line of the notice. */
  title: "FUSION.Scene.Prepare.Title",
  /** "The table is watching <scene>" — the scene ON AIR, named (REQ-CEN-052). */
  onAir: "FUSION.Scene.Prepare.OnAir",
  /** Same line when nothing is on air: the players are on the waiting screen. */
  onAirEmpty: "FUSION.Scene.Prepare.OnAirEmpty",
  /** The action that ends the prepare by making it the table's scene (REQ-CEN-044). */
  putOnAir: "FUSION.Scene.Prepare.PutOnAir",
  /** The action that ends the prepare and goes back to the scene on air (REQ-CEN-053). */
  exit: "FUSION.Scene.Prepare.Exit",
  /** Verb of the archive line that starts a prepare (REQ-CEN-050). */
  start: "FUSION.Scene.Prepare.Start",
  /** Written mark of the prepared line in the archive (REQ-CEN-056). */
  mark: "FUSION.Scene.Prepare.Mark",
  /** A refused "pôr no ar" from the notice (REQ-CEN-045). */
  failed: "FUSION.Scene.Prepare.Failed",
} as const;

// ---------------------------------------------------------------------------
// Reactive state — this client, this Master, this session
// ---------------------------------------------------------------------------

/**
 * The scene this Master is preparing, or `null`.
 *
 * In memory and nowhere else (spec 44 §7): not a document, not a setting, not a device
 * preference. It dies with the tab, which is the correct lifetime for "I am looking at
 * something the table is not".
 */
export const scenePrepareState: { sceneId: string | null } = $state({ sceneId: null });

/**
 * Open a scene in prepare (REQ-CEN-050).
 *
 * Asking to prepare the scene that is already on air is not a prepare — there would be
 * nothing to distinguish and nothing to go back to — so it clears instead (REQ-CEN-053).
 */
export function enterScenePrepare(sceneId: string, activeSceneId: string | null): void {
  scenePrepareState.sceneId = sceneId === activeSceneId || sceneId === "" ? null : sceneId;
}

/** Leave the prepare (REQ-CEN-053). No socket, by design (RNF-CEN-03). */
export function exitScenePrepare(): void {
  scenePrepareState.sceneId = null;
}

/** Whether this scene is the one being prepared (REQ-CEN-056). */
export function isScenePreparing(sceneId: string): boolean {
  return scenePrepareState.sceneId === sceneId;
}

export interface ScenePrepareReconcileInput {
  /** Id of the scene on air, from the world's single source (DEC-CEN-02). */
  readonly activeSceneId: string | null;
  /** Ids the world mirror currently holds for `Scene`. */
  readonly sceneIds: readonly string[];
}

/**
 * End a prepare that no longer means anything (REQ-CEN-054, REQ-CEN-055).
 *
 * Called by whoever owns the canvas whenever the world changes. Silent on purpose: the
 * Master did not do anything wrong by preparing a scene that someone else then put on
 * air, and a scene that was deleted has no error to report — the canvas just goes back
 * to the scene on air.
 *
 * @returns `true` when a prepare was ended, so a caller can tell "nothing changed" from
 * "the prepare is over" without reading the store twice.
 */
export function reconcileScenePrepare(input: ScenePrepareReconcileInput): boolean {
  const prepared = scenePrepareState.sceneId;
  if (prepared === null) return false;

  // REQ-CEN-054: it went on air (by this Master or by another) — the prepare is over.
  if (prepared === input.activeSceneId) {
    scenePrepareState.sceneId = null;
    return true;
  }

  // REQ-CEN-055: it does not exist anymore.
  if (!input.sceneIds.includes(prepared)) {
    scenePrepareState.sceneId = null;
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// The tab's badge (REQ-CEN-003..005)
// ---------------------------------------------------------------------------

/**
 * The Cenas tab's state dot (REQ-CEN-003): a boolean, never a count.
 *
 * Lit exactly while there is a prepare that differs from the scene on air (REQ-CEN-004),
 * which is the condition in which a Master forgets he is not looking at the table's
 * scene. It reads the two stores and nothing else — opening, closing or switching the
 * tab cannot move it (REQ-CEN-005), because the drawer is not one of its inputs.
 */
export const scenePrepareBadge: SidebarBadgeStore = {
  get value(): boolean {
    const prepared = scenePrepareState.sceneId;
    return prepared !== null && prepared !== activeSceneState.id;
  },
};

// ---------------------------------------------------------------------------
// What the canvas renders (REQ-CEN-050, REQ-CEN-053)
// ---------------------------------------------------------------------------

export interface CanvasSceneInput {
  /** The scene on air, as the world says it is. */
  readonly activeScene: SceneDocument | null;
  /** Every scene this client mirrors. */
  readonly scenes: readonly SceneDocument[];
  /** The scene being prepared, or `null`. */
  readonly prepareSceneId: string | null;
}

/**
 * Which scene THIS client draws (REQ-CEN-050, REQ-CEN-053).
 *
 * Pure, and deliberately the only place that answers the question: the scene on air is
 * still `activeSceneState.scene` for everybody else, and this function never touches it.
 * A prepared id the mirror cannot resolve falls back to the scene on air rather than
 * blanking the canvas — the deletion case (REQ-CEN-055) reconciles a moment later.
 */
export function resolveCanvasScene(input: CanvasSceneInput): SceneDocument | null {
  const { prepareSceneId } = input;
  if (prepareSceneId === null) return input.activeScene;
  const prepared = input.scenes.find((scene) => scene._id === prepareSceneId);
  return prepared ?? input.activeScene;
}

// ---------------------------------------------------------------------------
// The persistent canvas notice (REQ-CEN-052)
// ---------------------------------------------------------------------------

export interface ScenePrepareNoticeVM {
  readonly preparedSceneId: string;
  /** Untruncated name of the scene being prepared — truncation is layout. */
  readonly preparedName: string;
  /** Name of the scene on air, or `null` when nothing is on air. */
  readonly onAirName: string | null;
  readonly title: SceneHeadLine;
  /** What the table is watching right now — named, which is the point (REQ-CEN-052). */
  readonly onAir: SceneHeadLine;
  readonly putOnAirKey: string;
  readonly exitKey: string;
  readonly labelKey: string;
}

export interface ScenePrepareNoticeInput {
  readonly scenes: readonly SceneDocument[];
  readonly activeSceneId: string | null;
  readonly prepareSceneId: string | null;
}

/**
 * Project the notice the canvas keeps on screen while a prepare lasts (REQ-CEN-052).
 *
 * `null` means "draw nothing": no prepare, a prepare equal to the scene on air, or a
 * prepared scene this client cannot resolve — all three are states in which the Master is
 * looking at exactly what the table is looking at, so a warning would be a lie.
 */
export function buildScenePrepareNoticeVM(
  input: ScenePrepareNoticeInput,
): ScenePrepareNoticeVM | null {
  const { prepareSceneId, activeSceneId } = input;
  if (prepareSceneId === null || prepareSceneId === activeSceneId) return null;

  const prepared = input.scenes.find((scene) => scene._id === prepareSceneId);
  if (prepared === undefined) return null;

  const onAir = input.scenes.find((scene) => scene._id === activeSceneId) ?? null;

  return {
    preparedSceneId: prepared._id,
    preparedName: prepared.name,
    onAirName: onAir?.name ?? null,
    title: { key: SCENE_PREPARE_KEYS.title, vars: { name: prepared.name } },
    onAir:
      onAir === null
        ? { key: SCENE_PREPARE_KEYS.onAirEmpty }
        : { key: SCENE_PREPARE_KEYS.onAir, vars: { name: onAir.name } },
    putOnAirKey: SCENE_PREPARE_KEYS.putOnAir,
    exitKey: SCENE_PREPARE_KEYS.exit,
    labelKey: SCENE_PREPARE_KEYS.notice,
  };
}

// ---------------------------------------------------------------------------
// The one gesture that does write (REQ-CEN-040, REQ-CEN-044)
// ---------------------------------------------------------------------------

/**
 * Put the prepared scene on air from the notice (REQ-CEN-040) and end the prepare
 * (REQ-CEN-044).
 *
 * The write is the same single-writer op the archive line uses — this module adds no
 * second path to the world's active scene (DEC-CEN-02). The prepare is only cleared
 * AFTER the server accepts: a refused activation must not leave the canvas silently
 * back on a scene the Master did not choose (REQ-CEN-045).
 */
export async function putPreparedSceneOnAir(socket: Socket, sceneId: string): Promise<void> {
  await activateScene(socket, sceneId);
  if (scenePrepareState.sceneId === sceneId) scenePrepareState.sceneId = null;
}
