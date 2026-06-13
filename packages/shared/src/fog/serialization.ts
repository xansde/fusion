/**
 * Fog of war — serialization and deserialization.
 *
 * FogShape ↔ FogShapeData (JSON-safe wire format) via:
 *   serializeFog(shape) → FogShapeData
 *   deserializeFog(data) → FogShape | Error (via Result<FogShape, string>)
 *
 * Validation is done with Zod. The deserializer validates:
 *  - format version matches FOG_FORMAT_VERSION
 *  - all rings have even length and >= 3 vertices
 *  - totalVertices does not exceed MAX_FOG_VERTICES
 *  - polygon count does not exceed MAX_FOG_POLYGONS
 *
 * Spec: 07-visao-iluminacao-fog.md §REQ-VIS-083
 * REQ-ARQ-002: shared must NOT import from server, client, system-api.
 */

import { z } from "zod";
import type { FogShape, FogShapeData, FogPolygon } from "./types.js";
import { FOG_FORMAT_VERSION } from "./types.js";
import {
  MAX_FOG_VERTICES,
  MAX_FOG_POLYGONS,
  MIN_RING_VERTICES,
  MAX_FOG_PAYLOAD_BYTES,
} from "./limits.js";
import type { Result } from "../result.js";
import { ok, err } from "../result.js";

// ---------------------------------------------------------------------------
// Zod schemas for FogShapeData
// ---------------------------------------------------------------------------

/**
 * A fog ring: flat array of numbers [x0,y0,x1,y1,...].
 * - Must be an array of numbers.
 * - Length must be even.
 * - Length must be >= 6 (3 vertices minimum).
 * - All values must be finite (no NaN / Infinity).
 */
const FogRingSchema = z
  .array(z.number().finite())
  .refine((arr) => arr.length % 2 === 0, {
    message: "Ring must have an even number of elements (x,y pairs)",
  })
  .refine((arr) => arr.length >= MIN_RING_VERTICES * 2, {
    message: `Ring must have at least ${String(MIN_RING_VERTICES)} vertices (${String(MIN_RING_VERTICES * 2)} elements)`,
  });

/** A single polygon: outer ring + holes. */
const FogPolygonDataSchema = z.object({
  outer: FogRingSchema,
  holes: z.array(FogRingSchema),
});

/** The complete serialized FogShape. */
export const FogShapeDataSchema = z
  .object({
    version: z.literal(FOG_FORMAT_VERSION),
    polygons: z.array(FogPolygonDataSchema).max(MAX_FOG_POLYGONS, {
      message: `Too many polygons (max ${String(MAX_FOG_POLYGONS)})`,
    }),
    totalVertices: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_FOG_VERTICES, {
        message: `Too many vertices (max ${String(MAX_FOG_VERTICES)})`,
      }),
  })
  .refine(
    (data) => {
      // Verify that the stated totalVertices matches the actual count
      let count = 0;
      for (const poly of data.polygons) {
        count += poly.outer.length / 2;
        for (const hole of poly.holes) {
          count += hole.length / 2;
        }
      }
      return count === data.totalVertices;
    },
    {
      message: "totalVertices does not match the actual vertex count",
    },
  );

export type ValidatedFogShapeData = z.infer<typeof FogShapeDataSchema>;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a FogShape to a JSON-safe FogShapeData object.
 *
 * The output can be safely passed to JSON.stringify() and stored or
 * transmitted over the network.
 *
 * @param shape - The FogShape to serialize. If empty, produces a valid empty shape.
 * @returns FogShapeData suitable for JSON serialization.
 */
export function serializeFog(shape: FogShape): FogShapeData {
  const polygons = shape.polygons.map((poly) => ({
    outer: [...poly.outer],
    holes: poly.holes.map((h) => [...h]),
  }));

  return {
    version: FOG_FORMAT_VERSION,
    polygons,
    totalVertices: shape.totalVertices,
  };
}

// ---------------------------------------------------------------------------
// Deserialization
// ---------------------------------------------------------------------------

/**
 * Deserialize a FogShapeData object into a FogShape.
 *
 * Validates the input with Zod. Returns a Result<FogShape, string>:
 *  - ok(shape) on success
 *  - err(message) on validation failure
 *
 * The function never throws.
 *
 * @param data - Raw data (typically from JSON.parse). May be anything.
 * @returns Result containing a valid FogShape or an error message.
 */
export function deserializeFog(data: unknown): Result<FogShape> {
  const parsed = FogShapeDataSchema.safeParse(data);

  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => e.message).join("; ");
    return err(`Invalid FogShapeData: ${msg}`);
  }

  const d = parsed.data;

  const polygons: FogPolygon[] = d.polygons.map((poly) => ({
    outer: [...poly.outer],
    holes: poly.holes.map((h) => [...h]),
  }));

  const shape: FogShape = {
    polygons,
    totalVertices: d.totalVertices,
  };

  return ok(shape);
}

/**
 * Compute UTF-8 byte length of a string.
 *
 * Works in both browser and Node.js without requiring DOM or @types/node lib types.
 * Access TextEncoder and Buffer via globalThis casting to avoid TS lib dependencies.
 *
 * Fallback: conservative overestimate (3 bytes/char) — safe for a size limit guard
 * because it only causes false-positive rejections for strings with many multi-byte
 * characters, never silent acceptance of oversized payloads.
 */
function utf8ByteLength(s: string): number {
  const g = globalThis as Record<string, unknown>;

  // TextEncoder — available in all modern browsers and Node.js >= 18
  const TE = g["TextEncoder"] as (new () => { encode(s: string): { length: number } }) | undefined;
  if (typeof TE === "function") {
    return new TE().encode(s).length;
  }

  // Fallback: worst-case 3 bytes per character (covers all BMP code points)
  return s.length * 3;
}

/**
 * Deserialize a FogShapeData from a JSON string.
 *
 * Handles JSON.parse failures gracefully.
 *
 * @param json - JSON string.
 * @returns Result containing a valid FogShape or an error message.
 */
export function deserializeFogFromJson(json: string): Result<FogShape> {
  // Size check before even parsing
  const byteLength = utf8ByteLength(json);

  if (byteLength > MAX_FOG_PAYLOAD_BYTES) {
    return err(
      `Fog payload too large: ${String(byteLength)} bytes (max ${String(MAX_FOG_PAYLOAD_BYTES)})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return err(`Failed to parse fog JSON: ${String(e)}`);
  }

  return deserializeFog(parsed);
}

/**
 * Serialize a FogShape to a JSON string.
 *
 * @param shape - FogShape to serialize.
 * @returns JSON string.
 */
export function serializeFogToJson(shape: FogShape): string {
  return JSON.stringify(serializeFog(shape));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an empty FogShapeData (for use when no exploration has been recorded).
 *
 * This is the canonical "no fog" serialized value that the server stores
 * when a user first enters a scene.
 */
export function emptyFogShapeData(): FogShapeData {
  return {
    version: FOG_FORMAT_VERSION,
    polygons: [],
    totalVertices: 0,
  };
}

/**
 * Verify that a serialized FogShapeData is valid without fully deserializing it.
 *
 * Useful for server-side validation before storing.
 *
 * @param data - Raw data to validate.
 * @returns true if valid, false otherwise.
 */
export function isValidFogShapeData(data: unknown): data is FogShapeData {
  return FogShapeDataSchema.safeParse(data).success;
}

/**
 * Compute the byte size of a serialized FogShape.
 * Used to enforce MAX_FOG_PAYLOAD_BYTES at the server.
 */
export function fogPayloadBytes(shape: FogShape): number {
  return utf8ByteLength(serializeFogToJson(shape));
}

// Export Zod schema so tests and server validation can use it directly
export { FogShapeDataSchema as FogShapeSchema };
