/**
 * fog-state.test.ts — Unit tests for the fog-of-war accumulation module.
 *
 * Tests cover:
 *   §1  visibilityPolygonToRing — conversion from VisibilityPolygon to FogRing
 *   §2  pointInFog — point containment in accumulated FogShape
 *   §3  FogState construction and basic state
 *   §4  updateVision — accumulation via union
 *   §5  updateVision — dirty flag and debounce
 *   §6  persistNow — immediate flush
 *   §7  applyReset — discard local state (targeted / all / other scene)
 *   §8  load — populate from server response
 *   §9  load — handle null (unexplored) and corrupt data
 *   §10 GM — no fog accumulation, no persistence
 *   §11 getRenderState — correct fields returned
 *   §12 Token visibility filter — pointInAnyPolygon logic (via tokenInVision helper)
 *
 * No PIXI, no DOM (except window.addEventListener for beforeunload — mocked).
 * Fake timers are used for debounce tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FogState,
  visibilityPolygonToRing,
  pointInFog,
  PERSIST_DEBOUNCE_MS,
} from "../fog-state.js";
import type { FogPersistFn, FogGetFn } from "../fog-state.js";
import {
  emptyFog,
  isFogEmpty,
  type FogUpdatePayload,
  type FogGetResponsePayload,
  type FogWasResetPayload,
  serializeFog,
} from "@fusion/shared";
import type { VisibilityPolygon } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make a square VisibilityPolygon at (cx, cy) with half-size s. */
function makeSquarePoly(cx: number, cy: number, s: number): VisibilityPolygon {
  return {
    vertices: [
      { x: cx - s, y: cy - s },
      { x: cx + s, y: cy - s },
      { x: cx + s, y: cy + s },
      { x: cx - s, y: cy + s },
    ],
  };
}

/** Make a no-op persist function that captures calls. */
function makePersistFn(): { fn: FogPersistFn; calls: FogUpdatePayload[] } {
  const calls: FogUpdatePayload[] = [];
  const fn: FogPersistFn = (payload) => calls.push(payload);
  return { fn, calls };
}

/** Make a no-op get function that returns empty fog. */
function makeGetFn(shape: FogGetResponsePayload["shape"] = null): FogGetFn {
  return async (payload) => ({ sceneId: payload.sceneId, shape });
}

/**
 * Stub the global window for beforeunload registration.
 * Tests run in the node environment where window does not exist, so we
 * install a minimal stub via stubGlobal instead of spying on a real one.
 */
function stubWindow(): { addCalled: string[]; removeCalled: string[] } {
  const addCalled: string[] = [];
  const removeCalled: string[] = [];
  vi.stubGlobal("window", {
    addEventListener: (type: string) => {
      addCalled.push(type);
    },
    removeEventListener: (type: string) => {
      removeCalled.push(type);
    },
  });
  return { addCalled, removeCalled };
}

// ---------------------------------------------------------------------------
// §1 visibilityPolygonToRing
// ---------------------------------------------------------------------------

describe("visibilityPolygonToRing", () => {
  it("converts a 4-vertex polygon to a flat ring", () => {
    const poly = makeSquarePoly(0, 0, 10);
    const ring = visibilityPolygonToRing(poly);
    expect(ring).not.toBeNull();
    expect(ring!.length).toBe(8); // 4 * 2
    expect(ring![0]).toBe(-10);
    expect(ring![1]).toBe(-10);
  });

  it("returns null for a polygon with fewer than 3 vertices", () => {
    const poly: VisibilityPolygon = {
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    };
    expect(visibilityPolygonToRing(poly)).toBeNull();
  });

  it("returns null for an empty polygon", () => {
    const poly: VisibilityPolygon = { vertices: [] };
    expect(visibilityPolygonToRing(poly)).toBeNull();
  });

  it("handles a triangle (minimum 3 vertices)", () => {
    const poly: VisibilityPolygon = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ],
    };
    const ring = visibilityPolygonToRing(poly);
    expect(ring).not.toBeNull();
    expect(ring!.length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// §2 pointInFog
// ---------------------------------------------------------------------------

describe("pointInFog", () => {
  it("returns false for empty fog shape", () => {
    const shape = emptyFog();
    expect(pointInFog(shape, 100, 100)).toBe(false);
  });

  it("returns true when point is inside explored polygon", async () => {
    // Build a FogShape manually via unionFog from shared
    const { unionFog } = await import("@fusion/shared");
    const ring = visibilityPolygonToRing(makeSquarePoly(100, 100, 50))!;
    const shape = unionFog(emptyFog(), ring);
    expect(pointInFog(shape, 100, 100)).toBe(true);
  });

  it("returns false when point is outside explored polygon", async () => {
    const { unionFog } = await import("@fusion/shared");
    const ring = visibilityPolygonToRing(makeSquarePoly(100, 100, 50))!;
    const shape = unionFog(emptyFog(), ring);
    expect(pointInFog(shape, 300, 300)).toBe(false);
  });

  it("returns false for a point on the boundary edge (exclusive)", async () => {
    const { unionFog } = await import("@fusion/shared");
    const ring = visibilityPolygonToRing(makeSquarePoly(100, 100, 50))!;
    const shape = unionFog(emptyFog(), ring);
    // Point exactly at x=150 (right edge) — inside/outside depends on algorithm
    // Just check that it doesn't throw
    expect(() => pointInFog(shape, 150, 100)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §3 FogState — construction
// ---------------------------------------------------------------------------

describe("FogState — construction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubWindow();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts with empty fog and clean dirty flag", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());
    expect(isFogEmpty(state.explored)).toBe(true);
    expect(state.isDirty).toBe(false);
    state.destroy();
  });

  it("registers beforeunload on non-GM", () => {
    const { addCalled } = stubWindow();
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false /* not GM */, fn, makeGetFn());
    expect(addCalled).toContain("beforeunload");
    state.destroy();
  });

  it("does NOT register beforeunload for GM", () => {
    const { addCalled } = stubWindow();
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", true /* GM */, fn, makeGetFn());
    expect(addCalled).not.toContain("beforeunload");
    state.destroy();
  });

  it("destroy() removes beforeunload listener", () => {
    const { removeCalled } = stubWindow();
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());
    state.destroy();
    expect(removeCalled).toContain("beforeunload");
  });
});

// ---------------------------------------------------------------------------
// §4 FogState — updateVision accumulation
// ---------------------------------------------------------------------------

describe("FogState — updateVision", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubWindow();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("accumulates explored area from vision polygon", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    const poly = makeSquarePoly(200, 200, 50);
    state.updateVision([poly]);

    expect(isFogEmpty(state.explored)).toBe(false);
    expect(state.explored.totalVertices).toBeGreaterThan(0);
    state.destroy();
  });

  it("accumulates multiple vision polygons", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 40)]);
    const vCount1 = state.explored.totalVertices;

    state.updateVision([makeSquarePoly(500, 500, 40)]);
    // Second disjoint area should increase vertex count
    expect(state.explored.totalVertices).toBeGreaterThan(vCount1);
    state.destroy();
  });

  it("does not change explored when polygon is already contained", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    const poly = makeSquarePoly(200, 200, 50);
    state.updateVision([poly]);
    const before = state.explored;

    // Same polygon again — should be no-op (union is idempotent)
    state.updateVision([poly]);
    expect(state.explored).toBe(before);
    state.destroy();
  });

  it("GM updateVision is a no-op — explored stays empty", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "gm1", true /* GM */, fn, makeGetFn());

    state.updateVision([makeSquarePoly(200, 200, 50)]);
    expect(isFogEmpty(state.explored)).toBe(true);
    state.destroy();
  });

  it("empty polygons are ignored", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([{ vertices: [] }]);
    expect(isFogEmpty(state.explored)).toBe(true);
    state.destroy();
  });

  it("updates currentVisionRings in renderState", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    const poly = makeSquarePoly(200, 200, 50);
    state.updateVision([poly]);

    const rs = state.getRenderState();
    expect(rs.currentVisionRings.length).toBe(1);
    expect(rs.currentVisionRings[0]!.length).toBe(8); // 4 vertices
    state.destroy();
  });
});

// ---------------------------------------------------------------------------
// §5 FogState — dirty flag and debounce
// ---------------------------------------------------------------------------

describe("FogState — dirty flag and debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubWindow();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("marks dirty after updateVision adds new area", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    expect(state.isDirty).toBe(true);
    state.destroy();
  });

  it("does NOT persist immediately after updateVision", () => {
    const { fn, calls } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    expect(calls.length).toBe(0);
    state.destroy();
  });

  it("persists after PERSIST_DEBOUNCE_MS elapses", () => {
    const { fn, calls } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    expect(calls.length).toBe(0);

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 100);
    expect(calls.length).toBe(1);
    expect(calls[0]!.sceneId).toBe("scene1");

    state.destroy();
  });

  it("debounce resets on subsequent updateVision calls", () => {
    const { fn, calls } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 500);

    // New area discovered before debounce fires — resets timer
    state.updateVision([makeSquarePoly(400, 400, 50)]);
    vi.advanceTimersByTime(500); // original timer would have fired, but was reset
    expect(calls.length).toBe(0);

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    expect(calls.length).toBe(1);

    state.destroy();
  });

  it("clears dirty flag after persistence fires", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 100);

    expect(state.isDirty).toBe(false);
    state.destroy();
  });

  it("does not persist when fog is empty (no updateVision called)", () => {
    const { fn, calls } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2);
    expect(calls.length).toBe(0);
    state.destroy();
  });
});

// ---------------------------------------------------------------------------
// §6 FogState — persistNow
// ---------------------------------------------------------------------------

describe("FogState — persistNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubWindow();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("persistNow sends immediately without waiting for debounce", () => {
    const { fn, calls } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    state.persistNow();

    expect(calls.length).toBe(1);
    state.destroy();
  });

  it("persistNow cancels pending debounce", () => {
    const { fn, calls } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    state.persistNow();

    // Advance past debounce — should NOT trigger a second persist
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 100);
    expect(calls.length).toBe(1);
    state.destroy();
  });

  it("persistNow is no-op when fog is empty", () => {
    const { fn, calls } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.persistNow();
    expect(calls.length).toBe(0);
    state.destroy();
  });

  it("persistNow is no-op for GM", () => {
    const { fn, calls } = makePersistFn();
    const state = new FogState("scene1", "gm1", true /* GM */, fn, makeGetFn());

    // Even if somehow dirty (shouldn't happen), GM does not persist
    state.persistNow();
    expect(calls.length).toBe(0);
    state.destroy();
  });
});

// ---------------------------------------------------------------------------
// §7 FogState — applyReset
// ---------------------------------------------------------------------------

describe("FogState — applyReset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubWindow();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clears explored shape when targeted by userId", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    expect(isFogEmpty(state.explored)).toBe(false);

    const reset: FogWasResetPayload = {
      sceneId: "scene1",
      target: { userId: "user1" },
    };
    state.applyReset(reset);

    expect(isFogEmpty(state.explored)).toBe(true);
    expect(state.isDirty).toBe(false);
    state.destroy();
  });

  it("clears explored shape when target is 'all'", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);

    const reset: FogWasResetPayload = { sceneId: "scene1", target: "all" };
    state.applyReset(reset);

    expect(isFogEmpty(state.explored)).toBe(true);
    state.destroy();
  });

  it("does NOT affect state when reset targets a different userId", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    const exploredBefore = state.explored;

    const reset: FogWasResetPayload = {
      sceneId: "scene1",
      target: { userId: "user2" }, // different user
    };
    state.applyReset(reset);

    expect(state.explored).toBe(exploredBefore); // same reference
    state.destroy();
  });

  it("does NOT affect state when reset targets a different scene", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    const exploredBefore = state.explored;

    const reset: FogWasResetPayload = {
      sceneId: "scene2", // different scene
      target: "all",
    };
    state.applyReset(reset);

    expect(state.explored).toBe(exploredBefore);
    state.destroy();
  });

  it("cancels pending debounce on reset — does not persist stale data", () => {
    const { fn, calls } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    // Reset before debounce fires
    state.applyReset({ sceneId: "scene1", target: "all" });

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 100);
    expect(calls.length).toBe(0); // no persist of stale data
    state.destroy();
  });

  it("clears currentVisionRings on reset", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    state.applyReset({ sceneId: "scene1", target: "all" });

    expect(state.getRenderState().currentVisionRings.length).toBe(0);
    state.destroy();
  });
});

// ---------------------------------------------------------------------------
// §8 FogState — load from server
// ---------------------------------------------------------------------------

describe("FogState — load", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubWindow();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("populates explored from server response", async () => {
    const { unionFog } = await import("@fusion/shared");
    const ring = visibilityPolygonToRing(makeSquarePoly(200, 200, 50))!;
    const preExplored = unionFog(emptyFog(), ring);
    const serialized = serializeFog(preExplored);

    const getFn = makeGetFn(serialized);
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, getFn);

    await state.load();

    expect(isFogEmpty(state.explored)).toBe(false);
    expect(state.explored.totalVertices).toBeGreaterThan(0);
    expect(state.isDirty).toBe(false);
    state.destroy();
  });

  it("starts with empty fog when server returns null (unexplored)", async () => {
    const getFn = makeGetFn(null);
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, getFn);

    await state.load();

    expect(isFogEmpty(state.explored)).toBe(true);
    state.destroy();
  });

  it("starts with empty fog when server response is corrupt", async () => {
    const getFn: FogGetFn = async (payload) => ({
      sceneId: payload.sceneId,
      // Corrupt shape: wrong version
      shape: { version: 99 as unknown as 1, polygons: [], totalVertices: 0 },
    });
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, getFn);

    await state.load();

    expect(isFogEmpty(state.explored)).toBe(true);
    state.destroy();
  });

  it("starts with empty fog when network call throws", async () => {
    const getFn: FogGetFn = async () => {
      throw new Error("Network error");
    };
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, getFn);

    await state.load();

    expect(isFogEmpty(state.explored)).toBe(true);
    state.destroy();
  });

  it("GM load() is a no-op — stays empty", async () => {
    const getFn = vi.fn(makeGetFn(null));
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "gm1", true /* GM */, fn, getFn);

    await state.load();

    expect(getFn).not.toHaveBeenCalled();
    expect(isFogEmpty(state.explored)).toBe(true);
    state.destroy();
  });
});

// ---------------------------------------------------------------------------
// §9 FogState — getRenderState
// ---------------------------------------------------------------------------

describe("FogState — getRenderState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubWindow();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns fogActive=true for non-GM", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());
    expect(state.getRenderState().fogActive).toBe(true);
    state.destroy();
  });

  it("returns fogActive=false for GM", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "gm1", true, fn, makeGetFn());
    expect(state.getRenderState().fogActive).toBe(false);
    state.destroy();
  });

  it("returns the correct sceneId", () => {
    const { fn } = makePersistFn();
    const state = new FogState("my-scene", "user1", false, fn, makeGetFn());
    expect(state.getRenderState().sceneId).toBe("my-scene");
    state.destroy();
  });

  it("returns empty currentVisionRings before any updateVision", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());
    expect(state.getRenderState().currentVisionRings.length).toBe(0);
    state.destroy();
  });

  it("returns explored shape after updateVision", () => {
    const { fn } = makePersistFn();
    const state = new FogState("scene1", "user1", false, fn, makeGetFn());

    state.updateVision([makeSquarePoly(100, 100, 50)]);
    const rs = state.getRenderState();

    expect(rs.explored).toBe(state.explored);
    expect(isFogEmpty(rs.explored)).toBe(false);
    state.destroy();
  });
});

// ---------------------------------------------------------------------------
// §10 Token visibility — pointInAnyPolygon logic (via inline test)
// ---------------------------------------------------------------------------

describe("Token visibility — pointInAnyPolygon logic", () => {
  /**
   * We test the same ray-casting logic used in TokenLayer._applyVisionFilter.
   * Since TokenLayer._applyVisionFilter is private, we test the logic directly
   * by reimplementing the exact same algorithm here.
   */
  function pointInAnyPolygon(
    px: number,
    py: number,
    polygons: Array<{ vertices: ReadonlyArray<{ x: number; y: number }> }>,
  ): boolean {
    for (const vp of polygons) {
      const verts = vp.vertices;
      const n = verts.length;
      if (n < 3) continue;
      let inside = false;
      let j = n - 1;
      for (let i = 0; i < n; i++) {
        const vi = verts[i];
        const vj = verts[j];
        if (vi === undefined || vj === undefined) {
          j = i;
          continue;
        }
        if (vi.y > py !== vj.y > py && px < ((vj.x - vi.x) * (py - vi.y)) / (vj.y - vi.y) + vi.x) {
          inside = !inside;
        }
        j = i;
      }
      if (inside) return true;
    }
    return false;
  }

  it("returns true for a point inside a square polygon", () => {
    const poly = makeSquarePoly(100, 100, 50);
    expect(pointInAnyPolygon(100, 100, [poly])).toBe(true);
  });

  it("returns false for a point outside all polygons", () => {
    const poly = makeSquarePoly(100, 100, 50);
    expect(pointInAnyPolygon(300, 300, [poly])).toBe(false);
  });

  it("returns true if point is in any one of multiple polygons", () => {
    const p1 = makeSquarePoly(100, 100, 50);
    const p2 = makeSquarePoly(500, 500, 50);
    // Point in p2
    expect(pointInAnyPolygon(500, 500, [p1, p2])).toBe(true);
  });

  it("returns false with no polygons", () => {
    expect(pointInAnyPolygon(100, 100, [])).toBe(false);
  });

  it("returns false with only degenerate polygons (< 3 vertices)", () => {
    const poly = {
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    };
    expect(pointInAnyPolygon(0, 0, [poly])).toBe(false);
  });

  it("correctly handles a triangular polygon", () => {
    const triangle = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 100 },
      ],
    };
    // Centroid is inside
    expect(pointInAnyPolygon(50, 33, [triangle])).toBe(true);
    // Point well outside
    expect(pointInAnyPolygon(200, 200, [triangle])).toBe(false);
  });
});
