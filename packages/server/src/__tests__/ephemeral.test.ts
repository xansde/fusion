/**
 * Integration tests for ephemeral presence handlers (M1-E).
 *
 * Tests multi-client scenarios using real socket.io connections:
 *   - cursor:move arrives at others but NOT the sender
 *   - presence:ping arrives at ALL clients including sender
 *   - cursor rate limit: excess events are dropped (sender receives no bounce back anyway;
 *     verified by checking that rapid-fire events don't cause unexpected broadcasts)
 *   - ruler:update and ruler:clear rebroadcast to all
 *   - Nothing ephemeral appears in resync / snapshot
 *
 * REQ-NET-040..044, REQ-NET-071, D7
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

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import type { Envelope } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-ephemeral-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  playerToken: string;
  player2Token: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-world-eph";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player1 } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
  });
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const p1Login = await authService.login({
    userId: player1.id,
    password: "player1-pass",
    ip: "127.0.0.1",
  });
  const p2Login = await authService.login({
    userId: player2.id,
    password: "player2-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Ephemeral Test", systemId: "stub" },
  });

  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const address = fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

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
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: p1Login.accessToken,
    player2Token: p2Login.accessToken,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(port: number, worldId: string, token: string): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth: { token, protocolVersion: PROTOCOL_VERSION },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function waitForEphemeral(
  socket: ClientSocket,
  type: string,
  timeoutMs = 2000,
): Promise<Envelope<unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ephemeral type="${type}"`));
    }, timeoutMs);

    const handler = (envelope: Envelope<unknown>): void => {
      if (envelope.type === type) {
        clearTimeout(timer);
        socket.off("ephemeral", handler);
        resolve(envelope);
      }
    };

    socket.on("ephemeral", handler);
  });
}

function waitForNoEphemeral(socket: ClientSocket, type: string, windowMs = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Envelope<unknown>): void => {
      if (envelope.type === type) {
        socket.off("ephemeral", handler);
        reject(new Error(`Unexpected ephemeral type="${type}" received`));
      }
    };
    socket.on("ephemeral", handler);
    setTimeout(() => {
      socket.off("ephemeral", handler);
      resolve();
    }, windowMs);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Ephemeral handlers — presence:cursor", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();

    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);

    gmSocket.connect();
    playerSocket.connect();

    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("cursor:move arrives at other clients but NOT the sender", async () => {
    const senderReceivedPromise = waitForNoEphemeral(gmSocket, "presence:cursor", 500);
    const receiverReceivedPromise = waitForEphemeral(playerSocket, "presence:cursor", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:cursor",
      ts: Date.now(),
      payload: { x: 100, y: 200 },
    });

    const [, received] = await Promise.all([senderReceivedPromise, receiverReceivedPromise]);
    expect(received.type).toBe("presence:cursor");
    const payload = received.payload as Record<string, unknown>;
    expect(payload.x).toBe(100);
    expect(payload.y).toBe(200);
  });

  it("cursor payload is forwarded with userId attached", async () => {
    const receiverPromise = waitForEphemeral(playerSocket, "presence:cursor", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:cursor",
      ts: Date.now(),
      payload: { x: 50, y: 75 },
    });

    const envelope = await receiverPromise;
    const payload = envelope.payload as Record<string, unknown>;
    expect(typeof payload.userId).toBe("string");
    expect(payload.userId).toBeTruthy();
  });
});

describe("Ephemeral handlers — presence:ping", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("presence:ping arrives at ALL clients including sender", async () => {
    const senderReceivedPromise = waitForEphemeral(gmSocket, "presence:ping", 2000);
    const receiverReceivedPromise = waitForEphemeral(playerSocket, "presence:ping", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:ping",
      ts: Date.now(),
      payload: { x: 300, y: 400, color: "#ff0000" },
    });

    const [senderEnv, receiverEnv] = await Promise.all([
      senderReceivedPromise,
      receiverReceivedPromise,
    ]);

    // Both should receive the ping
    expect(senderEnv.type).toBe("presence:ping");
    expect(receiverEnv.type).toBe("presence:ping");

    const sp = senderEnv.payload as Record<string, unknown>;
    const rp = receiverEnv.payload as Record<string, unknown>;
    expect(sp.x).toBe(300);
    expect(sp.y).toBe(400);
    expect(rp.x).toBe(300);
    expect(rp.y).toBe(400);
  });

  it("ping payload includes userId from sender", async () => {
    const receiverPromise = waitForEphemeral(playerSocket, "presence:ping", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:ping",
      ts: Date.now(),
      payload: { x: 10, y: 20 },
    });

    const envelope = await receiverPromise;
    const payload = envelope.payload as Record<string, unknown>;
    expect(typeof payload.userId).toBe("string");
  });
});

describe("Ephemeral handlers — presence:ruler", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("ruler:update rebroadcasts to all clients including sender", async () => {
    const senderPromise = waitForEphemeral(gmSocket, "presence:ruler", 2000);
    const receiverPromise = waitForEphemeral(playerSocket, "presence:ruler", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:ruler",
      ts: Date.now(),
      payload: {
        waypoints: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      },
    });

    const [sEnv, rEnv] = await Promise.all([senderPromise, receiverPromise]);

    expect(sEnv.type).toBe("presence:ruler");
    expect(rEnv.type).toBe("presence:ruler");
    const sp = sEnv.payload as Record<string, unknown>;
    expect(Array.isArray(sp.waypoints)).toBe(true);
  });

  it("ruler:clear rebroadcasts userId to all clients", async () => {
    const senderPromise = waitForEphemeral(gmSocket, "presence:ruler:clear", 2000);
    const receiverPromise = waitForEphemeral(playerSocket, "presence:ruler:clear", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:ruler:clear",
      ts: Date.now(),
      payload: {},
    });

    const [sEnv, rEnv] = await Promise.all([senderPromise, receiverPromise]);

    expect(sEnv.type).toBe("presence:ruler:clear");
    expect(rEnv.type).toBe("presence:ruler:clear");
    const sp = sEnv.payload as Record<string, unknown>;
    expect(typeof sp.userId).toBe("string");
  });
});

describe("Ephemeral handlers — rate limiting", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("cursor rate limit: rapid-fire events cause some to be dropped", async () => {
    // Send 10 cursor events very quickly (much faster than 50 ms min interval)
    const received: unknown[] = [];
    playerSocket.on("ephemeral", (env: Envelope<unknown>) => {
      if (env.type === "presence:cursor") {
        received.push(env);
      }
    });

    for (let i = 0; i < 10; i++) {
      gmSocket.emit("ephemeral", {
        type: "presence:cursor",
        ts: Date.now(),
        payload: { x: i * 10, y: i * 10 },
      });
    }

    // Wait enough time for all to propagate if they weren't rate-limited
    await new Promise<void>((resolve) => setTimeout(resolve, 400));

    // At 50 ms min interval, only ~1 event should pass in a burst of 10 rapid messages
    // (The first one is always allowed, subsequent ones within 50 ms are dropped)
    expect(received.length).toBeLessThan(10);
    // At least 1 should get through
    expect(received.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Ephemeral events — do not appear in resync/snapshot", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gmSocket.connect();
    await waitForConnect(gmSocket);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  it("ephemeral events are not included in world snapshot", async () => {
    // Emit some ephemeral events
    for (let i = 0; i < 3; i++) {
      gmSocket.emit("ephemeral", {
        type: "presence:cursor",
        ts: Date.now(),
        payload: { x: i * 10, y: i * 10 },
      });
    }

    // Request resync and verify no ephemeral events in the response
    const resyncResponse = await new Promise<Record<string, unknown>>((resolve, reject) => {
      gmSocket.emit(
        "op",
        { type: "resync:request", ts: Date.now(), payload: { lastSeq: 0 } },
        (ack: Record<string, unknown>) => resolve(ack),
      );
      setTimeout(() => reject(new Error("Timeout on resync")), 3000);
    });

    // The resync response should be ok and contain snapshot/delta — no ephemeral events
    expect(resyncResponse.ok).toBe(true);
    // If it's a delta, ops array should not contain presence:cursor, presence:ping etc.
    const result = resyncResponse.result as Record<string, unknown> | undefined;
    if (result && Array.isArray(result.ops)) {
      const ephemeralOps = (result.ops as Array<{ type: string }>).filter(
        (op) =>
          op.type === "presence:cursor" ||
          op.type === "presence:ping" ||
          op.type === "presence:ruler",
      );
      expect(ephemeralOps).toHaveLength(0);
    }
  });
});
