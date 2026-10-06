/**
 * companion-set-active.test.ts — `companion:setActive` over the real socket
 * (BHR-F4-10, DC-07, D-B09, REQ-PET-120..121).
 *
 * Rule written here (spec 52 / DC-07), not read from any pack: a master with two animal companions has
 * EXACTLY ONE active (`system.companion.active`); swapping is decided on the server, never by the client.
 * The inactive one stays an actor with no token in the scene: the server swaps the active one's token for
 * the new one in the same square, and refuses while the previous active is mounted (MountState).
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
import { PROTOCOL_VERSION, readMountState } from "@fusion/shared";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

const MASTER = "masterActor00001";
const BEAR = "bearActor0000001";
const ANTELOPE = "antelopeActor001";
const PLAIN = "plainFamiliar001";
const OTHER_MASTER = "otherMasterAct01";
const MASTER_TOKEN = "masterToken00001";
const BEAR_TOKEN = "bearToken0000001";
const ANTELOPE_TOKEN = "antelopeToken001";
const SCENE_ID = "sceneCompanion01";
const SCENE_2 = "sceneCompanion02";

const CELL = 100;
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
    `fusion-compactive-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-compactive-world";
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
  const companion = (active?: boolean): Rec => ({
    companionKind: "animalCompanion",
    masterActorId: MASTER,
    companion: { typeSlug: "x", ...(active === undefined ? {} : { active }) },
  });
  actor(MASTER, "Bhrotto", "character", { default: 2, [p1.id]: 3 });
  actor(OTHER_MASTER, "Outro", "character", { default: 2, [p2.id]: 3 });
  actor(BEAR, "Urso", "familiar", { default: 0, [p1.id]: 3 }, companion(true));
  actor(ANTELOPE, "Antilope", "familiar", { default: 0, [p1.id]: 3 }, companion(false));
  actor(PLAIN, "Familiar", "familiar", { default: 2, [p1.id]: 3 }, { companionKind: "familiar" });

  const token = (id: string, actorId: string, i: number, j: number, extra: Rec = {}): Rec => ({
    _id: id,
    name: null,
    actorId,
    hidden: false,
    x: i * CELL,
    y: j * CELL,
    ...extra,
  });
  store.create(
    "scenes",
    {
      _id: SCENE_ID,
      name: "Cena",
      active: true,
      grid: { type: "square", size: CELL, distance: 5, units: "ft" },
      tokens: [token(MASTER_TOKEN, MASTER, 4, 5), token(BEAR_TOKEN, BEAR, 5, 5, { elevation: 10 })],
    },
    author,
  );

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Companion World", systemId: "stub" },
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

/** Connects and resolves with the join sync envelope (resync:full) the server sends first. */
function connectWithSync(
  port: number,
  worldId: string,
  token: string,
): Promise<{ socket: ClientSocket; sync: Rec }> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    socket.once("op", (env: Rec) => resolve({ socket, sync: env }));
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

/** The next `doc:update` of `documentType` this socket receives. */
function nextUpdate(socket: ClientSocket, documentType: string): Promise<Rec[]> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Rec): void => {
      if (envelope["type"] !== "doc:update") return;
      const payload = envelope["payload"] as { documentType?: string; documents?: Rec[] };
      if (payload.documentType !== documentType) return;
      socket.off("op", handler);
      resolve(payload.documents ?? []);
    };
    socket.on("op", handler);
    setTimeout(() => {
      socket.off("op", handler);
      reject(new Error(`no ${documentType} doc:update`));
    }, 3000);
  });
}

describe("companion:setActive (BHR-F4-10)", () => {
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

  const activeOf = (id: string): unknown =>
    ((ctx.store.get("actors", id)["system"] as Rec)["companion"] as Rec)["active"];
  const tokens = (sceneId = SCENE_ID): Rec[] =>
    ctx.store.getRaw("scenes", sceneId)["tokens"] as Rec[];
  const set = (id: string) => ({ companionActorId: id });

  it("the owner swaps the active one: exactly one is active, in the store and for every client", async () => {
    const heard = nextUpdate(p1, "Actor");
    const ack = await sendOp(p1, "companion:setActive", set(ANTELOPE));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(activeOf(ANTELOPE)).toBe(true);
    expect(activeOf(BEAR)).toBe(false);
    const docs = await heard;
    const ids = docs.map((d) => d["_id"]).sort();
    expect(ids).toEqual([ANTELOPE, BEAR].sort());
  });

  // The owner must SEE the inactive companion (its sheet stays readable, DC-07): at join and after a swap.
  it("the owner (not privileged) gets the INACTIVE companion in the join snapshot, flag included", async () => {
    const { socket, sync } = await connectWithSync(ctx.port, ctx.worldId, ctx.p1Token);
    try {
      expect(sync["type"]).toBe("resync:full");
      const snapshot = (sync["payload"] as Rec)["snapshot"] as Rec;
      const actors = ((snapshot["documents"] as Record<string, Rec[]>)["Actor"] ?? []) as Rec[];
      const ante = actors.find((a) => a["_id"] === ANTELOPE);
      expect(ante, "the inactive companion is in the owner snapshot").toBeDefined();
      expect(((ante?.["system"] as Rec)["companion"] as Rec)["active"]).toBe(false);
      expect(actors.some((a) => a["_id"] === BEAR)).toBe(true);
    } finally {
      socket.disconnect();
    }
  });

  it("after the swap the owner hears BOTH companions with their new flags (the GM swaps)", async () => {
    const heard = nextUpdate(p1, "Actor");
    const ack = await sendOp(gm, "companion:setActive", set(ANTELOPE));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const docs = await heard;
    const flag = (id: string): unknown => {
      const d = docs.find((x) => x["_id"] === id);
      return ((d?.["system"] as Rec | undefined)?.["companion"] as Rec | undefined)?.["active"];
    };
    expect(flag(ANTELOPE)).toBe(true);
    expect(flag(BEAR)).toBe(false);
  });

  it("a player with no ownership of the companions does not get them pushed as owner data", async () => {
    // Guard against the fixture hiding a bug: p2 owns nothing of this master. What p2 is owed is the
    // world's own read rule; this only pins that the swap does not hand p2 a write path.
    const ack = await sendOp(p2, "companion:setActive", set(ANTELOPE));
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });

  // "Exactly one active, always" (DC-07): the GM's doc:update that turns one on turns the other off in the
  // SAME write and the same broadcast.
  it("a GM doc:update that switches a companion on switches the other of that master off, in one broadcast", async () => {
    const heard = nextUpdate(p1, "Actor");
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: ANTELOPE,
          diff: { "system.companion.active": true },
          expectedVersion: (ctx.store.get("actors", ANTELOPE)["_stats"] as { version: number })
            .version,
        },
      ],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(activeOf(ANTELOPE)).toBe(true);
    expect(activeOf(BEAR)).toBe(false);
    const docs = await heard;
    expect(docs.map((d) => d["_id"]).sort()).toEqual([ANTELOPE, BEAR].sort());
  });

  it("the GM doc:update does not touch a companion of ANOTHER master, nor when it switches one OFF", async () => {
    ctx.store.create(
      "actors",
      {
        _id: "foreignComp00002",
        name: "Alheio",
        type: "familiar",
        ownership: { default: 2 },
        system: {
          companionKind: "animalCompanion",
          masterActorId: OTHER_MASTER,
          companion: { typeSlug: "x", active: true },
        },
      },
      { userId: "system" },
    );
    const off = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: BEAR,
          diff: { "system.companion.active": false },
          expectedVersion: (ctx.store.get("actors", BEAR)["_stats"] as { version: number }).version,
        },
      ],
    });
    expect(off["ok"], JSON.stringify(off)).toBe(true);
    expect(activeOf(BEAR)).toBe(false);
    expect(activeOf(ANTELOPE)).toBe(false);
    expect(activeOf("foreignComp00002")).toBe(true);
    const on = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: ANTELOPE,
          diff: { "system.companion.active": true },
          expectedVersion: (ctx.store.get("actors", ANTELOPE)["_stats"] as { version: number })
            .version,
        },
      ],
    });
    expect(on["ok"], JSON.stringify(on)).toBe(true);
    expect(activeOf("foreignComp00002")).toBe(true);
  });

  it("swapping back and forth keeps exactly one active", async () => {
    await sendOp(p1, "companion:setActive", set(ANTELOPE));
    const back = await sendOp(p1, "companion:setActive", set(BEAR));
    expect(back["ok"], JSON.stringify(back)).toBe(true);
    expect(activeOf(BEAR)).toBe(true);
    expect(activeOf(ANTELOPE)).toBe(false);
  });

  it("choosing the one that is already active is a no-op that still answers ok", async () => {
    const ack = await sendOp(p1, "companion:setActive", set(BEAR));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(activeOf(BEAR)).toBe(true);
    expect(activeOf(ANTELOPE)).toBe(false);
  });

  it("two companions both marked active (forged by the GM) end with exactly one", async () => {
    ctx.store.update("actors", ANTELOPE, { system: { companion: { active: true } } });
    const ack = await sendOp(p1, "companion:setActive", set(ANTELOPE));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(activeOf(ANTELOPE)).toBe(true);
    expect(activeOf(BEAR)).toBe(false);
  });

  it("puts the new token where the previous active one stood and drops the old token", async () => {
    const heard = nextUpdate(p2, "Scene");
    const ack = await sendOp(p1, "companion:setActive", set(ANTELOPE));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const list = tokens();
    expect(list.some((t) => t["_id"] === BEAR_TOKEN)).toBe(false);
    const fresh = list.find((t) => t["actorId"] === ANTELOPE);
    expect(fresh).toBeDefined();
    expect(fresh).toMatchObject({ x: 5 * CELL, y: 5 * CELL, elevation: 10 });
    expect(fresh?.["_id"]).not.toBe(BEAR_TOKEN);
    expect(list.some((t) => t["_id"] === MASTER_TOKEN)).toBe(true);
    const scene = (await heard)[0];
    const seen = (scene?.["tokens"] as Rec[]).find((t) => t["actorId"] === ANTELOPE);
    expect(seen).toBeDefined();
  });

  it("keeps a legacy token (no actorId) in the scene row when swapping", async () => {
    const raw = ctx.store.getRaw("scenes", SCENE_ID);
    ctx.store.update("scenes", SCENE_ID, {
      tokens: [...(raw["tokens"] as Rec[]), { _id: "legacyToken00001", name: "F", x: 0, y: 0 }],
    });
    const ack = await sendOp(p1, "companion:setActive", set(ANTELOPE));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(tokens().some((t) => t["_id"] === "legacyToken00001")).toBe(true);
  });

  it("does not duplicate a token the GM already placed for the new active one", async () => {
    const raw = ctx.store.getRaw("scenes", SCENE_ID);
    const placed = { _id: ANTELOPE_TOKEN, name: null, actorId: ANTELOPE, x: 900, y: 900 };
    ctx.store.update("scenes", SCENE_ID, { tokens: [...(raw["tokens"] as Rec[]), placed] });
    const ack = await sendOp(p1, "companion:setActive", set(ANTELOPE));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const mine = tokens().filter((t) => t["actorId"] === ANTELOPE);
    expect(mine.map((t) => t["_id"])).toEqual([ANTELOPE_TOKEN]);
    expect(tokens().some((t) => t["_id"] === BEAR_TOKEN)).toBe(false);
  });

  it("swaps in every scene that holds the previous active one", async () => {
    ctx.store.create(
      "scenes",
      {
        _id: SCENE_2,
        name: "Outra",
        active: false,
        grid: { type: "square", size: CELL, distance: 5, units: "ft" },
        tokens: [{ _id: "bearTokenScene02", name: null, actorId: BEAR, x: 300, y: 200 }],
      },
      { userId: "system" },
    );
    const ack = await sendOp(p1, "companion:setActive", set(ANTELOPE));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(tokens(SCENE_2).map((t) => t["actorId"])).toEqual([ANTELOPE]);
    expect(tokens(SCENE_2)[0]).toMatchObject({ x: 300, y: 200 });
  });

  it("an actor with no token in any scene just flips the flags", async () => {
    ctx.store.update("scenes", SCENE_ID, { tokens: [tokens()[0]] });
    const ack = await sendOp(p1, "companion:setActive", set(ANTELOPE));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(tokens().map((t) => t["actorId"])).toEqual([MASTER]);
    expect(activeOf(ANTELOPE)).toBe(true);
  });

  it("refuses the swap while the active companion is mounted, with the reason, and changes nothing", async () => {
    const mounted = tokens().map((t) =>
      t["_id"] === BEAR_TOKEN
        ? { ...t, flags: { fusion: { mount: { riderTokenId: MASTER_TOKEN } } } }
        : t["_id"] === MASTER_TOKEN
          ? { ...t, flags: { fusion: { mount: { mountTokenId: BEAR_TOKEN } } } }
          : t,
    );
    ctx.store.update("scenes", SCENE_ID, { tokens: mounted });
    const ack = await sendOp(p1, "companion:setActive", set(ANTELOPE));
    expect(ack).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(String(ack["message"])).toMatch(/mounted/i);
    expect(activeOf(BEAR)).toBe(true);
    expect(activeOf(ANTELOPE)).toBe(false);
    expect(readMountState(tokens().find((t) => t["_id"] === BEAR_TOKEN))).toEqual({
      riderTokenId: MASTER_TOKEN,
    });
    expect(tokens().some((t) => t["actorId"] === ANTELOPE)).toBe(false);
  });

  it("a player who does not own the master gets PERMISSION_DENIED; the GM may", async () => {
    const denied = await sendOp(p2, "companion:setActive", set(ANTELOPE));
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(activeOf(ANTELOPE)).toBe(false);
    const ok = await sendOp(gm, "companion:setActive", set(ANTELOPE));
    expect(ok["ok"], JSON.stringify(ok)).toBe(true);
    expect(activeOf(ANTELOPE)).toBe(true);
  });

  it("refuses an actor that is not an animal companion, and an unknown one", async () => {
    expect(await sendOp(p1, "companion:setActive", set(PLAIN))).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(await sendOp(p1, "companion:setActive", set("nobodyActor00001"))).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await sendOp(p1, "companion:setActive", {})).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
  });

  it("a companion of ANOTHER master is not swapped with this master's active one", async () => {
    ctx.store.create(
      "actors",
      {
        _id: "foreignComp00001",
        name: "Alheio",
        type: "familiar",
        ownership: { default: 2 },
        system: {
          companionKind: "animalCompanion",
          masterActorId: OTHER_MASTER,
          companion: { typeSlug: "x", active: true },
        },
      },
      { userId: "system" },
    );
    const ack = await sendOp(p1, "companion:setActive", set(ANTELOPE));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(activeOf("foreignComp00001")).toBe(true);
  });
});
