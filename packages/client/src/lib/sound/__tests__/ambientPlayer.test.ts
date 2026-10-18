/**
 * ambientPlayer.test.ts — unit tests for the pure decision functions in
 * ambientPlayer.ts: loopOffsetSeconds() and shouldRestart().
 *
 * The AmbientPlayer class itself (Howler-touching) is intentionally NOT
 * unit tested here — same convention as sceneLoader.ts/TokenSprite.ts,
 * which extract pure logic for testing and leave the asset/DOM-touching
 * code unverified by Vitest (no browser Audio/AudioContext under Node).
 */

import { describe, it, expect } from "vitest";
import { loopOffsetSeconds, shouldRestart } from "../ambientPlayer.js";

describe("loopOffsetSeconds", () => {
  it("returns 0 right at the start", () => {
    expect(loopOffsetSeconds(1000, 1000, 60)).toBe(0);
  });

  it("returns the elapsed seconds mid-loop", () => {
    expect(loopOffsetSeconds(1000, 1000 + 30_000, 60)).toBe(30);
  });

  it("wraps around past one full loop", () => {
    // 90s elapsed, 60s duration → 30s into the second loop.
    expect(loopOffsetSeconds(0, 90_000, 60)).toBe(30);
  });

  it("wraps around past several full loops", () => {
    // 250s elapsed, 60s duration → 250 % 60 = 10.
    expect(loopOffsetSeconds(0, 250_000, 60)).toBe(10);
  });

  it("returns 0 when duration is 0", () => {
    expect(loopOffsetSeconds(0, 90_000, 0)).toBe(0);
  });

  it("returns 0 when duration is negative", () => {
    expect(loopOffsetSeconds(0, 90_000, -5)).toBe(0);
  });

  it("normalizes negative elapsed time (clock skew) into [0, duration)", () => {
    // now is BEFORE startedAt — should not return a negative offset.
    const offset = loopOffsetSeconds(10_000, 1_000, 60);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(60);
  });
});

describe("shouldRestart", () => {
  it("is false when both prev and next are null (silence stays silence)", () => {
    expect(shouldRestart(null, null)).toBe(false);
  });

  it("is true when going from silence to a track", () => {
    expect(shouldRestart(null, { src: "a.mp3", startedAt: 1 })).toBe(true);
  });

  it("is true when going from a track to silence", () => {
    expect(shouldRestart({ src: "a.mp3", startedAt: 1 }, null)).toBe(true);
  });

  it("is false for the exact same src+startedAt (idempotent — no restart, no skip)", () => {
    const prev = { src: "a.mp3", startedAt: 1000 };
    const next = { src: "a.mp3", startedAt: 1000 };
    expect(shouldRestart(prev, next)).toBe(false);
  });

  it("is true when the src changes (same startedAt)", () => {
    expect(
      shouldRestart({ src: "a.mp3", startedAt: 1000 }, { src: "b.mp3", startedAt: 1000 }),
    ).toBe(true);
  });

  it("is true when startedAt changes (same src — GM restarted the same track)", () => {
    expect(
      shouldRestart({ src: "a.mp3", startedAt: 1000 }, { src: "a.mp3", startedAt: 2000 }),
    ).toBe(true);
  });
});
