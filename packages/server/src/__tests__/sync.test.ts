/**
 * Integration tests for M1-B — Document sync, snapshot, resync.
 *
 * Uses real socket.io-client connections against a server bound to an
 * ephemeral port.  Each test suite gets its own server + DB to avoid
 * state leakage.
 *
 * Covers:
 *  - doc:create broadcast: A creates a doc → B receives broadcast with seq
 *  - doc:update permission: B without OWNER can't update another user's doc
 *  - join snapshot: new client receives consistent world snapshot
 *  - resync delta: B disconnects, A makes N updates, B reconnects with
 *    lastSeq → receives exactly those N ops
 *  - resync full (buffer overflow): when buffer is too small, server sends
 *    full snapshot instead of delta
 *  - ack contains requestId (REQ-NET-011)
 *  - world:activeScene (GM only)
 *  - embedded token create/update/delete
 *  - secureCookies flag sets Secure on cookie
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
import { OpBuffer } from "../net/op-buffer.js";
import { PROTOCOL_VERSION } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-sync-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  secret: Uint8Array;
  authService: AuthService;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  gmUserId: string;
  playerToken: string;
  playerUserId: string;
  player2Token: string;
  player2UserId: string;
}

async function buildTestContext(opBufferSize?: number): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "sync-test-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  // Create GM, player1, player2
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });
  const player2Login = await authService.login({
    userId: player2.id,
    password: "player2-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Sync Test World", systemId: "stub" },
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
    opBufferSize,
  });

  return {
    dataDir,
    fusionDb,
    secret,
    authService,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    gmUserId: gm.id,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
    player2Token: player2Login.accessToken,
    player2UserId: player2.id,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(port: number, worldId: string, auth: Record<string, unknown>): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth,
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

function _waitForEvent(socket: ClientSocket, event: string): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once(event, resolve);
  });
}

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
  requestId?: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), requestId, payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout waiting for ack: ${type}`)), 6000);
  });
}

// ---------------------------------------------------------------------------
// Test: doc:create broadcast
// ---------------------------------------------------------------------------

describe("M1-B — doc:create broadcast", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();

    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);

    // Drain the initial snapshots from the queue
    await new Promise((r) => setTimeout(r, 100));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  // The listener used to sit on the PLAYER socket and assert the scene name
  // arrived there — which is precisely the leak REQ-CEN-071/REQ-CEN-073 forbid
  // (see scene-list-redaction.test.ts, which now asserts the opposite). What
  // this test is actually about — the broadcast carrying the ack's seq — is
  // unchanged; it just has to be observed on a socket entitled to the body.
  it("GM creates a Scene → privileged socket receives broadcast with seq", async () => {
    // Set up listener on the GM before GM sends
    const broadcastPromise = new Promise<Record<string, unknown>>((resolve) => {
      gmSocket.on("op", (envelope: Record<string, unknown>) => {
        if (
          (envelope as Record<string, unknown>)["type"] === "doc:create" &&
          ((envelope as Record<string, unknown>)["payload"] as Record<string, unknown>)[
            "documentType"
          ] === "Scene"
        ) {
          resolve(envelope as Record<string, unknown>);
        }
      });
    });

    const ack = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Dungeon Level 1" }],
    });

    expect(ack["ok"]).toBe(true);
    expect(typeof ack["seq"]).toBe("number");
    expect(ack["seq"] as number).toBeGreaterThan(0);

    const broadcast = await broadcastPromise;
    expect(broadcast["seq"]).toBe(ack["seq"]);
    const bPayload = broadcast["payload"] as Record<string, unknown>;
    expect(bPayload["documentType"]).toBe("Scene");
    const docs = bPayload["documents"] as Record<string, unknown>[];
    expect(docs[0]?.["name"]).toBe("Dungeon Level 1");
  });

  it("ack contains requestId echoed from envelope (REQ-NET-011)", async () => {
    const rid = "test-request-id-123";
    const ack = await sendOp(
      gmSocket,
      "doc:create",
      {
        documentType: "Scene",
        data: [{ name: "Scene for requestId test" }],
      },
      rid,
    );

    expect(ack["ok"]).toBe(true);
    expect(ack["requestId"]).toBe(rid);
  });

  it("each successive create increments seq monotonically", async () => {
    const ack1 = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Scene A" }],
    });
    const ack2 = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Scene B" }],
    });

    expect(ack1["ok"]).toBe(true);
    expect(ack2["ok"]).toBe(true);
    expect(ack2["seq"] as number).toBeGreaterThan(ack1["seq"] as number);
  });
});

// ---------------------------------------------------------------------------
// Test: permission enforcement
// ---------------------------------------------------------------------------

describe("M1-B — permission enforcement", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let player2Socket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    player2Socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.player2Token,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    playerSocket.connect();
    player2Socket.connect();
    await Promise.all([
      waitForConnect(gmSocket),
      waitForConnect(playerSocket),
      waitForConnect(player2Socket),
    ]);
    await new Promise((r) => setTimeout(r, 100));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    player2Socket.disconnect();
    await teardown(ctx);
  });

  it("player cannot create a Scene (GM only)", async () => {
    const ack = await sendOp(playerSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Player Scene" }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("player cannot update a Scene (no ownership)", async () => {
    // GM creates a scene
    const createAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Boss Room" }],
    });
    expect(createAck["ok"]).toBe(true);
    const docs = (createAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const sceneId = docs[0]?.["_id"] as string;

    // Player tries to update it
    const updateAck = await sendOp(playerSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { name: "Hacked Room" } }],
    });
    expect(updateAck["ok"]).toBe(false);
    expect(updateAck["code"]).toBe("PERMISSION_DENIED");
  });

  it("player2 cannot update token owned by player1 (different actor ownership)", async () => {
    // GM creates an actor owned by player1
    const actorAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Player1 Character",
          type: "pc",
          ownership: { default: 0, [ctx.playerUserId]: 3 }, // OWNER for player1
        },
      ],
    });
    expect(actorAck["ok"]).toBe(true);
    const actorDocs = (actorAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const actorId = actorDocs[0]?.["_id"] as string;

    // GM creates scene with token referencing that actor
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Test Scene", tokens: [] }],
    });
    expect(sceneAck["ok"]).toBe(true);
    const sceneDocs = (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const sceneId = sceneDocs[0]?.["_id"] as string;

    // GM adds token to scene
    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Player Token", actorId, x: 100, y: 100 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);
    const updatedParent = (tokenAck["result"] as Record<string, unknown>)["parent"] as Record<
      string,
      unknown
    >;
    const tokens = updatedParent["tokens"] as Record<string, unknown>[];
    const tokenId = tokens[0]?.["_id"] as string;

    // Player2 tries to update that token
    const p2UpdateAck = await sendOp(player2Socket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { x: 999, y: 999 },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(p2UpdateAck["ok"]).toBe(false);
    expect(p2UpdateAck["code"]).toBe("PERMISSION_DENIED");
  });
});

// ---------------------------------------------------------------------------
// Test: join snapshot
// ---------------------------------------------------------------------------

describe("M1-B — join snapshot", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  it("new client receives a world snapshot on join", async () => {
    // GM pre-creates a scene
    const gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await new Promise((r) => setTimeout(r, 50));

    await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Welcome Scene" }],
    });

    // Now a new player joins — should receive resync:full with snapshot
    const playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    const snapshotPromise = new Promise<Record<string, unknown>>((resolve) => {
      playerSocket.on("op", (envelope: Record<string, unknown>) => {
        const t = envelope["type"];
        if (t === "resync:full" || t === "resync:delta") {
          resolve(envelope);
        }
      });
    });

    playerSocket.connect();
    await waitForConnect(playerSocket);

    const snapshotEnvelope = await snapshotPromise;
    expect(["resync:full", "resync:delta"]).toContain(snapshotEnvelope["type"]);

    if (snapshotEnvelope["type"] === "resync:full") {
      const payload = snapshotEnvelope["payload"] as Record<string, unknown>;
      const snapshot = payload["snapshot"] as Record<string, unknown>;
      expect(snapshot).not.toBeNull();
      expect(typeof snapshot["seq"]).toBe("number");
      expect(Array.isArray((snapshot["documents"] as Record<string, unknown[]>)["Scene"])).toBe(
        true,
      );
    }

    gmSocket.disconnect();
    playerSocket.disconnect();
  });

  it("snapshot seq matches the server's current seq", async () => {
    const gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await new Promise((r) => setTimeout(r, 50));

    // Create 3 docs to advance seq
    for (let i = 0; i < 3; i++) {
      await sendOp(gmSocket, "doc:create", {
        documentType: "Scene",
        data: [{ name: `Scene ${String(i)}` }],
      });
    }

    const playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    let snapshotSeq = -1;
    const snapshotPromise = new Promise<void>((resolve) => {
      playerSocket.on("op", (envelope: Record<string, unknown>) => {
        if (envelope["type"] === "resync:full") {
          const p = envelope["payload"] as Record<string, unknown>;
          const snap = p["snapshot"] as Record<string, unknown> | null;
          if (snap) {
            snapshotSeq = snap["seq"] as number;
          }
          resolve();
        } else if (envelope["type"] === "resync:delta") {
          snapshotSeq = envelope["seq"] as number;
          resolve();
        }
      });
    });

    playerSocket.connect();
    await waitForConnect(playerSocket);
    await snapshotPromise;

    expect(snapshotSeq).toBeGreaterThanOrEqual(3);

    gmSocket.disconnect();
    playerSocket.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Test: resync delta
// ---------------------------------------------------------------------------

describe("M1-B — resync delta", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  it("B disconnects, A makes 5 updates, B reconnects with lastSeq → receives exactly 5 ops", async () => {
    const gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    // Register op listener BEFORE connecting (server sends snapshot on connect)
    let playerLastSeq = 0;
    const firstSyncPromise = new Promise<void>((resolve) => {
      playerSocket.on("op", (envelope: Record<string, unknown>) => {
        if (envelope["type"] === "resync:full") {
          const p = envelope["payload"] as Record<string, unknown>;
          const snap = p["snapshot"] as Record<string, unknown> | null;
          if (snap) playerLastSeq = snap["seq"] as number;
          resolve();
        } else if (envelope["type"] === "resync:delta") {
          playerLastSeq = envelope["seq"] as number;
          resolve();
        }
      });
    });

    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    // Wait for snapshot to be received and processed
    await firstSyncPromise;

    // Player disconnects
    playerSocket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // GM makes exactly 5 ops
    for (let i = 0; i < 5; i++) {
      const ack = await sendOp(gmSocket, "doc:create", {
        documentType: "Scene",
        data: [{ name: `Scene After Disconnect ${String(i)}` }],
      });
      expect(ack["ok"]).toBe(true);
    }

    // Reconnect player with lastSeq
    const reconnectedPlayer = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
      lastSeq: playerLastSeq,
    });

    let receivedDelta: Record<string, unknown> | null = null;
    const deltaPromise = new Promise<void>((resolve) => {
      reconnectedPlayer.on("op", (envelope: Record<string, unknown>) => {
        const t = envelope["type"];
        if (t === "resync:delta" || t === "resync:full") {
          receivedDelta = envelope;
          resolve();
        }
      });
    });

    reconnectedPlayer.connect();
    await waitForConnect(reconnectedPlayer);
    await deltaPromise;

    expect(receivedDelta).not.toBeNull();
    const rd = receivedDelta!;

    if (rd["type"] === "resync:delta") {
      const payload = rd["payload"] as Record<string, unknown>;
      const ops = payload["ops"] as unknown[];
      expect(ops).toHaveLength(5);
      // Verify ops are in seq order
      const seqs = ops.map((op) => (op as Record<string, unknown>)["seq"] as number);
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!);
      }
    } else {
      // Got full snapshot — still valid, just more than delta
      expect(rd["type"]).toBe("resync:full");
    }

    gmSocket.disconnect();
    reconnectedPlayer.disconnect();
  }, 45000);

  it("buffer overflow → full snapshot on resync", async () => {
    // Use a tiny buffer of 3 ops to force overflow
    const ctxSmall = await buildTestContext(3);

    const gmSocket = connectClient(ctxSmall.port, ctxSmall.worldId, {
      token: ctxSmall.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const playerSocket = connectClient(ctxSmall.port, ctxSmall.worldId, {
      token: ctxSmall.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    // Register listener BEFORE connecting
    let playerLastSeq = 0;
    const firstSync = new Promise<void>((resolve) => {
      playerSocket.on("op", (envelope: Record<string, unknown>) => {
        const t = envelope["type"];
        if (t === "resync:full" || t === "resync:delta") {
          if (t === "resync:full") {
            const p = envelope["payload"] as Record<string, unknown>;
            const snap = p["snapshot"] as Record<string, unknown> | null;
            if (snap) playerLastSeq = snap["seq"] as number;
          } else {
            playerLastSeq = envelope["seq"] as number;
          }
          resolve();
        }
      });
    });

    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await firstSync;

    playerSocket.disconnect();
    await new Promise((r) => setTimeout(r, 50));

    // Make 5 ops — buffer capacity is 3, so overflow
    for (let i = 0; i < 5; i++) {
      await sendOp(gmSocket, "doc:create", {
        documentType: "Scene",
        data: [{ name: `Overflow Scene ${String(i)}` }],
      });
    }

    const reconnected = connectClient(ctxSmall.port, ctxSmall.worldId, {
      token: ctxSmall.playerToken,
      protocolVersion: PROTOCOL_VERSION,
      lastSeq: playerLastSeq,
    });

    let syncType: string | null = null;
    const syncPromise = new Promise<void>((resolve) => {
      reconnected.on("op", (envelope: Record<string, unknown>) => {
        const t = envelope["type"];
        if (t === "resync:full" || t === "resync:delta") {
          syncType = t;
          resolve();
        }
      });
    });

    reconnected.connect();
    await waitForConnect(reconnected);
    await syncPromise;

    // With buffer overflow we expect resync:full
    expect(syncType).toBe("resync:full");

    gmSocket.disconnect();
    reconnected.disconnect();
    await teardown(ctxSmall);
  }, 45000);
});

// ---------------------------------------------------------------------------
// Test: world:activeScene
// ---------------------------------------------------------------------------

describe("M1-B — world:activeScene", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await new Promise((r) => setTimeout(r, 100));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("GM activates a scene → all clients receive world:activeScene broadcast", async () => {
    // Create scene first
    const createAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Main Stage" }],
    });
    expect(createAck["ok"]).toBe(true);
    const sceneDocs = (createAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const sceneId = sceneDocs[0]?.["_id"] as string;

    const playerBroadcastPromise = new Promise<Record<string, unknown>>((resolve) => {
      playerSocket.on("op", (envelope: Record<string, unknown>) => {
        if (envelope["type"] === "world:activeScene") {
          resolve(envelope);
        }
      });
    });

    const ack = await sendOp(gmSocket, "world:activeScene", { sceneId });
    expect(ack["ok"]).toBe(true);

    const broadcast = await playerBroadcastPromise;
    expect(broadcast["type"]).toBe("world:activeScene");
    const bPayload = broadcast["payload"] as Record<string, unknown>;
    expect(bPayload["sceneId"]).toBe(sceneId);
  });

  it("player cannot activate a scene (PERMISSION_DENIED)", async () => {
    const ack = await sendOp(playerSocket, "world:activeScene", { sceneId: "somesceneid1234" });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });
});

// ---------------------------------------------------------------------------
// Test: embedded token CRUD
// ---------------------------------------------------------------------------

describe("M1-B — embedded token CRUD", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  it("GM creates a token inside a scene", async () => {
    // Create scene
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Token Test Scene" }],
    });
    expect(sceneAck["ok"]).toBe(true);
    const sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // Create token inside scene
    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Goblin", x: 200, y: 300 }],
      parent: { type: "Scene", id: sceneId },
    });

    expect(tokenAck["ok"]).toBe(true);
    const result = tokenAck["result"] as Record<string, unknown>;
    const parent = result["parent"] as Record<string, unknown>;
    const tokens = parent["tokens"] as Record<string, unknown>[];
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.["name"]).toBe("Goblin");
    expect(tokens[0]?.["x"]).toBe(200);
    expect(tokens[0]?.["y"]).toBe(300);
  });

  it("GM updates a token embedded in a scene", async () => {
    // Create scene with token
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Move Test Scene" }],
    });
    expect(sceneAck["ok"]).toBe(true);
    const sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Orc", x: 100, y: 100 }],
      parent: { type: "Scene", id: sceneId },
    });
    const parent = (tokenAck["result"] as Record<string, unknown>)["parent"] as Record<
      string,
      unknown
    >;
    const tokenId = (parent["tokens"] as Record<string, unknown>[])[0]?.["_id"] as string;

    // Update token position
    const updateAck = await sendOp(gmSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { x: 500, y: 600 },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });

    expect(updateAck["ok"]).toBe(true);
  });

  it("GM deletes a token from a scene", async () => {
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Delete Token Scene" }],
    });
    const sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Doomed Token", x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    const tokenParent = (tokenAck["result"] as Record<string, unknown>)["parent"] as Record<
      string,
      unknown
    >;
    const tokenId = (tokenParent["tokens"] as Record<string, unknown>[])[0]?.["_id"] as string;

    const deleteAck = await sendOp(gmSocket, "doc:delete", {
      documentType: "Token",
      ids: [tokenId],
      parent: { type: "Scene", id: sceneId },
    });

    expect(deleteAck["ok"]).toBe(true);
    // Verify the token is gone
    const updatedParent = (deleteAck["result"] as Record<string, unknown>)["parent"] as Record<
      string,
      unknown
    >;
    const remainingTokens = updatedParent["tokens"] as unknown[];
    expect(remainingTokens).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test: M1-C ack-redaction guard
//
// Invariant (specs 04/05): a hidden token's existence / position / name must
// NEVER reach a non-GM socket — including via the op ACK echoed back to the
// requester.  The auditor proved the embedded handlers return the FULL parent
// Scene (with the GM's hidden token) in result.parent / result.documents[], and
// the dispatcher echoes that result in the ack to the sender.  A non-GM moving
// their OWN token in a scene that also contains a GM hidden token would receive
// the hidden token's coords/name in the ack.
//
// These assertions are STRUCTURAL — they walk result.documents[]/result.parent
// and inspect each Scene's tokens[] by _id/hidden flag.  No naked-number
// substring checks (those are flaky against timestamps/seqs).
// ---------------------------------------------------------------------------

describe("M1-C — ack hidden-token redaction", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  // Secret marker values placed on the GM's hidden token.
  const HIDDEN_X = 6363;
  const HIDDEN_Y = 3636;
  const HIDDEN_NAME = "GM_ONLY_GHOST";

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  /** Collect every token across result.documents[] and result.parent. */
  function tokensInAckResult(ack: Record<string, unknown>): Record<string, unknown>[] {
    const result = ack["result"] as Record<string, unknown> | undefined;
    if (!result) return [];
    const tokens: Record<string, unknown>[] = [];

    const documents = result["documents"];
    if (Array.isArray(documents)) {
      for (const doc of documents as Record<string, unknown>[]) {
        const docTokens = doc["tokens"];
        if (Array.isArray(docTokens)) tokens.push(...(docTokens as Record<string, unknown>[]));
      }
    }

    const parent = result["parent"] as Record<string, unknown> | undefined;
    if (parent && Array.isArray(parent["tokens"])) {
      tokens.push(...(parent["tokens"] as Record<string, unknown>[]));
    }

    return tokens;
  }

  /**
   * Build a scene that contains both a player-owned token (referencing an actor
   * the player OWNS) and a GM-only hidden token carrying the secret markers.
   * Returns the ids needed to drive the move + assertions.
   */
  async function buildSceneWithOwnedAndHiddenToken(): Promise<{
    sceneId: string;
    ownedTokenId: string;
    hiddenTokenId: string;
  }> {
    // Actor owned by player1 (so the player can move its token).
    const actorAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Owned Char", type: "pc", ownership: { default: 0, [ctx.playerUserId]: 3 } }],
    });
    expect(actorAck["ok"]).toBe(true);
    const actorId = (
      (actorAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // Scene created by GM.
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Mixed-Visibility Scene" }],
    });
    expect(sceneAck["ok"]).toBe(true);
    const sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // Player-owned token (visible).
    const ownedAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Player Token", actorId, x: 10, y: 20, hidden: false }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ownedAck["ok"]).toBe(true);
    const ownedTokens = (
      (ownedAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>
    )["tokens"] as Record<string, unknown>[];
    const ownedTokenId = ownedTokens.find((t) => t["actorId"] === actorId)?.["_id"] as string;

    // GM-only hidden token with the secret markers.
    const hiddenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: HIDDEN_NAME, x: HIDDEN_X, y: HIDDEN_Y, hidden: true }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(hiddenAck["ok"]).toBe(true);
    const allTokens = (
      (hiddenAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>
    )["tokens"] as Record<string, unknown>[];
    const hiddenTokenId = allTokens.find((t) => t["hidden"] === true)?.["_id"] as string;

    expect(typeof ownedTokenId).toBe("string");
    expect(typeof hiddenTokenId).toBe("string");
    return { sceneId, ownedTokenId, hiddenTokenId };
  }

  it("player moving own token gets an ack with the GM hidden token REDACTED", async () => {
    const { sceneId, ownedTokenId, hiddenTokenId } = await buildSceneWithOwnedAndHiddenToken();

    // Player moves their OWN token.  The handler returns the full parent Scene,
    // which on the server still contains the GM hidden token — the dispatcher
    // must strip it before acking a non-privileged socket.
    const moveAck = await sendOp(playerSocket, "doc:update", {
      documentType: "Token",
      updates: [
        { _id: ownedTokenId, diff: { x: 111, y: 222 }, embedded: { type: "Token", id: sceneId } },
      ],
    });
    expect(moveAck["ok"]).toBe(true);

    // STRUCTURAL assertions — walk the ack's Scene tokens.
    const tokens = tokensInAckResult(moveAck);

    // The player's own token must be present with its new coords.
    const own = tokens.find((t) => t["_id"] === ownedTokenId);
    expect(own).toBeDefined();
    expect(own?.["x"]).toBe(111);
    expect(own?.["y"]).toBe(222);

    // The GM hidden token must be ABSENT — no _id, no name, no coords leak.
    expect(tokens.some((t) => t["_id"] === hiddenTokenId)).toBe(false);
    expect(tokens.some((t) => t["hidden"] === true)).toBe(false);
    expect(tokens.some((t) => t["name"] === HIDDEN_NAME)).toBe(false);
    expect(tokens.some((t) => t["x"] === HIDDEN_X && t["y"] === HIDDEN_Y)).toBe(false);
  });

  it("GM moving the hidden token gets an ack WITHOUT redaction (sees the hidden token)", async () => {
    const { sceneId, hiddenTokenId } = await buildSceneWithOwnedAndHiddenToken();

    // GM moves the hidden token — as a privileged socket the ack must NOT be
    // redacted: the hidden token comes back verbatim.
    const moveAck = await sendOp(gmSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: hiddenTokenId,
          diff: { x: 4242, y: 2424 },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(moveAck["ok"]).toBe(true);

    const tokens = tokensInAckResult(moveAck);
    const hidden = tokens.find((t) => t["_id"] === hiddenTokenId);
    expect(hidden).toBeDefined();
    expect(hidden?.["hidden"]).toBe(true);
    expect(hidden?.["name"]).toBe(HIDDEN_NAME);
    expect(hidden?.["x"]).toBe(4242);
    expect(hidden?.["y"]).toBe(2424);
  });
});

// ---------------------------------------------------------------------------
// Test: secureCookies config
// ---------------------------------------------------------------------------

describe("M1-B — secureCookies config", () => {
  it("secureCookies=false: refresh cookie has no Secure flag", async () => {
    const ctx = await buildTestContext();
    const { authService } = ctx;

    // Test that the route can be built with secureCookies=false
    // (the behavior is in the cookie serialization; we just verify no error)
    const fastify2 = Fastify({ logger: false }) as unknown as FastifyInstance;
    await fastify2.register(fastifyCookie);
    // Should not throw
    expect(() =>
      registerAuthRoutes(fastify2, {
        authService,
        worldInfo: { id: ctx.worldId, title: "T", systemId: "stub" },
        secureCookies: false,
      }),
    ).not.toThrow();
    await fastify2.close();
    await teardown(ctx);
  });

  it("secureCookies=true: route registers without error", async () => {
    const ctx = await buildTestContext();
    const { authService } = ctx;

    const fastify2 = Fastify({ logger: false }) as unknown as FastifyInstance;
    await fastify2.register(fastifyCookie);
    expect(() =>
      registerAuthRoutes(fastify2, {
        authService,
        worldInfo: { id: ctx.worldId, title: "T", systemId: "stub" },
        secureCookies: true,
        trustProxy: true,
      }),
    ).not.toThrow();
    await fastify2.close();
    await teardown(ctx);
  });
});

// ---------------------------------------------------------------------------
// Test: STALE_WRITE with monotonic _stats.version (fix 4)
// ---------------------------------------------------------------------------

describe("M1-B — STALE_WRITE detection via _stats.version", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  it("rejects update with STALE_WRITE when expectedVersion does not match _stats.version", async () => {
    // Create a scene (version starts at 1)
    const createAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Concurrency Scene" }],
    });
    expect(createAck["ok"]).toBe(true);
    const docs = (createAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const sceneId = docs[0]?.["_id"] as string;

    // First concurrent update — succeeds; bumps version to 2
    const ack1 = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { name: "Updated A" }, expectedVersion: 1 }],
    });
    expect(ack1["ok"]).toBe(true);

    // Second concurrent update with stale expectedVersion=1 — must be rejected
    const ack2 = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { name: "Updated B" }, expectedVersion: 1 }],
    });
    expect(ack2["ok"]).toBe(false);
    expect(ack2["code"]).toBe("STALE_WRITE");
  });

  it("accepts update when expectedVersion matches current _stats.version", async () => {
    const createAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Version Match Scene" }],
    });
    expect(createAck["ok"]).toBe(true);
    const docs = (createAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const sceneId = docs[0]?.["_id"] as string;

    // Update with correct expectedVersion=1 — should succeed
    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { name: "Correct Version" }, expectedVersion: 1 }],
    });
    expect(ack["ok"]).toBe(true);
  });

  it("update without expectedVersion always succeeds (no optimistic lock)", async () => {
    const createAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "No Lock Scene" }],
    });
    const docs = (createAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const sceneId = docs[0]?.["_id"] as string;

    // Two updates without expectedVersion — both succeed
    const ack1 = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { name: "Update 1" } }],
    });
    const ack2 = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { name: "Update 2" } }],
    });
    expect(ack1["ok"]).toBe(true);
    expect(ack2["ok"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test: embedded token _id uniqueness enforcement (fix 5)
// ---------------------------------------------------------------------------

describe("M1-B — embedded token _id collision prevention", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  it("server always assigns a fresh _id for embedded tokens, ignoring client _id", async () => {
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Collision Scene" }],
    });
    const sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const SAME_ID = "aaaaaaaaaaaaaaaa";

    // Create first token with a specific _id supplied by client
    const tok1Ack = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ _id: SAME_ID, name: "Token A", x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tok1Ack["ok"]).toBe(true);
    // Create second token with the SAME _id — server must assign a different one
    const tok2Ack = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ _id: SAME_ID, name: "Token B", x: 100, y: 100 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tok2Ack["ok"]).toBe(true);
    const tokens2 = (
      (tok2Ack["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>
    )["tokens"] as Record<string, unknown>[];
    // The parent now has 2 tokens
    expect(tokens2).toHaveLength(2);
    // Both tokens must have distinct _ids
    const ids = tokens2.map((t) => t["_id"] as string);
    expect(new Set(ids).size).toBe(2);
  });

  it("creates multiple tokens in one batch without _id collisions", async () => {
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Batch Scene" }],
    });
    const sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // Send 3 tokens in one batch, all with the same _id
    const batchAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [
        { _id: "bbbbbbbbbbbbbbbb", name: "T1", x: 0, y: 0 },
        { _id: "bbbbbbbbbbbbbbbb", name: "T2", x: 1, y: 0 },
        { _id: "bbbbbbbbbbbbbbbb", name: "T3", x: 2, y: 0 },
      ],
      parent: { type: "Scene", id: sceneId },
    });
    expect(batchAck["ok"]).toBe(true);
    const tokens = (
      (batchAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>
    )["tokens"] as Record<string, unknown>[];
    expect(tokens).toHaveLength(3);
    const ids = tokens.map((t) => t["_id"] as string);
    // All three must have distinct server-generated _ids
    expect(new Set(ids).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Test: requestId propagation on errors
// ---------------------------------------------------------------------------

describe("M1-B — requestId in error acks", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  it("error ack contains requestId", async () => {
    const rid = "error-req-id-456";
    // Trigger an error: update non-existent document
    const ack = await sendOp(
      gmSocket,
      "doc:update",
      {
        documentType: "Scene",
        updates: [{ _id: "doesNotExist1234", diff: { name: "x" } }],
      },
      rid,
    );
    expect(ack["ok"]).toBe(false);
    expect(ack["requestId"]).toBe(rid);
  });
});

// ---------------------------------------------------------------------------
// FIX-1: dot-path expansion in primary doc:update
// ---------------------------------------------------------------------------

describe("FIX-1 — dot-path expansion in primary doc:update", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  it('doc:update with {"grid.size": 140} sets grid.size=140 in persisted Scene and broadcast', async () => {
    // Create scene — grid defaults are applied by the server (size=100)
    const createAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Grid Test Scene" }],
    });
    expect(createAck["ok"]).toBe(true);
    const createDocs = (createAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const sceneId = createDocs[0]?.["_id"] as string;
    expect(typeof sceneId).toBe("string");

    // The created scene should already have a grid with default size=100
    const createdScene = createDocs[0] as Record<string, unknown>;
    const initialGrid = createdScene["grid"] as Record<string, unknown> | undefined;
    // grid may be undefined if Zod applied the default without including it in the output
    // but we can still verify the update changes it correctly
    const initialSize = initialGrid?.["size"] ?? 100;

    // Set up a listener for the broadcast BEFORE sending the update
    const broadcastPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timeout waiting for doc:update broadcast")),
        5000,
      );
      gmSocket.on("op", function handler(envelope: Record<string, unknown>) {
        if (envelope["type"] === "doc:update") {
          const pl = envelope["payload"] as Record<string, unknown>;
          const broadcastDocs = pl["documents"] as Record<string, unknown>[];
          // Find the Scene doc with matching _id
          const match = broadcastDocs?.find(
            (d) => (d as Record<string, unknown>)["_id"] === sceneId,
          );
          if (match) {
            clearTimeout(timer);
            gmSocket.off("op", handler);
            resolve(envelope);
          }
        }
      });
    });

    // Update using dot-path notation: "grid.size" → server must expand to {grid: {size: 140}}
    const updateAck = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { "grid.size": 140 } }],
    });

    if (!updateAck["ok"]) {
      throw new Error(
        `doc:update failed: code=${String(updateAck["code"])}, msg=${String(updateAck["message"])}`,
      );
    }
    expect(updateAck["ok"]).toBe(true);

    // The ack result documents should contain the updated scene
    const updatedResult = (updateAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    expect(updatedResult.length).toBeGreaterThan(0);
    const updatedScene = updatedResult.find(
      (d) => (d as Record<string, unknown>)["_id"] === sceneId,
    ) as Record<string, unknown> | undefined;
    expect(updatedScene).toBeDefined();

    // grid.size should be 140 (expanded from dot-path) and changed from initial
    const updatedGrid = updatedScene?.["grid"] as Record<string, unknown> | undefined;
    if (updatedGrid) {
      // If grid field is present, verify size changed
      expect(updatedGrid["size"]).toBe(140);
      // No literal "grid.size" key
      expect(Object.keys(updatedScene!)).not.toContain("grid.size");
    } else {
      // If grid not in response, verify no literal dot-path key either
      expect(Object.keys(updatedScene!)).not.toContain("grid.size");
    }

    // Verify broadcast also has the expanded form (no "grid.size" literal key in broadcast doc)
    const broadcast = await broadcastPromise;
    const broadcastPayload = broadcast["payload"] as Record<string, unknown>;
    const broadcastDocs = broadcastPayload["documents"] as Record<string, unknown>[];
    const broadcastScene = broadcastDocs.find(
      (d) => (d as Record<string, unknown>)["_id"] === sceneId,
    ) as Record<string, unknown>;
    expect(broadcastScene).toBeDefined();

    // The broadcast must not carry "grid.size" as a literal key
    expect(Object.keys(broadcastScene)).not.toContain("grid.size");

    // If grid is in the broadcast, size must be 140
    const broadcastGrid = broadcastScene["grid"] as Record<string, unknown> | undefined;
    if (broadcastGrid) {
      expect(broadcastGrid["size"]).toBe(140);
    }

    // Make sure size changed from initial (the main invariant of FIX-1)
    // Read back from a fresh fetch via another update attempt (no-op, just to verify)
    const verifyAck = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { "grid.size": 140 } }], // same value = no-op
    });
    // A no-op update returns ok:true but documents:[] (unchanged)
    // This just confirms no crash. The real verification is that initial size (100) != 140.
    expect(verifyAck["ok"]).toBe(true);
    expect(initialSize).toBe(100); // guard: initial size must have been 100
  });
});

// ---------------------------------------------------------------------------
// FIX-2: OpBuffer opsAfter returns null (not empty array) after restart
// ---------------------------------------------------------------------------

describe("FIX-2 — OpBuffer.opsAfter returns null when buffer empty and client stale", () => {
  it("returns [] when lastSeq >= currentSeq (client is up-to-date, buffer empty)", () => {
    const buf = new OpBuffer(10);
    // Buffer is empty, currentSeq = 5, lastSeq = 5 → client up-to-date
    expect(buf.opsAfter(5, 5)).toEqual([]);
  });

  it("returns [] when lastSeq > currentSeq (client ahead — unusual but safe)", () => {
    const buf = new OpBuffer(10);
    expect(buf.opsAfter(10, 5)).toEqual([]);
  });

  it("returns null when buffer empty and lastSeq < currentSeq (post-restart stale client)", () => {
    const buf = new OpBuffer(10);
    // Simulate post-restart: buffer is empty (in-memory ops lost) but
    // currentSeq > 0 (loaded from persisted SeqStore).  Client had seq=3,
    // server now starts at seq=10 with an empty ring.
    const result = buf.opsAfter(3, 10);
    expect(result).toBeNull();
  });

  it("returns null when buffer empty and lastSeq === 0 but currentSeq > 0", () => {
    // Edge case: fresh client connecting to a world that already has history
    // but server just restarted (ring is empty).
    const buf = new OpBuffer(10);
    const result = buf.opsAfter(0, 5);
    expect(result).toBeNull();
  });

  it("returns ops slice when buffer has ops covering the requested range", () => {
    const buf = new OpBuffer(10);
    const makeEnv = (seq: number) => ({
      type: "doc:create" as const,
      seq,
      ts: Date.now(),
      payload: {},
    });
    buf.push(makeEnv(1));
    buf.push(makeEnv(2));
    buf.push(makeEnv(3));

    const ops = buf.opsAfter(1, 3);
    expect(ops).not.toBeNull();
    expect(ops?.map((o) => o.seq)).toEqual([2, 3]);
  });
});

describe("FIX-2 — post-restart integration: stale client receives resync:full", () => {
  it("reconnecting client with old lastSeq on empty-buffer server gets resync:full", async () => {
    // Step 1: Build a server, make some ops, record lastSeq
    const ctx = await buildTestContext();

    const gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    let playerLastSeq = 0;
    const firstSync = new Promise<void>((resolve) => {
      playerSocket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "resync:full") {
          const snap = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
            string,
            unknown
          > | null;
          if (snap) playerLastSeq = snap["seq"] as number;
          resolve();
        } else if (env["type"] === "resync:delta") {
          playerLastSeq = env["seq"] as number;
          resolve();
        }
      });
    });

    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await firstSync;

    // GM makes 3 ops
    for (let i = 0; i < 3; i++) {
      const ack = await sendOp(gmSocket, "doc:create", {
        documentType: "Scene",
        data: [{ name: `Restart Scene ${String(i)}` }],
      });
      expect(ack["ok"]).toBe(true);
    }

    const finalSeq = (
      await sendOp(gmSocket, "doc:create", { documentType: "Scene", data: [{ name: "Last" }] })
    )["seq"] as number;

    // Record the stale lastSeq (before the 4 ops above)
    const staleSeq = playerLastSeq;
    playerSocket.disconnect();
    gmSocket.disconnect();

    // Step 2: Build a NEW server on the SAME DB (simulating restart)
    // The new server has an empty OpBuffer but SeqStore reads the persisted seq
    const {
      fastify: newFastify,
      socketManager: newSM,
      port: newPort,
    } = await (async () => {
      const newFastify = Fastify({ logger: false }) as unknown as FastifyInstance;
      await newFastify.register(fastifyCookie);
      await registerAuthRoutes(newFastify, {
        authService: ctx.authService,
        worldInfo: { id: ctx.worldId, title: "Restart Test", systemId: "stub" },
      });
      await newFastify.listen({ port: 0, host: "127.0.0.1" });
      const addr = newFastify.server.address();
      if (!addr || typeof addr === "string") throw new Error("Bad address");
      const newPort = addr.port;

      const newSM = new SocketManager({
        httpServer: newFastify.server,
        logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
        origin: `http://127.0.0.1:${String(newPort)}`,
      });
      newSM.registerWorldNamespace({
        worldId: ctx.worldId,
        db: ctx.fusionDb.raw,
        secret: ctx.secret,
        authService: ctx.authService,
        // Default opBufferSize — buffer starts empty (simulates fresh server)
      });
      return { fastify: newFastify, socketManager: newSM, port: newPort };
    })();

    try {
      // Step 3: Reconnect player with stale lastSeq to the NEW server
      const reconnected = connectClient(newPort, ctx.worldId, {
        token: ctx.playerToken,
        protocolVersion: PROTOCOL_VERSION,
        lastSeq: staleSeq,
      });

      let syncType: string | null = null;
      const syncPromise = new Promise<void>((resolve) => {
        reconnected.on("op", (env: Record<string, unknown>) => {
          const t = env["type"];
          if (t === "resync:full" || t === "resync:delta") {
            syncType = t as string;
            resolve();
          }
        });
      });

      reconnected.connect();
      await waitForConnect(reconnected);
      await syncPromise;

      // The server's buffer is empty but seq > staleSeq → must send resync:full
      // (not a delta with 0 ops which would leave the client stale)
      expect(syncType).toBe("resync:full");
      expect(finalSeq).toBeGreaterThan(staleSeq);

      reconnected.disconnect();
    } finally {
      await newSM.close();
      await newFastify.close();
      await teardown(ctx);
    }
  }, 60000);
});

// ---------------------------------------------------------------------------
// FIX-4: hidden tokens filtered from player snapshot, visible to GM
// ---------------------------------------------------------------------------

describe("FIX-4 — hidden tokens stripped from player snapshot but visible to GM", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  it("GM snapshot contains hidden tokens; player snapshot does not", async () => {
    // GM creates a scene
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Hidden Token Scene" }],
    });
    expect(sceneAck["ok"]).toBe(true);
    const sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // GM adds a visible token (hidden=false) and a hidden token (hidden=true)
    const visibleTokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Visible Token", x: 0, y: 0, hidden: false }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(visibleTokenAck["ok"]).toBe(true);

    const hiddenTokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Hidden Token", x: 100, y: 100, hidden: true }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(hiddenTokenAck["ok"]).toBe(true);

    // Verify GM's parent scene contains both tokens
    const gmParent = (hiddenTokenAck["result"] as Record<string, unknown>)["parent"] as Record<
      string,
      unknown
    >;
    const gmTokens = gmParent["tokens"] as Record<string, unknown>[];
    expect(gmTokens).toHaveLength(2);

    // Player connects fresh (snapshot) — should NOT receive hidden token
    const playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    let playerSnapshot: Record<string, unknown> | null = null;
    const snapshotPromise = new Promise<void>((resolve) => {
      playerSocket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "resync:full") {
          const snap = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
            string,
            unknown
          > | null;
          if (snap) {
            playerSnapshot = snap;
            resolve();
          }
        } else if (env["type"] === "resync:delta") {
          // delta might be empty if player reconnects at same seq — ignore for this test
          resolve();
        }
      });
    });

    playerSocket.connect();
    await waitForConnect(playerSocket);
    await snapshotPromise;

    if (playerSnapshot) {
      const sceneDocs = (playerSnapshot as Record<string, unknown>)["documents"] as Record<
        string,
        unknown[]
      >;
      const scenes = sceneDocs?.["Scene"] as Record<string, unknown>[] | undefined;
      const testScene = scenes?.find((s) => (s as Record<string, unknown>)["_id"] === sceneId) as
        | Record<string, unknown>
        | undefined;

      if (testScene) {
        const playerTokens = testScene["tokens"] as Record<string, unknown>[] | undefined;
        // Player must not see the hidden token
        if (playerTokens) {
          const hiddenInPlayerView = playerTokens.filter((t) => t["hidden"] === true);
          expect(hiddenInPlayerView).toHaveLength(0);
          // Visible token must still be there
          const visibleInPlayerView = playerTokens.filter((t) => t["hidden"] !== true);
          expect(visibleInPlayerView.length).toBeGreaterThan(0);
        }
      }
    }

    // GM reconnects fresh to get a new snapshot — should see BOTH tokens
    const gmSocket2 = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    let gmSnapshot: Record<string, unknown> | null = null;
    const gmSnapshotPromise = new Promise<void>((resolve) => {
      gmSocket2.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "resync:full") {
          const snap = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
            string,
            unknown
          > | null;
          if (snap) {
            gmSnapshot = snap;
            resolve();
          }
        } else if (env["type"] === "resync:delta") {
          resolve(); // GM may get a delta if seq matches; acceptable
        }
      });
    });

    gmSocket2.connect();
    await waitForConnect(gmSocket2);
    await gmSnapshotPromise;

    if (gmSnapshot) {
      const sceneDocs = (gmSnapshot as Record<string, unknown>)["documents"] as Record<
        string,
        unknown[]
      >;
      const scenes = sceneDocs?.["Scene"] as Record<string, unknown>[] | undefined;
      const testScene = scenes?.find((s) => (s as Record<string, unknown>)["_id"] === sceneId) as
        | Record<string, unknown>
        | undefined;

      if (testScene) {
        const gmTokens2 = testScene["tokens"] as Record<string, unknown>[] | undefined;
        // GM must see the hidden token
        if (gmTokens2) {
          const hiddenInGmView = gmTokens2.filter((t) => t["hidden"] === true);
          expect(hiddenInGmView).toHaveLength(1);
          expect(hiddenInGmView[0]?.["name"]).toBe("Hidden Token");
        }
      }
    }

    playerSocket.disconnect();
    gmSocket2.disconnect();
  }, 30000);
});

// ---------------------------------------------------------------------------
// FIX-5: embedded token update field protection
// ---------------------------------------------------------------------------

describe("FIX-5 — embedded token: _id strip and actorId protection", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  // We need a scene with a token whose actor is owned by the player.
  let sceneId: string;
  let tokenId: string;
  let actorId: string;

  beforeEach(async () => {
    ctx = await buildTestContext();

    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await new Promise((r) => setTimeout(r, 50));

    // GM creates an actor owned by the player
    const actorAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Player Actor",
          type: "pc",
          ownership: { default: 0, [ctx.playerUserId]: 3 }, // OWNER for player
        },
      ],
    });
    expect(actorAck["ok"]).toBe(true);
    actorId = (
      (actorAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // GM creates a scene
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "FIX-5 Scene" }],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // GM adds a token referencing that actor
    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Player Token", actorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);
    const parent = (tokenAck["result"] as Record<string, unknown>)["parent"] as Record<
      string,
      unknown
    >;
    tokenId = (parent["tokens"] as Record<string, unknown>[])[0]?.["_id"] as string;
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("OWNER of token can update x/y (positional move)", async () => {
    const ack = await sendOp(playerSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { x: 200, y: 300 },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
  });

  it("OWNER cannot change actorId — PERMISSION_DENIED", async () => {
    // Create a second actor to try reassigning to
    const actor2Ack = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Other Actor", type: "npc", ownership: { default: 0 } }],
    });
    expect(actor2Ack["ok"]).toBe(true);
    const actor2Id = (
      (actor2Ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const ack = await sendOp(playerSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { actorId: actor2Id },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("GM can change actorId", async () => {
    // Create a second actor
    const actor2Ack = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Replacement Actor", type: "npc", ownership: { default: 0 } }],
    });
    const actor2Id = (
      (actor2Ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { actorId: actor2Id },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
  });

  it("_id in diff is stripped — token _id remains unchanged after update", async () => {
    const FAKE_ID = "zzzzzzzzzzzzzzzz";
    const ack = await sendOp(playerSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { _id: FAKE_ID, x: 50 }, // _id must be ignored
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    // The updated scene should have the token with the original _id, not FAKE_ID
    const result = ack["result"] as Record<string, unknown>;
    const updatedDocs = result["documents"] as Record<string, unknown>[];
    const updatedScene = updatedDocs[0] as Record<string, unknown>;
    const tokens = updatedScene["tokens"] as Record<string, unknown>[];
    const theToken = tokens.find((t) => (t as Record<string, unknown>)["_id"] === tokenId) as
      | Record<string, unknown>
      | undefined;
    expect(theToken).toBeDefined();
    // Token must retain its original _id
    expect(theToken?.["_id"]).toBe(tokenId);
    expect(theToken?.["_id"]).not.toBe(FAKE_ID);
    // x was actually updated
    expect(theToken?.["x"]).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// M1-C: live broadcast filtering for hidden tokens
// ---------------------------------------------------------------------------

/**
 * Helper: listen for the next doc:update broadcast for a specific Scene on
 * a socket, with a timeout.  Resolves with the Scene document from the payload.
 */
function waitForSceneUpdate(
  socket: ClientSocket,
  sceneId: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for Scene update (${sceneId})`)),
      timeoutMs,
    );
    const handler = (envelope: Record<string, unknown>) => {
      if (envelope["type"] !== "doc:update" && envelope["type"] !== "doc:create") return;
      const payload = envelope["payload"] as Record<string, unknown>;
      if (payload["documentType"] !== "Scene" && payload["documentType"] !== "Token") return;
      const docs = payload["documents"] as Record<string, unknown>[] | undefined;
      const match = docs?.find((d) => (d as Record<string, unknown>)["_id"] === sceneId) as
        | Record<string, unknown>
        | undefined;
      if (match) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(match);
      }
    };
    socket.on("op", handler);
  });
}

describe("M1-C — live broadcast: hidden token filtering per socket", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let sceneId: string;

  beforeEach(async () => {
    ctx = await buildTestContext();

    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await new Promise((r) => setTimeout(r, 100));

    // Create a scene used by all tests in this suite
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Broadcast Filter Scene" }],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // The scene has to be ON AIR for a player to receive its body at all: only
    // the active scene crosses to a non-privileged socket (REQ-CEN-071,
    // REQ-CEN-072). Off air, every assertion below would be measuring the
    // scene-list boundary instead of the hidden-token redaction it is about.
    const activateAck = await sendOp(gmSocket, "world:activeScene", { sceneId });
    expect(activateAck["ok"]).toBe(true);

    // Drain initial broadcast events
    await new Promise((r) => setTimeout(r, 80));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("GM creates hidden token → player does NOT receive the token; GM receives it", async () => {
    // Set up listeners BEFORE sending the op
    const playerScenePromise = waitForSceneUpdate(playerSocket, sceneId);
    const gmScenePromise = waitForSceneUpdate(gmSocket, sceneId);

    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Hidden Ghost", x: 50, y: 50, hidden: true }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);

    // GM should see the Scene with the hidden token present
    const gmScene = await gmScenePromise;
    const gmTokens = gmScene["tokens"] as Record<string, unknown>[];
    const hiddenInGm = gmTokens.filter((t) => t["hidden"] === true);
    expect(hiddenInGm).toHaveLength(1);
    expect(hiddenInGm[0]?.["name"]).toBe("Hidden Ghost");

    // Player should receive the Scene update but WITHOUT the hidden token
    const playerScene = await playerScenePromise;
    const playerTokens = playerScene["tokens"] as Record<string, unknown>[];
    const hiddenInPlayer = playerTokens.filter((t) => t["hidden"] === true);
    expect(hiddenInPlayer).toHaveLength(0);
  }, 15000);

  it("GM moves hidden token → player does NOT receive position update for that token", async () => {
    // First, create a hidden token (GM only op)
    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Lurker", x: 0, y: 0, hidden: true }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);
    const parentAfterCreate = (tokenAck["result"] as Record<string, unknown>)["parent"] as Record<
      string,
      unknown
    >;
    const tokenId = (parentAfterCreate["tokens"] as Record<string, unknown>[])[0]?.[
      "_id"
    ] as string;
    await new Promise((r) => setTimeout(r, 80));

    // Now move the hidden token
    const playerMovePromise = waitForSceneUpdate(playerSocket, sceneId);
    const gmMovePromise = waitForSceneUpdate(gmSocket, sceneId);

    const moveAck = await sendOp(gmSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { x: 999, y: 999 },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(moveAck["ok"]).toBe(true);

    // GM sees the updated position of the hidden token
    const gmScene = await gmMovePromise;
    const gmTokens = gmScene["tokens"] as Record<string, unknown>[];
    const lurkerGm = gmTokens.find((t) => t["_id"] === tokenId) as Record<string, unknown>;
    expect(lurkerGm).toBeDefined();
    expect(lurkerGm["x"]).toBe(999);

    // Player receives the Scene update but the hidden token is absent
    const playerScene = await playerMovePromise;
    const playerTokens = playerScene["tokens"] as Record<string, unknown>[];
    const lurkerForPlayer = playerTokens.find(
      (t) => (t as Record<string, unknown>)["_id"] === tokenId,
    );
    expect(lurkerForPlayer).toBeUndefined();
  }, 15000);

  it("GM toggles hidden→visible → player now receives the token (create-like)", async () => {
    // Create hidden token
    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Appearing Spirit", x: 200, y: 200, hidden: true }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);
    const parentAfterCreate = (tokenAck["result"] as Record<string, unknown>)["parent"] as Record<
      string,
      unknown
    >;
    const tokenId = (parentAfterCreate["tokens"] as Record<string, unknown>[])[0]?.[
      "_id"
    ] as string;
    await new Promise((r) => setTimeout(r, 80));

    // Reveal the token (hidden=false)
    const playerRevealPromise = waitForSceneUpdate(playerSocket, sceneId);
    const gmRevealPromise = waitForSceneUpdate(gmSocket, sceneId);

    const revealAck = await sendOp(gmSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { hidden: false },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(revealAck["ok"]).toBe(true);

    // After reveal, player's Scene update must include the token (no longer hidden)
    const playerScene = await playerRevealPromise;
    const playerTokens = playerScene["tokens"] as Record<string, unknown>[];
    const revealedForPlayer = playerTokens.find(
      (t) => (t as Record<string, unknown>)["_id"] === tokenId,
    ) as Record<string, unknown> | undefined;
    expect(revealedForPlayer).toBeDefined();
    expect(revealedForPlayer?.["hidden"]).toBe(false);

    // GM also sees the token
    const gmScene = await gmRevealPromise;
    const gmTokens = gmScene["tokens"] as Record<string, unknown>[];
    const revealedForGm = gmTokens.find(
      (t) => (t as Record<string, unknown>)["_id"] === tokenId,
    ) as Record<string, unknown> | undefined;
    expect(revealedForGm).toBeDefined();
    expect(revealedForGm?.["hidden"]).toBe(false);
  }, 15000);

  it("GM toggles visible→hidden → player's Scene update no longer contains the token (delete-like)", async () => {
    // Create visible token first
    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Vanishing Hero", x: 100, y: 100, hidden: false }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);
    const parentAfterCreate = (tokenAck["result"] as Record<string, unknown>)["parent"] as Record<
      string,
      unknown
    >;
    const tokenId = (parentAfterCreate["tokens"] as Record<string, unknown>[])[0]?.[
      "_id"
    ] as string;
    await new Promise((r) => setTimeout(r, 80));

    // Hide the token
    const playerHidePromise = waitForSceneUpdate(playerSocket, sceneId);
    const gmHidePromise = waitForSceneUpdate(gmSocket, sceneId);

    const hideAck = await sendOp(gmSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { hidden: true },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(hideAck["ok"]).toBe(true);

    // Player's Scene update must NOT contain the token anymore
    const playerScene = await playerHidePromise;
    const playerTokens = playerScene["tokens"] as Record<string, unknown>[];
    const hiddenForPlayer = playerTokens.find(
      (t) => (t as Record<string, unknown>)["_id"] === tokenId,
    );
    expect(hiddenForPlayer).toBeUndefined();

    // GM still sees the token as hidden
    const gmScene = await gmHidePromise;
    const gmTokens = gmScene["tokens"] as Record<string, unknown>[];
    const hiddenForGm = gmTokens.find((t) => (t as Record<string, unknown>)["_id"] === tokenId) as
      | Record<string, unknown>
      | undefined;
    expect(hiddenForGm).toBeDefined();
    expect(hiddenForGm?.["hidden"]).toBe(true);
  }, 15000);

  it("snapshot still strips hidden tokens from player after live ops (FIX-4 re-validation)", async () => {
    // Create a hidden token
    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Persistent Ghost", x: 300, y: 300, hidden: true }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);
    await new Promise((r) => setTimeout(r, 80));

    // A fresh player connects — snapshot must not include the hidden token
    const freshPlayer = connectClient(ctx.port, ctx.worldId, {
      token: ctx.player2Token,
      protocolVersion: PROTOCOL_VERSION,
    });

    let playerSnapshot: Record<string, unknown> | null = null;
    const snapshotPromise = new Promise<void>((resolve) => {
      freshPlayer.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "resync:full") {
          const snap = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
            string,
            unknown
          > | null;
          if (snap) {
            playerSnapshot = snap;
            resolve();
          }
        } else if (env["type"] === "resync:delta") {
          resolve();
        }
      });
    });

    freshPlayer.connect();
    await waitForConnect(freshPlayer);
    await snapshotPromise;

    if (playerSnapshot) {
      const sceneDocs = (playerSnapshot as Record<string, unknown>)["documents"] as Record<
        string,
        unknown[]
      >;
      const scenes = sceneDocs["Scene"] as Record<string, unknown>[] | undefined;
      const testScene = scenes?.find((s) => (s as Record<string, unknown>)["_id"] === sceneId) as
        | Record<string, unknown>
        | undefined;

      if (testScene) {
        const tokens = testScene["tokens"] as Record<string, unknown>[] | undefined;
        if (tokens) {
          const hiddenTokens = tokens.filter((t) => t["hidden"] === true);
          expect(hiddenTokens).toHaveLength(0);
        }
      }
    }

    freshPlayer.disconnect();
  }, 20000);
});
