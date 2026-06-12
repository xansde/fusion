/**
 * Tests for SocketManager — pure logic, no real socket.io connections.
 *
 * socket.io-client is mocked so these tests run in Node without a server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock socket.io-client
// ---------------------------------------------------------------------------

// Minimal EventEmitter used by mock socket
class MockEmitter {
  private handlers: Map<string, Array<(...args: unknown[]) => void>> = new Map();

  on(event: string, cb: (...args: unknown[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
    return this;
  }

  removeAllListeners(): this {
    this.handlers.clear();
    return this;
  }
}

class MockSocket extends MockEmitter {
  connected = false;
  auth: Record<string, unknown> = {};
  io = new MockEmitter();

  disconnect(): this {
    this.connected = false;
    return this;
  }
}

let latestMockSocket: MockSocket | null = null;

vi.mock("socket.io-client", () => ({
  io: vi.fn((_ns: string, opts: { auth?: Record<string, unknown> } = {}) => {
    const s = new MockSocket();
    s.auth = opts.auth ?? {};
    latestMockSocket = s;
    return s;
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SocketManager state transitions", () => {
  beforeEach(async () => {
    latestMockSocket = null;
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts in disconnected state", async () => {
    const { SocketManager } = await import("../socket.js");
    const mgr = new SocketManager(() => "tok");
    expect(mgr.state).toBe("disconnected");
  });

  it("transitions to connecting then connected", async () => {
    const { SocketManager } = await import("../socket.js");
    const states: string[] = [];
    const mgr = new SocketManager(() => "tok");
    mgr.subscribe((s) => states.push(s));

    mgr.connect("world-1");
    expect(states).toContain("connecting");

    // Simulate socket connect event
    latestMockSocket!.connected = true;
    latestMockSocket!.emit("connect");

    expect(states).toContain("connected");
    mgr.disconnect();
  });

  it("transitions to reconnecting on non-server disconnect", async () => {
    const { SocketManager } = await import("../socket.js");
    const states: string[] = [];
    const mgr = new SocketManager(() => "tok");
    mgr.subscribe((s) => states.push(s));

    mgr.connect("world-1");
    latestMockSocket!.connected = true;
    latestMockSocket!.emit("connect");

    // Network drop
    latestMockSocket!.emit("disconnect", "transport close");

    expect(states[states.length - 1]).toBe("reconnecting");
    mgr.disconnect();
  });

  it("transitions to disconnected on io server disconnect", async () => {
    const { SocketManager } = await import("../socket.js");
    const states: string[] = [];
    const mgr = new SocketManager(() => "tok");
    mgr.subscribe((s) => states.push(s));

    mgr.connect("world-1");
    latestMockSocket!.emit("disconnect", "io server disconnect");

    expect(states[states.length - 1]).toBe("disconnected");
    mgr.disconnect();
  });

  it("transitions to auth_failed on AUTH_FAILED connect_error", async () => {
    const { SocketManager } = await import("../socket.js");
    const states: string[] = [];
    const mgr = new SocketManager(() => "tok");
    mgr.subscribe((s) => states.push(s));

    mgr.connect("world-1");
    latestMockSocket!.emit("connect_error", new Error("AUTH_FAILED"));

    expect(states).toContain("auth_failed");
    mgr.disconnect();
  });

  it("transitions to protocol_mismatch on PROTOCOL_MISMATCH connect_error", async () => {
    const { SocketManager } = await import("../socket.js");
    const states: string[] = [];
    const mgr = new SocketManager(() => "tok");
    mgr.subscribe((s) => states.push(s));

    mgr.connect("world-1");
    latestMockSocket!.emit("connect_error", new Error("PROTOCOL_MISMATCH"));

    expect(states).toContain("protocol_mismatch");
    mgr.disconnect();
  });

  it("disconnect() returns to disconnected", async () => {
    const { SocketManager } = await import("../socket.js");
    const mgr = new SocketManager(() => "tok");

    mgr.connect("world-1");
    latestMockSocket!.connected = true;
    latestMockSocket!.emit("connect");

    mgr.disconnect();
    expect(mgr.state).toBe("disconnected");
  });

  it("subscribe returns an unsubscribe function", async () => {
    const { SocketManager } = await import("../socket.js");
    const calls: string[] = [];
    const mgr = new SocketManager(() => "tok");

    const unsub = mgr.subscribe((s) => calls.push(s));
    mgr.connect("world-1");
    const before = calls.length;

    unsub();
    latestMockSocket!.emit("connect");

    // No new calls after unsubscribe
    expect(calls.length).toBe(before);
    mgr.disconnect();
  });

  it("passes token to socket.io auth on connect", async () => {
    const { SocketManager } = await import("../socket.js");
    const mgr = new SocketManager(() => "my-token-123");

    mgr.connect("world-abc");

    expect(latestMockSocket!.auth).toMatchObject({ token: "my-token-123" });
    mgr.disconnect();
  });

  it("passes PROTOCOL_VERSION in auth", async () => {
    const { SocketManager } = await import("../socket.js");
    const { PROTOCOL_VERSION } = await import("@fusion/shared");
    const mgr = new SocketManager(() => "tok");

    mgr.connect("world-abc");

    expect(latestMockSocket!.auth).toMatchObject({ protocolVersion: PROTOCOL_VERSION });
    mgr.disconnect();
  });
});
