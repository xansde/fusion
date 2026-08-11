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
  extractChatMessagesFromEnvelope,
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

// ---------------------------------------------------------------------------
// Reveal rebroadcast (REQ-CHT-045..047 / DEC-CHT-10)
//
// Revealing re-emits the SAME message through the SAME envelope the original
// broadcast used (`doc:create` + `{ documentType, documents: [msg] }` — see
// broadcastChatMessage in chat-handler.ts). There is no second wire shape to
// teach the client: what changes is the CONTENT of the document, which is
// precisely why the store had to learn to upsert instead of dedupe-and-return.
// ---------------------------------------------------------------------------

/** The same `_id` as a live roll, re-emitted after the GM revealed it. */
function makeRevealedRollMessage(): ChatMessage {
  return makeRollMessage({
    _id: "roll-1",
    whisper: [],
    blind: false,
    revealedAt: 9000,
    revealedBy: "gm-1",
  });
}

describe("reveal rebroadcast — envelope extraction", () => {
  it("extracts the revealed message from the reveal rebroadcast envelope", () => {
    const revealed = makeRevealedRollMessage();
    const extracted = extractChatMessagesFromEnvelope(makeDocCreateEnvelope(revealed));

    expect(extracted).toHaveLength(1);
    expect(extracted[0]?._id).toBe("roll-1");
    expect(extracted[0]?.revealedBy).toBe("gm-1");
    expect(extracted[0]?.whisper).toEqual([]);
  });

  it("feeds the revealed message to the store under the SAME _id as the private one", () => {
    const handleIncomingMessage = vi.fn();
    const getRollAnimator = vi.fn(() => null);
    const handler = createChatOpHandler({ handleIncomingMessage, getRollAnimator });

    const priv = makeRollMessage({ _id: "roll-1", whisper: ["gm-1"], blind: true, rolls: [] });
    handler(makeDocCreateEnvelope(priv));
    handler(makeDocCreateEnvelope(makeRevealedRollMessage()));

    expect(handleIncomingMessage).toHaveBeenCalledTimes(2);
    const [first, second] = handleIncomingMessage.mock.calls.map((c) => c[0] as ChatMessage);
    expect(first?._id).toBe(second?._id);
    expect(second?.revealedAt).toBe(9000);
  });
});

// ---------------------------------------------------------------------------
// 3D dice gate on reveal — DECISION (see chatMessageSync.ts isPubliclyVisibleRoll)
//
// A reveal makes an OLD roll public. Animating the 3D dice again would show the
// whole table a physics animation for dice that stopped rolling minutes ago,
// and a GM revealing a batch of secret rolls would flood the canvas. The audit
// stamp is exactly what distinguishes "a roll just happened" from "an old roll
// became visible", so the gate reads it.
// ---------------------------------------------------------------------------

describe("isPubliclyVisibleRoll — revealed rolls never re-animate the 3D dice", () => {
  it("false for a revealed roll even though it is now public and non-blind", () => {
    const revealed = makeRevealedRollMessage();
    expect(revealed.whisper).toEqual([]);
    expect(revealed.blind).toBe(false);
    expect(isPubliclyVisibleRoll(revealed)).toBe(false);
  });

  it("still true for a fresh public roll (the gate did not become a blanket off-switch)", () => {
    expect(isPubliclyVisibleRoll(makeRollMessage())).toBe(true);
  });

  it("does not call the animator when a reveal rebroadcast arrives", () => {
    const handleIncomingMessage = vi.fn();
    const animator = vi.fn();
    const getRollAnimator = vi.fn(() => animator);
    const handler = createChatOpHandler({ handleIncomingMessage, getRollAnimator });

    handler(makeDocCreateEnvelope(makeRevealedRollMessage()));

    expect(handleIncomingMessage).toHaveBeenCalledTimes(1);
    expect(animator).not.toHaveBeenCalled();
  });
});
