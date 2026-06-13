/**
 * Fog of war — core types.
 *
 * FogShape is the serializable representation of a user's accumulated
 * exploration for one scene. It is a multipolygon (outer ring + optional
 * holes), stored as flat number arrays for compact JSON serialization.
 *
 * Coordinate system: scene pixels (same as Wall, Point, VisibilityPolygon).
 *
 * Spec: 07-visao-iluminacao-fog.md §D6, §REQ-VIS-082, §REQ-VIS-083
 * Spec: 04-rede-e-sincronizacao.md §fog ops
 * Spec: 02-modelo-de-dados.md §DEC-18 (fog is NOT a first-class Document in MVP)
 *
 * REQ-VIS-106: types live in packages/shared, used by server and client.
 * REQ-ARQ-002: shared must NOT import from server, client, system-api, or systems/*.
 */

// ---------------------------------------------------------------------------
// Wire format version
// ---------------------------------------------------------------------------

/**
 * Format version for FogShapeData.
 *
 * Increment when the serialized layout changes in a breaking way so the
 * deserializer can reject or migrate old blobs.
 */
export const FOG_FORMAT_VERSION = 1 as const;
export type FogFormatVersion = typeof FOG_FORMAT_VERSION;

// ---------------------------------------------------------------------------
// FogRing — a closed polygon ring as a flat coordinate array
// ---------------------------------------------------------------------------

/**
 * A single closed polygon ring encoded as [x0, y0, x1, y1, ..., xN, yN].
 *
 * Using flat number arrays (not {x,y} objects) keeps JSON serialization small:
 *   - 2 numbers per vertex vs. an object with two named fields.
 *   - Arrays serialize as [1,2,3,4] — no key overhead.
 *
 * The ring is implicitly closed (last vertex connects back to the first).
 * Length must be even and >= 6 (i.e., >= 3 vertices).
 *
 * Outer rings are CCW (positive area); hole rings are CW (negative area).
 * Clipper2 uses the non-zero fill rule, so winding is significant.
 */
export type FogRing = number[];

// ---------------------------------------------------------------------------
// FogPolygon — one polygon: outer ring + optional holes
// ---------------------------------------------------------------------------

/**
 * A single polygon with optional holes.
 *
 * - `outer`: the outer boundary ring (CCW).
 * - `holes`: inner rings that carve out unexplored areas (pillars, walls, etc.)
 *   Each hole ring is CW.
 */
export interface FogPolygon {
  /** Outer boundary ring [x0,y0,x1,y1,...] — CCW, >= 3 vertices. */
  readonly outer: FogRing;
  /** Hole rings — CW, each >= 3 vertices. May be empty. */
  readonly holes: readonly FogRing[];
}

// ---------------------------------------------------------------------------
// FogShape — the complete exploration state for one (user, scene) pair
// ---------------------------------------------------------------------------

/**
 * Multipolygon representing everything a user has explored in a scene.
 *
 * Design decisions:
 *  - Stored as an array of FogPolygon rather than a single polygon to handle
 *    disjoint explored areas (two rooms not yet connected by a corridor).
 *  - Holes model unexplored pockets inside explored areas (pillars, alcoves
 *    the token never entered but whose surrounding corridor was revealed).
 *  - Only grows (union only); shrinks only on GM reset (REQ-VIS-086).
 *  - `totalVertices` is a cached count used for limit checks without iterating
 *    the full shape.
 *
 * Spec: REQ-VIS-082 (accumulated union via clipper2), REQ-VIS-083 (persistible).
 */
export interface FogShape {
  /**
   * Collection of non-overlapping polygons with optional holes.
   * Empty = no exploration (fully unexplored scene).
   */
  readonly polygons: readonly FogPolygon[];

  /**
   * Cached total vertex count across all rings (outers + holes).
   * Used to check MAX_FOG_VERTICES without a full scan.
   * Must equal sum(outer.length/2 + sum(hole.length/2)) over all polygons.
   */
  readonly totalVertices: number;
}

// ---------------------------------------------------------------------------
// Protocol payload shapes (fog:update, fog:get, fog:reset, fog:wasReset)
// ---------------------------------------------------------------------------

/**
 * fog:update — client → server.
 *
 * Replaces the server's stored FogShape for the authenticated user in the
 * given scene. Idempotent: sending the same shape twice is harmless.
 * The server validates size/format and refuses if invalid.
 *
 * Design: full replacement (not a delta) keeps server logic trivial — the
 * server is "dumb storage" (spec design note). The client does the geometry.
 *
 * Spec: 04-rede-e-sincronizacao.md §fog ops, REQ-VIS-083
 */
export interface FogUpdatePayload {
  readonly sceneId: string;
  /** The full, current accumulated FogShape for this (user, scene). */
  readonly shape: FogShapeData;
}

/**
 * fog:get — client → server (request).
 * Server responds with FogGetResponsePayload.
 *
 * Called when a client loads a scene to retrieve its stored exploration.
 * Spec: REQ-VIS-084
 */
export interface FogGetPayload {
  readonly sceneId: string;
}

/**
 * fog:get response — server → client.
 *
 * `shape` is null when the user has no stored exploration for the scene
 * (i.e., it is fully unexplored).
 */
export interface FogGetResponsePayload {
  readonly sceneId: string;
  readonly shape: FogShapeData | null;
}

/**
 * fog:reset — GM → server.
 *
 * Clears exploration for the target user(s) in the given scene.
 * After the server processes it, it broadcasts fog:wasReset to affected clients.
 *
 * Spec: REQ-VIS-086, REQ-VIS-087
 */
export interface FogResetPayload {
  readonly sceneId: string;
  /**
   * "all" = clear all users in the scene.
   * { userId } = clear only that specific user.
   */
  readonly target: "all" | { readonly userId: string };
}

/**
 * fog:wasReset — server → affected clients (broadcast).
 *
 * Received by clients whose fog was just reset. The client MUST:
 *  1. Discard its local accumulated FogShape.
 *  2. Discard any uncommitted pending shape.
 *  3. Re-render the scene as fully unexplored.
 *
 * Spec: REQ-VIS-087 (robust reset, no re-appearance after refresh)
 */
export interface FogWasResetPayload {
  readonly sceneId: string;
  /**
   * Which users were reset. Clients compare against their own userId.
   * "all" means every user; { userId } is a specific user.
   */
  readonly target: "all" | { readonly userId: string };
}

// ---------------------------------------------------------------------------
// FogShapeData — the serializable/wire form of FogShape
// ---------------------------------------------------------------------------

/**
 * Wire-safe, JSON-serializable form of a FogShape.
 *
 * This is what the server stores and what trafics over the network.
 * The `version` field lets the deserializer reject future-format blobs.
 *
 * FogShape ↔ FogShapeData via serializeFog / deserializeFog.
 */
export interface FogShapeData {
  /** Format version — must equal FOG_FORMAT_VERSION (1). */
  readonly version: FogFormatVersion;
  /** Serialized polygons. */
  readonly polygons: FogPolygonData[];
  /** Total vertex count (cached). */
  readonly totalVertices: number;
}

/** Wire-safe form of a FogPolygon. */
export interface FogPolygonData {
  /** Outer ring as flat [x0,y0,x1,y1,...]. */
  readonly outer: number[];
  /** Hole rings. */
  readonly holes: number[][];
}
