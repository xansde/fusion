/**
 * Tests for throttle utilities (pure functions).
 *
 * M1-E.
 */

import { describe, it, expect } from "vitest";
import { createThrottleState, shouldThrottle, movedSignificantly } from "../throttle.js";

// ---------------------------------------------------------------------------
// shouldThrottle
// ---------------------------------------------------------------------------

describe("shouldThrottle", () => {
  it("allows the first call (leading edge)", () => {
    const state = createThrottleState();
    expect(shouldThrottle(state, 30, 1000)).toBe(false);
  });

  it("throttles a second call within the interval", () => {
    const state = createThrottleState();
    shouldThrottle(state, 30, 1000); // first: allowed
    expect(shouldThrottle(state, 30, 1010)).toBe(true); // 10ms later: throttled
  });

  it("allows a call after the interval expires", () => {
    const state = createThrottleState();
    shouldThrottle(state, 30, 1000); // first: allowed
    expect(shouldThrottle(state, 30, 1031)).toBe(false); // 31ms later: allowed
  });

  it("updates lastFiredMs on allowed calls", () => {
    const state = createThrottleState();
    shouldThrottle(state, 30, 1000);
    shouldThrottle(state, 30, 1031); // second allowed at t=1031
    expect(shouldThrottle(state, 30, 1050)).toBe(true); // 19ms after second — throttled
    expect(shouldThrottle(state, 30, 1062)).toBe(false); // 31ms after second — allowed
  });

  it("allows exactly at the interval boundary", () => {
    const state = createThrottleState();
    shouldThrottle(state, 30, 1000);
    expect(shouldThrottle(state, 30, 1030)).toBe(false); // exactly 30ms
  });
});

// ---------------------------------------------------------------------------
// movedSignificantly
// ---------------------------------------------------------------------------

describe("movedSignificantly", () => {
  it("returns false when position unchanged", () => {
    expect(movedSignificantly(100, 100, 100, 100)).toBe(false);
  });

  it("returns false for tiny movement below threshold", () => {
    // Default threshold = 2, so distance must be >= 2
    expect(movedSignificantly(100, 100, 101, 100)).toBe(false); // dx=1, distance=1 < 2
  });

  it("returns true for movement at threshold", () => {
    expect(movedSignificantly(100, 100, 102, 100)).toBe(true); // dx=2, distance=2 >= 2
  });

  it("returns true for diagonal movement", () => {
    // sqrt(2) ≈ 1.41, less than threshold=2 → false
    expect(movedSignificantly(0, 0, 1, 1)).toBe(false);
    // sqrt(8) ≈ 2.83, greater than threshold=2 → true
    expect(movedSignificantly(0, 0, 2, 2)).toBe(true);
  });

  it("respects custom threshold", () => {
    expect(movedSignificantly(0, 0, 5, 0, 10)).toBe(false); // 5 < 10
    expect(movedSignificantly(0, 0, 10, 0, 10)).toBe(true); // 10 >= 10
  });
});
