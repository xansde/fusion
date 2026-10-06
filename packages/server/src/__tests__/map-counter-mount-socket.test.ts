/**
 * BHR-F5-05 — MAP shared between rider and mount (D-B03, REQ-CBT-070..071, REQ-BHR-180).
 *
 * PF2e rule written here: the multiple attack penalty counts attacks of ONE creature: the 2nd
 * attack of the turn takes -5 (agile -4), the 3rd and later -10 (agile -8). D-B03 makes a mounted
 * rider and its mount ONE counter (the Bhrotto Strikes, then the antelope Strikes: the antelope's
 * attack is the 2nd of the group, -5). Dismounted, each creature counts apart again, and what
 * each already attacked in the turn stays with it.
 *
 * Real sockets (port from helpers/ports.ts). The mount link is `flags.fusion.mount` on the two
 * tokens of the scene (written by BHR-F5-02); the test writes the flag straight into the scene row.
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
import type { MapCounter } from "../combat/map-counter.js";

interface Ack {
  ok: boolean;
  result: { combat: { _id: string; combatants: { _id: string; tokenId: string }[] } };
}

const WORLD_ID = "test-map-mount-world";
const HERO = "actorHeroAAAAAAA1";
const ANTELOPE = "actorAntelopeAA1";
const OTHER = "actorOtherAAAAAA1";
const SCENE = "sceneMapMount0001";

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
    `fusion-map-mount-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
    worldInfo: { id: WORLD_ID, title: "Map Mount World", systemId: "stub" },
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

function seedActor(
  db: FusionDatabase,
  id: string,
  name: string,
  system: Record<string, unknown> = {},
): void {
  const now = Date.now();
  const actor = { _id: id, name, type: "npc", system };
  db.raw
    .prepare(
      `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, JSON.stringify(actor), name, "npc", now, now);
}

function seedScene(db: FusionDatabase, doc: Record<string, unknown>): void {
  const now = Date.now();
  db.raw
    .prepare(
      `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, ?, ?)`,
    )
    .run(doc["_id"], JSON.stringify(doc), doc["name"], now, now);
}

/** Scene with the hero token and the antelope token, linked by `flags.fusion.mount` or not. */
function sceneDoc(mounted: boolean, oneSided = false): Record<string, unknown> {
  const flagsFor = (mount: Record<string, string>): Record<string, unknown> =>
    mounted ? { flags: { fusion: { mount } } } : {};
  return {
    _id: SCENE,
    name: "Map",
    active: true,
    tokens: [
      {
        _id: "tokHero",
        name: "Hero",
        actorId: HERO,
        hidden: false,
        ...flagsFor({ mountTokenId: "tokAnt" }),
      },
      {
        _id: "tokAnt",
        name: "Antelope",
        actorId: ANTELOPE,
        hidden: false,
        ...(oneSided ? {} : flagsFor({ riderTokenId: "tokHero" })),
      },
    ],
  };
}

function writeScene(db: FusionDatabase, doc: Record<string, unknown>): void {
  db.raw.prepare(`UPDATE scenes SET data = ? WHERE id = ?`).run(JSON.stringify(doc), SCENE);
}

describe("BHR-F5-05 — MAP compartilhado entre cavaleiro e montaria", { timeout: 30000 }, () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let counter: MapCounter;

  beforeEach(async () => {
    ctx = await buildCtx();
    gm = await connect(ctx.port, ctx.gmToken);
    const c = ctx.socketManager.mapCounterFor(WORLD_ID);
    if (!c) throw new Error("no counter");
    counter = c;
  });

  afterEach(async () => {
    gm.disconnect();
    await ctx.socketManager.close();
    await ctx.fastify.close();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  /** Hero (init 20) and Other (10) in a started combat; the antelope joins the combat only when asked. */
  async function startCombat(opts: { mounted: boolean; antelopeActs?: boolean }): Promise<{
    combatId: string;
    heroId: string;
    antId: string | undefined;
  }> {
    seedActor(ctx.fusionDb, HERO, "Hero");
    seedActor(ctx.fusionDb, OTHER, "Other");
    seedActor(ctx.fusionDb, ANTELOPE, "Antelope", {
      companionKind: "animalCompanion",
      masterActorId: HERO,
    });
    seedScene(ctx.fusionDb, sceneDoc(opts.mounted));
    const created = await sendOp(gm, "combat:create", { sceneId: SCENE });
    const combatId = created.result.combat._id;
    const add = (tokenId: string, actorId: string, initiative: number): Promise<Ack> =>
      sendOp(gm, "combat:addCombatant", { combatId, tokenId, actorId, initiative });
    await add("tokHero", HERO, 20);
    if (opts.antelopeActs) await add("tokAnt", ANTELOPE, 15);
    await add("tokOther", OTHER, 10);
    const begun = await sendOp(gm, "combat:beginCombat", { combatId });
    expect(begun.ok, JSON.stringify(begun)).toBe(true);
    const list = begun.result.combat.combatants;
    return {
      combatId,
      heroId: list.find((c) => c.tokenId === "tokHero")?._id ?? "",
      antId: list.find((c) => c.tokenId === "tokAnt")?._id,
    };
  }

  const strikeBy = (
    speaker: { speakerTokenId: string } | { speakerActorId: string },
  ): Promise<Ack> =>
    sendOp(gm, "chat:send", {
      content: "/r 1d20+5",
      worldId: WORLD_ID,
      rollMode: "public",
      ...speaker,
      flags: { checkContext: { kind: "attack", mapIndex: 0 } },
    });

  const published = (combatId: string): unknown => {
    const row = ctx.fusionDb.raw.prepare(`SELECT data FROM combats WHERE id = ?`).get(combatId) as {
      data: string;
    };
    return (JSON.parse(row.data) as Record<string, unknown>)["attackCount"];
  };

  it("montado, no turno do dono: golpe do Bhrotto e depois do antilope = indice 1 (-5) no antilope", async () => {
    const { combatId, heroId } = await startCombat({ mounted: true });
    expect(counter.getMapPenalty(combatId, heroId, false)).toBe(0);

    expect((await strikeBy({ speakerTokenId: "tokHero" })).ok).toBe(true);
    // The antelope reads the GROUP count through the published payload (REQ-BHR-180).
    expect(published(combatId)).toEqual({
      combatantId: heroId,
      round: 1,
      count: 1,
      byActor: { [ANTELOPE]: 1 },
    });
    // PF2e: the 2nd attack of the group takes -5 (agile -4).
    expect(counter.getMinionAttackCount(combatId, heroId, ANTELOPE)).toBe(1);
    expect(counter.getMapPenalty(combatId, heroId, false)).toBe(-5);
    expect(counter.getMapPenalty(combatId, heroId, true)).toBe(-4);

    expect((await strikeBy({ speakerActorId: ANTELOPE })).ok).toBe(true);
    expect(published(combatId)).toEqual({
      combatantId: heroId,
      round: 1,
      count: 2,
      byActor: { [ANTELOPE]: 2 },
    });
    // The 3rd attack of the group, by either, takes -10 (agile -8).
    expect(counter.getMapPenalty(combatId, heroId, false)).toBe(-10);
    expect(counter.getMapPenalty(combatId, heroId, true)).toBe(-8);
  });

  it("montado, na ordem inversa: o antilope golpeia primeiro e o Bhrotto leva -5", async () => {
    const { combatId, heroId } = await startCombat({ mounted: true });
    expect((await strikeBy({ speakerActorId: ANTELOPE })).ok).toBe(true);
    expect(counter.getAttackCount(combatId, heroId)).toBe(1);
    expect(counter.getMapPenalty(combatId, heroId, false)).toBe(-5);
    expect(published(combatId)).toEqual({
      combatantId: heroId,
      round: 1,
      count: 1,
      byActor: { [ANTELOPE]: 1 },
    });
  });

  it("montado, montaria com turno proprio: o golpe do cavaleiro no turno dela e o 2o do grupo", async () => {
    const { combatId, heroId, antId } = await startCombat({ mounted: true, antelopeActs: true });
    if (!antId) throw new Error("antelope is not a combatant");
    await sendOp(gm, "combat:nextTurn", { combatId }); // hero -> antelope
    expect((await strikeBy({ speakerTokenId: "tokAnt" })).ok).toBe(true);
    expect((await strikeBy({ speakerTokenId: "tokHero" })).ok).toBe(true);
    // One group: the rider's Strike on the mount's turn is the 2nd attack of the group.
    expect(counter.getAttackCount(combatId, antId)).toBe(2);
    expect(counter.getAttackCount(combatId, heroId)).toBe(2);
    expect(counter.getMapPenalty(combatId, heroId, false)).toBe(-10);
    // The hero's sheet is not the acting one: it reads `byActor` for its own actor.
    expect(published(combatId)).toEqual({
      combatantId: antId,
      round: 1,
      count: 2,
      byActor: { [HERO]: 2 },
    });
  });

  it("desmontado: cada um com seu contador (antilope 0 depois do golpe do Bhrotto)", async () => {
    const { combatId, heroId } = await startCombat({ mounted: false });
    expect((await strikeBy({ speakerTokenId: "tokHero" })).ok).toBe(true);
    expect(counter.getMinionAttackCount(combatId, heroId, ANTELOPE)).toBe(0);
    expect(published(combatId)).toEqual({ combatantId: heroId, round: 1, count: 1 });
    expect((await strikeBy({ speakerActorId: ANTELOPE })).ok).toBe(true);
    expect(counter.getMinionAttackCount(combatId, heroId, ANTELOPE)).toBe(1);
    expect(counter.getAttackCount(combatId, heroId)).toBe(1);
  });

  // PF2e remaster: the multiple attack penalty never goes DOWN inside a turn. The attacks that counted for the
  // mounted group keep counting for each of the two after the dismount; new attacks add apart from there (I-4).
  it("desmontar: cada um fica com a contagem do grupo naquele momento e os ataques novos somam separados", async () => {
    const { combatId, heroId } = await startCombat({ mounted: true });
    expect((await strikeBy({ speakerTokenId: "tokHero" })).ok).toBe(true);
    expect((await strikeBy({ speakerActorId: ANTELOPE })).ok).toBe(true);
    expect(counter.getAttackCount(combatId, heroId)).toBe(2); // shared group

    writeScene(ctx.fusionDb, sceneDoc(false)); // dismount: BHR-F5-02 clears the flag on both tokens

    // The group had 2 attacks: each keeps 2, so each one's next attack is the 3rd (-10), never back to -5.
    expect(counter.getAttackCount(combatId, heroId)).toBe(2);
    expect(counter.getMinionAttackCount(combatId, heroId, ANTELOPE)).toBe(2);
    expect(counter.getMapPenalty(combatId, heroId, false)).toBe(-10);

    // From now on they count apart: the hero's next Strike does not move the antelope.
    expect((await strikeBy({ speakerTokenId: "tokHero" })).ok).toBe(true);
    expect(counter.getAttackCount(combatId, heroId)).toBe(3);
    expect(counter.getMinionAttackCount(combatId, heroId, ANTELOPE)).toBe(2);
    expect(published(combatId)).toEqual({
      combatantId: heroId,
      round: 1,
      count: 3,
      byActor: { [ANTELOPE]: 2 },
    });
  });

  it("ao desmontar o payload publicado mostra a contagem do grupo para os dois", async () => {
    const { combatId, heroId } = await startCombat({ mounted: true });
    expect((await strikeBy({ speakerTokenId: "tokHero" })).ok).toBe(true);
    expect((await strikeBy({ speakerActorId: ANTELOPE })).ok).toBe(true);
    expect(published(combatId)).toMatchObject({ count: 2, byActor: { [ANTELOPE]: 2 } });

    writeScene(ctx.fusionDb, sceneDoc(false)); // what mount:dismount leaves on the scene
    counter.republishScene(SCENE); // what the mount handler calls right after writing it
    // Both sheets keep reading the 2 attacks the group made: the penalty does not drop mid-turn.
    expect(published(combatId)).toEqual({
      combatantId: heroId,
      round: 1,
      count: 2,
      byActor: { [ANTELOPE]: 2 },
    });
  });

  it("montar no meio do turno junta o que cada um ja tinha contado", async () => {
    const { combatId, heroId } = await startCombat({ mounted: false });
    expect((await strikeBy({ speakerTokenId: "tokHero" })).ok).toBe(true);
    expect((await strikeBy({ speakerActorId: ANTELOPE })).ok).toBe(true);
    writeScene(ctx.fusionDb, sceneDoc(true));
    expect(counter.getAttackCount(combatId, heroId)).toBe(2);
    expect(counter.getMapPenalty(combatId, heroId, false)).toBe(-10);
  });

  it("turnStart zera o grupo inteiro (cavaleiro e montaria)", async () => {
    const { combatId, heroId } = await startCombat({ mounted: true });
    expect((await strikeBy({ speakerTokenId: "tokHero" })).ok).toBe(true);
    expect((await strikeBy({ speakerActorId: ANTELOPE })).ok).toBe(true);
    await sendOp(gm, "combat:nextTurn", { combatId }); // -> Other
    expect(counter.getAttackCount(combatId, heroId)).toBe(2);
    await sendOp(gm, "combat:nextTurn", { combatId }); // -> hero again
    expect(counter.getAttackCount(combatId, heroId)).toBe(0);
    expect(counter.getMinionAttackCount(combatId, heroId, ANTELOPE)).toBe(0);
    expect(counter.getMapPenalty(combatId, heroId, false)).toBe(0);
  });

  it("marca de montaria so de um lado (a montaria nao aponta de volta) nao junta contadores", async () => {
    const { combatId, heroId } = await startCombat({ mounted: false });
    writeScene(ctx.fusionDb, sceneDoc(true, true));
    expect((await strikeBy({ speakerTokenId: "tokHero" })).ok).toBe(true);
    expect(counter.getMinionAttackCount(combatId, heroId, ANTELOPE)).toBe(0);
    expect(published(combatId)).toEqual({ combatantId: heroId, round: 1, count: 1 });
  });
});
