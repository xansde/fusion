/**
 * chatHistoryOrder.test.ts — L3 defect D6 (BHR-F5-07): the history loaded after a reload keeps the log oldest first.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import type { ChatMessage } from "@fusion/shared";
import { chatStore, loadInitialHistory, loadMoreHistory } from "../chatStore.svelte.js";

function msg(id: string, timestamp: number): ChatMessage {
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
  } as ChatMessage;
}

/** A socket whose `chat:history` answers with `messages` (the server sends the newest first). */
function socketAnswering(messages: ChatMessage[], hasMore = false): Socket {
  return {
    emit: (_event: string, _op: unknown, ack: (r: unknown) => void) =>
      ack({ ok: true, result: { messages, hasMore, nextCursor: hasMore ? "c1" : null } }),
  } as unknown as Socket;
}

beforeEach(() => {
  chatStore.messages = [];
  chatStore.loadingInitial = false;
  chatStore.loadingMore = false;
  chatStore.hasMore = false;
  chatStore.nextCursor = null;
});

describe("history load order", () => {
  it("the first page ends up oldest first", async () => {
    await loadInitialHistory(socketAnswering([msg("c", 300), msg("b", 200), msg("a", 100)]), "w1");
    expect(chatStore.messages.map((m) => m._id)).toEqual(["a", "b", "c"]);
  });

  it("an older page goes above the messages already there, still oldest first", async () => {
    await loadInitialHistory(socketAnswering([msg("d", 400), msg("c", 300)], true), "w1");
    await loadMoreHistory(socketAnswering([msg("b", 200), msg("a", 100)]), "w1");
    expect(chatStore.messages.map((m) => m._id)).toEqual(["a", "b", "c", "d"]);
  });
});
