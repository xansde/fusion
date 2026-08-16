/**
 * ScenesTabWindows.test.ts — the four scene dialogs, as the panel and the windows
 * draw them (plan G085, spec 44 §5.7).
 *
 * The RULE — which window opens, one per what, and what the delete confirmation says
 * — is asserted in `lib/scenes/__tests__/sceneWindows.test.ts`. What only markup can
 * answer is here: that the panel's verbs reach the openers instead of mounting a modal
 * inside a 300px drawer, that no dialog paints a frame of its own any more (the window
 * owns it), that the configuration form really carries REQ-CEN-061's six fields, and
 * that the confirmation prints the cascade and the refusal.
 *
 * The client's Vitest runs in a node environment (no DOM), so the assertions are on
 * server-rendered markup and on the components' own source — the technique
 * `ScenesTabHead.test.ts` established.
 *
 * Covers REQ-CEN-060, REQ-CEN-061, REQ-CEN-062, REQ-CEN-063, REQ-CEN-064, REQ-CEN-067.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SceneDocument } from "@fusion/shared";

import ScenesTab from "../ScenesTab.svelte";
import SceneCreateDialog from "../SceneCreateDialog.svelte";
import SceneDeleteConfirm from "../SceneDeleteConfirm.svelte";
import ScenePerceptionDialog from "../ScenePerceptionDialog.svelte";
import { sceneListState } from "../../../lib/scenes/scenesState.svelte.js";
import { activeSceneState } from "../../../lib/docs/activeScene.svelte.js";
import { SCENE_WINDOW_KEYS } from "../../../lib/scenes/sceneWindows.js";
import { SCENE_DELETE_KEYS } from "../../../lib/scenes/sceneDelete.js";
import { SCENE_SHELF_KEYS } from "../../../lib/scenes/sceneShelf.js";
import "../../../lib/i18n/index.js";
import { t } from "../../../lib/i18n/i18n.js";

function makeScene(overrides: Partial<SceneDocument> & { _id: string }): SceneDocument {
  return {
    type: "Scene",
    name: "Cena",
    width: 4000,
    height: 3000,
    grid: { type: "square", size: 100 },
    background: null,
    backgroundColor: "#101018",
    thumb: null,
    darkness: 0,
    fogEnabled: false,
    globalLight: true,
    globalLightThreshold: 0.5,
    tokenVision: false,
    folder: null,
    sort: 0,
    tokens: [],
    walls: [],
    ...overrides,
  } as unknown as SceneDocument;
}

const ON_AIR = makeScene({ _id: "s-air", name: "Taverna" });
const OTHER = makeScene({ _id: "s-crypt", name: "Cripta" });

function renderTab(activeSceneId: string | null): string {
  return render(ScenesTab, {
    props: {
      socket: {} as never,
      worldId: "world-1",
      userId: "user-1",
      isGm: true,
      activeSceneId,
    },
  }).body;
}

function sourceOf(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
}

beforeEach(() => {
  sceneListState.scenes = [ON_AIR, OTHER];
  sceneListState.folders = [];
  activeSceneState.id = null;
});

// ---------------------------------------------------------------------------
// The panel's verbs go to the window manager, not to a modal inside the drawer
// ---------------------------------------------------------------------------

describe("ScenesTab — the verbs open windows (REQ-CEN-060, REQ-CEN-061, REQ-CEN-063)", () => {
  it("REQ-CEN-060/061/063: create, configure and delete are wired to the window openers", () => {
    const source = sourceOf("ScenesTab.svelte");

    expect(source).toContain("openSceneCreateWindow(socket)");
    expect(source).toContain("openSceneConfigWindow(socket, scene)");
    expect(source).toContain("openSceneDeleteWindow(socket, scene)");
  });

  it("REQ-CEN-061: no dialog is mounted inside the drawer any more", () => {
    const source = sourceOf("ScenesTab.svelte");

    // The old inline mounting is gone, flags and all: a form does not fit in 300px
    // and the drawer never widens (DEC-GAV-04, REQ-GAV-012).
    expect(source).not.toContain("<SceneCreateDialog");
    expect(source).not.toContain("<SceneDeleteConfirm");
    expect(source).not.toMatch(/showCreateDialog|editTarget|deleteTarget/);
  });

  it("REQ-CEN-060: the panel still offers creating a scene", () => {
    const html = renderTab(ON_AIR._id);

    expect(html).toContain(t("FUSION.Sidebar.Scenes.Create"));
  });

  it("REQ-CEN-067: the panel header carries no close control and no width control", () => {
    const html = renderTab(ON_AIR._id);

    // No ✕ of any shape (the `×` of "4200 × 2800 px" is typography, not a control)...
    expect(html).not.toMatch(/[✕✖⨯🗙]/);
    // ...and nothing that resizes the drawer from inside it.
    expect(html).not.toMatch(/resize|drag-handle|width-control/i);
    expect(html).not.toMatch(/<input[^>]*type="range"/);
  });
});

// ---------------------------------------------------------------------------
// The dialogs no longer paint their own frame — the window does
// ---------------------------------------------------------------------------

describe("the dialogs became window bodies (DEC-CEN-09)", () => {
  for (const file of [
    "SceneCreateDialog.svelte",
    "ScenePerceptionDialog.svelte",
    "SceneDeleteConfirm.svelte",
  ]) {
    it(`REQ-CEN-060/061/062/063: ${file} has no backdrop, no <dialog> and no close of its own`, () => {
      const source = sourceOf(file);

      // A second window system beside `lib/windows/window-manager.ts` is exactly what
      // this task removed: the frame belongs to `Window.svelte` (REQ-UIF-009..013).
      expect(source).not.toContain("<dialog");
      expect(source).not.toContain("dialog-backdrop");
      expect(source).not.toContain("dialog__close");
      expect(source).not.toContain("&#x2715;");
    });
  }

  it("REQ-CEN-062: the perception window is real UI, in the table's language", () => {
    const html = render(ScenePerceptionDialog, {
      props: { scene: ON_AIR, socket: {} as never, onClose: () => {}, onSuccess: () => {} },
    }).body;

    expect(html).toContain(t("FUSION.Scene.Perception.Darkness", { percent: 0 }));
    expect(html).toContain(t("FUSION.Scene.Perception.GlobalLight"));
    expect(html).toContain(t("FUSION.Scene.Perception.TokenVision"));
  });
});

// ---------------------------------------------------------------------------
// Configuration: the six fields REQ-CEN-061 names
// ---------------------------------------------------------------------------

describe("SceneCreateDialog — configuring a scene (REQ-CEN-061, REQ-CEN-062)", () => {
  function renderForm(mode: "create" | "edit", withPerception = false): string {
    return render(SceneCreateDialog, {
      props: {
        mode,
        scene: mode === "edit" ? OTHER : null,
        socket: {} as never,
        onClose: () => {},
        onSuccess: () => {},
        ...(withPerception ? { onOpenPerception: () => {} } : {}),
      },
    }).body;
  }

  it("REQ-CEN-061: the form carries name, folder, dimensions, fill, grid and background", () => {
    sceneListState.folders = [{ _id: "f-1", name: "Masmorras" }];

    const html = renderForm("edit");

    expect(html).toContain(t("FUSION.Scene.Dialog.Name"));
    expect(html).toContain(t("FUSION.Scene.Dialog.Folder"));
    expect(html).toContain(t("FUSION.Scene.Dialog.Width"));
    expect(html).toContain(t("FUSION.Scene.Dialog.Height"));
    expect(html).toContain(t("FUSION.Scene.Dialog.GridSize"));
    expect(html).toContain(t("FUSION.Scene.Dialog.Fill"));
    expect(html).toContain(t("FUSION.Scene.Dialog.Background"));
    // The folder is chosen from the world's folders, with the unfiled group as an option.
    expect(html).toContain("Masmorras");
    expect(html).toContain(t(SCENE_SHELF_KEYS.noFolder));
  });

  it("REQ-CEN-062: the configuration window offers the door to perception, and only when there is a scene", () => {
    expect(renderForm("edit", true)).toContain(t(SCENE_WINDOW_KEYS.openPerception));
    // A scene that does not exist yet has no perception to tune.
    expect(renderForm("create")).not.toContain(t(SCENE_WINDOW_KEYS.openPerception));
  });
});

// ---------------------------------------------------------------------------
// The head's second door into perception
// ---------------------------------------------------------------------------

describe("ScenesTab head — the perception door (REQ-CEN-062)", () => {
  it("REQ-CEN-062: the head of the scene on air opens the perception window", () => {
    const html = renderTab(ON_AIR._id);

    expect(html).toContain("scene-head__perception");
    expect(html).toContain(t(SCENE_WINDOW_KEYS.headPerception));
    expect(sourceOf("ScenesTab.svelte")).toContain("openScenePerceptionWindow(socket, scene)");
  });

  it("REQ-CEN-062: with nothing on air there is no scene to tune, and no door", () => {
    const html = renderTab(null);

    expect(html).not.toContain("scene-head__perception");
  });

  it("REQ-CEN-013: the door floats over the fixed head instead of growing it", () => {
    const style = /<style>([\s\S]*)<\/style>/.exec(sourceOf("ScenesTab.svelte"))?.[1] ?? "";
    const rule = /\.scene-head__perception\s*\{([^}]*)\}/.exec(style)?.[1] ?? "";

    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).not.toMatch(/height:\s*\d/);
  });
});

// ---------------------------------------------------------------------------
// Deleting: the cascade and the refusal
// ---------------------------------------------------------------------------

describe("SceneDeleteConfirm — what it says (REQ-CEN-063) and what it refuses (REQ-CEN-064)", () => {
  function renderConfirm(scene: SceneDocument): string {
    return render(SceneDeleteConfirm, {
      props: { scene, socket: {} as never, onClose: () => {}, onSuccess: () => {} },
    }).body;
  }

  it("REQ-CEN-063: it names what falls with the scene, and that the actors do not", () => {
    activeSceneState.id = ON_AIR._id;

    const html = renderConfirm(OTHER);

    expect(html).toContain(t(SCENE_DELETE_KEYS.cascadeTitle));
    expect(html).toContain(t(SCENE_DELETE_KEYS.presences));
    expect(html).toContain(t(SCENE_DELETE_KEYS.walls));
    expect(html).toContain(t(SCENE_DELETE_KEYS.lights));
    expect(html).toContain(t(SCENE_DELETE_KEYS.sounds));
    expect(html).toContain(t(SCENE_DELETE_KEYS.drawings));
    expect(html).toContain(t(SCENE_DELETE_KEYS.kept));
    // And the destructive verb is offered, because this scene is not on air.
    expect(html).toContain(t("FUSION.Scene.Delete.Delete"));
  });

  it("REQ-CEN-064: the scene on air is refused, with the reason and the way out — and no delete button", () => {
    activeSceneState.id = ON_AIR._id;

    const html = renderConfirm(ON_AIR);

    expect(html).toContain(t(SCENE_DELETE_KEYS.blockedReason, { name: "Taverna" }));
    expect(html).toContain(t(SCENE_DELETE_KEYS.blockedPath));
    // The refusal is not a greyed control with no words: the verb is not offered at all.
    expect(html).not.toContain(t("FUSION.Scene.Delete.Delete"));
    // And the cascade is not the message of this moment.
    expect(html).not.toContain(t(SCENE_DELETE_KEYS.cascadeTitle));
  });

  it("REQ-CEN-064: the refused delete never reaches the wire", () => {
    const source = sourceOf("SceneDeleteConfirm.svelte");

    const handler = /async function handleDelete[\s\S]*?\n  }/.exec(source)?.[0] ?? "";
    expect(handler).toContain("if (vm.blocked");
    expect(handler).toMatch(/if \(vm\.blocked[^)]*\) return;/);
  });
});
