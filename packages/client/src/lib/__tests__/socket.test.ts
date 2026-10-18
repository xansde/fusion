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

  off(event: string, cb: (...args: unknown[]) => void): this {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((h) => h !== cb),
    );
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

/** socket.io's function form of `auth`: called on EVERY connect and reconnect attempt. */
type AuthFn = (cb: (data: Record<string, unknown>) => void) => void;

vi.mock("socket.io-client", () => ({
  io: vi.fn((_ns: string, opts: { auth?: Record<string, unknown> | AuthFn } = {}) => {
    const s = new MockSocket();
    s.auth = (opts.auth ?? {}) as Record<string, unknown>;
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

describe("SocketManager auth token on (re)connect", () => {
  beforeEach(() => {
    latestMockSocket = null;
    vi.resetModules();
  });

  it("asks for a FRESH token on every connection attempt, not the snapshot taken at connect()", async () => {
    // The JWT lives 15 min. A reconnect after that (Wi-Fi blip, server restart) used to resend
    // the dead snapshot, the server answered AUTH_FAILED, the manager gave up for good and only
    // F5 brought the player back.
    const { SocketManager } = await import("../socket.js");
    let live = "token-v1";
    const mgr = new SocketManager(
      () => "token-v1",
      () => Promise.resolve(live),
    );
    mgr.connect("world-abc");

    const auth = latestMockSocket!.auth as unknown as AuthFn;
    expect(typeof auth).toBe("function");

    const first = await new Promise<Record<string, unknown>>((r) => auth(r));
    expect(first).toMatchObject({ token: "token-v1" });

    live = "token-v2"; // refreshed in the meantime
    const second = await new Promise<Record<string, unknown>>((r) => auth(r));
    expect(second).toMatchObject({ token: "token-v2" });
    mgr.disconnect();
  });

  it("falls back to the stored token when the refresh itself throws", async () => {
    const { SocketManager } = await import("../socket.js");
    const mgr = new SocketManager(
      () => "stored-token",
      () => Promise.reject(new Error("network")),
    );
    mgr.connect("world-abc");

    const auth = latestMockSocket!.auth as unknown as AuthFn;
    const data = await new Promise<Record<string, unknown>>((r) => auth(r));
    expect(data).toMatchObject({ token: "stored-token" });
    mgr.disconnect();
  });
});

describe("SocketManager presence wiring (BHR-F7-06 D2)", () => {
  beforeEach(() => {
    latestMockSocket = null;
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("feeds presenceState.onlineUsers from the presence:online roster the server pushes on connect", async () => {
    const { SocketManager } = await import("../socket.js");
    const { presenceState } = await import("../presence/presenceStore.svelte.js");
    const mgr = new SocketManager(() => "tok");

    mgr.connect("world-1");
    // The server emits the roster as soon as the handshake is accepted, so the
    // listener has to exist from the moment the socket does — a listener
    // attached later (when the table screen mounts) misses that first roster
    // and the Mestre sees every player as "fora" until somebody else connects.
    latestMockSocket!.emit("ephemeral", {
      type: "presence:online",
      ts: Date.now(),
      payload: {
        users: [
          { userId: "gm-1", userName: "Gamemaster", color: "#e03030", online: true },
          { userId: "p-1", userName: "Bhrotto", color: "#1f8dd6", online: true },
        ],
      },
    });

    expect(presenceState.onlineUsers.map((u) => u.userId)).toEqual(["gm-1", "p-1"]);
    mgr.disconnect();
  });
});
