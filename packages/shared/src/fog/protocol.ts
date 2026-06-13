/**
 * Fog of war — protocol payload Zod schemas.
 *
 * Defines the network message payloads for fog operations:
 *
 *   fog:update   — client → server (replace stored shape, idempotent)
 *   fog:get      — client → server (retrieve stored shape on scene load)
 *   fog:reset    — GM → server (clear exploration for user(s))
 *   fog:wasReset — server → client (broadcast after reset)
 *
 * These types are used directly in the EnvelopeType discriminator union
 * in protocol.ts. The actual Envelope wiring (adding these types to the
 * EnvelopeTypeSchema union) is done in fog/index.ts exports — the main
 * protocol.ts is not modified here to avoid merge conflicts with ongoing
 * M-series work.
 *
 * All payload schemas validate strictly (no extra fields via Zod's default).
 * The server uses these schemas to validate incoming messages.
 *
 * Spec: 04-rede-e-sincronizacao.md §fog ops
 * Spec: 07-visao-iluminacao-fog.md §REQ-VIS-083, §REQ-VIS-086, §REQ-VIS-087
 * REQ-ARQ-002: shared must NOT import from server, client, system-api.
 */

import { z } from "zod";
import { FogShapeDataSchema } from "./serialization.js";
import { MAX_FOG_VERTICES, MAX_FOG_POLYGONS } from "./limits.js";

// ---------------------------------------------------------------------------
// fog:update — client → server
// ---------------------------------------------------------------------------

/**
 * Payload for the "fog:update" message.
 *
 * The client sends the full accumulated FogShape for the (user, scene) pair.
 * The server stores it and does NOT broadcast it (fog is per-user).
 *
 * Design note: the server authenticates the user from the session and uses
 * the authenticated userId as the owner — clients cannot spoof other users'
 * fog. The sceneId is validated against the active scene.
 *
 * Spec: REQ-VIS-083 (throttled persistence; the throttling is the client's
 * responsibility — the server stores whatever it receives).
 */
export const FogUpdatePayloadSchema = z
  .object({
    /** Scene the fog belongs to. */
    sceneId: z.string().min(1).max(64),
    /** Full FogShapeData for this (user, scene). */
    shape: FogShapeDataSchema,
  })
  .strict();

export type FogUpdatePayload = z.infer<typeof FogUpdatePayloadSchema>;

// ---------------------------------------------------------------------------
// fog:get — client → server (request)
// ---------------------------------------------------------------------------

/**
 * Payload for the "fog:get" message.
 *
 * Sent by the client when it loads a scene to retrieve its stored exploration.
 * The server responds with FogGetResponsePayload (via ack callback).
 *
 * Spec: REQ-VIS-084
 */
export const FogGetPayloadSchema = z
  .object({
    /** Scene to retrieve fog for. */
    sceneId: z.string().min(1).max(64),
  })
  .strict();

export type FogGetPayload = z.infer<typeof FogGetPayloadSchema>;

// ---------------------------------------------------------------------------
// fog:get response — server → client (ack)
// ---------------------------------------------------------------------------

/**
 * Response payload for "fog:get".
 *
 * Returned via the socket.io ack callback (not a separate event).
 * `shape` is null if the user has no stored exploration for this scene
 * (the scene is fully unexplored).
 */
export const FogGetResponsePayloadSchema = z
  .object({
    sceneId: z.string().min(1).max(64),
    /** Stored FogShapeData, or null if no exploration recorded. */
    shape: FogShapeDataSchema.nullable(),
  })
  .strict();

export type FogGetResponsePayload = z.infer<typeof FogGetResponsePayloadSchema>;

// ---------------------------------------------------------------------------
// fog:reset — GM → server
// ---------------------------------------------------------------------------

/**
 * Target for fog:reset — either all users or a specific user.
 */
export const FogResetTargetSchema = z.union([
  z.literal("all"),
  z.object({ userId: z.string().min(1).max(64) }).strict(),
]);

export type FogResetTarget = z.infer<typeof FogResetTargetSchema>;

/**
 * Payload for the "fog:reset" message.
 *
 * Only GMs can send this. The server MUST verify the sender's role before
 * acting; an unauthorized reset MUST be rejected silently (no broadcast).
 *
 * Spec: REQ-VIS-086, REQ-VIS-087
 */
export const FogResetPayloadSchema = z
  .object({
    /** Scene whose fog is being reset. */
    sceneId: z.string().min(1).max(64),
    /** Who to reset: "all" = all users in the scene; { userId } = specific user. */
    target: FogResetTargetSchema,
  })
  .strict();

export type FogResetPayload = z.infer<typeof FogResetPayloadSchema>;

// ---------------------------------------------------------------------------
// fog:wasReset — server → affected clients (broadcast)
// ---------------------------------------------------------------------------

/**
 * Payload for the "fog:wasReset" broadcast.
 *
 * Sent to affected clients after the server processes a fog:reset.
 * Recipients MUST:
 *  1. Discard their local accumulated FogShape.
 *  2. Discard any uncommitted pending shape.
 *  3. Re-render the scene as fully unexplored.
 *
 * This covers the edge case (REQ-VIS-087, research 04 §4.5, issues #8122
 * #7613) where the client has local exploration not yet committed to the
 * server: the client must not re-apply its local uncommitted state after
 * receiving this reset, even if the server's stored state was already empty.
 *
 * Spec: REQ-VIS-087
 */
export const FogWasResetPayloadSchema = z
  .object({
    /** Scene that was reset. */
    sceneId: z.string().min(1).max(64),
    /** Who was affected. */
    target: FogResetTargetSchema,
  })
  .strict();

export type FogWasResetPayload = z.infer<typeof FogWasResetPayloadSchema>;

// ---------------------------------------------------------------------------
// Re-export limits for use in server validation
// ---------------------------------------------------------------------------

export { MAX_FOG_VERTICES, MAX_FOG_POLYGONS };
