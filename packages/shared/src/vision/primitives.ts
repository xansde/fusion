/**
 * Pure geometric primitives for the vision subsystem.
 *
 * All functions are:
 *  - Side-effect-free (pure functions)
 *  - Independent of PIXI, DOM, or any rendering concern
 *  - Exhaustively testable with Vitest in a Node environment
 *
 * Coordinate system: scene pixels, Y-axis pointing down (standard screen coords).
 *
 * Spec: 07-visao-iluminacao-fog.md §DEC-VIS-03 (angular sweep), §DEC-VIS-11 (pixel coords)
 * REQ-VIS-103: deterministic — same walls + origin ⇒ same polygon on any client.
 * REQ-VIS-030: robust to degenerate cases (zero-length walls, coincident vertices, etc.)
 */

import type { Point, Segment } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Angular epsilon for ray-pair offsets around wall endpoints. */
export const ANGLE_EPSILON = 1e-6;

/** Distance epsilon for floating-point coincidence tests. */
export const DIST_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Angle utilities
// ---------------------------------------------------------------------------

/**
 * Normalize an angle in radians to the range [0, 2π).
 */
export function normalizeAngle(a: number): number {
  const TWO_PI = 2 * Math.PI;
  let n = a % TWO_PI;
  if (n < 0) n += TWO_PI;
  return n;
}

/**
 * Compute the angle from point `from` to point `to` in radians, normalized to [0, 2π).
 */
export function angleTo(from: Point, to: Point): number {
  return normalizeAngle(Math.atan2(to.y - from.y, to.x - from.x));
}

/**
 * Return the angular difference from angle `a` to angle `b` going counter-clockwise,
 * in [0, 2π).
 */
export function angularDiff(a: number, b: number): number {
  return normalizeAngle(b - a);
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

/** Squared distance between two points. */
export function distSq(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/** Euclidean distance between two points. */
export function dist(a: Point, b: Point): number {
  return Math.sqrt(distSq(a, b));
}

/** Return a point at distance `t` along the direction from `origin` given by `angle` (radians). */
export function pointAtAngle(origin: Point, angle: number, distance: number): Point {
  return {
    x: origin.x + Math.cos(angle) * distance,
    y: origin.y + Math.sin(angle) * distance,
  };
}

// ---------------------------------------------------------------------------
// Segment–segment intersection
// REQ-VIS-030: robust to collinear/endpoint cases
// ---------------------------------------------------------------------------

/** Result of a segment–segment intersection test. */
export type IntersectionResult =
  | { hit: false }
  | {
      hit: true;
      /**
       * Parameter t ∈ [0, 1] along segment AB (ray segment from origin).
       * Point = A + t * (B - A).
       */
      t: number;
      /**
       * Parameter u ∈ [0, 1] along segment CD (wall segment).
       * Point = C + u * (D - C).
       */
      u: number;
      /** Intersection point in scene coordinates. */
      point: Point;
    };

/**
 * Compute the intersection of two line segments: AB and CD.
 *
 * Returns { hit: false } when the segments are:
 *  - parallel or collinear (including overlapping collinear — treated as no unique hit)
 *  - non-intersecting (t or u outside [0,1])
 *
 * For the angular sweep, `AB` is the ray from the origin to a far point, and
 * `CD` is a wall segment. We want the parametric hit along AB.
 *
 * Collinear case:
 *   When the denominator is ~0 the segments are parallel/collinear. We return
 *   no hit because collinear overlapping segments don't produce a single unique
 *   intersection point — the sweep handles them by treating both endpoints as
 *   ray targets (they still produce correct shadow geometry).
 *
 * Endpoint touches (t = 0|1, u = 0|1):
 *   Considered valid intersections (inclusive bounds). This correctly handles
 *   T-junctions and X-junctions where walls share an endpoint.
 */
export function segmentIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): IntersectionResult {
  const abx = bx - ax;
  const aby = by - ay;
  const cdx = dx - cx;
  const cdy = dy - cy;

  // Cross product of AB and CD direction vectors.
  // denominator = AB × CD
  const denom = abx * cdy - aby * cdx;

  if (Math.abs(denom) < DIST_EPSILON) {
    // Parallel or collinear — no unique intersection.
    return { hit: false };
  }

  const acx = cx - ax;
  const acy = cy - ay;

  // t = (AC × CD) / (AB × CD)
  const t = (acx * cdy - acy * cdx) / denom;
  // u = (AC × AB) / (AB × CD)
  const u = (acx * aby - acy * abx) / denom;

  if (t < -DIST_EPSILON || t > 1 + DIST_EPSILON) return { hit: false };
  if (u < -DIST_EPSILON || u > 1 + DIST_EPSILON) return { hit: false };

  // Clamp to [0,1] to avoid floating-point overshoot.
  const tClamped = Math.max(0, Math.min(1, t));

  const point: Point = {
    x: ax + tClamped * abx,
    y: ay + tClamped * aby,
  };

  return { hit: true, t: tClamped, u: Math.max(0, Math.min(1, u)), point };
}

// ---------------------------------------------------------------------------
// Ray–segment intersection (ray from origin in a given direction)
// ---------------------------------------------------------------------------

/**
 * Find the closest intersection of a ray (origin + direction vector) with a
 * wall segment, returning the distance parameter t along the ray.
 *
 * The ray is infinite; we only care about t >= 0.
 * The wall segment is parameterised as [0, 1] by u.
 *
 * Returns null when there is no intersection.
 */
export function raySegmentIntersect(
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): { t: number; point: Point } | null {
  // Ray endpoint at an arbitrary large distance (the sweep uses a far point anyway).
  const FAR = 1e9;
  const bx = originX + dirX * FAR;
  const by = originY + dirY * FAR;

  const result = segmentIntersect(originX, originY, bx, by, cx, cy, dx, dy);
  if (!result.hit || result.t < -DIST_EPSILON) return null;

  return { t: result.t * FAR, point: result.point };
}

// ---------------------------------------------------------------------------
// Point-in-polygon (ray casting)
// REQ-VIS-029: "is point P in LOS of source F?" uses polygon containment
// ---------------------------------------------------------------------------

/**
 * Test whether a point lies inside (or on the boundary of) a polygon.
 *
 * Uses the standard ray-casting algorithm: cast a horizontal ray from `px`
 * to +∞ and count edge crossings. An odd count means inside.
 *
 * Edge cases:
 *  - Point exactly on an edge: may return true or false (boundary is
 *    implementation-defined); callers that need exact-on-edge semantics should
 *    add a small epsilon test around their query point.
 *  - Degenerate polygon (< 3 vertices): returns false.
 *
 * Complexity: O(n) in the number of polygon vertices.
 */
export function pointInPolygon(px: number, py: number, polygon: readonly Point[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;
  let j = n - 1;

  for (let i = 0; i < n; i++) {
    const vi = polygon[i] as Point;
    const vj = polygon[j] as Point;

    // Standard ray-casting crossing test.
    if (vi.y > py !== vj.y > py && px < ((vj.x - vi.x) * (py - vi.y)) / (vj.y - vi.y) + vi.x) {
      inside = !inside;
    }
    j = i;
  }

  return inside;
}

// ---------------------------------------------------------------------------
// Closest intersection on a ray among multiple wall segments
// ---------------------------------------------------------------------------

/**
 * Find the closest wall segment intersection along the ray from `origin`
 * in direction `angle` (radians), tested against `segments`.
 *
 * Returns the intersection point and its distance squared from origin,
 * or null if no segment is hit.
 *
 * Complexity: O(n) in segments.
 */
export function closestRayIntersection(
  origin: Point,
  angle: number,
  segments: readonly Segment[],
  maxRange: number = 1e9,
): { point: Point; distanceSq: number; segmentIndex: number } | null {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const bx = origin.x + dirX * maxRange;
  const by = origin.y + dirY * maxRange;

  let bestT = Infinity;
  let bestPoint: Point | null = null;
  let bestIdx = -1;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as Segment;
    const result = segmentIntersect(origin.x, origin.y, bx, by, seg.a.x, seg.a.y, seg.b.x, seg.b.y);
    if (result.hit && result.t < bestT) {
      bestT = result.t;
      bestPoint = result.point;
      bestIdx = i;
    }
  }

  if (bestPoint === null) return null;

  return {
    point: bestPoint,
    distanceSq: distSq(origin, bestPoint),
    segmentIndex: bestIdx,
  };
}

// ---------------------------------------------------------------------------
// Polygon area (shoelace) — used to detect degenerate (zero-area) polygons
// ---------------------------------------------------------------------------

/**
 * Signed area of a polygon (positive = CCW, negative = CW in screen coords
 * where Y increases downward).
 */
export function polygonSignedArea(polygon: readonly Point[]): number {
  const n = polygon.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % n] as Point;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Absolute area of a polygon. */
export function polygonArea(polygon: readonly Point[]): number {
  return Math.abs(polygonSignedArea(polygon));
}
