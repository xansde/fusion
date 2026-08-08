/**
 * pingRings — the animation curve of a map ping, asserted without a GPU.
 *
 * The visual is the whole feature here: a ping that draws nothing, draws
 * forever, or draws at the wrong place is indistinguishable from the ping
 * that never shipped. These tests pin the shape of the ripple.
 */

import { describe, it, expect } from "vitest";
import { pingRings } from "../PingLayer.js";

const DURATION = 2000;
const MAX_RADIUS = 90;

describe("the ripple over its lifetime", () => {
  it("draws nothing before it starts", () => {
    expect(pingRings(-1, DURATION, MAX_RADIUS)).toEqual([]);
  });

  it("draws nothing once the duration is over", () => {
    expect(pingRings(DURATION, DURATION, MAX_RADIUS)).toEqual([]);
    expect(pingRings(DURATION * 10, DURATION, MAX_RADIUS)).toEqual([]);
  });

  it("draws something for every moment in between", () => {
    for (let t = 1; t < DURATION; t += 25) {
      expect(pingRings(t, DURATION, MAX_RADIUS).length).toBeGreaterThan(0);
    }
  });

  it("never exceeds the requested radius", () => {
    for (let t = 0; t < DURATION; t += 10) {
      for (const ring of pingRings(t, DURATION, MAX_RADIUS)) {
        expect(ring.radius).toBeLessThanOrEqual(MAX_RADIUS);
        expect(ring.radius).toBeGreaterThan(0);
      }
    }
  });

  it("keeps alpha inside [0,1] at all times", () => {
    for (let t = 0; t < DURATION; t += 10) {
      for (const ring of pingRings(t, DURATION, MAX_RADIUS)) {
        expect(ring.alpha).toBeGreaterThan(0);
        expect(ring.alpha).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("the shape of the animation", () => {
  it("expands: the leading ring grows monotonically", () => {
    let previous = 0;
    for (let t = 10; t < DURATION; t += 50) {
      const leading = pingRings(t, DURATION, MAX_RADIUS)[0];
      expect(leading).toBeDefined();
      expect(leading?.radius ?? 0).toBeGreaterThan(previous);
      previous = leading?.radius ?? 0;
    }
  });

  it("fades: the leading ring dims as it grows", () => {
    const early = pingRings(200, DURATION, MAX_RADIUS)[0];
    const late = pingRings(1800, DURATION, MAX_RADIUS)[0];
    expect(early?.alpha ?? 0).toBeGreaterThan(late?.alpha ?? 1);
  });

  it("staggers: rings chase each other, the leading one is the largest", () => {
    const rings = pingRings(DURATION * 0.5, DURATION, MAX_RADIUS);
    expect(rings.length).toBeGreaterThan(1);
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i]?.radius ?? 0).toBeLessThan(rings[i - 1]?.radius ?? 0);
    }
  });

  it("scales with the radius it is given, so the grid sets the ping size", () => {
    const small = pingRings(500, DURATION, 50);
    const big = pingRings(500, DURATION, 200);
    expect(small.length).toBe(big.length);
    expect((big[0]?.radius ?? 0) / (small[0]?.radius ?? 1)).toBeCloseTo(4, 5);
  });
});

describe("degenerate inputs", () => {
  it("survives a zero duration instead of dividing by it", () => {
    expect(pingRings(0, 0, MAX_RADIUS)).toEqual([]);
  });

  it("survives a negative duration", () => {
    expect(pingRings(10, -100, MAX_RADIUS)).toEqual([]);
  });
});
