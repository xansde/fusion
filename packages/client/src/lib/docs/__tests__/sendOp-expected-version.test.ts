/**
 * T013 (client half) — sendOp.ts's normalizeDocUpdate fills a missing
 * `expectedVersion` from the DocumentMirror, so the ~14 sheet VMs (none of
 * which set the field themselves) keep working under the server's new
 * "expectedVersion is mandatory for non-privileged writers" gate
 * (doc-handlers.ts buildDocUpdateHandler, see expected-version.test.ts on the
 * server side for the wire-level policy).
 *
 * Every test here passes an EXPLICIT DocumentMirror instance (never the real
 * `worldMirror` singleton) via the new mirror-accessor parameter, so the
 * fixture is fully self-contained — see the last describe block for the one
 * test that exercises the OMITTED-parameter default instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Socket } from "socket.io-client";
import { DocUpdatePayloadSchema } from "@fusion/shared";
import { makeSendOpFn, toEnvelope, _resetPrimaryWriteStateForTests } from "../sendOp.js";
import { DocumentMirror } from "../DocumentMirror.js";

// ---------------------------------------------------------------------------
// Mock socket (mirrors sendOp.test.ts)
// ---------------------------------------------------------------------------

type EmitCallback = (ack: unknown) => void;

function makeMockSocket(): {
  socket: Socket;
  triggerAck: (ack: unknown) => void;
} {
  let lastCb: EmitCallback | null = null;

  const socket = {
    emit: vi.fn((_event: string, _envelope: unknown, cb: EmitCallback) => {
      lastCb = cb;
    }),
  } as unknown as Socket;

  const triggerAck = (ack: unknown) => {
    if (lastCb) lastCb(ack);
  };

  return { socket, triggerAck };
}

/** A fresh, booted DocumentMirror seeded with one Actor at a given version. */
function mirrorWithActor(id: string, version: number): DocumentMirror {
  const mirror = new DocumentMirror();
  mirror.applySnapshot({
    seq: 0,
    activeSceneId: null,
    documents: {
      Actor: [{ _id: id, name: "Seeded Actor", _stats: { version } }],
    },
  });
  return mirror;
}

function lastEmittedPayload(socket: Socket): Record<string, unknown> {
  const [, envelope] = (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [
    string,
    { payload: Record<string, unknown> },
  ];
  return envelope.payload;
}

// ---------------------------------------------------------------------------
// Multi-emit mock socket — one call site per socket.emit(), each with its OWN
// ack callback captured separately. `makeMockSocket` above only ever tracks
// the LAST callback (fine for a single send per test); the queue/retry tests
// below need to inspect/ack the FIRST send while a SECOND is still pending
// behind it in the queue, so each call needs to stay individually addressable.
// ---------------------------------------------------------------------------

interface RecordedEmit {
  envelope: { type: string; payload: Record<string, unknown> };
  triggerAck: (ack: unknown) => void;
}

function makeMultiEmitMockSocket(): { socket: Socket; calls: RecordedEmit[] } {
  const calls: RecordedEmit[] = [];
  const socket = {
    emit: vi.fn((_event: string, envelope: unknown, cb: EmitCallback) => {
      calls.push({
        envelope: envelope as RecordedEmit["envelope"],
        triggerAck: (ack: unknown) => cb(ack),
      });
    }),
  } as unknown as Socket;
  return { socket, calls };
}

function expectedVersionOf(call: RecordedEmit): unknown {
  const updates = call.envelope.payload["updates"] as Array<Record<string, unknown>>;
  return updates[0]?.["expectedVersion"];
}

/** Ack shape doc-handlers.ts returns for a successful doc:update — the client
 * cache (rememberAckedVersions) reads the new version straight off this. */
function okAck(id: string, version: number): unknown {
  return {
    ok: true,
    result: { documentType: "Actor", documents: [{ _id: id, _stats: { version } }] },
  };
}

function staleWriteAck(): unknown {
  return { ok: false, code: "STALE_WRITE", message: "Document has been modified since last read" };
}

// ---------------------------------------------------------------------------
// makeSendOpFn(socket, mirror) — fills expectedVersion from the mirror
// ---------------------------------------------------------------------------

describe("T013 — normalizeDocUpdate fills expectedVersion from the DocumentMirror", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // T013 (redesign): every doc:update call below now runs through
    // sendOp.ts's per-document write queue — reset it so an id reused across
    // `it()` blocks never inherits a leftover queue entry from a previous
    // test. See the "per-document write queue" describe further down for why
    // an un-reset entry would HANG (not just fail) a later test.
    _resetPrimaryWriteStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fills expectedVersion from the mirror when the op omits it", () => {
    const { socket, triggerAck } = makeMockSocket();
    const mirror = mirrorWithActor("actor-1", 3);
    const fn = makeSendOpFn(socket, mirror);

    fn({ type: "doc:update", documentType: "Actor", id: "actor-1", diff: { name: "New Name" } });
    triggerAck({ ok: true, result: null });

    const payload = lastEmittedPayload(socket);
    expect(payload).toEqual({
      documentType: "Actor",
      updates: [{ _id: "actor-1", diff: { name: "New Name" }, expectedVersion: 3 }],
    });
    expect(DocUpdatePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("never overwrites an expectedVersion the caller already supplied", () => {
    const { socket, triggerAck } = makeMockSocket();
    // Mirror disagrees with the caller (version 9) — the explicit value wins.
    const mirror = mirrorWithActor("actor-1", 9);
    const fn = makeSendOpFn(socket, mirror);

    fn({
      type: "doc:update",
      documentType: "Actor",
      id: "actor-1",
      diff: { name: "X" },
      expectedVersion: 2,
    });
    triggerAck({ ok: true, result: null });

    const updates = lastEmittedPayload(socket)["updates"] as Array<Record<string, unknown>>;
    expect(updates[0]?.["expectedVersion"]).toBe(2);
  });

  it("never fills an embedded entry (server's mandatory gate is primary-path only)", () => {
    const { socket, triggerAck } = makeMockSocket();
    const mirror = mirrorWithActor("token-1", 5);
    const fn = makeSendOpFn(socket, mirror);

    fn({
      type: "doc:update",
      documentType: "Token",
      id: "token-1",
      diff: { x: 10, y: 20 },
      embedded: { type: "Token", id: "scene-1" },
    });
    triggerAck({ ok: true, result: null });

    const updates = lastEmittedPayload(socket)["updates"] as Array<Record<string, unknown>>;
    expect("expectedVersion" in updates[0]!).toBe(false);
    expect(updates[0]?.["embedded"]).toEqual({ type: "Token", id: "scene-1" });
  });

  it("leaves expectedVersion unset when the document is absent from the mirror", () => {
    const { socket, triggerAck } = makeMockSocket();
    const mirror = new DocumentMirror();
    mirror.applySnapshot({ seq: 0, activeSceneId: null, documents: {} });
    const fn = makeSendOpFn(socket, mirror);

    fn({ type: "doc:update", documentType: "Actor", id: "unknown-actor", diff: { name: "X" } });
    triggerAck({ ok: true, result: null });

    const payload = lastEmittedPayload(socket);
    const updates = payload["updates"] as Array<Record<string, unknown>>;
    expect("expectedVersion" in updates[0]!).toBe(false);
    // Still a wire-valid payload — the server decides the outcome, not the client.
    expect(DocUpdatePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("leaves expectedVersion unset when the document has no numeric _stats.version", () => {
    const { socket, triggerAck } = makeMockSocket();
    const mirror = new DocumentMirror();
    mirror.applySnapshot({
      seq: 0,
      activeSceneId: null,
      // Legacy/hand-seeded shape: no _stats at all.
      documents: { Actor: [{ _id: "actor-1", name: "No Stats" }] },
    });
    const fn = makeSendOpFn(socket, mirror);

    fn({ type: "doc:update", documentType: "Actor", id: "actor-1", diff: { name: "X" } });
    triggerAck({ ok: true, result: null });

    const updates = lastEmittedPayload(socket)["updates"] as Array<Record<string, unknown>>;
    expect("expectedVersion" in updates[0]!).toBe(false);
  });

  it("fills every entry of a payload that already carries a batched `updates` array", () => {
    const { socket, triggerAck } = makeMockSocket();
    const mirror = mirrorWithActor("actor-1", 7);
    const fn = makeSendOpFn(socket, mirror);

    fn({
      type: "doc:update",
      documentType: "Actor",
      updates: [{ _id: "actor-1", diff: { name: "Batched" } }],
    });
    triggerAck({ ok: true, result: null });

    const updates = lastEmittedPayload(socket)["updates"] as Array<Record<string, unknown>>;
    expect(updates[0]?.["expectedVersion"]).toBe(7);
  });

  it("omitting the mirror parameter does not throw and still emits a wire-valid payload", () => {
    const { socket, triggerAck } = makeMockSocket();
    // No mirror argument at all — resolves to the real (empty, in this unit
    // test) worldMirror singleton internally; nothing to fill, no crash.
    const fn = makeSendOpFn(socket);

    expect(() =>
      fn({ type: "doc:update", documentType: "Actor", id: "actor-1", diff: { name: "X" } }),
    ).not.toThrow();
    triggerAck({ ok: true, result: null });

    const payload = lastEmittedPayload(socket);
    expect(DocUpdatePayloadSchema.safeParse(payload).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toEnvelope(op, mirror) — same fill, for callers that bypass makeSendOpFn
// (FamiliarSheet.svelte / PetsTab.svelte use this path directly).
// ---------------------------------------------------------------------------

describe("T013 — toEnvelope fills expectedVersion from the DocumentMirror", () => {
  it("fills expectedVersion for a flat doc:update op", () => {
    const mirror = mirrorWithActor("familiar-1", 4);
    // Assigned to a typed const first (not passed as an inline literal): a
    // bare object literal argument would trip TS's excess-property check
    // against toEnvelope's minimal `{ readonly type: string }` parameter type
    // — every real caller (FamiliarSheet.svelte's buildSetHpOp) hits the same
    // shape via a typed op variable, never a fresh literal.
    const op: {
      type: "doc:update";
      documentType: string;
      id: string;
      diff: Record<string, unknown>;
    } = { type: "doc:update", documentType: "Actor", id: "familiar-1", diff: { "system.hp": 12 } };

    const envelope = toEnvelope(op, mirror);

    expect(envelope.payload).toEqual({
      documentType: "Actor",
      updates: [{ _id: "familiar-1", diff: { "system.hp": 12 }, expectedVersion: 4 }],
    });
    expect(DocUpdatePayloadSchema.safeParse(envelope.payload).success).toBe(true);
  });

  it("does not affect doc:create ops (mirror is irrelevant there)", () => {
    const mirror = mirrorWithActor("ignored", 1);
    const op: { type: "doc:create"; documentType: string; data: Record<string, unknown> } = {
      type: "doc:create",
      documentType: "Actor",
      data: { name: "New Familiar" },
    };

    const envelope = toEnvelope(op, mirror);

    expect(envelope.payload).toEqual({
      documentType: "Actor",
      data: [{ name: "New Familiar" }],
    });
  });
});

// ---------------------------------------------------------------------------
// T013 (redesign) — per-document write queue (sendOp.ts's enqueuePrimaryWrite)
//
// These are the tests that motivated the redesign: the OLD fix (coalescing
// inside planVM.ts/PlanColumn.svelte) only protected call sites someone
// audited. CharacterSheet.svelte's rest() and PlanColumn's
// handleAbilityBoostsConfirm both fire several primary doc:update ops for
// the SAME Actor in one synchronous tick, neither going through the
// coalescing helper — see the "regression" describe further down for those
// two shapes specifically. This block proves the underlying mechanism
// directly: the queue, and the version it hands to a queued write.
// ---------------------------------------------------------------------------

describe("T013 (redesign) — per-document write queue", () => {
  beforeEach(() => {
    _resetPrimaryWriteStateForTests();
  });

  it("serializes two primary doc:update writes to the SAME document — the second is not sent until the first is acked, and reads the version the ack produced", async () => {
    const { socket, calls } = makeMultiEmitMockSocket();
    const mirror = mirrorWithActor("actor-1", 5);
    const fn = makeSendOpFn(socket, mirror);

    // Fired back-to-back, same synchronous tick, no await between them —
    // exactly how a dispatch loop with no `await` between sendOpFn calls
    // behaves (rest()/handleAbilityBoostsConfirm; see the regression block).
    fn({ type: "doc:update", documentType: "Actor", id: "actor-1", diff: { a: 1 } });
    fn({ type: "doc:update", documentType: "Actor", id: "actor-1", diff: { b: 2 } });

    // Only the FIRST write actually reached the socket. The second is
    // queued behind it — this is the assertion a pre-queue sendOp.ts fails
    // (see the mutation-tested proof in the final report: both would have
    // been sent immediately, both reading version 5).
    expect(calls).toHaveLength(1);
    expect(expectedVersionOf(calls[0]!)).toBe(5);

    // Ack the first write: the server bumps the version to 6.
    calls[0]!.triggerAck(okAck("actor-1", 6));

    // Once the first write settles, the queued second write actually sends
    // — and its expectedVersion is 6, the version the FIRST write's ack
    // produced, not the version 5 the mirror still held when both fn() calls
    // were made.
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(expectedVersionOf(calls[1]!)).toBe(6);

    calls[1]!.triggerAck(okAck("actor-1", 7));
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2); // no further/unexpected sends
    });
  });

  it("does NOT block writes to a DIFFERENT document — both send immediately", () => {
    const { socket, calls } = makeMultiEmitMockSocket();
    const mirror = new DocumentMirror();
    mirror.applySnapshot({
      seq: 0,
      activeSceneId: null,
      documents: {
        Actor: [
          { _id: "actor-1", _stats: { version: 5 } },
          { _id: "actor-2", _stats: { version: 9 } },
        ],
      },
    });
    const fn = makeSendOpFn(socket, mirror);

    fn({ type: "doc:update", documentType: "Actor", id: "actor-1", diff: { a: 1 } });
    fn({ type: "doc:update", documentType: "Actor", id: "actor-2", diff: { b: 2 } });

    // Neither is queued behind the other — different documents, independent.
    expect(calls).toHaveLength(2);
    expect(expectedVersionOf(calls[0]!)).toBe(5);
    expect(expectedVersionOf(calls[1]!)).toBe(9);

    calls[0]!.triggerAck(okAck("actor-1", 6));
    calls[1]!.triggerAck(okAck("actor-2", 10));
  });
});

// ---------------------------------------------------------------------------
// T013 (redesign) — retry once on STALE_WRITE (sendOp.ts's sendPrimaryDocUpdate)
// ---------------------------------------------------------------------------

describe("T013 (redesign) — retry once on STALE_WRITE", () => {
  beforeEach(() => {
    _resetPrimaryWriteStateForTests();
  });

  it("retries once with a refreshed expectedVersion and succeeds", async () => {
    const { socket, calls } = makeMultiEmitMockSocket();
    const mirror = mirrorWithActor("actor-1", 5);
    const fn = makeSendOpFn(socket, mirror);

    fn({ type: "doc:update", documentType: "Actor", id: "actor-1", diff: { a: 1 } });
    expect(calls).toHaveLength(1);
    expect(expectedVersionOf(calls[0]!)).toBe(5);

    // Server rejects: someone else's write landed first, current version is
    // now 6. Its ack carries no version (see doc-handlers.ts's bare
    // ackError("STALE_WRITE", ...)) — the only way this client learns the
    // new version is the CONFLICTING writer's own broadcast reaching the
    // mirror, simulated here by updating it directly (synchronously, so it
    // is visible before the retry's microtask runs — see sendOp.ts's
    // sendPrimaryDocUpdate docstring for the full reasoning).
    calls[0]!.triggerAck(staleWriteAck());
    mirror.applySnapshot({
      seq: 1,
      activeSceneId: null,
      documents: { Actor: [{ _id: "actor-1", _stats: { version: 6 } }] },
    });

    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(expectedVersionOf(calls[1]!)).toBe(6);

    calls[1]!.triggerAck(okAck("actor-1", 7));
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2); // exactly one retry, no more
    });
  });

  it("propagates the error after a SECOND STALE_WRITE — no infinite retry", async () => {
    const { socket, calls } = makeMultiEmitMockSocket();
    const mirror = mirrorWithActor("actor-1", 5);
    const fn = makeSendOpFn(socket, mirror);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fn({ type: "doc:update", documentType: "Actor", id: "actor-1", diff: { a: 1 } });
    calls[0]!.triggerAck(staleWriteAck());

    await vi.waitFor(() => {
      expect(calls).toHaveLength(2); // the one retry
    });
    calls[1]!.triggerAck(staleWriteAck());

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("doc:update"),
        expect.objectContaining({ code: "STALE_WRITE" }),
      );
    });
    // No third attempt — exactly one retry, ever.
    expect(calls).toHaveLength(2);

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// T013 (redesign) — regression: the two real flows that motivated this task
//
// Both shapes are reproduced from the actual call sites (traced, not
// invented): CharacterSheet.svelte's rest() and PlanColumn.svelte's
// handleAbilityBoostsConfirm. Neither goes through PlanColumn's own
// sendAll/coalescing — rest() doesn't use sendAll at all, and
// handleAbilityBoostsConfirm calls the sendOpFn prop directly in a loop,
// bypassing it. Before the redesign, only the FIRST op in each of these
// would land; every sibling came back STALE_WRITE and was silently dropped
// by makeSendOpFn's `.catch(console.error)`.
// ---------------------------------------------------------------------------

describe("T013 (redesign) — regression: rest() and handleAbilityBoostsConfirm shapes", () => {
  beforeEach(() => {
    _resetPrimaryWriteStateForTests();
  });

  it("rest() shape — HP heal + Focus Points refill, two primary doc:update ops, both applied", async () => {
    const { socket, calls } = makeMultiEmitMockSocket();
    const mirror = mirrorWithActor("actor-1", 10);
    const fn = makeSendOpFn(socket, mirror);

    // CharacterSheet.svelte's rest(): `for (const op of vm.restAll()) sendOpFn(op);`
    // restAll() returns, among others, one Actor HP update and one Actor
    // Focus Points update — both primary, both this same actor.
    const restAllOps = [
      {
        type: "doc:update" as const,
        documentType: "Actor",
        id: "actor-1",
        diff: { "system.attributes.hp.value": 30 },
      },
      {
        type: "doc:update" as const,
        documentType: "Actor",
        id: "actor-1",
        diff: { "system.resources.focusPoints.value": 3 },
      },
    ];
    for (const op of restAllOps) fn(op);

    // The HP update sent immediately with the pre-rest version...
    expect(calls).toHaveLength(1);
    expect(expectedVersionOf(calls[0]!)).toBe(10);
    calls[0]!.triggerAck(okAck("actor-1", 11));

    // ...and the Focus Points update — which, before this redesign, would
    // have been sent in the SAME tick carrying the SAME stale version 10 and
    // come back STALE_WRITE — instead waits, then sends with version 11.
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(expectedVersionOf(calls[1]!)).toBe(11);
    calls[1]!.triggerAck(okAck("actor-1", 12));

    await vi.waitFor(() => {
      expect(calls).toHaveLength(2); // both applied, nothing dropped, nothing extra
    });
  });

  it("handleAbilityBoostsConfirm shape — N group updates + one final marker update, ALL applied", async () => {
    const { socket, calls } = makeMultiEmitMockSocket();
    const mirror = mirrorWithActor("actor-1", 20);
    const fn = makeSendOpFn(socket, mirror);

    // PlanColumn.svelte's handleAbilityBoostsConfirm: a `for` loop calling
    // `sendOpFn` once per non-empty boost group (ancestryFree, backgroundFree,
    // classBoost — three groups here), THEN one more `sendOpFn` call for
    // markAbilityBoostsChoice's marker update. All primary, same Actor, all
    // in one synchronous pass — and this call site never goes through
    // PlanColumn's own sendAll/coalescing at all.
    const groupOps = ["ancestryFree", "backgroundFree", "classBoost"].map((origin, i) => ({
      type: "doc:update" as const,
      documentType: "Actor",
      id: "actor-1",
      diff: { [`system.build.abilities.${origin}`]: [`slot-${String(i)}`] },
    }));
    const markerOp = {
      type: "doc:update" as const,
      documentType: "Actor",
      id: "actor-1",
      diff: { "system.build.choices": [{ level: 1, slot: "abilityBoosts-1" }] },
    };

    for (const op of groupOps) fn(op);
    fn(markerOp);

    // Only the first group update sent so far.
    expect(calls).toHaveLength(1);
    expect(expectedVersionOf(calls[0]!)).toBe(20);

    // Drain the queue: each ack unblocks exactly the next queued write, in
    // order, each reading the version the previous one produced.
    let version = 20;
    for (let i = 0; i < 4; i++) {
      await vi.waitFor(() => {
        expect(calls.length).toBeGreaterThan(i);
      });
      expect(expectedVersionOf(calls[i]!)).toBe(version);
      version += 1;
      calls[i]!.triggerAck(okAck("actor-1", version));
    }

    // All four ops (3 groups + 1 marker) were sent and applied — none
    // dropped, none stuck behind a swallowed STALE_WRITE.
    await vi.waitFor(() => {
      expect(calls).toHaveLength(4);
    });
  });
});
