/**
 * DocumentMirror unit tests.
 *
 * Tests: seq ordering, duplicate discard, gap detection, boot buffer, snapshot apply.
 * No PIXI, no socket.io — pure module tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentMirror } from "../DocumentMirror.js";
import type { Envelope, WorldSnapshotPayload } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOp(
  type: "doc:create" | "doc:update" | "doc:delete" | "token:move",
  seq: number,
  payload: unknown = {},
): Envelope<unknown> {
  return { type, seq, ts: Date.now(), payload };
}

/**
 * Build a doc:create broadcast envelope.
 * Shape: { documentType, documents: [...] } — matches the server broadcast contract.
 */
function makeCreateOp(
  seq: number,
  docType: string,
  docs: Array<{ _id: string; [key: string]: unknown }>,
): Envelope<unknown> {
  return {
    type: "doc:create",
    seq,
    ts: Date.now(),
    payload: { documentType: docType, documents: docs },
  };
}

/**
 * Build a doc:update broadcast envelope.
 * Shape: { documentType, documents: [...] } — server sends COMPLETE post-merge docs.
 * For tests that previously tested diff application, pass the expected final state.
 */
function makeUpdateOp(
  seq: number,
  docType: string,
  doc: { _id: string; [key: string]: unknown },
): Envelope<unknown> {
  return {
    type: "doc:update",
    seq,
    ts: Date.now(),
    payload: { documentType: docType, documents: [doc] },
  };
}

function makeDeleteOp(seq: number, docType: string, ids: string[]): Envelope<unknown> {
  return {
    type: "doc:delete",
    seq,
    ts: Date.now(),
    payload: { documentType: docType, ids },
  };
}

function makeSnapshot(
  seq: number,
  docs: Record<string, unknown[]> = {},
  activeSceneId: string | null = null,
): WorldSnapshotPayload {
  return { seq, activeSceneId, documents: docs };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

describe("DocumentMirror — snapshot", () => {
  let mirror: DocumentMirror;

  beforeEach(() => {
    mirror = new DocumentMirror();
  });

  it("starts in booting state with seq -1", () => {
    expect(mirror.booting).toBe(true);
    expect(mirror.seq).toBe(-1);
  });

  it("applies a snapshot and leaves boot phase", () => {
    mirror.applySnapshot(
      makeSnapshot(42, {
        Scene: [{ _id: "abcdefghij012345", name: "Test Scene" }],
      }),
    );
    expect(mirror.booting).toBe(false);
    expect(mirror.seq).toBe(42);
  });

  it("populates documents from snapshot", () => {
    mirror.applySnapshot(
      makeSnapshot(10, {
        Scene: [{ _id: "abcdefghij012345", name: "Scene A" }],
        Actor: [{ _id: "1234567890abcdef", name: "Hero" }],
      }),
    );
    expect(mirror.getByType("Scene")).toHaveLength(1);
    expect(mirror.getByType("Actor")).toHaveLength(1);
    expect(mirror.getDoc("Scene", "abcdefghij012345")).toMatchObject({ name: "Scene A" });
  });

  it("replaces previous state on second snapshot", () => {
    mirror.applySnapshot(
      makeSnapshot(5, {
        Scene: [{ _id: "aaaaaaaaaaaaaaaa", name: "Old" }],
      }),
    );
    mirror.applySnapshot(
      makeSnapshot(10, {
        Scene: [{ _id: "bbbbbbbbbbbbbbbb", name: "New" }],
      }),
    );
    expect(mirror.getByType("Scene")).toHaveLength(1);
    expect(mirror.getDoc("Scene", "aaaaaaaaaaaaaaaa")).toBeUndefined();
    expect(mirror.getDoc("Scene", "bbbbbbbbbbbbbbbb")).toMatchObject({ name: "New" });
  });
});

// ---------------------------------------------------------------------------
// Strict seq ordering
// ---------------------------------------------------------------------------

describe("DocumentMirror — seq ordering", () => {
  let mirror: DocumentMirror;

  beforeEach(() => {
    // Apply snapshot at seq 0 to leave boot phase
    mirror = new DocumentMirror();
    mirror.applySnapshot(makeSnapshot(0));
  });

  it("accepts op with seq = currentSeq + 1", () => {
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "1234567890abcdef", name: "A" }]));
    expect(mirror.seq).toBe(1);
    expect(mirror.getByType("Actor")).toHaveLength(1);
  });

  it("discards op with seq <= currentSeq (duplicate)", () => {
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "1234567890abcdef", name: "A" }]));
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "aaaaaaaaaaaaaaa2", name: "B" }]));
    expect(mirror.seq).toBe(1);
    // Second op was discarded; only first doc present
    expect(mirror.getByType("Actor")).toHaveLength(1);
  });

  it("discards op with seq < currentSeq", () => {
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "1234567890abcdef", name: "A" }]));
    mirror.feedOp(makeCreateOp(2, "Actor", [{ _id: "aaaaaaaaaaaaaaa2", name: "B" }]));
    // Try to inject old op at seq 0 (already applied)
    mirror.feedOp(makeCreateOp(0, "Actor", [{ _id: "cccccccccccccccc", name: "Old" }]));
    expect(mirror.seq).toBe(2);
    expect(mirror.getDoc("Actor", "cccccccccccccccc")).toBeUndefined();
  });

  it("accepts ops in order", () => {
    for (let seq = 1; seq <= 5; seq++) {
      mirror.feedOp(makeOp("token:move", seq));
    }
    expect(mirror.seq).toBe(5);
  });

  it("ops without seq are ignored", () => {
    const op: Envelope<unknown> = { type: "token:move", ts: Date.now(), payload: {} };
    mirror.feedOp(op);
    expect(mirror.seq).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

describe("DocumentMirror — gap detection", () => {
  let mirror: DocumentMirror;

  beforeEach(() => {
    mirror = new DocumentMirror();
    mirror.applySnapshot(makeSnapshot(0));
  });

  it("fires gap listener when seq jumps > 1", () => {
    const gapCb = vi.fn();
    mirror.onGap(gapCb);

    mirror.feedOp(makeOp("token:move", 3)); // gap: expected 1, got 3

    expect(gapCb).toHaveBeenCalledOnce();
    expect(gapCb).toHaveBeenCalledWith(1, 3);
  });

  it("discards the gapped op (does not advance seq)", () => {
    mirror.onGap(() => {});
    mirror.feedOp(makeOp("token:move", 5));
    expect(mirror.seq).toBe(0); // not advanced
  });

  it("does not fire gap for contiguous ops", () => {
    const gapCb = vi.fn();
    mirror.onGap(gapCb);

    mirror.feedOp(makeOp("token:move", 1));
    mirror.feedOp(makeOp("token:move", 2));
    mirror.feedOp(makeOp("token:move", 3));

    expect(gapCb).not.toHaveBeenCalled();
    expect(mirror.seq).toBe(3);
  });

  it("gap listener unsubscribe works", () => {
    const gapCb = vi.fn();
    const unsub = mirror.onGap(gapCb);
    unsub();

    mirror.feedOp(makeOp("token:move", 5));
    expect(gapCb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Boot buffer (REQ-ARQ-014 / REQ-NET-064)
// ---------------------------------------------------------------------------

describe("DocumentMirror — boot buffer", () => {
  it("buffers ops that arrive before snapshot", () => {
    const mirror = new DocumentMirror();

    // Ops arrive before snapshot (window of loss scenario)
    mirror.feedOp(makeCreateOp(2, "Actor", [{ _id: "1234567890abcdef", name: "A" }]));
    mirror.feedOp(makeCreateOp(3, "Actor", [{ _id: "aaaaaaaaaaaaaaa2", name: "B" }]));

    // Still in boot phase — no docs applied yet
    expect(mirror.booting).toBe(true);
    expect(mirror.getByType("Actor")).toHaveLength(0);

    // Now snapshot arrives at seq 1 (ops 2 and 3 are from after the snapshot point)
    mirror.applySnapshot(
      makeSnapshot(1, {
        Actor: [{ _id: "cccccccccccccccc", name: "Existing" }],
      }),
    );

    expect(mirror.booting).toBe(false);
    expect(mirror.seq).toBe(3);
    // Should have: Existing (from snapshot) + A (seq 2) + B (seq 3)
    expect(mirror.getByType("Actor")).toHaveLength(3);
  });

  it("discards boot-buffered ops older than snapshot seq", () => {
    const mirror = new DocumentMirror();

    // Old ops buffered during boot
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "1234567890abcdef", name: "Old" }]));

    // Snapshot at seq 5 — op at seq 1 is already covered
    mirror.applySnapshot(makeSnapshot(5));

    expect(mirror.seq).toBe(5);
    expect(mirror.getByType("Actor")).toHaveLength(0); // old op discarded
  });

  it("applies boot buffer in seq order even if they arrived out of order", () => {
    const mirror = new DocumentMirror();

    // Arrive out of order during boot
    mirror.feedOp(makeCreateOp(3, "Actor", [{ _id: "1234567890abcdef", name: "C" }]));
    mirror.feedOp(makeCreateOp(2, "Actor", [{ _id: "aaaaaaaaaaaaaaa2", name: "B" }]));
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "cccccccccccccccc", name: "A" }]));

    mirror.applySnapshot(makeSnapshot(0));

    // All three ops applied in order
    expect(mirror.seq).toBe(3);
    expect(mirror.getByType("Actor")).toHaveLength(3);
  });

  it("gap in boot buffer fires gap event after boot", () => {
    const mirror = new DocumentMirror();
    const gapCb = vi.fn();
    mirror.onGap(gapCb);

    // Buffer ops 1 and 3 (gap at 2)
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "1234567890abcdef", name: "A" }]));
    mirror.feedOp(makeCreateOp(3, "Actor", [{ _id: "aaaaaaaaaaaaaaa2", name: "B" }]));

    mirror.applySnapshot(makeSnapshot(0));

    // Seq 1 applied OK, seq 3 fires gap
    expect(gapCb).toHaveBeenCalledOnce();
    expect(gapCb).toHaveBeenCalledWith(2, 3);
    expect(mirror.seq).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

describe("DocumentMirror — CRUD", () => {
  let mirror: DocumentMirror;

  beforeEach(() => {
    mirror = new DocumentMirror();
    mirror.applySnapshot(
      makeSnapshot(0, {
        Scene: [{ _id: "abcdefghij012345", name: "Test", active: false }],
      }),
    );
  });

  it("doc:create adds a document", () => {
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "1234567890abcdef", name: "Hero" }]));
    expect(mirror.getDoc("Actor", "1234567890abcdef")).toMatchObject({ name: "Hero" });
  });

  it("doc:update replaces a document with the server-provided complete state", () => {
    // Server sends the full post-merge document — mirror replaces by _id.
    mirror.feedOp(
      makeUpdateOp(1, "Scene", { _id: "abcdefghij012345", name: "Updated", active: true }),
    );
    expect(mirror.getDoc("Scene", "abcdefghij012345")).toMatchObject({
      name: "Updated",
      active: true,
    });
  });

  it("doc:update replaces nested fields via complete document (server merges, mirror replaces)", () => {
    mirror.applySnapshot(
      makeSnapshot(0, {
        Actor: [{ _id: "1234567890abcdef", system: { hp: { value: 10, max: 20 } } }],
      }),
    );
    // Server computes the merged state and sends the full document.
    mirror.feedOp(
      makeUpdateOp(1, "Actor", {
        _id: "1234567890abcdef",
        system: { hp: { value: 7, max: 20 } },
      }),
    );
    const doc = mirror.getDoc<Record<string, unknown>>("Actor", "1234567890abcdef");
    expect((doc?.["system"] as Record<string, unknown>)?.["hp"]).toMatchObject({
      value: 7,
      max: 20,
    });
  });

  it("doc:delete removes a document", () => {
    mirror.feedOp(makeDeleteOp(1, "Scene", ["abcdefghij012345"]));
    expect(mirror.getDoc("Scene", "abcdefghij012345")).toBeUndefined();
    expect(mirror.getByType("Scene")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Subscribe / change notifications
// ---------------------------------------------------------------------------

describe("DocumentMirror — subscribe", () => {
  let mirror: DocumentMirror;

  beforeEach(() => {
    mirror = new DocumentMirror();
    mirror.applySnapshot(makeSnapshot(0));
  });

  it("calls subscriber when a document is created", () => {
    const cb = vi.fn();
    mirror.subscribe("Actor", cb);
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "1234567890abcdef", name: "A" }]));
    expect(cb).toHaveBeenCalled();
  });

  it("subscribe returns unsubscribe that silences future calls", () => {
    const cb = vi.fn();
    const unsub = mirror.subscribe("Actor", cb);
    unsub();
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "1234567890abcdef", name: "A" }]));
    expect(cb).not.toHaveBeenCalled();
  });

  it("wildcard subscribe fires for any type", () => {
    const cb = vi.fn();
    mirror.subscribe("*", cb);
    mirror.feedOp(makeCreateOp(1, "Scene", [{ _id: "abcdefghij012345", name: "S" }]));
    mirror.feedOp(makeCreateOp(2, "Actor", [{ _id: "1234567890abcdef", name: "A" }]));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("does not fire subscriber on discarded duplicate op", () => {
    const cb = vi.fn();
    mirror.subscribe("Actor", cb);
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "1234567890abcdef", name: "A" }]));
    cb.mockClear();
    mirror.feedOp(makeCreateOp(1, "Actor", [{ _id: "bbbbbbbbbbbbbbbb", name: "Dup" }]));
    expect(cb).not.toHaveBeenCalled(); // duplicate was discarded
  });
});

// ---------------------------------------------------------------------------
// Combat lifecycle broadcasts (BUG FIX: combat:created/updated/deleted)
//
// Root cause: combat-handlers.ts broadcasts combat:created/updated/deleted on
// their own dedicated envelope types (never doc:create/update/delete), so the
// mirror's switch(op.type) fell through to `default` (advance seq, no doc
// change) — combatStore.combat (derived purely from
// worldMirror.subscribe("Combat", ...)) never saw a combat created mid-session.
// ---------------------------------------------------------------------------

describe("DocumentMirror — combat lifecycle broadcasts", () => {
  let mirror: DocumentMirror;

  beforeEach(() => {
    mirror = new DocumentMirror();
    mirror.applySnapshot(makeSnapshot(0));
  });

  function makeCombatCreatedOp(
    seq: number,
    combat: { _id: string; [key: string]: unknown },
  ): Envelope<unknown> {
    return { type: "combat:created", seq, ts: Date.now(), payload: { combat } };
  }

  function makeCombatUpdatedOp(
    seq: number,
    combatId: string,
    diff: Record<string, unknown>,
  ): Envelope<unknown> {
    return { type: "combat:updated", seq, ts: Date.now(), payload: { combatId, diff } };
  }

  function makeCombatDeletedOp(seq: number, combatId: string): Envelope<unknown> {
    return { type: "combat:deleted", seq, ts: Date.now(), payload: { combatId } };
  }

  it("combat:created inserts the combat into the Combat collection", () => {
    mirror.feedOp(
      makeCombatCreatedOp(1, {
        _id: "combat0000000001",
        sceneId: "scene1",
        round: 0,
        started: false,
      }),
    );
    const combats = mirror.getByType<{ _id: string }>("Combat");
    expect(combats).toHaveLength(1);
    expect(combats[0]?._id).toBe("combat0000000001");
  });

  it("combat:created notifies Combat subscribers", () => {
    const cb = vi.fn();
    mirror.subscribe("Combat", cb);
    mirror.feedOp(makeCombatCreatedOp(1, { _id: "combat0000000001", round: 0 }));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith([{ _id: "combat0000000001", round: 0 }]);
  });

  it("combat:updated merges the diff onto the existing combat", () => {
    mirror.feedOp(
      makeCombatCreatedOp(1, { _id: "combat0000000001", round: 0, started: false, turnIndex: 0 }),
    );
    mirror.feedOp(makeCombatUpdatedOp(2, "combat0000000001", { started: true, round: 1 }));
    const combat = mirror.getDoc<Record<string, unknown>>("Combat", "combat0000000001");
    expect(combat).toEqual({
      _id: "combat0000000001",
      round: 1,
      started: true,
      turnIndex: 0,
    });
  });

  it("combat:updated is a no-op when the combat isn't known locally yet", () => {
    // Simulates a combat:updated that raced ahead of / arrived without a
    // corresponding combat:created (e.g. after a gap) — must not store a
    // partial/broken document.
    mirror.feedOp(makeCombatUpdatedOp(1, "unknown-combat", { started: true }));
    expect(mirror.getDoc("Combat", "unknown-combat")).toBeUndefined();
  });

  it("combat:deleted removes the combat from the collection", () => {
    mirror.feedOp(makeCombatCreatedOp(1, { _id: "combat0000000001", round: 0 }));
    expect(mirror.getByType("Combat")).toHaveLength(1);
    mirror.feedOp(makeCombatDeletedOp(2, "combat0000000001"));
    expect(mirror.getByType("Combat")).toHaveLength(0);
  });

  it("combat:deleted notifies Combat subscribers with the now-empty list", () => {
    mirror.feedOp(makeCombatCreatedOp(1, { _id: "combat0000000001", round: 0 }));
    const cb = vi.fn();
    mirror.subscribe("Combat", cb);
    mirror.feedOp(makeCombatDeletedOp(2, "combat0000000001"));
    expect(cb).toHaveBeenCalledWith([]);
  });

  it("combat:created / updated / deleted all advance the mirror seq", () => {
    mirror.feedOp(makeCombatCreatedOp(1, { _id: "c1", round: 0 }));
    expect(mirror.seq).toBe(1);
    mirror.feedOp(makeCombatUpdatedOp(2, "c1", { round: 1 }));
    expect(mirror.seq).toBe(2);
    mirror.feedOp(makeCombatDeletedOp(3, "c1"));
    expect(mirror.seq).toBe(3);
  });

  it("duplicate combat:created (seq already applied) is discarded, not double-inserted", () => {
    mirror.feedOp(makeCombatCreatedOp(1, { _id: "c1", round: 0 }));
    const cb = vi.fn();
    mirror.subscribe("Combat", cb);
    mirror.feedOp(makeCombatCreatedOp(1, { _id: "c1", round: 0 })); // same seq, duplicate
    expect(cb).not.toHaveBeenCalled();
    expect(mirror.getByType("Combat")).toHaveLength(1);
  });

  it("a combat already present in the snapshot is not duplicated by a later combat:created replay", () => {
    const snapMirror = new DocumentMirror();
    snapMirror.applySnapshot(makeSnapshot(5, { Combat: [{ _id: "c1", round: 0 }] }));
    // A resync/replay that re-delivers the same seq must be discarded.
    snapMirror.feedOp(makeCombatCreatedOp(5, { _id: "c1", round: 0 }));
    expect(snapMirror.getByType("Combat")).toHaveLength(1);
  });
});
