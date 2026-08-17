/**
 * ScenesTabEnvironment.test.ts — the environment shortcuts are OUT of the head (G081,
 * plan A050).
 *
 * The darkness/fog/fog-reset shortcuts (REQ-CEN-020, REQ-CEN-021, REQ-CEN-022) were
 * retired from this UI on 2026-08-17 — Alexandre's r1 test, item 25 ("fora por
 * enquanto"), a decision and not a bug (see `specs/44-aba-cenas.md` §5.3, DEC-CEN-06).
 * This file used to prove the controls were ON the head; it now proves the opposite —
 * that none of the three buttons (`.scene-head__env` and its children) render there,
 * with or without a scene on air (REQ-CEN-024), and that removing them did not touch the
 * underlying server-side gestures (`lib/scenes/sceneEnvironment.ts`), which stay
 * directly testable and are still reachable from the configuration window. The
 * head's own perception door (a separate control, REQ-CEN-062) is covered by
 * `ScenesTabWindows.test.ts`, not here.
 *
 * The three consequence requirements of the same 5.3 block — REQ-CEN-023 (state stays
 * server-driven if the controls ever come back), REQ-CEN-024's "if they come back"
 * clause, and REQ-CEN-025 (the tab never owns lighting/vision semantics) — are either
 * conditioned on the controls existing again (nothing here can exercise that yet) or
 * are about ownership of logic, which absence-of-CSS/absence-of-markup cannot prove;
 * REQ-CEN-025 is proven behaviourally by `lib/scenes/__tests__/sceneEnvironment.test.ts`
 * instead (it shows the tab's write touches darkness alone and delegates the reset to
 * spec 07's own op). Citing those ids here, on proofs that do not exercise them, was
 * the mistake this revision (Ajustes r1 review, 2026-08-17) corrects.
 *
 * The client's Vitest runs in a node environment (no DOM), so the assertions are on the
 * server-rendered markup and on the component's own stylesheet — the same technique
 * `ScenesTabHead.test.ts` already uses here, including its throw-on-miss extractors:
 * a silent `?? ""` fallback lets every assertion in a file pass on a component that
 * failed to render at all, which is worse than not testing.
 *
 * Covers REQ-CEN-020, REQ-CEN-021, REQ-CEN-022, REQ-CEN-024, REQ-CEN-010, REQ-CEN-013.
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

/** The component's own stylesheet — throws rather than silently testing against "". */
function styleOfScenesTab(): string {
  const source = readFileSync(
    fileURLToPath(new URL("../ScenesTab.svelte", import.meta.url)),
    "utf8",
  );
  const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1];
  if (style === undefined) throw new Error("ScenesTab.svelte has no <style> block");
  return style;
}

/** The declaration block of a single class selector. */
function ruleFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null) throw new Error(`no rule for ${selector}`);
  return match[1] ?? "";
}

/**
 * The `<section class="scene-head">` block alone — the retired controls used to live
 * inside it. Throws instead of falling back to `""` on a miss: a `.not.toContain(...)`
 * assertion against an empty string always passes, so a silent fallback here would let
 * every test below pass against a head that never rendered at all (a renamed class, a
 * component that now throws, `.scene-head` collapsing to "pending") — exactly the kind
 * of false green this file exists to avoid producing.
 */
function headOf(html: string): string {
  const match = /<section class="scene-head[^"]*"[\s\S]*?<\/section>/.exec(html);
  if (match === null) throw new Error("no .scene-head section in the rendered markup");
  return match[0];
}

describe("ScenesTab — the environment shortcuts are retired from the head (REQ-CEN-020..022)", () => {
  beforeEach(() => {
    sceneListState.scenes = [];
  });

  it("REQ-CEN-020/021/022: the three gestures do NOT render on the head of a scene on air", () => {
    sceneListState.scenes = [makeScene({ _id: "s1" })];

    const head = headOf(renderTab("s1"));

    // Positive anchor first: this really is the "on air" head, drawn with its usual
    // identity block and flag — not an empty/pending head that would vacuously lack
    // the env markup too. (The section's own `aria-label` is the same string on every
    // kind of head, so it cannot serve as this anchor — `.scene-head__info` and
    // `.scene-head__flag` only render for `kind === "on-air"`.)
    expect(head).toContain("scene-head__info");
    expect(head).toContain("scene-head__flag");

    expect(head).not.toContain("scene-head__env");
    expect(head).not.toContain(t(SCENE_ENV_KEYS.darknessOn));
    expect(head).not.toContain(t(SCENE_ENV_KEYS.fogOn));
    expect(head).not.toContain(t(SCENE_ENV_KEYS.fogReset));
  });

  it("REQ-CEN-020/021/022: no environment button appears whatever the document's darkness/fog", () => {
    sceneListState.scenes = [makeScene({ _id: "s1", darkness: 0.7, fogEnabled: true })];

    const head = headOf(renderTab("s1"));

    // Same positive anchor as above — the darkness/fog values chosen are exactly the
    // ones that used to light up the retired buttons, so proving the head still drew
    // (and is still the "on air" head, not some fallback) matters more here, not less.
    expect(head).toContain("scene-head__info");
    expect(head).toContain("scene-head__flag");

    expect(head).not.toContain("scene-head__env-btn");
    expect(head).not.toContain('aria-pressed="true"');
    expect(head).not.toContain('aria-pressed="false"');
  });

  it("REQ-CEN-024: nothing on air, still no environment controls (nothing to retire twice)", () => {
    sceneListState.scenes = [makeScene({ _id: "s1" })];

    const head = headOf(renderTab(null));

    // Positive anchor: this is genuinely the "nothing on air" head (REQ-CEN-014), not a
    // markup miss — `headOf` above already throws if `.scene-head` itself vanished.
    expect(head).toContain(t("FUSION.Scene.Head.Empty"));

    expect(head).not.toContain("scene-head__env");
    expect(head).not.toContain(t(SCENE_ENV_KEYS.fogReset));
  });

  it("CSS hygiene: the stylesheet no longer carries a rule for the retired buttons", () => {
    // Not a REQ-CEN-025 proof: REQ-CEN-025 is about the tab never owning lighting/
    // vision semantics (a logic-ownership requirement); the absence of a CSS selector
    // says nothing about that either way. `sceneEnvironment.test.ts` proves REQ-CEN-025
    // behaviourally. This test only guards against dead CSS left behind by A050.
    const style = styleOfScenesTab();

    expect(style).not.toMatch(/\.scene-head__env\s*\{/);
    expect(style).not.toMatch(/\.scene-head__env-btn/);
  });

  it("REQ-CEN-010/REQ-CEN-013: the head's own height is untouched by the retirement", () => {
    const rule = ruleFor(styleOfScenesTab(), ".scene-head");

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
