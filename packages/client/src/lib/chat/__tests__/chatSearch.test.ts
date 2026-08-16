/**
 * chatSearch.test.ts — the top bar's search, from the client side (plan G033).
 *
 * Covers REQ-ACH-010 (the field is the bar, for every role), REQ-ACH-011 (typing queries
 * the SERVER and the results replace the log, with the term marked; clearing gives the log
 * back) and REQ-ACH-012 (the client never filters — the server owns visibility).
 *
 * The socket is a stub that records envelopes: what matters here is WHICH channel and
 * WHICH envelope the field puts on the wire, not what the server does with it (that is
 * `packages/server/src/__tests__/chat-search.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_SEARCH_DEBOUNCE_MS,
  CHAT_SEARCH_LIMIT,
  chatSearch,
  clearChatSearch,
  highlightTerm,
  isChatSearchActive,
  runChatSearch,
  scheduleChatSearch,
  searchSnippet,
} from "../chatSearch.svelte.js";

import type { Socket } from "socket.io-client";
import type { ChatMessage } from "@fusion/shared";

interface Recorded {
  event: string;
  envelope: { type: string; payload: Record<string, unknown> };
}

function makeMessage(id: string, content: string): ChatMessage {
  return {
    _id: id,
    content,
    type: "ic",
    speaker: { userId: "u1", alias: "Tobias" },
    timestamp: 1_700_000_000_000,
    whisper: [],
    blind: false,
  } as unknown as ChatMessage;
}

/** Socket stub: records every emit and answers with whatever the test queued. */
function makeSocket(answer: (payload: Record<string, unknown>) => unknown): {
  socket: Socket;
  sent: Recorded[];
} {
  const sent: Recorded[] = [];
  const socket = {
    emit: (event: string, envelope: Recorded["envelope"], ack: (res: unknown) => void): void => {
      sent.push({ event, envelope });
      ack(answer(envelope.payload));
    },
  } as unknown as Socket;
  return { socket, sent };
}

beforeEach(() => {
  clearChatSearch();
});

afterEach(() => {
  vi.useRealTimers();
  clearChatSearch();
});

describe("a barra pesquisa no servidor (REQ-ACH-010, REQ-ACH-011)", () => {
  it("puts a chat:search envelope on the query channel, not on op", async () => {
    const { socket, sent } = makeSocket(() => ({
      ok: true,
      result: { messages: [makeMessage("m1", "a porta secreta")], page: 0, hasMore: false },
    }));

    await runChatSearch(socket, "world-1", "porta");

    expect(sent).toHaveLength(1);
    // A read travels on `query`; putting it on `op` would lie about what it does.
    expect(sent[0]?.event).toBe("query");
    expect(sent[0]?.envelope.type).toBe("chat:search");
    expect(sent[0]?.envelope.payload).toMatchObject({
      worldId: "world-1",
      q: "porta",
      limit: CHAT_SEARCH_LIMIT,
      page: 0,
    });
  });

  it("shows exactly what the server returned, in the order it returned (REQ-ACH-012)", async () => {
    // Two of these would be invisible to this user; the server already dropped them. The
    // client keeps every row it is given — a second filter here would be a second
    // visibility rule, which the spec forbids.
    const { socket } = makeSocket(() => ({
      ok: true,
      result: {
        messages: [makeMessage("m3", "porta 3"), makeMessage("m1", "porta 1")],
        page: 0,
        hasMore: true,
      },
    }));

    await runChatSearch(socket, "world-1", "porta");

    expect(chatSearch.results.map((m) => m._id)).toEqual(["m3", "m1"]);
    expect(chatSearch.hasMore).toBe(true);
    expect(chatSearch.error).toBeNull();
  });

  it("surfaces a refusal instead of pretending there were no hits", async () => {
    const { socket } = makeSocket(() => ({ ok: false, message: "VALIDATION_FAILED" }));

    await runChatSearch(socket, "world-1", "porta");

    expect(chatSearch.error).toBe("VALIDATION_FAILED");
    expect(chatSearch.results).toEqual([]);
    // The field still holds the term, so the log does NOT come back under a failure —
    // only clearing the field does that (REQ-ACH-011).
    expect(isChatSearchActive()).toBe(true);
  });

  it("lets a stale answer lose to the newer term", async () => {
    const answers = new Map<string, ChatMessage[]>([
      ["velho", [makeMessage("old", "resultado velho")]],
      ["novo", [makeMessage("new", "resultado novo")]],
    ]);
    const pending: Array<() => void> = [];
    const socket = {
      emit: (
        _event: string,
        envelope: { payload: { q: string } },
        ack: (res: unknown) => void,
      ): void => {
        const q = envelope.payload.q;
        pending.push(() => {
          ack({ ok: true, result: { messages: answers.get(q) ?? [], page: 0, hasMore: false } });
        });
      },
    } as unknown as Socket;

    const first = runChatSearch(socket, "world-1", "velho");
    const second = runChatSearch(socket, "world-1", "novo");
    // The newer question is answered first; the older answer lands afterwards and must
    // not overwrite it.
    pending[1]?.();
    pending[0]?.();
    await Promise.all([first, second]);

    expect(chatSearch.results.map((m) => m._id)).toEqual(["new"]);
  });
});

describe("limpar o campo devolve o log ao vivo (REQ-ACH-011)", () => {
  it("is active while the field holds a term and inactive once it is cleared", async () => {
    const { socket } = makeSocket(() => ({
      ok: true,
      result: { messages: [makeMessage("m1", "porta")], page: 0, hasMore: false },
    }));

    expect(isChatSearchActive()).toBe(false);
    await runChatSearch(socket, "world-1", "porta");
    expect(isChatSearchActive()).toBe(true);

    clearChatSearch();

    expect(isChatSearchActive()).toBe(false);
    expect(chatSearch.term).toBe("");
    expect(chatSearch.results).toEqual([]);
  });

  it("stays on the results when the term finds nothing — empty is an answer", async () => {
    const { socket } = makeSocket(() => ({
      ok: true,
      result: { messages: [], page: 0, hasMore: false },
    }));

    await runChatSearch(socket, "world-1", "nada disso");

    expect(isChatSearchActive()).toBe(true);
    expect(chatSearch.results).toEqual([]);
  });

  it("asks nothing when the field is emptied by typing", async () => {
    const { socket, sent } = makeSocket(() => ({
      ok: true,
      result: { messages: [], page: 0, hasMore: false },
    }));

    await runChatSearch(socket, "world-1", "   ");

    expect(sent).toHaveLength(0);
    expect(isChatSearchActive()).toBe(false);
  });
});

describe("o campo não pergunta a cada tecla", () => {
  it("collapses a burst of keystrokes into one query", () => {
    vi.useFakeTimers();
    const { socket, sent } = makeSocket(() => ({
      ok: true,
      result: { messages: [], page: 0, hasMore: false },
    }));

    scheduleChatSearch(socket, "world-1", "p");
    scheduleChatSearch(socket, "world-1", "po");
    scheduleChatSearch(socket, "world-1", "por");
    // The field itself never lags behind the keyboard.
    expect(chatSearch.term).toBe("por");
    expect(sent).toHaveLength(0);

    vi.advanceTimersByTime(CHAT_SEARCH_DEBOUNCE_MS);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.envelope.payload["q"]).toBe("por");
  });

  it("cancels the pending query when the field is emptied", () => {
    vi.useFakeTimers();
    const { socket, sent } = makeSocket(() => ({
      ok: true,
      result: { messages: [], page: 0, hasMore: false },
    }));

    scheduleChatSearch(socket, "world-1", "por");
    scheduleChatSearch(socket, "world-1", "");
    vi.advanceTimersByTime(CHAT_SEARCH_DEBOUNCE_MS * 2);

    expect(sent).toHaveLength(0);
    expect(isChatSearchActive()).toBe(false);
  });
});

describe("o termo aparece marcado no resultado (REQ-ACH-011)", () => {
  it("splits the text into plain and matched runs, case-insensitively", () => {
    expect(highlightTerm("A Porta secreta da porta", "porta")).toEqual([
      { text: "A ", match: false },
      { text: "Porta", match: true },
      { text: " secreta da ", match: false },
      { text: "porta", match: true },
    ]);
  });

  it("treats the term as text, not as a pattern", () => {
    // A user typing "1d20+5" must not blow up the highlighter or match everything.
    expect(highlightTerm("rolou 1d20+5 agora", "1d20+5")).toEqual([
      { text: "rolou ", match: false },
      { text: "1d20+5", match: true },
      { text: " agora", match: false },
    ]);
    expect(highlightTerm("nada aqui", "(")).toEqual([{ text: "nada aqui", match: false }]);
  });

  it("returns the whole text as one plain run when there is no term", () => {
    expect(highlightTerm("qualquer coisa", "")).toEqual([{ text: "qualquer coisa", match: false }]);
  });

  it("cuts a snippet around the first hit instead of the whole message", () => {
    const long = `${"a".repeat(200)} tesouro ${"b".repeat(200)}`;
    const snippet = searchSnippet(long, "tesouro");
    expect(snippet).toContain("tesouro");
    expect(snippet.length).toBeLessThan(long.length);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });
});
