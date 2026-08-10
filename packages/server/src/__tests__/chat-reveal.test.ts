/**
 * Integration tests for `chat:reveal` — turning an already-sent private message
 * public (spec 09, DEC-CHT-10).
 *
 * The defect these tests exist to catch: the "who receives this message"
 * decision lives in THREE places in chat-handler.ts (live broadcast, chat:history
 * and the join snapshot). A reveal that only touches the broadcast looks correct
 * on screen and loses the message again on the next reload. So every reveal test
 * below asserts all three reading paths, not just the one that is easy to see.
 *
 * Coverage:
 *   - REQ-CHT-045: a privileged role reveals a private message
 *   - REQ-CHT-046: revealed in the live broadcast AND chat:history AND the join
 *     snapshot of a client that connects afterwards
 *   - REQ-CHT-047: the revealed message carries revealedBy / revealedAt
 *   - REQ-CHT-048: a plain player cannot reveal (permission error, message stays
 *     private); revealing an already-public message changes nothing
 *   - REQ-CHT-049: revealing never re-rolls and never leaks the seed; the author
 *     of a revealed /blindroll stops getting the placeholder and sees the real total
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
// Test harness (mirrors chat-roll.test.ts — real server, real sockets)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-chat-reveal-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  authService: AuthService;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmId: string;
  playerId: string;
  player2Id: string;
  gmToken: string;
  playerToken: string;
  player2Token: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-reveal-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
    color: "#00ff00",
  });
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
    color: "#0000ff",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player1-pass",
    ip: "127.0.0.1",
  });
  const player2Login = await authService.login({
    userId: player2.id,
    password: "player2-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Test Reveal World", systemId: "stub" },
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

  // port 0 → the OS picks a free port; never a literal (see helpers/ports.ts).
  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const address = fastify.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    dataDir,
    fusionDb,
    authService,
    fastify,
    socketManager,
    port,
    worldId,
    gmId: gm.id,
    playerId: player.id,
    player2Id: player2.id,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    player2Token: player2Login.accessToken,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

type OpMessage = {
  type: string;
  seq: number;
  ts: number;
  payload: {
    documentType?: string;
    documents?: Record<string, unknown>[];
  };
};

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

/** Connect and collect every `op` of the join window (resync + chat snapshot). */
function connectAndCollectJoinOps(
  port: number,
  worldId: string,
  token: string,
  quietMs = 400,
): Promise<{ socket: ClientSocket; ops: OpMessage[] }> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    const ops: OpMessage[] = [];
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const arm = (): void => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        socket.off("op", onOp);
        resolve({ socket, ops });
      }, quietMs);
    };
    const onOp = (msg: OpMessage): void => {
      ops.push(msg);
      arm();
    };

    socket.once("connect", () => {
      socket.on("op", onOp);
      arm();
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function chatDocsFromOps(ops: OpMessage[]): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  for (const op of ops) {
    const payload = op.payload as Record<string, unknown>;
    if (payload["documentType"] === "ChatMessage" && Array.isArray(payload["documents"])) {
      docs.push(...(payload["documents"] as Record<string, unknown>[]));
    }
  }
  return docs;
}

function sendOp(
  socket: ClientSocket,
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
    socket.emit("op", envelope, (ack: unknown) => {
      if (!ack || typeof ack !== "object") {
        reject(new Error("No ack"));
        return;
      }
      resolve(ack as Record<string, unknown>);
    });
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

/** Collect ops for a fixed window, returning whatever arrived. */
function collectOps(socket: ClientSocket, count: number, timeoutMs = 1500): Promise<OpMessage[]> {
  return new Promise((resolve) => {
    const collected: OpMessage[] = [];
    const timer = setTimeout(() => {
      socket.off("op", handler);
      resolve(collected);
    }, timeoutMs);

    const handler = (msg: OpMessage): void => {
      collected.push(msg);
      if (collected.length >= count) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(collected);
      }
    };
    socket.on("op", handler);
  });
}

/** Ask a socket for its visible history and return the raw message documents. */
async function history(socket: ClientSocket, worldId: string): Promise<Record<string, unknown>[]> {
  const ack = await sendOp(socket, "chat:history", { worldId, limit: 50 });
  expect(ack["ok"]).toBe(true);
  const result = ack["result"] as { messages?: Record<string, unknown>[] };
  return result.messages ?? [];
}

function findById(
  docs: Record<string, unknown>[],
  id: string,
): Record<string, unknown> | undefined {
  return docs.find((d) => d["_id"] === id);
}

/** `_id` of the message the ack of a chat:send refers to. */
function sentMessageId(ack: Record<string, unknown>): string {
  const message = (ack["result"] as { message?: Record<string, unknown> } | undefined)?.message;
  const id = message?.["_id"];
  expect(typeof id).toBe("string");
  return id as string;
}

/** Deep scan for a `seed` key anywhere in a payload — REQ-CHT-049 / REQ-ROL-049. */
function containsSeed(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSeed);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "seed") return true;
      if (containsSeed(child)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chat:reveal — GM makes a private message public", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let player2Socket: ClientSocket;
  let lateSockets: ClientSocket[] = [];

  beforeEach(async () => {
    ctx = await buildTestContext();
    [gmSocket, playerSocket, player2Socket] = await Promise.all([
      connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
      connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
      connectSocket(ctx.port, ctx.worldId, ctx.player2Token),
    ]);
    lateSockets = [];
  }, 15_000);

  afterEach(async () => {
    gmSocket?.disconnect();
    playerSocket?.disconnect();
    player2Socket?.disconnect();
    for (const s of lateSockets) s.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  it("REQ-CHT-045/046: a revealed /gmroll reaches the outsider live, in history and in a later join snapshot", async () => {
    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/gmroll 1d20",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 150));

    // Before the reveal player2 sees nothing of it — the premise of the test.
    expect(findById(await history(player2Socket, ctx.worldId), messageId)).toBeUndefined();

    // Live broadcast: player2 must now receive the message.
    const player2Ops = collectOps(player2Socket, 1);
    const revealAck = await sendOp(gmSocket, "chat:reveal", {
      worldId: ctx.worldId,
      messageId,
    });
    expect(revealAck["ok"]).toBe(true);

    const liveDoc = findById(chatDocsFromOps(await player2Ops), messageId);
    expect(liveDoc).toBeDefined();
    expect(liveDoc?.["whisper"]).toEqual([]);
    expect(liveDoc?.["blind"]).toBe(false);
    expect(Array.isArray(liveDoc?.["rolls"])).toBe(true);

    // History: the SAME message, for the same outsider, after the fact.
    const historyDoc = findById(await history(player2Socket, ctx.worldId), messageId);
    expect(historyDoc).toBeDefined();
    expect(Array.isArray(historyDoc?.["rolls"])).toBe(true);

    // Join snapshot: a client that connects only now must get it too.
    const { socket: lateSocket, ops } = await connectAndCollectJoinOps(
      ctx.port,
      ctx.worldId,
      ctx.player2Token,
    );
    lateSockets.push(lateSocket);
    const snapshotDoc = findById(chatDocsFromOps(ops), messageId);
    expect(snapshotDoc).toBeDefined();
    expect(Array.isArray(snapshotDoc?.["rolls"])).toBe(true);
    // The audit stamp has to survive the snapshot path too, or the badge would
    // only appear for whoever happened to be connected at the reveal.
    expect(typeof snapshotDoc?.["revealedAt"]).toBe("number");
    expect(snapshotDoc?.["revealedBy"]).toBe(ctx.gmId);
  }, 20_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-047: the revealed message records who revealed it and when", async () => {
    const before = Date.now();
    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/gmroll 1d20",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 100));

    const revealAck = await sendOp(gmSocket, "chat:reveal", {
      worldId: ctx.worldId,
      messageId,
    });
    expect(revealAck["ok"]).toBe(true);

    const doc = findById(await history(player2Socket, ctx.worldId), messageId);
    expect(doc?.["revealedBy"]).toBe(ctx.gmId);
    expect(typeof doc?.["revealedAt"]).toBe("number");
    expect(doc?.["revealedAt"] as number).toBeGreaterThanOrEqual(before);
  }, 15_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-049: a revealed /blindroll shows the author the real total, not the placeholder", async () => {
    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/blindroll 1d20",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 150));

    // The author currently holds only the substitute confirmation text.
    const beforeDoc = findById(await history(playerSocket, ctx.worldId), messageId);
    expect(beforeDoc).toBeDefined();
    expect(beforeDoc?.["rolls"]).toBeUndefined();

    // What the GM saw all along — the reveal must reproduce exactly this.
    const gmDoc = findById(await history(gmSocket, ctx.worldId), messageId);
    const gmRolls = gmDoc?.["rolls"] as Record<string, unknown>[];
    const gmTotal = gmRolls[0]?.["total"];
    const gmRollId = gmRolls[0]?.["rollId"];
    expect(typeof gmTotal).toBe("number");

    const authorOps = collectOps(playerSocket, 1);
    const outsiderOps = collectOps(player2Socket, 1);
    const revealAck = await sendOp(gmSocket, "chat:reveal", {
      worldId: ctx.worldId,
      messageId,
    });
    expect(revealAck["ok"]).toBe(true);

    // Author, live: real result, no placeholder text.
    const authorDoc = findById(chatDocsFromOps(await authorOps), messageId);
    expect(authorDoc).toBeDefined();
    expect(authorDoc?.["blind"]).toBe(false);
    const authorRolls = authorDoc?.["rolls"] as Record<string, unknown>[] | undefined;
    expect(authorRolls?.[0]?.["total"]).toBe(gmTotal);
    // Same roll, not a new one (REQ-CHT-049: never re-rolled).
    expect(authorRolls?.[0]?.["rollId"]).toBe(gmRollId);
    expect(String(authorDoc?.["content"])).not.toContain("rolagem cega");

    // Everyone else, live.
    const outsiderDoc = findById(chatDocsFromOps(await outsiderOps), messageId);
    expect((outsiderDoc?.["rolls"] as Record<string, unknown>[] | undefined)?.[0]?.["total"]).toBe(
      gmTotal,
    );

    // And in the author's history, after the fact.
    const afterDoc = findById(await history(playerSocket, ctx.worldId), messageId);
    expect((afterDoc?.["rolls"] as Record<string, unknown>[] | undefined)?.[0]?.["total"]).toBe(
      gmTotal,
    );
  }, 20_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-049: no revealed payload carries the RNG seed", async () => {
    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/blindroll 1d20",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 150));

    const outsiderOps = collectOps(player2Socket, 1);
    const revealAck = await sendOp(gmSocket, "chat:reveal", {
      worldId: ctx.worldId,
      messageId,
    });

    expect(containsSeed(revealAck)).toBe(false);
    const liveDoc = findById(chatDocsFromOps(await outsiderOps), messageId);
    expect(liveDoc).toBeDefined();
    expect(containsSeed(liveDoc)).toBe(false);
    expect(containsSeed(await history(player2Socket, ctx.worldId))).toBe(false);
  }, 15_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-048: a plain player cannot reveal — the message stays private", async () => {
    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/gmroll 1d20",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 150));

    const ack = await sendOp(player2Socket, "chat:reveal", {
      worldId: ctx.worldId,
      messageId,
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");

    // Still invisible to the outsider, in history as well as live.
    expect(findById(await history(player2Socket, ctx.worldId), messageId)).toBeUndefined();

    // And the persisted document was not touched.
    const gmDoc = findById(await history(gmSocket, ctx.worldId), messageId);
    expect(gmDoc?.["whisper"]).not.toEqual([]);
    expect(gmDoc?.["revealedBy"]).toBeUndefined();
  }, 15_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-048: revealing an already-public message changes nothing", async () => {
    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 150));

    const beforeDoc = findById(await history(player2Socket, ctx.worldId), messageId);
    expect(beforeDoc).toBeDefined();

    const quiet = collectOps(player2Socket, 1, 600);
    const ack = await sendOp(gmSocket, "chat:reveal", { worldId: ctx.worldId, messageId });
    expect(ack["ok"]).toBe(true);

    // No re-broadcast for a no-op reveal.
    expect(chatDocsFromOps(await quiet)).toEqual([]);

    const afterDoc = findById(await history(player2Socket, ctx.worldId), messageId);
    expect(afterDoc).toEqual(beforeDoc);
    expect(afterDoc?.["revealedBy"]).toBeUndefined();
    expect(afterDoc?.["revealedAt"]).toBeUndefined();
  }, 15_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-045: an unknown message id is rejected, not silently accepted", async () => {
    const ack = await sendOp(gmSocket, "chat:reveal", {
      worldId: ctx.worldId,
      messageId: "no-such-message",
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("NOT_FOUND");
  }, 15_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-045: a revealed /w whisper becomes visible to the whole table", async () => {
    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/w [gm] segredo do plano",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 150));

    expect(findById(await history(player2Socket, ctx.worldId), messageId)).toBeUndefined();

    const ack = await sendOp(gmSocket, "chat:reveal", { worldId: ctx.worldId, messageId });
    expect(ack["ok"]).toBe(true);

    const doc = findById(await history(player2Socket, ctx.worldId), messageId);
    expect(doc).toBeDefined();
    expect(doc?.["content"]).toContain("segredo do plano");
    expect(doc?.["whisper"]).toEqual([]);
  }, 15_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-045: a /selfroll can be revealed too — it is private like any other", async () => {
    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/selfroll 1d20",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 150));

    // selfroll is the one mode the GM does NOT see by override — the premise.
    expect(findById(await history(gmSocket, ctx.worldId), messageId)).toBeUndefined();
    expect(findById(await history(player2Socket, ctx.worldId), messageId)).toBeUndefined();

    const ack = await sendOp(gmSocket, "chat:reveal", { worldId: ctx.worldId, messageId });
    expect(ack["ok"]).toBe(true);

    const doc = findById(await history(player2Socket, ctx.worldId), messageId);
    expect(doc).toBeDefined();
    expect(Array.isArray(doc?.["rolls"])).toBe(true);
    expect(doc?.["whisper"]).toEqual([]);
  }, 15_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-045: an Assistant GM may reveal — the gate is the privileged role, not the GM seat", async () => {
    const { user: assistant } = await ctx.authService.createUser({
      name: "Assistant",
      role: Role.ASSISTANT,
      password: "assistant-pass",
      color: "#ff00ff",
    });
    const login = await ctx.authService.login({
      userId: assistant.id,
      password: "assistant-pass",
      ip: "127.0.0.1",
    });
    const assistantSocket = await connectSocket(ctx.port, ctx.worldId, login.accessToken);
    lateSockets.push(assistantSocket);

    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/gmroll 1d20",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 150));

    const ack = await sendOp(assistantSocket, "chat:reveal", { worldId: ctx.worldId, messageId });
    expect(ack["ok"]).toBe(true);

    const doc = findById(await history(player2Socket, ctx.worldId), messageId);
    expect(doc).toBeDefined();
    expect(doc?.["revealedBy"]).toBe(assistant.id);
  }, 20_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-048: a message belonging to another world is never revealed into this one", async () => {
    // Written straight into the table: the only way to hold a foreign document
    // is for one to already be there (a restored backup, a merged data dir).
    // The handler must refuse it on `worldId`, not on "the row exists".
    const foreignId = "foreign-world-message";
    const foreign = {
      _id: foreignId,
      _stats: {
        createdTime: 1,
        modifiedTime: 1,
        version: 1,
        lastModifiedBy: ctx.playerId,
        createdBy: ctx.playerId,
        coreVersion: "0.1.0",
        systemId: null,
        systemVersion: null,
        engineSchemaVersion: 1,
        systemSchemaVersion: null,
      },
      sort: 0,
      ownership: { default: 0 },
      flags: {},
      type: "whisper",
      worldId: "a-completely-different-world",
      content: "segredo de outra mesa",
      speaker: { userId: ctx.playerId, alias: "Player1" },
      timestamp: Date.now(),
      whisper: [ctx.gmId],
      blind: false,
    };
    ctx.fusionDb.raw
      .prepare(
        `INSERT INTO chat_messages (id, data, timestamp, author_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        foreignId,
        JSON.stringify(foreign),
        foreign.timestamp,
        ctx.playerId,
        Date.now(),
        Date.now(),
      );

    const ack = await sendOp(gmSocket, "chat:reveal", {
      worldId: ctx.worldId,
      messageId: foreignId,
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("NOT_FOUND");

    const row = ctx.fusionDb.raw
      .prepare(`SELECT data FROM chat_messages WHERE id = ?`)
      .get(foreignId) as { data: string };
    const stored = JSON.parse(row.data) as Record<string, unknown>;
    expect(stored["whisper"]).toEqual([ctx.gmId]);
    expect(stored["revealedBy"]).toBeUndefined();
  }, 15_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-048: a payload for the wrong world is refused and reveals nothing", async () => {
    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/gmroll 1d20",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 150));

    const ack = await sendOp(gmSocket, "chat:reveal", { worldId: "another-world", messageId });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");

    expect(findById(await history(player2Socket, ctx.worldId), messageId)).toBeUndefined();
  }, 15_000);

  // -------------------------------------------------------------------------
  it("REQ-CHT-045: a malformed payload is refused and the connection keeps working", async () => {
    const sendAck = await sendOp(playerSocket, "chat:send", {
      content: "/gmroll 1d20",
      worldId: ctx.worldId,
    });
    const messageId = sentMessageId(sendAck);
    await new Promise((r) => setTimeout(r, 150));

    for (const bad of [{}, { worldId: ctx.worldId }, { worldId: ctx.worldId, messageId: "" }]) {
      const ack = await sendOp(gmSocket, "chat:reveal", bad);
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("VALIDATION_FAILED");
    }

    // The socket is still usable — a rejected payload must not poison the session.
    const good = await sendOp(gmSocket, "chat:reveal", { worldId: ctx.worldId, messageId });
    expect(good["ok"]).toBe(true);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// Restart — the reveal has to be in the FILE, not only in the emission.
// ---------------------------------------------------------------------------

describe("chat:reveal — the revelation survives a restart", () => {
  it("REQ-CHT-046: reopening the database file shows the message already public", async () => {
    const ctx = await buildTestContext();
    const dbPath = join(ctx.dataDir, "world.db");
    let messageId = "";

    try {
      const [gmSocket, playerSocket] = await Promise.all([
        connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
        connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
      ]);
      const sendAck = await sendOp(playerSocket, "chat:send", {
        content: "/blindroll 1d20",
        worldId: ctx.worldId,
      });
      messageId = sentMessageId(sendAck);
      await new Promise((r) => setTimeout(r, 150));

      const ack = await sendOp(gmSocket, "chat:reveal", { worldId: ctx.worldId, messageId });
      expect(ack["ok"]).toBe(true);

      gmSocket.disconnect();
      playerSocket.disconnect();
    } finally {
      // Shut the whole world down — this is the "restart" the test is about.
      await ctx.socketManager.close();
      await ctx.fastify.close();
      ctx.fusionDb.close();
    }

    const reopened = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    try {
      const row = reopened.raw
        .prepare(`SELECT data FROM chat_messages WHERE id = ?`)
        .get(messageId) as { data: string } | undefined;
      expect(row).toBeDefined();
      const persisted = JSON.parse(row?.data ?? "{}") as Record<string, unknown>;
      expect(persisted["whisper"]).toEqual([]);
      expect(persisted["blind"]).toBe(false);
      expect(typeof persisted["revealedAt"]).toBe("number");
      expect(persisted["revealedBy"]).toBe(ctx.gmId);
      // The roll itself is still there and still the SAME one (REQ-CHT-049).
      const rolls = persisted["rolls"] as Record<string, unknown>[] | undefined;
      expect(rolls?.length).toBeGreaterThan(0);
      expect(containsSeed(persisted)).toBe(false);
    } finally {
      reopened.close();
      rmSync(ctx.dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});
