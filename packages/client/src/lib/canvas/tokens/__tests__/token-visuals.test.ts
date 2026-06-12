/**
 * token-visuals.test.ts — unit tests for pure token visual logic.
 *
 * No PIXI, no DOM. Safe under Vitest node environment.
 */

import { describe, it, expect } from "vitest";
import {
  dispositionColor,
  DISPOSITION_COLORS,
  SECRET_RING_COLOR,
  placeholderColor,
  placeholderInitials,
  tokenPixelSize,
  tokenCenter,
  computeLod,
  LOD_THRESHOLDS,
  animDuration,
  MAX_ANIM_DURATION_MS,
  easeInOut,
  lerpPosition,
  stepAnimation,
  formatElevation,
  tokenAlpha,
  HIDDEN_ALPHA,
  barFraction,
  barYOffset,
  BAR_HEIGHT_PX,
  BAR_GAP_PX,
  isInViewport,
} from "../token-visuals.js";

// ---------------------------------------------------------------------------
// dispositionColor
// ---------------------------------------------------------------------------

describe("dispositionColor", () => {
  it("returns hostile (red) for -1", () => {
    expect(dispositionColor(-1)).toBe(DISPOSITION_COLORS[-1]);
  });

  it("returns neutral (yellow) for 0", () => {
    expect(dispositionColor(0)).toBe(DISPOSITION_COLORS[0]);
  });

  it("returns friendly (green) for 1", () => {
    expect(dispositionColor(1)).toBe(DISPOSITION_COLORS[1]);
  });

  it("returns secret gray for unknown values", () => {
    expect(dispositionColor(99)).toBe(SECRET_RING_COLOR);
    expect(dispositionColor(2)).toBe(SECRET_RING_COLOR);
  });
});

// ---------------------------------------------------------------------------
// placeholderColor
// ---------------------------------------------------------------------------

describe("placeholderColor", () => {
  it("returns a number from the palette", () => {
    const color = placeholderColor("Aragorn");
    expect(typeof color).toBe("number");
    expect(color).toBeGreaterThanOrEqual(0);
  });

  it("is stable (same name → same color)", () => {
    expect(placeholderColor("Legolas")).toBe(placeholderColor("Legolas"));
  });

  it("handles empty name", () => {
    expect(typeof placeholderColor("")).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// placeholderInitials
// ---------------------------------------------------------------------------

describe("placeholderInitials", () => {
  it("returns first and last word initials", () => {
    expect(placeholderInitials("Frodo Baggins")).toBe("FB");
  });

  it("returns single initial for single word", () => {
    expect(placeholderInitials("Gandalf")).toBe("G");
  });

  it("returns ? for empty name", () => {
    expect(placeholderInitials("")).toBe("?");
    expect(placeholderInitials("   ")).toBe("?");
  });

  it("is uppercase", () => {
    expect(placeholderInitials("bilbo baggins")).toBe("BB");
  });

  it("uses first and last word for multi-word names", () => {
    expect(placeholderInitials("Samwise Gamgee Took")).toBe("ST");
  });
});

// ---------------------------------------------------------------------------
// tokenPixelSize
// ---------------------------------------------------------------------------

describe("tokenPixelSize", () => {
  it("computes 1×1 token at 100px grid", () => {
    const { pixelW, pixelH } = tokenPixelSize(1, 1, 100);
    expect(pixelW).toBe(100);
    expect(pixelH).toBe(100);
  });

  it("computes 2×3 token at 100px grid", () => {
    const { pixelW, pixelH } = tokenPixelSize(2, 3, 100);
    expect(pixelW).toBe(200);
    expect(pixelH).toBe(300);
  });

  it("computes fractional footprint (0.5 cell)", () => {
    const { pixelW, pixelH } = tokenPixelSize(0.5, 0.5, 100);
    expect(pixelW).toBe(50);
    expect(pixelH).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// tokenCenter
// ---------------------------------------------------------------------------

describe("tokenCenter", () => {
  it("centers a 100×100 token at (0,0)", () => {
    const { cx, cy } = tokenCenter(0, 0, 100, 100);
    expect(cx).toBe(50);
    expect(cy).toBe(50);
  });

  it("centers a 200×100 token at (50, 50)", () => {
    const { cx, cy } = tokenCenter(50, 50, 200, 100);
    expect(cx).toBe(150);
    expect(cy).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// computeLod
// ---------------------------------------------------------------------------

describe("computeLod", () => {
  it("shows all elements at zoom 1.0", () => {
    const lod = computeLod(1.0);
    expect(lod.showNameplate).toBe(true);
    expect(lod.showBars).toBe(true);
    expect(lod.showBarDetail).toBe(true);
  });

  it("hides nameplate below NAMEPLATE_MIN threshold", () => {
    const lod = computeLod(LOD_THRESHOLDS.NAMEPLATE_MIN - 0.01);
    expect(lod.showNameplate).toBe(false);
  });

  it("shows nameplate at exactly NAMEPLATE_MIN threshold", () => {
    const lod = computeLod(LOD_THRESHOLDS.NAMEPLATE_MIN);
    expect(lod.showNameplate).toBe(true);
  });

  it("hides bars below BAR_MIN threshold", () => {
    const lod = computeLod(LOD_THRESHOLDS.BAR_MIN - 0.01);
    expect(lod.showBars).toBe(false);
  });

  it("hides bar detail below BAR_DETAIL_MIN", () => {
    const lod = computeLod(LOD_THRESHOLDS.BAR_DETAIL_MIN - 0.01);
    expect(lod.showBarDetail).toBe(false);
  });

  it("everything hidden at very low zoom", () => {
    const lod = computeLod(0.1);
    expect(lod.showNameplate).toBe(false);
    expect(lod.showBars).toBe(false);
    expect(lod.showBarDetail).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// animDuration
// ---------------------------------------------------------------------------

describe("animDuration", () => {
  it("returns 0 for zero-distance move", () => {
    expect(animDuration(100, 100, 100, 100)).toBe(0);
  });

  it("returns 0 for sub-pixel move", () => {
    expect(animDuration(0, 0, 0.5, 0.5)).toBe(0);
  });

  it("caps at MAX_ANIM_DURATION_MS for very long moves", () => {
    const dur = animDuration(0, 0, 10000, 10000);
    expect(dur).toBe(MAX_ANIM_DURATION_MS);
  });

  it("is proportional to distance for moderate moves", () => {
    const d1 = animDuration(0, 0, 100, 0);
    const d2 = animDuration(0, 0, 200, 0);
    expect(d2).toBeCloseTo(d1 * 2, 1);
  });
});

// ---------------------------------------------------------------------------
// easeInOut
// ---------------------------------------------------------------------------

describe("easeInOut", () => {
  it("maps 0→0, 0.5→0.5, 1→1", () => {
    expect(easeInOut(0)).toBeCloseTo(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(1)).toBeCloseTo(1);
  });

  it("is monotonically increasing", () => {
    for (let t = 0; t < 0.99; t += 0.1) {
      expect(easeInOut(t)).toBeLessThan(easeInOut(t + 0.1));
    }
  });
});

// ---------------------------------------------------------------------------
// lerpPosition
// ---------------------------------------------------------------------------

describe("lerpPosition", () => {
  it("returns from position at t=0", () => {
    const pos = lerpPosition(10, 20, 100, 200, 0);
    expect(pos.x).toBeCloseTo(10);
    expect(pos.y).toBeCloseTo(20);
  });

  it("returns to position at t=1", () => {
    const pos = lerpPosition(10, 20, 100, 200, 1);
    expect(pos.x).toBeCloseTo(100);
    expect(pos.y).toBeCloseTo(200);
  });

  it("returns midpoint at t=0.5", () => {
    const pos = lerpPosition(0, 0, 100, 200, 0.5);
    expect(pos.x).toBeCloseTo(50);
    expect(pos.y).toBeCloseTo(100);
  });
});

// ---------------------------------------------------------------------------
// stepAnimation
// ---------------------------------------------------------------------------

describe("stepAnimation", () => {
  it("advances elapsed and returns interpolated position", () => {
    const anim = { fromX: 0, fromY: 0, toX: 100, toY: 0, durationMs: 100, elapsed: 0 };
    const result = stepAnimation(anim, 50);
    expect(result.x).toBeGreaterThan(0);
    expect(result.x).toBeLessThan(100);
    expect(result.done).toBe(false);
  });

  it("marks done when elapsed >= duration", () => {
    const anim = { fromX: 0, fromY: 0, toX: 100, toY: 0, durationMs: 100, elapsed: 0 };
    const result = stepAnimation(anim, 100);
    expect(result.x).toBeCloseTo(100);
    expect(result.done).toBe(true);
  });

  it("clamps to destination on overshoot", () => {
    const anim = { fromX: 0, fromY: 0, toX: 100, toY: 0, durationMs: 100, elapsed: 0 };
    const result = stepAnimation(anim, 200);
    expect(result.x).toBeCloseTo(100);
    expect(result.done).toBe(true);
  });

  it("snaps instantly when durationMs=0", () => {
    const anim = { fromX: 0, fromY: 0, toX: 100, toY: 50, durationMs: 0, elapsed: 0 };
    const result = stepAnimation(anim, 0);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(50);
    expect(result.done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatElevation
// ---------------------------------------------------------------------------

describe("formatElevation", () => {
  it("returns null for elevation 0", () => {
    expect(formatElevation(0)).toBeNull();
  });

  it("formats positive elevation with + sign", () => {
    expect(formatElevation(10, "ft")).toBe("+10ft");
  });

  it("formats negative elevation without + sign", () => {
    expect(formatElevation(-5, "m")).toBe("-5m");
  });

  it("uses default unit 'ft' when not specified", () => {
    expect(formatElevation(20)).toBe("+20ft");
  });
});

// ---------------------------------------------------------------------------
// tokenAlpha
// ---------------------------------------------------------------------------

describe("tokenAlpha", () => {
  it("returns baseAlpha for visible token", () => {
    expect(tokenAlpha(false, false, 1)).toBe(1);
    expect(tokenAlpha(false, true, 0.8)).toBeCloseTo(0.8);
  });

  it("returns HIDDEN_ALPHA for hidden token visible to GM", () => {
    expect(tokenAlpha(true, true, 1)).toBeCloseTo(HIDDEN_ALPHA);
  });

  it("returns 0 for hidden token seen by player", () => {
    expect(tokenAlpha(true, false, 1)).toBe(0);
  });

  it("scales HIDDEN_ALPHA by baseAlpha", () => {
    expect(tokenAlpha(true, true, 0.5)).toBeCloseTo(HIDDEN_ALPHA * 0.5);
  });
});

// ---------------------------------------------------------------------------
// barFraction
// ---------------------------------------------------------------------------

describe("barFraction", () => {
  it("returns 1 for full bar", () => {
    expect(barFraction(10, 10)).toBe(1);
  });

  it("returns 0.5 for half bar", () => {
    expect(barFraction(5, 10)).toBeCloseTo(0.5);
  });

  it("clamps to 0 for zero/negative value", () => {
    expect(barFraction(0, 10)).toBe(0);
    expect(barFraction(-5, 10)).toBe(0);
  });

  it("clamps to 1 for overflow", () => {
    expect(barFraction(15, 10)).toBe(1);
  });

  it("returns 0 when max <= 0", () => {
    expect(barFraction(5, 0)).toBe(0);
    expect(barFraction(5, -1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// barYOffset
// ---------------------------------------------------------------------------

describe("barYOffset", () => {
  it("bar0 (bar1) is at the bottom", () => {
    const y = barYOffset(0, 100);
    expect(y).toBe(100 - (BAR_HEIGHT_PX + BAR_GAP_PX));
  });

  it("bar1 (bar2) is above bar0", () => {
    const y0 = barYOffset(0, 100);
    const y1 = barYOffset(1, 100);
    expect(y1).toBeLessThan(y0);
    expect(y0 - y1).toBe(BAR_HEIGHT_PX + BAR_GAP_PX);
  });
});

// ---------------------------------------------------------------------------
// isInViewport
// ---------------------------------------------------------------------------

describe("isInViewport", () => {
  it("returns true when fully inside viewport", () => {
    expect(isInViewport(100, 100, 50, 50, 0, 0, 800, 600)).toBe(true);
  });

  it("returns false when fully outside (right)", () => {
    expect(isInViewport(900, 100, 50, 50, 0, 0, 800, 600)).toBe(false);
  });

  it("returns false when fully outside (bottom)", () => {
    expect(isInViewport(100, 700, 50, 50, 0, 0, 800, 600)).toBe(false);
  });

  it("returns true when partially overlapping (left edge)", () => {
    expect(isInViewport(-25, 100, 50, 50, 0, 0, 800, 600)).toBe(true);
  });

  it("returns false when just outside right edge", () => {
    // token at x=800, width=50: right edge at 850, tokenX (800) < vpRight (800) is false
    expect(isInViewport(800, 100, 50, 50, 0, 0, 800, 600)).toBe(false);
  });

  it("returns true when just touching right edge", () => {
    // token at x=750, width=50: tokenX + width = 800 > vpLeft=0 and tokenX=750 < vpRight=800
    expect(isInViewport(750, 100, 50, 50, 0, 0, 800, 600)).toBe(true);
  });
});
