/**
 * Tests for cursor interpolation logic (pure functions).
 *
 * M1-E.
 */

import { describe, it, expect } from "vitest";
import {
  lerp,
  lerpFactor,
  interpolateCursor,
  applyCursorUpdate,
  pruneStale,
  CURSOR_STALE_MS,
} from "../cursorInterpolation.js";
import type { RemoteCursor } from "../types.js";

// ---------------------------------------------------------------------------
// lerp
// ---------------------------------------------------------------------------

describe("lerp", () => {
  it("returns a when t=0", () => {
    expect(lerp(0, 100, 0)).toBe(0);
    expect(lerp(10, 50, 0)).toBe(10);
  });

  it("returns b when t=1", () => {
    expect(lerp(0, 100, 1)).toBe(100);
    expect(lerp(10, 50, 1)).toBe(50);
  });

  it("returns midpoint when t=0.5", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(20, 40, 0.5)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// lerpFactor
// ---------------------------------------------------------------------------

describe("lerpFactor", () => {
  it("returns a value between 0 and 1", () => {
    const f = lerpFactor(16.7);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThanOrEqual(1);
  });

  it("larger deltaMs gives larger factor", () => {
    const f1 = lerpFactor(10);
    const f2 = lerpFactor(100);
    expect(f2).toBeGreaterThan(f1);
  });

  it("clamps to 1 for very large deltaMs", () => {
    expect(lerpFactor(10000)).toBe(1);
  });

  it("returns near 0 for deltaMs=0", () => {
    expect(lerpFactor(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// interpolateCursor
// ---------------------------------------------------------------------------

describe("interpolateCursor", () => {
  it("moves cursor toward target", () => {
    const cursor: RemoteCursor = {
      userId: "u1",
      x: 0,
      y: 0,
      targetX: 100,
      targetY: 100,
      color: "#ff0000",
      lastUpdatedMs: 1000,
    };

    const next = interpolateCursor(cursor, 16.7);
    // Should have moved closer to target
    expect(next.x).toBeGreaterThan(0);
    expect(next.y).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(100);
    expect(next.y).toBeLessThan(100);
  });

  it("does not move if already at target", () => {
    const cursor: RemoteCursor = {
      userId: "u1",
      x: 50,
      y: 50,
      targetX: 50,
      targetY: 50,
      color: "#ff0000",
      lastUpdatedMs: 1000,
    };

    const next = interpolateCursor(cursor, 16.7);
    expect(next.x).toBeCloseTo(50);
    expect(next.y).toBeCloseTo(50);
  });

  it("preserves other cursor properties", () => {
    const cursor: RemoteCursor = {
      userId: "u1",
      userName: "Alice",
      x: 0,
      y: 0,
      targetX: 100,
      targetY: 100,
      color: "#aabbcc",
      lastUpdatedMs: 9999,
    };

    const next = interpolateCursor(cursor, 16.7);
    expect(next.userId).toBe("u1");
    expect(next.userName).toBe("Alice");
    expect(next.color).toBe("#aabbcc");
    expect(next.lastUpdatedMs).toBe(9999);
  });
});

// ---------------------------------------------------------------------------
// applyCursorUpdate
// ---------------------------------------------------------------------------

describe("applyCursorUpdate", () => {
  it("creates a new cursor at target position when none exists", () => {
    const cursor = applyCursorUpdate(undefined, { userId: "u1", x: 100, y: 200 }, 5000);
    expect(cursor.userId).toBe("u1");
    expect(cursor.x).toBe(100);
    expect(cursor.y).toBe(200);
    expect(cursor.targetX).toBe(100);
    expect(cursor.targetY).toBe(200);
    expect(cursor.lastUpdatedMs).toBe(5000);
  });

  it("updates target but keeps current position for existing cursor", () => {
    const existing: RemoteCursor = {
      userId: "u1",
      x: 50,
      y: 50,
      targetX: 50,
      targetY: 50,
      color: "#ff0000",
      lastUpdatedMs: 4000,
    };

    const updated = applyCursorUpdate(existing, { userId: "u1", x: 150, y: 250 }, 5000);
    // Current position stays
    expect(updated.x).toBe(50);
    expect(updated.y).toBe(50);
    // Target updated
    expect(updated.targetX).toBe(150);
    expect(updated.targetY).toBe(250);
    expect(updated.lastUpdatedMs).toBe(5000);
  });

  it("uses default color when none provided for new cursor", () => {
    const cursor = applyCursorUpdate(undefined, { userId: "u1", x: 0, y: 0 }, 5000);
    expect(cursor.color).toBeDefined();
    expect(cursor.color.length).toBeGreaterThan(0);
  });

  it("updates color from server update", () => {
    const existing: RemoteCursor = {
      userId: "u1",
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      color: "#ff0000",
      lastUpdatedMs: 4000,
    };

    const updated = applyCursorUpdate(
      existing,
      { userId: "u1", x: 10, y: 10, color: "#00ff00" },
      5000,
    );
    expect(updated.color).toBe("#00ff00");
  });
});

// ---------------------------------------------------------------------------
// pruneStale
// ---------------------------------------------------------------------------

describe("pruneStale", () => {
  it("removes cursors older than CURSOR_STALE_MS", () => {
    const now = 10000;
    const cursors = new Map<string, RemoteCursor>([
      [
        "fresh",
        {
          userId: "fresh",
          x: 0,
          y: 0,
          targetX: 0,
          targetY: 0,
          color: "#fff",
          lastUpdatedMs: now - 100,
        },
      ],
      [
        "stale",
        {
          userId: "stale",
          x: 0,
          y: 0,
          targetX: 0,
          targetY: 0,
          color: "#fff",
          lastUpdatedMs: now - CURSOR_STALE_MS - 1,
        },
      ],
    ]);

    const result = pruneStale(cursors, now);
    expect(result.has("fresh")).toBe(true);
    expect(result.has("stale")).toBe(false);
  });

  it("keeps all cursors if none are stale", () => {
    const now = 10000;
    const cursors = new Map<string, RemoteCursor>([
      [
        "a",
        {
          userId: "a",
          x: 0,
          y: 0,
          targetX: 0,
          targetY: 0,
          color: "#fff",
          lastUpdatedMs: now - 100,
        },
      ],
      [
        "b",
        {
          userId: "b",
          x: 0,
          y: 0,
          targetX: 0,
          targetY: 0,
          color: "#fff",
          lastUpdatedMs: now - 200,
        },
      ],
    ]);

    const result = pruneStale(cursors, now);
    expect(result.size).toBe(2);
  });

  it("does not mutate the original map", () => {
    const now = 10000;
    const stale: RemoteCursor = {
      userId: "s",
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      color: "#fff",
      lastUpdatedMs: now - CURSOR_STALE_MS - 1,
    };
    const cursors = new Map<string, RemoteCursor>([["s", stale]]);
    pruneStale(cursors, now);
    // Original unchanged
    expect(cursors.has("s")).toBe(true);
  });
});
