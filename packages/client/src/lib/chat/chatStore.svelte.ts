/**
 * chatStore.svelte.ts — Svelte 5 runes reactive store for the chat subsystem.
 *
 * Responsibilities:
 * - Maintain the ordered list of ChatMessage documents received from the server.
 * - Track unread count (messages received while the chat tab is not visible).
 * - Provide cursor-based pagination state for "load more" (chat:history).
 * - Handle doc:create broadcasts from worldSync for ChatMessage documents.
 * - Expose actions: sendMessage, loadHistory, markRead.
 *
 * REQ-CHT-001..006: ChatMessage is a Document persisted by the server.
 * REQ-CHT-033..034: cursor-based pagination.
 *
 * Design: no socket calls inside this store — callers inject the socket
 * so the store is testable without a real connection.
 */

import type { Socket } from "socket.io-client";
import type {
  ChatMessage,
  ChatHistoryRequest,
  ChatHistoryResponse,
  ChatSendPayload,
  RollResultData,
} from "@fusion/shared";
import {
  isOptimisticallyRenderable,
  buildProvisionalMessage,
  reconcileProvisional,
  removeMessageById,
  type ProvisionalSpeaker,
} from "./chatOptimistic.js";
import { attachChatOpListener, type OpEmitter } from "./chatMessageSync.js";

export type { ProvisionalSpeaker } from "./chatOptimistic.js";
export { isOptimisticallyRenderable, buildProvisionalMessage } from "./chatOptimistic.js";

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

export const chatStore: {
  /** Ordered messages, oldest first. */
  messages: ChatMessage[];
  /** True while the initial page is loading. */
  loadingInitial: boolean;
  /** True while loading older messages. */
  loadingMore: boolean;
  /** Whether there are older messages to load. */
  hasMore: boolean;
  /** Cursor for next page (oldest _id seen). */
  nextCursor: string | null;
  /** Number of messages received while chat tab is not focused. */
  unreadCount: number;
  /** Error string from last send/load operation, or null. */
  error: string | null;
} = $state({
  messages: [],
  loadingInitial: false,
  loadingMore: false,
  hasMore: false,
  nextCursor: null,
  unreadCount: 0,
  error: null,
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Insert a message into the ordered array (by timestamp, then _id). */
function insertMessage(msg: ChatMessage): void {
  // Deduplicate by _id
  if (chatStore.messages.some((m) => m._id === msg._id)) return;

  const ts = msg.timestamp;
  // Find insertion point (binary-ish: just scan from end since most new messages append)
  let i = chatStore.messages.length;
  while (i > 0 && (chatStore.messages[i - 1]?.timestamp ?? 0) > ts) {
    i--;
  }
  chatStore.messages.splice(i, 0, msg);
}

/** Prepend older messages (from history load) — they arrive newest-first, we reverse. */
function prependMessages(msgs: ChatMessage[]): void {
  const sorted = [...msgs].sort((a, b) => a.timestamp - b.timestamp || a._id.localeCompare(b._id));
  for (const msg of sorted) {
    if (!chatStore.messages.some((m) => m._id === msg._id)) {
      chatStore.messages.unshift(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// Chat-visible flag (tab active)
// ---------------------------------------------------------------------------

let _chatTabVisible = false;

export function setChatTabVisible(visible: boolean): void {
  _chatTabVisible = visible;
  if (visible) {
    chatStore.unreadCount = 0;
  }
}

// ---------------------------------------------------------------------------
// Incoming message handler
// ---------------------------------------------------------------------------

/**
 * Process an incoming ChatMessage document (from doc:create broadcast).
 * Called by the worldSync listener after it receives a ChatMessage.
 */
export function handleIncomingMessage(msg: ChatMessage): void {
  insertMessage(msg);
  if (!_chatTabVisible) {
    chatStore.unreadCount += 1;
  }
}

// ---------------------------------------------------------------------------
// Socket-dependent actions
// ---------------------------------------------------------------------------

/**
 * Load the initial page of history (most recent messages).
 * Call once when the chat panel first becomes visible.
 */
export async function loadInitialHistory(socket: Socket, worldId: string): Promise<void> {
  if (chatStore.loadingInitial) return;
  chatStore.loadingInitial = true;
  chatStore.error = null;

  try {
    const req: ChatHistoryRequest = { worldId, limit: 50 };
    const res = await _emitHistory(socket, req);
    prependMessages(res.messages as ChatMessage[]);
    chatStore.hasMore = res.hasMore;
    chatStore.nextCursor = res.nextCursor;
  } catch (err) {
    chatStore.error = err instanceof Error ? err.message : "Failed to load history";
  } finally {
    chatStore.loadingInitial = false;
  }
}

/**
 * Load older messages (pagination — user scrolled to top).
 */
export async function loadMoreHistory(socket: Socket, worldId: string): Promise<void> {
  if (chatStore.loadingMore || !chatStore.hasMore || !chatStore.nextCursor) return;
  chatStore.loadingMore = true;
  chatStore.error = null;

  try {
    const req: ChatHistoryRequest = {
      worldId,
      before: chatStore.nextCursor,
      limit: 50,
    };
    const res = await _emitHistory(socket, req);
    prependMessages(res.messages as ChatMessage[]);
    chatStore.hasMore = res.hasMore;
    chatStore.nextCursor = res.nextCursor;
  } catch (err) {
    chatStore.error = err instanceof Error ? err.message : "Failed to load more messages";
  } finally {
    chatStore.loadingMore = false;
  }
}

/**
 * Send a raw chat input string to the server.
 * The server handles parsing, command dispatch, RNG, and persistence.
 *
 * BUG E FIX (perceived chat latency): previously the message only appeared
 * after the full round-trip (emit → server persist/broadcast → this client's
 * own `doc:create` broadcast came back). Now, for plain text with no inline
 * rolls (see isOptimisticallyRenderable in chatOptimistic.ts), a provisional
 * message is inserted into chatStore.messages BEFORE emitting. When the ack
 * arrives with the canonical message (every chat:send branch returns
 * `{ result: { message } }` — see chat-handler.ts), the provisional entry is
 * replaced in place (same array index, so no visual jump/reorder) by its
 * server `_id`. The later `doc:create` broadcast for that same canonical
 * `_id` is then a no-op — insertMessage() already dedupes by `_id`, and by
 * the time the broadcast arrives the provisional has already been swapped
 * for the canonical entry.
 *
 * On ack failure the provisional entry is removed (not left stuck as
 * "pending" forever) and the error is surfaced via chatStore.error, matching
 * the pre-existing error-handling contract other callers rely on.
 *
 * @param speaker  Required to render the provisional echo (unused when the
 *                 content isn't optimistically renderable — see
 *                 isOptimisticallyRenderable()).
 */
export async function sendChatMessage(
  socket: Socket,
  payload: ChatSendPayload,
  speaker?: ProvisionalSpeaker,
): Promise<void> {
  chatStore.error = null;

  let provisionalId: string | null = null;
  if (speaker && isOptimisticallyRenderable(payload.content)) {
    const provisional = buildProvisionalMessage(payload.content, speaker);
    provisionalId = provisional._id;
    insertMessage(provisional);
  }

  return new Promise<void>((resolve, reject) => {
    socket.emit(
      "op",
      { type: "chat:send", payload, requestId: _reqId(), ts: Date.now() },
      (ack: {
        ok: boolean;
        message?: string;
        code?: string;
        result?: { message?: ChatMessage };
      }) => {
        if (ack.ok) {
          // If no provisional was rendered (e.g. a /roll), the broadcast
          // listener (handleIncomingMessage) inserts the canonical message —
          // nothing to reconcile here.
          const canonical = ack.result?.message;
          if (provisionalId && canonical) {
            reconcileProvisional(chatStore.messages, provisionalId, canonical);
          }
          resolve();
        } else {
          if (provisionalId) removeMessageById(chatStore.messages, provisionalId);
          const msg = ack.message ?? "Send failed";
          chatStore.error = msg;
          reject(new Error(msg));
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Internal socket helper
// ---------------------------------------------------------------------------

function _reqId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function _emitHistory(socket: Socket, req: ChatHistoryRequest): Promise<ChatHistoryResponse> {
  return new Promise<ChatHistoryResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("History request timed out"));
    }, 10_000);
    socket.emit(
      "op",
      { type: "chat:history", payload: req, requestId: _reqId(), ts: Date.now() },
      (ack: { ok: boolean; result?: ChatHistoryResponse; message?: string }) => {
        clearTimeout(timer);
        if (ack.ok && ack.result) {
          resolve(ack.result);
        } else {
          reject(new Error(ack.message ?? "History load failed"));
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Attach chat sync
// ---------------------------------------------------------------------------

/**
 * Initialize chat sync for a world session.
 * Loads initial history and returns a cleanup function.
 * Incoming live messages are fed via attachChatMessageSync() (see below) —
 * NOT tied to this function's lifecycle.
 *
 * BUG #1 FIX: this must be called ONCE per table session (TableScreen's
 * onMount), not from ChatPanel — ChatPanel unmounts whenever the user leaves
 * the chat tab, and previously this cleanup (which resets chatStore.messages)
 * ran on every tab switch, discarding history that loadInitialHistory then
 * had to re-fetch from the server (the "switching tabs fixes it" illusion).
 */
export function attachChatSync(socket: Socket, worldId: string): () => void {
  // Load initial history
  void loadInitialHistory(socket, worldId);

  return () => {
    // Reset store on session teardown (NOT on chat tab switch).
    chatStore.messages = [];
    chatStore.hasMore = false;
    chatStore.nextCursor = null;
    chatStore.unreadCount = 0;
    chatStore.error = null;
  };
}

// ---------------------------------------------------------------------------
// Live message sync (BUG #1 FIX) — decoupled from ChatPanel's mount lifecycle
// ---------------------------------------------------------------------------

/** Roll animator, registered by ChatPanel while it's mounted (dice-canvas needs its DOM). */
let _rollAnimator: ((roll: RollResultData) => void) | null = null;

/**
 * Register (or unregister, passing null) the 3D dice roll animator.
 * Called from ChatPanel's onMount/onDestroy — animation only plays while the
 * user is actually looking at the chat tab (the #dice-canvas element only
 * exists then), but message delivery itself does NOT depend on this.
 */
export function setRollAnimator(fn: ((roll: RollResultData) => void) | null): void {
  _rollAnimator = fn;
}

/**
 * Attach the live "op" listener that feeds incoming ChatMessage broadcasts
 * into chatStore, independent of any UI component's mount state.
 *
 * Call ONCE per table session (TableScreen's onMount), alongside
 * attachChatSync. Returns a cleanup function that removes the listener.
 */
export function attachChatMessageSync(socket: OpEmitter): () => void {
  return attachChatOpListener(socket, {
    handleIncomingMessage,
    getRollAnimator: () => _rollAnimator,
  });
}
