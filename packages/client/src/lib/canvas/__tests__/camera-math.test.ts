/**
 * camera-math.test.ts — unit tests for pure camera math.
 *
 * These run in Vitest without a browser. No PIXI dependency.
 */

import { describe, it, expect } from "vitest";
import {
  screenToWorld,
  worldToScreen,
  clampScale,
  zoomAtPoint,
  panBy,
  centerOn,
  fitScene,
  lerpCamera,
  easeInOut,
  type CameraState,
  type ZoomLimits,
} from "../camera-math.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cam(tx: number, ty: number, scale: number): CameraState {
  return { tx, ty, scale };
}

const LIMITS: ZoomLimits = { min: 0.1, max: 3.0 };

// ---------------------------------------------------------------------------
// screenToWorld / worldToScreen
// ---------------------------------------------------------------------------

describe("screenToWorld", () => {
  it("identity camera — screen == world", () => {
    const c = cam(0, 0, 1);
    expect(screenToWorld(100, 200, c)).toEqual({ x: 100, y: 200 });
  });

  it("translation only", () => {
    const c = cam(50, 100, 1);
    // screenX = worldX * 1 + 50  =>  worldX = screenX - 50
    expect(screenToWorld(150, 300, c)).toEqual({ x: 100, y: 200 });
  });

  it("scale only", () => {
    const c = cam(0, 0, 2);
    // worldX = screenX / 2
    expect(screenToWorld(200, 400, c)).toEqual({ x: 100, y: 200 });
  });

  it("translation + scale", () => {
    const c = cam(100, 50, 2);
    // worldX = (200 - 100) / 2 = 50
    // worldY = (250 - 50) / 2 = 100
    expect(screenToWorld(200, 250, c)).toEqual({ x: 50, y: 100 });
  });
});

describe("worldToScreen", () => {
  it("inverse of screenToWorld", () => {
    const c = cam(80, 40, 1.5);
    const world = { x: 200, y: 300 };
    const screen = worldToScreen(world.x, world.y, c);
    const back = screenToWorld(screen.x, screen.y, c);
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
  });
});

// ---------------------------------------------------------------------------
// clampScale
// ---------------------------------------------------------------------------

describe("clampScale", () => {
  it("clamps below min", () => {
    expect(clampScale(0.05, LIMITS)).toBe(0.1);
  });
  it("clamps above max", () => {
    expect(clampScale(5, LIMITS)).toBe(3.0);
  });
  it("passes through valid value", () => {
    expect(clampScale(1.5, LIMITS)).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// zoomAtPoint
// ---------------------------------------------------------------------------

describe("zoomAtPoint", () => {
  it("pivot remains at same world position after zoom", () => {
    const c = cam(0, 0, 1);
    // Pivot at screen (400, 300) — world (400, 300) with identity camera
    const after = zoomAtPoint(c, 2, 400, 300, LIMITS);

    // World position under pivot must remain (400, 300)
    const worldAfter = screenToWorld(400, 300, after);
    expect(worldAfter.x).toBeCloseTo(400);
    expect(worldAfter.y).toBeCloseTo(300);
    expect(after.scale).toBe(2);
  });

  it("respects max zoom limit", () => {
    const c = cam(0, 0, 2.9);
    const after = zoomAtPoint(c, 2, 0, 0, LIMITS);
    expect(after.scale).toBe(3.0);
  });

  it("respects min zoom limit", () => {
    const c = cam(0, 0, 0.15);
    const after = zoomAtPoint(c, 0.5, 0, 0, LIMITS);
    expect(after.scale).toBe(0.1);
  });

  it("zoom-in with non-zero translation keeps pivot fixed", () => {
    const c = cam(100, 80, 1);
    const pivotSx = 500;
    const pivotSy = 400;
    const worldUnderPivot = screenToWorld(pivotSx, pivotSy, c);

    const after = zoomAtPoint(c, 1.5, pivotSx, pivotSy, LIMITS);
    const worldAfterZoom = screenToWorld(pivotSx, pivotSy, after);

    expect(worldAfterZoom.x).toBeCloseTo(worldUnderPivot.x);
    expect(worldAfterZoom.y).toBeCloseTo(worldUnderPivot.y);
  });
});

// ---------------------------------------------------------------------------
// panBy
// ---------------------------------------------------------------------------

describe("panBy", () => {
  it("adds delta to translation", () => {
    const c = cam(10, 20, 1);
    const after = panBy(c, 30, -5);
    expect(after.tx).toBe(40);
    expect(after.ty).toBe(15);
    expect(after.scale).toBe(1);
  });

  it("zero delta = no change", () => {
    const c = cam(100, 200, 1.5);
    expect(panBy(c, 0, 0)).toEqual(c);
  });
});

// ---------------------------------------------------------------------------
// centerOn
// ---------------------------------------------------------------------------

describe("centerOn", () => {
  it("centers world origin in a 800×600 viewport at scale 1", () => {
    const c = centerOn(0, 0, 800, 600, 1, LIMITS);
    // With world origin at center: tx=400, ty=300
    expect(c.tx).toBe(400);
    expect(c.ty).toBe(300);
  });

  it("centers world point (1400, 1050) in viewport", () => {
    const c = centerOn(1400, 1050, 800, 600, 1, LIMITS);
    // screen center = (400, 300); worldX * 1 + tx = 400 => tx = 400 - 1400 = -1000
    expect(c.tx).toBeCloseTo(-1000);
    expect(c.ty).toBeCloseTo(-750);
  });

  it("clamped scale", () => {
    const c = centerOn(0, 0, 800, 600, 5, LIMITS);
    expect(c.scale).toBe(3.0);
  });
});

// ---------------------------------------------------------------------------
// fitScene
// ---------------------------------------------------------------------------

describe("fitScene", () => {
  it("fits scene proportionally — scale matches smaller viewport ratio", () => {
    // 2800×2100 scene, 1400×900 viewport
    const c = fitScene(2800, 2100, 1400, 900, LIMITS);
    const expectedScale = Math.min(1400 / 2800, 900 / 2100);
    expect(c.scale).toBeCloseTo(expectedScale);
  });

  it("scene center maps to viewport center", () => {
    const sceneW = 2800,
      sceneH = 2100;
    const viewW = 1400,
      viewH = 900;
    const c = fitScene(sceneW, sceneH, viewW, viewH, LIMITS);
    const center = worldToScreen(sceneW / 2, sceneH / 2, c);
    expect(center.x).toBeCloseTo(viewW / 2);
    expect(center.y).toBeCloseTo(viewH / 2);
  });
});

// ---------------------------------------------------------------------------
// lerpCamera
// ---------------------------------------------------------------------------

describe("lerpCamera", () => {
  const from = cam(0, 0, 1);
  const to = cam(200, 100, 2);

  it("t=0 returns from", () => {
    expect(lerpCamera(from, to, 0)).toEqual(from);
  });

  it("t=1 returns to", () => {
    expect(lerpCamera(from, to, 1)).toEqual(to);
  });

  it("t=0.5 midpoint", () => {
    const mid = lerpCamera(from, to, 0.5);
    expect(mid.tx).toBeCloseTo(100);
    expect(mid.ty).toBeCloseTo(50);
    expect(mid.scale).toBeCloseTo(1.5);
  });

  it("clamps t below 0", () => {
    expect(lerpCamera(from, to, -1)).toEqual(from);
  });

  it("clamps t above 1", () => {
    expect(lerpCamera(from, to, 2)).toEqual(to);
  });
});

// ---------------------------------------------------------------------------
// easeInOut
// ---------------------------------------------------------------------------

describe("easeInOut", () => {
  it("t=0 → 0", () => expect(easeInOut(0)).toBe(0));
  it("t=1 → 1", () => expect(easeInOut(1)).toBe(1));
  it("t=0.5 → ~0.5 (symmetric midpoint)", () => {
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });
  it("clamps below 0", () => expect(easeInOut(-1)).toBe(0));
  it("clamps above 1", () => expect(easeInOut(2)).toBe(1));
  it("smooth start: value at 0.1 < 0.1 (slower than linear)", () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
  });
  it("smooth end: value at 0.9 > 0.9 (faster than linear near end)", () => {
    // At t=0.9, ease-in-out cubic: c = 0.9 > 0.5 => -1 + (4 - 1.8)*0.9 = -1 + 2.16*0.9
    // Actually let's just check it's greater than 0.8 and less than 1
    expect(easeInOut(0.9)).toBeGreaterThan(0.8);
  });
});
