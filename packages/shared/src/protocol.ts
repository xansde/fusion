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
  // Spec 15 REQ-SYS-043 / spec 39 DEC-CTT-11: the display contract of every
  // condition the active system registered. The UI knows no condition — it
  // paints what the system declared — and the client cannot import a game
  // system package, so the dictionary travels over the wire.
  z.literal("system:conditions"),
  // Spec 15 REQ-SYS-009 / spec 41-token.md TK041/DEC-TOK-03: the active
  // system's size→footprint table. A token's occupied cells are derived from
  // its effective actor's size category (REQ-TOK-012/017), never a field on
  // the token, and the client cannot import a game system — same "the
  // declaration travels over the wire" reasoning as system:conditions above.
  z.literal("system:footprint"),
  // Spec 37 §5.4 (REQ-CFG-030/031, RNF-CFG-02): the Configurações tab's Mundo
  // section renders purely from what the active system declared with escopo
  // `world` — same "the client cannot import a game system" reasoning as
  // system:conditions above, for settings instead of conditions.
  z.literal("settings:declarations"),
  // Spec 37 REQ-CFG-082: "how many actors would this disable affect" — asked
  // only when the Mundo section is about to turn a `requiresConfirmOnDisable`
  // setting off (Q-CFG-03).
  z.literal("settings:impact"),
  // Spec 37 §5.5 (REQ-USR-008/009, REQ-CFG-040..042): the Permissões
  // section's rows — one per configurable Permission, GM override or default.
  z.literal("settings:permissions"),
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
  // Spec 15 REQ-SYS-138..142 / spec 09 REQ-CHT-052/053 (plan do Alquimista,
  // ALQ-F1-01/02, DEC-SYS-12): apply damage/condition to an actor is a CORE
  // op (ActorMechanicsService) — the system only supplies the pure rule via
  // registrar.registerActorMechanics. NOT a chat op even though its usual
  // trigger is a damage-roll card's buttons (REQ-CHT-052).
  z.literal("actor:applyDamage"),
  z.literal("actor:applyCondition"),
  // Spec 15 REQ-SYS-143/144 / spec 17 REQ-PF2-224..228 (plan do Alquimista,
  // ALQ-F2-11, DEC-SYS-12's emenda de consumo — ALQ-F2-01): consuming an item
  // (charge/quantity, resource, or the strike a consumable derives) is a CORE
  // op with the SAME split as actor:applyDamage — permission, atomicity and
  // expectedVersion live here; the game-specific plan (what to spend, what
  // effect to copy, what to roll) is `registrar.registerConsumeItem`.
  z.literal("item:consume"),
  // Spec 39 — contact knowledge (general rule + per-character exceptions).
  // The one way in: doc:update refuses the flag path outright, so knowledge
  // never rides an ordinary document write (REQ-CTT-070/072/080).
  z.literal("actor:setKnowledge"),
  // Spec 42 — removing a folder without removing anything it held (REQ-NPC-022).
  // Not doc:delete: that path drops the row and stops, leaving every actor of the
  // folder pointing at an id that is gone and every subfolder orphaned.
  z.literal("folder:delete"),
  // Spec 42 — read-only: what a delete would take with the actor (REQ-NPC-051),
  // and whether an unfinished encounter refuses it outright (REQ-NPC-052).
  z.literal("actor:deletePreview"),
  // M2-A: vision — walls, lights, door state
  z.literal("wall:create"),
  z.literal("wall:update"),
  z.literal("wall:delete"),
  z.literal("light:create"),
  z.literal("light:update"),
  z.literal("light:delete"),
  z.literal("scene:doorState"),
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
  // One search over every pack the CALLER can see — REQ-CPD-030, REQ-CMP-013a
  z.literal("compendium:searchAll"),
  z.literal("compendium:get"),
  z.literal("compendium:import"),
  // Bring pack document(s) into ONE actor's sheet — the destination's OWNER is
  // the predicate, not the caller's role (DEC-CPD-05, REQ-CPD-061/073).
  z.literal("compendium:importToActor"),
  // server → client compendium events
  z.literal("compendium:imported"),
  z.literal("combat:updated"),
  z.literal("combat:deleted"),
  z.literal("combat:turnChange"),
  z.literal("combat:initiativeSet"),
  z.literal("token:targeted"),
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
  /**
   * Spec 15 REQ-SYS-142 / spec 41 alquimista (ALQ-F1-01/02): a target/ownership
   * assertion failed for `actor:applyDamage`/`actor:applyCondition` — e.g. a
   * non-privileged caller referenced a `source.messageId` they do not OWNER-own,
   * a payload with no snapshot to fall back to, or `assertTargetsSelected`
   * (plan §2.3) finding a requested tokenId outside the caller's live selection.
   * Deliberately distinct from `PERMISSION_DENIED` (coarser role gate used
   * elsewhere): FORBIDDEN is always about "you don't own/target this specific
   * thing", never about lacking a role outright.
   */
  z.literal("FORBIDDEN"),
  /**
   * Spec 15 REQ-SYS-142 step 6: `actor:applyDamage`/`actor:applyCondition`
   * reached the ActorMechanicsService but no system registered
   * `registerActorMechanics` — the op is a no-op, nothing is written.
   */
  z.literal("NOT_SUPPORTED"),
  /**
   * Spec 15 REQ-SYS-143 step 3 (plan do Alquimista, ALQ-F2-11): `item:consume`
   * refuses, writing nothing, when `expectedVersion` does not match the
   * actor's current `_stats.version` — two clients racing to spend the same
   * last charge/quantity. Deliberately a DIFFERENT literal from the generic
   * doc:update path's `STALE_WRITE` (same underlying version-mismatch idea,
   * different op family, per REQ-SYS-143's own wording): `item:consume`
   * calls `store.transaction()` around the read-check-write so this code is
   * a genuine "someone else won the race" answer, not a stale client cache.
   */
  z.literal("CONFLICT"),
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
});

export type TokenMovePayload = z.infer<typeof TokenMovePayloadSchema>;

// `token:preview` (REQ-NET-044) is an EPHEMERAL event (the `ephemeral` socket
// channel, not `op`) — its payload schema lives with the rest of the
// ephemeral payloads in `packages/server/src/net/ephemeral-handlers.ts`
// (`TokenPreviewPayloadSchema`), matching where `CursorMovePayloadSchema` /
// `MapPingPayloadSchema` / `RulerUpdatePayloadSchema` already live. Only the
// `EnvelopeTypeSchema` literal above is shared — every other ephemeral
// payload schema is intentionally NOT duplicated into this `op`-channel file.

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

// ---------------------------------------------------------------------------
// ApplyDamage / ApplyCondition — REQ-SYS-138..142 (spec 15), REQ-CHT-052/053
// (spec 09), plan do Alquimista §2.1/§2.4 (ALQ-F1-01/02, DEC-SYS-12).
//
// `actor:applyDamage` and `actor:applyCondition` are CORE ops
// (ActorMechanicsService, packages/server) — validated/authorized here, the
// game-specific rule (IWR, dying, condition immunity…) is a pure function a
// system registers via `registrar.registerActorMechanics`
// (packages/system-api/src/actor-mechanics.ts). This file carries only the
// wire contract: what a client may send and what the server broadcasts back.
// The op HANDLER itself (ActorMechanicsService) is server behavior for
// ALQ-F1-05/F1-08 — out of scope here.
// ---------------------------------------------------------------------------

/**
 * Generic degree-of-success label (e.g. PF2e's four-degree remaster set).
 * Deliberately a plain string, never a fixed enum — the engine does not
 * hardcode a game system's rules (DEC-SYS-12; mirrors
 * `RollResultData.degreeOfSuccess` in `chat/types.ts` and
 * `DegreeOfSuccessResult.degree` in `@fusion/system-api`'s registries.ts,
 * both `string` for the exact same reason).
 */
export type DegreeOfSuccess = string;

/**
 * A single damage/healing component of an `actor:applyDamage` instance.
 *
 * With `source` present, the server REREADS `type`/`category`/`critical`/
 * `nonlethal`/`traits`/`materials`/`amount` from the roll gravada
 * (`08-motor-de-rolagens.md` RollResult) for any non-privileged caller and
 * IGNORES whatever the client sent for those fields (REQ-SYS-142 step 2b) —
 * this schema stays PERMISSIVE (accepts them alongside `source`) on purpose:
 * rejecting them here would reject exactly the shape a well-behaved
 * privileged client (GM / `actingAs:"system"`) is allowed to send outright,
 * and a non-privileged client sending them is a server-side "ignore", never a
 * schema-level "reject" (REQ-SYS-142 is explicit that the response for that
 * case is to silently reread, not to refuse the envelope). Permission-gated
 * fields (`amount` without `source`, `traits`/`materials`/`critical`/
 * `nonlethal` without `source`) are enforced by ActorMechanicsService, not by
 * this schema — it has no caller role to check against.
 */
export const DamageInstanceInputSchema = z
  .object({
    /** Damage type slug ("fire", "piercing"…) or "healing" / "temp-hp". */
    type: z.string().min(1).max(60),
    category: z.enum(["persistent", "splash", "precision"]).optional(),
    /** Only honoured from a privileged caller or `actingAs:"system"` without `source`. */
    amount: z.number().optional(),
    /** The server rereads the total (and, non-privileged, the rest of this shape) from here. */
    source: z
      .object({
        messageId: z.string().min(1),
        rollIndex: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    /** IWR exceptions (e.g. "magical", "silver"). */
    traits: z.array(z.string().min(1)).optional(),
    /** cold-iron, silver… (F5-09). */
    materials: z.array(z.string().min(1)).optional(),
    critical: z.boolean().optional(),
    nonlethal: z.boolean().optional(),
  })
  .strict()
  .refine((instance) => instance.source !== undefined || instance.amount !== undefined, {
    message: "DamageInstanceInput requires either `source` or `amount`",
  });

export type DamageInstanceInput = z.infer<typeof DamageInstanceInputSchema>;

/**
 * `actor:applyDamage` — client → server. REQ-SYS-142, REQ-CHT-052.
 *
 * `targetTokenIds`/`hardness`/`ignoreResistance` are GM-only overrides (or
 * `actingAs:"system"`); a non-privileged caller applies to every token in the
 * originating roll's `flags.fusion.targetSnapshot` instead — enforced by
 * ActorMechanicsService (permission context isn't available to this schema).
 * `multiplier` and `basicSave` ARE mutually exclusive at the schema level
 * (REQ-SYS-142 step 1: "basicSave e multiplier juntos DEVEM ser rejeitados").
 */
export const ActorApplyDamagePayloadSchema = z
  .object({
    /** Same type in the same payload sums before IWR. */
    instances: z.array(DamageInstanceInputSchema).min(1),
    targetTokenIds: z.array(z.string().min(1)).optional(),
    selfActorId: z.string().min(1).optional(),
    multiplier: z.union([z.literal(0), z.literal(0.5), z.literal(1), z.literal(2)]).optional(),
    basicSave: z
      .object({ degree: z.string().min(1) })
      .strict()
      .optional(),
    hardness: z.number().optional(),
    /** Exploitive Bomb-style overrides. */
    ignoreResistance: z
      .array(z.object({ type: z.string().min(1), value: z.number() }).strict())
      .optional(),
  })
  .strict()
  .refine((payload) => !(payload.multiplier !== undefined && payload.basicSave !== undefined), {
    message: "multiplier and basicSave are mutually exclusive",
  });

export type ActorApplyDamagePayload = z.infer<typeof ActorApplyDamagePayloadSchema>;

// ---------------------------------------------------------------------------
// FusionExpiry — plan §2.5 (owner: ALQ-F2-01/EffectItem). Minimal forward
// declaration: ActorApplyConditionPayload (this task, §2.4) references it for
// `expiry`, and §2.5 already fixes the exact shape (not "contrato ausente" —
// just owned by a later task). If F2-01 wants it elsewhere, move it; keep
// this one in sync or re-export to avoid a duplicate/divergent definition.
// ---------------------------------------------------------------------------

export const ExpiryOnSchema = z.enum([
  "turn-start",
  "turn-end",
  "round-end",
  "combat-end",
  "daily-prep",
  "never",
]);

export type ExpiryOn = z.infer<typeof ExpiryOnSchema>;

export const FusionExpirySchema = z
  .object({
    on: ExpiryOnSchema,
    ownerActorId: z.string().min(1),
    remainingRounds: z.number().int().nonnegative().optional(),
  })
  .strict();

export type FusionExpiry = z.infer<typeof FusionExpirySchema>;

/**
 * How long a condition applied via `actor:applyCondition` is declared to
 * last (I5 fix, onda 4 revisão adversarial). Same six units as
 * `EffectItemSystem.duration` (plan §2.5) — deliberately only `value`/`unit`
 * (no `sustained`/inner `expiry`, which are EffectItem-specific concerns):
 * `engine-2e`'s `resolveExpirations` (`ExpiryDuration`) only ever reads
 * those two fields to convert a duration to a round count.
 *
 * Declarative "what the rule says" (like `expiry` itself, already
 * client-declarable above) — never the anchor for "what round is it right
 * now"; that is `ApplyConditionOptions.now` (`@fusion/system-api`,
 * server-resolved only, same discipline as `ApplyDamageOptions.actingAs`).
 */
export const ConditionDurationSchema = z
  .object({
    value: z.number().int(),
    unit: z.enum(["round", "minute", "hour", "day", "encounter", "unlimited"]),
  })
  .strict();

export type ConditionDuration = z.infer<typeof ConditionDurationSchema>;

/**
 * `actor:applyCondition` — client → server. REQ-SYS-142, spec 09 (chat
 * protocol table), plan §2.4.
 *
 * GM on any actor; player on their own actor or on their live target
 * selection (REQ-CBT-056) — enforced server-side, not by this schema.
 */
export const ActorApplyConditionPayloadSchema = z
  .object({
    targetTokenIds: z.array(z.string().min(1)),
    selfActorId: z.string().min(1).optional(),
    /** A condition slug the active system registered (+ "dead" for PF2e). */
    slug: z.string().min(1),
    mode: z.enum(["add", "remove", "set", "increase", "decrease"]),
    value: z.number().nullable().optional(),
    /** e.g. `{ instance: PersistentDamageInstance }` — opaque to the core. */
    data: z.record(z.string(), z.unknown()).optional(),
    expiry: FusionExpirySchema.optional(),
    /**
     * I5 fix: how long this condition lasts (e.g. Debilitating Bomb's
     * `clumsy 1` for 1 minute). Without this, `expiry` alone can't tell
     * `resolveExpirations` how many rounds to count — it fell back to
     * "expire on the very first matching turn boundary" (a 10-round
     * condition lasting 1). Meaningful only together with `expiry`.
     */
    duration: ConditionDurationSchema.optional(),
    source: z
      .object({
        messageId: z.string().min(1).optional(),
        itemUuid: z.string().min(1).optional(),
        effectItemId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ActorApplyConditionPayload = z.infer<typeof ActorApplyConditionPayloadSchema>;

// ---------------------------------------------------------------------------
// actor:damageApplied — NOT a socket envelope type. Per spec 09's own
// protocol table, the summary is delivered as a `ChatMessage` (document:create)
// whose card carries this shape — mirroring how `AbilityCardSchema` rides
// `flags.pf2e.abilityCard` (packages/shared/src/chat/types.ts): this one is
// core-level (DF-02: ApplyDamage is a core op), so it travels under
// `flags.fusion.damageApplied`, the same "fusion" namespace as
// `flags.fusion.targetSnapshot`/`rollContext`/`rollNotes` used throughout the
// plan. Wiring this into ChatMessageSchema/ChatSendFlagsSchema is server
// behavior (ALQ-F1-05/F1-08) — out of this task's scope; this only fixes the
// payload SHAPE those flags will carry (REQ-CHT-053).
// ---------------------------------------------------------------------------

export const DamageAppliedTypeBreakdownSchema = z
  .object({
    type: z.string().min(1),
    amount: z.number(),
    /** Present when a resistance/weakness of this type applied. */
    resistanceApplied: z.number().optional(),
  })
  .strict();

export type DamageAppliedTypeBreakdown = z.infer<typeof DamageAppliedTypeBreakdownSchema>;

/**
 * One target's line in the `actor:damageApplied` summary (REQ-CHT-053: "uma
 * linha por alvo"). `hpBefore`/`hpAfter`/`tempHpAfter`/`deathCondition` are
 * PRIVILEGED-only — present for GM/owner, stripped by
 * `packages/server/src/net/redaction.ts` before broadcast to a non-privileged
 * viewer, who sees only `byType`/`total` (D-04, REQ-CHT-053). Optional here so
 * a redacted payload still parses.
 */
export const DamageAppliedTargetSchema = z
  .object({
    tokenId: z.string().min(1),
    actorId: z.string().min(1),
    name: z.string().min(1),
    byType: z.array(DamageAppliedTypeBreakdownSchema),
    total: z.number(),
    hpBefore: z.number().optional(),
    hpAfter: z.number().optional(),
    tempHpAfter: z.number().optional(),
    /** null clears a previously-shown death condition. Privileged-only, like the HP fields above. */
    deathCondition: z.enum(["dead", "dying", "unconscious"]).nullable().optional(),
  })
  .strict();

export type DamageAppliedTarget = z.infer<typeof DamageAppliedTargetSchema>;

export const ActorDamageAppliedPayloadSchema = z
  .object({
    sourceMessageId: z.string().min(1),
    targets: z.array(DamageAppliedTargetSchema).min(1),
  })
  .strict();

export type ActorDamageAppliedPayload = z.infer<typeof ActorDamageAppliedPayloadSchema>;

// ---------------------------------------------------------------------------
// Acks — TurnHookContext.applyDamage/applyCondition (system-api combat.ts)
// resolve these. REQ-SYS-142: "o ack devolvido a usuário sem papel
// privilegiado DEVE seguir a mesma redação do resumo" — ApplyDamageAck reuses
// the same shape as the broadcast card for exactly that reason. Neither shape
// is spelled out verbatim in plan §2.1 or spec 15 (both are illustrative,
// "não-normativas em detalhes de campo" per spec 15's own disclaimer) — this
// is this task's minimal, documented choice; ALQ-F1-05/F1-08 (the server op)
// may refine it.
// ---------------------------------------------------------------------------

export type ApplyDamageAck = Ack<ActorDamageAppliedPayload>;

export const ActorConditionAppliedResultSchema = z
  .object({
    actorId: z.string().min(1),
    slug: z.string().min(1),
    mode: z.enum(["add", "remove", "set", "increase", "decrease"]),
    value: z.number().nullable().optional(),
  })
  .strict();

export type ActorConditionAppliedResult = z.infer<typeof ActorConditionAppliedResultSchema>;

export type ApplyConditionAck = Ack<{ targets: ActorConditionAppliedResult[] }>;

// ---------------------------------------------------------------------------
// item:consume — client → server. Spec 15 REQ-SYS-143/144, spec 17
// REQ-PF2-224..228, plan §2.6, task ALQ-F2-11.
//
// Shapes fixed verbatim from spec 15's own `ItemConsumePayload`/
// `ItemConsumeResult` code block (not "illustrative" like ApplyDamage's own
// disclaimer elsewhere in this file — ALQ-F2-01 pinned this one exactly,
// this task only adds the Zod validation).
// ---------------------------------------------------------------------------

export const ItemConsumeModeSchema = z.enum(["use", "strike", "resource"]);
export type ItemConsumeMode = z.infer<typeof ItemConsumeModeSchema>;

export const ItemConsumePayloadSchema = z
  .object({
    actorId: z.string().min(1),
    /** Required in "use" and "strike"; absent in "resource". */
    itemId: z.string().min(1).optional(),
    /** Required in "resource"; absent in "use"/"strike". */
    resourceSlug: z.string().min(1).optional(),
    mode: ItemConsumeModeSchema,
    /** Only meaningful in "strike" — which attack of a multi-attack action. */
    mapIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    /** Checked against the actor's `_stats.version` — REQ-SYS-143 step 3. */
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict()
  .refine((p) => p.mode === "resource" || p.itemId !== undefined, {
    message: 'itemId is required when mode is "use" or "strike"',
  })
  .refine((p) => p.mode !== "resource" || p.resourceSlug !== undefined, {
    message: 'resourceSlug is required when mode is "resource"',
  });

export type ItemConsumePayload = z.infer<typeof ItemConsumePayloadSchema>;

/**
 * `item:consume`'s result — REQ-SYS-143 step 5. Plain type (not a wire
 * envelope schema of its own): unlike `ActorDamageAppliedPayload`, this shape
 * never rides a second channel (no chat-message flags need to parse it back)
 * — it only ever travels once, as the socket Ack's `result`.
 */
export interface ItemConsumeResult {
  readonly consumed:
    | { readonly itemId?: string; readonly quantityLeft: number; readonly destroyed: boolean }
    | { readonly resourceSlug: string; readonly valueLeft: number };
  readonly appliedEffectIds: string[];
  readonly chatMessageIds: string[];
}

export type ItemConsumeAck = Ack<ItemConsumeResult>;

// ---------------------------------------------------------------------------
// Target-selection assertion — REQ-CBT-056, plan §2.3. TYPE ONLY: the plan
// places the implementation at packages/server/src/combat/target-selection.ts
// (server behavior — out of ALQ-F1-02's scope, which delivers types/schemas).
// Not present in specs/15-api-de-sistemas.md's own contract block — registered
// as an open divergence (see this task's report): the plan §2.3 is the only
// normative source for this exact signature today.
// ---------------------------------------------------------------------------

/**
 * Pure assertion ActorMechanicsService (REQ-SYS-142 step 3) uses before
 * resolving `actor:applyCondition` targets from a non-privileged caller's LIVE
 * target selection: every requested `tokenId` must be part of that user's
 * current selection (REQ-CBT-056), or the op is FORBIDDEN.
 */
export type AssertTargetsSelectedFn = (
  userId: string,
  role: string,
  tokenIds: readonly string[],
) => { ok: true } | { ok: false; code: "FORBIDDEN"; missing: string[] };
