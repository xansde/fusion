/**
 * LightingRenderer.test.ts — unit tests for the pure state-key logic.
 *
 * LightingRenderer itself constructs real PIXI Graphics/Container objects,
 * which require a renderer and are not exercised here (see
 * CombatTurnMarker.test.ts for the established convention of testing the
 * extracted pure logic instead of the PIXI wrapper).
 *
 * Regression coverage for the bug fixed here: `_buildStateKey` used to key
 * on vertex/ring COUNTS instead of actual coordinates, so moving a light or
 * token without changing its polygon's vertex count (the common case — the
 * polygon shape stays topologically the same as it slides across open
 * floor) produced an unchanged key, causing LightingRenderer.render() to
 * skip the redraw and leave stale geometry on screen.
 *
 * Tests:
 *   - Moving a light (same vertex count) changes the key
 *   - Moving a vision token (same vertex count) changes the key
 *   - Identical state (same object shape, different reference) keeps the same key
 *   - Changing a light's color/intensity/radius changes the key even if the
 *     polygon geometry is unchanged
 *   - Changing fog explored/current-vision ring coordinates changes the key
 *     even when ring/polygon counts stay the same
 *   - isGm / darkness / globalLight toggles change the key
 */

import { describe, it, expect } from "vitest";
import { buildLightingStateKey } from "../LightingRenderer.js";
import type {
  VisionStateResult,
  LightPolygonResult,
  VisionPolygonResult,
} from "../vision-state.js";
import type { FogRenderState } from "../fog-state.js";
import { emptyFog, unionFog } from "@fusion/shared";
import type { VisibilityPolygon } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function square(cx: number, cy: number, s: number): VisibilityPolygon {
  return {
    vertices: [
      { x: cx - s, y: cy - s },
      { x: cx + s, y: cy - s },
      { x: cx + s, y: cy + s },
      { x: cx - s, y: cy + s },
    ],
  };
}

function makeVisionPolygon(tokenId: string, cx: number, cy: number, s = 100): VisionPolygonResult {
  return { tokenId, polygon: square(cx, cy, s) };
}

function makeLightPolygon(
  lightId: string,
  cx: number,
  cy: number,
  opts: Partial<Omit<LightPolygonResult, "lightId" | "polygon" | "brightPolygon">> = {},
): LightPolygonResult {
  return {
    lightId,
    polygon: square(cx, cy, 200),
    brightPolygon: square(cx, cy, 80),
    color: "#ffffff",
    intensity: 1,
    dimPx: 200,
    brightPx: 80,
    ...opts,
  };
}

function makeState(overrides: Partial<VisionStateResult> = {}): VisionStateResult {
  return {
    visionPolygons: [],
    lightPolygons: [],
    isGm: false,
    darkness: 0,
    globalLight: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildLightingStateKey — coordinate sensitivity (regression for count-only bug)", () => {
  it("moving a light (same vertex count, different coordinates) changes the key", () => {
    const before = makeState({ lightPolygons: [makeLightPolygon("light-1", 100, 100)] });
    const after = makeState({ lightPolygons: [makeLightPolygon("light-1", 150, 100)] }); // moved

    const keyBefore = buildLightingStateKey(before);
    const keyAfter = buildLightingStateKey(after);

    // Sanity: both polygons have the same vertex count (4) — a count-based
    // key would incorrectly consider these equal.
    expect(before.lightPolygons[0]?.polygon.vertices.length).toBe(
      after.lightPolygons[0]?.polygon.vertices.length,
    );
    expect(keyBefore).not.toBe(keyAfter);
  });

  it("moving a vision token (same vertex count, different coordinates) changes the key", () => {
    const before = makeState({ visionPolygons: [makeVisionPolygon("tok-1", 500, 500)] });
    const after = makeState({ visionPolygons: [makeVisionPolygon("tok-1", 500, 520)] }); // moved

    const keyBefore = buildLightingStateKey(before);
    const keyAfter = buildLightingStateKey(after);

    expect(before.visionPolygons[0]?.polygon.vertices.length).toBe(
      after.visionPolygons[0]?.polygon.vertices.length,
    );
    expect(keyBefore).not.toBe(keyAfter);
  });

  it("identical state (fresh object references, same content) produces the same key", () => {
    const stateA = makeState({
      visionPolygons: [makeVisionPolygon("tok-1", 500, 500)],
      lightPolygons: [makeLightPolygon("light-1", 100, 100)],
      isGm: true,
      darkness: 0.4,
      globalLight: true,
    });
    const stateB = makeState({
      visionPolygons: [makeVisionPolygon("tok-1", 500, 500)],
      lightPolygons: [makeLightPolygon("light-1", 100, 100)],
      isGm: true,
      darkness: 0.4,
      globalLight: true,
    });

    expect(buildLightingStateKey(stateA)).toBe(buildLightingStateKey(stateB));
  });

  it("changing a light's color changes the key even when geometry is unchanged", () => {
    const before = makeState({
      lightPolygons: [makeLightPolygon("light-1", 100, 100, { color: "#ff0000" })],
    });
    const after = makeState({
      lightPolygons: [makeLightPolygon("light-1", 100, 100, { color: "#00ff00" })],
    });

    expect(buildLightingStateKey(before)).not.toBe(buildLightingStateKey(after));
  });

  it("changing a light's intensity changes the key even when geometry is unchanged", () => {
    const before = makeState({
      lightPolygons: [makeLightPolygon("light-1", 100, 100, { intensity: 1 })],
    });
    const after = makeState({
      lightPolygons: [makeLightPolygon("light-1", 100, 100, { intensity: 0.5 })],
    });

    expect(buildLightingStateKey(before)).not.toBe(buildLightingStateKey(after));
  });

  it("changing a light's dim/bright radius changes the key even when polygon vertex count is unchanged", () => {
    const before = makeState({
      lightPolygons: [makeLightPolygon("light-1", 100, 100, { dimPx: 200, brightPx: 80 })],
    });
    const after = makeState({
      lightPolygons: [makeLightPolygon("light-1", 100, 100, { dimPx: 300, brightPx: 80 })],
    });

    expect(buildLightingStateKey(before)).not.toBe(buildLightingStateKey(after));
  });

  it("isGm toggle changes the key", () => {
    const before = makeState({ isGm: false });
    const after = makeState({ isGm: true });
    expect(buildLightingStateKey(before)).not.toBe(buildLightingStateKey(after));
  });

  it("darkness change changes the key", () => {
    const before = makeState({ darkness: 0 });
    const after = makeState({ darkness: 0.5 });
    expect(buildLightingStateKey(before)).not.toBe(buildLightingStateKey(after));
  });

  it("globalLight toggle changes the key", () => {
    const before = makeState({ globalLight: false });
    const after = makeState({ globalLight: true });
    expect(buildLightingStateKey(before)).not.toBe(buildLightingStateKey(after));
  });
});

describe("buildLightingStateKey — fog state coordinate sensitivity", () => {
  function makeFogState(
    explored: ReturnType<typeof unionFog>,
    currentVisionRings: number[][] = [],
  ): FogRenderState {
    return {
      explored,
      currentVisionRings,
      fogActive: true,
    };
  }

  it("no fog state produces a distinct 'nofog' key", () => {
    const state = makeState();
    const keyWithout = buildLightingStateKey(state, null);
    const keyWithEmpty = buildLightingStateKey(state, makeFogState(emptyFog()));
    expect(keyWithout).not.toBe(keyWithEmpty);
  });

  it("exploring a new area changes the key even though polygon COUNT may stay the same shape-wise", () => {
    // Two different single-polygon explorations — same "1 polygon" topology,
    // different coordinates. A totalVertices-based key could coincidentally
    // collide here (both are simple rectangles = 4 vertices); the fix must
    // still distinguish them because it hashes actual coordinates.
    const exploredA = unionFog(emptyFog(), [0, 0, 100, 0, 100, 100, 0, 100]);
    const exploredB = unionFog(emptyFog(), [500, 500, 600, 500, 600, 600, 500, 600]);

    expect(exploredA.totalVertices).toBe(exploredB.totalVertices); // same count
    expect(exploredA.polygons.length).toBe(exploredB.polygons.length); // same polygon count

    const state = makeState();
    const keyA = buildLightingStateKey(state, makeFogState(exploredA));
    const keyB = buildLightingStateKey(state, makeFogState(exploredB));
    expect(keyA).not.toBe(keyB);
  });

  it("current vision ring coordinates changing (same ring count) changes the key", () => {
    const explored = unionFog(emptyFog(), [0, 0, 100, 0, 100, 100, 0, 100]);
    const state = makeState();

    const before = makeFogState(explored, [[0, 0, 50, 0, 50, 50, 0, 50]]);
    const after = makeFogState(explored, [[0, 0, 60, 0, 60, 60, 0, 60]]); // moved/grown

    expect(before.currentVisionRings.length).toBe(after.currentVisionRings.length);
    expect(buildLightingStateKey(state, before)).not.toBe(buildLightingStateKey(state, after));
  });
});
