/**
 * The scene LIST is privileged data — spec 44, §5.8.
 *
 * REQ-CEN-071: the server must not hand the scene list to a non-privileged user,
 *              and the refusal must be indistinguishable from the scene not existing.
 * REQ-CEN-072: the scene ON AIR keeps flowing, so the player can still render it.
 * REQ-CEN-073: the name of a scene that is not on air must not appear in ANY
 *              payload destined to a non-privileged user.
 * REQ-GAV-034: the rail hiding a GM-group tab is ergonomics, not a boundary —
 *              every datum a panel draws is protected server-side (DEC-CEN-11).
 *
 * These tests read the PAYLOAD the player's socket receives — never the screen —
 * across all three emission paths that can carry a Scene body: the live
 * broadcast, the join snapshot, and the delta-resync replay from the OpBuffer.
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

const OFF_AIR_NAME = "Cena Secreta do Mestre";
const ON_AIR_NAME = "Taverna do Javali";

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
    `fusion-scene-list-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const worldId = "scene-list-world";
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
    worldInfo: { id: worldId, title: "Scene List World", systemId: "stub" },
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

function connectClient(ctx: TestContext, token: string, lastSeq?: number): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
    auth: { token, protocolVersion: PROTOCOL_VERSION, lastSeq },
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

/** Every Scene document carried by an envelope of the given op types. */
function sceneDocsIn(envelopes: Record<string, unknown>[]): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  for (const env of envelopes) {
    const payload = env["payload"] as Record<string, unknown> | undefined;
    if (!payload) continue;
    // Live / replayed op.
    if (payload["documentType"] === "Scene" && Array.isArray(payload["documents"])) {
      docs.push(...(payload["documents"] as Record<string, unknown>[]));
    }
    // resync:delta — ops nested inside the payload.
    if (Array.isArray(payload["ops"])) {
      docs.push(...sceneDocsIn(payload["ops"] as Record<string, unknown>[]));
    }
    // resync:full — the join snapshot.
    const snapshot = payload["snapshot"] as Record<string, unknown> | undefined;
    if (snapshot) {
      const byType = snapshot["documents"] as Record<string, unknown[]> | undefined;
      const scenes = byType?.["Scene"];
      if (Array.isArray(scenes)) docs.push(...(scenes as Record<string, unknown>[]));
    }
  }
  return docs;
}

async function createScene(gmSocket: ClientSocket, name: string): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [{ name }],
  });
  expect(ack["ok"]).toBe(true);
  const docs = (ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[];
  return docs[0]?.["_id"] as string;
}

// ---------------------------------------------------------------------------

describe("spec 44 §5.8 — the scene list is server-side privileged (REQ-GAV-034)", () => {
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

  it("REQ-CEN-071/REQ-CEN-073: no envelope the player receives carries the name of a scene that is not on air", async () => {
    const playerTraffic = recordEnvelopes(playerSocket);

    await createScene(gmSocket, OFF_AIR_NAME);
    await settle();

    // The whole traffic, not just the Scene branch: the name must not surface
    // anywhere, under any key.
    expect(JSON.stringify(playerTraffic)).not.toContain(OFF_AIR_NAME);
    expect(sceneDocsIn(playerTraffic)).toHaveLength(0);
  });

  it("REQ-CEN-071: the refusal is indistinguishable from inexistence — the envelope still arrives, with an empty batch", async () => {
    const playerTraffic = recordEnvelopes(playerSocket);

    const ack = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: OFF_AIR_NAME }],
    });
    await settle();

    // The seq must still reach the player — swallowing the envelope would trip
    // the client mirror's gap detector and put every player in a resync loop.
    const creates = playerTraffic.filter((env) => env["type"] === "doc:create");
    const sceneCreate = creates.find(
      (env) => (env["payload"] as Record<string, unknown>)["documentType"] === "Scene",
    );
    expect(sceneCreate).toBeDefined();
    expect(sceneCreate?.["seq"]).toBe(ack["seq"]);
    expect((sceneCreate?.["payload"] as Record<string, unknown>)["documents"]).toEqual([]);
  });

  it("REQ-CEN-071: the same op carries the full document to the privileged socket", async () => {
    const gmTraffic = recordEnvelopes(gmSocket);

    await createScene(gmSocket, OFF_AIR_NAME);
    await settle();

    const names = sceneDocsIn(gmTraffic).map((doc) => doc["name"]);
    expect(names).toContain(OFF_AIR_NAME);
  });

  it("REQ-CEN-072: the scene put on air does reach the player, name and all", async () => {
    const sceneId = await createScene(gmSocket, ON_AIR_NAME);
    const playerTraffic = recordEnvelopes(playerSocket);

    const ack = await sendOp(gmSocket, "world:activeScene", { sceneId });
    expect(ack["ok"]).toBe(true);
    await settle();

    const onAirDocs = sceneDocsIn(playerTraffic).filter((doc) => doc["_id"] === sceneId);
    expect(onAirDocs.length).toBeGreaterThan(0);
    expect(onAirDocs[0]?.["name"]).toBe(ON_AIR_NAME);

    // …and the body lands BEFORE the pointer that references it, so the canvas
    // never sees an active id with no document behind it.
    const bodySeq = playerTraffic.find(
      (env) =>
        env["type"] === "doc:update" &&
        (env["payload"] as Record<string, unknown>)["documentType"] === "Scene",
    )?.["seq"] as number;
    const pointerSeq = playerTraffic.find((env) => env["type"] === "world:activeScene")?.[
      "seq"
    ] as number;
    expect(bodySeq).toBeLessThan(pointerSeq);
  });

  it("REQ-CEN-072/REQ-CEN-073: with one scene on air, edits to the OTHER scene stay invisible", async () => {
    const onAirId = await createScene(gmSocket, ON_AIR_NAME);
    const offAirId = await createScene(gmSocket, OFF_AIR_NAME);
    await sendOp(gmSocket, "world:activeScene", { sceneId: onAirId });
    await settle();

    const playerTraffic = recordEnvelopes(playerSocket);
    await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: offAirId, diff: { name: `${OFF_AIR_NAME} (renomeada)` } }],
    });
    await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: onAirId, diff: { "grid.size": 140 } }],
    });
    await settle();

    expect(JSON.stringify(playerTraffic)).not.toContain(OFF_AIR_NAME);
    const seen = sceneDocsIn(playerTraffic);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((doc) => doc["_id"] === onAirId)).toBe(true);
  });

  it("REQ-CEN-071: the join snapshot lists only the scene on air", async () => {
    const onAirId = await createScene(gmSocket, ON_AIR_NAME);
    await createScene(gmSocket, OFF_AIR_NAME);
    await sendOp(gmSocket, "world:activeScene", { sceneId: onAirId });
    await settle();

    const joiner = connectClient(ctx, ctx.playerToken);
    const joinerTraffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await settle();

    expect(JSON.stringify(joinerTraffic)).not.toContain(OFF_AIR_NAME);
    const scenes = sceneDocsIn(joinerTraffic);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.["_id"]).toBe(onAirId);
    joiner.disconnect();
  });

  it("REQ-CEN-073: the delta replayed on reconnect carries no off-air scene name", async () => {
    // The player records where it stands, goes away, and the GM works on a
    // scene the player must never learn about.
    let playerLastSeq = 0;
    const seqProbe = connectClient(ctx, ctx.playerToken);
    seqProbe.on("op", (env: Record<string, unknown>) => {
      if (env["type"] === "resync:full") {
        const snap = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
          string,
          unknown
        > | null;
        if (snap) playerLastSeq = snap["seq"] as number;
      }
    });
    seqProbe.connect();
    await waitForConnect(seqProbe);
    await settle();
    seqProbe.disconnect();

    const offAirId = await createScene(gmSocket, OFF_AIR_NAME);
    await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: offAirId, diff: { "grid.size": 200 } }],
    });
    await settle();

    const reconnected = connectClient(ctx, ctx.playerToken, playerLastSeq);
    const replayTraffic = recordEnvelopes(reconnected);
    reconnected.connect();
    await waitForConnect(reconnected);
    await settle();

    expect(JSON.stringify(replayTraffic)).not.toContain(OFF_AIR_NAME);
    expect(sceneDocsIn(replayTraffic)).toHaveLength(0);
    reconnected.disconnect();
  });

  it("REQ-CEN-071: deleting an off-air scene tells the player nothing — not even the id", async () => {
    const offAirId = await createScene(gmSocket, OFF_AIR_NAME);
    await settle();

    const playerTraffic = recordEnvelopes(playerSocket);
    const ack = await sendOp(gmSocket, "doc:delete", {
      documentType: "Scene",
      ids: [offAirId],
    });
    expect(ack["ok"]).toBe(true);
    await settle();

    const deletes = playerTraffic.filter((env) => env["type"] === "doc:delete");
    expect(deletes).toHaveLength(1);
    expect((deletes[0]?.["payload"] as Record<string, unknown>)["ids"]).toEqual([]);
    expect(JSON.stringify(playerTraffic)).not.toContain(offAirId);

    // The GM's own copy of the same op still names the id — the redaction is
    // scoped by role (isRolePrivileged), not a blanket strip.
    const gmTraffic = recordEnvelopes(gmSocket);
    const secondId = await createScene(gmSocket, "Outra Cena");
    await sendOp(gmSocket, "doc:delete", { documentType: "Scene", ids: [secondId] });
    await settle();
    expect(JSON.stringify(gmTraffic)).toContain(secondId);
  });
});
