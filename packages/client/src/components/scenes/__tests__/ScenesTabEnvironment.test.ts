/**
 * ScenesTabEnvironment.test.ts — the environment shortcuts are OUT of the head (G081,
 * plan A050).
 *
 * REQ-CEN-020..025 (darkness/fog/reset toggles, plus the perception door of the head)
 * were retired from this UI on 2026-08-17 — Alexandre's r1 test, item 25 ("fora por
 * enquanto"), a decision and not a bug (see `specs/44-aba-cenas.md` §5.3, the note
 * after REQ-CEN-025, and DEC-CEN-06). This file used to prove the controls were ON the
 * head; it now proves the opposite — that none of the four controls
 * (`.scene-head__perception`, `.scene-head__env` and its three buttons) render there,
 * with or without a scene on air, and that removing them did not touch the underlying
 * server-side gestures (`lib/scenes/sceneEnvironment.ts`), which stay directly
 * testable and are still reachable from the configuration window (REQ-CEN-062).
 *
 * The client's Vitest runs in a node environment (no DOM), so the assertions are on the
 * server-rendered markup — the technique `ScenesTabHead.test.ts` already uses here.
 *
 * Covers REQ-CEN-020, REQ-CEN-021, REQ-CEN-022, REQ-CEN-023, REQ-CEN-024, REQ-CEN-025.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SceneDocument } from "@fusion/shared";

import ScenesTab from "../ScenesTab.svelte";
import { sceneListState } from "../../../lib/scenes/scenesState.svelte.js";
import { buildSceneEnvironmentVM, SCENE_ENV_KEYS } from "../../../lib/scenes/sceneEnvironment.js";
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
    tokens: [],
    walls: [],
    ...overrides,
  } as unknown as SceneDocument;
}

function renderTab(activeSceneId: string | null): string {
  const { body } = render(ScenesTab, {
    props: {
      socket: {} as never,
      worldId: "world-1",
      userId: "user-1",
      isGm: true,
      activeSceneId,
    },
  });
  return body;
}

function sourceOfScenesTab(): string {
  return readFileSync(fileURLToPath(new URL("../ScenesTab.svelte", import.meta.url)), "utf8");
}

/** The `<section class="scene-head">` block alone — the retired controls used to live inside it. */
function headOf(html: string): string {
  return /<section class="scene-head[^"]*"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
}

describe("ScenesTab — the environment shortcuts are retired from the head (REQ-CEN-020..025)", () => {
  beforeEach(() => {
    sceneListState.scenes = [];
  });

  it("REQ-CEN-020/021/022: the three gestures do NOT render on the head of a scene on air", () => {
    sceneListState.scenes = [makeScene({ _id: "s1" })];

    const head = headOf(renderTab("s1"));

    expect(head).not.toContain("scene-head__env");
    expect(head).not.toContain(t(SCENE_ENV_KEYS.darknessOn));
    expect(head).not.toContain(t(SCENE_ENV_KEYS.fogOn));
    expect(head).not.toContain(t(SCENE_ENV_KEYS.fogReset));
  });

  it("REQ-CEN-020/021/022: no environment button appears whatever the document's darkness/fog", () => {
    sceneListState.scenes = [makeScene({ _id: "s1", darkness: 0.7, fogEnabled: true })];

    const head = headOf(renderTab("s1"));

    expect(head).not.toContain("scene-head__env-btn");
    expect(head).not.toContain('aria-pressed="true"');
    expect(head).not.toContain('aria-pressed="false"');
  });

  it("REQ-CEN-024: nothing on air, still no environment controls (nothing to retire twice)", () => {
    sceneListState.scenes = [makeScene({ _id: "s1" })];

    const html = renderTab(null);

    expect(html).not.toContain("scene-head__env");
    expect(html).not.toContain(t(SCENE_ENV_KEYS.fogReset));
  });

  it("REQ-CEN-025: the head's stylesheet no longer carries a rule for the retired controls", () => {
    const source = sourceOfScenesTab();
    const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? "";

    expect(style).not.toMatch(/\.scene-head__env\s*\{/);
    expect(style).not.toMatch(/\.scene-head__env-btn/);
  });

  it("REQ-CEN-020..025: the head's own height is untouched by the retirement (REQ-CEN-013)", () => {
    const source = sourceOfScenesTab();
    const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? "";
    const rule = /\.scene-head\s*\{([^}]*)\}/.exec(style)?.[1] ?? "";

    expect(rule).toMatch(/height:\s*var\(--fusion-scene-head-height\)/);
  });

  it("the underlying server-side gestures stay intact — this is a UI retirement, not a logic removal", () => {
    // `lib/scenes/sceneEnvironment.ts` still computes the VM the head used to draw; only
    // the component wiring that turned it into buttons is gone. Exercised directly (not
    // through ScenesTab) to prove the rule survives even though no button calls it.
    sceneListState.scenes = [makeScene({ _id: "s1", darkness: 0.7, fogEnabled: true })];

    const vm = buildSceneEnvironmentVM({ scenes: sceneListState.scenes, activeSceneId: "s1" });

    expect(vm).not.toBeNull();
    expect(vm?.darkness.pressed).toBe(true);
    expect(vm?.fog.pressed).toBe(true);
  });
});
