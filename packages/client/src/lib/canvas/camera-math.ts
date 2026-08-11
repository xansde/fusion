/**
 * camera-math.ts — pure camera math (no PIXI, no DOM).
 *
 * Spec: 06-canvas-e-renderizacao.md §DEC-CNV-02, §REQ-CNV-006..009, §REQ-CNV-012
 *
 * All functions are stateless and testable in Vitest without a browser.
 * The PIXI shell (FusionCanvas) calls these to compute what to apply to the
 * render group transform.
 *
 * Coordinate systems:
 *   screen  — pixels in the browser viewport (mouse events, element size)
 *   world   — scene coordinates (pixels of the map image, 0,0 at top-left)
 *
 * The camera transform is: world → screen
 *   screenX = worldX * scale + tx
 *   screenY = worldY * scale + ty
 *
 * Inverse (screen → world):
 *   worldX = (screenX - tx) / scale
 *   worldY = (screenY - ty) / scale
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Camera state: translation + uniform scale. */
export interface CameraState {
  /** Horizontal translation (screen pixels). */
  readonly tx: number;
  /** Vertical translation (screen pixels). */
  readonly ty: number;
  /** Zoom scale (1.0 = 100%). */
  readonly scale: number;
}

/** Zoom clamp limits (REQ-CNV-007: defaults 0.1×–3×). */
export interface ZoomLimits {
  readonly min: number;
  readonly max: number;
}

/** Default zoom limits per spec REQ-CNV-007. */
export const DEFAULT_ZOOM_LIMITS: ZoomLimits = { min: 0.1, max: 3.0 };

// ---------------------------------------------------------------------------
// Core conversions
// ---------------------------------------------------------------------------

/**
 * Convert a screen-coordinate point to world coordinates.
 * REQ-CNV-012: single conversion function, inverts camera transform.
 */
export function screenToWorld(
  sx: number,
  sy: number,
  camera: CameraState,
): { x: number; y: number } {
  return {
    x: (sx - camera.tx) / camera.scale,
    y: (sy - camera.ty) / camera.scale,
  };
}

/**
 * Convert a world-coordinate point to screen coordinates.
 */
export function worldToScreen(
  wx: number,
  wy: number,
  camera: CameraState,
): { x: number; y: number } {
  return {
    x: wx * camera.scale + camera.tx,
    y: wy * camera.scale + camera.ty,
  };
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/**
 * Clamp a scale value within [limits.min, limits.max].
 */
export function clampScale(value: number, limits: ZoomLimits): number {
  return Math.min(limits.max, Math.max(limits.min, value));
}

/**
 * Compute a new camera state after zooming by `factor` centered on the given
 * screen-coordinate pivot point.
 *
 * The pivot remains stationary in screen space (zoom-at-point).
 *
 * REQ-CNV-007: zoom centered on cursor.
 *
 * @param camera  Current camera state
 * @param factor  Zoom multiplier (e.g. 1.1 = zoom in 10%)
 * @param pivotSx Screen x of the zoom pivot (cursor position)
 * @param pivotSy Screen y of the zoom pivot
 * @param limits  Min/max scale limits
 */
export function zoomAtPoint(
  camera: CameraState,
  factor: number,
  pivotSx: number,
  pivotSy: number,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): CameraState {
  const newScale = clampScale(camera.scale * factor, limits);

  // The pivot must stay fixed: pivotSx = wx * newScale + newTx
  // => newTx = pivotSx - wx * newScale
  // wx = (pivotSx - tx) / scale  (current world position under pivot)
  const wx = (pivotSx - camera.tx) / camera.scale;
  const wy = (pivotSy - camera.ty) / camera.scale;

  return {
    tx: pivotSx - wx * newScale,
    ty: pivotSy - wy * newScale,
    scale: newScale,
  };
}

// ---------------------------------------------------------------------------
// Pan
// ---------------------------------------------------------------------------

/**
 * Compute a new camera state after panning by (dx, dy) screen pixels.
 */
export function panBy(camera: CameraState, dx: number, dy: number): CameraState {
  return {
    tx: camera.tx + dx,
    ty: camera.ty + dy,
    scale: camera.scale,
  };
}

/**
 * Compute a camera state that centers the view on a given world point,
 * optionally at a specified scale.
 *
 * @param worldX   World x to center on
 * @param worldY   World y to center on
 * @param viewW    Viewport width in screen pixels
 * @param viewH    Viewport height in screen pixels
 * @param scale    Desired scale (default: preserve current)
 * @param limits   Zoom limits (for clamping)
 */
export function centerOn(
  worldX: number,
  worldY: number,
  viewW: number,
  viewH: number,
  scale: number,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): CameraState {
  const clampedScale = clampScale(scale, limits);
  return {
    tx: viewW / 2 - worldX * clampedScale,
    ty: viewH / 2 - worldY * clampedScale,
    scale: clampedScale,
  };
}

/**
 * Compute a camera state that fits the entire scene (width × height) within
 * the viewport.
 *
 * @param sceneW   Scene width in pixels
 * @param sceneH   Scene height in pixels
 * @param viewW    Viewport width
 * @param viewH    Viewport height
 * @param limits   Zoom limits
 */
export function fitScene(
  sceneW: number,
  sceneH: number,
  viewW: number,
  viewH: number,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): CameraState {
  const scaleX = viewW / sceneW;
  const scaleY = viewH / sceneH;
  const scale = clampScale(Math.min(scaleX, scaleY), limits);

  return centerOn(sceneW / 2, sceneH / 2, viewW, viewH, scale, limits);
}

// ---------------------------------------------------------------------------
// Interpolation (for animateTo)
// ---------------------------------------------------------------------------

/**
 * Linearly interpolate between two camera states.
 *
 * @param from   Start state
 * @param to     End state
 * @param t      Progress in [0, 1]
 */
export function lerpCamera(from: CameraState, to: CameraState, t: number): CameraState {
  const c = Math.max(0, Math.min(1, t));
  return {
    tx: from.tx + (to.tx - from.tx) * c,
    ty: from.ty + (to.ty - from.ty) * c,
    scale: from.scale + (to.scale - from.scale) * c,
  };
}

/**
 * Ease-in-out cubic interpolation (smooth start and end).
 *
 * Use with lerpCamera: t = easeInOut(rawT)
 */
export function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c;
}
