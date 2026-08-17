/**
 * sceneEnvironment.ts — the three environment shortcuts on the head of the Cenas tab
 * (spec 44, §5.3; DEC-CEN-06).
 *
 * Mid-session the table asks for three things and nothing else: "apaga a luz", "liga a
 * névoa", "eles voltaram, reseta". Those are the only environment gestures the head
 * carries (REQ-CEN-020/021/022); adjusting VALUES — darkness level, GI threshold, token
 * vision — stays in the perception window (REQ-CEN-062).
 *
 * Deliberate boundaries:
 *  - **the tab defines no semantics** (REQ-CEN-025). Darkness is `07`'s REQ-VIS-044, the
 *    fog flag is REQ-VIS-085 and the reset is REQ-VIS-086/087. Each gesture writes
 *    exactly its own field, or delegates to the `fog:reset` op — this module never
 *    computes lighting, vision or exploration;
 *  - **no optimistic state** (REQ-CEN-023). What a control shows is a pure projection of
 *    the document the server pushed; a local "pressed" flag would survive a refused write
 *    and a change made by another GM, and the head would lie about the table;
 *  - **only the scene on air** (REQ-CEN-024). With nothing on air — or with the scene not
 *    yet received by this client — there is no VM at all, so there is nothing to draw.
 *
 * The one thing kept in client memory is the darkness value a scene was configured with
 * BEFORE the GM zeroed it (see {@link DarknessMemory}): the document only stores the
 * current level, so "back to the configured value" (REQ-CEN-020) needs somewhere to come
 * from. It is memory of a gesture, never a second source of truth for what is on air.
 *
 * **Current UI reachability (2026-08-17, Alexandre's r1 test item 25 — decision, not a
 * bug):** the head no longer draws any of the three gestures. `toggleSceneDarkness` and
 * `toggleSceneFog` are still reachable through the perception window (REQ-CEN-062,
 * opened from a scene's configuration window); `resetSceneFog` has NO UI door at all —
 * the perception window only ever writes the value fields via `doc:update` and has never
 * called `fog:reset`. See `specs/44-aba-cenas.md` Q-CEN-07 for the open question and the
 * emended notes under DEC-CEN-06 and REQ-CEN-025. This module's own logic is unaffected;
 * only who calls it changed.
 */

import type { Socket } from "socket.io-client";
import type { SceneDocument } from "@fusion/shared";
import { OpError, sendOp } from "../docs/sendOp.js";
import { t } from "../i18n/i18n.js";

// ---------------------------------------------------------------------------
// i18n keys
// ---------------------------------------------------------------------------

export const SCENE_ENV_KEYS = {
  /** Group label of the three controls. */
  group: "FUSION.Scene.Env.Group",
  darkness: "FUSION.Scene.Env.Darkness",
  darknessOn: "FUSION.Scene.Env.DarknessOn",
  darknessOff: "FUSION.Scene.Env.DarknessOff",
  fog: "FUSION.Scene.Env.Fog",
  fogOn: "FUSION.Scene.Env.FogOn",
  fogOff: "FUSION.Scene.Env.FogOff",
  fogReset: "FUSION.Scene.Env.FogReset",
  fogResetConfirm: "FUSION.Scene.Env.FogResetConfirm",
  fogResetConfirmLabel: "FUSION.Scene.Env.FogResetConfirmLabel",
  failed: "FUSION.Scene.Env.Failed",
} as const;

/**
 * The darkness applied when the scene has no configured level to go back to
 * (REQ-CEN-020). "Apaga a luz" with nothing remembered means the room goes dark, not
 * "nothing happens" — and the exact level is then tuned in the perception window.
 */
export const DEFAULT_DARKNESS = 1;

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

/** The three gestures the head carries (REQ-CEN-020, REQ-CEN-021, REQ-CEN-022). */
export type SceneEnvironmentGestureId = "darkness" | "fog" | "fogReset";

/** One of the two toggles (REQ-CEN-020, REQ-CEN-021). */
export interface SceneEnvironmentToggleVM {
  readonly id: "darkness" | "fog";
  /** Static name of the thing being toggled — used as the visible group label. */
  readonly labelKey: string;
  /** What activating it will DO, given the current state (label of the gesture). */
  readonly actionKey: string;
  /**
   * Whether the environment is currently ON, straight from the document
   * (REQ-CEN-023). Never a local flag.
   */
  readonly pressed: boolean;
}

/** The reset (REQ-CEN-022) — an action, not a state, and irreversible. */
export interface SceneEnvironmentResetVM {
  readonly id: "fogReset";
  readonly actionKey: string;
  /** Message shown before doing it, because there is no undo. */
  readonly confirmKey: string;
  /** Label of the confirming button. */
  readonly confirmLabelKey: string;
}

export interface SceneEnvironmentVM {
  /** The scene these controls address — always the one on air (REQ-CEN-024). */
  readonly sceneId: string;
  readonly groupKey: string;
  readonly darkness: SceneEnvironmentToggleVM;
  readonly fog: SceneEnvironmentToggleVM;
  readonly fogReset: SceneEnvironmentResetVM;
}

export interface SceneEnvironmentInput {
  readonly scenes: readonly SceneDocument[];
  readonly activeSceneId: string | null;
}

/**
 * Project the environment controls of the head.
 *
 * Returns `null` whenever there is no scene on air to act upon — nothing on air, or a
 * pointer this client has not yet received a body for (REQ-CEN-024). Callers draw
 * nothing in that case; the environment of any OTHER scene is the perception window's
 * business (REQ-CEN-062).
 */
export function buildSceneEnvironmentVM(input: SceneEnvironmentInput): SceneEnvironmentVM | null {
  const { scenes, activeSceneId } = input;
  if (activeSceneId === null || activeSceneId === "") return null;

  const scene = scenes.find((candidate) => candidate._id === activeSceneId);
  if (scene === undefined) return null;

  const dark = darknessOf(scene) > 0;
  const fog = scene.fogEnabled;

  return {
    sceneId: scene._id,
    groupKey: SCENE_ENV_KEYS.group,
    darkness: {
      id: "darkness",
      labelKey: SCENE_ENV_KEYS.darkness,
      actionKey: dark ? SCENE_ENV_KEYS.darknessOff : SCENE_ENV_KEYS.darknessOn,
      pressed: dark,
    },
    fog: {
      id: "fog",
      labelKey: SCENE_ENV_KEYS.fog,
      actionKey: fog ? SCENE_ENV_KEYS.fogOff : SCENE_ENV_KEYS.fogOn,
      pressed: fog,
    },
    fogReset: {
      id: "fogReset",
      actionKey: SCENE_ENV_KEYS.fogReset,
      confirmKey: SCENE_ENV_KEYS.fogResetConfirm,
      confirmLabelKey: SCENE_ENV_KEYS.fogResetConfirmLabel,
    },
  };
}

// ---------------------------------------------------------------------------
// Darkness memory
// ---------------------------------------------------------------------------

/**
 * Remembers, per scene, the darkness level that was in force when the GM zeroed it.
 *
 * REQ-CEN-020 asks the toggle to swing between "the configured value" and "no darkness
 * at all", and the document only ever holds the CURRENT level — so writing 0 would erase
 * the value to come back to. This is per-session client memory of a gesture: it never
 * decides what the head shows (that is always the document, REQ-CEN-023) and it is not
 * persisted, so a reload simply falls back to {@link DEFAULT_DARKNESS}.
 */
export interface DarknessMemory {
  get(sceneId: string): number | null;
  set(sceneId: string, darkness: number): void;
}

export function createDarknessMemory(): DarknessMemory {
  const values = new Map<string, number>();
  return {
    get(sceneId) {
      return values.get(sceneId) ?? null;
    },
    set(sceneId, darkness) {
      values.set(sceneId, darkness);
    },
  };
}

/**
 * The next darkness level for the toggle, and the value worth remembering.
 *
 * Pure — the decision of REQ-CEN-020 with no socket and no storage in sight.
 */
export function nextDarkness(
  current: number,
  remembered: number | null,
): { readonly next: number; readonly remember: number | null } {
  if (current > 0) return { next: 0, remember: current };
  return { next: remembered ?? DEFAULT_DARKNESS, remember: null };
}

// ---------------------------------------------------------------------------
// The gestures
// ---------------------------------------------------------------------------

function darknessOf(scene: SceneDocument): number {
  const value = scene.darkness;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The wire shape of a one-field write on a Scene (`doc:update`). */
function sceneFieldUpdate(
  sceneId: string,
  diff: Record<string, unknown>,
): Parameters<typeof sendOp>[1] {
  return {
    type: "doc:update",
    payload: {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff }],
    },
  };
}

/**
 * Toggle the darkness of the scene on air between its configured value and none
 * (REQ-CEN-020 → REQ-VIS-044).
 *
 * Writes `darkness` and nothing else: global illumination, its threshold and token
 * vision belong to the perception window and to spec 07 (REQ-CEN-025).
 */
export async function toggleSceneDarkness(
  socket: Socket,
  scene: SceneDocument,
  memory: DarknessMemory,
): Promise<void> {
  const { next, remember } = nextDarkness(darknessOf(scene), memory.get(scene._id));
  if (remember !== null) memory.set(scene._id, remember);
  await sendOp(socket, sceneFieldUpdate(scene._id, { darkness: next }));
}

/**
 * Toggle the fog flag of the scene on air (REQ-CEN-021 → REQ-VIS-085).
 *
 * Writes `fogEnabled` and nothing else — the token-vision policy is a separate field
 * with its own meaning, and this tab does not decide it (REQ-CEN-025).
 */
export async function toggleSceneFog(socket: Socket, scene: SceneDocument): Promise<void> {
  await sendOp(socket, sceneFieldUpdate(scene._id, { fogEnabled: !scene.fogEnabled }));
}

/**
 * Reset the fog of the scene on air for every user (REQ-CEN-022 → REQ-VIS-086/087).
 *
 * Irreversible, so it goes through `confirm` first; a refusal sends absolutely nothing.
 * The clearing itself is the server's `fog:reset` op — this tab does not touch stored
 * exploration or any client cache (REQ-CEN-025).
 *
 * @returns whether the reset was actually requested.
 */
export async function resetSceneFog(
  socket: Socket,
  sceneId: string,
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  const confirmed = await confirm();
  if (!confirmed) return false;
  await sendOp(socket, { type: "fog:reset", payload: { sceneId, target: "all" } });
  return true;
}

// ---------------------------------------------------------------------------
// Running one gesture at a time (REQ-CEN-023)
// ---------------------------------------------------------------------------

/**
 * What the runner reports to whoever draws the controls.
 *
 * Deliberately NOT a piece of state of its own: the runner never says what the
 * environment IS (that is always the document, REQ-CEN-023) — it only says whether a
 * write is on the wire, so the caller can disable the row instead of painting a state
 * the server has not confirmed.
 */
export interface SceneEnvironmentGestureSink {
  /** The gesture that went on the wire, or `null` when the wire is free again. */
  setBusy(gesture: SceneEnvironmentGestureId | null): void;
  /** The message of a refused write, or `null` when a new gesture starts. */
  setError(message: string | null): void;
}

/**
 * What a refused environment write becomes on the head (REQ-CEN-023).
 *
 * The server's own words when it said why, a generic failure otherwise — a MESSAGE, never
 * a state: the controls go on reading the document, which the refusal did not change.
 */
export function describeEnvironmentError(err: unknown): string {
  return err instanceof OpError ? err.message : t(SCENE_ENV_KEYS.failed);
}

export interface SceneEnvironmentGestureRunner {
  /** Runs `work` unless another gesture is still in flight. */
  run(gesture: SceneEnvironmentGestureId, work: () => Promise<unknown>): Promise<void>;
}

/**
 * Serialize the environment gestures of the head (REQ-CEN-023).
 *
 * While a write is in flight the controls keep showing the document — the row is merely
 * disabled — and a second gesture is dropped instead of racing the first. A refused write
 * turns into a message and leaves the wire free; it never leaves a "pressed" flag behind,
 * because there is none to leave.
 */
export function createSceneEnvironmentGestureRunner(
  sink: SceneEnvironmentGestureSink,
  describeError: (err: unknown) => string,
): SceneEnvironmentGestureRunner {
  let busy: SceneEnvironmentGestureId | null = null;
  return {
    async run(gesture, work) {
      if (busy !== null) return;
      busy = gesture;
      sink.setBusy(gesture);
      sink.setError(null);
      try {
        await work();
      } catch (err) {
        sink.setError(describeError(err));
      } finally {
        busy = null;
        sink.setBusy(null);
      }
    },
  };
}
