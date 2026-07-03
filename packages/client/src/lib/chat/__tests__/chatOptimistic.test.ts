/**
 * chatOptimistic.test.ts — unit tests for BUG E's optimistic local echo logic.
 *
 * This is the pure-TS half of the fix (see chatOptimistic.ts's header comment
 * for why it's split out of chatStore.svelte.ts): the client's vitest.config.ts
 * does not run the Svelte preprocessor, so `.svelte.ts` files using `$state`
 * cannot be imported in tests. All the actual send/reconcile/error-handling
 * decision logic lives here instead, fully testable without runes.
 */

import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@fusion/shared";
import {
  isOptimisticallyRenderable,
  buildProvisionalMessage,
  reconcileProvisional,
  removeMessageById,
  LOCAL_ID_PREFIX,
} from "../chatOptimistic.js";

function makeCanonicalMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    _id: "srvMsgAAAAAAAAAA",
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
    content: "Hello there",
    speaker: { userId: "user1", alias: "Alexandre" },
    timestamp: 1000,
    whisper: [],
    blind: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isOptimisticallyRenderable
// ---------------------------------------------------------------------------

describe("isOptimisticallyRenderable", () => {
  it("is true for plain text with no inline rolls", () => {
    expect(isOptimisticallyRenderable("Hello there")).toBe(true);
  });

  it("is false for a /roll command", () => {
    expect(isOptimisticallyRenderable("/roll 1d20+5")).toBe(false);
  });

  it("is false for a /gmroll command", () => {
    expect(isOptimisticallyRenderable("/gmroll 1d20+5")).toBe(false);
  });

  it("is false for a /whisper command", () => {
    expect(isOptimisticallyRenderable("/w [Bob] secret message")).toBe(false);
  });

  it("is false for an /emote command", () => {
    expect(isOptimisticallyRenderable("/em waves")).toBe(false);
  });

  it("is false for an /ic command", () => {
    expect(isOptimisticallyRenderable("/ic Hello, traveler.")).toBe(false);
  });

  it("is false for plain text containing an immediate inline roll expression", () => {
    expect(isOptimisticallyRenderable("I deal [[2d6+3]] damage")).toBe(false);
  });

  it("is false for plain text containing a deferred inline roll expression", () => {
    expect(isOptimisticallyRenderable("Click to roll [[/r 1d20]]")).toBe(false);
  });

  it("is true for empty-ish text with no command prefix", () => {
    expect(isOptimisticallyRenderable("gg")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildProvisionalMessage
// ---------------------------------------------------------------------------

describe("buildProvisionalMessage", () => {
  it("builds a text message with a local- prefixed id", () => {
    const msg = buildProvisionalMessage("Hi!", { userId: "user1", alias: "Alexandre" });
    expect(msg._id.startsWith(LOCAL_ID_PREFIX)).toBe(true);
    expect(msg.type).toBe("text");
    expect(msg.content).toBe("Hi!");
    expect(msg.speaker).toEqual({ userId: "user1", alias: "Alexandre" });
  });

  it("stamps _stats.createdBy/lastModifiedBy with the speaker's userId", () => {
    const msg = buildProvisionalMessage("Hi!", { userId: "user1", alias: "Alexandre" });
    expect(msg._stats.createdBy).toBe("user1");
    expect(msg._stats.lastModifiedBy).toBe("user1");
  });

  it("generates a distinct id on every call", () => {
    const a = buildProvisionalMessage("Hi!", { userId: "u1", alias: "A" });
    const b = buildProvisionalMessage("Hi!", { userId: "u1", alias: "A" });
    expect(a._id).not.toBe(b._id);
  });

  it("is public (whisper empty, blind false)", () => {
    const msg = buildProvisionalMessage("Hi!", { userId: "u1", alias: "A" });
    expect(msg.whisper).toEqual([]);
    expect(msg.blind).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reconcileProvisional
// ---------------------------------------------------------------------------

describe("reconcileProvisional", () => {
  it("replaces the provisional entry with the canonical message in place", () => {
    const provisional = buildProvisionalMessage("Hi!", { userId: "u1", alias: "A" });
    const messages: ChatMessage[] = [provisional];
    const canonical = makeCanonicalMessage({ _id: "srvMsgBBBBBBBBBB" });

    reconcileProvisional(messages, provisional._id, canonical);

    expect(messages).toHaveLength(1);
    expect(messages[0]!._id).toBe("srvMsgBBBBBBBBBB");
  });

  it("preserves array position when reconciling among other messages", () => {
    const provisional = buildProvisionalMessage("Hi!", { userId: "u1", alias: "A" });
    const before = makeCanonicalMessage({ _id: "beforeAAAAAAAAAA", timestamp: 500 });
    const messages: ChatMessage[] = [before, provisional];
    const canonical = makeCanonicalMessage({ _id: "srvMsgCCCCCCCCCC", timestamp: 1500 });

    reconcileProvisional(messages, provisional._id, canonical);

    expect(messages.map((m) => m._id)).toEqual(["beforeAAAAAAAAAA", "srvMsgCCCCCCCCCC"]);
  });

  it("is a no-op when the provisional id is not found", () => {
    const messages: ChatMessage[] = [makeCanonicalMessage({ _id: "existingAAAAAAAA" })];
    const canonical = makeCanonicalMessage({ _id: "srvMsgDDDDDDDDDD" });

    reconcileProvisional(messages, "local-doesnotexist", canonical);

    expect(messages).toHaveLength(1);
    expect(messages[0]!._id).toBe("existingAAAAAAAA");
  });

  it("drops the provisional without duplicating when the canonical id is already present (broadcast race)", () => {
    const provisional = buildProvisionalMessage("Hi!", { userId: "u1", alias: "A" });
    const canonical = makeCanonicalMessage({ _id: "srvMsgEEEEEEEEEE" });
    const messages: ChatMessage[] = [provisional, canonical];

    reconcileProvisional(messages, provisional._id, canonical);

    expect(messages).toHaveLength(1);
    expect(messages[0]!._id).toBe("srvMsgEEEEEEEEEE");
  });
});

// ---------------------------------------------------------------------------
// removeMessageById
// ---------------------------------------------------------------------------

describe("removeMessageById", () => {
  it("removes the message with the matching id", () => {
    const provisional = buildProvisionalMessage("Hi!", { userId: "u1", alias: "A" });
    const messages: ChatMessage[] = [provisional];

    removeMessageById(messages, provisional._id);

    expect(messages).toHaveLength(0);
  });

  it("is a no-op when the id is not found", () => {
    const existing = makeCanonicalMessage({ _id: "existingAAAAAAAA" });
    const messages: ChatMessage[] = [existing];

    removeMessageById(messages, "local-doesnotexist");

    expect(messages).toHaveLength(1);
  });
});
