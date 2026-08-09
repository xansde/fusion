/**
 * Fog of war — vertex limits and simplification thresholds.
 *
 * The accumulated FogShape grows unboundedly as the user explores more of the
 * scene. We cap the vertex count to prevent:
 *  - JSON payloads from growing without bound.
 *  - Clipper2 union operations from slowing down.
 *  - Server storage from growing without bound.
 *
 * When the limit is reached, we simplify aggressively. The simplification
 * strategy NEVER silently discards explored region — it only reduces vertex
 * count by merging near-collinear segments and coarser Douglas-Peucker passes.
 *
 * Invariant: explored area after simplification ⊇ explored area before
 * (within floating-point tolerance). The fog is "generous" — it may reveal
 * slightly more than the original polygon to avoid losing coverage.
 *
 * Spec: 07-visao-iluminacao-fog.md §DEC-VIS-06, §REQ-VIS-082
 */

// ---------------------------------------------------------------------------
// Vertex limit
// ---------------------------------------------------------------------------

/**
 * Hard cap on total vertices across all rings in a FogShape.
 *
 * Chosen so that a typical 4k scene with many rooms stays well within budget,
 * while keeping the worst-case JSON payload < ~500 KB (20k × 2 coords × ~12
 * bytes per number in JSON text ≈ 480 KB).
 *
 * The actual wire payload is smaller because most numbers are small integers
 * (pixel coordinates rarely exceed 10,000).
 */
export const MAX_FOG_VERTICES = 20_000 as const;

/**
 * When a union result exceeds MAX_FOG_VERTICES, we simplify progressively
 * with increasing tolerance until the count drops below the SOFT target
 * (slightly below the hard cap to give headroom before the next union).
 *
 * If simplification cannot reach the soft target without distorting the shape
 * significantly, we accept the hard cap as the final count.
 */
export const SOFT_FOG_VERTICES_TARGET = 16_000 as const;

// ---------------------------------------------------------------------------
// Simplification tolerances
// ---------------------------------------------------------------------------

/**
 * Sequence of Douglas-Peucker epsilon values tried in order when the shape
 * exceeds MAX_FOG_VERTICES. We try the smallest tolerance first and increase
 * until the vertex count drops below SOFT_FOG_VERTICES_TARGET.
 *
 * Units: scene pixels. At typical dungeon maps (1px ≈ 1 game inch / ~2.5 cm
 * at 100px/5ft scale), a 4px tolerance is sub-grid and visually imperceptible.
 */
export const SIMPLIFICATION_EPSILONS: readonly number[] = [
  0.5, // almost lossless — removes exactly collinear vertices
  1.0, // sub-pixel visual difference
  2.0, // imperceptible at typical zoom levels
  4.0, // 1/25 of a 100px grid cell — still sub-grid
  8.0, // half a 16px icon — minor corner rounding
  16.0, // one grid cell worth of rounding at fine scale
  32.0, // aggressive — used only when all else fails
] as const;

/**
 * Minimum vertex count per ring. Rings with fewer vertices are degenerate
 * and should be dropped during serialization/simplification.
 */
export const MIN_RING_VERTICES = 3 as const;

/**
 * Minimum area (in square pixels) for a polygon to be kept after
 * simplification. Polygons smaller than this are likely numerical noise
 * and can be safely dropped without losing meaningful exploration.
 *
 * 1 square pixel = the smallest possible visible area.
 * 25 = 5×5 pixels — a tiny but real area.
 */
export const MIN_POLYGON_AREA_PX2 = 25 as const;

// ---------------------------------------------------------------------------
// Server-side size limits (for validation)
// ---------------------------------------------------------------------------

/**
 * Maximum allowed size of the serialized FogShapeData JSON in bytes.
 * The server rejects fog:update payloads exceeding this to prevent abuse.
 *
 * ~512 KB is generous for a 20k-vertex shape (~2 bytes/coord compressed,
 * more in raw JSON — set high enough to never reject a valid shape).
 */
export const MAX_FOG_PAYLOAD_BYTES = 524_288 as const; // 512 KB

/**
 * Maximum number of polygons in a FogShape.
 * Disjoint rooms are fine; thousands of single-polygon islands are not.
 * At 20k total vertices and minimum 3 vertices per polygon, the hard
 * upper bound is ~6666, but we cap earlier for safety.
 */
export const MAX_FOG_POLYGONS = 2_000 as const;
