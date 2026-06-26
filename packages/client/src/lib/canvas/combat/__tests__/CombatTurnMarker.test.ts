/**
 * CombatTurnMarker.test.ts — unit tests for the pure/logic aspects.
 *
 * We test the alpha pulse calculation logic independently of PIXI by
 * extracting the alpha formula.
 *
 * The actual PIXI construction is not tested here (PIXI requires a browser
 * renderer). The integration is validated via the canvas visual tests.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Pure pulse alpha formula (mirrored from CombatTurnMarker implementation)
// ---------------------------------------------------------------------------

function computePulseAlpha(
  time: number,
  pulsePeriod: number,
  alphaMin: number,
  alphaMax: number,
): number {
  const normTime = time % (pulsePeriod * 2);
  const t = normTime / pulsePeriod;
  const phase = t <= 1 ? t : 2 - t; // triangle wave [0..1..0]
  return alphaMin + (alphaMax - alphaMin) * phase;
}

describe("CombatTurnMarker pulse alpha", () => {
  const period = 1200;
  const min = 0.55;
  const max = 1.0;

  it("starts at min alpha at time 0", () => {
    const alpha = computePulseAlpha(0, period, min, max);
    expect(alpha).toBeCloseTo(min);
  });

  it("reaches max alpha at time == period", () => {
    const alpha = computePulseAlpha(period, period, min, max);
    expect(alpha).toBeCloseTo(max);
  });

  it("returns to min alpha at time == 2 * period", () => {
    const alpha = computePulseAlpha(period * 2, period, min, max);
    expect(alpha).toBeCloseTo(min);
  });

  it("alpha is always in [min, max] range", () => {
    for (let t = 0; t <= period * 4; t += 50) {
      const alpha = computePulseAlpha(t, period, min, max);
      expect(alpha).toBeGreaterThanOrEqual(min - 0.001);
      expect(alpha).toBeLessThanOrEqual(max + 0.001);
    }
  });

  it("wraps correctly past 2 periods", () => {
    const alpha1 = computePulseAlpha(200, period, min, max);
    const alpha2 = computePulseAlpha(200 + period * 2, period, min, max);
    expect(alpha1).toBeCloseTo(alpha2);
  });
});
