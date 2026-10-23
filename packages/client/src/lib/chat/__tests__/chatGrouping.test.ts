/**
 * chatGrouping.test.ts — pure grouping of nested rolls under a spell-cast card
 * (r18-N1). Covers the parent/child split, orphan degradation, chronological
 * order, and the malformed-flag guard.
 */

import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@fusion/shared";
import {
  canGroupWithPrevious,
  collectContinuations,
  groupChatMessages,
  readParentMessageId,
} from "../chatGrouping.js";

function msg(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    _id: id,
    _stats: {
      createdTime: 1000,
      modifiedTime: 1000,
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
    speaker: { userId: "u1", alias: "A" },
    timestamp: 1000,
    whisper: [],
    blind: false,
    ...overrides,
  };
}

/** A message nested under `parentId`. */
function child(id: string, parentId: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return msg(id, { type: "roll", flags: { fusion: { parentMessageId: parentId } }, ...overrides });
}

describe("readParentMessageId", () => {
  it("reads a valid parent id from flags.fusion.parentMessageId", () => {
    expect(readParentMessageId(child("c1", "p1"))).toBe("p1");
  });

  it("returns null for a message without the flag", () => {
    expect(readParentMessageId(msg("m1"))).toBeNull();
  });

  it("returns null for an empty / non-string parent id (malformed guard)", () => {
    expect(
      readParentMessageId(msg("m1", { flags: { fusion: { parentMessageId: "" } } })),
    ).toBeNull();
    expect(
      readParentMessageId(msg("m1", { flags: { fusion: { parentMessageId: 42 } } as never })),
    ).toBeNull();
  });

  it("ignores a foreign namespace", () => {
    expect(
      readParentMessageId(msg("m1", { flags: { evil: { parentMessageId: "p1" } } })),
    ).toBeNull();
  });
});

describe("groupChatMessages", () => {
  it("keeps a plain message list entirely top-level (compat)", () => {
    const list = [msg("a"), msg("b"), msg("c")];
    const g = groupChatMessages(list);
    expect(g.topLevel.map((m) => m._id)).toEqual(["a", "b", "c"]);
    expect(g.childrenByParent.size).toBe(0);
  });

  it("groups 2 children under a present parent → 1 top-level entry, 2 nested", () => {
    const list = [msg("p1"), child("atk", "p1"), child("dmg", "p1")];
    const g = groupChatMessages(list);
    expect(g.topLevel.map((m) => m._id)).toEqual(["p1"]);
    expect(g.childrenByParent.get("p1")?.map((m) => m._id)).toEqual(["atk", "dmg"]);
  });

  it("preserves chronological order of children (input order)", () => {
    const list = [msg("p1"), child("save-1", "p1"), child("save-2", "p1"), child("save-3", "p1")];
    const g = groupChatMessages(list);
    expect(g.childrenByParent.get("p1")?.map((m) => m._id)).toEqual(["save-1", "save-2", "save-3"]);
  });

  it("degrades an orphan (parent absent from window) to a top-level entry", () => {
    // Parent p0 is NOT in the list — the child must NOT disappear.
    const list = [msg("a"), child("orphan", "p0")];
    const g = groupChatMessages(list);
    expect(g.topLevel.map((m) => m._id)).toEqual(["a", "orphan"]);
    expect(g.childrenByParent.size).toBe(0);
  });

  it("groups only the children whose parent is present; orphans stay loose", () => {
    const list = [msg("p1"), child("atk", "p1"), child("orphan", "missing")];
    const g = groupChatMessages(list);
    expect(g.topLevel.map((m) => m._id)).toEqual(["p1", "orphan"]);
    expect(g.childrenByParent.get("p1")?.map((m) => m._id)).toEqual(["atk"]);
  });

  it("handles multiple parents independently", () => {
    const list = [
      msg("p1"),
      child("p1-atk", "p1"),
      msg("p2"),
      child("p2-save", "p2"),
      child("p1-dmg", "p1"),
    ];
    const g = groupChatMessages(list);
    expect(g.topLevel.map((m) => m._id)).toEqual(["p1", "p2"]);
    expect(g.childrenByParent.get("p1")?.map((m) => m._id)).toEqual(["p1-atk", "p1-dmg"]);
    expect(g.childrenByParent.get("p2")?.map((m) => m._id)).toEqual(["p2-save"]);
  });

  it("does not nest a message under itself even if flags point to its own id", () => {
    // Defensive: a self-referential flag would still be a 'child of present
    // parent' — it lands in the parent's bucket, never in topLevel. This can't
    // happen in practice (an announcement carries no parentMessageId), but the
    // grouping must not crash or loop.
    const self = child("x", "x");
    const g = groupChatMessages([self]);
    expect(g.topLevel).toHaveLength(0);
    expect(g.childrenByParent.get("x")?.map((m) => m._id)).toEqual(["x"]);
  });

  it("returns an empty grouping for an empty list", () => {
    const g = groupChatMessages([]);
    expect(g.topLevel).toEqual([]);
    expect(g.childrenByParent.size).toBe(0);
  });

  it("never drops a message: topLevel + all children === input (unread stays honest)", () => {
    // The unread counter (chatStore.handleIncomingMessage) increments once per
    // incoming message, children INCLUDED — grouping is a render-only view and
    // must not lose anyone. This invariant guards that: every input message
    // lands in exactly one bucket (top-level OR a parent's children), so the
    // count the store tracks always matches what the log ultimately renders.
    const list = [
      msg("p1"),
      child("atk", "p1"),
      child("dmg", "p1"),
      child("s1", "p1"),
      msg("p2"),
      child("orphan", "missing"),
    ];
    const g = groupChatMessages(list);
    const nestedCount = [...g.childrenByParent.values()].reduce((n, c) => n + c.length, 0);
    expect(g.topLevel.length + nestedCount).toBe(list.length);
    // Every id present exactly once across the two buckets.
    const seen = [
      ...g.topLevel.map((m) => m._id),
      ...[...g.childrenByParent.values()].flatMap((c) => c.map((m) => m._id)),
    ].sort();
    expect(seen).toEqual(["atk", "dmg", "orphan", "p1", "p2", "s1"]);
  });
});

// ---------------------------------------------------------------------------
// REQ-ACH-025 — consecutive messages of the same author share one header
// ---------------------------------------------------------------------------

/** A message by `alias` (userId derived from the alias, so authors differ). */
function by(id: string, alias: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return msg(id, { speaker: { userId: `u-${alias}`, alias }, ...overrides });
}

describe("REQ-ACH-025 — author grouping", () => {
  it("continues the previous message when the same author speaks twice in a row", () => {
    const a1 = by("a1", "Ana");
    const a2 = by("a2", "Ana");
    expect(canGroupWithPrevious(a2, a1)).toBe(true);
  });

  it("does not continue when the author changes", () => {
    expect(canGroupWithPrevious(by("b1", "Bruno"), by("a1", "Ana"))).toBe(false);
  });

  it("does not continue when the same user speaks under another alias (NPC voice)", () => {
    const gmAsSelf: ChatMessage = msg("m1", { speaker: { userId: "gm", alias: "Mestre" } });
    const gmAsNpc: ChatMessage = msg("m2", { speaker: { userId: "gm", alias: "Goblin" } });
    expect(canGroupWithPrevious(gmAsNpc, gmAsSelf)).toBe(false);
  });

  it("never groups a card — neither as the continuation nor as the anchor", () => {
    const plain = by("p", "Ana");
    const card = by("c", "Ana", {
      type: "system",
      card: {
        title: "Ataque",
        systemId: "pf2e",
      } as unknown as ChatMessage["card"],
    });
    expect(canGroupWithPrevious(card, plain)).toBe(false);
    expect(canGroupWithPrevious(by("p2", "Ana"), card)).toBe(false);
  });

  it("never groups a spell-cast/ability card riding on a text announcement", () => {
    const plain = by("p", "Ana");
    const abilityCard = by("c", "Ana", { flags: { pf2e: { abilityCard: { kind: "spell" } } } });
    expect(canGroupWithPrevious(abilityCard, plain)).toBe(false);
    expect(canGroupWithPrevious(by("p2", "Ana"), abilityCard)).toBe(false);
  });

  it("never groups a whisper — neither as the continuation nor as the anchor", () => {
    const plain = by("p", "Ana");
    const whisper = by("w", "Ana", { type: "whisper", whisper: ["gm"] });
    expect(canGroupWithPrevious(whisper, plain)).toBe(false);
    expect(canGroupWithPrevious(by("p2", "Ana"), whisper)).toBe(false);
  });

  it("never groups an invalidated message — neither side (REQ-ACH-025 with REQ-CHT-005)", () => {
    const plain = by("p", "Ana");
    // The invalidation flag is written by the server onto the message document
    // (chat:invalidate); it is read structurally, so the message is built the
    // same way here instead of leaning on the schema type.
    const voided = { ...by("v", "Ana"), invalid: true } as ChatMessage;
    expect(canGroupWithPrevious(voided, plain)).toBe(false);
    expect(canGroupWithPrevious(by("p2", "Ana"), voided)).toBe(false);
  });

  it("does not hide a blind badge by grouping under a non-blind header", () => {
    const plain = by("p", "Ana");
    const blind = by("b", "Ana", { blind: true });
    expect(canGroupWithPrevious(blind, plain)).toBe(false);
  });

  it("groups a run and breaks it exactly where the author changes", () => {
    const list = [
      by("a1", "Ana"),
      by("a2", "Ana"),
      by("a3", "Ana"),
      by("b1", "Bruno"),
      by("a4", "Ana"),
    ];
    expect([...collectContinuations(list)].sort()).toEqual(["a2", "a3"]);
  });

  it("resets the run after a card, so the next message keeps its header", () => {
    const list = [
      by("a1", "Ana"),
      by("card", "Ana", { type: "system", card: { title: "x" } as never }),
      by("a2", "Ana"),
      by("a3", "Ana"),
    ];
    expect([...collectContinuations(list)]).toEqual(["a3"]);
  });

  it("groupChatMessages publishes the continuations of the TOP-LEVEL list only", () => {
    // A nested child renders inside its parent's card, never as a log row, so it
    // must not take part in the header run of the log.
    const list = [
      by("p1", "Ana"),
      child("c1", "p1", { speaker: { userId: "u-Ana", alias: "Ana" } }),
      by("p2", "Ana"),
    ];
    const g = groupChatMessages(list);
    expect(g.topLevel.map((m) => m._id)).toEqual(["p1", "p2"]);
    // p1 is a card-less text message and p2 follows it directly at the top level.
    expect([...g.continuations]).toEqual(["p2"]);
  });
});
