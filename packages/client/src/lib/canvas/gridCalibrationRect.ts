/**
 * gridCalibrationRect.ts — the draggable rectangle of the grid calibration tool.
 *
 * Spec: 06-canvas-e-renderizacao.md (REQ-CNV-017, configurable gridSize)
 *
 * The GM drags a box over one cell of the map image, nudges its corners until
 * it sits exactly on the printed cell, and confirms. This module owns the
 * geometry of that box — which handle the pointer grabbed and where a drag
 * moves it — while `calibrateSquareGrid` in @fusion/shared turns the final
 * box into grid numbers.
 *
 * Pure (no DOM, no PIXI): handle hit-testing under zoom is exactly the kind of
 * arithmetic that looks obvious and is off by half a handle in practice.
 */

export interface Point {
  x: number;
  y: number;
}

/** A rectangle in scene coordinates. Extents stay positive after normalize(). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which part of the rectangle a drag grabbed. */
export type CalibrationHandle = "nw" | "ne" | "sw" | "se" | "move";

/** Corner handles, in the order they are drawn. */
export const CORNER_HANDLES = ["nw", "ne", "se", "sw"] as const;

/**
 * Rewrite a rectangle so width and height are positive, keeping the same area.
 * Every consumer downstream assumes a top-left origin.
 */
export function normalizeRect(rect: Rect): Rect {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/** Scene-space position of one corner of a (normalized) rectangle. */
export function cornerPoint(rect: Rect, handle: Exclude<CalibrationHandle, "move">): Point {
  const r = normalizeRect(rect);
  return {
    x: handle === "nw" || handle === "sw" ? r.x : r.x + r.width,
    y: handle === "nw" || handle === "ne" ? r.y : r.y + r.height,
  };
}

/**
 * Decide what a press at `point` grabbed.
 *
 * Corners win over the body, so a press in the overlap resizes rather than
 * moves — a rectangle nudged by accident when the GM meant to resize it is
 * the more annoying of the two mistakes, since it loses the alignment they
 * had already found.
 *
 * @param tolerance Grab radius in SCENE units. The caller divides the screen
 *                  radius by the camera scale, so the handle stays the same
 *                  physical size at every zoom level.
 */
export function hitTestHandle(
  rect: Rect,
  point: Point,
  tolerance: number,
): CalibrationHandle | null {
  const r = normalizeRect(rect);

  let best: CalibrationHandle | null = null;
  let bestDistance = tolerance;
  for (const handle of CORNER_HANDLES) {
    const corner = cornerPoint(r, handle);
    const d = Math.hypot(corner.x - point.x, corner.y - point.y);
    if (d <= bestDistance) {
      best = handle;
      bestDistance = d;
    }
  }
  if (best) return best;

  const inside =
    point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height;
  return inside ? "move" : null;
}

/**
 * Apply a drag to the rectangle.
 *
 * @param start  The rectangle as it was when the drag began — NOT the live
 *               one. Accumulating deltas frame by frame drifts; measuring
 *               from the start point does not.
 * @param handle What the drag grabbed.
 * @param delta  Pointer travel since the drag began, in scene units.
 */
export function applyHandleDrag(start: Rect, handle: CalibrationHandle, delta: Point): Rect {
  const r = normalizeRect(start);

  if (handle === "move") {
    return { ...r, x: r.x + delta.x, y: r.y + delta.y };
  }

  const movesLeft = handle === "nw" || handle === "sw";
  const movesTop = handle === "nw" || handle === "ne";

  // Dragging a corner past its opposite flips the rectangle; normalize keeps
  // the result usable instead of producing negative extents.
  return normalizeRect({
    x: movesLeft ? r.x + delta.x : r.x,
    y: movesTop ? r.y + delta.y : r.y,
    width: movesLeft ? r.width - delta.x : r.width + delta.x,
    height: movesTop ? r.height - delta.y : r.height + delta.y,
  });
}

/**
 * A square rectangle centered on `center`, used as the starting box when the
 * GM opens the tool without dragging one out by hand.
 */
export function defaultRect(center: Point, side: number): Rect {
  return { x: center.x - side / 2, y: center.y - side / 2, width: side, height: side };
}

/**
 * Move a rectangle by whole pixels. The arrow keys use this: 1 px for a fine
 * correction, 10 px (Shift) for a coarse one.
 */
export function nudgeRect(rect: Rect, dx: number, dy: number): Rect {
  const r = normalizeRect(rect);
  return { ...r, x: r.x + dx, y: r.y + dy };
}

/** Pixels an arrow key moves the box: 1, or 10 with Shift held. */
export function nudgeStep(shift: boolean): number {
  return shift ? 10 : 1;
}

/**
 * Make a rectangle's cells square: the cell side becomes the LONGER of the two
 * sides per cell, keeping the top-left corner where it is (so the box does not
 * jump under the cursor). `cols` x `rows` is how many cells the box spans.
 */
export function squareUpRect(rect: Rect, cols = 1, rows = 1): Rect {
  const r = normalizeRect(rect);
  const cell = Math.max(r.width / cols, r.height / rows);
  return { x: r.x, y: r.y, width: cell * cols, height: cell * rows };
}

/**
 * Coordinates of the grid lines of a `size`-px grid whose cell (0,0) corner sits
 * at `offset`, covering `[0, extent]`. Pure so the preview is checkable.
 */
export function gridLinePositions(size: number, offset: number, extent: number): number[] {
  if (!(size > 0) || !(extent > 0)) return [];
  const first = ((offset % size) + size) % size;
  const out: number[] = [];
  for (let p = first; p <= extent; p += size) out.push(p);
  return out;
}

/**
 * The box a typed cell size / offset implies, placed on the cell nearest to
 * `near` so editing a number does not teleport the box across the map.
 *
 * @param origin  Where the map image starts (scene padding), same coordinates as `near`.
 * @param offset  Grid offset relative to the map, as stored in the scene.
 */
export function rectFromGrid(
  size: number,
  offset: Point,
  origin: Point,
  near: Rect,
  cols = 1,
  rows = 1,
): Rect {
  const n = normalizeRect(near);
  const kx = Math.round((n.x - origin.x - offset.x) / size);
  const ky = Math.round((n.y - origin.y - offset.y) / size);
  return {
    x: origin.x + offset.x + kx * size,
    y: origin.y + offset.y + ky * size,
    width: size * cols,
    height: size * rows,
  };
}
