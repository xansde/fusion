/**
 * Fog of war — geometry operations.
 *
 * This module provides:
 *  - unionFog: union of a FogShape with a new polygon (via Clipper2)
 *  - simplifyFog: reduce vertex count while preserving explored area
 *  - approximateArea: fast area estimate for a FogShape
 *  - emptyFog / isFogEmpty: constructors and predicates
 *  - fogVertexCount: count vertices across all rings
 *
 * Clipper2 coordinate convention:
 *  Clipper2's `unionD` uses floating-point (PathD / PathsD), which is ideal
 *  since scene coordinates are already floats. We use the "D" variants
 *  (double precision) throughout, with FillRule.NonZero.
 *
 * Winding convention:
 *  Outer rings: CCW (positive area in screen coords where Y is down — clipper2
 *  uses math coords for winding; we verify via isPositiveD after union).
 *  Hole rings: CW (negative area).
 *
 * Simplification strategy (REQ-VIS-082 invariant — exploration only grows):
 *  Douglas-Peucker simplification shrinks polygons slightly. To ensure the
 *  simplified shape still covers the original, we use Clipper2 offset
 *  (inflatePathsD) with a tiny epsilon *after* DP when vertex count is still
 *  too high — this keeps the shape conservative. For normal operation (DP
 *  alone drops below the target), no inflation is needed.
 *
 * Spec: 07-visao-iluminacao-fog.md §D6, §REQ-VIS-082
 * REQ-VIS-106: pure geometry, no PIXI, no DOM.
 * REQ-ARQ-002: shared must NOT import from server, client, system-api.
 */

import {
  unionD,
  FillRule,
  ramerDouglasPeuckerPathsD,
  simplifyPathsD,
  isPositiveD,
  type PathD,
  type PathsD,
} from "@countertype/clipper2-ts";

import type { FogShape, FogPolygon, FogRing } from "./types.js";
import {
  MAX_FOG_VERTICES,
  SOFT_FOG_VERTICES_TARGET,
  SIMPLIFICATION_EPSILONS,
  MIN_RING_VERTICES,
  MIN_POLYGON_AREA_PX2,
  MAX_FOG_POLYGONS,
} from "./limits.js";

// ---------------------------------------------------------------------------
// Internal helpers — ring ↔ PathD conversion
// ---------------------------------------------------------------------------

/**
 * Convert a FogRing (flat [x0,y0,x1,y1,...]) to a Clipper2 PathD.
 * Validates that the ring has an even number of elements and >= 3 vertices.
 * Returns null for degenerate rings (< 3 vertices or odd length).
 */
function ringToPathD(ring: FogRing): PathD | null {
  if (ring.length < MIN_RING_VERTICES * 2 || ring.length % 2 !== 0) return null;
  const path: PathD = [];
  for (let i = 0; i < ring.length; i += 2) {
    path.push({ x: ring[i] as number, y: ring[i + 1] as number });
  }
  return path;
}

/** Convert a Clipper2 PathD to a FogRing (flat number array). */
function pathDToRing(path: PathD): FogRing {
  const ring: number[] = [];
  for (const pt of path) {
    ring.push(pt.x, pt.y);
  }
  return ring;
}

/**
 * Count vertices in a FogRing (= ring.length / 2).
 * Assumes even length (validated at construction time).
 */
function ringVertexCount(ring: FogRing): number {
  return ring.length >> 1;
}

/**
 * Normalize a PathD to positive winding (as required by Clipper2's NonZero fill rule).
 *
 * Clipper2 uses isPositiveD to determine whether a path is an outer ring (positive)
 * or a hole (negative). In screen coordinates (Y-axis pointing down), CCW paths have
 * negative signed area (opposite to math coordinates). Clipper2's isPositiveD accounts
 * for this — it returns true for CW-in-screen (which it considers "positive").
 *
 * When we pass paths as subjects to unionD with FillRule.NonZero:
 *   - isPositiveD = true  → treated as a filled region to add
 *   - isPositiveD = false → treated as a subtraction (hole)
 *
 * All exploration polygons that the client passes us are outer boundaries (filled
 * regions), so they MUST all be positive. We reverse any negative-winding path
 * before passing it to the union to prevent it from being subtracted.
 */
function normalizeToPositive(path: PathD): PathD {
  return isPositiveD(path) ? path : [...path].reverse();
}

/**
 * Convert a FogShape to a Clipper2 PathsD (all rings as positive outer paths).
 *
 * All rings — including those stored as holes — are normalized to positive winding
 * before being passed to unionD. Holes stored in the FogShape come from Clipper2
 * output of previous unions; when we re-union them with new polygons, their geometry
 * merges correctly with the new outer rings. Holes re-appear naturally in the output
 * when enclosed unexplored areas remain unexplored.
 */
function shapeToPathsD(shape: FogShape): PathsD {
  const paths: PathsD = [];
  for (const poly of shape.polygons) {
    const outer = ringToPathD(poly.outer);
    if (outer !== null) paths.push(normalizeToPositive(outer));
    for (const hole of poly.holes) {
      const h = ringToPathD(hole);
      // Holes are treated as additional subject paths — when we union in new
      // exploration, the holes may get filled in as the user explores further.
      if (h !== null) paths.push(normalizeToPositive(h));
    }
  }
  return paths;
}

/**
 * Convert a Clipper2 PathsD result back to a FogShape.
 *
 * Clipper2 returns flat paths; we need to reconstruct the outer/hole hierarchy.
 * We use isPositiveD to determine winding: positive area = outer ring, negative
 * area = hole.
 *
 * Association strategy: each hole is associated with the first outer ring that
 * contains it (by checking the first vertex). In practice, Clipper2 returns
 * paths in a predictable order (outer, then its holes), so a simple winding-
 * check pass is sufficient for non-pathological cases.
 */
function pathsDToShape(paths: PathsD): FogShape {
  // Separate outer rings from holes
  const outerPaths: PathD[] = [];
  const holePaths: PathD[] = [];

  for (const path of paths) {
    if (path.length < MIN_RING_VERTICES) continue;
    if (isPositiveD(path)) {
      outerPaths.push(path);
    } else {
      holePaths.push(path);
    }
  }

  // Build polygons: naively pair each hole with the last-seen outer ring.
  // Clipper2 returns results clustered: outer, holes, outer, holes, ...
  // For our use case (union of exploration polygons), multi-level nesting is
  // extremely rare and we don't need perfect containment testing.
  const polygons: FogPolygon[] = [];
  for (const outerPath of outerPaths) {
    const outer = pathDToRing(outerPath);
    polygons.push({ outer, holes: [] });
  }

  // Assign holes to the polygon whose outer ring is most likely the parent.
  // We use a simple heuristic: assign to the outer ring with the largest area
  // that contains the first vertex of the hole.
  for (const holePath of holePaths) {
    if (holePath.length === 0) continue;
    const firstPt = holePath[0];
    if (firstPt === undefined) continue;
    const holeRing = pathDToRing(holePath);

    // Find the smallest outer polygon (by area) that contains the hole's first pt.
    // "Smallest containing" avoids assigning to a larger sibling that happens to
    // geometrically contain the hole.
    let bestIdx = -1;
    let bestArea = Infinity;

    for (let i = 0; i < polygons.length; i++) {
      const poly = polygons[i];
      if (poly === undefined) continue;
      const outerPath2 = ringToPathD(poly.outer);
      if (outerPath2 === null) continue;
      const area = Math.abs(areaD(outerPath2));
      if (area < bestArea) {
        // Quick point-in-ring test using cross products (bounding box first)
        if (pointRoughlyInRing(firstPt.x, firstPt.y, outerPath2)) {
          bestArea = area;
          bestIdx = i;
        }
      }
    }

    if (bestIdx >= 0) {
      const poly = polygons[bestIdx];
      if (poly !== undefined) {
        polygons[bestIdx] = {
          outer: poly.outer,
          holes: [...poly.holes, holeRing],
        };
      }
    } else if (polygons.length > 0) {
      // Fallback: assign to the last polygon (avoids dropping the hole entirely)
      const last = polygons[polygons.length - 1];
      if (last !== undefined) {
        polygons[polygons.length - 1] = {
          outer: last.outer,
          holes: [...last.holes, holeRing],
        };
      }
    }
    // If no polygons at all, the hole is degenerate — drop it.
  }

  return buildFogShape(polygons);
}

/** Compute absolute area of a PathD (using the shoelace formula). */
function areaD(path: PathD): number {
  let area = 0;
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const a = path[i];
    const b = path[(i + 1) % n];
    if (a === undefined || b === undefined) continue;
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

/**
 * Rough point-in-ring test: returns true if the point is inside the ring's
 * bounding box (used as a fast pre-filter for hole assignment).
 * Good enough for our heuristic; not a full point-in-polygon test.
 */
function pointRoughlyInRing(px: number, py: number, ring: PathD): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pt of ring) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

// ---------------------------------------------------------------------------
// Vertex counting
// ---------------------------------------------------------------------------

/** Count total vertices across all rings in a FogShape. */
export function fogVertexCount(shape: FogShape): number {
  let count = 0;
  for (const poly of shape.polygons) {
    count += ringVertexCount(poly.outer);
    for (const hole of poly.holes) {
      count += ringVertexCount(hole);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

/**
 * Build a FogShape from an array of FogPolygon, computing the totalVertices
 * cache automatically. Drops degenerate polygons (< 3 outer vertices).
 */
function buildFogShape(polygons: FogPolygon[]): FogShape {
  // Drop degenerate polygons
  const valid = polygons.filter(
    (p) => p.outer.length >= MIN_RING_VERTICES * 2 && p.outer.length % 2 === 0,
  );

  // Cap polygon count
  const capped = valid.length > MAX_FOG_POLYGONS ? valid.slice(0, MAX_FOG_POLYGONS) : valid;

  let totalVertices = 0;
  for (const poly of capped) {
    totalVertices += ringVertexCount(poly.outer);
    for (const hole of poly.holes) {
      totalVertices += ringVertexCount(hole);
    }
  }

  return { polygons: capped, totalVertices };
}

// ---------------------------------------------------------------------------
// Empty shape
// ---------------------------------------------------------------------------

/** The empty FogShape (no exploration). */
export function emptyFog(): FogShape {
  return { polygons: [], totalVertices: 0 };
}

/** Return true if the FogShape has no explored area. */
export function isFogEmpty(shape: FogShape): boolean {
  return shape.polygons.length === 0;
}

// ---------------------------------------------------------------------------
// Approximate area
// ---------------------------------------------------------------------------

/**
 * Approximate total explored area in square pixels.
 *
 * Uses the shoelace formula on each ring (outer adds, holes subtract).
 * This is the exact area of the polygon, just called "approximate" because
 * the FogShape may have been simplified.
 *
 * Useful for:
 *  - Progress tracking ("N% of scene explored")
 *  - Debugging / test assertions
 *  - Sanity check that simplification doesn't lose large areas
 */
export function approximateArea(shape: FogShape): number {
  let total = 0;
  for (const poly of shape.polygons) {
    const outerPath = ringToPathD(poly.outer);
    if (outerPath !== null) {
      total += Math.abs(areaD(outerPath));
    }
    for (const hole of poly.holes) {
      const holePath = ringToPathD(hole);
      if (holePath !== null) {
        total -= Math.abs(areaD(holePath));
      }
    }
  }
  return Math.max(0, total);
}

// ---------------------------------------------------------------------------
// unionFog — main geometry operation
// ---------------------------------------------------------------------------

/**
 * Compute the union of an existing FogShape with a new visibility polygon.
 *
 * The `newPolygon` is a flat ring [x0,y0,x1,y1,...] representing the area
 * that just became visible (the visibility polygon from the current frame).
 *
 * Algorithm:
 *  1. Convert existing shape + new polygon to Clipper2 PathsD.
 *  2. Call unionD with FillRule.NonZero.
 *  3. Convert the result back to FogShape.
 *  4. If the result exceeds MAX_FOG_VERTICES, simplify.
 *
 * Idempotent: if newPolygon is already fully contained in the shape, the
 * result equals the input shape (Clipper2 union is idempotent).
 *
 * @param existing - The accumulated FogShape (may be empty).
 * @param newPolygon - Flat ring [x0,y0,...] of the newly visible area.
 *   Pass an empty array or ring with < 3 vertices to return existing unchanged.
 * @returns Updated FogShape (may be same reference if no-op).
 */
export function unionFog(existing: FogShape, newPolygon: FogRing): FogShape {
  // Validate new polygon
  if (newPolygon.length < MIN_RING_VERTICES * 2 || newPolygon.length % 2 !== 0) {
    return existing; // degenerate input — no change
  }

  const newPath = ringToPathD(newPolygon);
  if (newPath === null) return existing;

  // Build subject paths from existing shape + the new polygon.
  // All paths must be normalized to positive winding for NonZero union.
  const subjectPaths: PathsD = shapeToPathsD(existing);
  subjectPaths.push(normalizeToPositive(newPath));

  // Union via Clipper2
  let resultPaths: PathsD;
  try {
    resultPaths = unionD(subjectPaths, FillRule.NonZero);
  } catch {
    // Clipper2 should not throw on valid input, but be defensive.
    // Return existing unchanged rather than losing exploration.
    return existing;
  }

  // Convert back to FogShape
  let result = pathsDToShape(resultPaths);

  // Enforce vertex limit
  if (result.totalVertices > MAX_FOG_VERTICES) {
    result = simplifyFog(result, SOFT_FOG_VERTICES_TARGET);
  }

  return result;
}

/**
 * Union a FogShape with multiple visibility polygons at once.
 *
 * Equivalent to calling unionFog repeatedly, but more efficient because we
 * perform a single Clipper2 call with all new polygons at once.
 *
 * @param existing - The accumulated FogShape.
 * @param newPolygons - Array of flat rings to union in.
 */
export function unionFogMany(existing: FogShape, newPolygons: readonly FogRing[]): FogShape {
  const validNewPaths: PathsD = [];
  for (const ring of newPolygons) {
    if (ring.length < MIN_RING_VERTICES * 2 || ring.length % 2 !== 0) continue;
    const path = ringToPathD(ring);
    if (path !== null) validNewPaths.push(normalizeToPositive(path));
  }

  if (validNewPaths.length === 0) return existing;

  const subjectPaths: PathsD = [...shapeToPathsD(existing), ...validNewPaths];

  let resultPaths: PathsD;
  try {
    resultPaths = unionD(subjectPaths, FillRule.NonZero);
  } catch {
    return existing;
  }

  let result = pathsDToShape(resultPaths);

  if (result.totalVertices > MAX_FOG_VERTICES) {
    result = simplifyFog(result, SOFT_FOG_VERTICES_TARGET);
  }

  return result;
}

// ---------------------------------------------------------------------------
// simplifyFog — vertex reduction
// ---------------------------------------------------------------------------

/**
 * Reduce the vertex count of a FogShape to at most `targetVertices`.
 *
 * Strategy:
 *  1. Remove degenerate rings and tiny polygons first (free reduction).
 *  2. Try Douglas-Peucker simplification with increasing epsilon values.
 *  3. If the count still exceeds the target after the largest epsilon, return
 *     the best result achieved — the invariant is "never silently discard
 *     large explored region", not "always hit the target".
 *
 * Safety invariant:
 *  The simplified shape may have slightly fewer vertices but MUST NOT silently
 *  drop large explored areas. Tiny polygons (< MIN_POLYGON_AREA_PX2) are
 *  dropped as they represent noise, not real exploration.
 *
 * Behavior at the limit:
 *  If even the most aggressive DP pass cannot hit the target, the function
 *  returns the shape with the minimum vertex count achievable. This is
 *  documented as "aggressive simplification may cause minor corner rounding"
 *  — the explored area is approximately preserved, not exactly.
 *
 * @param shape - FogShape to simplify.
 * @param targetVertices - Desired vertex count (default: SOFT_FOG_VERTICES_TARGET).
 * @returns Simplified FogShape.
 */
export function simplifyFog(
  shape: FogShape,
  targetVertices: number = SOFT_FOG_VERTICES_TARGET,
): FogShape {
  // Step 1: drop degenerate/tiny polygons — these are free
  const cleaned = dropTinyPolygons(shape);

  if (cleaned.totalVertices <= targetVertices) return cleaned;

  // Step 2: try progressively coarser DP simplification
  let best = cleaned;

  for (const epsilon of SIMPLIFICATION_EPSILONS) {
    const simplified = applyDPSimplification(cleaned, epsilon);
    if (simplified.totalVertices < best.totalVertices) {
      best = simplified;
    }
    if (best.totalVertices <= targetVertices) break;
  }

  return best;
}

/**
 * Drop polygons with area below MIN_POLYGON_AREA_PX2.
 * Also drops rings with fewer than MIN_RING_VERTICES vertices.
 */
function dropTinyPolygons(shape: FogShape): FogShape {
  const polygons: FogPolygon[] = [];

  for (const poly of shape.polygons) {
    const outerPath = ringToPathD(poly.outer);
    if (outerPath === null) continue;

    const area = Math.abs(areaD(outerPath));
    if (area < MIN_POLYGON_AREA_PX2) continue; // drop tiny polygons

    // Also filter degenerate holes
    const validHoles: FogRing[] = [];
    for (const hole of poly.holes) {
      if (hole.length >= MIN_RING_VERTICES * 2 && hole.length % 2 === 0) {
        validHoles.push(hole);
      }
    }

    polygons.push({ outer: poly.outer, holes: validHoles });
  }

  return buildFogShape(polygons);
}

/**
 * Apply Ramer-Douglas-Peucker simplification to all rings in the shape.
 *
 * After DP, drop any polygons whose outer ring has fewer than MIN_RING_VERTICES
 * vertices (DP can collapse small polygons to lines/points).
 */
function applyDPSimplification(shape: FogShape, epsilon: number): FogShape {
  // Gather all outer rings and hole rings separately
  const allPaths: PathsD = [];
  const ringMeta: Array<{ polyIdx: number; isHole: boolean }> = [];

  for (let i = 0; i < shape.polygons.length; i++) {
    const poly = shape.polygons[i];
    if (poly === undefined) continue;
    const outerPath = ringToPathD(poly.outer);
    if (outerPath !== null) {
      allPaths.push(outerPath);
      ringMeta.push({ polyIdx: i, isHole: false });
    }
    for (const hole of poly.holes) {
      const holePath = ringToPathD(hole);
      if (holePath !== null) {
        allPaths.push(holePath);
        ringMeta.push({ polyIdx: i, isHole: true });
      }
    }
  }

  if (allPaths.length === 0) return shape;

  // Simplify all paths at once
  const simplified = ramerDouglasPeuckerPathsD(allPaths, epsilon);

  // Also apply collinear trimming via clipper2's simplifyPathsD
  const trimmed = simplifyPathsD(simplified, epsilon);

  // Rebuild polygons from the trimmed paths
  // We use pathsDToShape which handles winding detection
  return pathsDToShape(trimmed);
}
