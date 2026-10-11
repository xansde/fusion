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
 *
 * BAR-F4-01 adds the same cut for the SPEAKER of a roll: an NPC the Mestre rolls as carries its real name
 * in `speaker.alias`, which a player may read only if his characters know the contact (spec 39).
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
import { buildChatSendHandler, getRecentChatForUser } from "../chat/chat-handler.js";
import { DocumentStore } from "../documents/store.js";
import { SeqStore } from "../net/seq-store.js";
import { OpBuffer } from "../net/op-buffer.js";
import { TargetingStore } from "../combat/targeting-store.js";
import { buildActorSetKnowledgeHandler } from "../net/handlers/knowledge-handlers.js";
import { UserRole } from "../documents/ownership.js";
import type { Namespace } from "socket.io";
import { PROTOCOL_VERSION } from "@fusion/shared";
import type { Ack, Envelope } from "@fusion/shared";

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

// ---------------------------------------------------------------------------
// BAR-F4-01 — an NPC speaks: its name answers to the contact knowledge (spec 39)
//
// The NPC sheet posts its rolls spoken by the NPC, and the server writes the speaker's alias from the actor's
// REAL name. That name is what the Mestre chose not to tell yet while the contact is hidden or only glimpsed
// (REQ-CTT-081/082): it must reach a player the same way the actor does — or not at all — on every chat
// emission path. The Mestre keeps seeing it on all of them.
// ---------------------------------------------------------------------------

const MY_PC_ID = "pcBhrotto0000001";
const OTHER_PC_ID = "pcHuoJinwu000001";
const NPC_HIDDEN = "npcGoblinHidden01";
const NPC_GLIMPSED = "npcGoblinGlimps01";
const NPC_KNOWN = "npcGoblinKnown001";
const NPC_KNOWN_BY_ME_ONLY = "npcKnownByBhrotto";
const NPC_KNOWN_BY_OTHER_ONLY = "npcKnownByHuo0001";
const NPC_HIRELING = "npcHirelingOwned1";

const NPC_NAMES: Record<string, string> = {
  [NPC_HIDDEN]: "Goblin Oculto",
  [NPC_GLIMPSED]: "Goblin Entrevisto",
  [NPC_KNOWN]: "Goblin Conhecido",
  [NPC_KNOWN_BY_ME_ONLY]: "Goblin do Bhrotto",
  [NPC_KNOWN_BY_OTHER_ONLY]: "Goblin do Huo",
  [NPC_HIRELING]: "Mercenário Contratado",
};

/** The alias a player reads for a speaker he does not know (`redaction.ts`). */
const UNKNOWN_SPEAKER = "Criatura desconhecida";

function insertActor(
  db: FusionDatabase,
  actor: { _id: string; name: string; type: string } & Record<string, unknown>,
): void {
  const now = Date.now();
  db.raw
    .prepare(
      `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(actor._id, JSON.stringify(actor), actor.name, actor.type, now, now);
}

const knowledge = (
  general: 0 | 1 | 2,
  exceptions: Record<string, 0 | 1 | 2> = {},
): Record<string, unknown> => ({ fusion: { knowledge: { general, exceptions } } });

function seedSpeakers(ctx: TestContext): void {
  insertActor(ctx.fusionDb, {
    _id: MY_PC_ID,
    name: "Bhrotto",
    type: "character",
    ownership: { default: 0, [ctx.playerId]: 3 },
  });
  insertActor(ctx.fusionDb, {
    _id: OTHER_PC_ID,
    name: "Huo Jinwu",
    type: "character",
    ownership: { default: 0 },
  });
  // No knowledge map at all: nobody knows it (the default of a fresh contact is hidden).
  insertActor(ctx.fusionDb, {
    _id: NPC_HIDDEN,
    name: NPC_NAMES[NPC_HIDDEN]!,
    type: "npc",
    ownership: { default: 0 },
  });
  insertActor(ctx.fusionDb, {
    _id: NPC_GLIMPSED,
    name: NPC_NAMES[NPC_GLIMPSED]!,
    type: "npc",
    ownership: { default: 0 },
    flags: knowledge(1),
  });
  insertActor(ctx.fusionDb, {
    _id: NPC_KNOWN,
    name: NPC_NAMES[NPC_KNOWN]!,
    type: "npc",
    ownership: { default: 0 },
    flags: knowledge(2),
  });
  // Per-character exceptions win over the general rule (REQ-CTT-072): one NPC only my character knows,
  // one only the other player's character knows.
  insertActor(ctx.fusionDb, {
    _id: NPC_KNOWN_BY_ME_ONLY,
    name: NPC_NAMES[NPC_KNOWN_BY_ME_ONLY]!,
    type: "npc",
    ownership: { default: 0 },
    flags: knowledge(0, { [MY_PC_ID]: 2 }),
  });
  insertActor(ctx.fusionDb, {
    _id: NPC_KNOWN_BY_OTHER_ONLY,
    name: NPC_NAMES[NPC_KNOWN_BY_OTHER_ONLY]!,
    type: "npc",
    ownership: { default: 0 },
    flags: knowledge(0, { [OTHER_PC_ID]: 2 }),
  });
  // Hidden to everybody, but the player is its OWNER (a hireling the Mestre handed over): nobody is a stranger
  // to a document they own (REQ-CTT-074).
  insertActor(ctx.fusionDb, {
    _id: NPC_HIRELING,
    name: NPC_NAMES[NPC_HIRELING]!,
    type: "npc",
    ownership: { default: 0, [ctx.playerId]: 3 },
  });
}

interface SpeakerLike {
  userId?: string;
  actorId?: string;
  tokenId?: string;
  alias?: string;
}

interface SpokenMessage extends ChatMessageLike {
  speaker?: SpeakerLike;
}

/** The Mestre posts a public roll spoken by `actorId` (what the NPC sheet does). */
async function gmRollsAs(
  ctx: TestContext,
  gmSocket: ClientSocket,
  actorId: string,
  content = "/roll 1d20+7 # Garras",
): Promise<{ ack: Record<string, unknown>; messageId: string }> {
  const ack = await sendOp(gmSocket, "chat:send", {
    content,
    worldId: ctx.worldId,
    rollMode: "public",
    speakerActorId: actorId,
  });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  return { ack, messageId: String((ack["result"] as { message: SpokenMessage }).message._id) };
}

/** Joins as `token`'s user and collects every ChatMessage the join snapshot carries. */
function joinAndCollectChat(
  ctx: TestContext,
  token: string,
  quietMs = 400,
): Promise<{
  socket: ClientSocket;
  messages: SpokenMessage[];
}> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    const messages: SpokenMessage[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        socket.off("op", onOp);
        resolve({ socket, messages });
      }, quietMs);
    };
    const onOp = (envelope: Record<string, unknown>): void => {
      const payload = envelope["payload"] as { documentType?: string; documents?: SpokenMessage[] };
      if (payload.documentType === "ChatMessage") messages.push(...(payload.documents ?? []));
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

describe("o falante de uma rolagem segue o conhecimento do contato (spec 39) em todos os caminhos do chat", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  const lateSockets: ClientSocket[] = [];

  beforeEach(async () => {
    ctx = await buildTestContext();
    seedSpeakers(ctx);
    [gmSocket, playerSocket] = await Promise.all([
      connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
      connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
    ]);
  }, 15_000);

  afterEach(async () => {
    gmSocket?.disconnect();
    playerSocket?.disconnect();
    for (const socket of lateSockets.splice(0)) socket.disconnect();
    await teardown(ctx);
  });

  /** What the player's socket receives when the Mestre rolls as `actorId`, and what the Mestre's does. */
  async function liveCopies(
    actorId: string,
  ): Promise<{ gm: SpokenMessage; player: SpokenMessage }> {
    const gmSeen = nextChatMessage(gmSocket);
    const playerSeen = nextChatMessage(playerSocket);
    await gmRollsAs(ctx, gmSocket, actorId);
    const [gm, player] = await Promise.all([gmSeen, playerSeen]);
    return { gm: gm as SpokenMessage, player: player as SpokenMessage };
  }

  it("caminho 1/5 — ao vivo: um contato OCULTO fala sem nome nem id para o jogador; o Mestre lê o nome real", async () => {
    const { gm, player } = await liveCopies(NPC_HIDDEN);

    expect(gm.speaker).toMatchObject({ alias: "Goblin Oculto", actorId: NPC_HIDDEN });
    expect(player.speaker?.alias).toBe(UNKNOWN_SPEAKER);
    expect(player.speaker?.actorId).toBeUndefined();
    // Not just the field: the real name and the id are nowhere in the bytes the player received.
    expect(JSON.stringify(player)).not.toContain("Goblin Oculto");
    expect(JSON.stringify(player)).not.toContain(NPC_HIDDEN);
    // The roll itself is still delivered: the redaction is of WHO, never of WHAT happened.
    expect(player.content).toContain("Garras");
  });

  it("um contato só ENTREVISTO também fala sem nome (entrevisto não tem nome, REQ-CTT-081)", async () => {
    const { gm, player } = await liveCopies(NPC_GLIMPSED);
    expect(gm.speaker?.alias).toBe("Goblin Entrevisto");
    expect(player.speaker?.alias).toBe(UNKNOWN_SPEAKER);
    expect(JSON.stringify(player)).not.toContain("Goblin Entrevisto");
    expect(JSON.stringify(player)).not.toContain(NPC_GLIMPSED);
  });

  it("um contato CONHECIDO fala com o nome dele para o jogador", async () => {
    const { player } = await liveCopies(NPC_KNOWN);
    expect(player.speaker).toMatchObject({ alias: "Goblin Conhecido", actorId: NPC_KNOWN });
  });

  it("a exceção por personagem vale: quem o meu personagem conhece fala com nome; quem só o do outro jogador conhece, não", async () => {
    const mine = await liveCopies(NPC_KNOWN_BY_ME_ONLY);
    expect(mine.player.speaker?.alias).toBe("Goblin do Bhrotto");

    const others = await liveCopies(NPC_KNOWN_BY_OTHER_ONLY);
    expect(others.gm.speaker?.alias).toBe("Goblin do Huo");
    expect(others.player.speaker?.alias).toBe(UNKNOWN_SPEAKER);
    expect(JSON.stringify(others.player)).not.toContain("Goblin do Huo");
  });

  it("ninguém é estranho ao que possui: o dono de um mercenário oculto lê o nome dele", async () => {
    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d20+6 # Espada",
      worldId: ctx.worldId,
      rollMode: "public",
      speakerActorId: NPC_HIRELING,
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const message = (ack["result"] as { message: SpokenMessage }).message;
    expect(message.speaker).toMatchObject({
      alias: "Mercenário Contratado",
      actorId: NPC_HIRELING,
    });
  });

  it("um personagem de jogador nunca é redigido: o nome do PJ aparece para todos", async () => {
    const { player } = await liveCopies(OTHER_PC_ID);
    expect(player.speaker).toMatchObject({ alias: "Huo Jinwu", actorId: OTHER_PC_ID });
  });

  it("caminho 2/5 — chat:history: a redação sobrevive à releitura persistida (e o Mestre continua lendo o nome)", async () => {
    await gmRollsAs(ctx, gmSocket, NPC_HIDDEN);
    await sleep(30);

    const playerHistory = await sendQuery(playerSocket, "chat:history", {
      worldId: ctx.worldId,
      limit: 10,
    });
    const playerMessages = (playerHistory["result"] as { messages: SpokenMessage[] }).messages;
    expect(playerMessages).toHaveLength(1);
    expect(playerMessages[0]?.speaker?.alias).toBe(UNKNOWN_SPEAKER);
    expect(JSON.stringify(playerMessages)).not.toContain("Goblin Oculto");
    expect(JSON.stringify(playerMessages)).not.toContain(NPC_HIDDEN);

    const gmHistory = await sendQuery(gmSocket, "chat:history", {
      worldId: ctx.worldId,
      limit: 10,
    });
    const gmMessages = (gmHistory["result"] as { messages: SpokenMessage[] }).messages;
    expect(gmMessages[0]?.speaker).toMatchObject({ alias: "Goblin Oculto", actorId: NPC_HIDDEN });
  });

  it("caminho 3/5 — chat:search e chat:context", async () => {
    const { messageId } = await gmRollsAs(
      ctx,
      gmSocket,
      NPC_HIDDEN,
      "/roll 1d20+7 # garra-secreta",
    );
    await sleep(30);

    const playerSearch = await sendQuery(playerSocket, "chat:search", {
      worldId: ctx.worldId,
      q: "garra-secreta",
    });
    expect(playerSearch["ok"], JSON.stringify(playerSearch)).toBe(true);
    const hits = (playerSearch["result"] as { messages: SpokenMessage[] }).messages;
    expect(hits).toHaveLength(1);
    expect(JSON.stringify(hits)).not.toContain("Goblin Oculto");
    expect(JSON.stringify(hits)).not.toContain(NPC_HIDDEN);

    const playerContext = await sendQuery(playerSocket, "chat:context", {
      worldId: ctx.worldId,
      id: messageId,
      limit: 5,
    });
    expect(playerContext["ok"], JSON.stringify(playerContext)).toBe(true);
    expect(JSON.stringify(playerContext)).not.toContain("Goblin Oculto");
    expect(JSON.stringify(playerContext)).not.toContain(NPC_HIDDEN);

    const gmSearch = await sendQuery(gmSocket, "chat:search", {
      worldId: ctx.worldId,
      q: "garra-secreta",
    });
    const gmHits = (gmSearch["result"] as { messages: SpokenMessage[] }).messages;
    expect(gmHits[0]?.speaker?.alias).toBe("Goblin Oculto");
  });

  it("caminho 4/5 — o snapshot de entrada de quem chega depois não traz o nome", async () => {
    await gmRollsAs(ctx, gmSocket, NPC_HIDDEN);
    await sleep(30);

    const { socket, messages } = await joinAndCollectChat(ctx, ctx.playerToken);
    lateSockets.push(socket);
    expect(messages.length).toBeGreaterThan(0);
    expect(JSON.stringify(messages)).not.toContain("Goblin Oculto");
    expect(JSON.stringify(messages)).not.toContain(NPC_HIDDEN);
    expect(messages.some((m) => m.speaker?.alias === UNKNOWN_SPEAKER)).toBe(true);
  });

  it("caminho 5/5 — o card do golpe: o jogador vê o card, não o nome do falante nem o id do NPC no falante", async () => {
    const card = {
      kind: "strike",
      casterActorId: NPC_HIDDEN,
      name: "Garras",
      damageFormula: "1d6+2",
      critDamageFormula: "(1d6+2)*2",
      damageType: "slashing",
    };
    const gmSeen = nextChatMessage(gmSocket);
    const playerSeen = nextChatMessage(playerSocket);
    const ack = await sendOp(gmSocket, "chat:send", {
      content: "Garras (MAP 0)",
      worldId: ctx.worldId,
      speakerActorId: NPC_HIDDEN,
      flags: { pf2e: { abilityCard: card } },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const [gm, player] = (await Promise.all([gmSeen, playerSeen])) as SpokenMessage[];

    expect(gm?.speaker?.alias).toBe("Goblin Oculto");
    expect(player?.speaker?.alias).toBe(UNKNOWN_SPEAKER);
    expect(player?.speaker?.actorId).toBeUndefined();
    expect(JSON.stringify(player)).not.toContain("Goblin Oculto");
  });

  it("custo: o que o jogador não pode ler não custa leitura de ator, e várias mensagens do mesmo falante leem o ator e os PJs uma vez só", async () => {
    // A store that counts what the speaker cut reads, over the same database the world writes to.
    const reads = { actors: 0, characters: 0 };
    const row = (id: string): Record<string, unknown> =>
      JSON.parse(
        (
          ctx.fusionDb.raw.prepare(`SELECT data FROM actors WHERE id = ?`).get(id) as {
            data: string;
          }
        ).data,
      ) as Record<string, unknown>;
    const store = {
      get: (table: string, id: string) => {
        if (table === "actors") reads.actors += 1;
        return row(id);
      },
      getAll: (table: string, query?: { type?: string }) => {
        if (table !== "actors" || query?.type !== "character") return [];
        reads.characters += 1;
        return (
          ctx.fusionDb.raw.prepare(`SELECT data FROM actors WHERE type = 'character'`).all() as {
            data: string;
          }[]
        ).map((r) => JSON.parse(r.data) as Record<string, unknown>);
      },
    } as unknown as DocumentStore;
    const snapshotOf = (): SpokenMessage[] =>
      getRecentChatForUser(
        ctx.fusionDb.raw,
        ctx.playerId,
        1,
        50,
        store,
      ) as unknown as SpokenMessage[];

    // Four rolls only the Mestre may read (gmroll): the player's pass over them reads no actor and no character.
    for (let i = 0; i < 4; i++) {
      const ack = await sendOp(gmSocket, "chat:send", {
        content: `/gmroll 1d20+7 # secreta-${String(i)}`,
        worldId: ctx.worldId,
        speakerActorId: NPC_HIDDEN,
      });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    }
    await sleep(30);
    expect(snapshotOf()).toHaveLength(0);
    expect(reads).toEqual({ actors: 0, characters: 0 });
    // The chat takes five messages a second from one user (REQ-CHT-NF-004): let the window pass.
    await sleep(1100);

    // Five public ones from the same speaker: the pass reads the actor and the characters once, not five times.
    for (let i = 0; i < 5; i++) await gmRollsAs(ctx, gmSocket, NPC_HIDDEN);
    await sleep(30);
    const visible = snapshotOf();
    expect(visible).toHaveLength(5);
    expect(visible.every((m) => m.speaker?.alias === UNKNOWN_SPEAKER)).toBe(true);
    expect(reads).toEqual({ actors: 1, characters: 1 });
  });

  it("quando o Mestre passa a revelar o contato, a releitura já mostra o nome (a redação responde com o presente)", async () => {
    await gmRollsAs(ctx, gmSocket, NPC_HIDDEN);
    await sleep(30);
    const before = await sendQuery(playerSocket, "chat:history", {
      worldId: ctx.worldId,
      limit: 10,
    });
    expect((before["result"] as { messages: SpokenMessage[] }).messages[0]?.speaker?.alias).toBe(
      UNKNOWN_SPEAKER,
    );

    // The Mestre makes the goblin known to everybody (the general rule moves from hidden to known).
    ctx.fusionDb.raw.prepare(`UPDATE actors SET data = ? WHERE id = ?`).run(
      JSON.stringify({
        _id: NPC_HIDDEN,
        name: "Goblin Oculto",
        type: "npc",
        ownership: { default: 0 },
        flags: knowledge(2),
      }),
      NPC_HIDDEN,
    );

    const after = await sendQuery(playerSocket, "chat:history", {
      worldId: ctx.worldId,
      limit: 10,
    });
    expect((after["result"] as { messages: SpokenMessage[] }).messages[0]?.speaker?.alias).toBe(
      "Goblin Oculto",
    );
  });

  it("um ator apagado, ou cuja linha não se lê, fala como desconhecido no histórico e na busca (falha fechada)", async () => {
    // Two contacts the player KNOWS: while they exist, their names reach him.
    await gmRollsAs(ctx, gmSocket, NPC_KNOWN, "/roll 1d20+7 # garra-apagada");
    await gmRollsAs(ctx, gmSocket, NPC_KNOWN_BY_ME_ONLY, "/roll 1d20+7 # garra-corrompida");
    await sleep(30);
    const historyOf = async (socket: ClientSocket): Promise<SpokenMessage[]> =>
      (
        (await sendQuery(socket, "chat:history", { worldId: ctx.worldId, limit: 10 }))[
          "result"
        ] as {
          messages: SpokenMessage[];
        }
      ).messages;
    expect((await historyOf(playerSocket)).map((m) => m.speaker?.alias).sort()).toEqual(
      ["Goblin Conhecido", "Goblin do Bhrotto"].sort(),
    );

    // The Mestre deletes one, and the row of the other stops parsing: nobody can say any more that the player
    // knows them, and the stored aliases are still their real names.
    ctx.fusionDb.raw.prepare(`DELETE FROM actors WHERE id = ?`).run(NPC_KNOWN);
    ctx.fusionDb.raw
      .prepare(`UPDATE actors SET data = ? WHERE id = ?`)
      .run("{", NPC_KNOWN_BY_ME_ONLY);

    const history = await historyOf(playerSocket);
    expect(history).toHaveLength(2);
    expect(history.every((m) => m.speaker?.alias === UNKNOWN_SPEAKER)).toBe(true);
    for (const leaked of [
      "Goblin Conhecido",
      NPC_KNOWN,
      "Goblin do Bhrotto",
      NPC_KNOWN_BY_ME_ONLY,
    ]) {
      expect(JSON.stringify(history), leaked).not.toContain(leaked);
    }

    for (const q of ["garra-apagada", "garra-corrompida"]) {
      const search = await sendQuery(playerSocket, "chat:search", { worldId: ctx.worldId, q });
      expect(search["ok"], JSON.stringify(search)).toBe(true);
      const hits = (search["result"] as { messages: SpokenMessage[] }).messages;
      expect(hits, q).toHaveLength(1);
      expect(hits[0]?.speaker?.alias, q).toBe(UNKNOWN_SPEAKER);
      expect(hits[0]?.speaker?.actorId, q).toBeUndefined();
    }

    // The Mestre still reads what was written.
    expect((await historyOf(gmSocket)).map((m) => m.speaker?.alias).sort()).toEqual(
      ["Goblin Conhecido", "Goblin do Bhrotto"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// BAR-F4-01 — the same tick: what the Mestre changes between two messages holds for the second one
//
// A socket hands the server every frame of one network chunk in the same task, with no microtask in between.
// The GM's chat:send as an NPC, actor:setKnowledge general=0 and another chat:send can therefore run back to
// back; the second roll must already answer to the new knowledge. Driven here on the handlers themselves, with
// no await between the three ops, so the "same task" is not left to how the network chunks the frames.
// ---------------------------------------------------------------------------

describe("no mesmo tick: chat:send como o NPC, actor:setKnowledge e outro chat:send (sem await entre as ops)", () => {
  const WORLD = "same-tick-world";
  const GM = { userId: "gm-user", role: UserRole.GAMEMASTER, worldId: WORLD };
  const PLAYER_ID = "player-one";
  let dataDir: string;
  let fusionDb: FusionDatabase;

  interface FakeSocket {
    data: { userId: string; role: number };
    received: Envelope[];
    emit: (event: string, envelope: Envelope) => boolean;
  }
  const fakeSocket = (userId: string, role: number): FakeSocket => {
    const received: Envelope[] = [];
    return {
      data: { userId, role },
      received,
      emit: (event, envelope) => {
        if (event === "op") received.push(envelope);
        return true;
      },
    };
  };

  beforeEach(() => {
    dataDir = makeTempDir();
    const dbPath = join(dataDir, "world.db");
    fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);
  });

  afterEach(() => {
    fusionDb.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("a segunda rolagem já chega ao jogador sem o nome do contato que o Mestre acabou de esconder", () => {
    const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
    // Through the store, so the rows carry the `_stats` a later write (actor:setKnowledge) bumps.
    const author = { userId: GM.userId };
    store.create(
      "actors",
      { name: "Bhrotto", type: "character", ownership: { default: 0, [PLAYER_ID]: 3 } },
      author,
    );
    const npcId = store.create(
      "actors",
      { name: NPC_NAMES[NPC_KNOWN]!, type: "npc", ownership: { default: 0 }, flags: knowledge(2) },
      author,
    )["_id"] as string;

    const gmSocket = fakeSocket(GM.userId, UserRole.GAMEMASTER);
    const playerSocket = fakeSocket(PLAYER_ID, UserRole.PLAYER);
    const ns = {
      sockets: new Map<string, FakeSocket>([
        ["gm", gmSocket],
        ["player", playerSocket],
      ]),
      emit: () => true,
    } as unknown as Namespace;
    const seqStore = new SeqStore(fusionDb.raw);
    const send = buildChatSendHandler({
      db: fusionDb.raw,
      ns,
      seqStore,
      worldId: WORLD,
      store,
      targetingStore: new TargetingStore(),
    });
    const setKnowledge = buildActorSetKnowledgeHandler({
      store,
      seqStore,
      opBuffer: new OpBuffer(),
      ns,
    });
    const roll = {
      content: "/roll 1d20+7 # Garras",
      worldId: WORLD,
      rollMode: "public",
      speakerActorId: npcId,
    };

    // The three ops of one chunk: no await, no microtask, between them.
    const first = send(roll, GM) as Ack<unknown>;
    const hide = setKnowledge({ updates: [{ actorId: npcId, general: 0 }] }, GM) as Ack<unknown>;
    const second = send(roll, GM) as Ack<unknown>;
    expect([first.ok, hide.ok, second.ok]).toEqual([true, true, true]);

    const chatTo = (socket: FakeSocket): SpokenMessage[] =>
      socket.received
        .map(
          (envelope) => envelope.payload as { documentType?: string; documents?: SpokenMessage[] },
        )
        .filter((payload) => payload.documentType === "ChatMessage")
        .flatMap((payload) => payload.documents ?? []);
    const [before, after] = chatTo(playerSocket);
    expect(before?.speaker?.alias).toBe("Goblin Conhecido");
    expect(after?.speaker?.alias).toBe(UNKNOWN_SPEAKER);
    expect(after?.speaker?.actorId).toBeUndefined();
    expect(JSON.stringify(after)).not.toContain("Goblin Conhecido");
    expect(JSON.stringify(after)).not.toContain(npcId);
    // The Mestre reads the name on both.
    expect(chatTo(gmSocket).map((m) => m.speaker?.alias)).toEqual([
      "Goblin Conhecido",
      "Goblin Conhecido",
    ]);
  });
});
