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
  // M1-E ephemeral presence — ruler tool
  z.literal("presence:ruler"),
  z.literal("presence:ruler:clear"),
  z.literal("system"),
  // Built-in system handlers (M0-C)
  z.literal("system:ping"),
  z.literal("system:whoami"),
  z.literal("resync:request"),
  z.literal("resync:delta"),
  z.literal("resync:full"),
  // World-level broadcast events (M1-B)
  z.literal("world:snapshot"),
  z.literal("world:activeScene"),
  z.literal("ack:ok"),
  z.literal("ack:error"),
  // M1-D chat handlers
  z.literal("chat:send"),
  z.literal("chat:history"),
  // Chat log search — REQ-CHT-050 (every role, history's visibility predicate)
  z.literal("chat:search"),
  // Context around one message — REQ-CHT-051 (±N VISIBLE, per requester)
  z.literal("chat:context"),
  // Invalidate/revalidate one message — REQ-CHT-005 (nothing is ever deleted)
  z.literal("chat:invalidate"),
  // M2-A: vision — walls, lights, door state
  z.literal("wall:create"),
  z.literal("wall:update"),
  z.literal("wall:delete"),
  z.literal("light:create"),
  z.literal("light:update"),
  z.literal("light:delete"),
  z.literal("scene:doorState"),
  // M2-B: fog of war
  z.literal("fog:update"),
  z.literal("fog:get"),
  z.literal("fog:reset"),
  z.literal("fog:wasReset"),
  // M2-C: combat (spec 10 §API e Eventos)
  // client → server
  z.literal("combat:create"),
  z.literal("combat:beginCombat"),
  z.literal("combat:addCombatant"),
  z.literal("combat:removeCombatant"),
  z.literal("combat:rollInitiative"),
  z.literal("combat:setInitiative"),
  z.literal("combat:resetInitiative"),
  z.literal("combat:nextTurn"),
  z.literal("combat:previousTurn"),
  z.literal("combat:setDefeated"),
  z.literal("combat:setHidden"),
  z.literal("combat:reorder"),
  z.literal("combat:endCombat"),
  z.literal("combat:target"),
  // server → clients
  z.literal("combat:created"),
  // M3-D compendium handlers (client → server)
  z.literal("compendium:list"),
  z.literal("compendium:index"),
  z.literal("compendium:search"),
  z.literal("compendium:get"),
  z.literal("compendium:import"),
  // server → client compendium events
  z.literal("compendium:imported"),
  z.literal("combat:updated"),
  z.literal("combat:deleted"),
  z.literal("combat:turnChange"),
  z.literal("combat:initiativeSet"),
  z.literal("token:targeted"),
  // M5-C: Etmos Compositor de Magias — conjuração card lifecycle (spec 19
  // §Eventos do Compositor, design doc §2.7). client → server.
  z.literal("etmos:conjuracao:propor"),
  z.literal("etmos:conjuracao:arbitrar"),
  z.literal("etmos:conjuracao:rolar"),
  z.literal("etmos:conjuracao:resolver"),
  z.literal("etmos:conjuracao:cancelar"),
  // M5-E: Etmos Teste Contestado (spec 19 REQ-ETM-021, CA-6). client → server.
  z.literal("etmos:teste:contestado"),
  // M5-E: Etmos Reação por rodada (spec 19 REQ-ETM-023). client → server.
  z.literal("etmos:reacao:usar"),
  // M5-E: Etmos Marcos de Crescimento / Tabela E level-up (spec 19
  // REQ-ETM-035..039, CA-11). client → server.
  z.literal("etmos:progressao:confirmar"),
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
  /** M2-A: returned when a token:move is blocked by a wall. */
  z.literal("MOVE_BLOCKED"),
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// ---------------------------------------------------------------------------
// Ack
// ---------------------------------------------------------------------------

/**
 * Acknowledgement callback payload returned via socket.io callback.
 *
 * REQ-NET-011: The server MUST correlate the ack to the originating request
 * by echoing back `requestId` (the ULID sent by the client).
 * Both success and error shapes carry `requestId` so the client can match
 * pending requests even when they arrive out of order.
 */
export type Ack<R = unknown> =
  | { ok: true; requestId?: string; seq?: number; result: R }
  | { ok: false; requestId?: string; code: ErrorCode; message: string };

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
  /**
   * GM-only flag to bypass wall collision check.
   * When true and the requester is GM/ASSISTANT, movement is allowed even
   * if it would cross a blocking wall (spec 07 §REQ-VIS-091).
   */
  force: z.boolean().optional(),
});

export type TokenMovePayload = z.infer<typeof TokenMovePayloadSchema>;

// ---------------------------------------------------------------------------
// Door state payloads
// M2-A: REQ-VIS-004, REQ-VIS-007 — any user can open/close an unlocked door;
// only GM/ASSISTANT can lock/unlock or toggle secret doors.
// ---------------------------------------------------------------------------

/**
 * scene:doorState — toggle the state of a door wall inside a scene.
 *
 * Permission rules (spec 07 REQ-VIS-005, REQ-VIS-007):
 *   - "door" type, closed→open or open→closed: any authenticated user can do this,
 *     provided the door is not locked.
 *   - "door" type, lock/unlock: GM/ASSISTANT only.
 *   - "secret" type: GM/ASSISTANT only (see and operate secret doors).
 */
export const DoorStatePayloadSchema = z.object({
  /** Scene containing the wall. */
  sceneId: z.string(),
  /** Wall _id (must be a door-type wall). */
  wallId: z.string(),
  /**
   * Desired new door state.
   * "closed" | "open" | "locked"
   */
  state: z.enum(["closed", "open", "locked"]),
});

export type DoorStatePayload = z.infer<typeof DoorStatePayloadSchema>;

/**
 * Error code for blocked movement (wall collision).
 * Returned in the ack when a token:move is rejected due to wall collision.
 */
export const MOVE_BLOCKED_CODE = "MOVE_BLOCKED" as const;
export type MoveBlockedCode = typeof MOVE_BLOCKED_CODE;

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

/** Exchanged during the WebSocket connection setup. */
export const ProtocolHandshakeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  engineVersion: z.string(),
});

export type ProtocolHandshake = z.infer<typeof ProtocolHandshakeSchema>;

// ---------------------------------------------------------------------------
// World snapshot and resync payloads (REQ-NET-062..063, M1-B)
// ---------------------------------------------------------------------------

/**
 * world:snapshot — sent by the server when a client joins a world.
 *
 * Contains the full set of documents visible to the connecting user plus
 * the current canonical sequence number and the active scene ID.
 *
 * REQ-NET-024: only documents the user has at least LIMITED/OBSERVER ownership
 *              are included; the server filters before building the snapshot.
 *
 * Usage pattern:
 *   Client sends `resync:request` with `lastSeq`.
 *   Server responds with `resync:delta` (delta ops) or `resync:full` which
 *   triggers sending a `world:snapshot` payload back as the ack result.
 */
export const WorldSnapshotPayloadSchema = z.object({
  /**
   * The current canonical sequence number at the moment of the snapshot.
   * The client should store this and use it for subsequent `resync:request`.
   */
  seq: z.number().int().nonnegative(),

  /**
   * The _id of the currently active scene, or null if no scene is active.
   * Matches the scene document where `active === true`.
   */
  activeSceneId: z.string().nullable(),

  /**
   * All documents visible to this user, keyed by document type.
   * Each array contains raw (JSON-serialised) document objects.
   * Document types follow the spec 02 primary document catalogue.
   *
   * The server includes:
   *   - All scenes (ownership-filtered)
   *   - All actors visible to the user
   *   - World/user metadata
   *   - Any other collections the server deems necessary for initial render
   *
   * Clients MUST treat this as the canonical source of truth and discard
   * any local state before applying.
   */
  documents: z.record(
    z.string(), // document type name e.g. "Scene", "Actor"
    z.array(z.unknown()), // raw document objects
  ),
});

export type WorldSnapshotPayload = z.infer<typeof WorldSnapshotPayloadSchema>;

/**
 * world:resync request — sent by the client on reconnect.
 * REQ-NET-063.
 *
 * The client reports the last sequence number it successfully applied.
 * The server checks whether that seq is still in the circular op buffer
 * (REQ-NET-062, N=1000) and either:
 *   - responds with `resync:delta` (the missing ops in seq order), OR
 *   - responds with `resync:full` + a fresh WorldSnapshotPayload.
 */
export const WorldResyncRequestPayloadSchema = z.object({
  /** Last canonical seq the client has already applied. */
  lastSeq: z.number().int().nonnegative(),
});

export type WorldResyncRequestPayload = z.infer<typeof WorldResyncRequestPayloadSchema>;

/**
 * resync:delta response — delta ops since lastSeq.
 * REQ-NET-063: server sends ops in seq order when lastSeq is in the buffer.
 */
export const ResyncDeltaPayloadSchema = z.object({
  /** First seq in this delta (= lastSeq + 1). */
  fromSeq: z.number().int().nonnegative(),

  /** Last seq included in this delta (= current server seq). */
  toSeq: z.number().int().nonnegative(),

  /**
   * Canonical op envelopes in seq order.
   * Each element is a fully formed Envelope (with seq set).
   * The client applies them in order to catch up.
   */
  ops: z.array(EnvelopeSchema),
});

export type ResyncDeltaPayload = z.infer<typeof ResyncDeltaPayloadSchema>;

/**
 * resync:full response — indicates the client must do a full snapshot reload.
 * REQ-NET-063: sent when lastSeq is outside the circular op buffer.
 *
 * After receiving this, the client discards all local state and requests
 * (or receives as part of the join flow) a fresh world:snapshot.
 */
export const ResyncFullPayloadSchema = z.object({
  /**
   * Human-readable reason for the full resync.
   * Used for diagnostics and UI messaging only.
   */
  reason: z.string().optional(),

  /**
   * Inline snapshot.
   * When provided, the client can apply this immediately without an extra
   * round-trip; when null the client should re-emit the join handshake.
   */
  snapshot: WorldSnapshotPayloadSchema.nullable(),
});

export type ResyncFullPayload = z.infer<typeof ResyncFullPayloadSchema>;

/**
 * world:activeScene — broadcast when the GM activates a different scene.
 * REQ-NET-005 (rooms), spec 06 §scene activation.
 *
 * All connected clients receive this event and switch their canvas
 * to the new active scene.
 */
export const WorldActiveScenePayloadSchema = z.object({
  /**
   * The _id of the newly activated scene, or null if all scenes were
   * deactivated (unusual but valid state).
   */
  sceneId: z.string().nullable(),
});

export type WorldActiveScenePayload = z.infer<typeof WorldActiveScenePayloadSchema>;

// ---------------------------------------------------------------------------
// Note: EmbeddedAddress (EmbeddedAddressSchema) was defined here but never
// wired into DocCreatePayload, DocUpdatePayload, or DocDeletePayload — those
// payloads use inline { type, id } / { type, id } objects with different field
// names (type/id vs parentType/parentId). Removed in M1-B audit (FIX-6) to
// keep the public surface minimal. If an explicit EmbeddedAddress type is
// needed in M1-C, re-introduce it aligned with the actual payload schemas.
// ---------------------------------------------------------------------------
