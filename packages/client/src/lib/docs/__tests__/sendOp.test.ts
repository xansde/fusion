/**
 * sendOp unit tests.
 *
 * Tests: requestId correlation, timeout, ack ok/error, promise resolution.
 * No real socket.io connection — uses a mock socket.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendOp, OpError, makeSendOpFn } from "../sendOp.js";
import type { Socket } from "socket.io-client";
import {
  DocUpdatePayloadSchema,
  DocCreatePayloadSchema,
  DocDeletePayloadSchema,
} from "@fusion/shared";

// ---------------------------------------------------------------------------
// Mock socket
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendOp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("emits on 'op' event with requestId and ts", async () => {
    const { socket, triggerAck } = makeMockSocket();
    const promise = sendOp(socket, { type: "doc:update", payload: {} });
    triggerAck({ ok: true, result: { id: "abc" } });
    await promise;

    expect(socket.emit).toHaveBeenCalledOnce();
    const [event, envelope] = (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    expect(event).toBe("op");
    expect(envelope).toMatchObject({
      type: "doc:update",
      requestId: expect.any(String) as string,
      ts: expect.any(Number) as number,
    });
  });

  it("resolves with ack.result on success", async () => {
    const { socket, triggerAck } = makeMockSocket();
    const promise = sendOp(socket, { type: "doc:create", payload: {} });
    triggerAck({ ok: true, requestId: "some-id", result: { _id: "xyz" } });
    const result = await promise;
    expect(result).toEqual({ _id: "xyz" });
  });

  it("rejects with OpError on ack.ok === false", async () => {
    const { socket, triggerAck } = makeMockSocket();
    const promise = sendOp(socket, { type: "doc:delete", payload: {} });
    triggerAck({ ok: false, code: "PERMISSION_DENIED", message: "not allowed" });
    await expect(promise).rejects.toThrow(OpError);
    await expect(promise).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("rejects with TIMEOUT after timeoutMs if no ack arrives", async () => {
    const { socket } = makeMockSocket();
    const promise = sendOp(socket, { type: "doc:update", payload: {} }, { timeoutMs: 500 });

    // Advance fake timers past the timeout
    vi.advanceTimersByTime(600);

    await expect(promise).rejects.toThrow(OpError);
    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("does not reject after ack arrives before timeout", async () => {
    const { socket, triggerAck } = makeMockSocket();
    const promise = sendOp(socket, { type: "doc:update", payload: {} }, { timeoutMs: 500 });

    // Ack arrives at 100ms
    vi.advanceTimersByTime(100);
    triggerAck({ ok: true, result: null });

    // Should resolve, not reject
    await expect(promise).resolves.toBeNull();

    // Advancing past timeout should not cause issues
    vi.advanceTimersByTime(600);
  });

  it("respects custom requestId if provided", async () => {
    const { socket, triggerAck } = makeMockSocket();
    const promise = sendOp(socket, { type: "doc:update", payload: {}, requestId: "my-custom-id" });
    triggerAck({ ok: true, result: {} });
    await promise;

    const [, envelope] = (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { requestId: string },
    ];
    expect(envelope.requestId).toBe("my-custom-id");
  });
});

// ---------------------------------------------------------------------------
// makeSendOpFn — adapter from flat "op" callbacks (every sheet VM's
// sendOpFn prop) to sendOp()'s { type, payload } envelope shape.
// ---------------------------------------------------------------------------

describe("makeSendOpFn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("splits a flat op into { type, payload } and forwards via sendOp", () => {
    const { socket, triggerAck } = makeMockSocket();
    const fn = makeSendOpFn(socket);

    fn({ type: "etmos:conjuracao:propor", conjuradorActorId: "actor1", frase: { foo: "bar" } });
    triggerAck({ ok: true, result: null });

    expect(socket.emit).toHaveBeenCalledOnce();
    const [event, envelope] = (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { type: string; payload: unknown },
    ];
    expect(event).toBe("op");
    expect(envelope.type).toBe("etmos:conjuracao:propor");
    expect(envelope.payload).toEqual({ conjuradorActorId: "actor1", frase: { foo: "bar" } });
  });

  it("logs and does not throw for a malformed op (missing type)", () => {
    const { socket } = makeMockSocket();
    const fn = makeSendOpFn(socket);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => fn({ conjuradorActorId: "actor1" })).not.toThrow();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("logs (but does not throw) when the server ack rejects", async () => {
    const { socket, triggerAck } = makeMockSocket();
    const fn = makeSendOpFn(socket);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fn({ type: "doc:update", documentType: "Actor", id: "a1", diff: {} });
    triggerAck({ ok: false, code: "PERMISSION_DENIED", message: "nope" });

    // Let the rejected sendOp promise's .catch() run.
    await vi.runAllTimersAsync();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("doc:update"), expect.anything());

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// makeSendOpFn — normalizeDocUpdate/normalizeDocCreate/normalizeDocDelete
// (R10-C4 item 4): embedded passthrough + doc:create/delete parent handling +
// flat-shape regression, each validated against the real wire Zod schemas.
// ---------------------------------------------------------------------------

describe("makeSendOpFn — doc:* payload normalization (protocol-validated)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizeDocUpdate preserves an `embedded` field into the batched update entry", () => {
    const { socket, triggerAck } = makeMockSocket();
    const fn = makeSendOpFn(socket);

    fn({
      type: "doc:update",
      documentType: "Item",
      id: "entry-arcane",
      embedded: { type: "Item", id: "entry-arcane" },
      diff: { "system.slots.1.prepared.0": { id: "spell-x", expended: false } },
    });
    triggerAck({ ok: true, result: null });

    const [, envelope] = (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { type: string; payload: unknown },
    ];
    expect(envelope.payload).toEqual({
      documentType: "Item",
      updates: [
        {
          _id: "entry-arcane",
          diff: { "system.slots.1.prepared.0": { id: "spell-x", expended: false } },
          embedded: { type: "Item", id: "entry-arcane" },
        },
      ],
    });
    expect(DocUpdatePayloadSchema.safeParse(envelope.payload).success).toBe(true);
  });

  it("normalizeDocUpdate omits `embedded` entirely when absent (flat legacy shape unchanged)", () => {
    const { socket, triggerAck } = makeMockSocket();
    const fn = makeSendOpFn(socket);

    fn({
      type: "doc:update",
      documentType: "Actor",
      id: "actor-001",
      diff: { "system.attributes.hp.value": 50 },
    });
    triggerAck({ ok: true, result: null });

    const [, envelope] = (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { type: string; payload: Record<string, unknown> },
    ];
    const updates = envelope.payload["updates"] as Array<Record<string, unknown>>;
    expect(updates).toHaveLength(1);
    expect("embedded" in updates[0]!).toBe(false);
    expect(updates[0]).toEqual({
      _id: "actor-001",
      diff: { "system.attributes.hp.value": 50 },
    });
    expect(DocUpdatePayloadSchema.safeParse(envelope.payload).success).toBe(true);
  });

  it("normalizeDocCreate wraps flat `data` into an array and forwards `parent` verbatim", () => {
    const { socket, triggerAck } = makeMockSocket();
    const fn = makeSendOpFn(socket);

    fn({
      type: "doc:create",
      documentType: "Item",
      data: { name: "Fireball", type: "spell", system: { level: 3 } },
      parent: { type: "Actor", id: "actor-001" },
    });
    triggerAck({ ok: true, result: null });

    const [, envelope] = (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { type: string; payload: unknown },
    ];
    expect(envelope.payload).toEqual({
      documentType: "Item",
      data: [{ name: "Fireball", type: "spell", system: { level: 3 } }],
      parent: { type: "Actor", id: "actor-001" },
    });
    expect(DocCreatePayloadSchema.safeParse(envelope.payload).success).toBe(true);
  });

  it("normalizeDocDelete wraps flat `id` into `ids` and forwards `parent` verbatim", () => {
    const { socket, triggerAck } = makeMockSocket();
    const fn = makeSendOpFn(socket);

    fn({
      type: "doc:delete",
      documentType: "Item",
      id: "spell-magic-missile",
      parent: { type: "Actor", id: "actor-001" },
    });
    triggerAck({ ok: true, result: null });

    const [, envelope] = (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { type: string; payload: unknown },
    ];
    expect(envelope.payload).toEqual({
      documentType: "Item",
      ids: ["spell-magic-missile"],
      parent: { type: "Actor", id: "actor-001" },
    });
    expect(DocDeletePayloadSchema.safeParse(envelope.payload).success).toBe(true);
  });

  it("regression: pre-existing flat doc:update (no embedded, no parent) still normalizes exactly as before", () => {
    const { socket, triggerAck } = makeMockSocket();
    const fn = makeSendOpFn(socket);

    fn({ type: "doc:update", documentType: "Actor", id: "a1", diff: { name: "New Name" } });
    triggerAck({ ok: true, result: null });

    const [, envelope] = (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { type: string; payload: unknown },
    ];
    expect(envelope.payload).toEqual({
      documentType: "Actor",
      updates: [{ _id: "a1", diff: { name: "New Name" } }],
    });
  });

  it("a payload that already carries `updates`/`data`/`ids` passes through unchanged", () => {
    const { socket, triggerAck } = makeMockSocket();
    const fn = makeSendOpFn(socket);

    fn({
      type: "doc:update",
      documentType: "Actor",
      updates: [{ _id: "a1", diff: { name: "X" } }],
    });
    triggerAck({ ok: true, result: null });

    const [, envelope] = (socket.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { type: string; payload: unknown },
    ];
    expect(envelope.payload).toEqual({
      documentType: "Actor",
      updates: [{ _id: "a1", diff: { name: "X" } }],
    });
  });
});
