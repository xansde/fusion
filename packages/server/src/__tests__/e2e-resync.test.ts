/**
 * E2E Integration Test — M1-B resync scenario
 *
 * Scenario:
 *   1. GM creates a Scene via doc:create → verify ack echoes requestId (REQ-NET-011)
 *   2. GM activates the scene via world:activeScene → client2 receives broadcast
 *   3. client2 disconnects
 *   4. GM makes exactly 3 doc:update ops on the scene
 *   5. client2 reconnects with lastSeq → receives exactly 3 ops via resync:delta
 *   6. Verify every ack in the flow echoes requestId
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

// ---------------------------------------------------------------------------
// Helpers (same pattern as sync.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-e2e-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface E2EContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  player2Token: string;
}

async function buildE2EContext(): Promise<E2EContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "e2e-resync-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "p2-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const p2Login = await authService.login({
    userId: player2.id,
    password: "p2-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "E2E Test World", systemId: "stub" },
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

  socketManager.registerWorldNamespace({ worldId, db: fusionDb.raw, secret, authService });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    player2Token: p2Login.accessToken,
  };
}

async function teardownE2E(ctx: E2EContext): Promise<void> {
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
    setTimeout(() => reject(new Error(`Timeout waiting for ack: ${type}`)), 8000);
  });
}

// ---------------------------------------------------------------------------
// E2E test suite
// ---------------------------------------------------------------------------

describe("E2E M1-B — full resync scenario", () => {
  let ctx: E2EContext;

  beforeEach(async () => {
    ctx = await buildE2EContext();
  });

  afterEach(async () => {
    await teardownE2E(ctx);
  });

  it("GM creates Scene + activates, client2 reconnects after 3 updates and resyncs exactly 3 ops with requestId in ack", async () => {
    // -----------------------------------------------------------------------
    // Step 1: Connect GM and client2
    // -----------------------------------------------------------------------
    const gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    // client2 needs to capture its initial snapshot seq
    let client2LastSeq = 0;
    const client2Socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.player2Token,
      protocolVersion: PROTOCOL_VERSION,
    });

    // Set up listener before connect (boot buffer)
    const client2InitialSyncPromise = new Promise<void>((resolve) => {
      client2Socket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "resync:full") {
          const p = env["payload"] as Record<string, unknown>;
          const snap = p["snapshot"] as Record<string, unknown> | null;
          if (snap) client2LastSeq = snap["seq"] as number;
          resolve();
        } else if (env["type"] === "resync:delta") {
          client2LastSeq = env["seq"] as number;
          resolve();
        }
      });
    });

    gmSocket.connect();
    client2Socket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(client2Socket)]);

    // Wait for client2 initial snapshot
    await client2InitialSyncPromise;

    // -----------------------------------------------------------------------
    // Step 2: GM creates a Scene (verify requestId is echoed — REQ-NET-011)
    // -----------------------------------------------------------------------
    const createRequestId = "e2e-create-req-001";

    // Listen for the broadcast on client2 before GM sends
    const broadcastPromise = new Promise<Record<string, unknown>>((resolve) => {
      client2Socket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "doc:create") {
          const pl = env["payload"] as Record<string, unknown>;
          if (pl["documentType"] === "Scene") {
            resolve(env);
          }
        }
      });
    });

    const createAck = await sendOp(
      gmSocket,
      "doc:create",
      { documentType: "Scene", data: [{ name: "E2E Scene" }] },
      createRequestId,
    );

    // Verify ack echoes requestId (REQ-NET-011)
    expect(createAck["ok"]).toBe(true);
    expect(createAck["requestId"]).toBe(createRequestId);
    expect(typeof createAck["seq"]).toBe("number");

    // Extract created scene _id
    const createdDocs = (createAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const sceneId = createdDocs[0]?.["_id"] as string;
    expect(typeof sceneId).toBe("string");

    // Wait for client2 to receive the broadcast
    const broadcastEnvelope = await broadcastPromise;
    expect(broadcastEnvelope["seq"]).toBe(createAck["seq"]);

    // -----------------------------------------------------------------------
    // Step 3: GM activates the scene, client2 receives world:activeScene
    // -----------------------------------------------------------------------
    const activeSceneRequestId = "e2e-activescene-req-002";

    const activeSceneBroadcastPromise = new Promise<Record<string, unknown>>((resolve) => {
      client2Socket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "world:activeScene") {
          resolve(env);
        }
      });
    });

    const activateAck = await sendOp(
      gmSocket,
      "world:activeScene",
      { sceneId },
      activeSceneRequestId,
    );

    expect(activateAck["ok"]).toBe(true);
    expect(activateAck["requestId"]).toBe(activeSceneRequestId);

    // client2 must receive the world:activeScene broadcast
    const activeSceneBroadcast = await activeSceneBroadcastPromise;
    expect(activeSceneBroadcast["type"]).toBe("world:activeScene");
    const activePayload = activeSceneBroadcast["payload"] as Record<string, unknown>;
    expect(activePayload["sceneId"]).toBe(sceneId);

    // Record client2's seq after receiving all broadcasts so far
    // client2LastSeq was from initial snapshot; advance it to account for
    // the doc:create and world:activeScene ops
    client2LastSeq = activateAck["seq"] as number;

    // -----------------------------------------------------------------------
    // Step 4: Disconnect client2
    // -----------------------------------------------------------------------
    client2Socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // -----------------------------------------------------------------------
    // Step 5: GM makes exactly 3 doc:update ops
    // -----------------------------------------------------------------------
    const updateSeqs: number[] = [];

    for (let i = 0; i < 3; i++) {
      const updateRequestId = `e2e-update-req-${String(i + 10)}`;
      const updateAck = await sendOp(
        gmSocket,
        "doc:update",
        {
          documentType: "Scene",
          updates: [{ _id: sceneId, diff: { [`e2e_field_${String(i)}`]: i + 1 } }],
        },
        updateRequestId,
      );
      expect(updateAck["ok"]).toBe(true);
      expect(updateAck["requestId"]).toBe(updateRequestId);
      updateSeqs.push(updateAck["seq"] as number);
    }

    // Verify seqs are monotonically increasing
    for (let i = 1; i < updateSeqs.length; i++) {
      expect(updateSeqs[i]).toBeGreaterThan(updateSeqs[i - 1]!);
    }

    // -----------------------------------------------------------------------
    // Step 6: client2 reconnects with lastSeq → server sends resync:delta
    //         with exactly 3 ops
    // -----------------------------------------------------------------------
    const reconnectedClient2 = connectClient(ctx.port, ctx.worldId, {
      token: ctx.player2Token,
      protocolVersion: PROTOCOL_VERSION,
      lastSeq: client2LastSeq,
    });

    let resyncEnvelope: Record<string, unknown> | null = null;
    const resyncPromise = new Promise<void>((resolve) => {
      reconnectedClient2.on("op", (env: Record<string, unknown>) => {
        const t = env["type"];
        if (t === "resync:delta" || t === "resync:full") {
          resyncEnvelope = env;
          resolve();
        }
      });
    });

    reconnectedClient2.connect();
    await waitForConnect(reconnectedClient2);
    await resyncPromise;

    expect(resyncEnvelope).not.toBeNull();
    const re = resyncEnvelope!;

    // We expect a delta (3 ops are well within the 1000-op buffer)
    expect(re["type"]).toBe("resync:delta");

    const deltaPayload = re["payload"] as Record<string, unknown>;
    const deltaOps = deltaPayload["ops"] as Record<string, unknown>[];

    // Exactly 3 ops
    expect(deltaOps).toHaveLength(3);

    // Ops are all doc:update type with ascending seqs matching what GM sent
    for (let i = 0; i < 3; i++) {
      const op = deltaOps[i]!;
      expect(op["type"]).toBe("doc:update");
      expect(op["seq"]).toBe(updateSeqs[i]);
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------
    gmSocket.disconnect();
    reconnectedClient2.disconnect();
  }, 60000);
});
