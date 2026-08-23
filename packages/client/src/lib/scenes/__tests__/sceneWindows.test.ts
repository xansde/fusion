/**
 * sceneWindows.test.ts — the scene dialogs as WINDOWS (plan G085, spec 44 §5.7).
 *
 * What is asserted here is the rule, not the pixels: that asking for a dialog produces
 * a window of the ONE window manager (REQ-UIF-009) instead of a private modal, that
 * asking twice focuses the one already open instead of stacking a twin (REQ-UIF-014),
 * and what the delete confirmation is obliged to SAY (REQ-CEN-063) and to REFUSE
 * (REQ-CEN-064).
 *
 * DEC-SEP-05 (F2, 2026-08-23): a fourth window used to live here too — perception
 * (REQ-CEN-062, `ScenePerceptionDialog`). It was removed along with the rest of the
 * fog/vision pipeline (`docs/design/separacao-repos/design.md`), and every assertion
 * about it below went with it.
 *
 * Covers REQ-CEN-060, REQ-CEN-061, REQ-CEN-063, REQ-CEN-064.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { SceneDocument } from "@fusion/shared";

import { windowManager } from "../../windows/window-manager.js";
import {
  openSceneConfigWindow,
  openSceneCreateWindow,
  openSceneDeleteWindow,
  closeSceneWindow,
  sceneWindowKey,
  SCENE_WINDOW_KEYS,
} from "../sceneWindows.js";
import { SCENE_DELETE_KEYS, buildSceneDeleteVM } from "../sceneDelete.js";
import { t } from "../../i18n/i18n.js";
import SceneCreateDialog from "../../../components/scenes/SceneCreateDialog.svelte";
import SceneDeleteConfirm from "../../../components/scenes/SceneDeleteConfirm.svelte";
import "../../i18n/index.js";

const socket = {} as never;

function makeScene(id: string, name: string): SceneDocument {
  return { _id: id, name, type: "Scene" } as unknown as SceneDocument;
}

const TAVERN = makeScene("s-air", "Taverna");
const CRYPT = makeScene("s-crypt", "Cripta");

/** The entries currently in the manager, in insertion order. */
function openWindows(): { singletonKey: string | undefined; title: string; component?: unknown }[] {
  return [...windowManager.windows.values()].map((entry) => ({
    singletonKey: entry.singletonKey,
    title: entry.title,
    component: entry.component,
  }));
}

function propsOf(key: string): Record<string, unknown> {
  for (const entry of windowManager.windows.values()) {
    if (entry.singletonKey === key) return entry.componentProps ?? {};
  }
  throw new Error(`No window open with key ${key}`);
}

beforeEach(() => {
  windowManager.closeAll();
});

describe("the four dialogs are windows of the window manager (DEC-CEN-09)", () => {
  it("REQ-CEN-060: creating a scene opens a floating window, and asking twice does not open a second", () => {
    openSceneCreateWindow(socket);
    openSceneCreateWindow(socket);

    const windows = openWindows();
    expect(windows).toHaveLength(1);
    expect(windows[0]?.singletonKey).toBe(sceneWindowKey("create"));
    expect(windows[0]?.component).toBe(SceneCreateDialog);
    // The create window is not about a scene, so its props carry no scene at all.
    expect(propsOf(sceneWindowKey("create"))["mode"]).toBe("create");
    expect(propsOf(sceneWindowKey("create"))["scene"]).toBeUndefined();
  });

  it("REQ-CEN-061: configuring opens a window per scene, carrying that scene", () => {
    openSceneConfigWindow(socket, TAVERN);
    openSceneConfigWindow(socket, TAVERN);
    openSceneConfigWindow(socket, CRYPT);

    // One per scene — the same scene asked twice focuses the open one (REQ-UIF-014).
    expect(openWindows()).toHaveLength(2);
    const props = propsOf(sceneWindowKey("config", TAVERN._id));
    expect(props["mode"]).toBe("edit");
    expect(props["scene"]).toBe(TAVERN);
  });

  it("REQ-CEN-063: deleting opens the confirmation as a window of its own", () => {
    openSceneDeleteWindow(socket, CRYPT);

    const windows = openWindows();
    expect(windows).toHaveLength(1);
    expect(windows[0]?.component).toBe(SceneDeleteConfirm);
    expect(windows[0]?.singletonKey).toBe(sceneWindowKey("delete", CRYPT._id));
  });

  it("REQ-CEN-060..063: each window closes itself through the manager, leaving no orphan", () => {
    openSceneCreateWindow(socket);
    openSceneConfigWindow(socket, TAVERN);
    openSceneDeleteWindow(socket, CRYPT);
    expect(openWindows()).toHaveLength(3);

    // The closer each dialog is handed is the manager's, so a cancelled form does not
    // leave a window nobody can see behind.
    (propsOf(sceneWindowKey("create"))["onClose"] as () => void)();
    (propsOf(sceneWindowKey("config", TAVERN._id))["onSuccess"] as () => void)();
    closeSceneWindow("delete", CRYPT._id);

    expect(openWindows()).toHaveLength(0);
  });

  it("REQ-CEN-060/061/063: the three kinds never collide on one key", () => {
    const keys = new Set([
      sceneWindowKey("create"),
      sceneWindowKey("config", TAVERN._id),
      sceneWindowKey("delete", TAVERN._id),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe("what the delete confirmation says and refuses", () => {
  it("REQ-CEN-063: it names everything the deletion takes with it, and what it does not", () => {
    const vm = buildSceneDeleteVM({ scene: CRYPT, activeSceneId: TAVERN._id });

    // The five embedded collections of a scene, each named (DEC-PER-02).
    expect(vm.cascadeKeys).toEqual([
      SCENE_DELETE_KEYS.presences,
      SCENE_DELETE_KEYS.walls,
      SCENE_DELETE_KEYS.lights,
      SCENE_DELETE_KEYS.sounds,
      SCENE_DELETE_KEYS.drawings,
    ]);
    // And the one thing that survives: the actors.
    expect(vm.keptKey).toBe(SCENE_DELETE_KEYS.kept);
  });

  it("REQ-CEN-064: the scene on air is refused, with the reason AND the way out", () => {
    const vm = buildSceneDeleteVM({ scene: TAVERN, activeSceneId: TAVERN._id });

    expect(vm.blocked).toBe(true);
    expect(vm.reasonKey).toBe(SCENE_DELETE_KEYS.blockedReason);
    expect(vm.pathKey).toBe(SCENE_DELETE_KEYS.blockedPath);
  });

  it("REQ-CEN-064: any other scene is not refused, and carries no reason to show", () => {
    expect(buildSceneDeleteVM({ scene: CRYPT, activeSceneId: TAVERN._id }).blocked).toBe(false);
    // Nothing on air refuses nothing.
    expect(buildSceneDeleteVM({ scene: CRYPT, activeSceneId: null }).blocked).toBe(false);
    expect(buildSceneDeleteVM({ scene: CRYPT, activeSceneId: null }).reasonKey).toBeNull();
    expect(buildSceneDeleteVM({ scene: CRYPT, activeSceneId: null }).pathKey).toBeNull();
  });
});

/**
 * Everything above compares KEYS, which is exactly the blind spot that let six texts of
 * this phase ship with a single-brace placeholder the resolver never substitutes: `t()`
 * only replaces `{{var}}` (`i18n.ts`, `_applyInterpolation`), so `{name}` reached the
 * screen literally. These assertions look at the RESOLVED string instead.
 */
describe("the texts these windows show are actually interpolated, not printed raw", () => {
  /** No placeholder of either shape may survive resolution. */
  function assertNoPlaceholderLeft(resolved: string): void {
    expect(resolved).not.toMatch(/\{\{?\w+\}?\}/);
  }

  it("REQ-CEN-061/063: each window title carries the scene's real name", () => {
    const titles = [
      t(SCENE_WINDOW_KEYS.config, { name: CRYPT.name }),
      t(SCENE_WINDOW_KEYS.delete, { name: CRYPT.name }),
    ];
    for (const title of titles) {
      expect(title).toContain("Cripta");
      assertNoPlaceholderLeft(title);
    }
  });

  it("REQ-CEN-064: the refusal names the scene that is on air", () => {
    const vm = buildSceneDeleteVM({ scene: TAVERN, activeSceneId: TAVERN._id });
    const reason = t(vm.reasonKey ?? "", { name: vm.name });

    expect(reason).toContain("Taverna");
    assertNoPlaceholderLeft(reason);
  });
});
