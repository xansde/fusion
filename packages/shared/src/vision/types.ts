/**
 * Vision subsystem — shared types.
 *
 * These types live in packages/shared so both the server (movement collision
 * validation) and the client (rendering visibility polygons) use the exact same
 * geometry definitions without divergence.
 *
 * Spec references:
 *  - 07-visao-iluminacao-fog.md — Wall model, RestrictionMode, Door states
 *  - 02-modelo-de-dados.md — WallData embedded schema
 *  - REQ-VIS-106: types must live in packages/shared
 */

// ---------------------------------------------------------------------------
// Coordinate primitives
// ---------------------------------------------------------------------------

/** A 2-D point in scene pixel coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A line segment defined by two endpoints. */
export interface Segment {
  readonly a: Point;
  readonly b: Point;
}

// ---------------------------------------------------------------------------
// Wall model — spec 07-visao-iluminacao-fog.md §Modelo de dados
// REQ-VIS-001: independent restrictions per dimension
// REQ-VIS-002: RestrictionMode per dimension; move only none/normal
// REQ-VIS-003: dir ∈ {both, left, right}
// REQ-VIS-004: doorType + doorState; open door does NOT restrict anything
// ---------------------------------------------------------------------------

/**
 * Restriction modes for sight/light/sound dimensions.
 * `move` only uses "none" | "normal" (spec REQ-VIS-002).
 */
export type RestrictionMode =
  | "none" // passes freely
  | "normal" // blocks
  | "limited"; // passes one layer (terrain — REQ-VIS-025)
// proximity / reverse_proximity are [V2]

/** Move restriction (subset of RestrictionMode). */
export type MoveRestriction = "none" | "normal";

/**
 * Directionality of a wall relative to its a→b orientation.
 * REQ-VIS-003: restrictions only apply from the indicated side(s).
 */
export type WallDirection = "both" | "left" | "right";

/** Door type. */
export type DoorType = "none" | "door" | "secret";

/**
 * Door state.
 * REQ-VIS-004: when "open", the wall does NOT restrict any dimension.
 */
export type DoorState = "closed" | "open" | "locked";

/**
 * Wall: a line segment embedded in a Scene that restricts perception.
 *
 * Each wall carries independent restrictions for move / sight / light / sound.
 * The same segment can block vision without blocking movement (e.g. invisible
 * wall), or block light but not movement (e.g. ethereal).
 *
 * Spec: 07-visao-iluminacao-fog.md §D1 (four independent restrictions)
 */
export interface Wall {
  readonly _id: string;
  /** Endpoint A in scene pixel coordinates. */
  readonly a: Point;
  /** Endpoint B in scene pixel coordinates. */
  readonly b: Point;
  /** Movement restriction. Only "none" | "normal". */
  readonly move: MoveRestriction;
  /** Sight restriction (vision). */
  readonly sight: RestrictionMode;
  /** Light restriction (illumination). */
  readonly light: RestrictionMode;
  /** Sound restriction (audio occlusion). */
  readonly sound: RestrictionMode;
  /**
   * Directionality relative to the a→b orientation.
   * "both" (default): restricts from either side.
   * "left" / "right": one-way restriction (CA-17).
   */
  readonly dir: WallDirection;
  /** Door type: none = plain wall, door = interactive, secret = GM-only. */
  readonly doorType: DoorType;
  /** Door state. When "open", the wall restricts nothing (REQ-VIS-004). */
  readonly doorState: DoorState;
}

// ---------------------------------------------------------------------------
// Visibility polygon result
// REQ-VIS-020: polygon computed by angular sweep
// ---------------------------------------------------------------------------

/**
 * Result of a visibility polygon computation.
 * The polygon is an ordered list of vertices (CCW or CW consistent) that forms
 * the visible area from the given origin.
 */
export interface VisibilityPolygon {
  /** Vertices in order (closed ring — last implicitly connects back to first). */
  readonly vertices: readonly Point[];
}

// ---------------------------------------------------------------------------
// Angular sweep options
// REQ-VIS-023: range and cone as optional constraints
// ---------------------------------------------------------------------------

/**
 * Options for the angular sweep visibility computation.
 *
 * - `maxRange`: if provided, clips the polygon to a circle of this radius (px).
 * - `angle`: cone opening angle in degrees (< 360 = directional vision, REQ-VIS-023).
 * - `rotation`: cone center direction in degrees (0 = east, clockwise).
 * - `sceneBounds`: bounding rectangle for the scene canvas (acts as outer wall).
 * - `dimension`: which wall restriction dimension to use for terrain counting.
 *   Walls pre-filtered by the caller; "dimension" tells the sweep which field
 *   determines whether a wall is "normal" or "limited" (terrain).
 *   Defaults to "sight" when omitted.
 */
export interface SweepOptions {
  /**
   * Maximum visibility range in scene pixels.
   * Null or omitted = unlimited (bounded only by sceneBounds).
   */
  maxRange?: number | null;
  /**
   * Cone angle in degrees. 360 = full circle (default).
   * Values < 360 restrict visibility to a directional cone.
   */
  angle?: number;
  /**
   * Cone center direction in degrees, measured clockwise from east (right).
   * Ignored when angle >= 360.
   */
  rotation?: number;
  /**
   * The outer boundary rectangle of the scene.
   * Rays that don't hit any wall will reach this boundary.
   */
  sceneBounds: SceneBounds;
  /**
   * Which perception dimension this sweep is computing.
   * Used to correctly determine whether a wall is "limited" (terrain) or
   * "normal" for the given dimension (REQ-VIS-025, D5).
   *
   * For example, a wall with sight:"limited" and light:"normal" is "limited"
   * for a sight sweep but "normal" for a light sweep.
   *
   * Defaults to "sight" when omitted.
   */
  dimension?: "sight" | "light" | "sound";
}

/** Axis-aligned bounding rectangle of the scene canvas. */
export interface SceneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Wall filtering — spec 07 REQ-VIS-020, REQ-VIS-025, REQ-VIS-026
// ---------------------------------------------------------------------------

/** Which dimension to filter walls for. */
export type WallDimension = "sight" | "light" | "move" | "sound";
