/**
 * ScenesTabWindows.test.ts — the scene dialogs, as the panel and the windows
 * draw them (plan G085, spec 44 §5.7).
 *
 * The RULE — which window opens, one per what, and what the delete confirmation says
 * — is asserted in `lib/scenes/__tests__/sceneWindows.test.ts`, against the real
 * `windowManager`. What only markup can answer is here: that the panel OFFERS the three
 * verbs and mounts no form of its own inside a 300px drawer, that no dialog paints a
 * frame of its own any more (the window owns it), and that the configuration form really
 * carries REQ-CEN-061's six fields, and that the confirmation prints the cascade and
 * the refusal.
 *
 * DEC-SEP-05 (F2, 2026-08-23): a fourth dialog used to live here too — perception
 * (REQ-CEN-062, `ScenePerceptionDialog`). It was removed along with the rest of the
 * fog/vision pipeline — see `docs/design/separacao-repos/design.md` — so every
 * assertion about it (and the door into it from the configuration window) is gone
 * too, not adapted.
 *
 * The client's Vitest runs in a node environment (no DOM), so what a click DOES is
 * never asserted from the markup: the openers are named module functions
 * (`lib/scenes/sceneWindows.ts`) and the refusal is a named module function
 * (`lib/scenes/sceneDelete.ts`), both exercised as functions. What is asserted from the
 * markup is only that the control exists, by its accessible name.
 *
 * Covers REQ-CEN-060, REQ-CEN-061, REQ-CEN-063, REQ-CEN-064, REQ-CEN-067.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SceneDocument } from "@fusion/shared";

import ScenesTab from "../ScenesTab.svelte";
import SceneCreateDialog from "../SceneCreateDialog.svelte";
import SceneDeleteConfirm from "../SceneDeleteConfirm.svelte";
import { sceneListState } from "../../../lib/scenes/scenesState.svelte.js";
import { activeSceneState } from "../../../lib/docs/activeScene.svelte.js";
import {
  SCENE_DELETE_KEYS,
  buildSceneDeleteVM,
  requestSceneDelete,
} from "../../../lib/scenes/sceneDelete.js";
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

/**
 * The `<style>` block of a component. Throws rather than falling back to `""` — a
 * fallback there would let the block go missing (or the regex stop matching) while
 * every `not.toMatch` assertion built on top of it kept passing on empty string
 * (see `ScenesTab.test.ts`'s `styleOfScenesTab` for the same convention).
 */
function styleOf(file: string): string {
  const style = /<style>([\s\S]*)<\/style>/.exec(sourceOf(file))?.[1];
  if (style === undefined) throw new Error(`${file} has no <style> block`);
  return style;
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
  it("REQ-CEN-060/061/063: the panel offers the three verbs, each one named", () => {
    const html = renderTab(ON_AIR._id);

    // The scene on air lives in the head, so the archive below holds the other scene
    // — and it is that line that carries the per-scene verbs.
    expect(html).toContain(t("FUSION.Sidebar.Scenes.Create"));
    expect(html).toContain(`${t("FUSION.Scene.Dialog.EditScene")} ${OTHER.name}`);
    expect(html).toContain(`${t("FUSION.Scene.Dialog.DeleteScene")} ${OTHER.name}`);
  });

  it("REQ-CEN-061: none of the dialogs is drawn inside the drawer", () => {
    const html = renderTab(ON_AIR._id);

    // What each verb opens is a window of the manager (asserted against the real
    // `windowManager` in `lib/scenes/__tests__/sceneWindows.test.ts`); the panel itself
    // draws no form, because a form does not fit in 300px and the drawer never widens
    // (DEC-GAV-04, REQ-GAV-012). None of the dialog bodies is in this markup:
    expect(html).not.toContain(t("FUSION.Scene.Dialog.GridSize"));
    expect(html).not.toContain(t(SCENE_DELETE_KEYS.cascadeTitle));
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
  for (const file of ["SceneCreateDialog.svelte", "SceneDeleteConfirm.svelte"]) {
    it(`REQ-CEN-060/061/063: ${file} has no backdrop, no <dialog> and no close of its own`, () => {
      const source = sourceOf(file);

      // A second window system beside `lib/windows/window-manager.ts` is exactly what
      // this task removed: the frame belongs to `Window.svelte` (REQ-UIF-009..013).
      expect(source).not.toContain("<dialog");
      expect(source).not.toContain("dialog-backdrop");
      expect(source).not.toContain("dialog__close");
      expect(source).not.toContain("&#x2715;");
    });
  }
});

// ---------------------------------------------------------------------------
// Configuration: the six fields REQ-CEN-061 names
// ---------------------------------------------------------------------------

describe("SceneCreateDialog — configuring a scene (REQ-CEN-061)", () => {
  function renderForm(mode: "create" | "edit"): string {
    return render(SceneCreateDialog, {
      props: {
        mode,
        scene: mode === "edit" ? OTHER : null,
        socket: {} as never,
        onClose: () => {},
        onSuccess: () => {},
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
});

// ---------------------------------------------------------------------------
// The head's OTHER door — into configuration — restored (Ajustes r1 review, 2026-08-17)
// ---------------------------------------------------------------------------

describe("ScenesTab head — the configuration door (REQ-CEN-061, Ajustes r1 review)", () => {
  it("REQ-CEN-061: the scene on air has a reachable door into configuration", () => {
    // REQ-CEN-036: the archive never repeats the scene ON AIR — so without a door in
    // the head itself, that scene had NO way to reach `openSceneConfigWindow`. This
    // button is that door.
    const html = renderTab(ON_AIR._id);

    expect(html).toContain("scene-head__config");
    expect(html).toContain(`aria-label="${t("FUSION.Scene.Dialog.EditScene")} ${ON_AIR.name}"`);
  });

  it("REQ-CEN-014: with nothing on air there is no scene to configure, and no door", () => {
    const html = renderTab(null);

    expect(html).not.toContain("scene-head__config");
  });

  it("REQ-CEN-013: the door is out of flow and cannot grow the fixed head", () => {
    const style = styleOf("ScenesTab.svelte");
    const rule = /\.scene-head__config\s*\{([^}]*)\}/.exec(style)?.[1] ?? "";

    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).not.toMatch(/height:\s*\d/);
  });

  it("does not reintroduce the retired direct perception door or the environment group", () => {
    // The button opens `openSceneConfigWindow`; item 25's retirement of the head's
    // REQ-CEN-020..025 environment shortcuts stays in force, and DEC-SEP-05 (F2)
    // removed the perception door and its window kind entirely — neither can come
    // back through this button.
    const html = renderTab(ON_AIR._id);

    expect(html).not.toContain("scene-head__perception");
    expect(html).not.toContain("scene-head__env");
  });

  it("the head's stylesheet carries no rule for the retired perception door", () => {
    const style = styleOf("ScenesTab.svelte");

    // Anchor the negative: prove the block that WOULD have carried the retired rule
    // is actually there, so the assertion below can't pass by matching nothing.
    expect(style).toMatch(/\.scene-head\s*\{/);
    expect(style).not.toMatch(/\.scene-head__perception\s*\{/);
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

  it("REQ-CEN-064: the refused delete never reaches the wire", async () => {
    // The send is spied in place of the socket: what proves the requirement is that
    // nothing was written, not how the guard is spelled.
    const sent: string[] = [];
    const send = (sceneId: string): Promise<void> => {
      sent.push(sceneId);
      return Promise.resolve();
    };

    const refused = await requestSceneDelete({
      vm: buildSceneDeleteVM({ scene: ON_AIR, activeSceneId: ON_AIR._id }),
      send,
    });

    expect(refused).toBe(false);
    expect(sent).toEqual([]);

    // And any other scene does reach it, with its own id — otherwise the test above
    // would pass with a delete that never works at all.
    const deleted = await requestSceneDelete({
      vm: buildSceneDeleteVM({ scene: OTHER, activeSceneId: ON_AIR._id }),
      send,
    });

    expect(deleted).toBe(true);
    expect(sent).toEqual([OTHER._id]);
  });
});
