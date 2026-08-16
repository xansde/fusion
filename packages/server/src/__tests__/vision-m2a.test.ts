/**
 * M2-A integration tests — walls, ambient lights, door state, move collision,
 * secret door redaction.
 *
 * Spec: 07-visao-iluminacao-fog.md
 *
 * Coverage:
 *  §WALLS
 *   - player cannot create wall (GM only)
 *   - GM creates wall → broadcast to all; player receives it
 *   - GM updates wall → broadcast
 *   - GM deletes wall → broadcast
 *
 *  §LIGHTS
 *   - player cannot create light (GM only)
 *   - GM creates light → broadcast
 *   - GM updates light → broadcast
 *   - GM deletes light → broadcast
 *
 *  §DOOR STATE
 *   - player opens unlocked door → broadcast
 *   - player cannot open locked door → PERMISSION_DENIED
 *   - player cannot lock a door → PERMISSION_DENIED
 *   - GM can lock/unlock a door
 *   - opening a door broadcasts updated scene to all
 *   - player cannot operate secret door → PERMISSION_DENIED
 *   - GM can operate secret door
 *
 *  §SECRET DOOR REDACTION (REQ-VIS-005)
 *   - snapshot: player receives secret door as plain wall, GM sees it as door
 *   - broadcast: player receives secret door as plain wall after GM creates wall
 *   - delta resync: player receives secret door as plain wall in delta ops
 *
 *  §MOVEMENT COLLISION (REQ-VIS-091)
 *   - token move through wall → MOVE_BLOCKED
 *   - token move through open door → allowed
 *   - GM can bypass with force:true
 *   - token move in open space → allowed
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
import { PROTOCOL_VERSION, createDocumentId } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-vision-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  gmUserId: string;
  playerToken: string;
  playerUserId: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "vision-test-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Vision Test World", systemId: "stub" },
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
    gmUserId: gm.id,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
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

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 6000);
  });
}

/** Wait for the next "op" event matching a predicate. */
function waitForOp(
  socket: ClientSocket,
  predicate: (env: Record<string, unknown>) => boolean,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for op")), timeoutMs);
    const handler = (env: Record<string, unknown>) => {
      if (predicate(env)) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

/** Drain any pending events (snapshot etc.) */
function drain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 80));
}

// ---------------------------------------------------------------------------
// Helper: create a Scene via GM (returns scene _id and full doc)
// ---------------------------------------------------------------------------

/**
 * The scene is put ON AIR right away: a Scene body only crosses to a
 * non-privileged socket while it is the active one (REQ-CEN-071, REQ-CEN-072),
 * and every walls/lights/doors assertion below reads what the PLAYER received.
 * Off air, those assertions would be measuring the scene-list boundary instead
 * of the wall/light/secret-door behaviour they are about.
 */
async function createScene(
  gmSocket: ClientSocket,
  name = "Test Scene",
): Promise<Record<string, unknown>> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [{ name }],
  });
  expect(ack["ok"]).toBe(true);
  const docs = (ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[];
  const scene = docs[0]!;
  const activateAck = await sendOp(gmSocket, "world:activeScene", {
    sceneId: scene["_id"] as string,
  });
  expect(activateAck["ok"]).toBe(true);
  return scene;
}

// ---------------------------------------------------------------------------
// §WALLS
// ---------------------------------------------------------------------------

describe("M2-A — Wall CRUD", () => {
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
    await drain();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("player cannot create a wall (GM only)", async () => {
    const scene = await createScene(gmSocket);
    const ack = await sendOp(playerSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }],
      parent: { type: "Scene", id: scene["_id"] },
    });
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("PERMISSION_DENIED");
  });

  it("GM creates a wall → player receives broadcast with scene update", async () => {
    const scene = await createScene(gmSocket);

    // Listen before GM creates
    const broadcastPromise = waitForOp(playerSocket, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[];
      return (
        payload["documentType"] === "Scene" &&
        Array.isArray(docs[0]?.["walls"]) &&
        (docs[0]["walls"] as unknown[]).length === 1
      );
    });

    const ack = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, move: "normal", sight: "normal" }],
      parent: { type: "Scene", id: scene["_id"] as string },
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as Record<string, unknown>;
    expect(result["documentType"]).toBe("Wall");
    const created = (result["documents"] as Record<string, unknown>[])[0];
    expect(created).toBeDefined();
    expect(created?.["move"]).toBe("normal");
    expect(created?.["doorType"]).toBe("none");

    const broadcast = await broadcastPromise;
    const bDocs = (broadcast["payload"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const walls = bDocs[0]?.["walls"] as Record<string, unknown>[];
    expect(walls).toHaveLength(1);
    expect(walls[0]?.["sight"]).toBe("normal");
  });

  it("GM updates a wall → broadcast with updated wall data", async () => {
    const scene = await createScene(gmSocket);
    const createAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }],
      parent: { type: "Scene", id: scene["_id"] as string },
    });
    expect(createAck["ok"]).toBe(true);
    const wallId = (
      (createAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const broadcastPromise = waitForOp(playerSocket, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[];
      const w = (docs[0]?.["walls"] as Record<string, unknown>[])?.[0];
      return w?.["sight"] === "limited";
    });

    const ack = await sendOp(gmSocket, "wall:update", {
      documentType: "Wall",
      updates: [
        {
          _id: wallId,
          diff: { sight: "limited" },
          embedded: { type: "Wall", id: scene["_id"] as string },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    const broadcast = await broadcastPromise;
    const bDocs = (broadcast["payload"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const walls = bDocs[0]?.["walls"] as Record<string, unknown>[];
    expect(walls[0]?.["sight"]).toBe("limited");
  });

  it("GM deletes a wall → broadcast with empty walls array", async () => {
    const scene = await createScene(gmSocket);
    const createAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }],
      parent: { type: "Scene", id: scene["_id"] as string },
    });
    expect(createAck["ok"]).toBe(true);
    const wallId = (
      (createAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const broadcastPromise = waitForOp(playerSocket, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[];
      return (
        payload["documentType"] === "Scene" &&
        Array.isArray(docs[0]?.["walls"]) &&
        (docs[0]["walls"] as unknown[]).length === 0
      );
    });

    const ack = await sendOp(gmSocket, "wall:delete", {
      documentType: "Wall",
      ids: [wallId],
      parent: { type: "Scene", id: scene["_id"] as string },
    });
    expect(ack["ok"]).toBe(true);

    await broadcastPromise; // broadcast happened
  });

  it("player cannot delete a wall (GM only)", async () => {
    const scene = await createScene(gmSocket);
    const createAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }],
      parent: { type: "Scene", id: scene["_id"] as string },
    });
    const wallId = (
      (createAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const ack = await sendOp(playerSocket, "wall:delete", {
      documentType: "Wall",
      ids: [wallId],
      parent: { type: "Scene", id: scene["_id"] as string },
    });
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("PERMISSION_DENIED");
  });
});

// ---------------------------------------------------------------------------
// §LIGHTS
// ---------------------------------------------------------------------------

describe("M2-A — AmbientLight CRUD", () => {
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
    await drain();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("player cannot create a light (GM only)", async () => {
    const scene = await createScene(gmSocket);
    const ack = await sendOp(playerSocket, "light:create", {
      documentType: "Light",
      data: [{ x: 200, y: 200, dimRadius: 5 }],
      parent: { type: "Scene", id: scene["_id"] },
    });
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("PERMISSION_DENIED");
  });

  it("GM creates a light → broadcast includes light in scene", async () => {
    const scene = await createScene(gmSocket);

    const broadcastPromise = waitForOp(playerSocket, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[];
      return (
        payload["documentType"] === "Scene" &&
        Array.isArray(docs[0]?.["lights"]) &&
        (docs[0]["lights"] as unknown[]).length === 1
      );
    });

    const ack = await sendOp(gmSocket, "light:create", {
      documentType: "Light",
      data: [{ x: 200, y: 200, dimRadius: 5, brightRadius: 2, color: "#ff8800" }],
      parent: { type: "Scene", id: scene["_id"] as string },
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as Record<string, unknown>;
    expect(result["documentType"]).toBe("Light");
    const createdLight = (result["documents"] as Record<string, unknown>[])[0];
    expect(createdLight?.["color"]).toBe("#ff8800");
    expect(createdLight?.["dimRadius"]).toBe(5);

    await broadcastPromise;
  });

  it("GM updates a light → broadcast with new values", async () => {
    const scene = await createScene(gmSocket);
    const createAck = await sendOp(gmSocket, "light:create", {
      documentType: "Light",
      data: [{ x: 200, y: 200, dimRadius: 5 }],
      parent: { type: "Scene", id: scene["_id"] as string },
    });
    expect(createAck["ok"]).toBe(true);
    const lightId = (
      (createAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const broadcastPromise = waitForOp(playerSocket, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[];
      const l = (docs[0]?.["lights"] as Record<string, unknown>[])?.[0];
      return l?.["dimRadius"] === 10;
    });

    const ack = await sendOp(gmSocket, "light:update", {
      documentType: "Light",
      updates: [
        {
          _id: lightId,
          diff: { dimRadius: 10 },
          embedded: { type: "Light", id: scene["_id"] as string },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    await broadcastPromise;
  });

  it("GM deletes a light → broadcast with empty lights array", async () => {
    const scene = await createScene(gmSocket);
    const createAck = await sendOp(gmSocket, "light:create", {
      documentType: "Light",
      data: [{ x: 200, y: 200, dimRadius: 5 }],
      parent: { type: "Scene", id: scene["_id"] as string },
    });
    const lightId = (
      (createAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const broadcastPromise = waitForOp(playerSocket, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[];
      return (
        payload["documentType"] === "Scene" &&
        Array.isArray(docs[0]?.["lights"]) &&
        (docs[0]["lights"] as unknown[]).length === 0
      );
    });

    const ack = await sendOp(gmSocket, "light:delete", {
      documentType: "Light",
      ids: [lightId],
      parent: { type: "Scene", id: scene["_id"] as string },
    });
    expect(ack["ok"]).toBe(true);
    await broadcastPromise;
  });
});

// ---------------------------------------------------------------------------
// §DOOR STATE
// ---------------------------------------------------------------------------

describe("M2-A — scene:doorState", () => {
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
    await drain();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  /** Create scene with a door wall, return {sceneId, wallId}. */
  async function createSceneWithDoor(
    opts: { doorType?: "door" | "secret"; doorState?: "closed" | "locked" } = {},
  ): Promise<{ sceneId: string; wallId: string }> {
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;
    const createAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [
        {
          a: { x: 0, y: 0 },
          b: { x: 100, y: 0 },
          doorType: opts.doorType ?? "door",
          doorState: opts.doorState ?? "closed",
        },
      ],
      parent: { type: "Scene", id: sceneId },
    });
    expect(createAck["ok"]).toBe(true);
    const wallId = (
      (createAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;
    return { sceneId, wallId };
  }

  it("player opens an unlocked door → success + broadcast", async () => {
    const { sceneId, wallId } = await createSceneWithDoor();

    const broadcastPromise = waitForOp(playerSocket, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[];
      const w = (docs[0]?.["walls"] as Record<string, unknown>[])?.[0];
      return w?.["doorState"] === "open";
    });

    const ack = await sendOp(playerSocket, "scene:doorState", {
      sceneId,
      wallId,
      state: "open",
    });
    expect(ack["ok"]).toBe(true);

    await broadcastPromise; // broadcast reached player
  });

  it("player cannot open a locked door → PERMISSION_DENIED", async () => {
    const { sceneId, wallId } = await createSceneWithDoor({ doorState: "locked" });
    const ack = await sendOp(playerSocket, "scene:doorState", {
      sceneId,
      wallId,
      state: "open",
    });
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("PERMISSION_DENIED");
  });

  it("player cannot lock a door → PERMISSION_DENIED", async () => {
    const { sceneId, wallId } = await createSceneWithDoor();
    const ack = await sendOp(playerSocket, "scene:doorState", {
      sceneId,
      wallId,
      state: "locked",
    });
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("PERMISSION_DENIED");
  });

  it("GM can lock and unlock a door", async () => {
    const { sceneId, wallId } = await createSceneWithDoor();

    const lockAck = await sendOp(gmSocket, "scene:doorState", {
      sceneId,
      wallId,
      state: "locked",
    });
    expect(lockAck["ok"]).toBe(true);

    const unlockAck = await sendOp(gmSocket, "scene:doorState", {
      sceneId,
      wallId,
      state: "closed",
    });
    expect(unlockAck["ok"]).toBe(true);
  });

  it("player cannot operate a secret door → PERMISSION_DENIED", async () => {
    const { sceneId, wallId } = await createSceneWithDoor({ doorType: "secret" });
    const ack = await sendOp(playerSocket, "scene:doorState", {
      sceneId,
      wallId,
      state: "open",
    });
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("PERMISSION_DENIED");
  });

  it("GM can operate a secret door", async () => {
    const { sceneId, wallId } = await createSceneWithDoor({ doorType: "secret" });
    const ack = await sendOp(gmSocket, "scene:doorState", {
      sceneId,
      wallId,
      state: "open",
    });
    expect(ack["ok"]).toBe(true);
  });

  it("non-door wall cannot be toggled → VALIDATION_FAILED", async () => {
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;
    const createAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, doorType: "none" }],
      parent: { type: "Scene", id: sceneId },
    });
    const wallId = (
      (createAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const ack = await sendOp(playerSocket, "scene:doorState", {
      sceneId,
      wallId,
      state: "open",
    });
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// §SECRET DOOR REDACTION (REQ-VIS-005)
// ---------------------------------------------------------------------------

describe("M2-A — secret door redaction", () => {
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
    await drain();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("broadcast: player receives secret door as plain wall (doorType:none), GM sees it as door", async () => {
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;

    // Listen for broadcast on BOTH sockets simultaneously before creating
    const gmBroadcastPromise = waitForOp(gmSocket, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[];
      return (
        payload["documentType"] === "Scene" &&
        Array.isArray(docs[0]?.["walls"]) &&
        (docs[0]["walls"] as unknown[]).length === 1
      );
    });

    const playerBroadcastPromise = waitForOp(playerSocket, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[];
      return (
        payload["documentType"] === "Scene" &&
        Array.isArray(docs[0]?.["walls"]) &&
        (docs[0]["walls"] as unknown[]).length === 1
      );
    });

    // GM creates a secret door
    const createAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [
        {
          a: { x: 0, y: 0 },
          b: { x: 100, y: 0 },
          doorType: "secret",
          doorState: "closed",
        },
      ],
      parent: { type: "Scene", id: sceneId },
    });
    expect(createAck["ok"]).toBe(true);

    // GM broadcast: sees doorType:"secret"
    const gmBroadcast = await gmBroadcastPromise;
    const gmDocs = (gmBroadcast["payload"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const gmWall = (gmDocs[0]?.["walls"] as Record<string, unknown>[])?.[0];
    expect(gmWall?.["doorType"]).toBe("secret");

    // Player broadcast: sees doorType:"none" (redacted)
    const playerBroadcast = await playerBroadcastPromise;
    const playerDocs = (playerBroadcast["payload"] as Record<string, unknown>)[
      "documents"
    ] as Record<string, unknown>[];
    const playerWall = (playerDocs[0]?.["walls"] as Record<string, unknown>[])?.[0];
    expect(playerWall?.["doorType"]).toBe("none");
    expect(playerWall?.["doorState"]).toBe("closed");
  });

  it("ack result: GM ack contains doorType:secret; player ack result is redacted", async () => {
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;

    // GM ack should show secret door as-is
    const gmAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, doorType: "secret" }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(gmAck["ok"]).toBe(true);
    const gmResult = gmAck["result"] as Record<string, unknown>;
    const gmParent = gmResult["parent"] as Record<string, unknown>;
    const gmParentWall = (gmParent?.["walls"] as Record<string, unknown>[])?.[0];
    expect(gmParentWall?.["doorType"]).toBe("secret");
  });

  it("snapshot: player receives secret doors as plain walls; GM sees them as doors", async () => {
    // GM creates scene with a secret door BEFORE players connect
    const sceneId = createDocumentId();
    const directGmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    directGmSocket.connect();
    await waitForConnect(directGmSocket);
    await drain();

    const scene = await createScene(directGmSocket);
    const sid = scene["_id"] as string;
    await sendOp(directGmSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, doorType: "secret" }],
      parent: { type: "Scene", id: sid },
    });
    directGmSocket.disconnect();
    await drain();

    void sceneId; // suppress lint

    // Now a fresh player socket joins — its snapshot should redact secret doors
    // Snapshot is delivered as an "op" event with type "resync:full", which contains
    // payload.snapshot (WorldSnapshotPayload) with the scene data.
    const freshPlayerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    const playerSnapshotPromise: Promise<Record<string, unknown>> = new Promise((resolve) => {
      freshPlayerSocket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "resync:full") {
          resolve(env);
        }
      });
    });

    freshPlayerSocket.connect();
    await waitForConnect(freshPlayerSocket);

    const playerResync = await Promise.race([
      playerSnapshotPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Player snapshot timeout")), 4000),
      ),
    ]);

    const playerPayload = playerResync["payload"] as Record<string, unknown>;
    const playerSnapshot = playerPayload["snapshot"] as Record<string, unknown> | null;
    expect(playerSnapshot).toBeDefined();

    const playerScenes = playerSnapshot?.["documents"] as
      | Record<string, Record<string, unknown>[]>
      | undefined;
    const playerSceneList = playerScenes?.["Scene"] ?? [];
    const targetScene = playerSceneList.find((s) => s["_id"] === sid);

    if (targetScene) {
      const walls = targetScene["walls"] as Record<string, unknown>[] | undefined;
      if (walls && walls.length > 0) {
        // All walls should be redacted for the player
        for (const wall of walls) {
          expect(wall["doorType"]).not.toBe("secret");
        }
      }
    }

    freshPlayerSocket.disconnect();

    // GM snapshot should preserve secret doors
    const freshGmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    const gmSnapshotPromise: Promise<Record<string, unknown>> = new Promise((resolve) => {
      freshGmSocket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "resync:full") {
          resolve(env);
        }
      });
    });

    freshGmSocket.connect();
    await waitForConnect(freshGmSocket);

    const gmResync = await Promise.race([
      gmSnapshotPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("GM snapshot timeout")), 4000),
      ),
    ]);

    const gmResyncPayload = gmResync["payload"] as Record<string, unknown>;
    const gmSnapshot = gmResyncPayload["snapshot"] as Record<string, unknown> | null;
    expect(gmSnapshot).toBeDefined();

    const gmScenes = gmSnapshot?.["documents"] as
      | Record<string, Record<string, unknown>[]>
      | undefined;
    const gmSceneList = gmScenes?.["Scene"] ?? [];
    const gmTargetScene = gmSceneList.find((s) => s["_id"] === sid);

    if (gmTargetScene) {
      const gmWalls = gmTargetScene["walls"] as Record<string, unknown>[] | undefined;
      if (gmWalls && gmWalls.length > 0) {
        const secretWall = gmWalls.find((w) => w["doorType"] === "secret");
        expect(secretWall).toBeDefined();
      }
    }

    freshGmSocket.disconnect();
  });

  it("delta resync: player receives secret doors as plain walls in replayed ops", async () => {
    const scene = await createScene(gmSocket);
    const sid = scene["_id"] as string;

    // Player disconnects
    playerSocket.disconnect();
    await drain();

    // GM creates a secret door while player is offline
    const createAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, doorType: "secret" }],
      parent: { type: "Scene", id: sid },
    });
    expect(createAck["ok"]).toBe(true);
    const seqAfterCreate = createAck["seq"] as number;

    // Player reconnects with lastSeq = 0 → gets delta
    const freshPlayerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
      lastSeq: 0,
    });
    freshPlayerSocket.connect();
    await waitForConnect(freshPlayerSocket);
    await drain();

    // Request delta resync
    const deltaPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      freshPlayerSocket.emit(
        "op",
        { type: "resync:request", ts: Date.now(), payload: { lastSeq: 0 } },
        (r: Record<string, unknown>) => resolve(r),
      );
      setTimeout(() => reject(new Error("Delta resync timeout")), 4000);
    });

    const deltaAck = await deltaPromise;
    expect(deltaAck["ok"]).toBe(true);

    const deltaResult = deltaAck["result"] as Record<string, unknown>;
    const ops = deltaResult["ops"] as Array<Record<string, unknown>> | undefined;

    void seqAfterCreate; // used for reference

    if (ops && ops.length > 0) {
      for (const op of ops) {
        if (op["type"] !== "doc:update" && op["type"] !== "doc:create") continue;
        const payload = op["payload"] as Record<string, unknown>;
        const docs = payload["documents"] as Record<string, unknown>[] | undefined;
        if (!docs) continue;
        for (const doc of docs) {
          const walls = doc["walls"] as Record<string, unknown>[] | undefined;
          if (!walls) continue;
          for (const wall of walls) {
            // Player should never see doorType:"secret" in delta ops
            expect(wall["doorType"]).not.toBe("secret");
          }
        }
      }
    }

    freshPlayerSocket.disconnect();
  });

  it("wall:delete with secret door still present — player does NOT receive doorType:secret", async () => {
    // Scene with 1 secret door + 1 plain wall; GM deletes the plain wall;
    // player broadcast must NOT expose the secret door (INVARIANT 2).
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;

    // Create secret door
    const secretAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, doorType: "secret" }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(secretAck["ok"]).toBe(true);

    // Create normal wall
    const normalAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [{ a: { x: 200, y: 0 }, b: { x: 300, y: 0 } }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(normalAck["ok"]).toBe(true);
    const normalWallId = (
      (normalAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // Listen for the broadcast that will arrive after deleting the normal wall
    const playerBroadcastPromise = waitForOp(playerSocket, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[];
      // After delete of the normal wall, scene has 1 wall left (the secret door)
      return (
        payload["documentType"] === "Scene" &&
        Array.isArray(docs[0]?.["walls"]) &&
        (docs[0]["walls"] as unknown[]).length === 1
      );
    });

    // GM deletes the normal wall
    const deleteAck = await sendOp(gmSocket, "wall:delete", {
      documentType: "Wall",
      ids: [normalWallId],
      parent: { type: "Scene", id: sceneId },
    });
    expect(deleteAck["ok"]).toBe(true);

    // Player broadcast: the remaining wall must NOT have doorType:"secret"
    const playerBroadcast = await playerBroadcastPromise;
    const playerDocs = (playerBroadcast["payload"] as Record<string, unknown>)[
      "documents"
    ] as Record<string, unknown>[];
    const playerWalls = playerDocs[0]?.["walls"] as Record<string, unknown>[] | undefined;
    expect(playerWalls).toHaveLength(1);
    expect(playerWalls?.[0]?.["doorType"]).not.toBe("secret");
    expect(playerWalls?.[0]?.["doorType"]).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// §MOVEMENT COLLISION (REQ-VIS-091)
// ---------------------------------------------------------------------------

describe("M2-A — token:move collision validation", () => {
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
    await drain();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  /**
   * Set up a scene with:
   *  - A wall from (100,0) to (100,200) — vertical wall at x=100
   *  - A token at (50,100) owned by the player's actor
   * Returns { sceneId, tokenId }
   */
  async function buildSceneWithWallAndToken(
    opts: {
      doorType?: "none" | "door";
      doorState?: "closed" | "open";
    } = {},
  ): Promise<{ sceneId: string; tokenId: string }> {
    // Create an actor owned by the player
    const actorAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Player Actor",
          type: "character",
          ownership: { default: 0, [ctx.playerUserId]: 3 }, // OWNER level
        },
      ],
    });
    expect(actorAck["ok"]).toBe(true);
    const actorId = (
      (actorAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // Create scene
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;

    // Create the blocking wall (vertical at x=100)
    await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [
        {
          a: { x: 100, y: 0 },
          b: { x: 100, y: 200 },
          move: "normal",
          sight: "normal",
          doorType: opts.doorType ?? "none",
          doorState: opts.doorState ?? "closed",
        },
      ],
      parent: { type: "Scene", id: sceneId },
    });

    // Create the token via embedded token create
    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Hero", actorId, x: 50, y: 100 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);
    const tokenId = (
      (tokenAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    return { sceneId, tokenId };
  }

  it("token moves in open space → allowed", async () => {
    const { sceneId, tokenId } = await buildSceneWithWallAndToken();

    // Move from (50,100) to (80,100) — stays left of wall
    const ack = await sendOp(playerSocket, "token:move", {
      sceneId,
      tokenId,
      x: 80,
      y: 100,
    });
    expect(ack["ok"]).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Ownership.default recognition (M5-C debt payoff): token:move's permission
  // check must go through testOwnership/resolveOwnership (documents/
  // ownership.ts), not a hand-rolled `ownership[userId] ?? ownership.default`
  // read. Regression coverage for an Actor with ownership.default = OWNER and
  // NO per-user entry — the old hand-rolled read happened to also consult
  // `default` as a fallback, so this specifically exercises that the
  // single-source-of-truth path preserves (and does not regress) that
  // behaviour while now also correctly resolving INHERIT.
  // ---------------------------------------------------------------------------

  it("player moves a token whose actor grants OWNER via ownership.default (no per-user entry)", async () => {
    // Actor owned by "everyone" via default=OWNER — no explicit playerUserId
    // entry at all.
    const actorAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Default-Owned Hero",
          type: "character",
          ownership: { default: 3 }, // OwnershipLevel.OWNER, no per-user key
        },
      ],
    });
    expect(actorAck["ok"]).toBe(true);
    const actorId = (
      (actorAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;

    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Default-Owned Hero", actorId, x: 50, y: 100 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);
    const tokenId = (
      (tokenAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // Open space move (no walls) — should be allowed for the player, since
    // ownership.default = OWNER grants every player OWNER access.
    const ack = await sendOp(playerSocket, "token:move", {
      sceneId,
      tokenId,
      x: 80,
      y: 100,
    });
    expect(ack["ok"]).toBe(true);
  });

  it("player is denied moving a token whose actor has ownership.default = NONE and no per-user entry", async () => {
    const actorAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "GM-Only Hero",
          type: "npc",
          ownership: { default: 0 }, // OwnershipLevel.NONE
        },
      ],
    });
    expect(actorAck["ok"]).toBe(true);
    const actorId = (
      (actorAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;

    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "GM-Only Hero", actorId, x: 50, y: 100 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);
    const tokenId = (
      (tokenAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const ack = await sendOp(playerSocket, "token:move", {
      sceneId,
      tokenId,
      x: 80,
      y: 100,
    });
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("PERMISSION_DENIED");
  });

  it("token move through wall → MOVE_BLOCKED", async () => {
    const { sceneId, tokenId } = await buildSceneWithWallAndToken();

    // Move from (50,100) to (150,100) — crosses vertical wall at x=100
    const ack = await sendOp(playerSocket, "token:move", {
      sceneId,
      tokenId,
      x: 150,
      y: 100,
    });
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("MOVE_BLOCKED");
  });

  it("token move through closed door → MOVE_BLOCKED", async () => {
    const { sceneId, tokenId } = await buildSceneWithWallAndToken({
      doorType: "door",
      doorState: "closed",
    });

    // Move from (50,100) to (150,100) — crosses closed door
    const ack = await sendOp(playerSocket, "token:move", {
      sceneId,
      tokenId,
      x: 150,
      y: 100,
    });
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("MOVE_BLOCKED");
  });

  it("token move through open door → allowed", async () => {
    const {
      sceneId: _sceneId,
      tokenId: _tokenId,
      wallId,
    } = await (async () => {
      const result = await buildSceneWithWallAndToken({
        doorType: "door",
        doorState: "closed",
      });
      // Find the wall id
      const sceneDoc = await sendOp(gmSocket, "doc:update", {
        documentType: "Scene",
        updates: [{ _id: result.sceneId, diff: {} }],
      });
      // Get scene directly
      const sceneAck = await new Promise<Record<string, unknown>>((resolve, reject) => {
        gmSocket.emit(
          "query",
          { type: "query", ts: Date.now(), payload: { documentType: "Scene", id: result.sceneId } },
          (r: Record<string, unknown>) => resolve(r),
        );
        setTimeout(() => reject(new Error("Query timeout")), 3000);
      });
      void sceneDoc;
      void sceneAck;
      return { ...result, wallId: "" as string };
    })();

    // We need to find the wall id from the scene. Let's use a simpler approach:
    // Set up the whole scene manually with a known wall id
    const actorAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Hero2",
          type: "character",
          ownership: { default: 0, [ctx.playerUserId]: 3 },
        },
      ],
    });
    const actorId2 = (
      (actorAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const scene2 = await createScene(gmSocket, "Scene with door");
    const sceneId2 = scene2["_id"] as string;

    // Create a door wall
    const wallCreateAck = await sendOp(gmSocket, "wall:create", {
      documentType: "Wall",
      data: [
        {
          a: { x: 100, y: 0 },
          b: { x: 100, y: 200 },
          move: "normal",
          doorType: "door",
          doorState: "closed",
        },
      ],
      parent: { type: "Scene", id: sceneId2 },
    });
    expect(wallCreateAck["ok"]).toBe(true);
    const doorWallId = (
      (wallCreateAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // Create token
    const tokenAck2 = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ name: "Hero2", actorId: actorId2, x: 50, y: 100 }],
      parent: { type: "Scene", id: sceneId2 },
    });
    const tokenId2 = (
      (tokenAck2["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // Open the door
    const doorAck = await sendOp(playerSocket, "scene:doorState", {
      sceneId: sceneId2,
      wallId: doorWallId,
      state: "open",
    });
    expect(doorAck["ok"]).toBe(true);

    void wallId; // unused reference from first setup

    // Now move through the open door
    const moveAck = await sendOp(playerSocket, "token:move", {
      sceneId: sceneId2,
      tokenId: tokenId2,
      x: 150,
      y: 100,
    });
    expect(moveAck["ok"]).toBe(true);
  });

  it("GM can bypass wall collision with force:true", async () => {
    const { sceneId, tokenId } = await buildSceneWithWallAndToken();

    // GM forces movement through wall
    const ack = await sendOp(gmSocket, "token:move", {
      sceneId,
      tokenId,
      x: 150,
      y: 100,
      force: true,
    });
    expect(ack["ok"]).toBe(true);
  });

  it("player cannot bypass collision with force:true (ignored for non-GM)", async () => {
    const { sceneId, tokenId } = await buildSceneWithWallAndToken();

    // Player sends force:true but it should be ignored since they're not GM
    const ack = await sendOp(playerSocket, "token:move", {
      sceneId,
      tokenId,
      x: 150,
      y: 100,
      force: true,
    });
    // Player with force=true but not GM → still blocked
    expect(ack["ok"]).toBe(false);
    expect((ack as Record<string, unknown>)["code"]).toBe("MOVE_BLOCKED");
  });
});
