/**
 * chatStoreUpsert.test.ts — the store must ACCEPT an updated message.
 *
 * REQ-CHT-046: the revealed message has to reach the table through the live
 * broadcast AND through history. The server re-emits the SAME `_id` (DEC-CHT-10
 * makes revealing a mutation of the existing document, not a new message), so a
 * store that dedupes by `_id` and returns leaves the screen frozen on the
 * private version: the server is right and the table sees nothing.
 *
 * This is the exact failure mode the Etmos conjuração card already suffers, so
 * these tests are a catraca on the store, not only on the reveal feature.
 *
 * Ordering is asserted too: an update must NOT move the row. A revealed roll
 * jumping to the bottom of the log would read as a brand-new roll.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Socket } from "socket.io-client";
import type { ChatMessage, RollResultData } from "@fusion/shared";
import {
  chatStore,
  handleIncomingMessage,
  loadInitialHistory,
  setChatTabVisible,
} from "../chatStore.svelte.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    _id: "msg-1",
    _stats: {
      createdTime: 1000,
      modifiedTime: 1000,
      version: 1,
      lastModifiedBy: "user1",
      createdBy: "user1",
      coreVersion: "0.1.0",
      systemId: null,
      systemVersion: null,
      engineSchemaVersion: 1,
      systemSchemaVersion: null,
    },
    sort: 0,
    ownership: { default: 0 },
    flags: {},
    type: "text",
    worldId: "world1",
    content: "hello",
    speaker: { userId: "user1", alias: "Alice" },
    timestamp: 1000,
    whisper: [],
    blind: false,
    ...overrides,
  };
}

const secretRoll = {
  formula: "1d20",
  total: 17,
  terms: [],
  rollMode: "blindroll",
} as unknown as RollResultData;

/** What a blindroll author sees before the reveal: no rolls, substitute text. */
function blindPlaceholder(): ChatMessage {
  return makeMessage({
    _id: "roll-1",
    type: "roll",
    timestamp: 2000,
    whisper: ["gm-1"],
    blind: true,
    content: "(Você realizou uma rolagem cega — somente o GM pode ver o resultado.)",
  });
}

/** The same `_id` after the GM revealed it: public, with the real result. */
function revealedRoll(): ChatMessage {
  return makeMessage({
    _id: "roll-1",
    type: "roll",
    timestamp: 2000,
    whisper: [],
    blind: false,
    content: "",
    rolls: [secretRoll],
    revealedAt: 9000,
    revealedBy: "gm-1",
  });
}

beforeEach(() => {
  chatStore.messages = [];
  chatStore.unreadCount = 0;
  setChatTabVisible(true);
});

// ---------------------------------------------------------------------------
// Upsert — the bug the feature invites
// ---------------------------------------------------------------------------

describe("handleIncomingMessage — upsert by _id (REQ-CHT-046 / DEC-CHT-10)", () => {
  it("replaces the private message with the revealed one instead of dropping it", () => {
    handleIncomingMessage(blindPlaceholder());
    handleIncomingMessage(revealedRoll());

    expect(chatStore.messages).toHaveLength(1);
    const shown = chatStore.messages[0];
    expect(shown?.rolls?.[0]?.total).toBe(17);
    expect(shown?.blind).toBe(false);
    expect(shown?.whisper).toEqual([]);
    expect(shown?.revealedBy).toBe("gm-1");
  });

  it("does not duplicate an identical re-delivery", () => {
    const msg = makeMessage();
    handleIncomingMessage(msg);
    handleIncomingMessage({ ...msg });

    expect(chatStore.messages).toHaveLength(1);
    expect(chatStore.messages[0]?.content).toBe("hello");
  });

  it("keeps the revealed message in its original position — no jump to the bottom", () => {
    handleIncomingMessage(makeMessage({ _id: "a", timestamp: 1000 }));
    handleIncomingMessage(blindPlaceholder()); // timestamp 2000
    handleIncomingMessage(makeMessage({ _id: "c", timestamp: 3000 }));

    handleIncomingMessage(revealedRoll());

    expect(chatStore.messages.map((m) => m._id)).toEqual(["a", "roll-1", "c"]);
  });

  it("still inserts a brand-new message in timestamp order", () => {
    handleIncomingMessage(makeMessage({ _id: "c", timestamp: 3000 }));
    handleIncomingMessage(makeMessage({ _id: "a", timestamp: 1000 }));
    handleIncomingMessage(makeMessage({ _id: "b", timestamp: 2000 }));

    expect(chatStore.messages.map((m) => m._id)).toEqual(["a", "b", "c"]);
  });

  it("does not resurrect a message that was never in the store", () => {
    handleIncomingMessage(revealedRoll());
    expect(chatStore.messages).toHaveLength(1);
    expect(chatStore.messages[0]?._id).toBe("roll-1");
  });
});

// ---------------------------------------------------------------------------
// History (the F5) must agree with the live broadcast — REQ-CHT-046
//
// The store has TWO write paths: insertMessage (live op) and prependMessages
// (chat:history). Fixing only the first leaves the reload showing whichever
// version the store happened to hold first, which is exactly the disagreement
// REQ-CHT-046 forbids.
// ---------------------------------------------------------------------------

/** Minimal socket stub: answers a `chat:history` op with the given messages. */
function historySocket(messages: ChatMessage[]): Socket {
  return {
    emit: (
      _event: string,
      _envelope: unknown,
      ack: (res: {
        ok: boolean;
        result: { messages: ChatMessage[]; nextCursor: string | null; hasMore: boolean };
      }) => void,
    ) => {
      ack({ ok: true, result: { messages, nextCursor: null, hasMore: false } });
    },
  } as unknown as Socket;
}

describe("loadInitialHistory — history overwrites the stale private copy", () => {
  it("replaces a message the store still holds in its private form", async () => {
    handleIncomingMessage(blindPlaceholder());

    await loadInitialHistory(historySocket([revealedRoll()]), "world1");

    expect(chatStore.messages).toHaveLength(1);
    expect(chatStore.messages[0]?.rolls?.[0]?.total).toBe(17);
    expect(chatStore.messages[0]?.revealedBy).toBe("gm-1");
    expect(chatStore.error).toBeNull();
  });

  it("merges a page of history in timestamp order, oldest first", async () => {
    // The server answers newest-first (`ORDER BY timestamp DESC`), and the
    // store is documented — and consumed by chatGrouping, which does not
    // re-sort — as oldest-first. A page that lands reversed puts the whole
    // reloaded log upside down, revealed message included.
    handleIncomingMessage(makeMessage({ _id: "recent", timestamp: 5000 }));

    await loadInitialHistory(
      historySocket([revealedRoll(), makeMessage({ _id: "older", timestamp: 1000 })]),
      "world1",
    );

    expect(chatStore.messages.map((m) => m._id)).toEqual(["older", "roll-1", "recent"]);
  });
});

// ---------------------------------------------------------------------------
// The optimistic echo must survive the upsert
// ---------------------------------------------------------------------------

describe("optimistic echo is not broken by the upsert path", () => {
  it("a provisional local echo and its canonical message stay distinct rows", () => {
    // The provisional carries a `local-` id, the canonical a server id — the
    // upsert keys on `_id`, so it must NOT swallow one into the other. The
    // swap is reconcileProvisional's job (ack path), not the broadcast's.
    handleIncomingMessage(makeMessage({ _id: "local-xyz", timestamp: 1000 }));
    handleIncomingMessage(makeMessage({ _id: "server-1", timestamp: 1000 }));

    expect(chatStore.messages.map((m) => m._id)).toEqual(["local-xyz", "server-1"]);
  });
});
