/**
 * ScenesTabPrepare.test.ts — the prepare as the tab and the canvas draw it (plan G084).
 *
 * The rule of what a prepare IS lives in `lib/scenes/__tests__/prepareState.test.ts`.
 * What only the markup can answer is asserted here: that every archive line offers the
 * gesture, that the prepared line is distinguished by something other than colour, and
 * that the canvas notice names the scene ON AIR and carries both ways out.
 *
 * The client's Vitest runs in a node environment (no DOM), so the assertions are on
 * server-rendered markup and on the components' own source — the technique
 * `ScenesTabHead.test.ts` established.
 *
 * Covers REQ-CEN-050, REQ-CEN-051, REQ-CEN-052, REQ-CEN-053, REQ-CEN-056, RNF-CEN-03.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SceneDocument } from "@fusion/shared";

import ScenesTab from "../ScenesTab.svelte";
import ScenePrepareNotice from "../ScenePrepareNotice.svelte";
import { sceneListState } from "../../../lib/scenes/scenesState.svelte.js";
import {
  buildScenePrepareNoticeVM,
  scenePrepareState,
} from "../../../lib/scenes/prepareState.svelte.js";
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

/** The archive block alone — everything below the head. */
function archiveOf(html: string): string {
  const start = html.indexOf('class="scenes-tab__body');
  return start === -1 ? "" : html.slice(start);
}

beforeEach(() => {
  sceneListState.scenes = [ON_AIR, OTHER];
  sceneListState.folders = [];
  scenePrepareState.sceneId = null;
});

describe("ScenesTab — opening a scene in prepare (REQ-CEN-050, REQ-CEN-056)", () => {
  it("REQ-CEN-050: every archive line offers the prepare gesture, named for that scene", () => {
    const archive = archiveOf(renderTab(ON_AIR._id));

    expect(archive).toContain("action-btn--prepare");
    expect(archive).toContain(`${t(SCENE_SHELF_KEYS.prepare)}: Cripta`);
  });

  it("REQ-CEN-056: the prepared line is distinguished by shape and by a written mark, not by colour alone", () => {
    scenePrepareState.sceneId = OTHER._id;
    const archive = archiveOf(renderTab(ON_AIR._id));

    // Written: the "Em preparo" chip sits in the same meta line as the dimensions.
    expect(archive).toContain(t("FUSION.Scene.Prepare.Mark"));
    // Structural: a modifier class and an aria-current a screen reader can announce.
    expect(archive).toContain("scene-row--preparing");
    expect(archive).toContain('aria-current="true"');
    // Pressed: the same control now offers to LEAVE the prepare (REQ-CEN-053).
    expect(archive).toContain(`${t(SCENE_SHELF_KEYS.prepareExit)}: Cripta`);
  });

  it("REQ-CEN-056: with no prepare no line is marked", () => {
    const archive = archiveOf(renderTab(ON_AIR._id));

    expect(archive).not.toContain("scene-row--preparing");
    expect(archive).not.toContain(t("FUSION.Scene.Prepare.Mark"));
  });

  it("RNF-CEN-03: the tab's prepare gesture goes through the socket-free API", () => {
    const source = sourceOf("ScenesTab.svelte");

    // `togglePrepare` may only reach for enter/exit — both of which have no socket in
    // their signature. A future edit that routes the prepare through `sendOp`, a
    // `doc:update` or `world:activeScene` fails right here.
    const toggle = /function togglePrepare[\s\S]*?\n  }/.exec(source)?.[0] ?? "";
    expect(toggle).toContain("exitScenePrepare()");
    expect(toggle).toContain("enterScenePrepare(");
    expect(toggle).not.toMatch(/sendOp|socket|doc:update|world:activeScene/);
  });
});

describe("ScenePrepareNotice — the persistent canvas warning (REQ-CEN-052)", () => {
  function renderNotice(activeSceneId: string | null): string {
    const notice = buildScenePrepareNoticeVM({
      scenes: sceneListState.scenes,
      activeSceneId,
      prepareSceneId: OTHER._id,
    });
    expect(notice).not.toBeNull();
    return render(ScenePrepareNotice, { props: { notice: notice!, socket: null } }).body;
  }

  it("REQ-CEN-052: the notice names the scene on air and offers both ways out", () => {
    const html = renderNotice(ON_AIR._id);

    expect(html).toContain(t("FUSION.Scene.Prepare.Title", { name: "Cripta" }));
    expect(html).toContain(t("FUSION.Scene.Prepare.OnAir", { name: "Taverna" }));
    expect(html).toContain(t("FUSION.Scene.Prepare.PutOnAir"));
    expect(html).toContain(t("FUSION.Scene.Prepare.Exit"));
  });

  it("REQ-CEN-052: with nothing on air it says the table is on the waiting screen", () => {
    const html = renderNotice(null);

    expect(html).toContain(t("FUSION.Scene.Prepare.OnAirEmpty"));
    expect(html).not.toContain("Taverna");
  });

  it("REQ-CEN-052: it is persistent — no timer, no dismiss, no auto-hide", () => {
    const source = sourceOf("ScenePrepareNotice.svelte");

    expect(source).not.toMatch(/setTimeout|setInterval|autoDismiss|autohide/i);
    // The only two controls are the two the requirement names.
    expect(source.match(/<button/g)).toHaveLength(2);
  });

  it("REQ-CEN-052/053: both ways out are dressed by this component, not left as bare buttons", () => {
    const html = renderNotice(ON_AIR._id);

    // Svelte scopes CSS per component and stamps the scope class only on elements some
    // selector in THIS file matches. So the scope class on a <button> is the proof that
    // the button has a rule — a `.btn` markup class with no `.btn` rule here (there is no
    // global one) would render the two only exits of a prepare as bare browser buttons.
    const scope = /class="scene-prepare (svelte-[a-z0-9]+)"/.exec(html)?.[1];
    expect(scope).toBeDefined();

    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toContain(scope);
    }
  });

  it("REQ-CEN-053 / RNF-CEN-03: leaving the prepare is the socket-free call", () => {
    const source = sourceOf("ScenePrepareNotice.svelte");

    // The exit button is wired straight to `exitScenePrepare`, which takes no socket;
    // only the "put on air" path is allowed to touch one (REQ-CEN-044).
    expect(source).toContain("onclick={exitScenePrepare}");
    expect(source.match(/putPreparedSceneOnAir\(/g)).toHaveLength(1);
  });
});

describe("TableScreen — which scene this canvas draws (REQ-CEN-050, REQ-CEN-053)", () => {
  function tableScreenSource(): string {
    return readFileSync(
      fileURLToPath(new URL("../../TableScreen.svelte", import.meta.url)),
      "utf8",
    );
  }

  it("REQ-CEN-050: the canvas loads the resolved scene, not the active one directly", () => {
    const source = tableScreenSource();

    expect(source).toContain("resolveCanvasScene(");
    // The load effect must go through the resolution — reading `activeSceneState.scene`
    // there again would make a prepare invisible on the canvas.
    expect(source).toContain("const scene = canvasScene;");
    expect(source).toContain("loadSceneDocument(canvas, scene)");
  });

  it("REQ-CEN-054/055: the canvas owner reconciles the prepare against the world", () => {
    const source = tableScreenSource();

    expect(source).toContain("reconcileScenePrepare({");
    expect(source).toContain("activeSceneId: activeSceneState.id");
  });

  it("REQ-CEN-052: the notice is mounted on the canvas, only while a prepare lasts", () => {
    const source = tableScreenSource();

    expect(source).toContain("{#if prepareNotice}");
    expect(source).toContain("<ScenePrepareNotice notice={prepareNotice}");
  });
});
