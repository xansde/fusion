/**
 * Chat and roll types for the Fusion chat subsystem.
 *
 * REQ-CHT-007: five MessageType discriminators.
 * REQ-ROL-028..030: RollResultData with structured terms.
 * 09-chat-e-mensagens.md: ChatMessage Document schema, CardData, ChatSpeaker.
 * 08-motor-de-rolagens.md: RollMode, DiceResult, RollTermResult.
 */

import { z } from "zod";
import { BaseDocumentSchema } from "../document.js";

// ---------------------------------------------------------------------------
// RollMode
// ---------------------------------------------------------------------------

/**
 * Visibility mode for a roll.
 * D5 (spec 08): maps to whisper[] and blind fields on ChatMessage.
 * | Mode        | whisper           | blind |
 * | public      | []                | false |
 * | gmroll      | [...gmUserIds]    | false |
 * | blindroll   | [...gmUserIds]    | true  |
 * | selfroll    | [authorId]        | false |
 */
export const RollModeSchema = z.enum(["public", "gmroll", "blindroll", "selfroll"]);
export type RollMode = z.infer<typeof RollModeSchema>;

// ---------------------------------------------------------------------------
// RollResultData — REQ-ROL-028..030
// ---------------------------------------------------------------------------

/**
 * Result of a single die.
 * REQ-ROL-029: result, active, discarded, rerolled, exploded, success, failure.
 */
export const DiceResultSchema = z.object({
  /** The value rolled. */
  result: z.number(),
  /** Whether this die contributes to the total. */
  active: z.boolean(),
  discarded: z.boolean().optional(),
  rerolled: z.boolean().optional(),
  exploded: z.boolean().optional(),
  /** Marked by cs modifier. */
  success: z.boolean().optional(),
  /** Marked by cf modifier. */
  failure: z.boolean().optional(),
});

export type DiceResult = z.infer<typeof DiceResultSchema>;

/**
 * Result of a single AST term after evaluation.
 * REQ-ROL-028: sufficient to reconstruct full breakdown client-side.
 */
export const RollTermResultSchema = z.object({
  type: z.enum(["dice", "numeric", "operator", "parenthetical", "pool", "function"]),
  /** String representation of the term (e.g. "4d6k3", "+", "5"). */
  expression: z.string(),
  total: z.number(),
  /** Flavor label from [...] annotation. */
  flavor: z.string().optional(),
  // dice-specific
  number: z.number().optional(),
  faces: z.number().optional(),
  modifiers: z.array(z.string()).optional(),
  results: z.array(DiceResultSchema).optional(),
  // pool-specific (array of roll results per expression in pool)
  rolls: z.array(z.array(DiceResultSchema)).optional(),
});

export type RollTermResult = z.infer<typeof RollTermResultSchema>;

/**
 * Complete roll result — serialized by the server and sent to clients.
 * REQ-ROL-028: rollId, formula, expandedFormula, total, terms, flavor, rollMode,
 *              timestamp, warnings, rerollOf, degreeOfSuccess.
 * The seed is NEVER included here (REQ-ROL-049).
 */
export const RollResultDataSchema = z.object({
  rollId: z.string(),
  /** Original formula string, may contain @attr references. */
  formula: z.string(),
  /** Formula after @attr substitution (ready for display). */
  expandedFormula: z.string(),
  total: z.number(),
  terms: z.array(RollTermResultSchema),
  flavor: z.string().optional(),
  rollMode: RollModeSchema,
  /** Unix ms timestamp of the roll. */
  timestamp: z.number().int().nonnegative(),
  /** Warnings (e.g. unresolved @attr). */
  warnings: z.array(z.string()),
  /** If this is a reroll, the rollId of the original roll. */
  rerollOf: z.string().optional(),
  /**
   * Optional degree of success, filled by a system's RollHook postRoll.
   * D7 (spec 08): this is a generic string, not a fixed enum.
   */
  degreeOfSuccess: z.string().optional(),
});

export type RollResultData = z.infer<typeof RollResultDataSchema>;

// ---------------------------------------------------------------------------
// CardData — REQ-CHT-024..028 (spec 09)
// ---------------------------------------------------------------------------

/**
 * Key-value field displayed in the body of a chat card.
 */
export const CardFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  /** Display the value in highlight style (e.g. total damage). */
  highlight: z.boolean().optional(),
});

export type CardField = z.infer<typeof CardFieldSchema>;

/**
 * Typed action associated with a card button.
 * REQ-CHT-026: serialized as actionType + actionPayload.
 */
export const CardButtonSchema = z.object({
  /** Unique id within the card (e.g. "apply-damage"). */
  id: z.string(),
  label: z.string(),
  /** Action type registered via SystemAPI.registerCardAction(). */
  actionType: z.string(),
  /** Arbitrary payload passed to the handler on click. */
  actionPayload: z.record(z.string(), z.unknown()),
  icon: z.string().optional(),
  variant: z.enum(["primary", "secondary", "danger"]).optional(),
  /** Disabled after use (REQ-CHT-028). */
  disabled: z.boolean().optional(),
});

export type CardButton = z.infer<typeof CardButtonSchema>;

/**
 * Declarative chat card schema — no arbitrary HTML allowed.
 * D-CHT-03 (spec 09): rendered by <ChatCard> Svelte component, never innerHTML.
 */
export const CardDataSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  icon: z.string().optional(),
  fields: z.array(CardFieldSchema).optional(),
  /** Light markdown, max 500 chars. */
  description: z.string().max(500).optional(),
  buttons: z.array(CardButtonSchema).optional(),
  /** System namespace that created this card (e.g. "pf2e"). */
  systemId: z.string(),
  /**
   * Opaque system context not displayed in UI.
   * REQ-CHT-024: validated but not rendered.
   */
  systemContext: z.record(z.string(), z.unknown()).optional(),
});

export type CardData = z.infer<typeof CardDataSchema>;

// ---------------------------------------------------------------------------
// ChatSpeaker — REQ-CHT-022
// ---------------------------------------------------------------------------

/**
 * Resolved identity of the effective sender.
 * REQ-CHT-022: resolved server-side from token → actor → user fallback.
 */
export const ChatSpeakerSchema = z.object({
  /** Fusion User ID (always present). */
  userId: z.string(),
  actorId: z.string().optional(),
  tokenId: z.string().optional(),
  /** Display alias in the log. */
  alias: z.string(),
});

export type ChatSpeaker = z.infer<typeof ChatSpeakerSchema>;

// ---------------------------------------------------------------------------
// MessageType — REQ-CHT-007
// ---------------------------------------------------------------------------

export const MessageTypeSchema = z.enum(["text", "roll", "emote", "whisper", "system"]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

// ---------------------------------------------------------------------------
// ChatMessage Document — D-CHT-01 (spec 09)
// ---------------------------------------------------------------------------

/**
 * ChatMessage as a full Document extending BaseDocument.
 * Persisted in SQLite chat_messages table.
 * REQ-CHT-001..006.
 */
export const ChatMessageSchema = BaseDocumentSchema.extend({
  /** Discriminator — always "ChatMessage" for this type. */
  type: MessageTypeSchema,
  /** World this message belongs to. */
  worldId: z.string(),
  /** Sanitized text content (light markdown, inline roll results embedded). */
  content: z.string().max(4096),
  /** Resolved speaker. */
  speaker: ChatSpeakerSchema,
  /** Unix ms — canonical message time. */
  timestamp: z.number().int().nonnegative(),
  /**
   * Recipient User IDs.
   * Empty = public; populated by server for whisper/gmroll/selfroll.
   * REQ-CHT-004.
   */
  whisper: z.array(z.string()).default(() => []),
  /**
   * If true, roll payload is omitted from non-GM broadcast.
   * REQ-CHT-004 / D-CHT-02 / REQ-ROL-031.
   */
  blind: z.boolean().default(false),
  /** Roll results for type === 'roll'. REQ-CHT-018. */
  rolls: z.array(RollResultDataSchema).optional(),
  /** Declarative card for type === 'system'. REQ-CHT-024. */
  card: CardDataSchema.optional(),
  /** Sound asset path played with the message. */
  sound: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ---------------------------------------------------------------------------
// CardActionRequest — REQ-CHT-026
// ---------------------------------------------------------------------------

export const CardActionRequestSchema = z.object({
  messageId: z.string(),
  buttonId: z.string(),
  actorId: z.string().optional(),
  targetIds: z.array(z.string()).optional(),
});

export type CardActionRequest = z.infer<typeof CardActionRequestSchema>;
