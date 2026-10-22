/**
 * floating.test.ts — BAR-F1-03: where a tooltip, a popover or a context menu goes.
 *
 * `computePosition` is pure (rects in, coordinates out), so every rule is checked with
 * numbers worked out by hand here — never by calling the function and copying its answer.
 * The client's Vitest has no DOM (docs/design/barra-de-acoes/tasks.md §2.10), which is
 * exactly why the collision logic lives apart from any element.
 *
 * Common fixture unless a case says otherwise: a 1000 × 800 viewport, the default 8 px
 * padding to the edge, the default 6 px gap, and a 200 × 100 floating box.
 */

import { describe, expect, it } from "vitest";

import {
  computePosition,
  parsePlacement,
  type FloatingInput,
  type Placement,
  type Rect,
} from "../floating.js";

const VIEWPORT = { width: 1000, height: 800 };
const BOX = { width: 200, height: 100 };

function at(
  anchor: Rect,
  placement: Placement,
  extra: Partial<Omit<FloatingInput, "anchor" | "placement">> = {},
) {
  return computePosition({ anchor, floating: BOX, viewport: VIEWPORT, placement, ...extra });
}

/** A 100 × 30 trigger at (x, y). */
function button(x: number, y: number): Rect {
  return { x, y, width: 100, height: 30 };
}

/** The pointer: a zero-size anchor, as a right-click would be. */
function pointer(x: number, y: number): Rect {
  return { x, y, width: 0, height: 0 };
}

describe("parsePlacement", () => {
  it("reads the side and the alignment; a bare side is centered", () => {
    expect(parsePlacement("top")).toEqual({ side: "top", align: "center" });
    expect(parsePlacement("bottom-start")).toEqual({ side: "bottom", align: "start" });
    expect(parsePlacement("left-end")).toEqual({ side: "left", align: "end" });
  });
});

describe("computePosition — the preferred side when it fits", () => {
  it("bottom: below the trigger with the gap, centered on it", () => {
    // x = 400 + (100 - 200) / 2 = 350 ; y = 300 + 30 + 6 = 336
    expect(at(button(400, 300), "bottom")).toEqual({ x: 350, y: 336, placement: "bottom" });
  });

  it("top: above the trigger with the gap, centered on it", () => {
    // y = 300 - 100 - 6 = 194
    expect(at(button(400, 300), "top")).toEqual({ x: 350, y: 194, placement: "top" });
  });

  it("right: beside the trigger, centered vertically on it", () => {
    // x = 500 + 100 + 6 = 606 ; y = 300 + (30 - 100) / 2 = 265
    expect(at(button(500, 300), "right")).toEqual({ x: 606, y: 265, placement: "right" });
  });

  it("left: beside the trigger on the other side", () => {
    // x = 500 - 200 - 6 = 294
    expect(at(button(500, 300), "left")).toEqual({ x: 294, y: 265, placement: "left" });
  });

  it("start and end line the box up with the trigger's edges", () => {
    // start: left edges together (400). end: right edges together (500 - 200 = 300).
    expect(at(button(400, 300), "bottom-start").x).toBe(400);
    expect(at(button(400, 300), "bottom-end").x).toBe(300);
  });

  it("the gap is configurable, and a pointer anchor can ask for none", () => {
    expect(at(button(400, 300), "bottom", { offset: 0 }).y).toBe(330);
    expect(at(button(400, 300), "bottom", { offset: 20 }).y).toBe(350);
  });
});

describe("computePosition — flipping to the other side at the viewport edge", () => {
  it("top flips to bottom when the trigger is too close to the top edge", () => {
    // room above = 50 - 8 = 42 < 106 ; room below = 800 - 80 - 8 = 712 ≥ 106
    expect(at(button(400, 50), "top")).toEqual({ x: 350, y: 86, placement: "bottom" });
  });

  it("bottom flips to top when the trigger is too close to the bottom edge", () => {
    // room below = 800 - 770 - 8 = 22 < 106 ; room above = 740 - 8 = 732 ≥ 106
    expect(at(button(400, 740), "bottom")).toEqual({ x: 350, y: 634, placement: "top" });
  });

  it("right flips to left near the right edge", () => {
    // room right = 1000 - 950 - 8 = 42 < 206 ; room left = 850 - 8 = 842 ≥ 206
    expect(at(button(850, 300), "right")).toEqual({ x: 644, y: 265, placement: "left" });
  });

  it("left flips to right near the left edge", () => {
    // room left = 20 - 8 = 12 < 206 ; room right = 1000 - 120 - 8 = 872 ≥ 206 → x = 120 + 6
    expect(at(button(20, 300), "left")).toEqual({ x: 126, y: 265, placement: "right" });
  });

  it("does not flip when the preferred side fits", () => {
    expect(at(button(400, 300), "top").placement).toBe("top");
    expect(at(button(400, 300), "bottom").placement).toBe("bottom");
  });

  it("when neither side fits, keeps the one with more room and stays inside the viewport", () => {
    // 150 px tall viewport: room above = 60 - 8 = 52, room below = 150 - 90 - 8 = 52. A tie
    // keeps the preferred side; the box is then pushed up so its bottom edge is at 150 - 8.
    const tie = computePosition({
      anchor: button(400, 60),
      floating: BOX,
      viewport: { width: 1000, height: 150 },
      placement: "bottom",
    });
    expect(tie.placement).toBe("bottom");
    expect(tie.y).toBe(42); // 150 - 100 - 8

    // Trigger near the top of that short viewport: more room below than above, so a
    // "top" preference gives way to "bottom" even though neither fits.
    const short = computePosition({
      anchor: button(400, 20),
      floating: BOX,
      viewport: { width: 1000, height: 150 },
      placement: "top",
    });
    expect(short.placement).toBe("bottom");
  });
});

describe("computePosition — keeping the box inside along the other axis", () => {
  it("a centered box near the right edge slides left to stay inside", () => {
    // wanted x = 940 + (50 - 200) / 2 = 865 → right edge 1065 ; limit = 1000 - 200 - 8 = 792
    const near = computePosition({
      anchor: { x: 940, y: 300, width: 50, height: 30 },
      floating: BOX,
      viewport: VIEWPORT,
      placement: "bottom",
    });
    expect(near.x).toBe(792);
  });

  it("a centered box near the left edge slides right to stay inside", () => {
    // wanted x = 0 + (30 - 200) / 2 = -85 → clamped to the 8 px padding
    const near = computePosition({
      anchor: { x: 0, y: 300, width: 30, height: 30 },
      floating: BOX,
      viewport: VIEWPORT,
      placement: "bottom",
    });
    expect(near.x).toBe(8);
  });

  it("start-aligned flips to end-aligned when it would run off the right edge", () => {
    // start: x = 900 → right edge 1100 > 992. end: x = 900 + 100 - 200 = 800 → right edge 1000 > 992,
    // so the end alignment still overflows by 8 and is then clamped to 792.
    const result = at(button(900, 300), "bottom-start");
    expect(result.placement).toBe("bottom-end");
    expect(result.x).toBe(792);

    // With room to spare on the left the flipped alignment fits as is: trigger at x = 800.
    // start: x = 800 → right edge 1000 > 992 ; end: x = 800 + 100 - 200 = 700.
    const roomy = at(button(800, 300), "bottom-start");
    expect(roomy.placement).toBe("bottom-end");
    expect(roomy.x).toBe(700);
  });

  it("start-aligned stays start-aligned when it fits", () => {
    const result = at(button(100, 300), "bottom-start");
    expect(result).toEqual({ x: 100, y: 336, placement: "bottom-start" });
  });

  it("a box bigger than the viewport is pinned to the padding rather than pushed off-screen", () => {
    const huge = computePosition({
      anchor: button(400, 300),
      floating: { width: 1200, height: 900 },
      viewport: VIEWPORT,
      placement: "bottom",
    });
    expect(huge.x).toBe(8);
    expect(huge.y).toBe(8);
  });
});

describe("computePosition — a context menu opens facing inward (REQ-BAR-045)", () => {
  const MENU = { width: 214, height: 180 };
  const place = (x: number, y: number) =>
    computePosition({
      anchor: pointer(x, y),
      floating: MENU,
      viewport: VIEWPORT,
      placement: "bottom-start",
      offset: 0,
    });

  it("in the open middle of the screen, its corner sits on the pointer", () => {
    expect(place(300, 200)).toEqual({ x: 300, y: 200, placement: "bottom-start" });
  });

  it("near the right edge it opens to the left of the pointer", () => {
    // 990 + 214 > 992 → mirrored: x = 990 - 214 = 776
    const result = place(990, 200);
    expect(result.x).toBe(776);
    expect(result.placement).toBe("bottom-end");
  });

  it("near the bottom edge it opens above the pointer", () => {
    // room below = 800 - 790 - 8 = 2 < 180 → above: y = 790 - 180 = 610
    const result = place(300, 790);
    expect(result.y).toBe(610);
    expect(result.placement).toBe("top-start");
  });

  it("in the bottom-right corner it turns both ways at once", () => {
    const result = place(990, 790);
    expect(result).toEqual({ x: 776, y: 610, placement: "top-end" });
    // And lands fully inside the viewport.
    expect(result.x + MENU.width).toBeLessThanOrEqual(VIEWPORT.width - 8);
    expect(result.y + MENU.height).toBeLessThanOrEqual(VIEWPORT.height - 8);
  });

  it("at the very top-left it stays put, respecting the padding", () => {
    expect(place(2, 3)).toEqual({ x: 8, y: 8, placement: "bottom-start" });
  });
});

describe("computePosition — bad numbers never leak out", () => {
  it("non-finite input is treated as zero instead of producing NaN", () => {
    const result = computePosition({
      anchor: { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: 10, height: 10 },
      floating: BOX,
      viewport: VIEWPORT,
      placement: "bottom",
    });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  it("returns whole pixels, so fixed-position text is not blurred by half-pixel offsets", () => {
    // 400 + (101 - 200) / 2 = 350.5
    const result = at({ x: 400, y: 300, width: 101, height: 30 }, "bottom");
    expect(Number.isInteger(result.x)).toBe(true);
    expect(Number.isInteger(result.y)).toBe(true);
  });
});
