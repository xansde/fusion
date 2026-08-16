/**
 * Integration tests for the chat context query (G031).
 *
 * Requirements under test:
 *   - REQ-CHT-051 — given the `_id` of a message VISIBLE to the requester and a
 *     limit N, the server returns the N VISIBLE messages immediately before and
 *     the N immediately after. The count considers visible messages only: an
 *     invisible message takes no slot and is never signalled in any way.
 *   - REQ-ACH-013 — the window the client opens carries the target plus the 5
 *     visible messages on each side, with a "more 5" control per side (served by
 *     re-asking with a bigger limit).
 *
 * Everything is asserted on the ack PAYLOAD the socket receives, never on a
 * rendered screen. The seeding sends REAL messages through `chat:send`, so the
 * visibility of each line is the one the production path produced.
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
// Test harness (same shape as chat-search.test.ts; data dir lives in the OS temp)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-chat-context-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "test-chat-context-world";

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
    role: Role.PLAYER,
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
    worldInfo: { id: worldId, title: "Test Chat Context World", systemId: "stub" },
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

/** chat:context is a read — it travels on the `query` channel. */
const sendQuery = (socket: ClientSocket, type: string, payload: unknown) =>
  emitEnvelope(socket, "query", type, payload);

interface ContextResult {
  target: Record<string, unknown>;
  before: Record<string, unknown>[];
  after: Record<string, unknown>[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

function contextResult(ack: Record<string, unknown>): ContextResult {
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  return ack["result"] as ContextResult;
}

const contents = (messages: Record<string, unknown>[]): string[] =>
  messages.map((m) => String(m["content"]));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Per-user pacing between seeded messages. `chat:send` rate-limits at 5 msg/s
 * per user (REQ-CHT-NF-004), so the seed has to stay under that ceiling; the
 * gap also keeps every line on its own millisecond, which matters because the
 * log is ordered by `(timestamp, id)` and ids are random — two lines sharing a
 * millisecond would order arbitrarily.
 */
const SEED_GAP_MS = 230;

/** Sends one line and returns the `_id` the server assigned to it. */
async function sendLine(socket: ClientSocket, content: string, worldId: string): Promise<string> {
  const ack = await sendOp(socket, "chat:send", { content, worldId });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  const result = ack["result"] as { message: Record<string, unknown> };
  await sleep(2);
  return String(result.message["_id"]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chat:context — ±N VISÍVEIS ao redor de uma mensagem", () => {
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

  /** Highest index of the seeded public lines ("publica 0".."publica 16"). */
  const LAST_PUBLIC = 16;

  /**
   * Seeds a log of 17 public lines from Player1, with a GM→Player2 whisper
   * interleaved after every one of them. Player1 sees only the public lines;
   * the GM sees everything.
   *
   * Returns the ids of the public lines, indexed by their number.
   */
  async function seedInterleavedLog(): Promise<string[]> {
    const publicIds: string[] = [];
    for (let i = 0; i <= LAST_PUBLIC; i++) {
      publicIds.push(await sendLine(playerSocket, `publica ${String(i)}`, ctx.worldId));
      await sendLine(gmSocket, `/w [Player2] segredo ${String(i)}`, ctx.worldId);
      await sleep(SEED_GAP_MS);
    }
    return publicIds;
  }

  it("REQ-CHT-051 / REQ-ACH-013: com sussurros intercalados, o jogador recebe 5 visíveis de cada lado, sem buraco", async () => {
    const publicIds = await seedInterleavedLog();

    const result = contextResult(
      await sendQuery(playerSocket, "chat:context", {
        worldId: ctx.worldId,
        id: publicIds[10],
        limit: 5,
      }),
    );

    expect(String(result.target["content"])).toBe("publica 10");
    // Exactly 5 on each side — the 10 whispers that sit between these lines took
    // no slot at all.
    expect(result.before).toHaveLength(5);
    expect(result.after).toHaveLength(5);
    // And the window is CONTIGUOUS in the visible sequence: no hole where a
    // whisper was skipped.
    expect(contents(result.before)).toEqual([
      "publica 5",
      "publica 6",
      "publica 7",
      "publica 8",
      "publica 9",
    ]);
    expect(contents(result.after)).toEqual([
      "publica 11",
      "publica 12",
      "publica 13",
      "publica 14",
      "publica 15",
    ]);
  }, 40_000);

  it("REQ-CHT-051: nem id, nem contagem, nem placeholder denuncia o sussurro pulado", async () => {
    const publicIds = await seedInterleavedLog();

    const ack = await sendQuery(playerSocket, "chat:context", {
      worldId: ctx.worldId,
      id: publicIds[10],
      limit: 5,
    });
    const result = contextResult(ack);

    // The whole payload, serialized: no secret content, no secret id, and no
    // field whose name suggests a count/marker of skipped messages.
    const serialized = JSON.stringify(ack);
    expect(serialized).not.toContain("segredo");
    expect(serialized).not.toContain(ctx.player2Id);

    const resultKeys = Object.keys(result).sort();
    expect(resultKeys).toEqual(["after", "before", "hasMoreAfter", "hasMoreBefore", "target"]);

    // Every message handed over is a real, visible message — no placeholder
    // entries standing in for what was skipped.
    for (const msg of [result.target, ...result.before, ...result.after]) {
      expect(typeof msg["_id"]).toBe("string");
      expect((msg["whisper"] as string[]).length).toBe(0);
      expect((msg["speaker"] as { userId?: string }).userId).toBe(ctx.playerId);
    }
  }, 40_000);

  it("REQ-CHT-051: a contagem é por espectador — o Mestre vê os sussurros ocupando os lugares", async () => {
    const publicIds = await seedInterleavedLog();

    const asGm = contextResult(
      await sendQuery(gmSocket, "chat:context", {
        worldId: ctx.worldId,
        id: publicIds[10],
        limit: 5,
      }),
    );

    // For the GM the neighbours ARE the whispers, because they are visible to
    // them — the same predicate, applied to a different viewer.
    expect(contents(asGm.before)).toEqual([
      "segredo 7",
      "publica 8",
      "segredo 8",
      "publica 9",
      "segredo 9",
    ]);
    expect(contents(asGm.after)).toEqual([
      "segredo 10",
      "publica 11",
      "segredo 11",
      "publica 12",
      "segredo 12",
    ]);
  }, 40_000);

  it("REQ-ACH-013: o controle “mais 5” é servido reperguntando com limite maior", async () => {
    const publicIds = await seedInterleavedLog();

    const wider = contextResult(
      await sendQuery(playerSocket, "chat:context", {
        worldId: ctx.worldId,
        id: publicIds[10],
        limit: 10,
      }),
    );
    expect(contents(wider.before)).toEqual([
      "publica 0",
      "publica 1",
      "publica 2",
      "publica 3",
      "publica 4",
      "publica 5",
      "publica 6",
      "publica 7",
      "publica 8",
      "publica 9",
    ]);
    // Only six visible lines exist after the target, so the window is honest
    // about being short instead of padding it.
    expect(contents(wider.after)).toEqual([
      "publica 11",
      "publica 12",
      "publica 13",
      "publica 14",
      "publica 15",
      "publica 16",
    ]);
    expect(wider.hasMoreBefore).toBe(false);
    expect(wider.hasMoreAfter).toBe(false);
  }, 40_000);

  it("REQ-CHT-051: o limite padrão é 5 e sinaliza que há mais visíveis dos dois lados", async () => {
    const publicIds = await seedInterleavedLog();

    const result = contextResult(
      await sendQuery(playerSocket, "chat:context", {
        worldId: ctx.worldId,
        id: publicIds[10],
      }),
    );
    expect(result.before).toHaveLength(5);
    expect(result.after).toHaveLength(5);
    expect(result.hasMoreBefore).toBe(true);
    expect(result.hasMoreAfter).toBe(true);
  }, 40_000);

  it("REQ-CHT-051: pedir contexto de mensagem invisível é recusado igual a id inexistente", async () => {
    await sendLine(playerSocket, "linha publica", ctx.worldId);
    const secretId = await sendLine(gmSocket, "/w [Player2] plano secreto", ctx.worldId);
    await new Promise((r) => setTimeout(r, 120));

    const invisible = await sendQuery(playerSocket, "chat:context", {
      worldId: ctx.worldId,
      id: secretId,
    });
    const nonexistent = await sendQuery(playerSocket, "chat:context", {
      worldId: ctx.worldId,
      id: "nao-existe-de-jeito-nenhum",
    });

    expect(invisible["ok"]).toBe(false);
    expect(nonexistent["ok"]).toBe(false);
    // Byte-identical refusals: the answer cannot be used to tell "there is a
    // message here you may not read" from "there is no such message".
    expect(invisible["code"]).toBe(nonexistent["code"]);
    expect(invisible["message"]).toBe(nonexistent["message"]);
    expect(invisible["code"]).toBe("NOT_FOUND");

    // The recipient of the whisper does get the context for the same id.
    const asRecipient = contextResult(
      await sendQuery(player2Socket, "chat:context", { worldId: ctx.worldId, id: secretId }),
    );
    expect(String(asRecipient.target["content"])).toBe("plano secreto");
  }, 40_000);

  it("REQ-CHT-051: mundo errado e limite fora da faixa são recusados sem tocar o log", async () => {
    const id = await sendLine(playerSocket, "linha unica", ctx.worldId);
    await new Promise((r) => setTimeout(r, 120));

    const otherWorld = await sendQuery(playerSocket, "chat:context", {
      worldId: "another-world",
      id,
    });
    expect(otherWorld["ok"]).toBe(false);
    expect(otherWorld["code"]).toBe("VALIDATION_FAILED");

    const badLimit = await sendQuery(playerSocket, "chat:context", {
      worldId: ctx.worldId,
      id,
      limit: 5000,
    });
    expect(badLimit["ok"]).toBe(false);
    expect(badLimit["code"]).toBe("VALIDATION_FAILED");

    // A message alone in the log yields an empty, honest window.
    const alone = contextResult(
      await sendQuery(playerSocket, "chat:context", { worldId: ctx.worldId, id }),
    );
    expect(alone.before).toEqual([]);
    expect(alone.after).toEqual([]);
    expect(alone.hasMoreBefore).toBe(false);
    expect(alone.hasMoreAfter).toBe(false);
  }, 40_000);
});
