/**
 * fogDraw.ts — pure geometry for the manual fog tools: turning a pointer
 * gesture (drag corners, clicked vertices, brush samples) into a `FogOp`.
 *
 * No PIXI and no DOM here, so every rule is testable in Node. Coordinates are
 * scene coordinates (the same system tokens live in).
 */

import { MANUAL_FOG_LIMITS, type FogMode, type FogOp } from "@fusion/shared";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A shape smaller than this (scene px) is a stray click, not an edit. */
export const MIN_SHAPE_SIZE = 4;

/** Mode actually used: Alt flips the selected mode for the gesture. */
export function effectiveMode(selected: FogMode, altKey: boolean): FogMode {
  if (!altKey) return selected;
  return selected === "reveal" ? "cover" : "reveal";
}

function snapValue(v: number, grid: number, round: (n: number) => number): number {
  return round(v / grid) * grid;
}

/**
 * The rectangle between two drag corners. With `snapGrid` the rectangle grows
 * to the grid lattice (origin = scene origin, where the grid is drawn from), so
 * a drag always lands on whole cells. Returns null for a stray click.
 */
export function buildRectOp(
  mode: FogMode,
  a: Point,
  b: Point,
  snapGrid: number | null,
): FogOp | null {
  let x0 = Math.min(a.x, b.x);
  let y0 = Math.min(a.y, b.y);
  let x1 = Math.max(a.x, b.x);
  let y1 = Math.max(a.y, b.y);
  if (snapGrid !== null && snapGrid > 0) {
    x0 = snapValue(x0, snapGrid, Math.round);
    y0 = snapValue(y0, snapGrid, Math.round);
    x1 = snapValue(x1, snapGrid, Math.round);
    y1 = snapValue(y1, snapGrid, Math.round);
    // A drag inside one cell still selects that cell.
    if (x1 === x0) x1 = x0 + snapGrid;
    if (y1 === y0) y1 = y0 + snapGrid;
  }
  if (x1 - x0 < MIN_SHAPE_SIZE || y1 - y0 < MIN_SHAPE_SIZE) return null;
  return {
    t: "rect",
    m: mode,
    x: Math.round(x0),
    y: Math.round(y0),
    w: Math.round(x1 - x0),
    h: Math.round(y1 - y0),
  };
}

/**
 * The polygon through clicked vertices. Consecutive duplicates (a double click
 * adds the last vertex twice) are dropped. Null below three distinct vertices.
 */
export function buildPolyOp(mode: FogMode, vertices: readonly Point[]): FogOp | null {
  const clean: Point[] = [];
  for (const v of vertices) {
    const last = clean[clean.length - 1];
    if (last && Math.hypot(v.x - last.x, v.y - last.y) < 1) continue;
    clean.push(v);
  }
  if (clean.length < 3 || clean.length > MANUAL_FOG_LIMITS.maxPolyPoints) return null;
  return { t: "poly", m: mode, p: clean.flatMap((v) => [Math.round(v.x), Math.round(v.y)]) };
}

/** Minimum spacing between brush samples, as a fraction of the radius. */
const BRUSH_SPACING = 0.35;

/**
 * Add a pointer sample to a stroke unless it is too close to the previous one
 * (keeps the op small). Returns the same array when nothing was added; a stroke
 * that would exceed the per-op budget stops growing.
 */
export function addBrushSample(
  points: readonly Point[],
  next: Point,
  radius: number,
): readonly Point[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(next.x - last.x, next.y - last.y) < Math.max(1, radius * BRUSH_SPACING)) {
    return points;
  }
  if (points.length >= MANUAL_FOG_LIMITS.maxBrushPoints) return points;
  return [...points, next];
}

/** The brush stroke as an op (one point = a single dab). Null for an empty stroke. */
export function buildBrushOp(
  mode: FogMode,
  radius: number,
  points: readonly Point[],
): FogOp | null {
  if (points.length === 0) return null;
  const r = Math.min(MANUAL_FOG_LIMITS.maxBrushRadius, Math.max(1, Math.round(radius)));
  return {
    t: "brush",
    m: mode,
    r,
    p: points.flatMap((v) => [Math.round(v.x), Math.round(v.y)]),
  };
}

/** Is the cursor close enough to the first vertex to close the polygon with a click? */
export function isNearFirstVertex(
  vertices: readonly Point[],
  cursor: Point,
  tolerance: number,
): boolean {
  const first = vertices[0];
  if (!first || vertices.length < 3) return false;
  return Math.hypot(cursor.x - first.x, cursor.y - first.y) <= tolerance;
}
