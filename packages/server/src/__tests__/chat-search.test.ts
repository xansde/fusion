/**
 * Integration tests for the chat log search (G030).
 *
 * Requirements under test:
 *   - REQ-CHT-050 — search is available to ANY role and the server applies the
 *     same visibility predicate the history/broadcast use; nobody finds someone
 *     else's whisper or a third party's blind roll. No second predicate.
 *   - REQ-ACH-011 — typing in the search box queries the SERVER and gets back
 *     results carrying author, time and the matched text.
 *   - REQ-ACH-012 — the search is available to every role.
 *
 * Everything is asserted on the ack PAYLOAD the socket receives, never on a
 * rendered screen.
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
// Test harness (same shape as chat-roll.test.ts; data dir lives in the OS temp)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-chat-search-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "test-chat-search-world";

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
    worldInfo: { id: worldId, title: "Test Chat Search World", systemId: "stub" },
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

/** chat:search is a read — it travels on the `query` channel. */
const sendQuery = (socket: ClientSocket, type: string, payload: unknown) =>
  emitEnvelope(socket, "query", type, payload);

interface SearchResult {
  messages: Record<string, unknown>[];
  page: number;
  hasMore: boolean;
}

function searchResult(ack: Record<string, unknown>): SearchResult {
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  return ack["result"] as SearchResult;
}

function contents(result: SearchResult): string[] {
  return result.messages.map((m) => String(m["content"]));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chat:search — busca do log com o predicado do histórico", () => {
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

  /**
   * Seeds three messages that all contain the word "cofre":
   *   1. a public line from Player1        — visible to everyone
   *   2. a GM whisper aimed at Player2     — GM + Player2 only
   *   3. a selfroll from Player1           — the author only (not even the GM)
   */
  async function seedCofreLog(): Promise<void> {
    await sendOp(playerSocket, "chat:send", {
      content: "o cofre esta trancado",
      worldId: ctx.worldId,
    });
    await sendOp(gmSocket, "chat:send", {
      content: "/w [Player2] o cofre guarda a chave",
      worldId: ctx.worldId,
    });
    await sendOp(playerSocket, "chat:send", {
      content: "/selfroll 1d20 # cofre",
      worldId: ctx.worldId,
    });
    await new Promise((r) => setTimeout(r, 120));
  }

  it("REQ-CHT-050 / REQ-ACH-012: o jogador não acha o sussurro do Mestre para outro jogador, e o Mestre acha os dois", async () => {
    await seedCofreLog();

    // Player1 is neither the recipient nor the author of the whisper.
    const asPlayer1 = searchResult(
      await sendQuery(playerSocket, "chat:search", { worldId: ctx.worldId, q: "cofre" }),
    );
    const player1Contents = contents(asPlayer1);
    expect(player1Contents).toContain("o cofre esta trancado");
    expect(player1Contents).not.toContain("o cofre guarda a chave");
    // No result carries a whisper list that excludes Player1 (payload check).
    for (const msg of asPlayer1.messages) {
      const whisper = (msg["whisper"] as string[] | undefined) ?? [];
      if (whisper.length > 0) {
        expect(whisper).toContain(ctx.playerId);
      }
    }

    // The GM finds BOTH the public line and the whisper.
    const asGm = searchResult(
      await sendQuery(gmSocket, "chat:search", { worldId: ctx.worldId, q: "cofre" }),
    );
    const gmContents = contents(asGm);
    expect(gmContents).toContain("o cofre esta trancado");
    expect(gmContents).toContain("o cofre guarda a chave");

    // The whisper recipient finds it too.
    const asPlayer2 = searchResult(
      await sendQuery(player2Socket, "chat:search", { worldId: ctx.worldId, q: "cofre" }),
    );
    expect(contents(asPlayer2)).toContain("o cofre guarda a chave");
  }, 20_000);

  it("REQ-CHT-050: nem o Mestre acha a rolagem privada (selfroll) do jogador — é o mesmo predicado, não uma segunda regra", async () => {
    await seedCofreLog();

    const asGm = searchResult(
      await sendQuery(gmSocket, "chat:search", { worldId: ctx.worldId, q: "cofre" }),
    );
    const gmSelfrolls = asGm.messages.filter(
      (m) =>
        m["type"] === "roll" &&
        Array.isArray(m["rolls"]) &&
        (m["rolls"] as { rollMode?: string }[])[0]?.rollMode === "selfroll",
    );
    expect(gmSelfrolls).toHaveLength(0);

    // The author of the selfroll does find it.
    const asAuthor = searchResult(
      await sendQuery(playerSocket, "chat:search", { worldId: ctx.worldId, q: "cofre" }),
    );
    const authorSelfrolls = asAuthor.messages.filter(
      (m) =>
        m["type"] === "roll" &&
        Array.isArray(m["rolls"]) &&
        (m["rolls"] as { rollMode?: string }[])[0]?.rollMode === "selfroll",
    );
    expect(authorSelfrolls).toHaveLength(1);
  }, 20_000);

  it("REQ-CHT-050: a rolagem cega de terceiro chega ao jogador sem os dados, como no histórico", async () => {
    // GM rolls blind. blindroll → whisper = [gm ids], blind = true.
    await sendOp(gmSocket, "chat:send", {
      content: "/blindroll 1d20 # emboscada",
      worldId: ctx.worldId,
    });
    await new Promise((r) => setTimeout(r, 120));

    const asPlayer = searchResult(
      await sendQuery(playerSocket, "chat:search", { worldId: ctx.worldId, q: "emboscada" }),
    );
    // Not a recipient of the GM whisper list → the message is not found at all.
    expect(asPlayer.messages).toHaveLength(0);

    const asGm = searchResult(
      await sendQuery(gmSocket, "chat:search", { worldId: ctx.worldId, q: "emboscada" }),
    );
    expect(asGm.messages).toHaveLength(1);
    expect(Array.isArray(asGm.messages[0]?.["rolls"])).toBe(true);
  }, 20_000);

  it("REQ-ACH-011: cada resultado vem do servidor com autor, hora e o trecho que casou", async () => {
    await sendOp(playerSocket, "chat:send", {
      content: "a estatua de bronze range",
      worldId: ctx.worldId,
    });
    await new Promise((r) => setTimeout(r, 120));

    const result = searchResult(
      await sendQuery(playerSocket, "chat:search", { worldId: ctx.worldId, q: "estatua" }),
    );
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as Record<string, unknown>;
    expect((msg["speaker"] as { userId?: string }).userId).toBe(ctx.playerId);
    expect(typeof msg["timestamp"]).toBe("number");
    expect(String(msg["content"])).toContain("estatua");
    expect(result.page).toBe(0);
    expect(result.hasMore).toBe(false);
  }, 20_000);

  it("REQ-ACH-012: a busca responde para qualquer papel — jogador e Mestre acham a linha pública", async () => {
    await sendOp(playerSocket, "chat:send", {
      content: "a ponte de corda balanca",
      worldId: ctx.worldId,
    });
    await new Promise((r) => setTimeout(r, 120));

    for (const socket of [playerSocket, player2Socket, gmSocket]) {
      const result = searchResult(
        await sendQuery(socket, "chat:search", { worldId: ctx.worldId, q: "ponte" }),
      );
      expect(contents(result)).toContain("a ponte de corda balanca");
    }
  }, 20_000);

  it("REQ-CHT-050: a busca ignora maiúsculas e não interpreta curingas do usuário como padrão", async () => {
    await sendOp(playerSocket, "chat:send", {
      content: "o portao range 100% do tempo",
      worldId: ctx.worldId,
    });
    await new Promise((r) => setTimeout(r, 120));

    const upper = searchResult(
      await sendQuery(player2Socket, "chat:search", { worldId: ctx.worldId, q: "PORTAO" }),
    );
    expect(contents(upper)).toContain("o portao range 100% do tempo");

    // "%" is a LIKE wildcard: escaped, it must match literally...
    const literal = searchResult(
      await sendQuery(player2Socket, "chat:search", { worldId: ctx.worldId, q: "100%" }),
    );
    expect(contents(literal)).toContain("o portao range 100% do tempo");

    // ...and must NOT behave as "match anything".
    const wildcard = searchResult(
      await sendQuery(player2Socket, "chat:search", { worldId: ctx.worldId, q: "portao%range" }),
    );
    expect(wildcard.messages).toHaveLength(0);
  }, 20_000);

  it("REQ-CHT-050: a paginação conta apenas resultados visíveis ao solicitante", async () => {
    // Two public lines from Player1, one whisper between GM and Player2 in the
    // middle — the whisper must not consume a slot of Player1's page.
    await sendOp(playerSocket, "chat:send", { content: "tocha um", worldId: ctx.worldId });
    await sendOp(gmSocket, "chat:send", {
      content: "/w [Player2] tocha secreta",
      worldId: ctx.worldId,
    });
    await sendOp(playerSocket, "chat:send", { content: "tocha dois", worldId: ctx.worldId });
    await new Promise((r) => setTimeout(r, 120));

    const page0 = searchResult(
      await sendQuery(playerSocket, "chat:search", {
        worldId: ctx.worldId,
        q: "tocha",
        limit: 1,
        page: 0,
      }),
    );
    expect(page0.messages).toHaveLength(1);
    expect(page0.hasMore).toBe(true);

    const page1 = searchResult(
      await sendQuery(playerSocket, "chat:search", {
        worldId: ctx.worldId,
        q: "tocha",
        limit: 1,
        page: 1,
      }),
    );
    expect(page1.messages).toHaveLength(1);
    expect(page1.hasMore).toBe(false);

    // Both visible lines came back across the two pages, and the whisper is in
    // neither of them — it never took a slot.
    const seen = [...contents(page0), ...contents(page1)].sort();
    expect(seen).toEqual(["tocha dois", "tocha um"]);
  }, 20_000);

  it("REQ-ACH-011: termo vazio ou mundo errado é recusado sem tocar o log", async () => {
    const empty = await sendQuery(playerSocket, "chat:search", { worldId: ctx.worldId, q: "" });
    expect(empty["ok"]).toBe(false);
    expect(empty["code"]).toBe("VALIDATION_FAILED");

    const otherWorld = await sendQuery(playerSocket, "chat:search", {
      worldId: "another-world",
      q: "cofre",
    });
    expect(otherWorld["ok"]).toBe(false);
    expect(otherWorld["code"]).toBe("VALIDATION_FAILED");
  }, 20_000);
});
