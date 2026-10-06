/**
 * token-mark-socket.test.ts — `mark:set` / `mark:clear` over the real socket
 * (BHR-F3-06, REQ-BHR-086..090).
 *
 * Covers what only the wire can show: the permission gate answers
 * `PERMISSION_DENIED` to a player, the persisted mark rides the ordinary Actor
 * `doc:update` pipe, and a mark on a token hidden from a viewer never reaches
 * that viewer (live broadcast, `resync` snapshot and the setter's own ack) while
 * the Mestre keeps seeing it (REQ-BHR-089, `net/redaction.ts` + `isRolePrivileged`).
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
import { DocumentStore } from "../documents/store.js";
import { PROTOCOL_VERSION, readTokenMarks } from "@fusion/shared";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

const RANGER_ID = "rangerActor00001";
const OGRE_ACTOR_ID = "ogreActor0000001";
const AMBUSH_ACTOR_ID = "ambushActor00001";
const OGRE_TOKEN = "ogreToken0000001";
const AMBUSH_TOKEN = "ambushToken00001";
const SEEN_TOKEN = "seenToken0000001";

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  store: DocumentStore;
  port: number;
  worldId: string;
  gmToken: string;
  p1Token: string;
  p2Token: string;
  p2Id: string;
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = join(
    tmpdir(),
    `fusion-token-mark-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-token-mark-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: p1 } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
  });
  const { user: p2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
  });
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const p1Login = await authService.login({
    userId: p1.id,
    password: "player1-pass",
    ip: "127.0.0.1",
  });
  const p2Login = await authService.login({
    userId: p2.id,
    password: "player2-pass",
    ip: "127.0.0.1",
  });

  // Same file as the server's own store: seeding through DocumentStore keeps
  // `_stats` correct for the later `store.update` of the mark handler.
  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const author = { userId: gm.id };
  const actor = (id: string, name: string, ownership: Record<string, number>, type = "npc") =>
    store.create("actors", { _id: id, name, type, ownership }, author);
  // The ranger is a character (not subject to the contact-knowledge filter): p1
  // OWNS it, p2 only observes — so p2 does receive its updates.
  actor(RANGER_ID, "Patrulheiro", { default: 2, [p1.id]: 3 }, "character");
  actor(OGRE_ACTOR_ID, "Ogro", { default: 2 });
  actor(AMBUSH_ACTOR_ID, "Emboscador", { default: 2 });
  store.create(
    "scenes",
    {
      name: "Cena",
      active: true,
      tokens: [
        { _id: OGRE_TOKEN, name: "Ogro", actorId: OGRE_ACTOR_ID, hidden: false },
        { _id: AMBUSH_TOKEN, name: "Emboscador", actorId: AMBUSH_ACTOR_ID, hidden: true },
        {
          _id: SEEN_TOKEN,
          name: "Visto por p2",
          actorId: AMBUSH_ACTOR_ID,
          hidden: true,
          seenBy: [p2.id],
        },
      ],
    },
    author,
  );

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Token Mark World", systemId: "stub" },
  });
  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });
  socketManager.registerWorldNamespace({ worldId, db: fusionDb.raw, secret, authService });
  const port = await reserveFreePort();
  await fastify.listen({ port, host: "127.0.0.1" });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    store,
    port: listeningPort(fastify),
    worldId,
    gmToken: gmLogin.accessToken,
    p1Token: p1Login.accessToken,
    p2Token: p2Login.accessToken,
    p2Id: p2.id,
  };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connect(port: number, worldId: string, token: string): Promise<ClientSocket> {
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

function sendOp(socket: ClientSocket, type: string, payload: unknown) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit(
      "op",
      { type, ts: Date.now(), payload, requestId: Math.random().toString(36).slice(2) },
      (ack: unknown) => {
        if (!ack || typeof ack !== "object") reject(new Error("No ack"));
        else resolve(ack as Record<string, unknown>);
      },
    );
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

/** The next Actor `doc:update` for `actorId` this socket receives. */
function nextActorUpdate(socket: ClientSocket, actorId: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Record<string, unknown>): void => {
      if (envelope["type"] !== "doc:update") return;
      const payload = envelope["payload"] as { documentType?: string; documents?: unknown[] };
      if (payload.documentType !== "Actor") return;
      const doc = (payload.documents ?? []).find(
        (d) => (d as Record<string, unknown>)["_id"] === actorId,
      );
      if (!doc) return;
      socket.off("op", handler);
      resolve(doc as Record<string, unknown>);
    };
    socket.on("op", handler);
    setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("no Actor doc:update"));
    }, 3000);
  });
}

const markedTokens = (doc: Record<string, unknown>): string[] =>
  readTokenMarks(doc)
    .map((m) => m.targetTokenId)
    .sort();

describe("TokenMark over the socket (BHR-F3-06)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let p1: ClientSocket;
  let p2: ClientSocket;

  beforeEach(async () => {
    ctx = await buildCtx();
    [gm, p1, p2] = await Promise.all([
      connect(ctx.port, ctx.worldId, ctx.gmToken),
      connect(ctx.port, ctx.worldId, ctx.p1Token),
      connect(ctx.port, ctx.worldId, ctx.p2Token),
    ]);
  }, 15_000);

  afterEach(async () => {
    gm.disconnect();
    p1.disconnect();
    p2.disconnect();
    await teardown(ctx);
  });

  const huntPrey = (tokenId: string) => ({
    sourceActorId: RANGER_ID,
    mark: { slug: "hunted-prey", targetTokenId: tokenId },
  });

  it("player marks a targeted token (ok), then an untargeted one is PERMISSION_DENIED", async () => {
    await sendOp(p1, "combat:target", { tokenId: OGRE_TOKEN, targeted: true });
    const ok = await sendOp(p1, "mark:set", huntPrey(OGRE_TOKEN));
    expect(ok["ok"], JSON.stringify(ok)).toBe(true);

    const denied = await sendOp(p1, "mark:set", huntPrey(SEEN_TOKEN));
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(markedTokens(ctx.store.get("actors", RANGER_ID))).toEqual([OGRE_TOKEN]);
  });

  it("a player cannot mark on an actor they do not own", async () => {
    await sendOp(p2, "combat:target", { tokenId: OGRE_TOKEN, targeted: true });
    const denied = await sendOp(p2, "mark:set", huntPrey(OGRE_TOKEN));
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });

  it("a second Hunt Prey replaces the first on the persisted actor", async () => {
    await sendOp(gm, "mark:set", huntPrey(OGRE_TOKEN));
    await sendOp(gm, "mark:set", huntPrey(AMBUSH_TOKEN));
    expect(markedTokens(ctx.store.get("actors", RANGER_ID))).toEqual([AMBUSH_TOKEN]);
  });

  it("a mark on a hidden token reaches the Mestre but not a player outside seenBy", async () => {
    const gmSeen = nextActorUpdate(gm, RANGER_ID);
    const p2Seen = nextActorUpdate(p2, RANGER_ID);
    const ack = await sendOp(gm, "mark:set", huntPrey(AMBUSH_TOKEN));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const [gmDoc, p2Doc] = await Promise.all([gmSeen, p2Seen]);
    expect(markedTokens(gmDoc)).toEqual([AMBUSH_TOKEN]);
    // p2 still receives the actor (observer) — just not the mark, and the hidden
    // token's id appears nowhere in the bytes.
    expect(markedTokens(p2Doc)).toEqual([]);
    expect(JSON.stringify(p2Doc)).not.toContain(AMBUSH_TOKEN);
  });

  it("a hidden token the viewer is in `seenBy` of keeps its mark for that viewer only", async () => {
    const p2Seen = nextActorUpdate(p2, RANGER_ID);
    const p1Seen = nextActorUpdate(p1, RANGER_ID);
    await sendOp(gm, "mark:set", huntPrey(SEEN_TOKEN));
    expect(markedTokens(await p2Seen)).toEqual([SEEN_TOKEN]);
    // p1 (the ranger's owner) is not in seenBy: the hidden token stays hidden from them too.
    expect(markedTokens(await p1Seen)).toEqual([]);
  });

  it("the setter's own ack does not leak a mark on a token hidden from them, and a hidden token cannot be newly marked", async () => {
    await sendOp(gm, "mark:set", huntPrey(AMBUSH_TOKEN));
    // The GM hid the token AFTER p1 targeted it: p1's set is refused outright.
    await sendOp(p1, "combat:target", { tokenId: AMBUSH_TOKEN, targeted: true });
    const denied = await sendOp(p1, "mark:set", huntPrey(AMBUSH_TOKEN));
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });

    // A visible mark by the owner: the ack echoes the Actor without the hidden one.
    await sendOp(p1, "combat:target", { tokenId: OGRE_TOKEN, targeted: true });
    const ack = await sendOp(p1, "mark:set", {
      sourceActorId: RANGER_ID,
      mark: { slug: "monster-hunter", targetTokenId: OGRE_TOKEN },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(JSON.stringify(ack)).not.toContain(AMBUSH_TOKEN);
    expect(JSON.stringify(ack)).toContain(OGRE_TOKEN);
  });

  it("mark:clear by the owner removes the mark and the Mestre sees the removal", async () => {
    await sendOp(gm, "mark:set", huntPrey(OGRE_TOKEN));
    const gmSeen = nextActorUpdate(gm, RANGER_ID);
    const ack = await sendOp(p1, "mark:clear", { sourceActorId: RANGER_ID, slug: "hunted-prey" });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(markedTokens(await gmSeen)).toEqual([]);
    expect(markedTokens(ctx.store.get("actors", RANGER_ID))).toEqual([]);
  });
  describe("doc:update does not forge marks (REQ-BHR-087/088)", () => {
    const forged = [
      {
        slug: "hunted-prey",
        targetTokenId: AMBUSH_TOKEN,
        targetActorId: AMBUSH_ACTOR_ID,
        sceneId: "x",
        createdAt: 1,
        exclusive: false,
      },
    ];
    const update = (socket: ClientSocket, diff: Record<string, unknown>) => {
      const stats = ctx.store.get("actors", RANGER_ID)["_stats"] as { version: number };
      return sendOp(socket, "doc:update", {
        documentType: "Actor",
        updates: [{ _id: RANGER_ID, diff, expectedVersion: stats.version }],
      });
    };

    it("the owner cannot write tokenMarks by dot path, by object or by wiping flags.fusion", async () => {
      await sendOp(gm, "mark:set", huntPrey(OGRE_TOKEN));
      const attempts: Record<string, unknown>[] = [
        { "flags.fusion.tokenMarks": forged },
        { flags: { fusion: { tokenMarks: forged } } },
        { "flags.fusion": { tokenMarks: forged } },
        { "flags.fusion": null },
      ];
      for (const diff of attempts) {
        const ack = await update(p1, diff);
        expect(ack["ok"], JSON.stringify(diff)).toBe(false);
        expect(ack["code"]).toBe("PERMISSION_DENIED");
        expect(markedTokens(ctx.store.get("actors", RANGER_ID))).toEqual([OGRE_TOKEN]);
      }
    });

    it("an unrelated flag of the same actor still goes through for the owner", async () => {
      const ack = await update(p1, { "flags.fusion.note": "ok" });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    });

    it("the Mestre may still write tokenMarks through doc:update", async () => {
      const ack = await update(gm, { "flags.fusion.tokenMarks": [] });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    });
  });
});
