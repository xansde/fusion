/**
 * ScenesTabTokenAdd.test.ts — the door into `TokenAddDialog.svelte` (TK022-client).
 *
 * The e2e for token-fase1 found `TokenAddDialog.svelte` fully built (form, actor
 * search, validation — TK022-client, `tokenAddDialogVM.test.ts`) and fully unreachable:
 * `git grep` found no component anywhere in the tree that imported it outside of its
 * own file and its own test. This proves the head of the Cenas tab now offers a real
 * door to it — named, present only when there is a scene to drop a token onto, and
 * wired to the exact scene on air.
 *
 * The client's Vitest runs in a node environment (no DOM), so what the click DOES is
 * asserted from the source, the same technique `ScenesTabWindows.test.ts` uses for the
 * scene dialogs; what the button IS (present, named, gated on a scene existing) is
 * asserted from the server-rendered markup, like every other head control.
 *
 * Covers REQ-TOK-002, CA-TOK-003 (a piece with no actor is not reachable — but a piece
 * WITH one now has somewhere to be created from).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SceneDocument } from "@fusion/shared";

import ScenesTab from "../ScenesTab.svelte";
import { sceneListState } from "../../../lib/scenes/scenesState.svelte.js";
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

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

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

beforeEach(() => {
  sceneListState.scenes = [ON_AIR];
  sceneListState.folders = [];
});

describe("REQ-TOK-002: the Cenas head offers a door into TokenAddDialog", () => {
  it("draws a named button when a scene is on air", () => {
    const html = renderTab(ON_AIR._id);

    expect(html).toContain("scene-head__addToken");
    expect(html).toContain(`aria-label="${t("FUSION.Scenes.TokenAdd.Title")}"`);
  });

  it("draws no door with nothing on air — there is no scene to drop the token onto", () => {
    const html = renderTab(null);

    expect(html).not.toContain("scene-head__addToken");
  });

  it("the dialog is not mounted before the door is used", () => {
    const html = renderTab(ON_AIR._id);

    // TokenAddDialog's own title/actor-picker text must not leak into the tab's
    // first paint — it only exists once the button has been pressed.
    expect(html).not.toContain(t("FUSION.Scenes.TokenAdd.ActorSearchPlaceholder"));
  });

  it("the button opens the dialog against the exact scene on air", () => {
    const tab = source("../ScenesTab.svelte");

    const buttonStart = tab.indexOf('class="scene-head__addToken"');
    expect(buttonStart).toBeGreaterThan(-1);
    const button = tab.slice(buttonStart, buttonStart + 200);
    expect(button).toContain("onclick={openTokenAdd}");

    const mountStart = tab.indexOf("{#if tokenAddOpen}");
    expect(mountStart).toBeGreaterThan(-1);
    const mount = tab.slice(mountStart, mountStart + 300);
    expect(mount).toContain("<TokenAddDialog");
    expect(mount).toContain("sceneId={scene._id}");
    expect(mount).toContain("onClose={closeTokenAdd}");
    expect(mount).toContain("onSuccess={closeTokenAdd}");
  });

  it("REQ-CEN-013: the door floats over the fixed head instead of growing it", () => {
    const style = /<style>([\s\S]*)<\/style>/.exec(source("../ScenesTab.svelte"))?.[1] ?? "";
    const rule = /\.scene-head__addToken\s*\{([^}]*)\}/.exec(style)?.[1] ?? "";

    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).not.toMatch(/height:\s*\d/);
  });
});
