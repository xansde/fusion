/**
 * TK070 (spec 41-token.md, Fase 6) — a hidden token's `seenBy` exception,
 * proven across the FOUR emission paths REQ-NET-096/CA-TOK-007 name:
 * snapshot on join, live broadcast, delta replay on resync, and the ack
 * echoed back to a socket that wrote something else in the same scene.
 *
 * REQ-TOK-050: a token may be hidden, and hiding admits a `seenBy` exception
 * list.
 * REQ-TOK-051: a hidden token is not emitted to a non-privileged socket that
 * is neither privileged nor in `seenBy` — in NONE of the four paths.
 * CA-TOK-007: an armadilha (trap) token, hidden with an exception for one
 * player, does not appear in the payload the other players receive, in
 * snapshot, broadcast, replay and ack.
 *
 * Infrastructure mirrors contacts-redaction.test.ts (same day, same repo):
 * a real boot()-free harness (Fastify + SocketManager directly) driving real
 * sockets, so every assertion reads the payload a socket actually received.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
// Harness (mirrors contacts-redaction.test.ts)
// ---------------------------------------------------------------------------

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  playerAToken: string;
  playerAId: string;
  playerBToken: string;
  playerBId: string;
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-token-seenby-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const worldId = "token-seenby-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: join(dataDir, "world.db"), skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, join(dataDir, "world.db"));

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: playerA } = await authService.createUser({
    name: "Jogadora A",
    role: Role.PLAYER,
    password: "player-a-pass",
  });
  const { user: playerB } = await authService.createUser({
    name: "Jogador B",
    role: Role.PLAYER,
    password: "player-b-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const aLogin = await authService.login({
    userId: playerA.id,
    password: "player-a-pass",
    ip: "127.0.0.1",
  });
  const bLogin = await authService.login({
    userId: playerB.id,
    password: "player-b-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Token SeenBy World", systemId: "stub" },
  });
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
    playerAToken: aLogin.accessToken,
    playerAId: playerA.id,
    playerBToken: bLogin.accessToken,
    playerBId: playerB.id,
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

function waitForConnectSocket(socket: ClientSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout waiting for ack: ${type}`));
    }, 8000);
  });
}

function recordEnvelopes(socket: ClientSocket): Record<string, unknown>[] {
  const received: Record<string, unknown>[] = [];
  socket.on("op", (env: Record<string, unknown>) => {
    received.push(env);
  });
  return received;
}

const POLL_INTERVAL_MS = 25;
const WAIT_TIMEOUT_MS = 8000;

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    if (check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

function waitForJoinBatch(traffic: Record<string, unknown>[]): Promise<void> {
  return waitFor(
    () => traffic.some((e) => e["type"] === "resync:full" || e["type"] === "resync:delta"),
    "the join batch (resync:full/resync:delta)",
  );
}

function waitForSeq(traffic: Record<string, unknown>[], seq: number, what: string): Promise<void> {
  return waitFor(() => traffic.some((e) => e["seq"] === seq), `${what} (seq ${String(seq)})`);
}

function seqOf(ack: Record<string, unknown>): number {
  const seq = ack["seq"];
  if (typeof seq !== "number") throw new Error("ack carried no seq");
  return seq;
}

function snapshotSeq(traffic: Record<string, unknown>[]): number {
  for (const env of traffic) {
    if (env["type"] !== "resync:full") continue;
    const snap = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
      string,
      unknown
    > | null;
    if (snap) return snap["seq"] as number;
  }
  throw new Error("no resync:full snapshot in the recorded traffic");
}

/** Every Token id carried by any Scene body in the recorded traffic, whatever path. */
function tokenIdsIn(envelopes: Record<string, unknown>[]): Set<string> {
  const ids = new Set<string>();
  const walkScene = (scene: unknown): void => {
    if (!scene || typeof scene !== "object") return;
    const tokens = (scene as Record<string, unknown>)["tokens"];
    if (!Array.isArray(tokens)) return;
    for (const t of tokens as Record<string, unknown>[]) {
      const id = t["_id"];
      if (typeof id === "string") ids.add(id);
    }
  };
  const walkEnvelope = (env: Record<string, unknown>): void => {
    const payload = env["payload"] as Record<string, unknown> | undefined;
    if (!payload) return;
    if (payload["documentType"] === "Scene" && Array.isArray(payload["documents"])) {
      for (const doc of payload["documents"] as unknown[]) walkScene(doc);
    }
    if (payload["documentType"] === "Scene" && payload["parent"]) {
      walkScene(payload["parent"]);
    }
    if (Array.isArray(payload["ops"])) {
      for (const op of payload["ops"] as Record<string, unknown>[]) walkEnvelope(op);
    }
    const snapshot = payload["snapshot"] as Record<string, unknown> | undefined;
    if (snapshot) {
      const byType = snapshot["documents"] as Record<string, unknown[]> | undefined;
      const scenes = byType?.["Scene"];
      if (Array.isArray(scenes)) for (const s of scenes) walkScene(s);
    }
  };
  for (const env of envelopes) walkEnvelope(env);
  return ids;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("TK070 — hidden token seenBy exception across the four emission paths (REQ-TOK-050/051, CA-TOK-007)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerASocket: ClientSocket;
  let playerBSocket: ClientSocket;
  let sceneId: string;
  let trapTokenId: string;
  let pcATokenId: string;
  let pcBTokenId: string;

  beforeAll(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx, ctx.gmToken);
    playerASocket = connectClient(ctx, ctx.playerAToken);
    playerBSocket = connectClient(ctx, ctx.playerBToken);
    gmSocket.connect();
    playerASocket.connect();
    playerBSocket.connect();
    await Promise.all([
      waitForConnectSocket(gmSocket),
      waitForConnectSocket(playerASocket),
      waitForConnectSocket(playerBSocket),
    ]);

    const actorsAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        { name: "PC de A", type: "character", ownership: { default: 0, [ctx.playerAId]: 3 } },
        { name: "PC de B", type: "character", ownership: { default: 0, [ctx.playerBId]: 3 } },
      ],
    });
    expect(actorsAck["ok"], JSON.stringify(actorsAck)).toBe(true);
    const actors = (actorsAck["result"] as { documents: Array<{ _id: string }> }).documents;
    const pcAActorId = actors[0]!._id;
    const pcBActorId = actors[1]!._id;

    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Câmara da Armadilha", tokens: [] }],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const activateAck = await sendOp(gmSocket, "world:activeScene", { sceneId });
    expect(activateAck["ok"]).toBe(true);

    const tokensAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [
        { actorId: pcAActorId, name: "A", x: 0, y: 0 },
        { actorId: pcBActorId, name: "B", x: 100, y: 0 },
        {
          actorId: pcAActorId, // placeholder; overwritten by a GM-only trap below
          x: 200,
          y: 0,
          hidden: true,
          seenBy: [ctx.playerAId],
        },
      ],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokensAck["ok"], JSON.stringify(tokensAck)).toBe(true);
    const tokenDocs = (tokensAck["result"] as { documents: Array<Record<string, unknown>> })
      .documents;
    pcATokenId = tokenDocs[0]!["_id"] as string;
    pcBTokenId = tokenDocs[1]!["_id"] as string;
    trapTokenId = tokenDocs[2]!["_id"] as string;
  }, 30000);

  afterAll(async () => {
    gmSocket?.disconnect();
    playerASocket?.disconnect();
    playerBSocket?.disconnect();
    await teardown(ctx);
  });

  it("LIVE BROADCAST: the trap token reaches player A (in seenBy) and not player B", async () => {
    const trafficA = recordEnvelopes(playerASocket);
    const trafficB = recordEnvelopes(playerBSocket);

    const moveAck = await sendOp(gmSocket, "token:move", {
      sceneId,
      tokenId: trapTokenId,
      x: 210,
      y: 0,
    });
    expect(moveAck["ok"], JSON.stringify(moveAck)).toBe(true);

    await waitForSeq(trafficA, seqOf(moveAck), "player A's copy of the trap move broadcast");
    await waitForSeq(trafficB, seqOf(moveAck), "player B's copy of the trap move broadcast");

    expect(tokenIdsIn(trafficA).has(trapTokenId)).toBe(true);
    expect(tokenIdsIn(trafficB).has(trapTokenId)).toBe(false);
  });

  it("JOIN SNAPSHOT: a fresh connection for player A includes the trap; for player B it does not", async () => {
    const joinerA = connectClient(ctx, ctx.playerAToken);
    const trafficA = recordEnvelopes(joinerA);
    joinerA.connect();
    await waitForConnectSocket(joinerA);
    await waitForJoinBatch(trafficA);

    const joinerB = connectClient(ctx, ctx.playerBToken);
    const trafficB = recordEnvelopes(joinerB);
    joinerB.connect();
    await waitForConnectSocket(joinerB);
    await waitForJoinBatch(trafficB);

    expect(tokenIdsIn(trafficA).has(trapTokenId)).toBe(true);
    expect(tokenIdsIn(trafficB).has(trapTokenId)).toBe(false);
    // Sanity: both still see the ordinary tokens, so this is REDACTION, not breakage.
    expect(tokenIdsIn(trafficA).has(pcATokenId)).toBe(true);
    expect(tokenIdsIn(trafficB).has(pcBTokenId)).toBe(true);

    joinerA.disconnect();
    joinerB.disconnect();
  });

  it("DELTA REPLAY: reconnecting inside the buffer window replays the trap for A only", async () => {
    const probeA = connectClient(ctx, ctx.playerAToken);
    const probeATraffic = recordEnvelopes(probeA);
    probeA.connect();
    await waitForConnectSocket(probeA);
    await waitForJoinBatch(probeATraffic);
    const lastSeqA = snapshotSeq(probeATraffic);
    probeA.disconnect();

    const probeB = connectClient(ctx, ctx.playerBToken);
    const probeBTraffic = recordEnvelopes(probeB);
    probeB.connect();
    await waitForConnectSocket(probeB);
    await waitForJoinBatch(probeBTraffic);
    const lastSeqB = snapshotSeq(probeBTraffic);
    probeB.disconnect();

    const moveAck = await sendOp(gmSocket, "token:move", {
      sceneId,
      tokenId: trapTokenId,
      x: 220,
      y: 0,
    });
    expect(moveAck["ok"]).toBe(true);

    const replayerA = connectClient(ctx, ctx.playerAToken, lastSeqA);
    const replayTrafficA = recordEnvelopes(replayerA);
    replayerA.connect();
    await waitForConnectSocket(replayerA);
    await waitFor(
      () => replayTrafficA.some((e) => e["type"] === "resync:delta"),
      "player A's delta replay",
    );

    const replayerB = connectClient(ctx, ctx.playerBToken, lastSeqB);
    const replayTrafficB = recordEnvelopes(replayerB);
    replayerB.connect();
    await waitForConnectSocket(replayerB);
    await waitFor(
      () => replayTrafficB.some((e) => e["type"] === "resync:delta"),
      "player B's delta replay",
    );

    expect(tokenIdsIn(replayTrafficA).has(trapTokenId)).toBe(true);
    expect(tokenIdsIn(replayTrafficB).has(trapTokenId)).toBe(false);

    replayerA.disconnect();
    replayerB.disconnect();
  });

  it("ACK ECHO: player A moving their own token gets the trap in the echoed scene; player B does not", async () => {
    const ackA = await sendOp(playerASocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: pcATokenId,
          diff: { x: 5, y: 5 },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ackA["ok"], JSON.stringify(ackA)).toBe(true);
    const scenesA = (ackA["result"] as { documents: Array<Record<string, unknown>> }).documents;
    const tokensA = scenesA[0]!["tokens"] as Array<Record<string, unknown>>;
    expect(tokensA.some((t) => t["_id"] === trapTokenId)).toBe(true);

    const ackB = await sendOp(playerBSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: pcBTokenId,
          diff: { x: 105, y: 5 },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ackB["ok"], JSON.stringify(ackB)).toBe(true);
    const scenesB = (ackB["result"] as { documents: Array<Record<string, unknown>> }).documents;
    const tokensB = scenesB[0]!["tokens"] as Array<Record<string, unknown>>;
    expect(tokensB.some((t) => t["_id"] === trapTokenId)).toBe(false);
  });
});
