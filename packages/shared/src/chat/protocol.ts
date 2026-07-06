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
} as const;

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[keyof typeof CHAT_ERROR_CODES];
