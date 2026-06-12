/**
 * vision-state.test.ts — unit tests for VisionStateComputer (pure logic, no PIXI).
 *
 * Tests:
 *   - Polygon computed for controlled tokens with vision enabled
 *   - GM sees nothing extra (no polygon computed — they see all)
 *   - Cache hit: second call returns same object reference
 *   - Cache bust on wall change
 *   - Cache bust on token move (invalidateToken)
 *   - Light polygon computed for enabled lights
 *   - buildTokenVisionConfig unit-unit→px conversion
 *   - buildAmbientLightConfig grid-unit→px conversion
 *   - globalLight and darkness passed through
 *   - Disabled tokens skipped
 *   - Disabled lights skipped
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  VisionStateComputer,
  buildTokenVisionConfig,
  buildAmbientLightConfig,
  buildTokenLightConfig,
  type TokenSourceConfig,
  type LightConfig,
} from "../vision-state.js";
import { makeWall, makeDoor } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCENE_BOUNDS = { x: 0, y: 0, width: 1000, height: 1000 };
const _GRID_PX = 100;

function makeToken(
  id: string,
  x: number,
  y: number,
  opts: Partial<TokenSourceConfig["vision"]> = {},
  controlled = true,
): TokenSourceConfig {
  return {
    id,
    x,
    y,
    vision: {
      enabled: true,
      rangePx: null,
      angle: 360,
      rotation: 0,
      visionMode: "basic",
      ...opts,
    },
    light: null,
    controlled,
  };
}

function makeLight(id: string, x: number, y: number, brightPx = 100, dimPx = 200): LightConfig {
  return {
    id,
    x,
    y,
    brightPx,
    dimPx,
    angle: 360,
    rotation: 0,
    color: "#ffffff",
    intensity: 1,
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// VisionStateComputer
// ---------------------------------------------------------------------------

describe("VisionStateComputer", () => {
  let computer: VisionStateComputer;

  beforeEach(() => {
    computer = new VisionStateComputer();
  });

  // ---- §1 Basic vision ---

  it("computes a non-empty vision polygon for a controlled token with vision enabled", () => {
    const token = makeToken("t1", 500, 500);
    const result = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    expect(result.visionPolygons).toHaveLength(1);
    expect(result.visionPolygons[0]?.polygon.vertices.length).toBeGreaterThan(2);
  });

  it("skips tokens where vision.enabled = false", () => {
    const token = makeToken("t1", 500, 500, { enabled: false });
    const result = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    expect(result.visionPolygons).toHaveLength(0);
  });

  it("skips non-controlled tokens for non-GM users", () => {
    const token = makeToken("t1", 500, 500, {}, false /* not controlled */);
    const result = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    expect(result.visionPolygons).toHaveLength(0);
  });

  it("GM: isGm=true is reflected in result", () => {
    const token = makeToken("t1", 500, 500, {}, false); // controlled=false
    const result = computer.compute([], [token], SCENE_BOUNDS, true /* isGm */, 0, false);
    // controlled=false + isGm: the non-GM check (!controlled) is only applied for non-GM users.
    // For GM: !isGm is false, so the guard is skipped — GM still computes vision for enabled tokens
    // even when controlled=false (GM can see all token visions).
    expect(result.isGm).toBe(true);
    // The token has vision.enabled=true and for GM we skip the controlled check
    // so a polygon IS computed (GM sees vision polygons for all tokens).
    expect(result.visionPolygons).toHaveLength(1);
  });

  it("GM: non-GM player does NOT compute vision for uncontrolled enabled tokens", () => {
    const token = makeToken("t1", 500, 500, {}, false /* not controlled */);
    const result = computer.compute([], [token], SCENE_BOUNDS, false /* non-GM */, 0, false);
    expect(result.visionPolygons).toHaveLength(0);
  });

  it("computes multiple vision polygons for multiple controlled tokens", () => {
    const t1 = makeToken("t1", 200, 200);
    const t2 = makeToken("t2", 700, 700);
    const result = computer.compute([], [t1, t2], SCENE_BOUNDS, false, 0, false);
    expect(result.visionPolygons).toHaveLength(2);
  });

  // ---- §2 Cache behaviour ---

  it("returns the same polygon reference on second call (cache hit)", () => {
    const token = makeToken("t1", 500, 500);
    const r1 = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    const r2 = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    // Same object identity — not just equal
    expect(r1.visionPolygons[0]?.polygon).toBe(r2.visionPolygons[0]?.polygon);
  });

  it("busts vision cache when walls change (new wall added)", () => {
    const token = makeToken("t1", 500, 500);
    const r1 = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);

    const wall = makeWall("w1", 400, 0, 400, 1000);
    const r2 = computer.compute([wall], [token], SCENE_BOUNDS, false, 0, false);

    // Polygon must differ — wall now splits the scene
    expect(r1.visionPolygons[0]?.polygon).not.toBe(r2.visionPolygons[0]?.polygon);
    // And the new polygon should have fewer vertices (blocked on the right)
    const v1 = r1.visionPolygons[0]?.polygon.vertices.length ?? 0;
    const v2 = r2.visionPolygons[0]?.polygon.vertices.length ?? 0;
    // Wall blocks half the scene — vertex count should differ
    expect(v1).not.toBe(v2);
  });

  it("busts cache for a single token on invalidateToken", () => {
    const token = makeToken("t1", 500, 500);
    const r1 = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    const poly1 = r1.visionPolygons[0]?.polygon;

    // Invalidate then re-compute — should recompute (new object)
    computer.invalidateToken("t1");
    const r2 = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    const poly2 = r2.visionPolygons[0]?.polygon;

    // Content equal but not same reference after invalidation
    expect(poly2).not.toBe(poly1);
    expect(poly2?.vertices.length).toBe(poly1?.vertices.length);
  });

  it("clearAll() busts all caches", () => {
    const token = makeToken("t1", 500, 500);
    const r1 = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    computer.clearAll();
    const r2 = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    expect(r1.visionPolygons[0]?.polygon).not.toBe(r2.visionPolygons[0]?.polygon);
  });

  // ---- §3 Token with range ---

  it("range limits the vision polygon radius", () => {
    const tokenUnlimited = makeToken("tu", 100, 100, { rangePx: null });
    const tokenLimited = makeToken("tl", 100, 100, { rangePx: 200 });

    const ru = computer.compute([], [tokenUnlimited], SCENE_BOUNDS, false, 0, false);
    computer.clearAll();
    const rl = computer.compute([], [tokenLimited], SCENE_BOUNDS, false, 0, false);

    // Limited polygon should be smaller (fewer total vertices reaching scene bounds)
    const vu = ru.visionPolygons[0]?.polygon.vertices ?? [];
    const vl = rl.visionPolygons[0]?.polygon.vertices ?? [];

    // All limited vertices should be within range + epsilon of the origin
    const range = 200;
    for (const pt of vl) {
      const dx = pt.x - 100;
      const dy = pt.y - 100;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeLessThanOrEqual(range + 2); // +2px epsilon for sweep rounding
    }

    // Unlimited polygon should have vertices on scene bounds (far from origin)
    const hasFarVertex = vu.some((pt) => {
      const dx = pt.x - 100;
      const dy = pt.y - 100;
      return Math.sqrt(dx * dx + dy * dy) > 500;
    });
    expect(hasFarVertex).toBe(true);
  });

  // ---- §4 Door state invalidation ---

  it("opening a door (wall change) invalidates vision cache", () => {
    const door = makeDoor("d1", 600, 0, 600, 500, "closed");
    const token = makeToken("t1", 500, 250);

    const r1 = computer.compute([door], [token], SCENE_BOUNDS, false, 0, false);
    const poly1 = r1.visionPolygons[0]?.polygon;

    const openDoor = makeDoor("d1", 600, 0, 600, 500, "open");
    const r2 = computer.compute([openDoor], [token], SCENE_BOUNDS, false, 0, false);
    const poly2 = r2.visionPolygons[0]?.polygon;

    expect(poly2).not.toBe(poly1);
  });

  // ---- §5 Lighting ---

  it("computes dim + bright polygons for an enabled token light", () => {
    const token: TokenSourceConfig = {
      id: "t1",
      x: 500,
      y: 500,
      vision: { enabled: false, rangePx: null, angle: 360, rotation: 0, visionMode: "basic" },
      light: {
        id: "token-light:t1",
        x: 500,
        y: 500,
        brightPx: 100,
        dimPx: 200,
        angle: 360,
        rotation: 0,
        color: "#ffcc00",
        intensity: 0.8,
        enabled: true,
      },
      controlled: true,
    };

    const result = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    expect(result.lightPolygons).toHaveLength(1);

    const lp = result.lightPolygons[0]!;
    expect(lp.brightPolygon.vertices.length).toBeGreaterThan(2);
    expect(lp.polygon.vertices.length).toBeGreaterThan(2);
    // dim polygon should be larger than bright
    expect(lp.polygon.vertices.length).toBeGreaterThanOrEqual(lp.brightPolygon.vertices.length);
  });

  it("skips disabled token lights", () => {
    const token: TokenSourceConfig = {
      id: "t1",
      x: 500,
      y: 500,
      vision: { enabled: false, rangePx: null, angle: 360, rotation: 0, visionMode: "basic" },
      light: {
        id: "token-light:t1",
        x: 500,
        y: 500,
        brightPx: 100,
        dimPx: 200,
        angle: 360,
        rotation: 0,
        color: "#ffffff",
        intensity: 1,
        enabled: false,
      },
      controlled: true,
    };

    const result = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    expect(result.lightPolygons).toHaveLength(0);
  });

  it("light cache hit returns same polygon reference", () => {
    const token: TokenSourceConfig = {
      id: "t1",
      x: 500,
      y: 500,
      vision: { enabled: false, rangePx: null, angle: 360, rotation: 0, visionMode: "basic" },
      light: {
        id: "token-light:t1",
        x: 500,
        y: 500,
        brightPx: 100,
        dimPx: 200,
        angle: 360,
        rotation: 0,
        color: "#ffffff",
        intensity: 1,
        enabled: true,
      },
      controlled: true,
    };

    const r1 = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    const r2 = computer.compute([], [token], SCENE_BOUNDS, false, 0, false);
    expect(r1.lightPolygons[0]?.polygon).toBe(r2.lightPolygons[0]?.polygon);
  });

  it("computeAmbientLights returns light polygons for enabled lights", () => {
    const lights: LightConfig[] = [
      makeLight("l1", 300, 300, 100, 200),
      makeLight("l2", 700, 700, 50, 150),
    ];

    const result = computer.computeAmbientLights(lights, [], SCENE_BOUNDS);
    expect(result).toHaveLength(2);
    expect(result[0]?.polygon.vertices.length).toBeGreaterThan(2);
    expect(result[1]?.polygon.vertices.length).toBeGreaterThan(2);
  });

  it("computeAmbientLights skips disabled lights", () => {
    const lights: LightConfig[] = [
      makeLight("l1", 300, 300, 100, 200),
      { ...makeLight("l2", 700, 700), enabled: false },
    ];

    const result = computer.computeAmbientLights(lights, [], SCENE_BOUNDS);
    expect(result).toHaveLength(1);
    expect(result[0]?.lightId).toBe("l1");
  });

  // ---- §6 Meta fields ---

  it("passes isGm, darkness, globalLight through to result", () => {
    const result = computer.compute([], [], SCENE_BOUNDS, true, 0.7, true);
    expect(result.isGm).toBe(true);
    expect(result.darkness).toBe(0.7);
    expect(result.globalLight).toBe(true);
  });

  // ---- §7 Config builders ---

  it("buildTokenVisionConfig converts range in grid-units to pixels", () => {
    const cfg = buildTokenVisionConfig(
      { vision: { enabled: true, range: 6, angle: 90, visionMode: "darkvision" }, rotation: 45 },
      100, // 100px per grid unit
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.rangePx).toBe(600); // 6 * 100
    expect(cfg.angle).toBe(90);
    expect(cfg.rotation).toBe(45);
    expect(cfg.visionMode).toBe("darkvision");
  });

  it("buildTokenVisionConfig: null range → null rangePx", () => {
    const cfg = buildTokenVisionConfig({ vision: { enabled: true, range: null } }, 100);
    expect(cfg.rangePx).toBeNull();
  });

  it("buildTokenVisionConfig: defaults when vision is null", () => {
    const cfg = buildTokenVisionConfig({ vision: null }, 100);
    expect(cfg.enabled).toBe(false);
    expect(cfg.rangePx).toBeNull();
    expect(cfg.angle).toBe(360);
  });

  it("buildAmbientLightConfig converts radii in grid-units to pixels", () => {
    const cfg = buildAmbientLightConfig(
      {
        _id: "l1",
        x: 100,
        y: 200,
        brightRadius: 3,
        dimRadius: 6,
        color: "#ff0000",
        intensity: 0.5,
        enabled: true,
      },
      100,
    );
    expect(cfg.brightPx).toBe(300);
    expect(cfg.dimPx).toBe(600);
    expect(cfg.color).toBe("#ff0000");
    expect(cfg.intensity).toBe(0.5);
  });

  it("buildTokenLightConfig returns null when lightData is null", () => {
    const cfg = buildTokenLightConfig("t1", null, 100, 100, 100);
    expect(cfg).toBeNull();
  });

  it("buildTokenLightConfig returns null when enabled=false", () => {
    const cfg = buildTokenLightConfig(
      "t1",
      { enabled: false, brightRadius: 2, dimRadius: 4 },
      100,
      100,
      100,
    );
    expect(cfg).toBeNull();
  });

  it("buildTokenLightConfig converts radii correctly", () => {
    const cfg = buildTokenLightConfig(
      "t1",
      { enabled: true, brightRadius: 2, dimRadius: 4, color: "#aabbcc", intensity: 0.9 },
      200,
      300,
      50,
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.brightPx).toBe(100); // 2 * 50
    expect(cfg!.dimPx).toBe(200); // 4 * 50
    expect(cfg!.x).toBe(200);
    expect(cfg!.y).toBe(300);
    expect(cfg!.color).toBe("#aabbcc");
  });

  // ---- §8 invalidateLight ---

  it("invalidateLight busts the cache for a specific light", () => {
    const light = makeLight("l1", 500, 500, 100, 200);
    const r1 = computer.computeAmbientLights([light], [], SCENE_BOUNDS);
    const poly1 = r1[0]?.polygon;

    computer.invalidateLight("l1");
    const r2 = computer.computeAmbientLights([light], [], SCENE_BOUNDS);
    const poly2 = r2[0]?.polygon;

    expect(poly2).not.toBe(poly1);
    expect(poly2?.vertices.length).toBe(poly1?.vertices.length);
  });
});
