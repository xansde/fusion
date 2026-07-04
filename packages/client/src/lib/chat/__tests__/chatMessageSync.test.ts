/**
 * chatMessageSync.test.ts — TDD for BUG #1 (chat reactivity requires tab switch).
 *
 * Reproduces the root cause at the pure-logic level: live "op" broadcasts
 * must be handled independently of any component mount/unmount cycle, and
 * switching tabs must NOT reset the message store.
 */

import { describe, it, expect, vi } from "vitest";
import type { ChatMessage, Envelope, RollResultData } from "@fusion/shared";
import {
  createChatOpHandler,
  attachChatOpListener,
  extractChatMessageFromEnvelope,
  isPubliclyVisibleRoll,
  type OpEmitter,
} from "../chatMessageSync.js";

function makeTextMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    _id: "msg1",
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

function makeRollMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  const roll: RollResultData = {
    formula: "1d20",
    total: 15,
    terms: [],
    rollMode: "public",
  } as unknown as RollResultData;
  return makeTextMessage({
    type: "roll",
    rolls: [roll],
    ...overrides,
  });
}

function makeDocCreateEnvelope(msg: ChatMessage): Envelope {
  return {
    type: "doc:create",
    ts: Date.now(),
    payload: { documentType: "ChatMessage", document: msg },
  } as unknown as Envelope;
}

class FakeSocket implements OpEmitter {
  private handlers: Array<(envelope: Envelope) => void> = [];
  on(_event: "op", handler: (envelope: Envelope) => void): void {
    this.handlers.push(handler);
  }
  off(_event: "op", handler: (envelope: Envelope) => void): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }
  emit(envelope: Envelope): void {
    for (const h of this.handlers) h(envelope);
  }
  get listenerCount(): number {
    return this.handlers.length;
  }
}

describe("extractChatMessageFromEnvelope", () => {
  it("extracts the ChatMessage from a doc:create envelope", () => {
    const msg = makeTextMessage();
    const envelope = makeDocCreateEnvelope(msg);
    expect(extractChatMessageFromEnvelope(envelope)).toEqual(msg);
  });

  it("returns null for non doc:create envelopes", () => {
    const envelope = { type: "doc:update", ts: Date.now(), payload: {} } as unknown as Envelope;
    expect(extractChatMessageFromEnvelope(envelope)).toBeNull();
  });

  it("returns null for doc:create of a different document type", () => {
    const envelope = {
      type: "doc:create",
      ts: Date.now(),
      payload: { documentType: "Token", document: { _id: "t1" } },
    } as unknown as Envelope;
    expect(extractChatMessageFromEnvelope(envelope)).toBeNull();
  });
});

describe("isPubliclyVisibleRoll", () => {
  it("true for a public, non-blind, non-whispered roll", () => {
    expect(isPubliclyVisibleRoll(makeRollMessage())).toBe(true);
  });

  it("false for a blind roll", () => {
    expect(isPubliclyVisibleRoll(makeRollMessage({ blind: true }))).toBe(false);
  });

  it("false for a whispered roll", () => {
    expect(isPubliclyVisibleRoll(makeRollMessage({ whisper: ["user2"] }))).toBe(false);
  });

  it("false for a plain text message", () => {
    expect(isPubliclyVisibleRoll(makeTextMessage())).toBe(false);
  });
});

describe("createChatOpHandler — live message sync independent of UI mount", () => {
  it("calls handleIncomingMessage for an incoming ChatMessage WITHOUT any component mounted", () => {
    const handleIncomingMessage = vi.fn();
    const getRollAnimator = vi.fn(() => null);
    const handler = createChatOpHandler({ handleIncomingMessage, getRollAnimator });

    const msg = makeTextMessage();
    handler(makeDocCreateEnvelope(msg));

    expect(handleIncomingMessage).toHaveBeenCalledExactlyOnceWith(msg);
  });

  it("invokes the registered roll animator for a publicly visible roll", () => {
    const handleIncomingMessage = vi.fn();
    const animator = vi.fn();
    const getRollAnimator = vi.fn(() => animator);
    const handler = createChatOpHandler({ handleIncomingMessage, getRollAnimator });

    const msg = makeRollMessage();
    handler(makeDocCreateEnvelope(msg));

    expect(animator).toHaveBeenCalledExactlyOnceWith(msg.rolls![0]);
  });

  it("does NOT invoke the animator when none is registered (e.g. ChatPanel unmounted)", () => {
    const handleIncomingMessage = vi.fn();
    const getRollAnimator = vi.fn(() => null);
    const handler = createChatOpHandler({ handleIncomingMessage, getRollAnimator });

    // Should not throw even though no animator is present — message still
    // reaches the store (this is exactly the bug: previously the whole
    // listener died with the component, dropping the message too).
    expect(() => handler(makeDocCreateEnvelope(makeRollMessage()))).not.toThrow();
    expect(handleIncomingMessage).toHaveBeenCalledOnce();
  });

  it("ignores envelopes that are not ChatMessage doc:create", () => {
    const handleIncomingMessage = vi.fn();
    const getRollAnimator = vi.fn(() => null);
    const handler = createChatOpHandler({ handleIncomingMessage, getRollAnimator });

    handler({ type: "doc:update", ts: Date.now(), payload: {} } as unknown as Envelope);
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });
});

describe("attachChatOpListener — simulating tab switch does not lose messages", () => {
  it("keeps receiving messages across a simulated 'tab switch' (listener stays attached)", () => {
    const socket = new FakeSocket();
    const handleIncomingMessage = vi.fn();
    const getRollAnimator = vi.fn(() => null);

    // Attach ONCE, as TableScreen's onMount would (session-scoped, not tab-scoped).
    const detach = attachChatOpListener(socket, { handleIncomingMessage, getRollAnimator });

    // Simulate the user being on another tab (no ChatPanel mounted) and a
    // message arriving — this is exactly the scenario that used to be lost.
    const msgWhileAway = makeTextMessage({ _id: "msg-while-away" });
    socket.emit(makeDocCreateEnvelope(msgWhileAway));
    expect(handleIncomingMessage).toHaveBeenCalledExactlyOnceWith(msgWhileAway);

    // "Switching back" to chat must not detach/reattach the listener, and a
    // second message must still arrive.
    const msgAfterReturn = makeTextMessage({ _id: "msg-after-return" });
    socket.emit(makeDocCreateEnvelope(msgAfterReturn));
    expect(handleIncomingMessage).toHaveBeenCalledTimes(2);
    expect(handleIncomingMessage).toHaveBeenLastCalledWith(msgAfterReturn);

    detach();
    expect(socket.listenerCount).toBe(0);
  });
});
