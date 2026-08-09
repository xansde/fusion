/**
 * minimap.test.ts — projection math of the tactical minimap (spec 32).
 *
 * Everything the widget decides lives in `minimap.ts` as pure functions, so the
 * whole feature is covered under `environment: "node"` with no DOM and no PIXI.
 * The Svelte component only positions divs with the numbers computed here.
 */

import { describe, it, expect } from "vitest";
import {
  EMPTY_LAYOUT,
  MARKER_RADIUS_PX,
  CONTROLLED_MARKER_RADIUS_PX,
  buildMarkers,
  clampToScene,
  computeLayout,
  computeViewportBox,
  cssColor,
  minimapToWorld,
  resolveBackground,
  worldToMinimap,
  type MinimapScene,
  type MinimapToken,
} from "../minimap.js";

const scene = (over: Partial<MinimapScene> = {}): MinimapScene => ({
  width: 4000,
  height: 2000,
  backgroundColor: "#101820",
  background: null,
  thumb: null,
  ...over,
});

const token = (over: Partial<MinimapToken> = {}): MinimapToken => ({
  id: "tok1",
  name: "Fofurinha",
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  disposition: 1,
  hidden: false,
  controlled: false,
  ...over,
});

// ---------------------------------------------------------------------------
// computeLayout — letterbox fit
// ---------------------------------------------------------------------------

describe("computeLayout", () => {
  it("fits a wide scene by width and centres it vertically", () => {
    const layout = computeLayout(scene(), 200, 200);
    // 200/4000 = 0.05 beats 200/2000 = 0.1 → width-bound
    expect(layout.scale).toBeCloseTo(0.05);
    expect(layout.width).toBeCloseTo(200);
    expect(layout.height).toBeCloseTo(100);
    expect(layout.offsetX).toBeCloseTo(0);
    expect(layout.offsetY).toBeCloseTo(50);
  });

  it("fits a tall scene by height and centres it horizontally", () => {
    const layout = computeLayout(scene({ width: 1000, height: 4000 }), 200, 200);
    expect(layout.scale).toBeCloseTo(0.05);
    expect(layout.width).toBeCloseTo(50);
    expect(layout.height).toBeCloseTo(200);
    expect(layout.offsetX).toBeCloseTo(75);
    expect(layout.offsetY).toBeCloseTo(0);
  });

  it("preserves the scene aspect ratio", () => {
    const s = scene({ width: 3000, height: 1200 });
    const layout = computeLayout(s, 640, 480);
    expect(layout.width / layout.height).toBeCloseTo(s.width / s.height);
  });

  it("returns the empty layout when there is no scene", () => {
    expect(computeLayout(null, 200, 200)).toEqual(EMPTY_LAYOUT);
  });

  it("returns the empty layout when the box has not been measured yet", () => {
    expect(computeLayout(scene(), 0, 0)).toEqual(EMPTY_LAYOUT);
    expect(computeLayout(scene(), 200, 0)).toEqual(EMPTY_LAYOUT);
  });

  it("returns the empty layout for a degenerate scene", () => {
    expect(computeLayout(scene({ width: 0 }), 200, 200)).toEqual(EMPTY_LAYOUT);
    expect(computeLayout(scene({ height: -10 }), 200, 200)).toEqual(EMPTY_LAYOUT);
  });
});

// ---------------------------------------------------------------------------
// Projection — world ↔ minimap
// ---------------------------------------------------------------------------

describe("worldToMinimap / minimapToWorld", () => {
  const layout = computeLayout(scene(), 200, 200);

  it("maps the scene origin to the top-left of the drawn map", () => {
    expect(worldToMinimap(0, 0, layout)).toEqual({ x: 0, y: 50 });
  });

  it("maps the far corner to the bottom-right of the drawn map", () => {
    const p = worldToMinimap(4000, 2000, layout);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(150);
  });

  it("round-trips any world point through the minimap and back", () => {
    for (const [wx, wy] of [
      [0, 0],
      [1234, 567],
      [4000, 2000],
      [-300, 900],
    ] as const) {
      const p = worldToMinimap(wx, wy, layout);
      const back = minimapToWorld(p.x, p.y, layout);
      expect(back.x).toBeCloseTo(wx);
      expect(back.y).toBeCloseTo(wy);
    }
  });

  it("collapses to the origin when the layout is empty (no division by zero)", () => {
    expect(worldToMinimap(500, 500, EMPTY_LAYOUT)).toEqual({ x: 0, y: 0 });
    expect(minimapToWorld(30, 30, EMPTY_LAYOUT)).toEqual({ x: 0, y: 0 });
  });
});

describe("clampToScene", () => {
  it("keeps a point already inside the scene", () => {
    expect(clampToScene({ x: 10, y: 20 }, scene())).toEqual({ x: 10, y: 20 });
  });

  it("pulls a point back to the scene bounds", () => {
    expect(clampToScene({ x: -50, y: 9999 }, scene())).toEqual({ x: 0, y: 2000 });
  });
});

// ---------------------------------------------------------------------------
// Viewport box (REQ-MMT-004)
// ---------------------------------------------------------------------------

describe("computeViewportBox", () => {
  const layout = computeLayout(scene(), 200, 200); // scale 0.05, offsetY 50

  it("frames the world area the camera shows", () => {
    // Camera at 1× with the origin on screen 0,0 → shows world 0..800 × 0..600
    const box = computeViewportBox({ tx: 0, ty: 0, scale: 1 }, 800, 600, layout);
    expect(box.x).toBeCloseTo(0);
    expect(box.y).toBeCloseTo(50);
    expect(box.width).toBeCloseTo(40); // 800 * 0.05
    expect(box.height).toBeCloseTo(30); // 600 * 0.05
  });

  it("follows a pan — panning right moves the box right", () => {
    const at0 = computeViewportBox({ tx: 0, ty: 0, scale: 1 }, 800, 600, layout);
    // tx = -400 means the world scrolled left under the camera: we look further right
    const panned = computeViewportBox({ tx: -400, ty: 0, scale: 1 }, 800, 600, layout);
    expect(panned.x).toBeGreaterThan(at0.x);
    expect(panned.x).toBeCloseTo(20); // world 400 → 400 * 0.05
  });

  it("shrinks when the camera zooms in", () => {
    const wide = computeViewportBox({ tx: 0, ty: 0, scale: 1 }, 800, 600, layout);
    const close = computeViewportBox({ tx: 0, ty: 0, scale: 2 }, 800, 600, layout);
    expect(close.width).toBeLessThan(wide.width);
    expect(close.width).toBeCloseTo(20); // 800 / 2 * 0.05
  });

  it("clips to the drawn map when the camera sees past the scene edge", () => {
    // Zoomed way out: the camera covers far more than the scene
    const box = computeViewportBox({ tx: 0, ty: 0, scale: 0.02 }, 800, 600, layout);
    expect(box.x).toBeCloseTo(0);
    expect(box.y).toBeCloseTo(50);
    expect(box.width).toBeCloseTo(200); // capped at the drawn map width
    expect(box.height).toBeCloseTo(100); // capped at the drawn map height
  });

  it("is empty when the camera looks entirely off the map", () => {
    // tx = 100000 pushes the whole scene far off to the right of the screen
    const box = computeViewportBox({ tx: 100_000, ty: 0, scale: 1 }, 800, 600, layout);
    expect(box.width).toBe(0);
    expect(box.height).toBe(0);
  });

  it("is empty for a degenerate camera or layout", () => {
    expect(computeViewportBox({ tx: 0, ty: 0, scale: 0 }, 800, 600, layout).width).toBe(0);
    expect(computeViewportBox({ tx: 0, ty: 0, scale: 1 }, 800, 600, EMPTY_LAYOUT).width).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Markers (REQ-MMT-003)
// ---------------------------------------------------------------------------

describe("buildMarkers", () => {
  const layout = computeLayout(scene(), 200, 200); // scale 0.05, offsetY 50

  it("places a marker at the centre of the token footprint, not its corner", () => {
    const [marker] = buildMarkers([token({ x: 1000, y: 500 })], 100, layout);
    expect(marker).toBeDefined();
    // centre = 1000 + 100/2 = 1050 → 1050 * 0.05 = 52.5
    expect(marker?.x).toBeCloseTo(52.5);
    expect(marker?.y).toBeCloseTo(50 + 27.5);
  });

  it("accounts for a large footprint", () => {
    const [marker] = buildMarkers([token({ x: 0, y: 0, width: 4, height: 4 })], 100, layout);
    expect(marker?.x).toBeCloseTo(10); // (0 + 400/2) * 0.05
  });

  it("colours markers by disposition", () => {
    const [hostile, neutral, friendly] = buildMarkers(
      [
        token({ id: "a", disposition: -1 }),
        token({ id: "b", disposition: 0 }),
        token({ id: "c", disposition: 1 }),
      ],
      100,
      layout,
    );
    expect(hostile?.color).toBe(cssColor(0xe52222));
    expect(neutral?.color).toBe(cssColor(0xf0f060));
    expect(friendly?.color).toBe(cssColor(0x33bc4e));
    expect(new Set([hostile?.color, neutral?.color, friendly?.color]).size).toBe(3);
  });

  it("gives a controlled token a bigger radius than the rest", () => {
    const [mine, theirs] = buildMarkers(
      [token({ id: "mine", controlled: true }), token({ id: "theirs" })],
      100,
      layout,
    );
    expect(mine?.radius).toBe(CONTROLLED_MARKER_RADIUS_PX);
    expect(theirs?.radius).toBe(MARKER_RADIUS_PX);
    expect(CONTROLLED_MARKER_RADIUS_PX).toBeGreaterThan(MARKER_RADIUS_PX);
  });

  it("keeps the radius in screen pixels — it never scales with the scene (DEC-MMT-03)", () => {
    const tiny = computeLayout(scene({ width: 400, height: 200 }), 200, 200);
    const huge = computeLayout(scene({ width: 40_000, height: 20_000 }), 200, 200);
    const a = buildMarkers([token()], 100, tiny)[0];
    const b = buildMarkers([token()], 100, huge)[0];
    expect(a?.radius).toBe(b?.radius);
  });

  it("carries the hidden flag through so the GM view can mark it", () => {
    const [marker] = buildMarkers([token({ hidden: true })], 100, layout);
    expect(marker?.hidden).toBe(true);
  });

  it("keeps token id and name for the click target and its label", () => {
    const [marker] = buildMarkers([token({ id: "abc", name: "Fofurinha" })], 100, layout);
    expect(marker?.id).toBe("abc");
    expect(marker?.name).toBe("Fofurinha");
  });

  it("also reports the world centre so a click can navigate to it (REQ-MMT-010)", () => {
    const [marker] = buildMarkers([token({ x: 1000, y: 500 })], 100, layout);
    expect(marker?.worldX).toBeCloseTo(1050);
    expect(marker?.worldY).toBeCloseTo(550);
  });

  it("returns nothing when the layout is empty", () => {
    expect(buildMarkers([token()], 100, EMPTY_LAYOUT)).toEqual([]);
  });

  it("does not invent markers — one token in, one marker out", () => {
    expect(buildMarkers([], 100, layout)).toEqual([]);
    expect(buildMarkers([token({ id: "a" }), token({ id: "b" })], 100, layout)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Background (REQ-MMT-002)
// ---------------------------------------------------------------------------

describe("resolveBackground", () => {
  it("prefers the scene thumbnail", () => {
    expect(resolveBackground(scene({ thumb: "/t.webp", background: "/bg.webp" }))).toEqual({
      kind: "image",
      src: "/t.webp",
    });
  });

  it("falls back to the full background image while no thumbnail is generated", () => {
    expect(resolveBackground(scene({ background: "/bg.webp" }))).toEqual({
      kind: "image",
      src: "/bg.webp",
    });
  });

  it("falls back to the scene background colour when there is no image at all", () => {
    expect(resolveBackground(scene())).toEqual({ kind: "color", color: "#101820" });
  });

  it("ignores an empty string as if it were absent", () => {
    expect(resolveBackground(scene({ thumb: "", background: "" }))).toEqual({
      kind: "color",
      color: "#101820",
    });
  });

  it("falls back to black with no scene", () => {
    expect(resolveBackground(null)).toEqual({ kind: "color", color: "#000000" });
  });
});

describe("cssColor", () => {
  it("pads to six hex digits", () => {
    expect(cssColor(0x33bc4e)).toBe("#33bc4e");
    expect(cssColor(0x0000ff)).toBe("#0000ff");
    expect(cssColor(0)).toBe("#000000");
  });
});
