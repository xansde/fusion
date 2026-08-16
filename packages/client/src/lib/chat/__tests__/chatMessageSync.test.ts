/**
 * chatMessageSync.test.ts — TDD for BUG #1 (chat reactivity requires tab switch).
 *
 * Reproduces the root cause at the pure-logic level: live "op" broadcasts
 * must be handled independently of any component mount/unmount cycle, and
 * switching tabs must NOT reset the message store.
 *
 * Also covers REQ-ACH-086: invalidation travels as a doc:update of the same
 * message, and the client that filtered the socket on doc:create alone simply
 * never saw it.
 */

import { describe, it, expect, vi } from "vitest";
import type { ChatMessage, Envelope, RollResultData } from "@fusion/shared";
import {
  createChatOpHandler,
  attachChatOpListener,
  extractChatMessageFromEnvelope,
  extractChatMessagesFromEnvelope,
  extractChatMessageUpdatesFromEnvelope,
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

/**
 * Builds the envelope in the REAL wire shape the server broadcasts
 * (chat-handler.ts broadcastChatMessage): batch `documents: [msg]`.
 * The singular `document` key that earlier versions of this suite used was
 * never what the server sent — that mismatch hid the live-sync bug.
 */
function makeDocCreateEnvelope(msg: ChatMessage): Envelope {
  return {
    type: "doc:create",
    ts: Date.now(),
    payload: { documentType: "ChatMessage", documents: [msg] },
  } as unknown as Envelope;
}

/** Legacy singular shape — still accepted for robustness. */
function makeLegacySingularEnvelope(msg: ChatMessage): Envelope {
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

describe("extractChatMessagesFromEnvelope", () => {
  it("extracts messages from the real server broadcast shape (documents: [msg])", () => {
    const msg = makeTextMessage();
    const envelope = makeDocCreateEnvelope(msg);
    expect(extractChatMessagesFromEnvelope(envelope)).toEqual([msg]);
  });

  it("still accepts the legacy singular shape (document: msg)", () => {
    const msg = makeTextMessage();
    const envelope = makeLegacySingularEnvelope(msg);
    expect(extractChatMessagesFromEnvelope(envelope)).toEqual([msg]);
  });

  it("extracts every message from a multi-document batch", () => {
    const a = makeTextMessage({ _id: "a" });
    const b = makeTextMessage({ _id: "b" });
    const envelope = {
      type: "doc:create",
      ts: Date.now(),
      payload: { documentType: "ChatMessage", documents: [a, b] },
    } as unknown as Envelope;
    expect(extractChatMessagesFromEnvelope(envelope)).toEqual([a, b]);
  });

  it("skips malformed entries without an _id", () => {
    const good = makeTextMessage({ _id: "good" });
    const envelope = {
      type: "doc:create",
      ts: Date.now(),
      payload: { documentType: "ChatMessage", documents: [{ nope: true }, good] },
    } as unknown as Envelope;
    expect(extractChatMessagesFromEnvelope(envelope)).toEqual([good]);
  });

  it("returns [] for non doc:create envelopes", () => {
    const envelope = { type: "doc:update", ts: Date.now(), payload: {} } as unknown as Envelope;
    expect(extractChatMessagesFromEnvelope(envelope)).toEqual([]);
  });

  it("returns [] for doc:create of a different document type", () => {
    const envelope = {
      type: "doc:create",
      ts: Date.now(),
      payload: { documentType: "Token", documents: [{ _id: "t1" }] },
    } as unknown as Envelope;
    expect(extractChatMessagesFromEnvelope(envelope)).toEqual([]);
  });
});

describe("extractChatMessageFromEnvelope (back-compat wrapper)", () => {
  it("returns the first message of a batch", () => {
    const msg = makeTextMessage();
    expect(extractChatMessageFromEnvelope(makeDocCreateEnvelope(msg))).toEqual(msg);
  });

  it("returns null for non doc:create envelopes", () => {
    const envelope = { type: "doc:update", ts: Date.now(), payload: {} } as unknown as Envelope;
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
    const handler = createChatOpHandler({
      handleIncomingMessage,
      applyMessageUpdate: vi.fn(),
      getRollAnimator,
    });

    const msg = makeTextMessage();
    handler(makeDocCreateEnvelope(msg));

    expect(handleIncomingMessage).toHaveBeenCalledExactlyOnceWith(msg);
  });

  it("invokes the registered roll animator for a publicly visible roll", () => {
    const handleIncomingMessage = vi.fn();
    const animator = vi.fn();
    const getRollAnimator = vi.fn(() => animator);
    const handler = createChatOpHandler({
      handleIncomingMessage,
      applyMessageUpdate: vi.fn(),
      getRollAnimator,
    });

    const msg = makeRollMessage();
    handler(makeDocCreateEnvelope(msg));

    expect(animator).toHaveBeenCalledExactlyOnceWith(msg.rolls![0]);
  });

  it("does NOT invoke the animator when none is registered (e.g. ChatPanel unmounted)", () => {
    const handleIncomingMessage = vi.fn();
    const getRollAnimator = vi.fn(() => null);
    const handler = createChatOpHandler({
      handleIncomingMessage,
      applyMessageUpdate: vi.fn(),
      getRollAnimator,
    });

    // Should not throw even though no animator is present — message still
    // reaches the store (this is exactly the bug: previously the whole
    // listener died with the component, dropping the message too).
    expect(() => handler(makeDocCreateEnvelope(makeRollMessage()))).not.toThrow();
    expect(handleIncomingMessage).toHaveBeenCalledOnce();
  });

  it("ignores envelopes that carry no ChatMessage at all", () => {
    const handleIncomingMessage = vi.fn();
    const applyMessageUpdate = vi.fn();
    const getRollAnimator = vi.fn(() => null);
    const handler = createChatOpHandler({
      handleIncomingMessage,
      applyMessageUpdate,
      getRollAnimator,
    });

    handler({ type: "doc:update", ts: Date.now(), payload: {} } as unknown as Envelope);
    handler({
      type: "doc:update",
      ts: Date.now(),
      payload: { documentType: "Token", documents: [{ _id: "t1" }] },
    } as unknown as Envelope);

    expect(handleIncomingMessage).not.toHaveBeenCalled();
    expect(applyMessageUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REQ-ACH-086 — an invalidation is an update of the SAME message, and the live
// log has to take it. Filtering the socket on doc:create alone is what made the
// voided message stay intact on screen until a reload.
// ---------------------------------------------------------------------------

/** The shape the server broadcasts for a message that changed (chat-handler.ts). */
function makeDocUpdateEnvelope(msg: ChatMessage): Envelope {
  return {
    type: "doc:update",
    ts: Date.now(),
    payload: { documentType: "ChatMessage", documents: [msg] },
  } as unknown as Envelope;
}

function voided(msg: ChatMessage, by = "gm-1"): ChatMessage {
  return { ...msg, invalid: true, invalidatedBy: by, invalidatedAt: 2000 };
}

describe("REQ-ACH-086 — invalidation reaches the live log as a document update", () => {
  it("extracts the voided message from a doc:update envelope", () => {
    const msg = voided(makeTextMessage());
    expect(extractChatMessageUpdatesFromEnvelope(makeDocUpdateEnvelope(msg))).toEqual([msg]);
  });

  it("does not confuse an update with a creation (each reader takes only its own)", () => {
    const created = makeTextMessage({ _id: "created" });
    const updated = voided(makeTextMessage({ _id: "updated" }));

    expect(extractChatMessagesFromEnvelope(makeDocUpdateEnvelope(updated))).toEqual([]);
    expect(extractChatMessageUpdatesFromEnvelope(makeDocCreateEnvelope(created))).toEqual([]);
  });

  it("routes the update to applyMessageUpdate — never as a new message", () => {
    const handleIncomingMessage = vi.fn();
    const applyMessageUpdate = vi.fn();
    const handler = createChatOpHandler({
      handleIncomingMessage,
      applyMessageUpdate,
      getRollAnimator: () => null,
    });

    const msg = voided(makeTextMessage());
    handler(makeDocUpdateEnvelope(msg));

    expect(applyMessageUpdate).toHaveBeenCalledExactlyOnceWith(msg);
    // Inserting it again would duplicate the row and, worse, bump the unread
    // badge for a message the reader already saw.
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  it("does NOT replay the 3D dice of a roll that was just voided", () => {
    const animator = vi.fn();
    const handler = createChatOpHandler({
      handleIncomingMessage: vi.fn(),
      applyMessageUpdate: vi.fn(),
      getRollAnimator: () => animator,
    });

    handler(makeDocUpdateEnvelope(voided(makeRollMessage())));

    expect(animator).not.toHaveBeenCalled();
  });

  it("carries revalidation the same way (invalid back to false)", () => {
    const applyMessageUpdate = vi.fn();
    const handler = createChatOpHandler({
      handleIncomingMessage: vi.fn(),
      applyMessageUpdate,
      getRollAnimator: () => null,
    });

    // REQ-ACH-084: the record of who invalidated survives the revalidation.
    const restored: ChatMessage = {
      ...makeTextMessage(),
      invalid: false,
      invalidatedBy: "gm-1",
      invalidatedAt: 2000,
    };
    handler(makeDocUpdateEnvelope(restored));

    expect(applyMessageUpdate).toHaveBeenCalledExactlyOnceWith(restored);
  });

  it("delivers the update through a socket attached once for the session", () => {
    const socket = new FakeSocket();
    const applyMessageUpdate = vi.fn();
    const detach = attachChatOpListener(socket, {
      handleIncomingMessage: vi.fn(),
      applyMessageUpdate,
      getRollAnimator: () => null,
    });

    const msg = voided(makeTextMessage());
    socket.emit(makeDocUpdateEnvelope(msg));
    expect(applyMessageUpdate).toHaveBeenCalledExactlyOnceWith(msg);

    detach();
    socket.emit(makeDocUpdateEnvelope(msg));
    expect(applyMessageUpdate).toHaveBeenCalledOnce();
  });
});

describe("attachChatOpListener — simulating tab switch does not lose messages", () => {
  it("keeps receiving messages across a simulated 'tab switch' (listener stays attached)", () => {
    const socket = new FakeSocket();
    const handleIncomingMessage = vi.fn();
    const getRollAnimator = vi.fn(() => null);

    // Attach ONCE, as TableScreen's onMount would (session-scoped, not tab-scoped).
    const detach = attachChatOpListener(socket, {
      handleIncomingMessage,
      applyMessageUpdate: vi.fn(),
      getRollAnimator,
    });

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
