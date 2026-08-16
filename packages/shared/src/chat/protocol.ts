/**
 * Chat protocol types — socket.io events for chat subsystem.
 *
 * REQ-CHT-003: chat:send → server validates, persists, broadcasts via doc:create.
 * Spec 09 §API: chat:send, chat:history, chat:message broadcast.
 * Spec 04: visibility per recipient in broadcast.
 */

import { z } from "zod";
import { RollModeSchema, ChatSendFlagsSchema } from "./types.js";

// ---------------------------------------------------------------------------
// chat:send — client → server
// ---------------------------------------------------------------------------

/**
 * Reference to the target of an attack roll — REQ-ACH-070 / REQ-ACH-072.
 *
 * The client points at a token (or, failing that, at an actor); it NEVER sends
 * the name or the AC. The server resolves both itself and writes the portrait,
 * because an AC that arrives from the wire is an AC the sender chose: a client
 * could grade its own attack a critical hit by declaring the defender's AC as 1.
 *
 * A reference that resolves to nothing is DROPPED, exactly like a dangling
 * `parentMessageId`: the roll is still delivered, as a roll with no target and
 * therefore no degree of success (REQ-ACH-071).
 */
export const ChatTargetRefSchema = z
  .object({
    /** `_id` of the token being attacked (preferred — carries the display name). */
    tokenId: z.string().min(1).max(120).optional(),
    /** `_id` of the actor being attacked, when no token stands for it. */
    actorId: z.string().min(1).max(120).optional(),
  })
  .refine((ref) => ref.tokenId !== undefined || ref.actorId !== undefined, {
    message: "target requires tokenId or actorId",
  });

export type ChatTargetRef = z.infer<typeof ChatTargetRefSchema>;

/**
 * Payload the client sends when the user submits the chat input.
 *
 * The server is authoritative for:
 * - speaker resolution (REQ-CHT-022)
 * - inline roll evaluation (REQ-CHT-019, D-CHT-08)
 * - command dispatch (/roll, /w, etc.) (REQ-CHT-013)
 * - content sanitization (D-CHT-05)
 * - roll execution (RNG on server, REQ-ROL-025)
 *
 * The client sends the raw input; the server returns the canonical ChatMessage.
 */
export const ChatSendPayloadSchema = z.object({
  /**
   * Raw text from the chat input box, may include command prefixes and
   * inline roll expressions.
   */
  content: z.string().min(1).max(4096),

  /**
   * World this message belongs to.
   * Validated server-side against the user's active world session.
   */
  worldId: z.string(),

  /**
   * Roll mode override for roll commands.
   * If omitted, the server uses the command prefix (/roll = public, /gmroll = gmroll, etc.)
   * or the user's configured default roll mode.
   */
  rollMode: RollModeSchema.optional(),

  /**
   * Actor ID the player is using as speaker.
   * Server verifies ownership before accepting.
   * If omitted, server resolves from token → actor → user (REQ-CHT-022).
   */
  speakerActorId: z.string().optional(),

  /**
   * Token ID the player is using as speaker.
   * Server verifies ownership before accepting.
   */
  speakerTokenId: z.string().optional(),

  /**
   * Optional target of an attack roll (REQ-ACH-070). A REFERENCE only — the
   * server resolves the name and the AC and writes the portrait itself
   * (REQ-ACH-072); the AC is never accepted from the client.
   *
   * The selection mechanic does not exist yet (DEC-ACH-09), so nothing in the UI
   * fills this today: the field is the socket contract the future selection
   * plugs into.
   */
  target: ChatTargetRefSchema.optional(),

  /**
   * Optional namespaced flags to attach to the resulting ChatMessage (r17-P2).
   * The ONLY whitelisted flag is `pf2e.spellCast` (interactive spell-cast
   * card) — the server validates the shape with Zod and reads only that path,
   * so a forged/foreign flag never reaches the stored document. The DC inside
   * spellCast is coherence-checked server-side (never trusted blindly).
   */
  flags: ChatSendFlagsSchema.optional(),
});

export type ChatSendPayload = z.infer<typeof ChatSendPayloadSchema>;

// ---------------------------------------------------------------------------
// chat:history — client → server (REST-style via socket ack)
// ---------------------------------------------------------------------------

/**
 * Paginated history request.
 * D-CHT-06: cursor-based pagination, not offset.
 * REQ-CHT-033..034.
 */
export const ChatHistoryRequestSchema = z.object({
  worldId: z.string(),
  /**
   * Cursor: the _id of the oldest message the client has already loaded.
   * Omit to fetch the most recent N messages.
   */
  before: z.string().optional(),
  /** Page size (default 50, max 100). */
  limit: z.number().int().min(1).max(100).default(50),
});

export type ChatHistoryRequest = z.infer<typeof ChatHistoryRequestSchema>;

/**
 * Response payload for chat:history.
 * Contains up to `limit` messages older than `before`, ordered newest-first.
 */
export const ChatHistoryResponseSchema = z.object({
  messages: z.array(z.unknown()), // ChatMessage[] — avoid circular dep on full schema
  /**
   * Cursor for the next page.
   * The _id of the oldest message in this response.
   * Null when no older messages exist.
   */
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;

// ---------------------------------------------------------------------------
// chat:search — client → server (REST-style via socket ack)
// ---------------------------------------------------------------------------

/** Hard ceiling for a single search page — REQ-CHT-036 ("no máximo 50"). */
export const CHAT_SEARCH_MAX_LIMIT = 50;

/** Longest search term the server accepts (guards the LIKE scan). */
export const CHAT_SEARCH_MAX_TERM_LENGTH = 200;

/**
 * Free-text search over the chat log.
 *
 * REQ-CHT-036 (search runs on the server), REQ-CHT-050 / REQ-ACH-012 (available
 * to EVERY role; the server filters the results with the very same visibility
 * predicate the history uses — there is no second rule for search).
 *
 * Pagination is page-based over the results VISIBLE to the requester, never
 * over the raw rows: an invisible row must not consume a slot, otherwise the
 * page size itself would leak that a private conversation happened.
 */
export const ChatSearchRequestSchema = z.object({
  worldId: z.string(),
  /** Free text matched against the message content, case-insensitive. */
  q: z.string().min(1).max(CHAT_SEARCH_MAX_TERM_LENGTH),
  /** Page size (default 50, max 50). */
  limit: z.number().int().min(1).max(CHAT_SEARCH_MAX_LIMIT).default(CHAT_SEARCH_MAX_LIMIT),
  /** 0-based page index over the VISIBLE results. */
  page: z.number().int().min(0).max(999).default(0),
});

export type ChatSearchRequest = z.infer<typeof ChatSearchRequestSchema>;

/**
 * Response payload for chat:search — newest first, already redacted for the
 * requester (same shape as chat:history, so the client renders it with the
 * same components: author, timestamp and content are all on the message).
 */
export const ChatSearchResponseSchema = z.object({
  messages: z.array(z.unknown()), // ChatMessage[] — avoid circular dep on full schema
  /** Echo of the page that was served. */
  page: z.number().int(),
  /** True when at least one more visible result exists after this page. */
  hasMore: z.boolean(),
});

export type ChatSearchResponse = z.infer<typeof ChatSearchResponseSchema>;

// ---------------------------------------------------------------------------
// chat:context — client → server (REST-style via socket ack)
// ---------------------------------------------------------------------------

/** Default window on each side of the target message — REQ-ACH-013 ("5"). */
export const CHAT_CONTEXT_DEFAULT_LIMIT = 5;

/** Hard ceiling for one side of the context window — spec 09 §API ("máx 50"). */
export const CHAT_CONTEXT_MAX_LIMIT = 50;

/**
 * Context around one message — REQ-CHT-051.
 *
 * Given the `_id` of a message the requester can see and a limit `N`, the server
 * answers with the `N` VISIBLE messages immediately before and the `N`
 * immediately after. The count considers only what that requester may see: an
 * invisible message takes no slot and is never signalled — counting it (or
 * marking the gap) would let the requester deduce that a private conversation
 * happened right there.
 *
 * The "more 5" control of REQ-ACH-013 is served by re-asking with a larger
 * `limit`, so the window stays a single stateless query.
 */
export const ChatContextRequestSchema = z.object({
  worldId: z.string(),
  /** `_id` of the message the window is centred on. Must be visible to the caller. */
  id: z.string().min(1),
  /** How many VISIBLE messages to return on each side (default 5, max 50). */
  limit: z.number().int().min(1).max(CHAT_CONTEXT_MAX_LIMIT).default(CHAT_CONTEXT_DEFAULT_LIMIT),
});

export type ChatContextRequest = z.infer<typeof ChatContextRequestSchema>;

/**
 * Response payload for chat:context — every message already redacted for the
 * requester, in the same shape as chat:history/chat:search so the client renders
 * them with the same components.
 *
 * `before` and `after` are chronological (oldest first), so the window reads as
 * `[...before, target, ...after]`. The `hasMore*` flags only ever report whether
 * one more VISIBLE message exists on that side — they never count what the
 * requester cannot see.
 */
export const ChatContextResponseSchema = z.object({
  /** The message the window is centred on (ChatMessage). */
  target: z.unknown(),
  /** Up to `limit` visible messages older than the target, oldest first. */
  before: z.array(z.unknown()),
  /** Up to `limit` visible messages newer than the target, oldest first. */
  after: z.array(z.unknown()),
  hasMoreBefore: z.boolean(),
  hasMoreAfter: z.boolean(),
});

export type ChatContextResponse = z.infer<typeof ChatContextResponseSchema>;

// ---------------------------------------------------------------------------
// chat:invalidate — client → server (REQ-CHT-005 / REQ-ACH-080..086)
// ---------------------------------------------------------------------------

/**
 * Invalidate (or revalidate) one message — REQ-CHT-005, detailed by
 * REQ-ACH-080..086.
 *
 * NOTHING is deleted: the message stays in the log, at the same position, and
 * only gains the record of who voided it and when. Who may act:
 *   - invalidate (`invalid: true`)  — the GAMEMASTER, or the AUTHOR of the
 *     message; anyone else is refused by the server (REQ-ACH-082);
 *   - revalidate (`invalid: false`) — the GAMEMASTER always; the author ONLY
 *     when the standing invalidation is his own (REQ-ACH-083), so a GM's
 *     invalidation is the last word.
 *
 * The operation is an annotation on the log and undoes NOTHING outside it
 * (REQ-ACH-085): applied damage, rolled initiative and created effects stay
 * exactly as they are, and no automatic operation is triggered.
 */
export const ChatInvalidateRequestSchema = z.object({
  worldId: z.string(),
  /** `_id` of the message to void/restore. Must be visible to the caller. */
  _id: z.string().min(1),
  /** `true` invalidates, `false` revalidates. */
  invalid: z.boolean(),
});

export type ChatInvalidateRequest = z.infer<typeof ChatInvalidateRequestSchema>;

/**
 * Response payload for chat:invalidate — the message as it now stands, already
 * redacted for the caller (same shape as chat:history/search/context).
 */
export const ChatInvalidateResponseSchema = z.object({
  /** The updated message (ChatMessage). */
  message: z.unknown(),
});

export type ChatInvalidateResponse = z.infer<typeof ChatInvalidateResponseSchema>;

// ---------------------------------------------------------------------------
// chat:message — server → client broadcast
// ---------------------------------------------------------------------------

/**
 * Event type literal for chat broadcast messages.
 * The server emits a doc:create envelope with documentType "ChatMessage".
 * For visibility-filtered broadcasts:
 * - whisper: sent only to whisper[] user sockets + author
 * - blind=true: rolls[] stripped from non-GM recipients
 *
 * REQ-CHT-004 / REQ-ROL-031.
 */
export const CHAT_BROADCAST_EVENT = "doc:create" as const;
export const CHAT_DOCUMENT_TYPE = "ChatMessage" as const;

/**
 * Event type literal for a chat message that CHANGED after being sent —
 * invalidation/revalidation travels on it (REQ-ACH-086). Same per-socket
 * visibility as the creation broadcast: whoever could not see the message never
 * learns it was voided.
 */
export const CHAT_UPDATE_BROADCAST_EVENT = "doc:update" as const;

// ---------------------------------------------------------------------------
// chat:card-action — client → server
// ---------------------------------------------------------------------------

export const ChatCardActionPayloadSchema = z.object({
  messageId: z.string(),
  buttonId: z.string(),
  actorId: z.string().optional(),
  targetIds: z.array(z.string()).optional(),
});

export type ChatCardActionPayload = z.infer<typeof ChatCardActionPayloadSchema>;

// ---------------------------------------------------------------------------
// Error codes specific to chat
// ---------------------------------------------------------------------------

export const CHAT_ERROR_CODES = {
  CONTENT_TOO_LONG: "CHT_CONTENT_TOO_LONG",
  RATE_LIMIT: "CHT_RATE_LIMIT",
  INVALID_COMMAND: "CHT_INVALID_COMMAND",
  INVALID_FORMULA: "CHT_INVALID_FORMULA",
  INVALID_CARD: "CHT_INVALID_CARD",
  WHISPER_TARGET_NOT_FOUND: "CHT_WHISPER_TARGET_NOT_FOUND",
  /**
   * Returned by chat:context when the requested `_id` does not resolve to a
   * message the caller may read. Deliberately the SAME answer for "no such
   * message" and "a message you cannot see" (REQ-CHT-051): a distinguishable
   * refusal would itself reveal that a private message sits at that id.
   */
  MESSAGE_NOT_FOUND: "CHT_MESSAGE_NOT_FOUND",
  /**
   * Returned by chat:invalidate when the caller may see the message but is not
   * allowed to perform this transition on it (REQ-ACH-082 / REQ-ACH-083) — a
   * player acting on someone else's message, or an author trying to undo the
   * GM's invalidation.
   */
  INVALIDATE_DENIED: "CHT_INVALIDATE_DENIED",
} as const;

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[keyof typeof CHAT_ERROR_CODES];
