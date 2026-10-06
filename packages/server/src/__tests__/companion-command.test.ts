/**
 * companion-command.test.ts — `companion:command` over the real socket (L3 I4, BHR-F5-07, D-B10).
 *
 * Rule (PF2e remaster, Command an Animal): the owner commands the companion on THEIR turn, and the companion acts that
 * turn; the Support is one of its actions. The server is the authority of "commanded": it stamps `commandMark` on the
 * combat (combatant, round, companions), valid only for that combatant in that round, so a new turn is stale with no
 * reset write and a reopened sheet reads the same state. Out of combat there is nothing to stamp.
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
import { PROTOCOL_VERSION } from "@fusion/shared";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

const MASTER = "masterActor00001";
const BEAR = "bearActor0000001";
const PLAIN = "plainFamiliar001";
const OTHER_MASTER = "otherMasterAct01";
const MASTER_CMBT = "cmbtMaster000001";
const OTHER_CMBT = "cmbtOther0000001";

type Rec = Record<string, unknown>;

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
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = join(
    tmpdir(),
    `fusion-compcommand-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-compcommand-world";
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
  const login = (userId: string, password: string) =>
    authService.login({ userId, password, ip: "127.0.0.1" });
  const gmLogin = await login(gm.id, gmPw);
  const p1Login = await login(p1.id, "player1-pass");
  const p2Login = await login(p2.id, "player2-pass");

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const author = { userId: gm.id };
  const actor = (
    id: string,
    name: string,
    type: string,
    ownership: Record<string, number>,
    system: Rec = {},
  ) => store.create("actors", { _id: id, name, type, ownership, system }, author);
  actor(MASTER, "Bhrotto", "character", { default: 2, [p1.id]: 3 });
  actor(OTHER_MASTER, "Outro", "character", { default: 2, [p2.id]: 3 });
  actor(
    BEAR,
    "Urso",
    "familiar",
    { default: 0, [p1.id]: 3 },
    {
      companionKind: "animalCompanion",
      masterActorId: MASTER,
      companion: { typeSlug: "bear", active: true },
    },
  );
  actor(PLAIN, "Familiar", "familiar", { default: 2, [p1.id]: 3 }, { companionKind: "familiar" });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Command World", systemId: "stub" },
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
  return new Promise<Rec>((resolve, reject) => {
    socket.emit(
      "op",
      { type, ts: Date.now(), payload, requestId: Math.random().toString(36).slice(2) },
      (ack: unknown) => {
        if (!ack || typeof ack !== "object") reject(new Error("No ack"));
        else resolve(ack as Rec);
      },
    );
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

/** The next `combat:updated` diff this socket receives. */
function nextCombatDiff(socket: ClientSocket): Promise<Rec> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Rec): void => {
      if (envelope["type"] !== "combat:updated") return;
      socket.off("op", handler);
      resolve((envelope["payload"] as { diff: Rec }).diff);
    };
    socket.on("op", handler);
    setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("no combat:updated"));
    }, 3000);
  });
}

describe("companion:command (L3 I4)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let p1: ClientSocket;
  let p2: ClientSocket;
  let combatId: string;

  const combatant = (id: string, actorId: string): Rec => ({
    _id: id,
    name: id,
    img: "",
    initiative: null,
    initiativeStatistic: null,
    actorId,
    tokenId: `tok-${id}`,
  });
  const startCombat = (activeCombatantId: string): void => {
    const combat = ctx.store.create(
      "combats",
      {
        sceneId: "sceneCommand0001",
        started: true,
        ended: false,
        round: 2,
        turnIndex: activeCombatantId === MASTER_CMBT ? 0 : 1,
        activeCombatantId,
        combatants: [combatant(MASTER_CMBT, MASTER), combatant(OTHER_CMBT, OTHER_MASTER)],
      },
      { userId: "gm" },
    );
    combatId = combat["_id"] as string;
  };
  const markOf = (): unknown => ctx.store.get("combats", combatId)["commandMark"];

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

  it("on the owner turn the server stamps the mark and every client hears it", async () => {
    startCombat(MASTER_CMBT);
    const heard = nextCombatDiff(p2);
    const ack = await sendOp(p1, "companion:command", { companionActorId: BEAR });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect((ack["result"] as Rec)["marked"]).toBe(true);
    expect(markOf()).toEqual({ combatantId: MASTER_CMBT, round: 2, actorIds: [BEAR] });
    expect((await heard)["commandMark"]).toEqual({
      combatantId: MASTER_CMBT,
      round: 2,
      actorIds: [BEAR],
    });
  });

  it("a hidden owner combatant is not named to players by the mark; the GM still hears it", async () => {
    startCombat(MASTER_CMBT);
    const combatants = ctx.store.get("combats", combatId)["combatants"] as Rec[];
    ctx.store.update(
      "combats",
      combatId,
      {
        combatants: combatants.map((c) => (c["_id"] === MASTER_CMBT ? { ...c, hidden: true } : c)),
      },
      { userId: "gm" },
    );
    const player = nextCombatDiff(p2);
    const master = nextCombatDiff(gm);
    await sendOp(gm, "companion:command", { companionActorId: BEAR });
    expect((await master)["commandMark"]).toBeDefined();
    expect(JSON.stringify(await player)).not.toContain(MASTER_CMBT);
  });

  it("commanding twice in the same turn does not duplicate the companion", async () => {
    startCombat(MASTER_CMBT);
    await sendOp(p1, "companion:command", { companionActorId: BEAR });
    await sendOp(p1, "companion:command", { companionActorId: BEAR });
    expect(markOf()).toEqual({ combatantId: MASTER_CMBT, round: 2, actorIds: [BEAR] });
  });

  it("commanding again in the same turn is idempotent: ok, flagged, and nothing is broadcast again (N1)", async () => {
    startCombat(MASTER_CMBT);
    const first = await sendOp(p1, "companion:command", { companionActorId: BEAR });
    expect((first["result"] as Rec)["alreadyCommanded"]).toBeUndefined();
    let heardAgain = false;
    p2.on("op", (envelope: Rec) => {
      if (envelope["type"] === "combat:updated") heardAgain = true;
    });
    const second = await sendOp(p1, "companion:command", { companionActorId: BEAR });
    expect(second["ok"], JSON.stringify(second)).toBe(true);
    expect(second["result"]).toEqual({ marked: true, alreadyCommanded: true });
    await new Promise((r) => setTimeout(r, 200));
    expect(heardAgain).toBe(false);
    expect(markOf()).toEqual({ combatantId: MASTER_CMBT, round: 2, actorIds: [BEAR] });
  });

  it("is refused out of the owner turn, and nothing is stamped", async () => {
    startCombat(OTHER_CMBT);
    const ack = await sendOp(p1, "companion:command", { companionActorId: BEAR });
    expect(ack).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(markOf() ?? null).toBeNull();
  });

  it("a player who does not own the master gets PERMISSION_DENIED; the GM may", async () => {
    startCombat(MASTER_CMBT);
    expect(await sendOp(p2, "companion:command", { companionActorId: BEAR })).toMatchObject({
      ok: false,
      code: "PERMISSION_DENIED",
    });
    expect(markOf() ?? null).toBeNull();
    expect((await sendOp(gm, "companion:command", { companionActorId: BEAR }))["ok"]).toBe(true);
  });

  it("refuses an actor that is not an animal companion", async () => {
    startCombat(MASTER_CMBT);
    expect(await sendOp(p1, "companion:command", { companionActorId: PLAIN })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
  });

  it("outside a combat it answers ok with nothing marked", async () => {
    const ack = await sendOp(p1, "companion:command", { companionActorId: BEAR });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect((ack["result"] as Rec)["marked"]).toBe(false);
  });
});
