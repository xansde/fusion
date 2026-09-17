/**
 * Regression test for B1 (onda-3 adversarial review, ALQ-F1-05): the
 * `flags.fusion.targetSnapshot` a roll message carries must answer to the
 * SAME hidden-token redaction as everything else in `net/redaction.ts` — a
 * non-privileged socket must never learn the tokenId/actorId of a token the
 * Mestre has hidden, on any chat emission path (live broadcast, chat:history,
 * chat:search, chat:context). The Mestre must keep seeing it on all of them
 * (the cut is BY ROLE, never a blanket wipe of the whole snapshot).
 *
 * Reproduces the exact scenario from the review report: the Mestre marks a
 * hidden token as a live target (`combat:target`, REQ-CBT-053 — any
 * authenticated socket may call it, unrestricted — a separate, pre-existing
 * gap this test does not fix) and rolls a PUBLIC attack. Before the fix,
 * every non-privileged socket received the hidden token's real
 * tokenId/actorId inside `flags.fusion.targetSnapshot`, permanently: the
 * value is persisted verbatim and re-read by every history/search/context
 * query the same way.
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
// Test harness (same shape as chat-target.test.ts; data dir in OS temp;
// port 0 — the OS assigns it and we read it back, so nothing is hardcoded)
// ---------------------------------------------------------------------------

const SCENE_ID = "snapshotScene0001";
/** A token the Mestre has HIDDEN — the ambush the players must never learn the id of. */
const AMBUSH_TOKEN_ID = "ambushToken00001";
const AMBUSH_ACTOR_ID = "ambushActor00001";
/** A token that is NOT hidden — proves the cut is per-entry, not a wipe of the array. */
const ALLY_TOKEN_ID = "allyToken000001a";
const ALLY_ACTOR_ID = "allyActor0000001";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-chat-snapshot-redaction-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  gmId: string;
  playerId: string;
  gmToken: string;
  playerToken: string;
}

/** One on-air scene: a hidden ambush token + a visible ally token, both targetable. */
function seedScene(db: FusionDatabase): void {
  const now = Date.now();
  const scene = {
    _id: SCENE_ID,
    name: "Emboscada",
    active: true,
    tokens: [
      { _id: AMBUSH_TOKEN_ID, name: "Emboscador Oculto", actorId: AMBUSH_ACTOR_ID, hidden: true },
      { _id: ALLY_TOKEN_ID, name: "Aliado à Vista", actorId: ALLY_ACTOR_ID, hidden: false },
    ],
  };
  db.raw
    .prepare(
      `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, ?, ?)`,
    )
    .run(SCENE_ID, JSON.stringify(scene), "Emboscada", now, now);
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-chat-snapshot-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  seedScene(fusionDb);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player1-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Test Chat Snapshot World", systemId: "stub" },
  });

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });

  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
  });

  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const address = fastify.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmId: gm.id,
    playerId: player.id,
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

function connectSocket(port: number, worldId: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    socket.once("connect", () => {
      socket.once("op", () => resolve(socket));
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function emitEnvelope(
  socket: ClientSocket,
  event: "op" | "query",
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const envelope = {
      type,
      ts: Date.now(),
      payload,
      requestId: Math.random().toString(36).slice(2),
    };
    socket.emit(event, envelope, (ack: unknown) => {
      if (!ack || typeof ack !== "object") {
        reject(new Error("No ack"));
        return;
      }
      resolve(ack as Record<string, unknown>);
    });
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

const sendOp = (socket: ClientSocket, type: string, payload: unknown) =>
  emitEnvelope(socket, "op", type, payload);

const sendQuery = (socket: ClientSocket, type: string, payload: unknown) =>
  emitEnvelope(socket, "query", type, payload);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface SnapshotEntryLike {
  tokenId?: string;
  actorId?: string | null;
  sceneId?: string;
}

interface ChatMessageLike {
  _id?: string;
  content?: string;
  flags?: { fusion?: { targetSnapshot?: SnapshotEntryLike[] } };
}

/** Waits for the next `doc:create` broadcast carrying a ChatMessage. */
function nextChatMessage(socket: ClientSocket, timeoutMs = 3000): Promise<ChatMessageLike> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Record<string, unknown>): void => {
      if (envelope["type"] !== "doc:create") return;
      const payload = envelope["payload"] as { documentType?: string; documents?: unknown[] };
      if (payload.documentType !== "ChatMessage") return;
      socket.off("op", handler);
      resolve((payload.documents?.[0] ?? {}) as ChatMessageLike);
    };
    socket.on("op", handler);
    setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("no chat doc:create broadcast"));
    }, timeoutMs);
  });
}

function snapshotTokenIds(msg: ChatMessageLike): string[] {
  return (msg.flags?.fusion?.targetSnapshot ?? [])
    .map((e) => e.tokenId)
    .filter((id): id is string => typeof id === "string");
}

// ---------------------------------------------------------------------------
// Tests — B1: targetSnapshot must honour the same hidden-token redaction
// ---------------------------------------------------------------------------

describe("flags.fusion.targetSnapshot — token oculto nunca sai para socket não-privilegiado (B1)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    [gmSocket, playerSocket] = await Promise.all([
      connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
      connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
    ]);

    // The Mestre marks BOTH tokens as live targets — the hidden ambush and the
    // visible ally — before rolling. `combat:target` has no hidden/ownership
    // check (a pre-existing, separately tracked gap), so this is reachable
    // exactly as the review describes.
    await sendOp(gmSocket, "combat:target", { tokenId: AMBUSH_TOKEN_ID, targeted: true });
    await sendOp(gmSocket, "combat:target", { tokenId: ALLY_TOKEN_ID, targeted: true });
  }, 15_000);

  afterEach(async () => {
    gmSocket?.disconnect();
    playerSocket?.disconnect();
    await teardown(ctx);
  });

  it("caminho 1/3 — broadcast ao vivo: o jogador não recebe o alvo oculto; o Mestre recebe os dois", async () => {
    const gmSeen = nextChatMessage(gmSocket);
    const playerSeen = nextChatMessage(playerSocket);

    const ack = await sendOp(gmSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const [gmMsg, playerMsg] = await Promise.all([gmSeen, playerSeen]);

    // The Mestre's own broadcast copy carries BOTH targets, tokenId AND actorId.
    expect(snapshotTokenIds(gmMsg)).toEqual(
      expect.arrayContaining([AMBUSH_TOKEN_ID, ALLY_TOKEN_ID]),
    );
    const gmAmbushEntry = gmMsg.flags?.fusion?.targetSnapshot?.find(
      (e) => e.tokenId === AMBUSH_TOKEN_ID,
    );
    expect(gmAmbushEntry?.actorId).toBe(AMBUSH_ACTOR_ID);

    // The player's copy keeps the visible ally, and drops the hidden ambush
    // entirely — not just its name, the tokenId/actorId themselves never
    // reach the bytes the player received.
    expect(snapshotTokenIds(playerMsg)).toEqual([ALLY_TOKEN_ID]);
    expect(JSON.stringify(playerMsg)).not.toContain(AMBUSH_TOKEN_ID);
    expect(JSON.stringify(playerMsg)).not.toContain(AMBUSH_ACTOR_ID);
  });

  it("caminho 2/3 — chat:history: a mesma redação sobrevive à releitura persistida", async () => {
    const gmSeen = nextChatMessage(gmSocket);
    await sendOp(gmSocket, "chat:send", { content: "/roll 1d20+7", worldId: ctx.worldId });
    await gmSeen;
    await sleep(10);

    const playerHistory = await sendQuery(playerSocket, "chat:history", {
      worldId: ctx.worldId,
      limit: 10,
    });
    const playerMessages = (playerHistory["result"] as { messages: ChatMessageLike[] }).messages;
    expect(playerMessages.length).toBeGreaterThan(0);
    expect(JSON.stringify(playerMessages)).not.toContain(AMBUSH_TOKEN_ID);
    expect(JSON.stringify(playerMessages)).not.toContain(AMBUSH_ACTOR_ID);
    expect(playerMessages.some((m) => snapshotTokenIds(m).includes(ALLY_TOKEN_ID))).toBe(true);

    // The Mestre reads the same log and the hidden target is still there.
    const gmHistory = await sendQuery(gmSocket, "chat:history", {
      worldId: ctx.worldId,
      limit: 10,
    });
    const gmMessages = (gmHistory["result"] as { messages: ChatMessageLike[] }).messages;
    expect(gmMessages.some((m) => snapshotTokenIds(m).includes(AMBUSH_TOKEN_ID))).toBe(true);
  });

  it("caminho 3/3 — chat:search e chat:context: a mesma redação vale para busca e janela de contexto", async () => {
    const gmSeen = nextChatMessage(gmSocket);
    const ack = await sendOp(gmSocket, "chat:send", {
      content: "/roll 1d20+7 # emboscada-b1",
      worldId: ctx.worldId,
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const messageId = String((ack["result"] as { message: ChatMessageLike }).message._id);
    await gmSeen;
    await sleep(20);

    // Search
    const playerSearch = await sendQuery(playerSocket, "chat:search", {
      worldId: ctx.worldId,
      q: "emboscada-b1",
    });
    expect(playerSearch["ok"], JSON.stringify(playerSearch)).toBe(true);
    const playerHits = (playerSearch["result"] as { messages: ChatMessageLike[] }).messages;
    expect(JSON.stringify(playerHits)).not.toContain(AMBUSH_TOKEN_ID);
    expect(JSON.stringify(playerHits)).not.toContain(AMBUSH_ACTOR_ID);

    const gmSearch = await sendQuery(gmSocket, "chat:search", {
      worldId: ctx.worldId,
      q: "emboscada-b1",
    });
    const gmHits = (gmSearch["result"] as { messages: ChatMessageLike[] }).messages;
    expect(gmHits.some((m) => snapshotTokenIds(m).includes(AMBUSH_TOKEN_ID))).toBe(true);

    // Context window
    const playerContext = await sendQuery(playerSocket, "chat:context", {
      worldId: ctx.worldId,
      id: messageId,
      limit: 5,
    });
    expect(playerContext["ok"], JSON.stringify(playerContext)).toBe(true);
    expect(JSON.stringify(playerContext)).not.toContain(AMBUSH_TOKEN_ID);
    expect(JSON.stringify(playerContext)).not.toContain(AMBUSH_ACTOR_ID);

    const gmContext = await sendQuery(gmSocket, "chat:context", {
      worldId: ctx.worldId,
      id: messageId,
      limit: 5,
    });
    const gmTarget = (gmContext["result"] as { target: ChatMessageLike }).target;
    expect(snapshotTokenIds(gmTarget)).toEqual(expect.arrayContaining([AMBUSH_TOKEN_ID]));
  });
});
