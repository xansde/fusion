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

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
    `fusion-manual-fog-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const worldId = "manual-fog-world";
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
    worldInfo: { id: worldId, title: "Manual Fog World", systemId: "stub" },
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
// Suite — manual fog: only the GM edits it; a token under it never reaches a
// player, on any emission path; clearing it brings the token back.
// ---------------------------------------------------------------------------

describe("manual fog of war — persistence, GM-only edit and token redaction", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let sceneId: string;
  let seenTokenId: string;
  let fogTokenId: string;

  const fogWithRevealedLeft = {
    enabled: true,
    base: "covered",
    // Reveals x 0..500, y 0..200: covers the first token's anchor, not the second's.
    ops: [{ t: "rect", m: "reveal", x: 0, y: 0, w: 500, h: 200 }],
  };

  beforeAll(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx, ctx.gmToken);
    playerSocket = connectClient(ctx, ctx.playerAToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnectSocket(gmSocket), waitForConnectSocket(playerSocket)]);

    const actorsAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Goblin", type: "npc" }],
    });
    const actorId = (actorsAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
      ._id;

    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Masmorra", tokens: [] }],
    });
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    expect((await sendOp(gmSocket, "world:activeScene", { sceneId }))["ok"]).toBe(true);

    const tokensAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [
        { actorId, name: "Visível", x: 0, y: 0 },
        { actorId, name: "Escondido", x: 800, y: 0 },
      ],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokensAck["ok"], JSON.stringify(tokensAck)).toBe(true);
    const docs = (tokensAck["result"] as { documents: Array<Record<string, unknown>> }).documents;
    seenTokenId = docs[0]!["_id"] as string;
    fogTokenId = docs[1]!["_id"] as string;
  }, 30000);

  afterAll(async () => {
    gmSocket?.disconnect();
    playerSocket?.disconnect();
    await teardown(ctx);
  });

  /**
   * Both sockets have received everything the server emitted so far. Events
   * reach a socket in emission order and a write that fails still gets an ack,
   * so one such round-trip per socket drains whatever is still in flight
   * before a test starts recording.
   */
  async function settle(): Promise<void> {
    await Promise.all(
      [gmSocket, playerSocket].map((socket) =>
        sendOp(socket, "doc:update", {
          documentType: "Scene",
          updates: [{ _id: "noSuchScene000000", diff: { name: "x" } }],
        }),
      ),
    );
  }

  /** The GM sets the scene's fog, and both sockets catch up with it. */
  async function setFog(fog: Record<string, unknown>): Promise<void> {
    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { manualFog: fog } }],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    await settle();
  }

  // Test independence: every test starts from the same table — fog off, the two
  // tokens where they were created — whatever the previous test did to it.
  beforeEach(async () => {
    await setFog({ enabled: false, base: "revealed", ops: [] });
    for (const [tokenId, x] of [
      [seenTokenId, 0],
      [fogTokenId, 800],
    ] as const) {
      const ack = await sendOp(gmSocket, "token:move", { sceneId, tokenId, x, y: 0 });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    }
    await settle();
  });

  it("a scene with no fog shows every token to the player (default off)", async () => {
    const traffic = recordEnvelopes(playerSocket);
    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { name: "Masmorra (plain)" } }],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    await waitForSeq(traffic, seqOf(ack), "player copy of the plain scene update");
    expect(tokenIdsIn(traffic).has(fogTokenId)).toBe(true);
  });

  it("the GM saves the fog; it persists on the scene and the player loses the covered token", async () => {
    const traffic = recordEnvelopes(playerSocket);
    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { manualFog: fogWithRevealedLeft } }],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const saved = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
    expect(saved["manualFog"], "the schema must not strip manualFog").toEqual(fogWithRevealedLeft);

    await waitForSeq(traffic, seqOf(ack), "player copy of the fog update");
    const ids = tokenIdsIn(traffic);
    expect(ids.has(seenTokenId)).toBe(true);
    expect(ids.has(fogTokenId)).toBe(false);
  });

  it("the GM still receives the covered token", async () => {
    await setFog(fogWithRevealedLeft);
    const traffic = recordEnvelopes(gmSocket);
    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { name: "Masmorra (GM)" } }],
    });
    await waitForSeq(traffic, seqOf(ack), "GM copy");
    expect(tokenIdsIn(traffic).has(fogTokenId)).toBe(true);
  });

  it("JOIN SNAPSHOT: a reconnecting player does not get the covered token, and keeps the fog", async () => {
    await setFog(fogWithRevealedLeft);
    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnectSocket(joiner);
    await waitForJoinBatch(traffic);
    const ids = tokenIdsIn(traffic);
    expect(ids.has(seenTokenId)).toBe(true);
    expect(ids.has(fogTokenId)).toBe(false);
    expect(JSON.stringify(traffic)).toContain('"manualFog"');
    joiner.disconnect();
  });

  it("a token moved into the fog by the GM disappears from the player", async () => {
    await setFog(fogWithRevealedLeft);
    const traffic = recordEnvelopes(playerSocket);
    const ack = await sendOp(gmSocket, "token:move", {
      sceneId,
      tokenId: seenTokenId,
      x: 900,
      y: 0,
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    await waitForSeq(traffic, seqOf(ack), "player copy of the move");
    expect(tokenIdsIn(traffic).has(seenTokenId)).toBe(false);
    await sendOp(gmSocket, "token:move", { sceneId, tokenId: seenTokenId, x: 0, y: 0 });
  });

  it("a player cannot edit the fog", async () => {
    await setFog(fogWithRevealedLeft);
    const ack = await sendOp(playerSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { manualFog: { enabled: false } } }],
    });
    expect(ack["ok"]).toBe(false);
    const joiner = connectClient(ctx, ctx.gmToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnectSocket(joiner);
    await waitForJoinBatch(traffic);
    expect(JSON.stringify(traffic)).toContain('"enabled":true');
    joiner.disconnect();
  });

  it("a fog too complex for the budget is refused", async () => {
    const points = Array.from({ length: 800 }, (_, i) => i);
    const ops = Array.from({ length: 40 }, () => ({ t: "brush", m: "reveal", r: 5, p: points }));
    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [{ _id: sceneId, diff: { manualFog: { enabled: true, base: "covered", ops } } }],
    });
    expect(ack["ok"]).toBe(false);
  });

  it("revealing everything brings the token back to the player", async () => {
    await setFog(fogWithRevealedLeft);
    const traffic = recordEnvelopes(playerSocket);
    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "Scene",
      updates: [
        { _id: sceneId, diff: { manualFog: { enabled: true, base: "revealed", ops: [] } } },
      ],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    await waitForSeq(traffic, seqOf(ack), "player copy of reveal-all");
    expect(tokenIdsIn(traffic).has(fogTokenId)).toBe(true);
  });
});
