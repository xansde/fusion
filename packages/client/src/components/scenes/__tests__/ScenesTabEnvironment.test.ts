/**
 * ScenesTabEnvironment.test.ts — the environment controls as the head draws them (G081).
 *
 * The rule of WHAT the controls are and WHAT each one sends is pinned in
 * `lib/scenes/__tests__/sceneEnvironment.test.ts`. What only the component can answer is
 * asserted here: that the three gestures are actually on the head of the scene on air,
 * that they carry the state the server pushed (and no local copy of it), that they
 * vanish when nothing is on air, and that they do not grow the fixed head.
 *
 * The client's Vitest runs in a node environment (no DOM), so the assertions are on the
 * server-rendered markup and on the component's own stylesheet — the technique
 * `ScenesTabHead.test.ts` already uses here.
 *
 * Covers REQ-CEN-020, REQ-CEN-021, REQ-CEN-022, REQ-CEN-023, REQ-CEN-024.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SceneDocument } from "@fusion/shared";

import ScenesTab from "../ScenesTab.svelte";
import { sceneListState } from "../../../lib/scenes/scenesState.svelte.js";
import { SCENE_ENV_KEYS } from "../../../lib/scenes/sceneEnvironment.js";
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

function styleOfScenesTab(): string {
  const style = /<style>([\s\S]*)<\/style>/.exec(sourceOfScenesTab())?.[1];
  if (style === undefined) throw new Error("ScenesTab.svelte has no <style> block");
  return style;
}

function ruleFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null) throw new Error(`no rule for ${selector}`);
  return match[1] ?? "";
}

/** The `<section class="scene-head">` block alone — the controls live inside it. */
function headOf(html: string): string {
  return /<section class="scene-head[^"]*"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
}

describe("ScenesTab — the environment shortcuts on the head", () => {
  beforeEach(() => {
    sceneListState.scenes = [];
  });

  it("REQ-CEN-020 / REQ-CEN-021 / REQ-CEN-022: the three gestures sit on the head of the scene on air", () => {
    sceneListState.scenes = [makeScene({ _id: "s1" })];

    const head = headOf(renderTab("s1"));

    expect(head).toContain("scene-head__env");
    expect(head).toContain(t(SCENE_ENV_KEYS.darknessOn));
    expect(head).toContain(t(SCENE_ENV_KEYS.fogOn));
    expect(head).toContain(t(SCENE_ENV_KEYS.fogReset));
  });

  it("REQ-CEN-023: each toggle carries the state of the document, not a local copy", () => {
    sceneListState.scenes = [makeScene({ _id: "s1", darkness: 0.7, fogEnabled: true })];
    const dark = headOf(renderTab("s1"));

    sceneListState.scenes = [makeScene({ _id: "s1", darkness: 0, fogEnabled: false })];
    const lit = headOf(renderTab("s1"));

    // Pressed follows the server's document in both directions...
    expect(dark).toContain('aria-pressed="true"');
    expect(dark).toContain(t(SCENE_ENV_KEYS.darknessOff));
    expect(dark).toContain(t(SCENE_ENV_KEYS.fogOff));
    expect(lit).not.toContain('aria-pressed="true"');
    expect(lit).toContain(t(SCENE_ENV_KEYS.darknessOn));

    // ...because it is a projection, not a `$state` mirror that a refused write or
    // another GM's change would leave stale.
    const source = sourceOfScenesTab();
    expect(source).toMatch(/const environment = \$derived\(/);
    expect(source).not.toMatch(/\$state[^;\n]*\b(darknessOn|fogOn|envPressed)\b/);
  });

  it("REQ-CEN-024: nothing on air, no environment controls", () => {
    sceneListState.scenes = [makeScene({ _id: "s1" })];

    const html = renderTab(null);

    expect(html).not.toContain("scene-head__env");
    expect(html).not.toContain(t(SCENE_ENV_KEYS.fogReset));
  });

  it("REQ-CEN-024: a scene on air this client has not received yet gets no controls either", () => {
    sceneListState.scenes = [makeScene({ _id: "s1" })];

    const html = renderTab("s2");

    expect(html).not.toContain("scene-head__env");
  });

  it("REQ-CEN-020..022: the controls do not grow the head — they float over the fixed box", () => {
    const css = styleOfScenesTab();
    const rule = ruleFor(css, ".scene-head__env");

    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).not.toMatch(/height:\s*\d/);
    // And the head itself is still the one height the theme fixes (REQ-CEN-010).
    expect(ruleFor(css, ".scene-head")).toMatch(/height:\s*var\(--fusion-scene-head-height\)/);
  });

  it("REQ-CEN-022: the reset announces itself as the irreversible one", () => {
    sceneListState.scenes = [makeScene({ _id: "s1" })];

    const head = headOf(renderTab("s1"));

    // The button is there; the confirmation text it will show is a real message.
    expect(head).toContain("scene-head__env-btn--reset");
    expect(t(SCENE_ENV_KEYS.fogResetConfirm)).not.toBe(SCENE_ENV_KEYS.fogResetConfirm);
    expect(t(SCENE_ENV_KEYS.fogResetConfirmLabel)).not.toBe(SCENE_ENV_KEYS.fogResetConfirmLabel);
  });
});
