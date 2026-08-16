/**
 * Integration tests for the target of an attack roll (G039) — the portrait, and
 * the AC that never leaves the Mestre's payload.
 *
 * Requirements under test:
 *   - REQ-ACH-070 — a roll MAY carry a target; when it does, the message carries
 *     the target's name and the degree of success computed by the server.
 *   - REQ-ACH-071 — without a target there is no degree: only the total goes out.
 *   - REQ-ACH-072 — the target on the message is a PORTRAIT (name + the AC used),
 *     never a reference to the token: renaming or re-arming the actor afterwards
 *     does not change the message.
 *   - REQ-ACH-073 — the payload delivered to a user without a privileged role
 *     does NOT contain the target's AC; the degree does go.
 *   - REQ-ACH-074 — an attack carries exactly ONE target (the message field is a
 *     list, which is what a save spell with several targets will use).
 *   - REQ-ACH-090 — the check is on the SERVER: a forged payload that dictates
 *     the AC is emitted straight at the socket, and the server ignores it.
 *   - REQ-ACH-091 — log, history and join snapshot derive visibility from the
 *     same fields, through the same redaction — there is no second rule.
 *   - REQ-ACH-092 — no payload delivered to a non-privileged user carries data
 *     the screen hides from him: the target's AC, and also the NAME of a token
 *     he cannot see (hidden, or on a scene that is off air — REQ-CEN-071).
 *
 * Everything is asserted on the PAYLOAD the socket receives (broadcast, ack,
 * history and join snapshot) and on the database itself — never on a screen.
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

/** The AC the SERVER derives for the target — the only number it may ever use. */
const TARGET_AC = 21;
/** A different AC, planted by a forged payload, that must never take effect. */
const FORGED_AC = 1;

const TARGET_ACTOR_ID = "ogreBrute000001a";
const TARGET_TOKEN_ID = "ogreToken00000a1";
const TARGET_TOKEN_NAME = "Ogro Batedor";
const TARGET_ACTOR_NAME = "Ogro";
const SCENE_ID = "targetScene00001";
/** A scene that is NOT on air, holding a token the Mestre has hidden. */
const OFFAIR_SCENE_ID = "offairScene00001";
const HIDDEN_TOKEN_ID = "hiddenToken0001a";
const HIDDEN_TOKEN_NAME = "Assassino Oculto";
const HIDDEN_ACTOR_ID = "assassinNpc0001a";
/** A token that is on the scene ON AIR, but hidden by the Mestre. */
const CLOAKED_TOKEN_ID = "cloakToken00001a";
const CLOAKED_TOKEN_NAME = "Espreitador Invisivel";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-chat-target-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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

/** Seeds one actor with a derived AC and one scene holding a token for it. */
function seedTarget(db: FusionDatabase): void {
  const now = Date.now();
  const actor = {
    _id: TARGET_ACTOR_ID,
    name: TARGET_ACTOR_NAME,
    type: "npc",
    system: {
      attributes: { ac: { value: 18 } },
      derived: { ac: { total: TARGET_AC } },
    },
  };
  db.raw
    .prepare(
      `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(TARGET_ACTOR_ID, JSON.stringify(actor), TARGET_ACTOR_NAME, "npc", now, now);

  // `active` is written as a BOOLEAN by the only writer there is
  // (`world:activeScene`), and that is what `sceneIsOnAir` reads.
  const scene = {
    _id: SCENE_ID,
    name: "Clareira",
    active: true,
    tokens: [
      { _id: TARGET_TOKEN_ID, name: TARGET_TOKEN_NAME, actorId: TARGET_ACTOR_ID, hidden: false },
      // Same scene, on air — but hidden by the Mestre.
      {
        _id: CLOAKED_TOKEN_ID,
        name: CLOAKED_TOKEN_NAME,
        actorId: HIDDEN_ACTOR_ID,
        hidden: true,
      },
    ],
  };
  db.raw
    .prepare(
      `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, ?, ?)`,
    )
    .run(SCENE_ID, JSON.stringify(scene), "Clareira", now, now);

  // The actor behind both hidden tokens — it has an AC, so nothing but the
  // visibility check can stop a portrait from being built.
  const hiddenActor = {
    _id: HIDDEN_ACTOR_ID,
    name: "Assassino",
    type: "npc",
    system: { attributes: { ac: { value: 19 } }, derived: { ac: { total: 19 } } },
  };
  db.raw
    .prepare(
      `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(HIDDEN_ACTOR_ID, JSON.stringify(hiddenActor), "Assassino", "npc", now, now);

  // A scene that is NOT on air, with a hidden token inside it.
  const offAir = {
    _id: OFFAIR_SCENE_ID,
    name: "Cova Secreta",
    active: false,
    tokens: [
      { _id: HIDDEN_TOKEN_ID, name: HIDDEN_TOKEN_NAME, actorId: HIDDEN_ACTOR_ID, hidden: true },
    ],
  };
  db.raw
    .prepare(
      `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, ?, ?)`,
    )
    .run(OFFAIR_SCENE_ID, JSON.stringify(offAir), "Cova Secreta", now, now);
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-chat-target-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  seedTarget(fusionDb);

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
    worldInfo: { id: worldId, title: "Test Chat Target World", systemId: "stub" },
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

/**
 * Connects and collects every `op` envelope of the join snapshot — used to read
 * the chat the server hands a client at the door (REQ-ACH-091).
 */
function connectAndCollect(
  port: number,
  worldId: string,
  token: string,
  windowMs = 600,
): Promise<{ socket: ClientSocket; envelopes: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const envelopes: Record<string, unknown>[] = [];
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    socket.on("op", (envelope: Record<string, unknown>) => envelopes.push(envelope));
    socket.once("connect", () => {
      setTimeout(() => resolve({ socket, envelopes }), windowMs);
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 8000);
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

interface TargetLike {
  name?: string;
  ac?: number;
}

interface ChatMessageLike {
  _id?: string;
  content?: string;
  targets?: TargetLike[];
  rolls?: { total?: number; degreeOfSuccess?: string; target?: TargetLike }[];
}

function firstRoll(msg: ChatMessageLike): {
  total?: number;
  degreeOfSuccess?: string;
  target?: TargetLike;
} {
  const roll = msg.rolls?.[0];
  expect(roll, `message carries no roll: ${JSON.stringify(msg)}`).toBeDefined();
  return roll ?? {};
}

/** Reads the message straight out of storage — the wire cannot lie about this. */
function storedMessage(ctx: TestContext, id: string): ChatMessageLike | null {
  const row = ctx.fusionDb.raw.prepare(`SELECT data FROM chat_messages WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as ChatMessageLike) : null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("alvo da rolagem — retrato do momento, e a CA fora do payload do jogador", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    [gmSocket, playerSocket] = await Promise.all([
      connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
      connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
    ]);
  }, 15_000);

  afterEach(async () => {
    gmSocket?.disconnect();
    playerSocket?.disconnect();
    await teardown(ctx);
  });

  it("REQ-ACH-070/073/092: o jogador recebe nome e grau; a CA só está no payload do Mestre", async () => {
    const gmSeen = nextChatMessage(gmSocket);
    const playerSeen = nextChatMessage(playerSocket);

    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { tokenId: TARGET_TOKEN_ID },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const [gmMsg, playerMsg] = await Promise.all([gmSeen, playerSeen]);

    // What the Mestre gets: the whole portrait, AC included.
    const gmRoll = firstRoll(gmMsg);
    expect(gmRoll.target?.name).toBe(TARGET_TOKEN_NAME);
    expect(gmRoll.target?.ac).toBe(TARGET_AC);
    expect(gmMsg.targets?.[0]?.ac).toBe(TARGET_AC);

    // What the player gets: the same name, the degree — and NO number.
    const playerRoll = firstRoll(playerMsg);
    expect(playerRoll.target?.name).toBe(TARGET_TOKEN_NAME);
    expect(playerRoll.degreeOfSuccess).toBeDefined();
    expect(playerRoll.target).not.toHaveProperty("ac");
    expect(playerMsg.targets?.[0]?.name).toBe(TARGET_TOKEN_NAME);
    expect(playerMsg.targets?.[0]).not.toHaveProperty("ac");

    // The grade is the same one the Mestre sees — it is computed on the server.
    expect(playerRoll.degreeOfSuccess).toBe(gmRoll.degreeOfSuccess);

    // The number is nowhere in the bytes the player received.
    expect(JSON.stringify(playerMsg)).not.toContain(`"ac"`);

    // REQ-ACH-092: the ack the ROLLER got carries no AC either.
    const acked = (ack["result"] as { message: ChatMessageLike }).message;
    expect(acked.rolls?.[0]?.target?.name).toBe(TARGET_TOKEN_NAME);
    expect(acked.rolls?.[0]?.target).not.toHaveProperty("ac");
    expect(JSON.stringify(acked)).not.toContain(`"ac"`);
  });

  it("REQ-ACH-074: um ataque carrega exatamente UM alvo", async () => {
    const gmSeen = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { tokenId: TARGET_TOKEN_ID },
    });
    const gmMsg = await gmSeen;
    expect(gmMsg.targets).toHaveLength(1);
  });

  it("REQ-ACH-071: sem alvo sai o total e nenhum grau de sucesso", async () => {
    const gmSeen = nextChatMessage(gmSocket);
    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const gmMsg = await gmSeen;
    const roll = firstRoll(gmMsg);
    expect(typeof roll.total).toBe("number");
    expect(roll.degreeOfSuccess).toBeUndefined();
    expect(roll.target).toBeUndefined();
    expect(gmMsg.targets).toBeUndefined();
  });

  it("REQ-ACH-071: alvo que não resolve não vira grau — a rolagem sai como total puro", async () => {
    const gmSeen = nextChatMessage(gmSocket);
    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { tokenId: "noSuchToken00001" },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const gmMsg = await gmSeen;
    const roll = firstRoll(gmMsg);
    expect(roll.degreeOfSuccess).toBeUndefined();
    expect(roll.target).toBeUndefined();
  });

  it("REQ-ACH-090: a CA que o cliente manda é ignorada — o servidor usa a que ele derivou", async () => {
    const gmSeen = nextChatMessage(gmSocket);

    // Forged straight at the socket, past any client control: the payload
    // dictates a name and an AC of 1.
    await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { tokenId: TARGET_TOKEN_ID, ac: FORGED_AC, name: "Alvo Falso" },
    });

    const gmMsg = await gmSeen;
    const roll = firstRoll(gmMsg);
    expect(roll.target?.ac).toBe(TARGET_AC);
    expect(roll.target?.name).toBe(TARGET_TOKEN_NAME);
  });

  it("REQ-ACH-090: um alvo apontando o token de um ator alheio lê a CA do ator DO TOKEN", async () => {
    // A second, softer actor the attacker would rather be graded against.
    const now = Date.now();
    const softActorId = "softTarget00001a";
    ctx.fusionDb.raw
      .prepare(
        `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        softActorId,
        JSON.stringify({
          _id: softActorId,
          name: "Saco de Pancada",
          type: "npc",
          system: { derived: { ac: { total: FORGED_AC } } },
        }),
        "Saco de Pancada",
        "npc",
        now,
        now,
      );

    const gmSeen = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { tokenId: TARGET_TOKEN_ID, actorId: softActorId },
    });

    const gmMsg = await gmSeen;
    expect(firstRoll(gmMsg).target?.ac).toBe(TARGET_AC);
  });

  it("REQ-ACH-072: o alvo é retrato — renomear e re-armar o ator depois não muda a mensagem", async () => {
    const gmSeen = nextChatMessage(gmSocket);
    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { tokenId: TARGET_TOKEN_ID },
    });
    const messageId = String((ack["result"] as { message: ChatMessageLike }).message._id);
    await gmSeen;

    // The world moves on: the token is renamed and the actor re-armed.
    ctx.fusionDb.raw.prepare(`UPDATE actors SET data = ?, name = ? WHERE id = ?`).run(
      JSON.stringify({
        _id: TARGET_ACTOR_ID,
        name: "Ogro Ferido",
        type: "npc",
        system: { derived: { ac: { total: 9 } } },
      }),
      "Ogro Ferido",
      TARGET_ACTOR_ID,
    );
    ctx.fusionDb.raw.prepare(`UPDATE scenes SET data = ? WHERE id = ?`).run(
      JSON.stringify({
        _id: SCENE_ID,
        name: "Clareira",
        active: 1,
        tokens: [
          { _id: TARGET_TOKEN_ID, name: "Outro Nome", actorId: TARGET_ACTOR_ID, hidden: false },
        ],
      }),
      SCENE_ID,
    );

    // Stored: still the values of the instant of the roll, and no live reference.
    const stored = storedMessage(ctx, messageId);
    expect(stored?.rolls?.[0]?.target?.name).toBe(TARGET_TOKEN_NAME);
    expect(stored?.rolls?.[0]?.target?.ac).toBe(TARGET_AC);
    expect(stored?.rolls?.[0]?.target).not.toHaveProperty("tokenId");
    expect(stored?.rolls?.[0]?.target).not.toHaveProperty("actorId");
    expect(stored?.targets?.[0]?.name).toBe(TARGET_TOKEN_NAME);

    // And the same on the wire, re-read after the change.
    const history = await sendQuery(gmSocket, "chat:history", { worldId: ctx.worldId, limit: 10 });
    const messages = (history["result"] as { messages: ChatMessageLike[] }).messages;
    const reread = messages.find((m) => m._id === messageId);
    expect(reread?.rolls?.[0]?.target?.name).toBe(TARGET_TOKEN_NAME);
    expect(reread?.rolls?.[0]?.target?.ac).toBe(TARGET_AC);
  });

  it("REQ-ACH-091/092: histórico e snapshot de entrada seguem a MESMA redação do log", async () => {
    const gmSeen = nextChatMessage(gmSocket);
    await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { tokenId: TARGET_TOKEN_ID },
    });
    await gmSeen;
    await sleep(10);

    // History — the player asks, and no AC comes back.
    const playerHistory = await sendQuery(playerSocket, "chat:history", {
      worldId: ctx.worldId,
      limit: 10,
    });
    const playerMessages = (playerHistory["result"] as { messages: ChatMessageLike[] }).messages;
    expect(playerMessages.length).toBeGreaterThan(0);
    expect(JSON.stringify(playerMessages)).not.toContain(`"ac"`);
    expect(playerMessages.some((m) => m.rolls?.[0]?.degreeOfSuccess !== undefined)).toBe(true);

    // The Mestre asks the same history and the number is there.
    const gmHistory = await sendQuery(gmSocket, "chat:history", {
      worldId: ctx.worldId,
      limit: 10,
    });
    const gmMessages = (gmHistory["result"] as { messages: ChatMessageLike[] }).messages;
    expect(gmMessages.some((m) => m.rolls?.[0]?.target?.ac === TARGET_AC)).toBe(true);

    // Join snapshot — a player entering the table now reads the same log, and
    // the AC is not in the bytes he receives at the door.
    const { socket: fresh, envelopes } = await connectAndCollect(
      ctx.port,
      ctx.worldId,
      ctx.playerToken,
    );
    try {
      const chatEnvelopes = envelopes.filter((env) => {
        const payload = env["payload"] as { documentType?: string } | undefined;
        return payload?.documentType === "ChatMessage";
      });
      expect(chatEnvelopes.length).toBeGreaterThan(0);
      const snapshotDocs = chatEnvelopes.flatMap(
        (env) => (env["payload"] as { documents: ChatMessageLike[] }).documents,
      );
      expect(snapshotDocs.some((m) => m.rolls?.[0]?.target?.name === TARGET_TOKEN_NAME)).toBe(true);
      expect(snapshotDocs.some((m) => m.rolls?.[0]?.degreeOfSuccess !== undefined)).toBe(true);
      expect(JSON.stringify(snapshotDocs)).not.toContain(`"ac"`);
    } finally {
      fresh.disconnect();
    }
  }, 20_000);

  // -------------------------------------------------------------------------
  // Visibility of the REFERENCE itself — the id is not a secret, the name is.
  // -------------------------------------------------------------------------

  it("REQ-ACH-072/REQ-ACH-092: o jogador que mira um token OCULTO da cena no ar não publica o nome dele", async () => {
    const gmSeen = nextChatMessage(gmSocket);

    // The id is not a secret: the player saw the token before the Mestre hid it.
    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { tokenId: CLOAKED_TOKEN_ID },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const acked = (ack["result"] as { message: ChatMessageLike }).message;
    expect(JSON.stringify(acked)).not.toContain(CLOAKED_TOKEN_NAME);
    expect(acked.targets).toBeUndefined();
    expect(acked.rolls?.[0]?.degreeOfSuccess).toBeUndefined();

    // No portrait was built at all — not even the Mestre's copy carries one, and
    // the roll goes out as a plain total (REQ-ACH-071).
    const gmMsg = await gmSeen;
    expect(firstRoll(gmMsg).target).toBeUndefined();
    expect(gmMsg.targets).toBeUndefined();
    expect(JSON.stringify(gmMsg)).not.toContain(CLOAKED_TOKEN_NAME);
  });

  it("REQ-ACH-092: token de cena FORA DO AR não vira retrato para o jogador (REQ-CEN-071)", async () => {
    const gmSeen = nextChatMessage(gmSocket);

    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { tokenId: HIDDEN_TOKEN_ID },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const acked = (ack["result"] as { message: ChatMessageLike }).message;
    expect(JSON.stringify(acked)).not.toContain(HIDDEN_TOKEN_NAME);
    expect(acked.targets).toBeUndefined();

    const gmMsg = await gmSeen;
    expect(firstRoll(gmMsg).target).toBeUndefined();
    expect(JSON.stringify(gmMsg)).not.toContain(HIDDEN_TOKEN_NAME);
  });

  it("REQ-ACH-092: o jogador que nomeia um ator DIRETO, sem observá-lo, não recebe o nome de volta", async () => {
    const gmSeen = nextChatMessage(gmSocket);

    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { actorId: HIDDEN_ACTOR_ID },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const acked = (ack["result"] as { message: ChatMessageLike }).message;
    expect(acked.targets).toBeUndefined();
    expect(JSON.stringify(acked)).not.toContain("Assassino");

    const gmMsg = await gmSeen;
    expect(firstRoll(gmMsg).target).toBeUndefined();
  });

  it("REQ-ACH-070: o Mestre segue mirando o token oculto — a restrição é de visibilidade, não do alvo", async () => {
    const gmSeen = nextChatMessage(gmSocket);
    await sendOp(gmSocket, "chat:send", {
      content: "/roll 1d20+7",
      worldId: ctx.worldId,
      target: { tokenId: HIDDEN_TOKEN_ID },
    });

    const gmMsg = await gmSeen;
    const roll = firstRoll(gmMsg);
    expect(roll.target?.name).toBe(HIDDEN_TOKEN_NAME);
    expect(roll.target?.ac).toBe(19);
    expect(roll.degreeOfSuccess).toBeDefined();
  });
});
