/**
 * BHR-F3-04 — the MAP counter, wired end to end through SocketManager.
 *
 * Real sockets: combat built with combat:* ops, attacks sent as chat:send, the
 * count read from the world's MapCounter. PF2e rule written here: attack 1 takes
 * 0, attack 2 takes -5, attack 3+ takes -10 (agile: 0, -4, -8); the count
 * restarts when the combatant's turn starts.
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
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

interface Ack {
  ok: boolean;
  result: { combat: { _id: string; combatants: { _id: string; tokenId: string }[] } };
}

const WORLD_ID = "test-map-counter-world";

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  gmToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = join(
    tmpdir(),
    `fusion-map-socket-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, WORLD_ID);
  const { user: gm, password } = await authService.bootstrapGm();
  const login = await authService.login({ userId: gm.id, password, ip: "127.0.0.1" });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: WORLD_ID, title: "Map Counter World", systemId: "stub" },
  });
  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });
  socketManager.registerWorldNamespace({
    worldId: WORLD_ID,
    db: fusionDb.raw,
    secret,
    authService,
  });
  await fastify.listen({ port: await reserveFreePort(), host: "127.0.0.1" });
  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port: listeningPort(fastify),
    gmToken: login.accessToken,
  };
}

function connect(port: number, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${WORLD_ID}`, {
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

function sendOp(socket: ClientSocket, type: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve, reject) => {
    socket.emit(
      "op",
      { type, ts: Date.now(), payload, requestId: Math.random().toString(36).slice(2) },
      (ack: Ack) => resolve(ack),
    );
    setTimeout(() => reject(new Error(`ack timeout: ${type}`)), 5000);
  });
}

function seedActor(db: FusionDatabase, id: string, name: string): void {
  const now = Date.now();
  const actor = { _id: id, name, type: "npc", system: { derived: { ac: { total: 15 } } } };
  db.raw
    .prepare(
      `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, JSON.stringify(actor), name, "npc", now, now);
}

function seedCompanion(db: FusionDatabase, id: string, name: string, masterId: string): void {
  const now = Date.now();
  const actor = {
    _id: id,
    name,
    type: "familiar",
    system: { companionKind: "animalCompanion", masterActorId: masterId },
  };
  db.raw
    .prepare(
      `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, JSON.stringify(actor), name, "familiar", now, now);
}

describe("BHR-F3-04 — o servidor conta o ataque múltiplo pelo socket", { timeout: 30000 }, () => {
  let ctx: Ctx;
  let gm: ClientSocket;

  beforeEach(async () => {
    ctx = await buildCtx();
    gm = await connect(ctx.port, ctx.gmToken);
  });

  afterEach(async () => {
    gm.disconnect();
    await ctx.socketManager.close();
    await ctx.fastify.close();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("três golpes: 0/-5/-10 (ágil 0/-4/-8); turnStart zera", async () => {
    seedActor(ctx.fusionDb, "actorHeroAAAAAAA1", "Hero");
    seedActor(ctx.fusionDb, "actorFoeAAAAAAAA1", "Foe");
    seedActor(ctx.fusionDb, "actorOtherAAAAAA1", "Other");
    const now = Date.now();
    const scene = {
      _id: "sceneMapCounter01",
      name: "Map",
      active: true,
      tokens: [{ _id: "tokFoe", name: "Foe", actorId: "actorFoeAAAAAAAA1", hidden: false }],
    };
    ctx.fusionDb.raw
      .prepare(
        `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(scene._id, JSON.stringify(scene), scene.name, now, now);

    const created = await sendOp(gm, "combat:create", { sceneId: scene._id });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    const combatId = created.result.combat._id;
    await sendOp(gm, "combat:addCombatant", {
      combatId,
      tokenId: "tokHero",
      actorId: "actorHeroAAAAAAA1",
      initiative: 20,
    });
    await sendOp(gm, "combat:addCombatant", {
      combatId,
      tokenId: "tokOther",
      actorId: "actorOtherAAAAAA1",
      initiative: 10,
    });
    const begun = await sendOp(gm, "combat:beginCombat", { combatId });
    expect(begun.ok, JSON.stringify(begun)).toBe(true);
    const heroId = (
      begun["result"]["combat"]["combatants"] as { _id: string; tokenId: string }[]
    ).find((c) => c.tokenId === "tokHero")!._id;

    const counter = ctx.socketManager.mapCounterFor(WORLD_ID);
    expect(counter).toBeDefined();
    if (!counter) return;

    const standard: number[] = [];
    const agile: number[] = [];
    for (let i = 0; i < 3; i++) {
      standard.push(counter.getMapPenalty(combatId, heroId, false));
      agile.push(counter.getMapPenalty(combatId, heroId, true));
      const ack = await sendOp(gm, "chat:send", {
        content: "/r 1d20+5",
        worldId: WORLD_ID,
        rollMode: "public",
        speakerTokenId: "tokHero",
        target: { tokenId: "tokFoe" },
      });
      expect(ack.ok, JSON.stringify(ack)).toBe(true);
    }
    expect(standard).toEqual([0, -5, -10]);
    expect(agile).toEqual([0, -4, -8]);
    expect(counter.getAttackCount(combatId, heroId)).toBe(3);

    await sendOp(gm, "combat:nextTurn", { combatId });
    await sendOp(gm, "combat:nextTurn", { combatId });
    expect(counter.getAttackCount(combatId, heroId)).toBe(0);
  });

  it("I-7: o servidor publica a contagem no estado do combate (golpe sem alvo conta) e ela vale so no turno", async () => {
    seedActor(ctx.fusionDb, "actorHeroAAAAAAA1", "Hero");
    seedActor(ctx.fusionDb, "actorOtherAAAAAA1", "Other");
    const now = Date.now();
    const scene = { _id: "sceneMapCounter02", name: "Map", active: true, tokens: [] };
    ctx.fusionDb.raw
      .prepare(
        `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(scene._id, JSON.stringify(scene), scene.name, now, now);
    const created = await sendOp(gm, "combat:create", { sceneId: scene._id });
    const combatId = created.result.combat._id;
    await sendOp(gm, "combat:addCombatant", {
      combatId,
      tokenId: "tokHero",
      actorId: "actorHeroAAAAAAA1",
      initiative: 20,
    });
    await sendOp(gm, "combat:addCombatant", {
      combatId,
      tokenId: "tokOther",
      actorId: "actorOtherAAAAAA1",
      initiative: 10,
    });
    const begun = await sendOp(gm, "combat:beginCombat", { combatId });
    const heroId = (
      begun["result"]["combat"]["combatants"] as { _id: string; tokenId: string }[]
    ).find((c) => c.tokenId === "tokHero")!._id;

    const strike = (): Promise<Ack> =>
      sendOp(gm, "chat:send", {
        content: "/r 1d20+5",
        worldId: WORLD_ID,
        rollMode: "public",
        speakerTokenId: "tokHero",
        flags: { checkContext: { kind: "attack", mapIndex: 0 } },
      });
    expect((await strike()).ok).toBe(true);
    expect((await strike()).ok).toBe(true);

    const attackCountOf = (): unknown => {
      const row = ctx.fusionDb.raw
        .prepare(`SELECT data FROM combats WHERE id = ?`)
        .get(combatId) as { data: string };
      return (JSON.parse(row.data) as Record<string, unknown>)["attackCount"];
    };
    // PF2e: the second Strike of the turn is the one that takes -5; two were made.
    expect(attackCountOf()).toEqual({ combatantId: heroId, round: 1, count: 2 });
  });

  it("I-3 (onda 7): o companheiro animal age no turno do dono e tem MAP próprio, separado do dono", async () => {
    seedActor(ctx.fusionDb, "actorHeroAAAAAAA1", "Hero");
    seedActor(ctx.fusionDb, "actorOtherAAAAAA1", "Other");
    seedCompanion(ctx.fusionDb, "actorBearAAAAAAA1", "Urso", "actorHeroAAAAAAA1");
    seedCompanion(ctx.fusionDb, "actorBearOtherAA1", "Urso alheio", "actorOtherAAAAAA1");
    const now = Date.now();
    const scene = { _id: "sceneMapCounter03", name: "Map", active: true, tokens: [] };
    ctx.fusionDb.raw
      .prepare(
        `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(scene._id, JSON.stringify(scene), scene.name, now, now);
    const created = await sendOp(gm, "combat:create", { sceneId: scene._id });
    const combatId = created.result.combat._id;
    await sendOp(gm, "combat:addCombatant", {
      combatId,
      tokenId: "tokHero",
      actorId: "actorHeroAAAAAAA1",
      initiative: 20,
    });
    await sendOp(gm, "combat:addCombatant", {
      combatId,
      tokenId: "tokOther",
      actorId: "actorOtherAAAAAA1",
      initiative: 10,
    });
    const begun = await sendOp(gm, "combat:beginCombat", { combatId });
    const heroId = (
      begun["result"]["combat"]["combatants"] as { _id: string; tokenId: string }[]
    ).find((c) => c.tokenId === "tokHero")!._id;
    const counter = ctx.socketManager.mapCounterFor(WORLD_ID);
    if (!counter) throw new Error("no counter");

    const strike = (speakerActorId: string): Promise<Ack> =>
      sendOp(gm, "chat:send", {
        content: "/r 1d20+5",
        worldId: WORLD_ID,
        rollMode: "public",
        speakerActorId,
        flags: { checkContext: { kind: "attack", mapIndex: 0 } },
      });
    const attackCountOf = (): unknown => {
      const row = ctx.fusionDb.raw
        .prepare(`SELECT data FROM combats WHERE id = ?`)
        .get(combatId) as { data: string };
      return (JSON.parse(row.data) as Record<string, unknown>)["attackCount"];
    };

    // The owner Strikes once; the bear Strikes twice in the same turn.
    expect((await strike("actorHeroAAAAAAA1")).ok).toBe(true);
    expect((await strike("actorBearAAAAAAA1")).ok).toBe(true);
    // PF2e: the bear's SECOND attack of the turn is the one that takes -5 (MAP is per creature).
    expect(counter.getMinionAttackCount(combatId, heroId, "actorBearAAAAAAA1")).toBe(1);
    expect((await strike("actorBearAAAAAAA1")).ok).toBe(true);

    expect(counter.getMinionAttackCount(combatId, heroId, "actorBearAAAAAAA1")).toBe(2);
    expect(counter.getAttackCount(combatId, heroId)).toBe(1); // the owner keeps their own count
    expect(attackCountOf()).toEqual({
      combatantId: heroId,
      round: 1,
      count: 1,
      byActor: { actorBearAAAAAAA1: 2 },
    });

    // The companion of someone who is NOT acting changes nothing.
    await strike("actorBearOtherAA1");
    expect(counter.getMinionAttackCount(combatId, heroId, "actorBearOtherAA1")).toBe(0);

    // The owner's next turn starts everyone from zero.
    await sendOp(gm, "combat:nextTurn", { combatId });
    await sendOp(gm, "combat:nextTurn", { combatId });
    expect(counter.getAttackCount(combatId, heroId)).toBe(0);
    expect(counter.getMinionAttackCount(combatId, heroId, "actorBearAAAAAAA1")).toBe(0);
  });
});
