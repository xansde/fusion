/**
 * fusionCanvas-clearGridIf.test.ts — regression test for the grid-state race
 * flagged in the #81 review of sceneLoadGuard: FusionCanvas.setGrid()/
 * `_currentGridConfig` are GLOBAL canvas state, not scoped to any single
 * scene load, so a stale (superseded) load's cleanup must never be able to
 * wipe out the grid a NEWER, winning load already installed.
 *
 * Concrete scenario this guards against (see sceneLoader.ts's use of
 * `clearGridIf` and FusionCanvas.ts's doc comment on it): a rapid A→B scene
 * switch where A's load (slow background fetch) is superseded by B, but A's
 * `loadSceneDocument()` promise resolves AFTER B has already installed its
 * own grid via `canvas.setGrid(gridB)`. Before this fix, A's cleanup called
 * `canvas.setGrid(null)` unconditionally, silently clearing B's grid off the
 * screen (and it never came back — the reactive effect that installed it has
 * already run and won't re-run for the same scene).
 *
 * Only the constructor is exercised here — `init()` requires a real GPU/
 * WebGL context this test environment does not provide, and is not needed:
 * `_gridRenderer` stays null before init(), so setGrid/clearGridIf only
 * touch `_currentGridConfig`, which is exactly the state under test.
 */

import { describe, it, expect } from "vitest";
import { FusionCanvas } from "../FusionCanvas.js";
import type { GridRenderConfig } from "../GridRenderer.js";

function makeCanvas(): FusionCanvas {
  // The constructor only stores the container reference and binds event
  // handlers — it never touches the DOM, so a plain object stands in for
  // HTMLElement fine under the "node" test environment (no jsdom).
  return new FusionCanvas({ container: {} as HTMLElement });
}

function makeGridConfig(overrides: Partial<GridRenderConfig> = {}): GridRenderConfig {
  return {
    size: 100,
    color: "#888888",
    alpha: 0.2,
    offsetX: 0,
    offsetY: 0,
    totalWidth: 2800,
    totalHeight: 2100,
    ...overrides,
  };
}

describe("FusionCanvas.clearGridIf", () => {
  it("clears the grid when the config passed is still the one installed", () => {
    const canvas = makeCanvas();
    const cfg = makeGridConfig();

    canvas.setGrid(cfg);
    expect(canvas.getGridConfig()).toBe(cfg);

    canvas.clearGridIf(cfg);
    expect(canvas.getGridConfig()).toBeNull();
  });

  it("does NOT clear the grid when a newer config has since been installed (stale cleanup)", () => {
    // Reproduces the #81 race: A's stale cleanup must not clobber B's grid.
    const canvas = makeCanvas();
    const gridA = makeGridConfig({ size: 100 });
    const gridB = makeGridConfig({ size: 50 });

    canvas.setGrid(gridA); // A's load installs its grid.
    canvas.setGrid(gridB); // B's load wins the race and installs its own.

    // A's superseded load resolves late and runs its cleanup.
    canvas.clearGridIf(gridA);

    expect(canvas.getGridConfig()).toBe(gridB);
  });

  it("is a no-op when nothing is currently installed", () => {
    const canvas = makeCanvas();
    const cfg = makeGridConfig();

    canvas.clearGridIf(cfg);

    expect(canvas.getGridConfig()).toBeNull();
  });

  it("clearGridIf(null) only clears when null is still current (both no-grid loads agree)", () => {
    const canvas = makeCanvas();

    canvas.setGrid(null); // A: scene has no grid.
    canvas.setGrid(null); // B: scene also has no grid — still null, harmless.

    canvas.clearGridIf(null); // A's stale cleanup.

    expect(canvas.getGridConfig()).toBeNull();
  });
});
