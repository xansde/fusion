/**
 * mount-follow-socket.test.ts — the rider travels with the mount (BHR-F5-03, D-B03,
 * REQ-TOK-116..118, REQ-CNV-106..107, REQ-BHR-178), over the real socket.
 *
 * Rule written here (spec 52 2.5), not read from any pack: a mounted pair is ONE body on the map.
 * Moving the mount moves the rider by the same displacement in the SAME write (one broadcast);
 * a player cannot move a mounted rider (the only movement action of a rider is Mount/Dismount);
 * the GM moving the rider takes him off the mount. While a combat is running in the scene, the
 * server stamps `flags.fusion.mount.movedTurn` on the MOUNT token (consumed by BHR-F5-04).
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

/** Every Scene `doc:update` this socket hears until `stop()` is called. */
function listenScene(socket: ClientSocket): {
  updates: Record<string, unknown>[];
  stop: () => void;
} {
  const updates: Record<string, unknown>[] = [];
  const handler = (envelope: Record<string, unknown>): void => {
    if (envelope["type"] !== "doc:update") return;
    const payload = envelope["payload"] as { documentType?: string; documents?: unknown[] };
    if (payload.documentType !== "Scene") return;
    for (const d of payload.documents ?? []) updates.push(d as Record<string, unknown>);
  };
  socket.on("op", handler);
  return { updates, stop: () => socket.off("op", handler) };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Move = (
  socket: ClientSocket,
  id: string,
  to: { x: number; y: number },
) => Promise<Record<string, unknown>>;

describe("the rider travels with the mount (BHR-F5-03)", () => {
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
    // The Small Leshy (5,5) rides the Medium antelope (6,5).
    const ack = await sendOp(p1, "mount:mount", { riderTokenId: LESHY, mountTokenId: ANTELOPE });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    await wait(200); // let the mount broadcast reach every client before a test starts counting
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
  const rawIds = (): unknown[] =>
    (ctx.store.getRaw("scenes", SCENE_ID)["tokens"] as Record<string, unknown>[]).map(
      (t) => t["_id"],
    );
  const rawFlag = (id: string): Record<string, unknown> => {
    const raw = (ctx.store.getRaw("scenes", SCENE_ID)["tokens"] as Record<string, unknown>[]).find(
      (t) => t["_id"] === id,
    );
    const fusion = ((raw?.["flags"] ?? {}) as Record<string, unknown>)["fusion"] ?? {};
    return ((fusion as Record<string, unknown>)["mount"] ?? {}) as Record<string, unknown>;
  };

  const docUpdate = (socket: ClientSocket, id: string, diff: Record<string, unknown>) =>
    sendOp(socket, "doc:update", {
      documentType: "Token",
      updates: [{ _id: id, diff, embedded: { type: "Token", id: SCENE_ID } }],
    });
  const tokenMove = (socket: ClientSocket, id: string, to: { x: number; y: number }) =>
    sendOp(socket, "token:move", { sceneId: SCENE_ID, tokenId: id, ...to });

  const paths: Array<[string, Move]> = [
    ["doc:update", (s, id, to) => docUpdate(s, id, { x: to.x, y: to.y })],
    ["token:move", (s, id, to) => tokenMove(s, id, to)],
  ];

  describe.each(paths)("through %s", (_name, move) => {
    it("moving the mount moves the rider by the same displacement, in ONE broadcast", async () => {
      const heard = listenScene(p2);
      const ack = await move(p1, ANTELOPE, at(6, 8)); // 3 cells down
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      await wait(150);
      heard.stop();

      expect(tokenOf(ANTELOPE)).toMatchObject(at(6, 8));
      expect(tokenOf(LESHY)).toMatchObject(at(5, 8)); // kept its square beside the mount
      expect(heard.updates).toHaveLength(1);
      const seen = new Map(
        (heard.updates[0]!["tokens"] as Record<string, unknown>[]).map((t) => [t["_id"], t]),
      );
      expect(seen.get(ANTELOPE)).toMatchObject(at(6, 8));
      expect(seen.get(LESHY)).toMatchObject(at(5, 8));
      // The pair is still mounted.
      expect(readMountState(tokenOf(LESHY))).toEqual({ mountTokenId: ANTELOPE });
      expect(readMountState(tokenOf(ANTELOPE))).toEqual({ riderTokenId: LESHY });
    });

    it("keeps every other token of the scene, a legacy one (no actor) included", async () => {
      const raw = ctx.store.getRaw("scenes", SCENE_ID);
      ctx.store.update("scenes", SCENE_ID, {
        tokens: [
          ...(raw["tokens"] as Record<string, unknown>[]),
          { _id: "legacyToken00001", name: "Fantasma", x: 0, y: 0 },
        ],
      });
      const before = rawIds().length;
      const ack = await move(p1, ANTELOPE, at(8, 5));
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      expect(rawIds()).toHaveLength(before);
      expect(rawIds()).toContain("legacyToken00001");
      for (const id of [BEAR, FAR_ANTELOPE, OTHER_PC, STRANGER, BLOCKER]) {
        expect(rawIds()).toContain(id);
      }
    });

    it("a player cannot move a mounted rider: refused, nothing moves", async () => {
      const ack = await move(p1, LESHY, at(5, 8));
      expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
      expect(tokenOf(LESHY)).toMatchObject(at(5, 5));
      expect(tokenOf(ANTELOPE)).toMatchObject(at(6, 5));
      expect(readMountState(tokenOf(LESHY))).toEqual({ mountTokenId: ANTELOPE });
    });

    it("a player who does not own the mount cannot drag it, and the rider stays put", async () => {
      const ack = await move(p2, ANTELOPE, at(6, 8));
      expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
      expect(tokenOf(LESHY)).toMatchObject(at(5, 5));
      expect(tokenOf(ANTELOPE)).toMatchObject(at(6, 5));
    });

    it("the GM moving the rider takes him off the mount: flags cleared on both, the mount stays", async () => {
      const ack = await move(gm, LESHY, at(2, 2));
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      expect(tokenOf(LESHY)).toMatchObject(at(2, 2));
      expect(tokenOf(ANTELOPE)).toMatchObject(at(6, 5));
      expect(readMountState(tokenOf(LESHY))).toEqual({});
      expect(readMountState(tokenOf(ANTELOPE))).toEqual({});
      // Each one moves on its own again.
      const solo = await move(p1, LESHY, at(2, 3));
      expect(solo["ok"], JSON.stringify(solo)).toBe(true);
      expect(tokenOf(ANTELOPE)).toMatchObject(at(6, 5));
    });

    it("a dismounted pair moves separately, and a mount with no rider gets no flag", async () => {
      await sendOp(p1, "mount:dismount", { riderTokenId: LESHY, to: at(6, 4) });
      const ack = await move(p1, ANTELOPE, at(6, 8));
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      expect(tokenOf(LESHY)).toMatchObject(at(6, 4));
      expect(rawFlag(ANTELOPE)).toEqual({});
    });
  });

  it("a rider update that moves nothing (same square, rotation) is not a move: a player may rotate him", async () => {
    const ack = await docUpdate(p1, LESHY, { rotation: 90, x: 500, y: 500 });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(readMountState(tokenOf(LESHY))).toEqual({ mountTokenId: ANTELOPE });
    expect(tokenOf(LESHY)).toMatchObject({ rotation: 90, ...at(5, 5) });
  });

  it("a player cannot move the rider on a single axis either", async () => {
    for (const diff of [{ x: 900 }, { y: 900 }]) {
      const ack = await docUpdate(p1, LESHY, diff);
      expect(ack, JSON.stringify(diff)).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    }
    expect(tokenOf(LESHY)).toMatchObject(at(5, 5));
  });

  it("the GM dragging both tokens by the same displacement in one batch keeps them mounted", async () => {
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [
        { _id: ANTELOPE, diff: at(6, 8), embedded: { type: "Token", id: SCENE_ID } },
        { _id: LESHY, diff: at(5, 8), embedded: { type: "Token", id: SCENE_ID } },
      ],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(tokenOf(LESHY)).toMatchObject(at(5, 8));
    expect(tokenOf(ANTELOPE)).toMatchObject(at(6, 8));
    expect(readMountState(tokenOf(LESHY))).toEqual({ mountTokenId: ANTELOPE });
  });

  describe("movedTurn (contract for BHR-F5-04)", () => {
    const startCombat = (extra: Record<string, unknown> = {}) =>
      ctx.store.create(
        "combats",
        { sceneId: SCENE_ID, started: true, ended: false, round: 2, turnIndex: 3, ...extra },
        { userId: "gm" },
      );

    it("moving a mount that carries a rider during a combat stamps { combatId, round, turn } on the MOUNT, same write", async () => {
      const combat = startCombat();
      const heard = listenScene(p2);
      const ack = await docUpdate(p1, ANTELOPE, at(6, 7));
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      await wait(150);
      heard.stop();

      expect(rawFlag(ANTELOPE)).toEqual({
        riderTokenId: LESHY,
        movedTurn: { combatId: combat["_id"], round: 2, turn: 3 },
      });
      expect(rawFlag(LESHY)).toEqual({ mountTokenId: ANTELOPE });
      expect(heard.updates).toHaveLength(1);
      expect(readMountState(tokenOf(ANTELOPE)).riderTokenId).toBe(LESHY);
    });

    it("also through token:move, and it tracks the CURRENT round/turn on the next move", async () => {
      const combat = startCombat();
      await tokenMove(p1, ANTELOPE, at(6, 7));
      ctx.store.update("combats", combat["_id"] as string, { round: 3, turnIndex: 0 });
      await tokenMove(p1, ANTELOPE, at(6, 8));
      expect(rawFlag(ANTELOPE)["movedTurn"]).toEqual({
        combatId: combat["_id"],
        round: 3,
        turn: 0,
      });
    });

    it("outside combat nothing is stamped: no combat, an ended one, a not-started one, another scene's", async () => {
      await docUpdate(p1, ANTELOPE, at(6, 7));
      expect(rawFlag(ANTELOPE)).toEqual({ riderTokenId: LESHY });

      startCombat({ ended: true });
      startCombat({ started: false });
      startCombat({ sceneId: "otherScene000001" });
      await docUpdate(p1, ANTELOPE, at(6, 8));
      expect(rawFlag(ANTELOPE)).toEqual({ riderTokenId: LESHY });
    });

    it("a change that moves nothing is not stamped, and neither is a mount that lost its rider", async () => {
      startCombat();
      await docUpdate(p1, ANTELOPE, { rotation: 45 });
      expect(rawFlag(ANTELOPE)).toEqual({ riderTokenId: LESHY });
      await sendOp(p1, "mount:dismount", { riderTokenId: LESHY, to: at(6, 4) });
      await docUpdate(p1, ANTELOPE, at(6, 8));
      expect(rawFlag(ANTELOPE)).toEqual({});
    });

    it("dismounting clears the whole flag, movedTurn included", async () => {
      startCombat();
      await docUpdate(p1, ANTELOPE, at(6, 7));
      expect(rawFlag(ANTELOPE)["movedTurn"]).toBeDefined();
      const ack = await sendOp(p1, "mount:dismount", { riderTokenId: LESHY, to: at(6, 6) });
      expect(ack["ok"], JSON.stringify(ack)).toBe(true);
      expect(rawFlag(ANTELOPE)).toEqual({});
    });

    it("a player cannot forge movedTurn through doc:update, however it is spelled", async () => {
      for (const diff of [
        { "flags.fusion.mount.movedTurn": { combatId: "x", round: 1, turn: 0 } },
        {
          "flags.fusion.mount": {
            riderTokenId: LESHY,
            movedTurn: { combatId: "x", round: 9, turn: 9 },
          },
        },
        { flags: { fusion: { mount: { riderTokenId: LESHY, movedTurn: null } } } },
      ]) {
        const ack = await docUpdate(p1, ANTELOPE, diff);
        expect(ack, JSON.stringify(diff)).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
      }
      expect(rawFlag(ANTELOPE)).toEqual({ riderTokenId: LESHY });
    });

    it("a forged flag riding along a real move is refused as a whole", async () => {
      const ack = await docUpdate(p1, ANTELOPE, {
        ...at(6, 7),
        "flags.fusion.mount.movedTurn": { combatId: "x", round: 1, turn: 0 },
      });
      expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
      expect(tokenOf(ANTELOPE)).toMatchObject(at(6, 5));
    });
  });
});
