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
 *
 * Spec 38 (`specs/38-aba-chat.md`) §5.1/§5.3 adds two things that live here and
 * nowhere else, both for the same reason — the drawer keeps only the active tab's
 * panel mounted (REQ-GAV-017), so anything kept inside `ChatPanel` dies on every
 * tab switch:
 *
 *  - the **unread marker** (REQ-ACH-004/005): opening the tab zeroes the counter
 *    (REQ-CHT-039) but must not throw away *which* message the counter was about.
 *    The count alone would land the reader at the end of the log — losing exactly
 *    the messages the badge promised. So the arrival of the first unread is
 *    remembered as an anchor, and opening turns counter + anchor into the "N novas"
 *    divider the log draws above it;
 *  - the **session scratch** (REQ-ACH-026): unsent draft, log position and the ↑↓
 *    input history. In memory of the session, never a Document (spec 38 §7).
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
import { InputHistory } from "./inputHistory.js";

export type { ProvisionalSpeaker } from "./chatOptimistic.js";
export { isOptimisticallyRenderable, buildProvisionalMessage } from "./chatOptimistic.js";

// ---------------------------------------------------------------------------
// Unread marker (REQ-ACH-004, REQ-ACH-005)
// ---------------------------------------------------------------------------

/**
 * What the log draws as "N novas", and where.
 *
 * `firstUnreadId` is the message the divider sits above — a value, not a live
 * reference: the divider has to keep pointing at the same place while the log
 * pages, groups and re-renders around it.
 */
export interface ChatUnreadMarker {
  /** `_id` of the first message the reader has not seen. */
  readonly firstUnreadId: string;
  /** How many messages the divider announces. Always ≥ 1. */
  readonly count: number;
}

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
  /**
   * The "N novas" divider, or `null` when there is nothing to point at
   * (REQ-ACH-004). Survives tab switches; only reaching the end of the log
   * retires it (REQ-ACH-005).
   */
  unreadMarker: ChatUnreadMarker | null;
  /** Error string from last send/load operation, or null. */
  error: string | null;
} = $state({
  messages: [],
  loadingInitial: false,
  loadingMore: false,
  hasMore: false,
  nextCursor: null,
  unreadCount: 0,
  unreadMarker: null,
  error: null,
});

// ---------------------------------------------------------------------------
// Session scratch — outside the panel component (REQ-ACH-026)
// ---------------------------------------------------------------------------

/**
 * What the reader was in the middle of, kept for the whole table session.
 *
 * `ChatPanel` is unmounted every time the drawer switches tab (REQ-GAV-017), so
 * a draft or a scroll offset held in the component is a draft or a scroll offset
 * that is silently thrown away by a click on another tab. Spec 38 §7 files all
 * three under "cliente, em memória de sessão": no `localStorage`, no Document.
 */
export const chatSession: {
  /** Text typed into the box and not sent yet. */
  draft: string;
  /** Last scroll offset of the log in px; `null` while it was never positioned. */
  scrollTop: number | null;
} = $state({
  draft: "",
  scrollTop: null,
});

/**
 * The ↑↓ history of what was sent (REQ-ACH-026).
 *
 * One instance per session, owned here rather than by the input component for
 * the same reason as `chatSession`.
 */
export const chatInputHistory = new InputHistory();

/** Drop the whole session scratch (table teardown, not a tab switch). */
export function resetChatSession(): void {
  chatSession.draft = "";
  chatSession.scrollTop = null;
  chatInputHistory.clear();
}

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

/**
 * `_id` of the first message that arrived while the tab was closed and has not
 * been turned into a divider yet. Kept out of `chatStore` because it is not a
 * rendering input — the log never reads it; opening the tab is what consumes it.
 */
let _pendingAnchorId: string | null = null;

/**
 * The chat tab became visible, or stopped being visible.
 *
 * Opening does the two halves of REQ-ACH-004 in one gesture: it zeroes the badge
 * (REQ-CHT-039) and, in the same breath, turns what the badge was counting into
 * the "N novas" divider anchored at the first unread — because after the counter
 * is gone there is nothing left to reconstruct it from.
 *
 * Opening with nothing unread leaves any existing divider exactly as it is. That
 * is REQ-ACH-005's "trocar de aba ou recolher a gaveta NÃO DEVE recriá-lo": only
 * reaching the end of the log retires a divider, and only a message received while
 * away creates one.
 */
export function setChatTabVisible(visible: boolean): void {
  _chatTabVisible = visible;
  if (!visible) return;

  const pending = chatStore.unreadCount;
  if (pending > 0) {
    // A divider that is still standing keeps its anchor: the reader never got
    // past it, so the first thing they have not seen is still the same message —
    // what changed is how much piles up after it.
    const anchorId = chatStore.unreadMarker?.firstUnreadId ?? _pendingAnchorId;
    if (anchorId !== null) {
      chatStore.unreadMarker = {
        firstUnreadId: anchorId,
        count: (chatStore.unreadMarker?.count ?? 0) + pending,
      };
    }
  }

  _pendingAnchorId = null;
  chatStore.unreadCount = 0;
}

/**
 * Retire the "N novas" divider (REQ-ACH-005).
 *
 * Called by the log the moment the reader reaches the end — the one event that
 * means "you have now seen all of it". Nothing else puts it out: not a tab
 * switch, not collapsing the drawer, not a new message.
 */
export function dismissUnreadMarker(): void {
  chatStore.unreadMarker = null;
  _pendingAnchorId = null;
}

/**
 * Index of the divider's anchor inside the messages currently loaded, or `-1`.
 *
 * RNF-ACH-02: the anchor is looked up in the page pagination already brought in
 * (DEC-CHT-06 cursor paging) — there is no socket here and no walk back through
 * history. An anchor that aged out of the loaded window resolves to `-1`, and the
 * log falls back to its normal position instead of fetching to find it.
 */
export function resolveUnreadAnchorIndex(): number {
  const anchorId = chatStore.unreadMarker?.firstUnreadId;
  if (anchorId === undefined) return -1;
  return chatStore.messages.findIndex((m) => m._id === anchorId);
}

// ---------------------------------------------------------------------------
// Incoming message handler
// ---------------------------------------------------------------------------

/**
 * Process an incoming ChatMessage document (from doc:create broadcast).
 * Called by the worldSync listener after it receives a ChatMessage.
 *
 * REQ-ACH-003: it only counts while the tab is closed. With the tab open the
 * badge stays dark — the message is already on screen, and a badge for something
 * the reader is looking at is a badge that means nothing.
 */
export function handleIncomingMessage(msg: ChatMessage): void {
  insertMessage(msg);
  if (_chatTabVisible) return;

  chatStore.unreadCount += 1;
  // First unread of this stretch: remember where the divider will go. A divider
  // still standing from a previous stretch keeps its own anchor (see
  // setChatTabVisible), so we do not move it.
  if (chatStore.unreadMarker === null && _pendingAnchorId === null) {
    _pendingAnchorId = msg._id;
  }
}

/**
 * Apply a server-side change to a message ALREADY in the log — today only
 * invalidation and revalidation (REQ-ACH-086).
 *
 * Replaces the entry at the very same index: REQ-ACH-081 requires the voided
 * message to stay in the log "na mesma posição", so this must never re-sort,
 * re-insert or append. It is also not a new message, so the unread counter and
 * the "N novas" anchor are deliberately left alone (REQ-ACH-003).
 *
 * An update for a message that is not in the loaded window (aged out of the
 * pagination, or never visible to this user) is a no-op — inserting it here
 * would materialise, out of nowhere, a message this client never received.
 */
export function applyMessageUpdate(msg: ChatMessage): void {
  const index = chatStore.messages.findIndex((m) => m._id === msg._id);
  if (index === -1) return;
  chatStore.messages[index] = msg;
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
    dismissUnreadMarker();
    // The draft, the log position and the ↑↓ history are session scratch
    // (REQ-ACH-026): they outlive a tab switch, not the table itself.
    resetChatSession();
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
    applyMessageUpdate,
    getRollAnimator: () => _rollAnimator,
  });
}
