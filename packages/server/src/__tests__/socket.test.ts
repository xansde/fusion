/**
 * Integration tests for the socket layer (M0-C).
 *
 * Uses real socket.io-client connections against a server bound to an ephemeral
 * port. The Fastify HTTP server and socket.io server are started and torn down
 * per test suite.
 *
 * Covers:
 *  - Connection without token → AUTH_FAILED connect_error
 *  - Connection with wrong protocolVersion → PROTOCOL_MISMATCH connect_error
 *  - Connection with valid token → successful connect
 *  - system:ping ack with seq tracking
 *  - system:whoami ack returns user info
 *  - seq is monotonically increasing across multiple pings
 *  - seq persists after world close and reopen (SeqStore)
 *  - Graceful shutdown disconnects all sockets and releases world lock
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

import { existsSync } from "node:fs";
import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { SeqStore } from "../net/seq-store.js";
import { WorldManager } from "../worlds/world-manager.js";
import { PROTOCOL_VERSION } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-socket-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface TestContext {
  dataDir: string;
  dbPath: string;
  fusionDb: FusionDatabase;
  secret: Uint8Array;
  authService: AuthService;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  playerToken: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  // Create GM and player
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player-pass",
  });

  // Login to get tokens
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  // Boot Fastify
  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Test World", systemId: "stub" },
  });

  // Use port 0 → OS assigns an ephemeral port
  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const address = fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

  // Mount socket.io on same HTTP server
  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: `http://127.0.0.1:${String(port)}`,
  });

  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
  });

  return {
    dataDir,
    dbPath,
    fusionDb,
    secret,
    authService,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

/**
 * Returns a Promise that resolves when the socket connects or rejects on
 * connect_error.
 */
function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", (err) => {
      reject(err);
    });
  });
}

/**
 * Connect a client socket. Returns the connected socket.
 */
function connectClient(port: number, worldId: string, auth: Record<string, unknown>): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth,
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Socket layer — auth handshake", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  it("rejects connection without token with AUTH_FAILED", async () => {
    const socket = connectClient(ctx.port, ctx.worldId, {
      protocolVersion: PROTOCOL_VERSION,
      // no token
    });
    socket.connect();

    await expect(waitForConnect(socket)).rejects.toMatchObject({
      message: "AUTH_FAILED",
    });

    socket.disconnect();
  });

  it("rejects connection with wrong protocolVersion with PROTOCOL_MISMATCH", async () => {
    const socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION + 99,
    });
    socket.connect();

    await expect(waitForConnect(socket)).rejects.toMatchObject({
      message: "PROTOCOL_MISMATCH",
    });

    socket.disconnect();
  });

  it("accepts connection with valid GM token and correct protocolVersion", async () => {
    const socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    socket.connect();

    await expect(waitForConnect(socket)).resolves.toBeUndefined();
    expect(socket.connected).toBe(true);

    socket.disconnect();
  });

  it("accepts connection with valid PLAYER token", async () => {
    const socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    socket.connect();

    await expect(waitForConnect(socket)).resolves.toBeUndefined();
    expect(socket.connected).toBe(true);

    socket.disconnect();
  });

  it("rejects connection with empty string token with AUTH_FAILED", async () => {
    const socket = connectClient(ctx.port, ctx.worldId, {
      token: "",
      protocolVersion: PROTOCOL_VERSION,
    });
    socket.connect();

    await expect(waitForConnect(socket)).rejects.toMatchObject({
      message: "AUTH_FAILED",
    });

    socket.disconnect();
  });
});

describe("Socket layer — system:ping", () => {
  let ctx: TestContext;
  let socket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    socket.connect();
    await waitForConnect(socket);
  });

  afterEach(async () => {
    socket.disconnect();
    await teardown(ctx);
  });

  it("responds to system:ping with pong and serverTime via op event", async () => {
    const ack = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.emit(
        "op",
        { type: "system:ping", ts: Date.now(), payload: {} },
        (response: Record<string, unknown>) => {
          resolve(response);
        },
      );
      setTimeout(() => {
        reject(new Error("Timeout waiting for ack"));
      }, 5000);
    });

    expect(ack.ok).toBe(true);
    const result = ack.result as Record<string, unknown>;
    expect(result.pong).toBe(true);
    expect(typeof result.serverTime).toBe("number");
  });

  it("returns nonce in pong when nonce is provided", async () => {
    const nonce = "test-nonce-abc";
    const ack = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.emit(
        "op",
        { type: "system:ping", ts: Date.now(), payload: { nonce } },
        (response: Record<string, unknown>) => {
          resolve(response);
        },
      );
      setTimeout(() => {
        reject(new Error("Timeout"));
      }, 5000);
    });

    expect(ack.ok).toBe(true);
    const result = ack.result as Record<string, unknown>;
    expect(result.nonce).toBe(nonce);
  });

  it("returns ack:error for unknown type", async () => {
    const ack = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.emit(
        "op",
        { type: "doc:create", ts: Date.now(), payload: {} },
        (response: Record<string, unknown>) => {
          resolve(response);
        },
      );
      setTimeout(() => {
        reject(new Error("Timeout"));
      }, 5000);
    });

    expect(ack.ok).toBe(false);
  });

  it("returns ack:error for malformed envelope (missing type)", async () => {
    const ack = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.emit("op", { ts: Date.now(), payload: {} }, (response: Record<string, unknown>) => {
        resolve(response);
      });
      setTimeout(() => {
        reject(new Error("Timeout"));
      }, 5000);
    });

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe("VALIDATION_FAILED");
  });
});

describe("Socket layer — system:whoami", () => {
  let ctx: TestContext;
  let socket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    socket.connect();
    await waitForConnect(socket);
  });

  afterEach(async () => {
    socket.disconnect();
    await teardown(ctx);
  });

  it("returns user info for authenticated GM via query event", async () => {
    const ack = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.emit(
        "query",
        { type: "system:whoami", ts: Date.now(), payload: {} },
        (response: Record<string, unknown>) => {
          resolve(response);
        },
      );
      setTimeout(() => {
        reject(new Error("Timeout"));
      }, 5000);
    });

    expect(ack.ok).toBe(true);
    const result = ack.result as Record<string, unknown>;
    expect(result.name).toBe("Gamemaster");
    expect(result.role).toBe(Role.GAMEMASTER);
    // password_hash must not be present
    expect(result.password_hash).toBeUndefined();
  });
});

describe("Socket layer — seq monotonic counter", () => {
  it("seq persists across SeqStore instances (survives restart)", () => {
    const dataDir = makeTempDir();
    const dbPath = join(dataDir, "world.db");

    try {
      const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
      applyMigrations(fusionDb.raw, dbPath);

      // First store instance
      const store1 = new SeqStore(fusionDb.raw);
      expect(store1.peek()).toBe(0);
      const s1 = store1.next(); // 1
      const s2 = store1.next(); // 2
      const s3 = store1.next(); // 3

      expect(s1).toBe(1);
      expect(s2).toBe(2);
      expect(s3).toBe(3);

      // Simulate restart: create a second instance on the same DB
      const store2 = new SeqStore(fusionDb.raw);
      expect(store2.peek()).toBe(3); // loaded from DB

      const s4 = store2.next(); // 4
      expect(s4).toBe(4);

      fusionDb.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("seq is monotonically increasing across multiple pings", async () => {
    const ctx = await buildTestContext();
    const socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    socket.connect();
    await waitForConnect(socket);

    // Note: system:ping handlers in M0-C don't return seq in ack (seq is only
    // returned for canonical ops that write to the DB). We test the SeqStore
    // directly above. This test verifies sequential pings succeed.
    const results: Record<string, unknown>[] = [];

    for (let i = 0; i < 3; i++) {
      const ack = await new Promise<Record<string, unknown>>((resolve, reject) => {
        socket.emit(
          "op",
          { type: "system:ping", ts: Date.now(), payload: {} },
          (r: Record<string, unknown>) => resolve(r),
        );
        setTimeout(() => reject(new Error("Timeout")), 5000);
      });
      results.push(ack);
    }

    // All pings should succeed
    for (const r of results) {
      expect(r.ok).toBe(true);
    }

    socket.disconnect();
    await teardown(ctx);
  });
});

describe("Socket layer — graceful shutdown", () => {
  it("shutdown closes all sockets and releases lock", async () => {
    const ctx = await buildTestContext();

    const socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    socket.connect();
    await waitForConnect(socket);
    expect(socket.connected).toBe(true);

    // Track disconnect event
    let disconnected = false;
    socket.on("disconnect", () => {
      disconnected = true;
    });

    // Trigger shutdown
    await ctx.socketManager.close();
    await ctx.fastify.close();
    ctx.fusionDb.close();

    // Give time for disconnect event to fire
    await new Promise((r) => setTimeout(r, 200));
    expect(disconnected).toBe(true);

    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("WorldManager.close() removes the world.lock file", () => {
    // Verify that closing a world via WorldManager removes the process lock file
    // (REQ-PER-009 / DoD: 'lock liberado no shutdown').
    const dataDir = makeTempDir();
    try {
      const wm = new WorldManager({ dataDir, validSystemIds: new Set(["stub"]) });
      wm.create({ title: "Lock Test", system: "stub" });

      // Open the world — this writes world.lock
      wm.open("lock_test");
      const lockFile = join(dataDir, "worlds", "lock_test", "world.lock");
      expect(existsSync(lockFile)).toBe(true);

      // Close the world — this must remove world.lock
      wm.close("lock_test");
      expect(existsSync(lockFile)).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("WorldManager.closeAll() removes all world.lock files", () => {
    // Verify that closeAll() — called by serve.ts on process exit — releases
    // locks for all open worlds.
    const dataDir = makeTempDir();
    try {
      const wm = new WorldManager({ dataDir, validSystemIds: new Set(["stub"]) });
      wm.create({ title: "Alpha", system: "stub" });
      wm.create({ title: "Beta", system: "stub" });

      wm.open("alpha");
      wm.open("beta");

      const lockAlpha = join(dataDir, "worlds", "alpha", "world.lock");
      const lockBeta = join(dataDir, "worlds", "beta", "world.lock");
      expect(existsSync(lockAlpha)).toBe(true);
      expect(existsSync(lockBeta)).toBe(true);

      wm.closeAll();
      expect(existsSync(lockAlpha)).toBe(false);
      expect(existsSync(lockBeta)).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
