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
} from "@fusion/shared";

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
 */
export async function sendChatMessage(socket: Socket, payload: ChatSendPayload): Promise<void> {
  chatStore.error = null;
  return new Promise<void>((resolve, reject) => {
    socket.emit(
      "op",
      { type: "chat:send", payload, requestId: _reqId(), ts: Date.now() },
      (ack: { ok: boolean; message?: string; code?: string }) => {
        if (ack.ok) {
          resolve();
        } else {
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
 * Incoming live messages are fed via handleIncomingMessage() from ChatPanel.
 */
export function attachChatSync(socket: Socket, worldId: string): () => void {
  // Load initial history
  void loadInitialHistory(socket, worldId);

  return () => {
    // Reset store on disconnect
    chatStore.messages = [];
    chatStore.hasMore = false;
    chatStore.nextCursor = null;
    chatStore.unreadCount = 0;
    chatStore.error = null;
  };
}
