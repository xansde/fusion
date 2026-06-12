/**
 * Visibility polygon computation via angular sweep.
 *
 * Algorithm overview (independent implementation based on Red Blob Games /
 * Nicky Case public references — no proprietary code reproduced):
 *
 *   1. Collect all "blocking" wall segments (caller filters by dimension).
 *   2. Build the bounding rectangle of the scene as 4 outer wall segments.
 *   3. For every endpoint of every segment, compute the angle from the origin.
 *      Cast three rays per endpoint: angle-ε, angle, angle+ε to correctly
 *      resolve corners (REQ-VIS-021).
 *   4. Sort all candidate angles.
 *   5. For each angle, cast a ray from the origin and find the closest
 *      intersecting segment. The hit point becomes a vertex of the polygon.
 *   6. Connect all hit points in angle order → visibility polygon.
 *   7. Apply range clipping (circular) and cone clipping (REQ-VIS-023).
 *
 * Terrain ("limited") walls:
 *   The sweep tracks how many "limited" segments each ray has crossed.
 *   Crossing 0 or 1 → the ray continues. Crossing 2+ → blocked (D5, REQ-VIS-025).
 *   Separate counters per dimension are managed by the caller (who provides
 *   pre-filtered segment lists for each dimension).
 *
 * Directionality:
 *   Before a segment is treated as blocking, we check the wall's `dir` against
 *   the side the ray comes from (REQ-VIS-026).
 *
 * Degenerate origin cases (REQ-VIS-030):
 *   - Origin exactly on a wall segment: the polygon will be very small or empty
 *     (the segment appears as two coincident endpoints with no shadow gap).
 *     Documented behavior: returns a minimal or empty polygon.
 *   - Zero-length walls: treated as points; their "endpoints" produce duplicate
 *     angles which are deduplicated before the sort.
 *   - Walls outside the scene bounds: will never be intersected by bounded rays.
 *
 * Spec: 07-visao-iluminacao-fog.md §REQ-VIS-020–REQ-VIS-031, D3, D5, D11
 * Complexity: O(n log n) — dominated by the angle sort (REQ-VIS-101).
 */

import {
  normalizeAngle,
  ANGLE_EPSILON,
  DIST_EPSILON,
  segmentIntersect,
  pointInPolygon,
  dist,
} from "./primitives.js";
import type { Point, Wall, SceneBounds, SweepOptions, VisibilityPolygon } from "./types.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SweepSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** "normal" blocks completely; "limited" counts toward terrain threshold. */
  mode: "normal" | "limited";
  /** Original wall (for directionality check). Null = scene boundary. */
  wall: Wall | null;
}

// ---------------------------------------------------------------------------
// Scene-bounds segments
// ---------------------------------------------------------------------------

/**
 * Build 4 boundary segments from the scene bounds rectangle.
 * These act as "infinite" walls so every ray terminates within the scene.
 */
function boundsSegments(bounds: SceneBounds): SweepSegment[] {
  const { x, y, width, height } = bounds;
  const x2 = x + width;
  const y2 = y + height;
  return [
    { ax: x, ay: y, bx: x2, by: y, mode: "normal", wall: null }, // top
    { ax: x2, ay: y, bx: x2, by: y2, mode: "normal", wall: null }, // right
    { ax: x2, ay: y2, bx: x, by: y2, mode: "normal", wall: null }, // bottom
    { ax: x, ay: y2, bx: x, by: y, mode: "normal", wall: null }, // left
  ];
}

// ---------------------------------------------------------------------------
// Directionality check
// REQ-VIS-026: a wall with dir "left" only blocks rays that originate on its
// left side (positive cross product of a→b with a→origin).
// ---------------------------------------------------------------------------

function sidePassesDirectionality(wall: Wall, origin: Point): boolean {
  if (wall.dir === "both") return true;

  const wallDx = wall.b.x - wall.a.x;
  const wallDy = wall.b.y - wall.a.y;
  const toDx = origin.x - wall.a.x;
  const toDy = origin.y - wall.a.y;
  const cross = wallDx * toDy - wallDy * toDx;

  // cross > 0: origin is to the LEFT of a→b
  if (wall.dir === "left") return cross > -DIST_EPSILON;
  // wall.dir === "right"
  return cross < DIST_EPSILON;
}

// ---------------------------------------------------------------------------
// Closest blocking hit along a ray
// Terrain ("limited") walls: count layers crossed; block after ≥ 2.
// ---------------------------------------------------------------------------

interface RayHit {
  point: Point;
  t: number; // parameter along the unit-direction ray (= distance in scene px)
}

/**
 * Cast a ray from `origin` in direction `angle` (radians) against all segments
 * in `segs`. Return the point where the ray is blocked.
 *
 * Terrain logic (REQ-VIS-025, D5):
 *   Collect ALL intersections, sort by t, walk through them:
 *   - "limited" hit: increment terrain counter. If counter >= 2 → blocked here.
 *   - "normal" hit: blocked immediately.
 *   Origin exactly on a segment is ignored (t ≈ 0).
 *
 * If no segment blocks, returns a point at `maxDist` in the ray direction.
 */
function castRay(origin: Point, angle: number, segs: SweepSegment[], maxDist: number): RayHit {
  const FAR = maxDist + 1;
  const bx = origin.x + Math.cos(angle) * FAR;
  const by = origin.y + Math.sin(angle) * FAR;

  // Collect all hits.
  const hits: Array<{ t: number; mode: "normal" | "limited"; wall: Wall | null }> = [];

  for (const seg of segs) {
    const result = segmentIntersect(origin.x, origin.y, bx, by, seg.ax, seg.ay, seg.bx, seg.by);
    if (!result.hit) continue;

    // Skip hits at or behind the origin (t ≈ 0 means origin is on the segment).
    if (result.t * FAR < DIST_EPSILON * 10) continue;

    // Directionality check.
    if (seg.wall !== null && !sidePassesDirectionality(seg.wall, origin)) continue;

    hits.push({ t: result.t * FAR, mode: seg.mode, wall: seg.wall });
  }

  if (hits.length === 0) {
    // No obstacles — return the point at maxDist.
    return {
      point: {
        x: origin.x + Math.cos(angle) * maxDist,
        y: origin.y + Math.sin(angle) * maxDist,
      },
      t: maxDist,
    };
  }

  // Sort by distance from origin.
  hits.sort((a, b) => a.t - b.t);

  let terrainCount = 0;

  for (const hit of hits) {
    if (hit.t > maxDist + DIST_EPSILON) {
      // Beyond the clipping distance — return the max-range point.
      break;
    }

    if (hit.mode === "limited") {
      terrainCount++;
      if (terrainCount >= 2) {
        // Second terrain layer crossed → blocked.
        const point: Point = {
          x: origin.x + Math.cos(angle) * hit.t,
          y: origin.y + Math.sin(angle) * hit.t,
        };
        return { point, t: hit.t };
      }
      // First terrain layer — ray passes through, continue.
    } else {
      // Normal (fully blocking) segment.
      const point: Point = {
        x: origin.x + Math.cos(angle) * hit.t,
        y: origin.y + Math.sin(angle) * hit.t,
      };
      return { point, t: hit.t };
    }
  }

  // Ray passed through all obstacles (or only 0–1 terrain layers).
  return {
    point: {
      x: origin.x + Math.cos(angle) * maxDist,
      y: origin.y + Math.sin(angle) * maxDist,
    },
    t: maxDist,
  };
}

// ---------------------------------------------------------------------------
// Cone clipping helpers
// REQ-VIS-023: restrict polygon to a directional cone when angle < 360°
// ---------------------------------------------------------------------------

const _TWO_PI = 2 * Math.PI;

/**
 * Return true if `a` falls within the cone [coneStart, coneEnd] (both in [0,2π)).
 * The cone may wrap around 2π.
 */
function angleInCone(a: number, coneStart: number, coneEnd: number): boolean {
  // Normalize to handle wrap-around.
  if (coneStart <= coneEnd) {
    return a >= coneStart - ANGLE_EPSILON && a <= coneEnd + ANGLE_EPSILON;
  }
  // Wraps around 0.
  return a >= coneStart - ANGLE_EPSILON || a <= coneEnd + ANGLE_EPSILON;
}

// ---------------------------------------------------------------------------
// Main sweep function
// REQ-VIS-020: compute visibility polygon by angular sweep
// REQ-VIS-021: rays at endpoints ± ε
// REQ-VIS-023: range + cone constraints
// REQ-VIS-025: terrain (limited) one-layer rule
// REQ-VIS-026: directionality
// REQ-VIS-030: degenerate cases
// ---------------------------------------------------------------------------

/**
 * Compute the visibility polygon from `origin` against `walls`.
 *
 * `walls` should already be filtered for the relevant dimension (e.g. sight)
 * by `wallsBlockingSight()` before passing here. The sweep only applies the
 * "limited" terrain counting and directionality logic; it does not re-filter
 * by dimension.
 *
 * Degenerate case — origin on a wall:
 *   The resulting polygon will be empty or have near-zero area. This is
 *   documented behavior (REQ-VIS-030). The caller should check
 *   `polygonArea(result.vertices) < threshold` if needed.
 *
 * @param origin  Source position in scene pixels.
 * @param walls   Pre-filtered wall list (for the relevant dimension).
 * @param options Sweep options (bounds, range, cone).
 * @returns       Visibility polygon (ordered vertices).
 */
export function computeVisibilityPolygon(
  origin: Point,
  walls: readonly Wall[],
  options: SweepOptions,
): VisibilityPolygon {
  const { sceneBounds } = options;
  const maxRange =
    options.maxRange != null && options.maxRange > 0
      ? options.maxRange
      : Math.max(sceneBounds.width, sceneBounds.height) * 2;

  // -------------------------------------------------------------------------
  // Build sweep segments from walls + scene boundaries.
  // -------------------------------------------------------------------------

  // Determine which dimension controls the "limited" (terrain) mode for this sweep.
  // REQ-VIS-025, D5: each dimension has an independent terrain counter.
  // The caller pre-filters walls by dimension; we read the correct field here.
  const dim = options.dimension ?? "sight";

  const segs: SweepSegment[] = boundsSegments(sceneBounds);

  for (const wall of walls) {
    // Read the restriction for the active dimension to decide if this is a
    // terrain ("limited") wall for this particular sweep, or a normal blocker.
    const restriction = dim === "sound" ? wall.sound : dim === "light" ? wall.light : wall.sight;
    segs.push({
      ax: wall.a.x,
      ay: wall.a.y,
      bx: wall.b.x,
      by: wall.b.y,
      mode: restriction === "limited" ? "limited" : "normal",
      wall,
    });
  }

  // -------------------------------------------------------------------------
  // Collect candidate angles — one set for endpoint-exact, two for ±ε.
  // REQ-VIS-021.
  // -------------------------------------------------------------------------

  // Use a Set to deduplicate near-identical angles (zero-length walls, etc.).
  const angleSet = new Set<number>();

  // Check if cone clipping is active.
  const coneAngle = options.angle ?? 360;
  const useCone = coneAngle < 360 - ANGLE_EPSILON;
  const rotation = normalizeAngle(((options.rotation ?? 0) * Math.PI) / 180);
  const halfConeRad = ((coneAngle / 2) * Math.PI) / 180;
  const coneStart = normalizeAngle(rotation - halfConeRad);
  const coneEnd = normalizeAngle(rotation + halfConeRad);

  for (const seg of segs) {
    // Both endpoints of each segment.
    for (const [ex, ey] of [
      [seg.ax, seg.ay],
      [seg.bx, seg.by],
    ] as const) {
      const a = normalizeAngle(Math.atan2(ey - origin.y, ex - origin.x));

      if (useCone) {
        // Only include angles within or near the cone.
        if (!angleInCone(a, coneStart, coneEnd)) continue;
      }

      // Three rays per endpoint: exact, -ε, +ε.
      angleSet.add(a);
      angleSet.add(normalizeAngle(a - ANGLE_EPSILON));
      angleSet.add(normalizeAngle(a + ANGLE_EPSILON));
    }
  }

  // Always include the cone boundary angles when using a cone.
  if (useCone) {
    angleSet.add(coneStart);
    angleSet.add(normalizeAngle(coneStart + ANGLE_EPSILON));
    angleSet.add(normalizeAngle(coneStart - ANGLE_EPSILON));
    angleSet.add(coneEnd);
    angleSet.add(normalizeAngle(coneEnd + ANGLE_EPSILON));
    angleSet.add(normalizeAngle(coneEnd - ANGLE_EPSILON));
  } else {
    // Full circle: ensure we cover the starting direction (0 = east).
    angleSet.add(0);
    angleSet.add(normalizeAngle(-ANGLE_EPSILON));
    angleSet.add(ANGLE_EPSILON);
  }

  // Sort angles.
  // When a wrapping cone is active (coneStart > coneEnd, e.g. an east-facing
  // wide cone or any cone whose arc crosses the 0/2π boundary), sorting by
  // absolute angle produces a jump: angles just below 2π appear before angles
  // just above 0, breaking the ring order and yielding a self-intersecting
  // polygon. Fix: for wrapping cones, "unwrap" every angle that fell in the
  // [0, coneEnd] arc by adding 2π so the full [coneStart, coneStart+arc] range
  // is monotonic. Non-wrapping cones and the full-circle case use absolute sort.
  const coneWraps = useCone && coneStart > coneEnd;
  const angles = Array.from(angleSet).sort((a, b) => {
    if (coneWraps) {
      // Map each angle to the unwrapped domain [coneStart, coneStart + 2π).
      const ua = a < coneStart - ANGLE_EPSILON ? a + _TWO_PI : a;
      const ub = b < coneStart - ANGLE_EPSILON ? b + _TWO_PI : b;
      return ua - ub;
    }
    return a - b;
  });

  if (angles.length === 0) {
    return { vertices: [] };
  }

  // -------------------------------------------------------------------------
  // Cast rays at each angle, collect polygon vertices.
  // -------------------------------------------------------------------------

  const vertices: Point[] = [];

  for (const angle of angles) {
    const hit = castRay(origin, angle, segs, maxRange);

    // Apply range clipping: clamp to maxRange.
    let pt = hit.point;
    if (options.maxRange != null && options.maxRange > 0) {
      const d = dist(origin, pt);
      if (d > options.maxRange + DIST_EPSILON) {
        const ratio = options.maxRange / d;
        pt = {
          x: origin.x + (pt.x - origin.x) * ratio,
          y: origin.y + (pt.y - origin.y) * ratio,
        };
      }
    }

    vertices.push(pt);
  }

  // -------------------------------------------------------------------------
  // For cone mode, add the origin so the polygon is a proper "pie slice".
  // -------------------------------------------------------------------------

  let finalVertices: Point[];

  if (useCone) {
    // Add arcs at the cone boundaries + origin.
    finalVertices = [origin, ...vertices];
  } else {
    finalVertices = vertices;
  }

  // -------------------------------------------------------------------------
  // Remove consecutive duplicate points (can arise from ±ε rays).
  // -------------------------------------------------------------------------

  const deduped: Point[] = [];
  for (let i = 0; i < finalVertices.length; i++) {
    const cur = finalVertices[i] as Point;
    const prev = deduped[deduped.length - 1];
    if (prev === undefined || dist(cur, prev) > DIST_EPSILON) {
      deduped.push(cur);
    }
  }

  // Close the ring dedup (last ≈ first).
  if (
    deduped.length > 1 &&
    dist(deduped[0] as Point, deduped[deduped.length - 1] as Point) <= DIST_EPSILON
  ) {
    deduped.pop();
  }

  return { vertices: deduped };
}

// ---------------------------------------------------------------------------
// LOS test — REQ-VIS-029
// ---------------------------------------------------------------------------

/**
 * Test whether point `target` is within the line of sight of the visibility
 * polygon `polygon`.
 *
 * This is used to answer "is token T visible to source S?" after the polygon
 * has been computed.
 *
 * @param target  Point to test.
 * @param polygon Previously computed visibility polygon.
 * @returns true if `target` is inside (or on the boundary of) the polygon.
 */
export function isInLOS(target: Point, polygon: VisibilityPolygon): boolean {
  return pointInPolygon(target.x, target.y, polygon.vertices);
}
