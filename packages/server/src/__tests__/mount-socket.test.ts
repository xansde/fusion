/**
 * mount-socket.test.ts — `mount:mount` / `mount:dismount` over the real socket
 * (BHR-F5-02, REQ-PET-123, REQ-BHR-174..176).
 *
 * The assertions follow the PF2e remaster rule written here, not any pack table:
 * to ride, a creature needs a mount adjacent to it and AT LEAST ONE SIZE LARGER
 * (Small Leshy + Medium antelope = ok; Small Leshy + Small bear = refused).
 * A player may only mount their own linked animal companion; the Mestre may
 * mount anything that satisfies the geometry.
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

const LESHY_ACTOR = "leshyActor000001";
const ANTELOPE_ACTOR = "antelopeActor001";
const BEAR_ACTOR = "bearActor0000001";
const OTHER_PC_ACTOR = "otherPcActor0001";
const OTHER_COMPANION_ACTOR = "otherCompActor01";
const STRANGER_ACTOR = "strangerActor001";
const LESHY = "leshyToken000001";
const ANTELOPE = "antelopeToken001";
const BEAR = "bearToken00000001";
const FAR_ANTELOPE = "farAntelopeToken";
const OTHER_PC = "otherPcToken00001";
const OTHER_COMPANION = "otherCompToken001";
const STRANGER = "strangerToken0001";
const BLOCKER = "blockerToken00001";
const SCENE_ID = "sceneMount000001";

const CELL = 100;

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

const at = (i: number, j: number) => ({ x: i * CELL, y: j * CELL });

async function buildCtx(): Promise<Ctx> {
  const dataDir = join(
    tmpdir(),
    `fusion-mount-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-mount-world";
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
    size: string,
    ownership: Record<string, number>,
    extra: Record<string, unknown> = {},
  ) =>
    store.create(
      "actors",
      {
        _id: id,
        name,
        type: "character",
        ownership,
        system: { traits: { size: { value: size } }, ...extra },
      },
      author,
    );
  const companion = (masterActorId: string, active?: boolean) => ({
    companionKind: "animalCompanion",
    masterActorId,
    companion: { typeSlug: "x", ...(active === undefined ? {} : { active }) },
  });
  // p1 owns the Small Leshy and its two companions; p2 owns another Small PC with a companion.
  actor(LESHY_ACTOR, "Leshy", "sm", { default: 2, [p1.id]: 3 });
  actor(ANTELOPE_ACTOR, "Antilope", "med", { default: 2, [p1.id]: 3 }, companion(LESHY_ACTOR));
  actor(BEAR_ACTOR, "Urso", "sm", { default: 2, [p1.id]: 3 }, companion(LESHY_ACTOR));
  actor(OTHER_PC_ACTOR, "Outro PJ", "sm", { default: 2, [p2.id]: 3 });
  actor(
    OTHER_COMPANION_ACTOR,
    "Companheiro alheio",
    "med",
    { default: 2, [p2.id]: 3 },
    companion(OTHER_PC_ACTOR),
  );
  actor(STRANGER_ACTOR, "Cavalo do mestre", "lg", { default: 2 });

  const token = (id: string, name: string, actorId: string, pos: { x: number; y: number }) => ({
    _id: id,
    name,
    actorId,
    hidden: false,
    ...pos,
  });
  store.create(
    "scenes",
    {
      _id: SCENE_ID,
      name: "Cena",
      active: true,
      grid: { type: "square", size: CELL, distance: 5, units: "ft" },
      tokens: [
        token(LESHY, "Leshy", LESHY_ACTOR, at(5, 5)),
        token(ANTELOPE, "Antilope", ANTELOPE_ACTOR, at(6, 5)),
        token(BEAR, "Urso", BEAR_ACTOR, at(4, 5)),
        token(FAR_ANTELOPE, "Antilope longe", ANTELOPE_ACTOR, at(9, 9)),
        token(OTHER_PC, "Outro PJ", OTHER_PC_ACTOR, at(5, 7)),
        token(OTHER_COMPANION, "Companheiro alheio", OTHER_COMPANION_ACTOR, at(5, 6)),
        token(STRANGER, "Cavalo", STRANGER_ACTOR, at(2, 5)),
        token(BLOCKER, "Bloqueio", OTHER_PC_ACTOR, at(7, 5)),
      ],
    },
    author,
  );

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Mount World", systemId: "stub" },
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

/** The next Scene `doc:update` this socket receives. */
function nextSceneUpdate(socket: ClientSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Record<string, unknown>): void => {
      if (envelope["type"] !== "doc:update") return;
      const payload = envelope["payload"] as { documentType?: string; documents?: unknown[] };
      if (payload.documentType !== "Scene") return;
      const doc = (payload.documents ?? [])[0];
      if (!doc) return;
      socket.off("op", handler);
      resolve(doc as Record<string, unknown>);
    };
    socket.on("op", handler);
    setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("no Scene doc:update"));
    }, 3000);
  });
}

describe("MountState over the socket (BHR-F5-02)", () => {
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

  const tokenOf = (id: string): Record<string, unknown> => {
    const scene = ctx.store.get("scenes", SCENE_ID);
    const found = (scene["tokens"] as Record<string, unknown>[]).find((t) => t["_id"] === id);
    if (!found) throw new Error(`token ${id} missing`);
    return found;
  };

  const mount = (rider: string, mountTok: string) => ({
    riderTokenId: rider,
    mountTokenId: mountTok,
  });

  it("Small Leshy mounts the adjacent Medium antelope: both tokens get the state and every client hears it", async () => {
    const heard = nextSceneUpdate(p2);
    const ack = await sendOp(p1, "mount:mount", mount(LESHY, ANTELOPE));
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    expect(readMountState(tokenOf(LESHY))).toEqual({ mountTokenId: ANTELOPE });
    expect(readMountState(tokenOf(ANTELOPE))).toEqual({ riderTokenId: LESHY });
    const doc = await heard;
    const seen = (doc["tokens"] as Record<string, unknown>[]).find((t) => t["_id"] === LESHY);
    expect(readMountState(seen)).toEqual({ mountTokenId: ANTELOPE });
  });

  it("REQ-TOK-002: mounting and dismounting keep a legacy token (no actorId) in the scene row", async () => {
    const raw = ctx.store.getRaw("scenes", SCENE_ID);
    const legacy = { _id: "legacyToken00001", name: "Fantasma", x: 0, y: 0 };
    ctx.store.update("scenes", SCENE_ID, {
      tokens: [...(raw["tokens"] as Record<string, unknown>[]), legacy],
    });
    const rawIds = (): unknown[] =>
      (ctx.store.getRaw("scenes", SCENE_ID)["tokens"] as Record<string, unknown>[]).map(
        (t) => t["_id"],
      );
    expect(rawIds()).toContain("legacyToken00001");

    const mounted = await sendOp(p1, "mount:mount", mount(LESHY, ANTELOPE));
    expect(mounted["ok"], JSON.stringify(mounted)).toBe(true);
    expect(rawIds()).toContain("legacyToken00001");

    const dismounted = await sendOp(p1, "mount:dismount", { riderTokenId: LESHY, to: at(6, 4) });
    expect(dismounted["ok"], JSON.stringify(dismounted)).toBe(true);
    expect(rawIds()).toContain("legacyToken00001");
  });

  it("refuses the same-size Small bear with the size as the reason", async () => {
    const ack = await sendOp(p1, "mount:mount", mount(LESHY, BEAR));
    expect(ack).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(String(ack["message"])).toMatch(/at least one size larger/);
    expect(readMountState(tokenOf(LESHY))).toEqual({});
  });

  it("refuses a mount that is not adjacent", async () => {
    const ack = await sendOp(p1, "mount:mount", mount(LESHY, FAR_ANTELOPE));
    expect(ack).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(String(ack["message"])).toMatch(/adjacent/);
  });

  it("refuses another player's companion as PERMISSION_DENIED, whoever asks", async () => {
    // p1 owns the Leshy but the companion at (5,6) is linked to p2's PC.
    const byP1 = await sendOp(p1, "mount:mount", mount(LESHY, OTHER_COMPANION));
    expect(byP1).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    // p2 owns that companion but not the Leshy that wants to ride it.
    const byP2 = await sendOp(p2, "mount:mount", mount(LESHY, OTHER_COMPANION));
    expect(byP2).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(readMountState(tokenOf(OTHER_COMPANION))).toEqual({});
  });

  it("a player cannot mount a creature that is not their linked companion; the GM can", async () => {
    // The Large horse stands next to the bear; it is nobody's linked companion.
    const denied = await sendOp(p1, "mount:mount", mount(BEAR, STRANGER));
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    const byGm = await sendOp(gm, "mount:mount", mount(BEAR, STRANGER));
    expect(byGm["ok"], JSON.stringify(byGm)).toBe(true);
    expect(readMountState(tokenOf(BEAR))).toEqual({ mountTokenId: STRANGER });
  });

  it("the GM is bound by the geometry too", async () => {
    const ack = await sendOp(gm, "mount:mount", mount(LESHY, BEAR));
    expect(ack).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });

  it("refuses a second rider on the same mount and a second mount for the same rider", async () => {
    expect((await sendOp(p1, "mount:mount", mount(LESHY, ANTELOPE)))["ok"]).toBe(true);
    const again = await sendOp(p1, "mount:mount", mount(LESHY, ANTELOPE));
    expect(again).toMatchObject({ ok: false, code: "CONFLICT" });
    const taken = await sendOp(gm, "mount:mount", mount(OTHER_PC, ANTELOPE));
    expect(taken).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("dismounts to an adjacent empty square, clearing both tokens and moving the rider", async () => {
    await sendOp(p1, "mount:mount", mount(LESHY, ANTELOPE));
    // (6,4) touches the antelope at (6,5) and is empty.
    const ack = await sendOp(p1, "mount:dismount", { riderTokenId: LESHY, to: at(6, 4) });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(readMountState(tokenOf(LESHY))).toEqual({});
    expect(readMountState(tokenOf(ANTELOPE))).toEqual({});
    expect(tokenOf(LESHY)).toMatchObject(at(6, 4));
    expect(tokenOf(LESHY)["flags"]).toEqual({ fusion: {} });
    expect(tokenOf(ANTELOPE)["flags"]).toEqual({ fusion: {} });
  });

  it("refuses to dismount onto an occupied square, onto the mount, or away from the mount", async () => {
    await sendOp(p1, "mount:mount", mount(LESHY, ANTELOPE));
    // (7,5) holds the blocker, (6,5) is the mount itself, (9,9) is not adjacent to the mount.
    for (const to of [at(7, 5), at(6, 5), at(9, 9)]) {
      const ack = await sendOp(p1, "mount:dismount", { riderTokenId: LESHY, to });
      expect(ack, JSON.stringify(to)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    }
    expect(readMountState(tokenOf(LESHY))).toEqual({ mountTokenId: ANTELOPE });
  });

  it("only the owner of the rider (or the GM) dismounts; a rider on foot cannot dismount", async () => {
    await sendOp(p1, "mount:mount", mount(LESHY, ANTELOPE));
    const stranger = await sendOp(p2, "mount:dismount", { riderTokenId: LESHY, to: at(6, 4) });
    expect(stranger).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    const byGm = await sendOp(gm, "mount:dismount", { riderTokenId: LESHY, to: at(6, 4) });
    expect(byGm["ok"], JSON.stringify(byGm)).toBe(true);
    const onFoot = await sendOp(gm, "mount:dismount", { riderTokenId: LESHY, to: at(5, 4) });
    expect(onFoot).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("an inactive companion cannot be mounted by its player", async () => {
    ctx.store.update(
      "actors",
      ANTELOPE_ACTOR,
      { system: { companion: { typeSlug: "x", active: false } } },
      { userId: "gm" },
    );
    const ack = await sendOp(p1, "mount:mount", mount(LESHY, ANTELOPE));
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });

  it("dismount with the mount token gone only clears the rider; a mount that does not point back is left alone", async () => {
    await sendOp(p1, "mount:mount", mount(LESHY, ANTELOPE));
    const scene = ctx.store.get("scenes", SCENE_ID);
    const tokens = (scene["tokens"] as Record<string, unknown>[]).filter(
      (t) => t["_id"] !== ANTELOPE,
    );
    ctx.store.update("scenes", SCENE_ID, { tokens }, { userId: "gm" });
    const ack = await sendOp(p1, "mount:dismount", { riderTokenId: LESHY, to: at(5, 4) });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(readMountState(tokenOf(LESHY))).toEqual({});
  });

  it("refuses a malformed payload and an unknown token", async () => {
    expect(await sendOp(p1, "mount:mount", { riderTokenId: LESHY })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(await sendOp(p1, "mount:mount", mount("ghost", ANTELOPE))).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});
