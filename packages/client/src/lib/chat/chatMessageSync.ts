/**
 * chatMessageSync.ts — pure logic for live chat message sync (BUG #1 FIX).
 *
 * SYMPTOM: chat only reflected a new roll/message after switching tabs and
 * back. ROOT CAUSE: the `socket.on("op", ...)` listener and attachChatSync's
 * teardown lived in ChatPanel's onMount/onDestroy, but ChatPanel only exists
 * while the chat tab is the sidebar's active one (the container unmounts the
 * real component on switch or collapse).
 * Leaving the chat tab: (a) killed the "op" listener — incoming messages were
 * dropped; (b) attachChatSync's cleanup zeroed chatStore.messages. Returning
 * to the tab remounted ChatPanel and loadInitialHistory() re-fetched from the
 * server, which just looked like "switching tabs fixed it".
 *
 * FIX: split the "op" → ChatMessage handling out of any component lifecycle.
 * This module is deliberately plain TS (no Svelte runes) so it can be
 * unit-tested directly — see chatStore.svelte.ts's header comment on why
 * `.svelte.ts` files with `$state` cannot be imported in tests.
 *
 * `attachChatMessageSync` (the socket-wiring wrapper) is exported from
 * chatStore.svelte.ts and is meant to be called ONCE per table session (from
 * TableScreen's onMount), not from ChatPanel. The roll animator (which needs
 * the #dice-canvas element that only exists while ChatPanel is mounted) is
 * registered/unregistered separately via setRollAnimator from ChatPanel's own
 * onMount/onDestroy — so 3D dice animation still only plays while the user is
 * looking at the chat tab, which is desired behavior, not a bug.
 */

import type { ChatMessage, Envelope, RollResultData } from "@fusion/shared";
import {
  CHAT_BROADCAST_EVENT,
  CHAT_DOCUMENT_TYPE,
  CHAT_UPDATE_BROADCAST_EVENT,
} from "@fusion/shared";

/** Minimal event-emitter surface this module needs from a socket.io Socket. */
export interface OpEmitter {
  on(event: "op", handler: (envelope: Envelope) => void): unknown;
  off(event: "op", handler: (envelope: Envelope) => void): unknown;
}

export interface ChatMessageSyncDeps {
  /** Called for every incoming ChatMessage document (inserts into the store). */
  handleIncomingMessage: (msg: ChatMessage) => void;
  /**
   * Called for every ChatMessage that changed AFTER the fact — today only
   * invalidation/revalidation (REQ-ACH-086). It replaces the message already in
   * the log, in place: an update is not a new message, so it neither moves nor
   * counts as unread.
   */
  applyMessageUpdate: (msg: ChatMessage) => void;
  /** Returns the currently-registered roll animator, or null if none (e.g. ChatPanel unmounted). */
  getRollAnimator: () => ((roll: RollResultData) => void) | null;
}

/**
 * Read the ChatMessage documents out of a chat broadcast payload, whatever the
 * envelope type is. Empty when the payload belongs to another document type or
 * is malformed.
 *
 * The server's broadcastChatMessage (chat-handler.ts) emits the batch shape
 * `{ documentType, documents: [msg] }` — the same wire shape as every other
 * doc:create broadcast. The singular `document` key is also accepted for
 * robustness, but reading ONLY the singular key was a real bug: live
 * broadcasts never matched it, so messages from other users (and sheet rolls
 * sent via sendOpFn, which ignores the ack result) only appeared after a
 * history reload.
 */
function readChatMessages(envelope: Envelope): ChatMessage[] {
  const payload = envelope.payload as {
    documentType?: string;
    document?: unknown;
    documents?: unknown;
  };
  if (payload.documentType !== CHAT_DOCUMENT_TYPE) return [];

  const candidates: unknown[] = Array.isArray(payload.documents)
    ? payload.documents
    : payload.document !== undefined
      ? [payload.document]
      : [];

  return candidates.filter((raw): raw is ChatMessage => {
    const msg = raw as ChatMessage | null | undefined;
    return !!msg && typeof msg._id === "string";
  });
}

/**
 * Extract the ChatMessages from a doc:create envelope, or an empty array if
 * the envelope is not a ChatMessage creation (e.g. a different document
 * type, or a malformed payload).
 */
export function extractChatMessagesFromEnvelope(envelope: Envelope): ChatMessage[] {
  if (envelope.type !== CHAT_BROADCAST_EVENT) return [];
  return readChatMessages(envelope);
}

/**
 * Extract the ChatMessages from a doc:update envelope (REQ-ACH-086).
 *
 * A message that was invalidated comes back over the wire as an update of the
 * SAME document — same `_id`, same position in the log, `invalid` now true and
 * `invalidatedBy`/`invalidatedAt` stamped (REQ-ACH-084). Dropping this envelope
 * (which the client used to do, filtering on `doc:create` alone) meant the live
 * log never showed the invalidation: only a reload did. Revalidation arrives the
 * same way, with `invalid` back to false.
 */
export function extractChatMessageUpdatesFromEnvelope(envelope: Envelope): ChatMessage[] {
  if (envelope.type !== CHAT_UPDATE_BROADCAST_EVENT) return [];
  return readChatMessages(envelope);
}

/**
 * Back-compat single-message variant (first message or null). Prefer
 * {@link extractChatMessagesFromEnvelope} — broadcasts carry an array.
 */
export function extractChatMessageFromEnvelope(envelope: Envelope): ChatMessage | null {
  return extractChatMessagesFromEnvelope(envelope)[0] ?? null;
}

/** True when a roll on this message should trigger the 3D dice animation. */
export function isPubliclyVisibleRoll(msg: ChatMessage): boolean {
  return (
    msg.type === "roll" &&
    !!msg.rolls &&
    msg.rolls.length > 0 &&
    !msg.blind &&
    msg.whisper.length === 0
  );
}

/**
 * Build the "op" handler that feeds live ChatMessage broadcasts into the
 * store and (if registered) the roll animator. Pure function of `deps` —
 * no socket access, so it's directly testable.
 */
export function createChatOpHandler(deps: ChatMessageSyncDeps): (envelope: Envelope) => void {
  return (envelope: Envelope) => {
    // A message that changed after the fact (invalidation — REQ-ACH-086) is
    // NOT a new message: it replaces the entry already in the log and stops
    // there. No unread bump and, above all, no dice animation — replaying the
    // 3D dice of a roll that was just voided would announce the opposite of
    // what happened.
    for (const updated of extractChatMessageUpdatesFromEnvelope(envelope)) {
      deps.applyMessageUpdate(updated);
    }

    const messages = extractChatMessagesFromEnvelope(envelope);

    for (const msg of messages) {
      deps.handleIncomingMessage(msg);

      if (!isPubliclyVisibleRoll(msg) || !msg.rolls) continue;
      const animator = deps.getRollAnimator();
      if (!animator) continue;
      for (const roll of msg.rolls) {
        if (roll.rollMode === "public") {
          animator(roll);
        }
      }
    }
  };
}

/**
 * Wire the op handler to a socket-like emitter. Returns a cleanup function
 * that removes the listener (does NOT touch chatStore.messages — resetting
 * the store is attachChatSync's responsibility, scoped to the table session
 * lifecycle, not the chat tab's visibility).
 */
export function attachChatOpListener(socket: OpEmitter, deps: ChatMessageSyncDeps): () => void {
  const handler = createChatOpHandler(deps);
  socket.on("op", handler);
  return () => {
    socket.off("op", handler);
  };
}
