/**
 * chatGrouping.test.ts — pure grouping of nested rolls under a spell-cast card
 * (r18-N1). Covers the parent/child split, orphan degradation, chronological
 * order, and the malformed-flag guard.
 */

import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@fusion/shared";
import { groupChatMessages, readParentMessageId } from "../chatGrouping.js";

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
