/**
 * Putting a scene ON AIR has exactly one writer — spec 44, §5.5 (DEC-CEN-02).
 *
 * REQ-CEN-040: a privileged role may put ANY scene on air.
 * REQ-CEN-041: it travels on the dedicated active-scene event, writes the single
 *              source of truth, and is broadcast to every client.
 * REQ-CEN-042: the server refuses a change to `active` through the generic
 *              document update, from ANY origin (player or GM).
 * REQ-CEN-045: a failed activation comes back as an error ack and leaves nothing
 *              divergent behind: the source of truth does not move and no client
 *              is told anything.
 * REQ-CEN-046: the body handed out at activation carries the target scene's
 *              initial view, which is what the canvas applies (REQ-CNV-068).
 *
 * These tests read the PAYLOAD the sockets receive and the ROW the server wrote —
 * never the screen. Applying the initial view to the camera, showing the failure
 * message and ending a local "preparo" are client behaviour and live in the
 * client tests of this phase. So is REQ-CEN-043 ("pôr no ar não pede
 * confirmação"): there is no server-side shape for a confirmation to have, so
 * asserting its absence here could only ever assert the absence of something the
 * protocol never had. It is proved where a confirmation could actually be added —
 * `packages/client/src/components/scenes/__tests__/ScenesTab.test.ts`.
 *
 * NOTE ON ORDERING: activation emits the on-air scene body (doc:update) BEFORE
 * the world:activeScene pointer on purpose (REQ-CEN-072) — the body has to land
 * before the pointer that references it. Nothing here may reorder that.
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
import { listeningPort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  playerToken: string;
}

function makeTempDir(): string {
  // Data dir lives in the OS temp dir — never inside the worktree.
  const dir = join(
    tmpdir(),
    `fusion-scene-on-air-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const worldId = "scene-on-air-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: join(dataDir, "world.db"), skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, join(dataDir, "world.db"));

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Jogador",
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
    worldInfo: { id: worldId, title: "Scene On Air World", systemId: "stub" },
  });
  // port 0 + listeningPort(): this test never goes through boot(), so the OS
  // picks the port and nothing hardcodes one (helpers/ports.ts).
  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const port = listeningPort(fastify);

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
    playerToken: playerLogin.accessToken,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(ctx: TestContext, token: string): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
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

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout waiting for ack: ${type}`));
    }, 6000);
  });
}

/** Record EVERY envelope a socket receives, so the whole traffic can be searched. */
function recordEnvelopes(socket: ClientSocket): Record<string, unknown>[] {
  const received: Record<string, unknown>[] = [];
  socket.on("op", (env: Record<string, unknown>) => {
    received.push(env);
  });
  return received;
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 150));

async function createScene(gmSocket: ClientSocket, data: Record<string, unknown>): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [data],
  });
  expect(ack["ok"]).toBe(true);
  const docs = (ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[];
  return docs[0]?.["_id"] as string;
}

/**
 * The single source of truth, read the way the join snapshot reads it: the
 * `_meta:activeScene` row of the settings table (DEC-CEN-02).
 */
function onAirIdInDb(ctx: TestContext): string | null {
  const row = ctx.fusionDb.raw
    .prepare(`SELECT data FROM settings WHERE id = ?`)
    .get("_meta:activeScene") as { data: string } | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.data) as { value?: unknown };
  return typeof parsed.value === "string" ? parsed.value : null;
}

/** The persisted `active` mirror of a scene, read straight from its row. */
function activeMirrorInDb(ctx: TestContext, sceneId: string): boolean {
  const row = ctx.fusionDb.raw.prepare(`SELECT data FROM scenes WHERE id = ?`).get(sceneId) as
    | { data: string }
    | undefined;
  if (!row) return false;
  return (JSON.parse(row.data) as { active?: unknown }).active === true;
}

/** Every Scene document carried by the recorded traffic (live ops only). */
function sceneDocsIn(envelopes: Record<string, unknown>[]): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  for (const env of envelopes) {
    const payload = env["payload"] as Record<string, unknown> | undefined;
    if (!payload) continue;
    if (payload["documentType"] === "Scene" && Array.isArray(payload["documents"])) {
      docs.push(...(payload["documents"] as Record<string, unknown>[]));
    }
  }
  return docs;
}

function pointerEnvelopes(envelopes: Record<string, unknown>[]): Record<string, unknown>[] {
  return envelopes.filter((env) => env["type"] === "world:activeScene");
}

// ---------------------------------------------------------------------------

describe("spec 44 §5.5 — putting a scene on air has one writer (DEC-CEN-02)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx, ctx.gmToken);
    playerSocket = connectClient(ctx, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await settle();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // REQ-CEN-042 — the generic document update is not a way in
  // -------------------------------------------------------------------------

  it("REQ-CEN-042: a GM doc:update carrying `active` is refused and moves nothing", async () => {
    const onAirId = await createScene(gmSocket, { name: "Taverna" });
    const offAirId = await createScene(gmSocket, { name: "Porão" });
    expect((await sendOp(gmSocket, "world:activeScene", { sceneId: onAirId }))["ok"]).toBe(true);
    await settle();

    const gmTraffic = recordEnvelopes(gmSocket);
    const playerTraffic = recordEnvelopes(playerSocket);

    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: offAirId, diff: { active: true } }],
    });
    await settle();

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(String(ack["message"])).toContain("world:activeScene");

    // Nothing moved: neither the source of truth nor either mirror.
    expect(onAirIdInDb(ctx)).toBe(onAirId);
    expect(activeMirrorInDb(ctx, offAirId)).toBe(false);
    expect(activeMirrorInDb(ctx, onAirId)).toBe(true);
    expect(pointerEnvelopes(gmTraffic)).toHaveLength(0);
    expect(pointerEnvelopes(playerTraffic)).toHaveLength(0);
  });

  it("REQ-CEN-042: the refusal fires from ANY origin — a player forging the same update is refused too", async () => {
    const sceneId = await createScene(gmSocket, { name: "Cripta" });
    await settle();

    const gmTraffic = recordEnvelopes(gmSocket);

    const ack = await sendOp(playerSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { active: true } }],
    });
    await settle();

    expect(ack["ok"]).toBe(false);
    expect(activeMirrorInDb(ctx, sceneId)).toBe(false);
    expect(onAirIdInDb(ctx)).toBeNull();
    expect(pointerEnvelopes(gmTraffic)).toHaveLength(0);
  });

  it("REQ-CEN-042: smuggling `active` alongside a legal field refuses the whole batch", async () => {
    const sceneId = await createScene(gmSocket, { name: "Ponte" });
    await settle();

    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { active: true, name: "Ponte Velha" } }],
    });

    expect(ack["ok"]).toBe(false);
    // The whole batch is refused before anything is written — the legal field
    // that travelled with the illegal one must not have landed either.
    const row = ctx.fusionDb.raw.prepare(`SELECT data FROM scenes WHERE id = ?`).get(sceneId) as {
      data: string;
    };
    expect((JSON.parse(row.data) as { name: string }).name).toBe("Ponte");
  });

  // -------------------------------------------------------------------------
  // REQ-CEN-040 / 041 — the dedicated event
  // -------------------------------------------------------------------------

  it("REQ-CEN-040/REQ-CEN-041: the privileged role puts a scene on air, the single source of truth is written and every client is told", async () => {
    const sceneId = await createScene(gmSocket, { name: "Salão" });
    await settle();

    const gmTraffic = recordEnvelopes(gmSocket);
    const playerTraffic = recordEnvelopes(playerSocket);

    const ack = await sendOp(gmSocket, "world:activeScene", { sceneId });
    await settle();

    expect(ack["ok"]).toBe(true);
    expect((ack["result"] as Record<string, unknown>)["sceneId"]).toBe(sceneId);

    // The source of truth, not the mirror, is what the join snapshot reads.
    expect(onAirIdInDb(ctx)).toBe(sceneId);
    expect(activeMirrorInDb(ctx, sceneId)).toBe(true);

    // Broadcast to ALL clients — the player is not privileged and still gets it.
    for (const traffic of [gmTraffic, playerTraffic]) {
      const pointers = pointerEnvelopes(traffic);
      expect(pointers).toHaveLength(1);
      expect((pointers[0]?.["payload"] as Record<string, unknown>)["sceneId"]).toBe(sceneId);
    }
  });

  it("REQ-CEN-040/REQ-CEN-041: switching scenes moves the source of truth and both mirrors", async () => {
    const firstId = await createScene(gmSocket, { name: "Primeira" });
    const secondId = await createScene(gmSocket, { name: "Segunda" });
    await sendOp(gmSocket, "world:activeScene", { sceneId: firstId });
    await settle();

    const playerTraffic = recordEnvelopes(playerSocket);
    const ack = await sendOp(gmSocket, "world:activeScene", { sceneId: secondId });
    await settle();

    expect(ack["ok"]).toBe(true);
    expect(onAirIdInDb(ctx)).toBe(secondId);
    expect(activeMirrorInDb(ctx, secondId)).toBe(true);
    expect(activeMirrorInDb(ctx, firstId)).toBe(false);

    const pointers = pointerEnvelopes(playerTraffic);
    expect(pointers).toHaveLength(1);
    expect((pointers[0]?.["payload"] as Record<string, unknown>)["sceneId"]).toBe(secondId);
  });

  it("REQ-CEN-072: the player is handed the body of the scene going on air, and it lands BEFORE the pointer that names it", async () => {
    const sceneId = await createScene(gmSocket, { name: "Muralha" });
    await settle();

    const playerTraffic = recordEnvelopes(playerSocket);
    const ack = await sendOp(gmSocket, "world:activeScene", { sceneId });
    await settle();

    expect(ack["ok"]).toBe(true);

    // A player mirrors only the scene on air (REQ-CEN-071/073), so the body of the
    // NEW one has to be handed over as part of this same activation — the player has
    // no other way to ever obtain it, and no resync was asked for here.
    const bodyIndex = playerTraffic.findIndex((env) =>
      sceneDocsIn([env]).some((doc) => doc["_id"] === sceneId),
    );
    expect(bodyIndex).toBeGreaterThanOrEqual(0);

    // ...and the ORDER is the whole point: a pointer that arrives first names a scene
    // the player does not have yet, which is an empty canvas no resync would repair.
    const pointerIndex = playerTraffic.findIndex((env) => env["type"] === "world:activeScene");
    expect(pointerIndex).toBeGreaterThanOrEqual(0);
    expect(bodyIndex).toBeLessThan(pointerIndex);
    expect(pointerEnvelopes(playerTraffic)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // REQ-CEN-046 — the initial view of the TARGET scene travels with it
  // -------------------------------------------------------------------------

  it("REQ-CEN-046: the body handed out at activation carries the target scene's initial view", async () => {
    const sceneId = await createScene(gmSocket, {
      name: "Mirante",
      initialView: { x: 1200, y: 800, scale: 0.75 },
    });
    await settle();

    const playerTraffic = recordEnvelopes(playerSocket);
    expect((await sendOp(gmSocket, "world:activeScene", { sceneId }))["ok"]).toBe(true);
    await settle();

    const onAir = sceneDocsIn(playerTraffic).find((doc) => doc["_id"] === sceneId);
    expect(onAir).toBeDefined();
    expect(onAir?.["initialView"]).toEqual({ x: 1200, y: 800, scale: 0.75 });
  });

  it("REQ-CEN-046: switching to a scene with its own initial view hands out THAT one, not the previous", async () => {
    const firstId = await createScene(gmSocket, {
      name: "Praça",
      initialView: { x: 10, y: 20, scale: 1 },
    });
    const secondId = await createScene(gmSocket, {
      name: "Catacumbas",
      initialView: { x: 900, y: 40, scale: 2 },
    });
    await sendOp(gmSocket, "world:activeScene", { sceneId: firstId });
    await settle();

    const playerTraffic = recordEnvelopes(playerSocket);
    await sendOp(gmSocket, "world:activeScene", { sceneId: secondId });
    await settle();

    const handed = sceneDocsIn(playerTraffic).filter((doc) => doc["_id"] === secondId);
    expect(handed.length).toBeGreaterThan(0);
    expect(handed[0]?.["initialView"]).toEqual({ x: 900, y: 40, scale: 2 });
  });

  // -------------------------------------------------------------------------
  // REQ-CEN-045 — a failure is an error ack, and nothing else
  // -------------------------------------------------------------------------

  it("REQ-CEN-045: a refused activation leaves nothing divergent — error ack, source untouched, no client told", async () => {
    const sceneId = await createScene(gmSocket, { name: "Torre" });
    await sendOp(gmSocket, "world:activeScene", { sceneId });
    await settle();

    const otherId = await createScene(gmSocket, { name: "Subsolo" });
    const gmTraffic = recordEnvelopes(gmSocket);
    const playerTraffic = recordEnvelopes(playerSocket);

    const ack = await sendOp(playerSocket, "world:activeScene", { sceneId: otherId });
    await settle();

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    expect(onAirIdInDb(ctx)).toBe(sceneId);
    expect(activeMirrorInDb(ctx, otherId)).toBe(false);
    expect(pointerEnvelopes(gmTraffic)).toHaveLength(0);
    expect(pointerEnvelopes(playerTraffic)).toHaveLength(0);
  });

  it("REQ-CEN-045: activating a scene that does not exist fails, and the world keeps the scene it had on air", async () => {
    const sceneId = await createScene(gmSocket, { name: "Ermida" });
    await sendOp(gmSocket, "world:activeScene", { sceneId });
    await settle();

    const gmTraffic = recordEnvelopes(gmSocket);
    const playerTraffic = recordEnvelopes(playerSocket);

    const ack = await sendOp(gmSocket, "world:activeScene", { sceneId: "ghostscene00001" });
    await settle();

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("NOT_FOUND");
    // The pointer must never name a scene with no body behind it: the client
    // would render an empty canvas and no resync would ever repair it.
    expect(onAirIdInDb(ctx)).toBe(sceneId);
    expect(activeMirrorInDb(ctx, sceneId)).toBe(true);
    expect(pointerEnvelopes(gmTraffic)).toHaveLength(0);
    expect(pointerEnvelopes(playerTraffic)).toHaveLength(0);
  });

  it("REQ-CEN-041: clearing the air is still the same dedicated event — sceneId null is written and broadcast", async () => {
    const sceneId = await createScene(gmSocket, { name: "Descampado" });
    await sendOp(gmSocket, "world:activeScene", { sceneId });
    await settle();

    const playerTraffic = recordEnvelopes(playerSocket);
    const ack = await sendOp(gmSocket, "world:activeScene", { sceneId: null });
    await settle();

    expect(ack["ok"]).toBe(true);
    expect(onAirIdInDb(ctx)).toBeNull();
    expect(activeMirrorInDb(ctx, sceneId)).toBe(false);
    const pointers = pointerEnvelopes(playerTraffic);
    expect(pointers).toHaveLength(1);
    expect((pointers[0]?.["payload"] as Record<string, unknown>)["sceneId"]).toBeNull();
  });
});
