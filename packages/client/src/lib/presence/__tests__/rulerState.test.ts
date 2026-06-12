/**
 * Tests for RulerStateMachine (pure logic, no PIXI, no DOM).
 *
 * M1-E.
 */

import { describe, it, expect } from "vitest";
import { RulerStateMachine, formatDistance } from "../rulerState.js";

// ---------------------------------------------------------------------------
// Default config for tests (square grid, 5 ft per cell, 100px cells)
// ---------------------------------------------------------------------------

const defaultConfig = {
  gridSize: 100,
  gridDistance: 5,
  diagonalRule: "equidistant" as const,
  offsetX: 0,
  offsetY: 0,
  units: "ft",
};

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

describe("RulerStateMachine — state transitions", () => {
  it("starts in idle mode", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    expect(ruler.mode).toBe("idle");
  });

  it("transitions to measuring on startMeasuring", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    ruler.startMeasuring({ x: 0, y: 0 });
    expect(ruler.mode).toBe("measuring");
  });

  it("sets initial waypoint on startMeasuring", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    ruler.startMeasuring({ x: 50, y: 75 });
    expect(ruler.waypoints).toHaveLength(1);
    expect(ruler.waypoints[0]).toEqual({ x: 50, y: 75 });
  });

  it("returns to idle on clear", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    ruler.startMeasuring({ x: 0, y: 0 });
    ruler.clear();
    expect(ruler.mode).toBe("idle");
    expect(ruler.waypoints).toHaveLength(0);
    expect(ruler.livePoint).toBeNull();
  });

  it("ignores updateLive when idle", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    ruler.updateLive({ x: 100, y: 100 });
    expect(ruler.livePoint).toBeNull();
  });

  it("updates livePoint while measuring", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    ruler.startMeasuring({ x: 0, y: 0 });
    ruler.updateLive({ x: 100, y: 200 });
    expect(ruler.livePoint).toEqual({ x: 100, y: 200 });
  });

  it("adds waypoint on addWaypoint", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    ruler.startMeasuring({ x: 0, y: 0 });
    ruler.addWaypoint({ x: 300, y: 0 });
    expect(ruler.waypoints).toHaveLength(2);
    expect(ruler.waypoints[1]).toEqual({ x: 300, y: 0 });
  });

  it("ignores addWaypoint when idle", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    ruler.addWaypoint({ x: 100, y: 100 });
    expect(ruler.waypoints).toHaveLength(0);
  });
});

describe("RulerStateMachine — snapshot", () => {
  it("returns zero distance when idle", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    const snap = ruler.snapshot();
    expect(snap.totalDistance).toBe(0);
    expect(snap.distanceLabel).toBe("");
  });

  it("computes correct distance for one segment", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    // Start at cell (0,0), live point at cell (2,0) → 2 cells = 10 ft
    ruler.startMeasuring({ x: 50, y: 50 }); // center of cell (0,0)
    ruler.updateLive({ x: 250, y: 50 }); // center of cell (2,0)

    const snap = ruler.snapshot();
    // equidistant rule, 2 cells apart, gridDistance=5 → 10 ft
    expect(snap.totalDistance).toBe(10);
    expect(snap.distanceLabel).toBe("10 ft");
  });

  it("computes correct distance across waypoints", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    // (0,0) → (1,0) → (2,0) via waypoint = 2 cells = 10 ft
    ruler.startMeasuring({ x: 50, y: 50 });
    ruler.addWaypoint({ x: 150, y: 50 }); // 1 cell to the right
    ruler.updateLive({ x: 250, y: 50 }); // 1 more cell

    const snap = ruler.snapshot();
    expect(snap.totalDistance).toBe(10);
  });

  it("returns mode correctly in snapshot", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    expect(ruler.snapshot().mode).toBe("idle");
    ruler.startMeasuring({ x: 0, y: 0 });
    expect(ruler.snapshot().mode).toBe("measuring");
  });
});

describe("RulerStateMachine — broadcastWaypoints", () => {
  it("returns empty when idle", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    expect(ruler.broadcastWaypoints()).toHaveLength(0);
  });

  it("includes all waypoints plus live point", () => {
    const ruler = new RulerStateMachine(defaultConfig);
    ruler.startMeasuring({ x: 0, y: 0 });
    ruler.addWaypoint({ x: 100, y: 0 });
    ruler.updateLive({ x: 200, y: 100 });

    const pts = ruler.broadcastWaypoints();
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[1]).toEqual({ x: 100, y: 0 });
    expect(pts[2]).toEqual({ x: 200, y: 100 });
  });
});

// ---------------------------------------------------------------------------
// formatDistance
// ---------------------------------------------------------------------------

describe("formatDistance", () => {
  it("formats zero distance", () => {
    expect(formatDistance(0, "ft")).toBe("0 ft");
  });

  it("formats positive distance with default decimals", () => {
    expect(formatDistance(15, "ft")).toBe("15 ft");
    expect(formatDistance(7.5, "ft")).toBe("8 ft");
  });

  it("formats with custom decimals", () => {
    expect(formatDistance(7.5, "m", 1)).toBe("7.5 m");
  });

  it("works with different units", () => {
    expect(formatDistance(10, "m")).toBe("10 m");
  });
});
