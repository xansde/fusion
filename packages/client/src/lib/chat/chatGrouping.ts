/**
 * chatGrouping.ts — pure grouping of nested chat rolls under their parent
 * spell-cast card (r18-N1).
 *
 * A spell-cast announcement is a PARENT message; the attack / damage / save
 * rolls it spawns carry `flags.fusion.parentMessageId` = the announcement's id.
 * The chat log renders ONE card per conjuration by:
 *   - keeping only "top-level" messages in the main list (a message is
 *     top-level when it has no parent flag, OR its parent is NOT currently in
 *     the rendered window — an ORPHAN, which degrades to a normal loose card so
 *     it never disappears);
 *   - grouping every child under its present parent, in chronological order, so
 *     the parent card can render them inline (attack/damage lines + a
 *     "Salvaguardas" section).
 *
 * No Svelte, no DOM — 100% testable. ChatLog.svelte derives this once per
 * message-array change and passes each parent its children to ChatMessage.
 */

import type { ChatMessage } from "@fusion/shared";

/** The namespaced flag path the server persists for a nested roll (r18-N1). */
export const PARENT_FLAG_NAMESPACE = "fusion" as const;
export const PARENT_MESSAGE_ID_FLAG_KEY = "parentMessageId" as const;

/**
 * Read `flags.fusion.parentMessageId` off a message, or null. Defensive against
 * malformed/foreign flags (only a non-empty string counts).
 */
export function readParentMessageId(msg: ChatMessage): string | null {
  const fusion = (msg.flags as Record<string, Record<string, unknown>> | undefined)?.[
    PARENT_FLAG_NAMESPACE
  ];
  const raw = fusion?.[PARENT_MESSAGE_ID_FLAG_KEY];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** Result of grouping the message window into parents + their nested children. */
export interface GroupedChat {
  /**
   * Messages to render at the top level of the log, in the SAME order they
   * appear in the input (chronological). Excludes children whose parent is
   * present in the window; INCLUDES orphans (parent absent → degrade to loose).
   */
  topLevel: ChatMessage[];
  /**
   * Children grouped by their (present) parent id, chronological within each
   * parent. A parent with no children has no entry here.
   */
  childrenByParent: Map<string, ChatMessage[]>;
  /**
   * Ids of TOP-LEVEL messages that continue the previous one and therefore must
   * render WITHOUT repeating the header (REQ-ACH-025). Nested children never
   * appear here — they render inside their parent's card, not as log rows.
   */
  continuations: Set<string>;
}

/**
 * Group an ordered (chronological) message array into top-level entries and
 * per-parent children (r18-N1).
 *
 * A message is a CHILD (hidden from the top level, nested under its parent)
 * only when BOTH hold:
 *   1. it carries a `parentMessageId`, AND
 *   2. a message with that id is present in `messages` (the rendered window).
 * Otherwise it stays top-level — this is the ORPHAN degradation that guarantees
 * a nested roll is never lost when its parent scrolled out of the window or was
 * never loaded (pagination boundary).
 *
 * The input order is preserved for both the top-level list and each parent's
 * children (callers pass chatStore.messages, which is kept sorted by
 * timestamp+id), so no re-sorting is needed here.
 */
export function groupChatMessages(messages: readonly ChatMessage[]): GroupedChat {
  const presentIds = new Set(messages.map((m) => m._id));
  const topLevel: ChatMessage[] = [];
  const childrenByParent = new Map<string, ChatMessage[]>();

  for (const msg of messages) {
    const parentId = readParentMessageId(msg);
    if (parentId !== null && presentIds.has(parentId)) {
      // Nested child of a present parent.
      const bucket = childrenByParent.get(parentId);
      if (bucket) bucket.push(msg);
      else childrenByParent.set(parentId, [msg]);
    } else {
      // No parent flag, or orphan (parent not in window) → top-level.
      topLevel.push(msg);
    }
  }

  return { topLevel, childrenByParent, continuations: collectContinuations(topLevel) };
}

// ---------------------------------------------------------------------------
// Author grouping — REQ-ACH-025
// ---------------------------------------------------------------------------

/**
 * True when the message renders as a CARD: a declarative `card` payload, or a
 * PF2e ability/spell-cast card riding on a plain text announcement. A card is
 * a block with its own frame — stacking one under another message's header
 * would make it look like part of that message.
 */
export function isCardMessage(msg: ChatMessage): boolean {
  if (msg.card !== undefined) return true;
  const flags = msg.flags as Record<string, Record<string, unknown> | undefined> | undefined;
  const pf2e = flags?.["pf2e"];
  return pf2e?.["abilityCard"] !== undefined || pf2e?.["spellCast"] !== undefined;
}

/** True when the message is a whisper (private recipients or the whisper type). */
export function isWhisperMessage(msg: ChatMessage): boolean {
  return msg.type === "whisper" || msg.whisper.length > 0;
}

/**
 * True when the message stands in the log marked as void (REQ-CHT-005).
 *
 * Read structurally instead of through the schema type: invalidation is a flag
 * the server writes on the message document, and every message persisted before
 * it existed simply has no such property — which reads exactly like `false`.
 */
export function isInvalidMessage(msg: ChatMessage): boolean {
  return (msg as { invalid?: boolean }).invalid === true;
}

/**
 * A message may only join the previous one's header when it is a plain, public
 * message by the same author (REQ-ACH-025). Cards, whispers and invalidated
 * messages are excluded on BOTH sides: they never continue a run, and they never
 * anchor one — whatever comes after them starts fresh with its own header.
 *
 * "Same author" is the pair (userId, alias): the Master alternating between two
 * NPC voices is two different authors on screen, even though it is one user. The
 * blind flag is compared too, because its badge lives in the header — grouping a
 * blind roll under a non-blind header would hide that it was blind.
 */
export function canGroupWithPrevious(
  current: ChatMessage,
  previous: ChatMessage | undefined,
): boolean {
  if (previous === undefined) return false;
  for (const msg of [current, previous]) {
    if (isCardMessage(msg) || isWhisperMessage(msg) || isInvalidMessage(msg)) return false;
  }
  if (current.speaker.userId !== previous.speaker.userId) return false;
  if (current.speaker.alias !== previous.speaker.alias) return false;
  return current.blind === previous.blind;
}

/**
 * Ids of the messages in an ordered list that continue the previous one — i.e.
 * the ones whose header must be suppressed (REQ-ACH-025). The first message of
 * a list is never a continuation.
 */
export function collectContinuations(messages: readonly ChatMessage[]): Set<string> {
  const continuations = new Set<string>();
  for (let i = 1; i < messages.length; i++) {
    const current = messages[i];
    if (current && canGroupWithPrevious(current, messages[i - 1])) {
      continuations.add(current._id);
    }
  }
  return continuations;
}
