/**
 * Network protocol types — envelope and message definitions.
 *
 * REQ-NET-010..014, REQ-NET-093
 * All types live in @fusion/shared so both server and client share a single source of truth.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------

/**
 * Version of the Fusion socket protocol.
 * Incompatible versions trigger a PROTOCOL_MISMATCH rejection.
 */
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/**
 * Discriminator strings for all message types.
 * Format: "domain:action"
 */
export const EnvelopeTypeSchema = z.union([
  z.literal("doc:create"),
  z.literal("doc:update"),
  z.literal("doc:delete"),
  z.literal("token:move"),
  z.literal("token:preview"),
  z.literal("query"),
  z.literal("presence:cursor"),
  z.literal("presence:ping"),
  z.literal("presence:pan"),
  z.literal("presence:online"),
  z.literal("presence:typing"),
  z.literal("system"),
  // Built-in system handlers (M0-C)
  z.literal("system:ping"),
  z.literal("system:whoami"),
  z.literal("resync:request"),
  z.literal("resync:delta"),
  z.literal("resync:full"),
  z.literal("ack:ok"),
  z.literal("ack:error"),
]);

export type EnvelopeType = z.infer<typeof EnvelopeTypeSchema>;

/** Common envelope wrapping every socket.io message. */
export const EnvelopeSchema = z.object({
  /** Message type discriminator. */
  type: EnvelopeTypeSchema,
  /** Correlation ID for request/response pairs (ULID). */
  requestId: z.string().optional(),
  /** Monotonic sequence number — only on canonical server-originated messages. */
  seq: z.number().int().nonnegative().optional(),
  /** Sender timestamp (epoch ms). */
  ts: z.number().int().nonnegative(),
  /** Message-specific payload. */
  payload: z.unknown(),
});

export type Envelope<T = unknown> = {
  type: EnvelopeType;
  requestId?: string;
  seq?: number;
  ts: number;
  payload: T;
};

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const ErrorCodeSchema = z.union([
  z.literal("AUTH_FAILED"),
  z.literal("PROTOCOL_MISMATCH"),
  z.literal("WORLD_FULL"),
  z.literal("PERMISSION_DENIED"),
  z.literal("VALIDATION_FAILED"),
  z.literal("NOT_FOUND"),
  z.literal("STALE_WRITE"),
  z.literal("RATE_LIMITED"),
  z.literal("TOO_LARGE"),
  z.literal("QUERY_TIMEOUT"),
  z.literal("SLOW_CONSUMER"),
  z.literal("INTERNAL_ERROR"),
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// ---------------------------------------------------------------------------
// Ack
// ---------------------------------------------------------------------------

/** Acknowledgement callback payload. */
export type Ack<R = unknown> =
  | { ok: true; seq?: number; result: R }
  | { ok: false; code: ErrorCode; message: string };

// ---------------------------------------------------------------------------
// Document operation payloads
// ---------------------------------------------------------------------------

/** Diff of a document: dot-path keys mapping to new values. */
export type DocumentDiff = Record<string, unknown>;

export const DocUpdatePayloadSchema = z.object({
  documentType: z.string(),
  updates: z.array(
    z.object({
      _id: z.string(),
      diff: z.record(z.string(), z.unknown()),
      expectedVersion: z.number().int().nonnegative().optional(),
      embedded: z
        .object({
          type: z.string(),
          id: z.string(),
        })
        .optional(),
    }),
  ),
});

export type DocUpdatePayload = z.infer<typeof DocUpdatePayloadSchema>;

export const DocCreatePayloadSchema = z.object({
  documentType: z.string(),
  data: z.array(z.unknown()),
  parent: z
    .object({
      type: z.string(),
      id: z.string(),
    })
    .optional(),
});

export type DocCreatePayload = z.infer<typeof DocCreatePayloadSchema>;

export const DocDeletePayloadSchema = z.object({
  documentType: z.string(),
  ids: z.array(z.string()),
  parent: z
    .object({
      type: z.string(),
      id: z.string(),
    })
    .optional(),
});

export type DocDeletePayload = z.infer<typeof DocDeletePayloadSchema>;

// ---------------------------------------------------------------------------
// Token movement payloads
// ---------------------------------------------------------------------------

export const TokenMovePayloadSchema = z.object({
  sceneId: z.string(),
  tokenId: z.string(),
  x: z.number(),
  y: z.number(),
  rotation: z.number().optional(),
  optimistic: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
});

export type TokenMovePayload = z.infer<typeof TokenMovePayloadSchema>;

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

/** Exchanged during the WebSocket connection setup. */
export const ProtocolHandshakeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  engineVersion: z.string(),
});

export type ProtocolHandshake = z.infer<typeof ProtocolHandshakeSchema>;
