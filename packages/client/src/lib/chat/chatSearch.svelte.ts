/**
 * chatSearch.svelte.ts — the search that lives in the panel's top bar (plan G033).
 *
 * Spec 38 (`specs/38-aba-chat.md`) §5.2: the bar is fixed at the top for EVERY role, the
 * field takes the whole width (REQ-ACH-010) and typing in it queries the SERVER
 * (REQ-ACH-011 / REQ-CHT-036) — never the loaded page. Searching the page the client
 * happens to hold would quietly answer "not found" for everything older than the last
 * scroll, which is a worse lie than a slow answer.
 *
 * Two things live here rather than in the panel, both because the drawer keeps only the
 * active tab's panel mounted (REQ-GAV-017) and the panel therefore dies on every tab
 * switch:
 *  - the term and the results, so switching tabs and coming back does not silently drop
 *    the reader back into the live log;
 *  - the in-flight guard, so a stale answer cannot overwrite a newer one.
 *
 * The server decides what each user may find — same predicate as the history, no second
 * rule (REQ-ACH-012 / REQ-CHT-050). Nothing here filters, and nothing here must ever
 * start doing so.
 *
 * What the server says when it refuses, however, is NOT for the reader: an ack carries
 * internal codes and, on a rejected payload, the raw Zod issue blob. `error` therefore
 * holds an i18n KEY (see {@link ChatSearchErrorKey}), never a message — the whole panel
 * speaks pt-BR through `t()`, and the search must not be the one hole in it.
 */

import { CHAT_SEARCH_MAX_LIMIT, CHAT_SEARCH_MAX_TERM_LENGTH } from "@fusion/shared";

import type { Socket } from "socket.io-client";
import type { ChatMessage } from "@fusion/shared";

/**
 * Longest term the server accepts. Re-exported so the field can cap itself and the
 * request never becomes a validation failure the reader has to read.
 */
export { CHAT_SEARCH_MAX_TERM_LENGTH };

/** Server cap (`CHAT_SEARCH_MAX_LIMIT` in the shared protocol) — taken, not retyped. */
export const CHAT_SEARCH_LIMIT = CHAT_SEARCH_MAX_LIMIT;

/** The search did not come back in time. */
export const CHAT_SEARCH_ERROR_TIMEOUT = "FUSION.Chat.Search.Error.Timeout";
/** The server refused, for any reason it gave. The reason itself stays off the screen. */
export const CHAT_SEARCH_ERROR_FAILED = "FUSION.Chat.Search.Error.Failed";

/**
 * The only two things the panel may render for a failed search — both i18n keys, resolved
 * by `t()` at the view. Widening this to `string` would let server text back onto the
 * screen, which is exactly what it exists to prevent.
 */
export type ChatSearchErrorKey = typeof CHAT_SEARCH_ERROR_TIMEOUT | typeof CHAT_SEARCH_ERROR_FAILED;

/**
 * How long the field waits before asking. Long enough that typing a word is one query
 * instead of six, short enough that the answer still feels like a consequence of typing.
 */
export const CHAT_SEARCH_DEBOUNCE_MS = 220;

const SEARCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export const chatSearch: {
  /** Raw contents of the field. Empty means the live log is on screen. */
  term: string;
  /** Results for the term that is on screen, newest first (server order). */
  results: ChatMessage[];
  loading: boolean;
  /** i18n key, never a message — see {@link ChatSearchErrorKey}. */
  error: ChatSearchErrorKey | null;
  /** Whether the server says there is another page for this term. */
  hasMore: boolean;
  page: number;
} = $state({
  term: "",
  results: [],
  loading: false,
  error: null,
  hasMore: false,
  page: 0,
});

/**
 * True while the results replace the log. Deliberately derived from the term and not
 * from `results.length`: a term with zero hits must show "no results", not the live log
 * (REQ-ACH-011 — the log comes back when the FIELD is cleared, not when a search fails).
 */
export function isChatSearchActive(): boolean {
  return chatSearch.term.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Highlighting (client side — the server returns no snippet or offsets)
// ---------------------------------------------------------------------------

export interface HighlightSegment {
  readonly text: string;
  /** True when this run of characters is the searched term. */
  readonly match: boolean;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split `text` into alternating plain/matched runs so the view can mark the term
 * (REQ-ACH-011) without ever injecting HTML into the message body.
 */
export function highlightTerm(text: string, term: string): HighlightSegment[] {
  const needle = term.trim();
  if (needle.length === 0 || text.length === 0) return [{ text, match: false }];

  const re = new RegExp(escapeRegExp(needle), "gi");
  const segments: HighlightSegment[] = [];
  let last = 0;

  for (const hit of text.matchAll(re)) {
    const at = hit.index;
    if (at > last) segments.push({ text: text.slice(last, at), match: false });
    segments.push({ text: hit[0], match: true });
    last = at + hit[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments.length > 0 ? segments : [{ text, match: false }];
}

/**
 * A short run of the message around the first hit — a result row is one line, and a
 * 4096-character message would otherwise be the whole list.
 */
export function searchSnippet(content: string, term: string, radius = 48): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const needle = term.trim();
  if (needle.length === 0) return flat.slice(0, radius * 2);

  const at = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return flat.slice(0, radius * 2);

  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + needle.length + radius);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

// ---------------------------------------------------------------------------
// Socket
// ---------------------------------------------------------------------------

interface ChatSearchAck {
  ok: boolean;
  message?: string;
  result?: { messages: unknown[]; page: number; hasMore: boolean };
}

function _reqId(): string {
  return `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A failed search, carrying the key the panel will show and — separately — whatever the
 * server actually said, which goes to the console and nowhere else. Splitting the two is
 * the whole point: `ack.message` is an internal code (`CHT_MESSAGE_NOT_FOUND`) or, when
 * the payload fails `ChatSearchRequestSchema`, the raw Zod issue blob.
 */
class ChatSearchFailure extends Error {
  readonly key: ChatSearchErrorKey;

  constructor(key: ChatSearchErrorKey, detail: string) {
    super(detail);
    this.name = "ChatSearchFailure";
    this.key = key;
  }
}

/** `chat:search` is a read, so it travels on the `query` channel. */
function _emitSearch(
  socket: Socket,
  payload: { worldId: string; q: string; limit: number; page: number },
): Promise<{ messages: ChatMessage[]; page: number; hasMore: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ChatSearchFailure(CHAT_SEARCH_ERROR_TIMEOUT, "chat:search ack never arrived"));
    }, SEARCH_TIMEOUT_MS);
    socket.emit(
      "query",
      { type: "chat:search", payload, requestId: _reqId(), ts: Date.now() },
      (ack: ChatSearchAck) => {
        clearTimeout(timer);
        if (ack.ok && ack.result) {
          resolve({
            messages: ack.result.messages as ChatMessage[],
            page: ack.result.page,
            hasMore: ack.result.hasMore,
          });
        } else {
          reject(
            new ChatSearchFailure(CHAT_SEARCH_ERROR_FAILED, ack.message ?? "chat:search refused"),
          );
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

let _seq = 0;
let _debounce: ReturnType<typeof setTimeout> | null = null;

/**
 * Run the query now. Callers that are reacting to typing should use
 * {@link scheduleChatSearch} instead.
 */
export async function runChatSearch(
  socket: Socket,
  worldId: string,
  term: string,
  page = 0,
): Promise<void> {
  const q = term.trim();
  chatSearch.term = term;
  if (q.length === 0) {
    _seq++;
    resetChatSearchResults();
    return;
  }

  const mySeq = ++_seq;
  chatSearch.loading = true;
  chatSearch.error = null;

  try {
    const res = await _emitSearch(socket, { worldId, q, limit: CHAT_SEARCH_LIMIT, page });
    // A newer term (or a cleared field) landed while this was in flight: this answer is
    // about a question nobody is asking any more.
    if (mySeq !== _seq) return;
    chatSearch.results = res.messages;
    chatSearch.page = res.page;
    chatSearch.hasMore = res.hasMore;
  } catch (err) {
    // The detail is for whoever is debugging, not for whoever is reading the chat.
    console.warn("[chatSearch] chat:search failed:", err);
    if (mySeq !== _seq) return;
    chatSearch.error = err instanceof ChatSearchFailure ? err.key : CHAT_SEARCH_ERROR_FAILED;
    chatSearch.results = [];
    chatSearch.hasMore = false;
  } finally {
    if (mySeq === _seq) chatSearch.loading = false;
  }
}

/**
 * Debounced entry point for the field. The term is applied to the state immediately (the
 * field must never lag behind the keyboard); only the query waits.
 */
export function scheduleChatSearch(socket: Socket, worldId: string, term: string): void {
  chatSearch.term = term;
  if (_debounce !== null) clearTimeout(_debounce);

  if (term.trim().length === 0) {
    _debounce = null;
    _seq++;
    resetChatSearchResults();
    return;
  }

  _debounce = setTimeout(() => {
    _debounce = null;
    void runChatSearch(socket, worldId, term);
  }, CHAT_SEARCH_DEBOUNCE_MS);
}

/** Drop the results without touching the term (used when a query is abandoned). */
export function resetChatSearchResults(): void {
  chatSearch.results = [];
  chatSearch.page = 0;
  chatSearch.hasMore = false;
  chatSearch.loading = false;
  chatSearch.error = null;
}

/**
 * Clearing the field gives the live log back (REQ-ACH-011). The log's scroll position is
 * restored by the log itself, which hands it to the session on unmount.
 */
export function clearChatSearch(): void {
  if (_debounce !== null) {
    clearTimeout(_debounce);
    _debounce = null;
  }
  _seq++;
  chatSearch.term = "";
  resetChatSearchResults();
}
