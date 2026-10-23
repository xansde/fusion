/**
 * chatInvalidation.test.ts — the voided message stays where it was.
 *
 * Covers the client half of REQ-ACH-081 (same position in the log, and the
 * record of who voided it) and REQ-ACH-086 (the update propagates to the live
 * log, not only to a reload), plus REQ-ACH-084 (the record survives a
 * revalidation).
 *
 * The store is exercised through the very handler the socket calls
 * (`createChatOpHandler`), so what is proved here is the whole path from wire
 * envelope to the array the log renders — the seam where the bug lived.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { chatStore, applyMessageUpdate, handleIncomingMessage } from "../chatStore.svelte.js";
import { createChatOpHandler } from "../chatMessageSync.js";
import { resolveInvalidatorLabel } from "../invalidationDisplay.js";

import type { ChatMessage, Envelope } from "@fusion/shared";

function makeMessage(
  id: string,
  timestamp: number,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    _id: id,
    _stats: {
      createdTime: timestamp,
      modifiedTime: timestamp,
      version: 1,
      lastModifiedBy: "u1",
      createdBy: "u1",
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
    worldId: "w1",
    content: id,
    speaker: { userId: "u1", alias: "Ana" },
    timestamp,
    whisper: [],
    blind: false,
    ...overrides,
  };
}

function updateEnvelope(msg: ChatMessage): Envelope {
  return {
    type: "doc:update",
    ts: Date.now(),
    payload: { documentType: "ChatMessage", documents: [msg] },
  } as unknown as Envelope;
}

const handler = createChatOpHandler({
  handleIncomingMessage,
  applyMessageUpdate,
  getRollAnimator: () => null,
});

beforeEach(() => {
  chatStore.messages = [];
  chatStore.unreadCount = 0;
  chatStore.unreadMarker = null;
});

describe("REQ-ACH-081 — an invalidated message keeps its place in the log", () => {
  it("replaces the message at the same index, without moving it to the end", () => {
    for (const m of [makeMessage("a", 1000), makeMessage("b", 2000), makeMessage("c", 3000)]) {
      handleIncomingMessage(m);
    }

    handler(updateEnvelope({ ...makeMessage("b", 2000), invalid: true, invalidatedBy: "gm-1" }));

    expect(chatStore.messages.map((m) => m._id)).toEqual(["a", "b", "c"]);
    expect(chatStore.messages[1]?.invalid).toBe(true);
    expect(chatStore.messages[1]?.invalidatedBy).toBe("gm-1");
  });

  it("does not duplicate the row and does not drop any other message", () => {
    handleIncomingMessage(makeMessage("a", 1000));
    handleIncomingMessage(makeMessage("b", 2000));

    handler(updateEnvelope({ ...makeMessage("a", 1000), invalid: true, invalidatedBy: "u1" }));

    expect(chatStore.messages).toHaveLength(2);
    expect(chatStore.messages.filter((m) => m._id === "a")).toHaveLength(1);
  });

  it("names whoever voided it, falling back to the raw id when unknown", () => {
    const msg = makeMessage("a", 1000, { invalid: true, invalidatedBy: "gm-1" });
    expect(resolveInvalidatorLabel(msg, [{ userId: "gm-1", userName: "Mestra Iris" }])).toBe(
      "Mestra Iris",
    );
    expect(resolveInvalidatorLabel(msg, [])).toBe("gm-1");
    expect(resolveInvalidatorLabel(makeMessage("b", 1000), [])).toBeNull();
  });
});

describe("REQ-ACH-086 — the invalidation propagates to the live log", () => {
  it("changes the message the log is already showing, with no reload involved", () => {
    handleIncomingMessage(makeMessage("a", 1000));
    expect(chatStore.messages[0]?.invalid).toBeUndefined();

    handler(updateEnvelope({ ...makeMessage("a", 1000), invalid: true, invalidatedBy: "gm-1" }));

    expect(chatStore.messages[0]?.invalid).toBe(true);
  });

  it("does not count as an unread message — it is not a new message", () => {
    handleIncomingMessage(makeMessage("a", 1000));
    const unreadBefore = chatStore.unreadCount;

    handler(updateEnvelope({ ...makeMessage("a", 1000), invalid: true, invalidatedBy: "gm-1" }));

    expect(chatStore.unreadCount).toBe(unreadBefore);
  });

  it("ignores an update for a message this client never loaded", () => {
    handleIncomingMessage(makeMessage("a", 1000));

    handler(
      updateEnvelope({ ...makeMessage("ghost", 5000), invalid: true, invalidatedBy: "gm-1" }),
    );

    // Materialising it here would show a message that was never delivered to
    // this user in the first place (REQ-ACH-091 keeps one visibility rule).
    expect(chatStore.messages.map((m) => m._id)).toEqual(["a"]);
  });

  it("carries the revalidation back, keeping the record of who had voided it", () => {
    handleIncomingMessage(makeMessage("a", 1000));
    handler(updateEnvelope({ ...makeMessage("a", 1000), invalid: true, invalidatedBy: "gm-1" }));

    // REQ-ACH-084: `invalidatedBy` survives as the history of the operation.
    handler(
      updateEnvelope({
        ...makeMessage("a", 1000),
        invalid: false,
        invalidatedBy: "gm-1",
        invalidatedAt: 2000,
      }),
    );

    expect(chatStore.messages[0]?.invalid).toBe(false);
    expect(chatStore.messages[0]?.invalidatedBy).toBe("gm-1");
  });
});
