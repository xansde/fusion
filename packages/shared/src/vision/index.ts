/**
 * @fusion/shared — vision subsystem public API
 *
 * Pure geometry for visibility polygon computation. No PIXI, no DOM, no rendering.
 * Usable on both the server (movement collision) and client (visibility render).
 *
 * REQ-VIS-106: types and logic live in packages/shared, consumed by server and client.
 * REQ-ARQ-002: shared must NOT import from server, client, system-api, or systems/*.
 *
 * Main entry points:
 *
 *   computeVisibilityPolygon(origin, walls, options) → VisibilityPolygon
 *     Angular sweep — the core algorithm. Call with pre-filtered walls.
 *
 *   wallsBlockingSight(walls) / wallsBlockingLight(walls) / wallsBlockingMovement(walls)
 *     Pre-filter walls for a specific dimension before passing to the sweep.
 *
 *   moveBlocked(from, to, walls) → boolean
 *     Server-side movement collision test (REQ-VIS-091).
 *
 *   isInLOS(target, polygon) → boolean
 *     LOS test — is a point inside a precomputed visibility polygon? (REQ-VIS-029)
 *
 * Primitives (also exported for testing/reuse):
 *   segmentIntersect, pointInPolygon, closestRayIntersection,
 *   normalizeAngle, angleTo, dist, distSq, polygonArea, ...
 */

export type {
  Point,
  Segment,
  Wall,
  RestrictionMode,
  MoveRestriction,
  WallDirection,
  DoorType,
  DoorState,
  WallDimension,
  VisibilityPolygon,
  SweepOptions,
  SceneBounds,
} from "./types.js";

export {
  // Angle utilities
  normalizeAngle,
  angleTo,
  angularDiff,
  // Distance
  dist,
  distSq,
  pointAtAngle,
  // Intersection
  segmentIntersect,
  raySegmentIntersect,
  closestRayIntersection,
  // Polygon
  pointInPolygon,
  polygonSignedArea,
  polygonArea,
  // Constants
  ANGLE_EPSILON,
  DIST_EPSILON,
} from "./primitives.js";

export {
  // Wall filtering
  wallsBlockingDimension,
  wallsBlockingSight,
  wallsBlockingLight,
  wallsBlockingMovement,
  wallsBlockingSound,
  // Movement collision
  moveBlocked,
  // Wall factory helpers (testing/tooling)
  makeWall,
  makeTerrainWall,
  makeInvisibleWall,
  makeEtherealWall,
  makeDoor,
} from "./walls.js";

export {
  // Sweep
  computeVisibilityPolygon,
  // LOS test
  isInLOS,
} from "./sweep.js";

// ---------------------------------------------------------------------------
// Scene-level schemas: Wall, AmbientLight, TokenVision, TokenLight
// REQ-VIS-106: types live in packages/shared, used by server and client
// ---------------------------------------------------------------------------
export {
  // Zod schemas
  RestrictionModeSchema,
  MoveRestrictionSchema,
  WallDirectionSchema,
  DoorTypeSchema,
  DoorStateSchema,
  PointSchema,
  WallDocumentSchema,
  LightAnimationSchema,
  AmbientLightDocumentSchema,
  VisionModeIdSchema,
  DetectionModeIdSchema,
  DetectionModeEntrySchema,
  TokenVisionSchema,
  TokenLightSchema,
  // Factories
  defaultWallDocument,
  defaultAmbientLightDocument,
} from "./scene-schemas.js";

export type {
  LightAnimation,
  WallDocument,
  AmbientLightDocument,
  VisionModeId,
  DetectionModeId,
  DetectionModeEntry,
  TokenVision,
  TokenLight,
} from "./scene-schemas.js";
