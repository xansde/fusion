/**
 * G054 — "O jogador encerra o próprio turno, e nada além disso" (spec 40 §5.8/§5.9).
 *
 * Server-side integration tests over real sockets: a non-privileged user ends
 * their OWN turn through the very operation that advances the turn
 * (combat:nextTurn), and gets nothing else.
 *
 * Coverage:
 *  - REQ-CBA-071: only a privileged role advances/rewinds the turn and ends the
 *    encounter — the owner exception below never extends to rewind/end.
 *  - REQ-CBA-072: when the combatant of the current turn belongs to the
 *    non-privileged user, ending the own turn goes through the same server
 *    operation that advances (REQ-CBT-021).
 *  - REQ-CBA-073: no advance/rewind/end control for a non-privileged user when
 *    the current turn is not theirs.
 *  - REQ-CBA-074: the payload the player receives names the combatant of the
 *    turn, which is what lets the panel say "é a sua vez" / how many turns are
 *    left — the client cannot infer it from a redacted list by position.
 *  - REQ-CBA-080: hiding a control on the client is NOT the protection — a
 *    forged op from a player is refused by the server itself.
 *  - REQ-CBA-081: accepted only when the requester owns the combatant of the
 *    current turn; every other case is refused.
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
// Test setup helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-own-turn-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerToken: string;
  playerUserId: string;
  player2Token: string;
  player2UserId: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "own-turn-test-world";

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
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });
  const player2Login = await authService.login({
    userId: player2.id,
    password: "player2-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Own Turn Test World", systemId: "stub" },
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
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
    player2Token: player2Login.accessToken,
    player2UserId: player2.id,
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
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 8000);
  });
}

function waitForOp(
  socket: ClientSocket,
  predicate: (env: Record<string, unknown>) => boolean,
  timeoutMs = 4000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for op event")), timeoutMs);
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

function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

function resultOf(ack: Record<string, unknown>): Record<string, unknown> {
  return ack["result"] as Record<string, unknown>;
}

function combatOf(ack: Record<string, unknown>): Record<string, unknown> {
  return resultOf(ack)["combat"] as Record<string, unknown>;
}

function firstDocId(ack: Record<string, unknown>): string {
  return (resultOf(ack)["documents"] as Record<string, unknown>[])[0]!["_id"] as string;
}

// ---------------------------------------------------------------------------
// Fixture: an encounter already running, turn 0 = a combatant owned by player1
// ---------------------------------------------------------------------------

interface RunningEncounter {
  combatId: string;
  /** Combatant of turn 0 — the Actor is owned by player1. */
  player1CombatantId: string;
  /** Combatant of turn 1 — the Actor is owned by player2. */
  player2CombatantId: string;
}

async function buildRunningEncounter(
  gmSocket: ClientSocket,
  playerUserId: string,
  player2UserId: string,
  options: { begin?: boolean } = {},
): Promise<RunningEncounter> {
  const sceneAck = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [{ name: "Own Turn Scene", width: 1000, height: 1000 }],
  });
  expect(sceneAck["ok"]).toBe(true);
  const sceneId = firstDocId(sceneAck);

  const pc1Ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [
      { name: "PC1 Fighter", type: "character", ownership: { default: 0, [playerUserId]: 3 } },
    ],
  });
  expect(pc1Ack["ok"]).toBe(true);
  const pc1ActorId = firstDocId(pc1Ack);

  const pc2Ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [
      { name: "PC2 Wizard", type: "character", ownership: { default: 0, [player2UserId]: 3 } },
    ],
  });
  expect(pc2Ack["ok"]).toBe(true);
  const pc2ActorId = firstDocId(pc2Ack);

  const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
  expect(createAck["ok"]).toBe(true);
  const combatId = combatOf(createAck)["_id"] as string;

  // Higher initiative first: turn 0 is player1's combatant.
  await sendOp(gmSocket, "combat:addCombatant", {
    combatId,
    tokenId: "t1",
    actorId: pc1ActorId,
    initiative: 20,
  });
  const addAck = await sendOp(gmSocket, "combat:addCombatant", {
    combatId,
    tokenId: "t2",
    actorId: pc2ActorId,
    initiative: 10,
  });
  expect(addAck["ok"]).toBe(true);

  let combat = combatOf(addAck);
  if (options.begin !== false) {
    const beginAck = await sendOp(gmSocket, "combat:beginCombat", { combatId });
    expect(beginAck["ok"]).toBe(true);
    combat = combatOf(beginAck);
    expect(combat["turnIndex"]).toBe(0);
  }

  const combatants = combat["combatants"] as Record<string, unknown>[];
  return {
    combatId,
    player1CombatantId: combatants[0]!["_id"] as string,
    player2CombatantId: combatants[1]!["_id"] as string,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("G054 — o jogador encerra o próprio turno, e nada além disso", { timeout: 30000 }, () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let player2Socket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    const auth = (token: string) => ({ token, protocolVersion: PROTOCOL_VERSION });

    gmSocket = connectClient(ctx.port, ctx.worldId, auth(ctx.gmToken));
    playerSocket = connectClient(ctx.port, ctx.worldId, auth(ctx.playerToken));
    player2Socket = connectClient(ctx.port, ctx.worldId, auth(ctx.player2Token));

    gmSocket.connect();
    playerSocket.connect();
    player2Socket.connect();

    await Promise.all([
      waitForConnect(gmSocket),
      waitForConnect(playerSocket),
      waitForConnect(player2Socket),
    ]);
    await drain();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    player2Socket.disconnect();
    await teardown(ctx);
  });

  it("REQ-CBA-072/REQ-CBA-081: dono do participante da vez encerra o próprio turno pela mesma operação que avança (combat:nextTurn)", async () => {
    const enc = await buildRunningEncounter(gmSocket, ctx.playerUserId, ctx.player2UserId);

    const ack = await sendOp(playerSocket, "combat:nextTurn", { combatId: enc.combatId });

    expect(ack["ok"]).toBe(true);
    const combat = combatOf(ack);
    expect(combat["turnIndex"]).toBe(1);
    expect(combat["round"]).toBe(1);
    expect(combat["activeCombatantId"]).toBe(enc.player2CombatantId);
  });

  it("REQ-CBA-074: o payload que chega ao jogador nomeia o participante da vez depois do avanço", async () => {
    const enc = await buildRunningEncounter(gmSocket, ctx.playerUserId, ctx.player2UserId);

    // Let the encounter's own start broadcast land before listening, so the
    // event asserted below is unambiguously the one this advance produced.
    await drain();

    const turnChange = waitForOp(playerSocket, (env) => env["type"] === "combat:turnChange");
    const ack = await sendOp(playerSocket, "combat:nextTurn", { combatId: enc.combatId });
    expect(ack["ok"]).toBe(true);

    const env = await turnChange;
    const payload = env["payload"] as Record<string, unknown>;
    const current = payload["current"] as Record<string, unknown>;
    const previous = payload["previous"] as Record<string, unknown>;

    expect(payload["combatId"]).toBe(enc.combatId);
    expect(current["combatantId"]).toBe(enc.player2CombatantId);
    expect(previous["combatantId"]).toBe(enc.player1CombatantId);
  });

  it("REQ-CBA-073/REQ-CBA-080/REQ-CBA-081: jogador na vez de outro é recusado PELO SERVIDOR, e o turno não anda", async () => {
    const enc = await buildRunningEncounter(gmSocket, ctx.playerUserId, ctx.player2UserId);

    // Turn 0 belongs to player1; player2 forges the op straight at the socket.
    const ack = await sendOp(player2Socket, "combat:nextTurn", { combatId: enc.combatId });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");

    // The refusal is a refusal of the state transition, not just of the reply:
    // the GM's own advance still lands on turn 1 of round 1.
    const gmAck = await sendOp(gmSocket, "combat:nextTurn", { combatId: enc.combatId });
    expect(gmAck["ok"]).toBe(true);
    const combat = combatOf(gmAck);
    expect(combat["turnIndex"]).toBe(1);
    expect(combat["round"]).toBe(1);
  });

  it("REQ-CBA-071/REQ-CBA-073: dono da vez NÃO recua o turno (combat:previousTurn segue privilegiado)", async () => {
    const enc = await buildRunningEncounter(gmSocket, ctx.playerUserId, ctx.player2UserId);

    const ack = await sendOp(playerSocket, "combat:previousTurn", { combatId: enc.combatId });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("REQ-CBA-071/REQ-CBA-073/REQ-CBA-080: dono da vez NÃO encerra o encontro (combat:endCombat segue privilegiado)", async () => {
    const enc = await buildRunningEncounter(gmSocket, ctx.playerUserId, ctx.player2UserId);

    const ack = await sendOp(playerSocket, "combat:endCombat", { combatId: enc.combatId });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");

    // Still running for everyone: the GM can advance the turn afterwards.
    const gmAck = await sendOp(gmSocket, "combat:nextTurn", { combatId: enc.combatId });
    expect(gmAck["ok"]).toBe(true);
    expect(combatOf(gmAck)["ended"]).toBe(false);
  });

  it("REQ-CBA-081: sem encontro em andamento não há vez de ninguém — o jogador dono do participante é recusado", async () => {
    const enc = await buildRunningEncounter(gmSocket, ctx.playerUserId, ctx.player2UserId, {
      begin: false,
    });

    const ack = await sendOp(playerSocket, "combat:nextTurn", { combatId: enc.combatId });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("REQ-CBA-081: jogador sem posse sobre nenhum participante é recusado mesmo com o encontro em andamento", async () => {
    const enc = await buildRunningEncounter(gmSocket, ctx.playerUserId, ctx.player2UserId);

    // Advance to turn 1 (player2's combatant): now player1 owns nothing of the turn.
    const gmAck = await sendOp(gmSocket, "combat:nextTurn", { combatId: enc.combatId });
    expect(gmAck["ok"]).toBe(true);

    const ack = await sendOp(playerSocket, "combat:nextTurn", { combatId: enc.combatId });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });
});
