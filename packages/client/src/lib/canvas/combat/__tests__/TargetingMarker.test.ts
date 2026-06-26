/**
 * TargetingMarker.test.ts — unit tests for the pure reticle geometry.
 *
 * The PIXI Graphics drawing is not tested here (PIXI needs a browser renderer).
 * The bracket coordinate computation is extracted into computeReticleBrackets
 * so it can be validated headlessly.
 *
 * REQ-CBT-054: targeted tokens get a distinct corner-bracket reticle.
 */

import { describe, it, expect } from "vitest";
import { computeReticleBrackets } from "../TargetingMarker.js";

describe("computeReticleBrackets", () => {
  it("returns four brackets", () => {
    const brackets = computeReticleBrackets(0, 0, 100, 0.25);
    expect(brackets).toHaveLength(4);
  });

  it("inscribes brackets at the four corners of the footprint", () => {
    const x = 10;
    const y = 20;
    const size = 100;
    const armFraction = 0.3;
    const arm = size * armFraction; // 30
    const [tl, tr, br, bl] = computeReticleBrackets(x, y, size, armFraction);

    // Top-left bracket corner is the footprint's top-left (10, 20)
    expect(tl.points).toEqual([x, y + arm, x, y, x + arm, y]);
    // Top-right bracket corner is (110, 20)
    expect(tr.points).toEqual([x + size - arm, y, x + size, y, x + size, y + arm]);
    // Bottom-right corner is (110, 120)
    expect(br.points).toEqual([
      x + size,
      y + size - arm,
      x + size,
      y + size,
      x + size - arm,
      y + size,
    ]);
    // Bottom-left corner is (10, 120)
    expect(bl.points).toEqual([x + arm, y + size, x, y + size, x, y + size - arm]);
  });

  it("scales arm length with grid size", () => {
    const small = computeReticleBrackets(0, 0, 50, 0.2);
    const large = computeReticleBrackets(0, 0, 200, 0.2);
    // arm = size * fraction; the top-left horizontal arm endpoint x is arm.
    expect(small[0]!.points[4]).toBeCloseTo(10); // 50 * 0.2
    expect(large[0]!.points[4]).toBeCloseTo(40); // 200 * 0.2
  });
});
