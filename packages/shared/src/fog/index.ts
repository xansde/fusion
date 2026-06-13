/**
 * @fusion/shared — fog of war public API
 *
 * Fog of war subsystem for the Fusion VTT.
 *
 * This module provides:
 *
 * ## Types
 *   FogShape          — in-memory multipolygon (outer + holes per polygon)
 *   FogPolygon        — single polygon with optional holes
 *   FogRing           — flat [x0,y0,x1,y1,...] coordinate array
 *   FogShapeData      — JSON-serializable wire form
 *   FogPolygonData    — wire form of a single polygon
 *
 * ## Core geometry
 *   emptyFog()                          → FogShape (no exploration)
 *   isFogEmpty(shape)                   → boolean
 *   unionFog(existing, newPolygon)      → FogShape (union via Clipper2)
 *   unionFogMany(existing, polygons)    → FogShape (batch union)
 *   simplifyFog(shape, targetVertices?) → FogShape (reduce vertex count)
 *   approximateArea(shape)              → number (square pixels)
 *   fogVertexCount(shape)               → number
 *
 * ## Serialization
 *   serializeFog(shape)                 → FogShapeData
 *   deserializeFog(data)                → Result<FogShape, string>
 *   serializeFogToJson(shape)           → string
 *   deserializeFogFromJson(json)        → Result<FogShape, string>
 *   emptyFogShapeData()                 → FogShapeData
 *   isValidFogShapeData(data)           → boolean (type guard)
 *   fogPayloadBytes(shape)              → number
 *
 * ## Protocol payloads (Zod schemas + inferred types)
 *   FogUpdatePayloadSchema    / FogUpdatePayload
 *   FogGetPayloadSchema       / FogGetPayload
 *   FogGetResponsePayloadSchema / FogGetResponsePayload
 *   FogResetPayloadSchema     / FogResetPayload
 *   FogWasResetPayloadSchema  / FogWasResetPayload
 *   FogResetTargetSchema      / FogResetTarget
 *
 * ## Limits / constants
 *   MAX_FOG_VERTICES          — hard cap on total vertex count (20 000)
 *   SOFT_FOG_VERTICES_TARGET  — simplification target (16 000)
 *   MAX_FOG_PAYLOAD_BYTES     — server reject threshold (512 KB)
 *   MAX_FOG_POLYGONS          — max number of polygons (2 000)
 *   FOG_FORMAT_VERSION        — current wire format version (1)
 *   MIN_RING_VERTICES         — minimum vertices per ring (3)
 *   MIN_POLYGON_AREA_PX2      — minimum polygon area kept after simplification
 *   SIMPLIFICATION_EPSILONS   — ordered epsilon values for DP simplification
 *
 * REQ-VIS-082: accumulated union via Clipper2
 * REQ-VIS-083: serializable, throttled persistence
 * REQ-VIS-086/087: reset protocol
 * REQ-VIS-106: types in packages/shared, consumed by server and client
 * REQ-ARQ-002: NO imports from server, client, system-api, or systems/*
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
  FogRing,
  FogPolygon,
  FogShape,
  FogShapeData,
  FogPolygonData,
  FogFormatVersion,
  // Protocol payload interfaces (non-Zod)
  FogUpdatePayload as FogUpdatePayloadType,
  FogGetPayload as FogGetPayloadType,
  FogGetResponsePayload as FogGetResponsePayloadType,
  FogResetPayload as FogResetPayloadType,
  FogWasResetPayload as FogWasResetPayloadType,
} from "./types.js";

export { FOG_FORMAT_VERSION } from "./types.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
export {
  MAX_FOG_VERTICES,
  SOFT_FOG_VERTICES_TARGET,
  MAX_FOG_PAYLOAD_BYTES,
  MAX_FOG_POLYGONS,
  MIN_RING_VERTICES,
  MIN_POLYGON_AREA_PX2,
  SIMPLIFICATION_EPSILONS,
} from "./limits.js";

// ---------------------------------------------------------------------------
// Core geometry
// ---------------------------------------------------------------------------
export {
  emptyFog,
  isFogEmpty,
  unionFog,
  unionFogMany,
  simplifyFog,
  approximateArea,
  fogVertexCount,
} from "./geometry.js";

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------
export {
  serializeFog,
  deserializeFog,
  serializeFogToJson,
  deserializeFogFromJson,
  emptyFogShapeData,
  isValidFogShapeData,
  fogPayloadBytes,
  // Zod schema (for server-side validation and test assertions)
  FogShapeSchema,
  FogShapeDataSchema,
} from "./serialization.js";

// ---------------------------------------------------------------------------
// Protocol payloads
// ---------------------------------------------------------------------------
export {
  // fog:update
  FogUpdatePayloadSchema,
  // fog:get
  FogGetPayloadSchema,
  FogGetResponsePayloadSchema,
  // fog:reset
  FogResetPayloadSchema,
  FogResetTargetSchema,
  // fog:wasReset
  FogWasResetPayloadSchema,
} from "./protocol.js";

export type {
  FogUpdatePayload,
  FogGetPayload,
  FogGetResponsePayload,
  FogResetPayload,
  FogResetTarget,
  FogWasResetPayload,
} from "./protocol.js";
