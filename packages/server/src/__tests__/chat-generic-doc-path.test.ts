/**
 * The generic doc:* path does not moderate chat — regression tests for the
 * hole the Fase 3 review found: `chat:invalidate` was written, but
 * `doc:delete {documentType: "ChatMessage"}` still worked, so the rule that a
 * message is never removed from the log lived only in the handler that obeyed
 * it.
 *
 * Requirements under test:
 *   - REQ-CHT-005 — a message is NOT deleted from the log; it is invalidated,
 *     kept in place. No wire operation deletes one.
 *   - REQ-ACH-080 — moderation of a single message is invalidation; there is no
 *     deletion path at all, not even a generic one.
 *   - REQ-ACH-082 / REQ-ACH-083 — who may invalidate/revalidate is decided by
 *     `chat:invalidate`; a generic write must not be a second way to set
 *     `invalid` without passing that gate.
 *   - REQ-ACH-090 — hiding the control in the client is NOT protection: the
 *     refusal has to come from the server, which is what every assertion here
 *     reads (ack payload + the stored row), never a screen.
 *
 * Everything is emitted straight at the socket, bypassing any client button,
 * and the GM is the one attacking in the delete case: the point is that not
 * even the Master can delete a line through this door.
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
// Test harness (same shape as chat-invalidate.test.ts; data dir in OS temp)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-chat-generic-doc-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  player2Id: string;
  gmToken: string;
  playerToken: string;
  player2Token: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-chat-generic-doc-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
  });
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.TRUSTED,
    password: "player2-pass",
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
    worldInfo: { id: worldId, title: "Test Chat Generic Doc World", systemId: "stub" },
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Sends one line and returns the `_id` the server assigned to it. */
async function sendLine(socket: ClientSocket, content: string, worldId: string): Promise<string> {
  const ack = await sendOp(socket, "chat:send", { content, worldId });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  const result = ack["result"] as { message: Record<string, unknown> };
  await sleep(2);
  return String(result.message["_id"]);
}

/** Reads the message straight out of storage — the wire cannot lie about this. */
function storedMessage(ctx: TestContext, id: string): Record<string, unknown> | null {
  const row = ctx.fusionDb.raw.prepare(`SELECT data FROM chat_messages WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
}

/** The ids `chat:history` hands back to this socket, newest-first. */
async function historyIds(socket: ClientSocket, worldId: string): Promise<string[]> {
  const ack = await emitEnvelope(socket, "query", "chat:history", { worldId, limit: 50 });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  const messages = (ack["result"] as { messages: Record<string, unknown>[] }).messages;
  return messages.map((m) => String(m["_id"]));
}

/** How many rows `chat_messages` holds right now. */
function chatRowCount(ctx: TestContext): number {
  const row = ctx.fusionDb.raw.prepare(`SELECT COUNT(*) AS n FROM chat_messages`).get() as {
    n: number;
  };
  return row.n;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("doc:* genérico não modera chat", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let player2Socket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    [gmSocket, playerSocket, player2Socket] = await Promise.all([
      connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
      connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
      connectSocket(ctx.port, ctx.worldId, ctx.player2Token),
    ]);
  }, 15_000);

  afterEach(async () => {
    gmSocket?.disconnect();
    playerSocket?.disconnect();
    player2Socket?.disconnect();
    await teardown(ctx);
  });

  it("REQ-CHT-005 / REQ-ACH-080 / REQ-ACH-090: nem o Mestre apaga uma ChatMessage por doc:delete", async () => {
    const id = await sendLine(playerSocket, "rolagem que o mestre nao gostou", ctx.worldId);
    await sleep(120);

    const before = chatRowCount(ctx);

    const ack = await sendOp(gmSocket, "doc:delete", {
      documentType: "ChatMessage",
      ids: [id],
    });

    expect(ack["ok"], JSON.stringify(ack)).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    // The refusal names the door that IS open (REQ-ACH-080).
    expect(String(ack["message"])).toContain("chat:invalidate");

    // The line is still in the log — in storage and in what the wire serves.
    expect(chatRowCount(ctx)).toBe(before);
    const stored = storedMessage(ctx, id);
    expect(stored).not.toBeNull();
    expect(stored?.["content"]).toBe("rolagem que o mestre nao gostou");
    expect(await historyIds(playerSocket, ctx.worldId)).toContain(id);
    expect(await historyIds(gmSocket, ctx.worldId)).toContain(id);
  }, 40_000);

  it("REQ-ACH-082 / REQ-ACH-083 / REQ-ACH-090: doc:update não é uma segunda porta para invalidar", async () => {
    // player2 is not the author and is not the Master, so chat:invalidate
    // refuses him (REQ-ACH-082). The generic path must refuse him too, or the
    // gate is decorative.
    const id = await sendLine(playerSocket, "mensagem alheia", ctx.worldId);
    await sleep(120);

    const viaInvalidate = await sendOp(player2Socket, "chat:invalidate", {
      worldId: ctx.worldId,
      _id: id,
      invalid: true,
    });
    expect(viaInvalidate["ok"]).toBe(false);

    const viaDocUpdate = await sendOp(player2Socket, "doc:update", {
      documentType: "ChatMessage",
      updates: [{ _id: id, diff: { invalid: true, invalidatedBy: ctx.player2Id } }],
    });
    expect(viaDocUpdate["ok"], JSON.stringify(viaDocUpdate)).toBe(false);
    expect(viaDocUpdate["code"]).toBe("PERMISSION_DENIED");

    const stored = storedMessage(ctx, id);
    expect(stored?.["invalid"]).not.toBe(true);
    expect(stored?.["invalidatedBy"]).toBeUndefined();
  }, 40_000);

  it("REQ-CHT-005 / REQ-ACH-090: doc:update do Mestre não reescreve o conteúdo de uma mensagem", async () => {
    const id = await sendLine(playerSocket, "o que foi dito na mesa", ctx.worldId);
    await sleep(120);

    const ack = await sendOp(gmSocket, "doc:update", {
      documentType: "ChatMessage",
      updates: [{ _id: id, diff: { content: "o que o mestre preferia que tivesse sido dito" } }],
    });

    expect(ack["ok"], JSON.stringify(ack)).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    expect(storedMessage(ctx, id)?.["content"]).toBe("o que foi dito na mesa");
  }, 40_000);

  it("REQ-CHT-005 / REQ-ACH-090: doc:create não forja mensagem no log", async () => {
    const before = chatRowCount(ctx);

    // A TRUSTED player would otherwise clear the role floor of the generic
    // create path — chat_messages is not in GM_ONLY_CREATE_DELETE.
    const ack = await sendOp(player2Socket, "doc:create", {
      documentType: "ChatMessage",
      data: [
        {
          content: "o mestre nunca disse isso",
          author: ctx.gmId,
          speaker: { userId: ctx.gmId, alias: "Mestre" },
        },
      ],
    });

    expect(ack["ok"], JSON.stringify(ack)).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    expect(chatRowCount(ctx)).toBe(before);
  }, 40_000);
});
