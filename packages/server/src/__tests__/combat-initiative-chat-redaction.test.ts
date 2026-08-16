/**
 * combat-initiative-chat-redaction.test.ts — the chat log is the same screen.
 *
 * Spec: 40-aba-combate.md §5.7 (REQ-CBA-067) and §5.9 (REQ-CBA-080/082).
 *
 * REQ-CBA-067 [MVP]: "O jogador NÃO DEVE ver o valor de iniciativa de criatura
 * em momento algum, nem na montagem." The combat panel hides the number in its
 * own column, but the "Rolar criaturas" gesture (REQ-CBA-063) also publishes a
 * chat message per rolled combatant. Hiding the column while the very same
 * number is printed in the chat panel next to it is not redaction — so the
 * server must whisper creature initiative to GMs only.
 *
 * These tests inspect the PAYLOAD received by a real PLAYER socket (and the
 * player's chat:history), never the screen.
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
// Harness (mirrors combat-m2c.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-combat-chat-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  gmUserId: string;
  playerToken: string;
  playerUserId: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "combat-chat-redaction-world";

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
    worldInfo: { id: worldId, title: "Combat Chat World", systemId: "stub" },
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
    gmUserId: gm.id,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
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
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 8000);
  });
}

function drain(ms = 200): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Record every `op` envelope a socket receives, until `stop()` is called. */
function recordOps(socket: ClientSocket): {
  chatContents: () => string[];
  stop: () => void;
} {
  const envelopes: Record<string, unknown>[] = [];
  const handler = (env: Record<string, unknown>) => envelopes.push(env);
  socket.on("op", handler);
  return {
    chatContents: () => {
      const out: string[] = [];
      for (const env of envelopes) {
        const payload = env["payload"] as Record<string, unknown> | undefined;
        if (!payload || payload["documentType"] !== "ChatMessage") continue;
        const docs = payload["documents"];
        if (!Array.isArray(docs)) continue;
        for (const doc of docs as Record<string, unknown>[]) {
          const content = doc["content"];
          if (typeof content === "string") out.push(content);
        }
      }
      return out;
    },
    stop: () => socket.off("op", handler),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CREATURE_NAME = "Goblin Batedor";
const PC_NAME = "Fofurinha";

interface Fixtures {
  combatId: string;
  creatureCombatantId: string;
  pcCombatantId: string;
}

async function createToken(
  gmSocket: ClientSocket,
  sceneId: string,
  name: string,
  actorId: string,
): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Token",
    data: [{ name, actorId, x: 0, y: 0 }],
    parent: { type: "Scene", id: sceneId },
  });
  expect(ack["ok"]).toBe(true);
  const parent = (ack["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>;
  const tokens = parent["tokens"] as Record<string, unknown>[];
  const created = tokens.find((t) => t["name"] === name);
  return created!["_id"] as string;
}

async function buildEncounter(gmSocket: ClientSocket, playerUserId: string): Promise<Fixtures> {
  const sceneAck = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [{ name: "Arena", width: 1000, height: 1000 }],
  });
  expect(sceneAck["ok"]).toBe(true);
  const sceneId = (
    (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
  )[0]!["_id"] as string;

  // PC actor — owned by the player, so hasPlayerOwner === true.
  const pcAck = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [{ name: PC_NAME, type: "character", ownership: { default: 0, [playerUserId]: 3 } }],
  });
  expect(pcAck["ok"]).toBe(true);
  const pcActorId = (
    (pcAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
  )[0]!["_id"] as string;

  // Creature actor — no player owner, and NOT hidden: the point of the test is
  // that "creature" alone is enough to keep the value away from the player.
  const npcAck = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [{ name: CREATURE_NAME, type: "npc", ownership: { default: 0 } }],
  });
  expect(npcAck["ok"]).toBe(true);
  const npcActorId = (
    (npcAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
  )[0]!["_id"] as string;

  // Real scene tokens so the combatant carries a real name (addCombatant reads
  // the name from the token, not from the actor).
  const pcTokenId = await createToken(gmSocket, sceneId, PC_NAME, pcActorId);
  const creatureTokenId = await createToken(gmSocket, sceneId, CREATURE_NAME, npcActorId);

  const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
  expect(createAck["ok"]).toBe(true);
  const combatId = (
    (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
  )["_id"] as string;

  const addPc = await sendOp(gmSocket, "combat:addCombatant", {
    combatId,
    tokenId: pcTokenId,
    actorId: pcActorId,
    hidden: false,
  });
  expect(addPc["ok"]).toBe(true);

  const addNpc = await sendOp(gmSocket, "combat:addCombatant", {
    combatId,
    tokenId: creatureTokenId,
    actorId: npcActorId,
    hidden: false,
  });
  expect(addNpc["ok"]).toBe(true);

  const combatants = (
    (addNpc["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
  )["combatants"] as Record<string, unknown>[];

  const pc = combatants.find((c) => c["actorId"] === pcActorId);
  const creature = combatants.find((c) => c["actorId"] === npcActorId);
  expect(pc?.["hasPlayerOwner"]).toBe(true);
  expect(pc?.["name"]).toBe(PC_NAME);
  expect(creature?.["hasPlayerOwner"]).toBe(false);
  expect(creature?.["name"]).toBe(CREATURE_NAME);
  expect(creature?.["hidden"]).toBe(false);

  return {
    combatId,
    creatureCombatantId: creature!["_id"] as string,
    pcCombatantId: pc!["_id"] as string,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("iniciativa de criatura no chat (REQ-CBA-067)", { timeout: 30000 }, () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    const auth = (token: string) => ({ token, protocolVersion: PROTOCOL_VERSION });
    gmSocket = connectClient(ctx.port, ctx.worldId, auth(ctx.gmToken));
    playerSocket = connectClient(ctx.port, ctx.worldId, auth(ctx.playerToken));
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await drain(100);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("REQ-CBA-067: o gesto 'rolar criaturas' NÃO entrega o valor ao socket do jogador", async () => {
    const fx = await buildEncounter(gmSocket, ctx.playerUserId);

    const playerTape = recordOps(playerSocket);
    const gmTape = recordOps(gmSocket);

    // The "Rolar criaturas" gesture (REQ-CBA-063) rolls every creature at once.
    const ack = await sendOp(gmSocket, "combat:rollInitiative", {
      combatId: fx.combatId,
      combatantIds: [fx.creatureCombatantId],
    });
    expect(ack["ok"]).toBe(true);

    await drain(300);
    playerTape.stop();
    gmTape.stop();

    // The GM must still get the message — this is redaction, not deletion.
    const gmChat = gmTape.chatContents();
    expect(gmChat.some((c) => c.includes(CREATURE_NAME) && c.includes("initiative"))).toBe(true);

    // The player must not read a single word of it — neither the name nor the
    // number (only the creature was rolled, so ANY initiative line is a leak).
    const creatureTotal = (
      ((ack["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>)[
        "combatants"
      ] as Record<string, unknown>[]
    ).find((c) => c["_id"] === fx.creatureCombatantId)?.["initiative"];
    expect(typeof creatureTotal).toBe("number");

    const playerChat = playerTape.chatContents();
    expect(playerChat.some((c) => c.includes(CREATURE_NAME))).toBe(false);
    expect(playerChat.some((c) => c.includes("initiative"))).toBe(false);
    expect(playerChat.some((c) => c.includes(`: ${String(creatureTotal)}`))).toBe(false);
  });

  it("REQ-CBA-067: o valor de criatura também não aparece no chat:history do jogador", async () => {
    const fx = await buildEncounter(gmSocket, ctx.playerUserId);

    const ack = await sendOp(gmSocket, "combat:rollInitiative", {
      combatId: fx.combatId,
      combatantIds: [fx.creatureCombatantId],
    });
    expect(ack["ok"]).toBe(true);
    await drain(200);

    const history = await sendOp(playerSocket, "chat:history", {
      worldId: ctx.worldId,
      limit: 50,
    });
    expect(history["ok"]).toBe(true);
    const messages =
      ((history["result"] as Record<string, unknown>)["messages"] as Record<string, unknown>[]) ??
      [];
    const leaked = messages.filter(
      (m) => typeof m["content"] === "string" && (m["content"] as string).includes(CREATURE_NAME),
    );
    expect(leaked).toEqual([]);
  });

  it("REQ-CBA-065: a iniciativa de participante do jogador continua pública no chat", async () => {
    const fx = await buildEncounter(gmSocket, ctx.playerUserId);

    const playerTape = recordOps(playerSocket);

    const ack = await sendOp(gmSocket, "combat:rollInitiative", {
      combatId: fx.combatId,
      combatantIds: [fx.pcCombatantId],
    });
    expect(ack["ok"]).toBe(true);

    await drain(300);
    playerTape.stop();

    const playerChat = playerTape.chatContents();
    expect(playerChat.some((c) => c.includes(PC_NAME) && c.includes("initiative"))).toBe(true);
  });
});
