/**
 * minimap.ts — projection math for the tactical minimap (spec 32).
 *
 * Spec: `specs/32-minimapa-tatico.md` — REQ-MMT-002 (background), REQ-MMT-003
 * (markers), REQ-MMT-004 (viewport box), REQ-MMT-008/010 (navigation targets),
 * DEC-MMT-03 (the interface does not scale).
 *
 * Pure and DOM-free on purpose: the client test runner is `environment: "node"`
 * with no component mounting, so anything the widget *decides* has to live here
 * to be covered. `TacticalMinimap.svelte` only turns these numbers into styles.
 *
 * Coordinate systems:
 *   world    — scene pixels, (0,0) at the scene's top-left corner
 *   minimap  — pixels inside the widget box, (0,0) at the box's top-left corner
 *
 * The map is letterboxed inside the box, so the drawn map starts at
 * (offsetX, offsetY) and the transform is:
 *   minimapX = offsetX + worldX * scale
 */

import type { CameraState } from "../canvas/camera-math.js";
import { dispositionColor, tokenCenter, tokenPixelSize } from "../canvas/tokens/token-visuals.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The slice of `SceneDocument` the minimap draws. */
export interface MinimapScene {
  /** Scene width in world pixels. */
  readonly width: number;
  /** Scene height in world pixels. */
  readonly height: number;
  /** CSS colour painted when the scene has no image. */
  readonly backgroundColor: string;
  /** Full-resolution background image path, or null. */
  readonly background: string | null;
  /** Thumbnail path, or null while the server does not generate one. */
  readonly thumb: string | null;
}

/**
 * The slice of `TokenDocument` the minimap draws, plus who controls it.
 *
 * This list is built from what the canvas already renders — the minimap never
 * asks the server for tokens of its own (DEC-MMT-02).
 */
export interface MinimapToken {
  readonly id: string;
  readonly name: string;
  /** Top-left corner of the footprint, in world pixels. */
  readonly x: number;
  readonly y: number;
  /** Footprint in grid cells. */
  readonly width: number;
  readonly height: number;
  /** -1 hostile · 0 neutral · 1 friendly (REQ-CNV-027). */
  readonly disposition: number;
  /** Hidden from players; only ever true in a GM's list. */
  readonly hidden: boolean;
  /** Controlled by the local user — drawn bigger. */
  readonly controlled: boolean;
}

/** Where the scene lands inside the widget box. */
export interface MinimapLayout {
  /** World pixels → minimap pixels. */
  readonly scale: number;
  /** Drawn map width, in minimap pixels. */
  readonly width: number;
  /** Drawn map height, in minimap pixels. */
  readonly height: number;
  /** Letterbox offset from the box's left edge. */
  readonly offsetX: number;
  /** Letterbox offset from the box's top edge. */
  readonly offsetY: number;
}

export interface MinimapPoint {
  readonly x: number;
  readonly y: number;
}

export interface MinimapRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A token as the widget draws it. */
export interface MinimapMarker {
  readonly id: string;
  readonly name: string;
  /** Centre of the marker, in minimap pixels. */
  readonly x: number;
  readonly y: number;
  /** Centre of the token, in world pixels — the camera target for a click. */
  readonly worldX: number;
  readonly worldY: number;
  /** Screen pixels, fixed under any scene size (DEC-MMT-03). */
  readonly radius: number;
  readonly color: string;
  readonly hidden: boolean;
  readonly controlled: boolean;
}

export type MinimapBackground =
  | { readonly kind: "image"; readonly src: string }
  | { readonly kind: "color"; readonly color: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Layout for "nothing to draw" — every consumer treats scale 0 as a no-op. */
export const EMPTY_LAYOUT: MinimapLayout = {
  scale: 0,
  width: 0,
  height: 0,
  offsetX: 0,
  offsetY: 0,
};

/** Marker radius in screen pixels. */
export const MARKER_RADIUS_PX = 3.5;

/** Radius for a token the local user controls — findable at a glance. */
export const CONTROLLED_MARKER_RADIUS_PX = 5;

/** Painted when there is no scene at all. */
const FALLBACK_COLOR = "#000000";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Fit the scene inside a box of `boxWidth` × `boxHeight`, preserving aspect
 * ratio and centring the leftover space.
 *
 * Returns `EMPTY_LAYOUT` whenever there is nothing sane to fit — no scene, a
 * degenerate scene, or a box that has not been measured yet (both happen on the
 * first frame, before `clientWidth` is known).
 */
export function computeLayout(
  scene: MinimapScene | null,
  boxWidth: number,
  boxHeight: number,
): MinimapLayout {
  if (scene === null) return EMPTY_LAYOUT;
  if (scene.width <= 0 || scene.height <= 0) return EMPTY_LAYOUT;
  if (boxWidth <= 0 || boxHeight <= 0) return EMPTY_LAYOUT;

  const scale = Math.min(boxWidth / scene.width, boxHeight / scene.height);
  const width = scene.width * scale;
  const height = scene.height * scale;

  return {
    scale,
    width,
    height,
    offsetX: (boxWidth - width) / 2,
    offsetY: (boxHeight - height) / 2,
  };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** World point → minimap point. */
export function worldToMinimap(x: number, y: number, layout: MinimapLayout): MinimapPoint {
  if (layout.scale <= 0) return { x: 0, y: 0 };
  return {
    x: layout.offsetX + x * layout.scale,
    y: layout.offsetY + y * layout.scale,
  };
}

/** Minimap point → world point. The inverse of {@link worldToMinimap}. */
export function minimapToWorld(mx: number, my: number, layout: MinimapLayout): MinimapPoint {
  if (layout.scale <= 0) return { x: 0, y: 0 };
  return {
    x: (mx - layout.offsetX) / layout.scale,
    y: (my - layout.offsetY) / layout.scale,
  };
}

/** Pull a world point back inside the scene bounds. */
export function clampToScene(point: MinimapPoint, scene: MinimapScene): MinimapPoint {
  return {
    x: Math.min(Math.max(point.x, 0), scene.width),
    y: Math.min(Math.max(point.y, 0), scene.height),
  };
}

// ---------------------------------------------------------------------------
// Viewport box (REQ-MMT-004)
// ---------------------------------------------------------------------------

/**
 * The rectangle of the drawn map currently framed by the local camera.
 *
 * Clipped to the drawn map: zoomed far enough out the camera covers more than
 * the scene, and a box hanging outside the map would read as "there is map over
 * there" — the one thing an orientation widget must not say.
 */
export function computeViewportBox(
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number,
  layout: MinimapLayout,
): MinimapRect {
  const empty: MinimapRect = {
    x: layout.offsetX,
    y: layout.offsetY,
    width: 0,
    height: 0,
  };
  if (layout.scale <= 0 || camera.scale <= 0) return empty;
  if (viewportWidth <= 0 || viewportHeight <= 0) return empty;

  // Screen (0,0)..(w,h) back into world coordinates, then forward into minimap.
  const worldX = -camera.tx / camera.scale;
  const worldY = -camera.ty / camera.scale;
  const topLeft = worldToMinimap(worldX, worldY, layout);
  const boxWidth = (viewportWidth / camera.scale) * layout.scale;
  const boxHeight = (viewportHeight / camera.scale) * layout.scale;

  // Intersect with the drawn map.
  const left = Math.max(topLeft.x, layout.offsetX);
  const top = Math.max(topLeft.y, layout.offsetY);
  const right = Math.min(topLeft.x + boxWidth, layout.offsetX + layout.width);
  const bottom = Math.min(topLeft.y + boxHeight, layout.offsetY + layout.height);

  if (right <= left || bottom <= top) return empty;

  return { x: left, y: top, width: right - left, height: bottom - top };
}

// ---------------------------------------------------------------------------
// Markers (REQ-MMT-003)
// ---------------------------------------------------------------------------

/**
 * Project tokens into markers.
 *
 * `tokens` is whatever the canvas is already showing this user — filtering is
 * the canvas's job, never this module's (DEC-MMT-02).
 */
export function buildMarkers(
  tokens: readonly MinimapToken[],
  gridSize: number,
  layout: MinimapLayout,
): MinimapMarker[] {
  if (layout.scale <= 0) return [];

  return tokens.map((token) => {
    const { pixelW, pixelH } = tokenPixelSize(token.width, token.height, gridSize);
    const { cx, cy } = tokenCenter(token.x, token.y, pixelW, pixelH);
    const point = worldToMinimap(cx, cy, layout);
    return {
      id: token.id,
      name: token.name,
      x: point.x,
      y: point.y,
      worldX: cx,
      worldY: cy,
      radius: token.controlled ? CONTROLLED_MARKER_RADIUS_PX : MARKER_RADIUS_PX,
      color: cssColor(dispositionColor(token.disposition)),
      hidden: token.hidden,
      controlled: token.controlled,
    };
  });
}

// ---------------------------------------------------------------------------
// Background (REQ-MMT-002)
// ---------------------------------------------------------------------------

/**
 * Pick what to paint behind the markers.
 *
 * The spec asks for `scene.thumb`. Nothing generates a thumbnail yet — and the
 * server schema still drops the field on write — so a strict reading would make
 * every minimap a flat rectangle. The full background image is used as the
 * middle step: it is already downloaded and decoded for the canvas, so drawing
 * it small costs nothing extra. Drop this branch once thumbnails exist.
 */
export function resolveBackground(scene: MinimapScene | null): MinimapBackground {
  if (scene === null) return { kind: "color", color: FALLBACK_COLOR };
  if (scene.thumb !== null && scene.thumb !== "") return { kind: "image", src: scene.thumb };
  if (scene.background !== null && scene.background !== "") {
    return { kind: "image", src: scene.background };
  }
  return { kind: "color", color: scene.backgroundColor };
}

/** PIXI number colour → CSS hex string. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
