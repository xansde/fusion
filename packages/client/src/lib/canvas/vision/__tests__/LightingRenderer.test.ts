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
import { buildLightingStateKey, selectLightingRenderMode } from "../LightingRenderer.js";
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

  // A005 fix (REQ-CEN-072/REQ-VIS-085): restrictionActive is now a render
  // input distinct from isGm — a scene's `tokenVision` flag flipping (with
  // GM-ness and everything else unchanged) must still force a redraw, or the
  // guard would leave a stale fog/mask on screen after the GM toggles the
  // setting.
  it("REQ-VIS-085: restrictionActive toggle changes the key, independent of isGm", () => {
    const state = makeState({ isGm: false });
    const restricted = buildLightingStateKey(state, null, true);
    const unrestricted = buildLightingStateKey(state, null, false);
    expect(restricted).not.toBe(unrestricted);
  });

  it("restrictionActive defaults to true when omitted (back-compat with existing call sites)", () => {
    const state = makeState({ isGm: false });
    expect(buildLightingStateKey(state, null)).toBe(buildLightingStateKey(state, null, true));
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
      sceneId: "scene-1",
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

// ---------------------------------------------------------------------------
// selectLightingRenderMode — the actual restriction branch (A005 regression)
// ---------------------------------------------------------------------------

// Ajustes r1 — Fase 0 review of A005: the mutation check performed during
// review (swap `showRestriction` for `!state.isGm` inside render()) left the
// full `src/lib/canvas` suite green, because nothing exercised the branch
// that decides whether the fog/vision-mask overlay is drawn or cleared —
// only `buildLightingStateKey` (the re-render *cache* key) had coverage.
// `selectLightingRenderMode` is the exact decision `render()` delegates to
// (REQ-VIS-085, specs/07-visao-iluminacao-fog.md:238, CA-20 specs/07:524):
// a non-GM viewer must only ever see fog/vision-mask when the scene opted
// into restriction via BOTH `tokenVision` and `fogEnabled`; otherwise (GM,
// or `restrictionActive=false`) both overlays must clear — that "clear"
// outcome is precisely what was unreachable for players before the A005 fix
// and painted the whole canvas black regardless of the scene's flags.
describe("selectLightingRenderMode — REQ-VIS-085 restriction branches (A005 regression)", () => {
  function makeFogRenderState(fogActive: boolean): FogRenderState {
    return {
      explored: emptyFog(),
      currentVisionRings: [],
      fogActive,
      sceneId: "scene-1",
    };
  }

  it("GM (isGm=true) resolves to 'clear' even with an active fog state and restrictionActive=true (GM is never restricted)", () => {
    expect(selectLightingRenderMode(true, true, makeFogRenderState(true))).toBe("clear");
  });

  it("REQ-VIS-085/A005: non-GM with restrictionActive=false resolves to 'clear' even when a fog state with fogActive=true is present — the exact branch that painted the player's screen black before the fix", () => {
    expect(selectLightingRenderMode(false, false, makeFogRenderState(true))).toBe("clear");
  });

  it("REQ-VIS-085: non-GM, restrictionActive=true, no fog state → 'vision-mask' (simple M2-A mask)", () => {
    expect(selectLightingRenderMode(false, true, null)).toBe("vision-mask");
  });

  it("REQ-VIS-085: non-GM, restrictionActive=true, fog state present but fogActive=false → 'vision-mask' (falls back instead of clearing)", () => {
    expect(selectLightingRenderMode(false, true, makeFogRenderState(false))).toBe("vision-mask");
  });

  it("REQ-VIS-085: non-GM, restrictionActive=true, fog state present and fogActive=true → 'fog' (three-state fog)", () => {
    expect(selectLightingRenderMode(false, true, makeFogRenderState(true))).toBe("fog");
  });
});
