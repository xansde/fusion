/**
 * ScenesTabPreload.test.ts — "Pré-carregar para todos" must look and be a normal button.
 *
 * It used to be a 24px ghost icon inside the hover-only action group (opacity 0 until the
 * row was hovered), with no label and no feedback — the GM could not tell it was clickable.
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

describe("ScenesTab — preload for everyone", () => {
  beforeEach(() => {
    sceneListState.folders = [];
    sceneListState.scenes = [
      { _id: "s1", type: "Scene", name: "Taverna", folder: null, sort: 0 } as unknown as SceneDocument,
    ];
  });

  it("draws a visible labelled button outside the hover-only action group", () => {
    const { body } = render(ScenesTab, {
      props: { socket: {} as never, worldId: "w", userId: "u", isGm: true, activeSceneId: null },
    });
    const btnAt = body.indexOf('class="preload-btn');
    expect(btnAt).toBeGreaterThan(-1);
    expect(body).toContain(t("FUSION.Scene.Dialog.PreloadForAll"));
    // The button precedes the (opacity: 0) actions group of its row.
    expect(btnAt).toBeLessThan(body.indexOf('class="scene-row__actions'));
  });

  it("has loading and done feedback strings in both languages", () => {
    expect(t("FUSION.Scene.Dialog.Preloading")).toBe("Pré-carregando…");
    expect(t("FUSION.Scene.Dialog.Preloaded")).toBe("Pré-carregado");
    const src = readFileSync(
      fileURLToPath(new URL("../ScenesTab.svelte", import.meta.url)),
      "utf8",
    );
    expect(src).toContain('preloadStatus[sceneId] = "loading"');
    expect(src).toContain('preloadStatus[sceneId] = "done"');
  });
});
