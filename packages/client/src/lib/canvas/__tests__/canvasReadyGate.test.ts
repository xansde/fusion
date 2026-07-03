/**
 * canvasReadyGate.test.ts — unit tests for the TableScreen scene-reload gate.
 *
 * BUG FIX (race): guards against loadSceneDocument() being called before
 * FusionCanvas.init() has finished building the PIXI layer hierarchy — see
 * canvasReadyGate.ts doc comment for full root-cause context.
 */

import { describe, it, expect } from "vitest";
import { canLoadScene } from "../canvasReadyGate.js";

describe("canLoadScene", () => {
  it("is false before the canvas is mounted (hasCanvas=false), regardless of canvasReady", () => {
    expect(canLoadScene(false, false)).toBe(false);
    expect(canLoadScene(false, true)).toBe(false);
  });

  it("is false once the canvas is mounted but init() has not resolved yet — THE race window", () => {
    // This is exactly the state at the moment $effect first runs on mount:
    // fusionCanvas has been assigned (hasCanvas=true) but `await canvas.init()`
    // inside onMount is still pending (canvasReady=false). Before the fix, the
    // $effect had no canvasReady check and called loadSceneDocument() here,
    // hitting FusionCanvas.getLayer() before _buildHierarchy() ran.
    expect(canLoadScene(true, false)).toBe(false);
  });

  it("is true once both the canvas is mounted and init() has resolved", () => {
    expect(canLoadScene(true, true)).toBe(true);
  });

  it("is false if canvasReady is somehow true without a canvas (defensive — should not occur)", () => {
    expect(canLoadScene(false, true)).toBe(false);
  });
});
