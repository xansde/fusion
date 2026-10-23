/**
 * chatContext.svelte.ts — the chat context window's state (plan G038).
 *
 * Spec 38 (`specs/38-aba-chat.md`) §5.2:
 *
 *  - REQ-ACH-013: activating a search result opens a context window with the
 *    target message plus the **5 visible** messages on each side, and a "mais 5"
 *    control per side. The counting of what is a neighbour is the server's
 *    (`chat:context`, REQ-CHT-051): an invisible message takes no slot and is
 *    never signalled, so the client asks for a window and renders exactly the
 *    sequence it is handed — it never filters, never renumbers and never draws a
 *    gap where something was skipped.
 *  - REQ-ACH-014: at most ONE context window exists at a time. Activating another
 *    result reuses it, which is why the window is opened under a FIXED singleton
 *    key and the view reads this module instead of its window props: the window
 *    manager focuses an existing singleton without re-applying `componentProps`
 *    (see `WindowManager.open`), so the target has to travel through state, not
 *    through props.
 *  - REQ-ACH-014 again: the live log MUST NOT move while the window is open. That
 *    is a property of this module by construction — it owns its own messages and
 *    never touches `chatStore`/`chatSession`.
 *
 * The server's window is symmetric (one `limit` for both sides, spec 09
 * REQ-CHT-051). "Mais 5" is per side, so this module keeps how much each side
 * wants, asks for the larger of the two, and slices each side down to what it
 * asked for — the extra rows the wider request brings back are what tells a side
 * there is still more to show.
 *
 * No socket call is hidden from the caller: the socket is injected, exactly like
 * `chatStore.svelte.ts`, so the whole thing is testable without a connection.
 */

import type { Socket } from "socket.io-client";
import type { ChatMessage } from "@fusion/shared";
import { t } from "../i18n/i18n.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Singleton key of the context window (REQ-ACH-014, REQ-UIF-014).
 *
 * Fixed — it deliberately does NOT carry the message id: keying by target is
 * exactly what would let two results open two windows.
 */
export const CHAT_CONTEXT_WINDOW_KEY = "chat:context";

/** How many visible neighbours each side starts with, and grows by (REQ-ACH-013). */
export const CHAT_CONTEXT_PAGE = 5;

/** Ceiling the server accepts for a single side of the window (spec 09 REQ-CHT-051). */
export const CHAT_CONTEXT_MAX_LIMIT = 50;

/** How long to wait for the `chat:context` ack before giving up. */
const CONTEXT_TIMEOUT_MS = 10_000;

export type ChatContextSide = "before" | "after";

// ---------------------------------------------------------------------------
// Server contract (owned by the server lane — G031)
// ---------------------------------------------------------------------------

/**
 * What `chat:context` answers with, already redacted for the requester.
 *
 * Declared here rather than imported from `@fusion/shared` because the schema
 * lives in the server lane's protocol file; this is the client's reading of the
 * same contract: `{ worldId, id, limit? }` in, `{ target, before, after,
 * hasMoreBefore, hasMoreAfter }` out, `before`/`after` in chronological order.
 */
export interface ChatContextResult {
  target: ChatMessage;
  before: ChatMessage[];
  after: ChatMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

interface ChatContextAck {
  ok: boolean;
  result?: ChatContextResult;
  code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

export const chatContext: {
  /** `_id` of the message the window is centred on, or `null` when closed. */
  targetId: string | null;
  /** The centred message itself; `null` while loading or after a failure. */
  target: ChatMessage | null;
  /** Visible neighbours before the target, oldest first. */
  before: ChatMessage[];
  /** Visible neighbours after the target, oldest first. */
  after: ChatMessage[];
  /** True while more visible messages exist beyond the window on that side. */
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  /** How many neighbours each side is currently asking for. */
  beforeWanted: number;
  afterWanted: number;
  /** True while a `chat:context` round-trip is in flight. */
  loading: boolean;
  /** Message of the last failure, or `null`. */
  error: string | null;
} = $state({
  targetId: null,
  target: null,
  before: [],
  after: [],
  hasMoreBefore: false,
  hasMoreAfter: false,
  beforeWanted: CHAT_CONTEXT_PAGE,
  afterWanted: CHAT_CONTEXT_PAGE,
  loading: false,
  error: null,
});

// ---------------------------------------------------------------------------
// Connection remembered from the last load
// ---------------------------------------------------------------------------

/**
 * The socket/world the window is talking to. Kept out of `chatContext` because
 * it is not a rendering input — it exists so "mais 5" is a one-argument call from
 * the view, which has no business holding a socket for a window it does not own.
 */
let _socket: Socket | null = null;
let _worldId = "";

/** Monotonic request id: only the newest round-trip may write the state. */
let _seq = 0;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Cut one side of the server's symmetric window down to what that side asked for.
 *
 * `before` is chronological and ends right against the target, so its tail is the
 * nearest slice; `after` starts against the target, so its head is. Anything the
 * wider request brought back beyond `wanted` is proof there is more to show —
 * OR'd with what the server itself reported past its own window.
 */
export function sliceContextSide(
  messages: readonly ChatMessage[],
  side: ChatContextSide,
  wanted: number,
  serverHasMore: boolean,
): { messages: ChatMessage[]; hasMore: boolean } {
  const trimmed =
    side === "before"
      ? messages.slice(Math.max(0, messages.length - wanted))
      : messages.slice(0, wanted);
  return { messages: [...trimmed], hasMore: messages.length > wanted || serverHasMore };
}

/**
 * Whether the "mais 5" control of a side does anything: there is more to show and
 * the side has not reached the ceiling the server accepts.
 */
export function canExpandChatContext(side: ChatContextSide): boolean {
  return side === "before"
    ? chatContext.hasMoreBefore && chatContext.beforeWanted < CHAT_CONTEXT_MAX_LIMIT
    : chatContext.hasMoreAfter && chatContext.afterWanted < CHAT_CONTEXT_MAX_LIMIT;
}

/** The whole window in reading order — neighbours before, target, neighbours after. */
export function chatContextSequence(): ChatMessage[] {
  if (chatContext.target === null) return [];
  return [...chatContext.before, chatContext.target, ...chatContext.after];
}

// ---------------------------------------------------------------------------
// Socket
// ---------------------------------------------------------------------------

function _reqId(): string {
  return `ctx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * `chat:context` is a read, so it travels on the `query` channel (the dispatcher
 * accepts both, but a read on `op` is a lie about what it does).
 */
function _emitContext(
  socket: Socket,
  payload: { worldId: string; id: string; limit: number },
): Promise<ChatContextResult> {
  return new Promise<ChatContextResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Context request timed out"));
    }, CONTEXT_TIMEOUT_MS);
    socket.emit(
      "query",
      { type: "chat:context", payload, requestId: _reqId(), ts: Date.now() },
      (ack: ChatContextAck) => {
        clearTimeout(timer);
        if (ack.ok && ack.result) {
          resolve(ack.result);
        } else {
          reject(new Error(ack.message ?? "Context load failed"));
        }
      },
    );
  });
}

async function _fetchContext(): Promise<void> {
  const socket = _socket;
  const id = chatContext.targetId;
  if (socket === null || id === null) return;

  const mySeq = ++_seq;
  chatContext.loading = true;
  chatContext.error = null;

  try {
    const limit = Math.min(
      Math.max(chatContext.beforeWanted, chatContext.afterWanted),
      CHAT_CONTEXT_MAX_LIMIT,
    );
    const res = await _emitContext(socket, { worldId: _worldId, id, limit });
    // A newer target (or a wider side) was asked for while this was in flight:
    // the answer is about a window nobody is looking at any more.
    if (mySeq !== _seq) return;

    const before = sliceContextSide(
      res.before,
      "before",
      chatContext.beforeWanted,
      res.hasMoreBefore,
    );
    const after = sliceContextSide(res.after, "after", chatContext.afterWanted, res.hasMoreAfter);

    chatContext.target = res.target;
    chatContext.before = before.messages;
    chatContext.after = after.messages;
    chatContext.hasMoreBefore = before.hasMore;
    chatContext.hasMoreAfter = after.hasMore;
  } catch (err) {
    if (mySeq !== _seq) return;
    chatContext.error = err instanceof Error ? err.message : "Context load failed";
    chatContext.target = null;
    chatContext.before = [];
    chatContext.after = [];
    chatContext.hasMoreBefore = false;
    chatContext.hasMoreAfter = false;
  } finally {
    if (mySeq === _seq) chatContext.loading = false;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Point the window at a message and fetch its window of visible neighbours
 * (REQ-ACH-013).
 *
 * Switching target resets both sides back to 5: the reader activated a different
 * result, not a wider view of the previous one.
 */
export async function loadChatContext(
  socket: Socket,
  worldId: string,
  messageId: string,
): Promise<void> {
  _socket = socket;
  _worldId = worldId;

  if (chatContext.targetId !== messageId) {
    chatContext.beforeWanted = CHAT_CONTEXT_PAGE;
    chatContext.afterWanted = CHAT_CONTEXT_PAGE;
    chatContext.target = null;
    chatContext.before = [];
    chatContext.after = [];
    chatContext.hasMoreBefore = false;
    chatContext.hasMoreAfter = false;
  }
  chatContext.targetId = messageId;
  await _fetchContext();
}

/**
 * "Mais 5" of one side (REQ-ACH-013): that side asks for five more and the window
 * is fetched again. The other side keeps exactly what it had — a wider request is
 * an implementation detail of the symmetric server window, not a change of view.
 */
export async function expandChatContext(side: ChatContextSide): Promise<void> {
  if (!canExpandChatContext(side)) return;
  if (side === "before") {
    chatContext.beforeWanted = Math.min(
      chatContext.beforeWanted + CHAT_CONTEXT_PAGE,
      CHAT_CONTEXT_MAX_LIMIT,
    );
  } else {
    chatContext.afterWanted = Math.min(
      chatContext.afterWanted + CHAT_CONTEXT_PAGE,
      CHAT_CONTEXT_MAX_LIMIT,
    );
  }
  await _fetchContext();
}

/** Forget everything: the window was closed. */
export function closeChatContext(): void {
  _seq += 1;
  _socket = null;
  _worldId = "";
  chatContext.targetId = null;
  chatContext.target = null;
  chatContext.before = [];
  chatContext.after = [];
  chatContext.hasMoreBefore = false;
  chatContext.hasMoreAfter = false;
  chatContext.beforeWanted = CHAT_CONTEXT_PAGE;
  chatContext.afterWanted = CHAT_CONTEXT_PAGE;
  chatContext.loading = false;
  chatContext.error = null;
}

// ---------------------------------------------------------------------------
// The window itself
// ---------------------------------------------------------------------------

/**
 * Open (or reuse) the one context window and centre it on `messageId`
 * (REQ-ACH-013, REQ-ACH-014).
 *
 * The window manager focuses an existing singleton instead of opening a second
 * one, so a second activation lands on the same window; the new target reaches
 * the view through `chatContext`, which the view reads directly. A minimized
 * window is restored, otherwise activating a result would look like nothing
 * happened.
 *
 * Nothing here touches the live log: it neither scrolls it nor loads into it.
 */
export async function openChatContextWindow(
  socket: Socket,
  worldId: string,
  messageId: string,
  opts: { isGm?: boolean; userId?: string } = {},
): Promise<void> {
  const [{ windowManager }, view] = await Promise.all([
    import("../windows/window-manager.js"),
    import("../../components/chat/ChatContextWindow.svelte"),
  ]);

  const handle = windowManager.open({
    singletonKey: CHAT_CONTEXT_WINDOW_KEY,
    title: t("FUSION.Chat.Context.Title"),
    resizable: true,
    minimizable: true,
    position: { width: 480, height: 460 },
    component: view.default,
    componentProps: {
      socket,
      worldId,
      isGm: opts.isGm ?? false,
      userId: opts.userId ?? "",
    },
  });
  handle.restore();
  handle.bringToFront();

  await loadChatContext(socket, worldId, messageId);
}
