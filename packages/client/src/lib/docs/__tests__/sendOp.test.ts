/**
 * sendOp unit tests.
 *
 * Tests: requestId correlation, timeout, ack ok/error, promise resolution.
 * No real socket.io connection — uses a mock socket.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendOp, OpError } from "../sendOp.js";
import type { Socket } from "socket.io-client";

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
