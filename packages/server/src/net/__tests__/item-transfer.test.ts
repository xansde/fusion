/**
 * `item:transfer` (REQ-SYS-165) - giving an item (or part of a stack) to another actor, over the REAL socket transport.
 *
 * What is asserted is the core's contract (permission, atomicity, merge, containers, stale reads), never a game rule,
 * so the world runs on a rule-free fake system - same discipline as `item-consume.test.ts`.
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

import { openDatabase, applyMigrations } from "../../db/index.js";
import type { FusionDatabase } from "../../db/index.js";
import { AuthService } from "../../auth/service.js";
import { Role } from "../../auth/user-store.js";
import { loadOrCreateSecret } from "../../auth/crypto.js";
import { registerAuthRoutes } from "../../auth/routes.js";
import { SocketManager } from "../socket-manager.js";
import { reserveFreePort } from "../../__tests__/helpers/ports.js";
import { PROTOCOL_VERSION, OwnershipLevel, defaultStats } from "@fusion/shared";
import { defineSystem } from "@fusion/system-api";

const A = "giverActor000000"; // owned by player 1
const B = "takerActor000000"; // owned by player 2
const C = "npcActor00000000"; // nobody sees it
const D = "watchedActor0000"; // player 1 can SEE it (OBSERVER), owns nothing

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  p1Token: string;
  p2Token: string;
}

function item(
  id: string,
  type: string,
  name: string,
  system: Record<string, unknown> = {},
): Record<string, unknown> {
  return { _id: id, name, type, system: { quantity: 1, ...system } };
}

const ROPE = "rope00000000000";
const SWORD = "sword0000000000";
const BAG = "bag000000000000";
const BAG_ROPE = "bagRope00000000";
const POTION = "potion000000000";

function seed(db: FusionDatabase, p1: string, p2: string): void {
  const now = Date.now();
  const actor = (
    id: string,
    name: string,
    type: string,
    ownership: Record<string, number>,
    items: Record<string, unknown>[],
  ) => ({
    _id: id,
    name,
    type,
    ownership,
    system: {},
    items,
    _stats: defaultStats(),
  });
  const docs = [
    actor(A, "Doadora", "character", { default: OwnershipLevel.NONE, [p1]: OwnershipLevel.OWNER }, [
      item(ROPE, "equipment", "Corda", { bulk: 0.1, quantity: 5 }),
      item(SWORD, "weapon", "Espada", {
        bulk: 1,
        equipped: { value: true, carryType: "held", handsHeld: 1, invested: true },
      }),
      item(BAG, "container", "Mochila", { bulk: 0.1, capacity: 4 }),
      item(BAG_ROPE, "equipment", "Corda de Mochila", { bulk: 0.1, quantity: 2, containerId: BAG }),
      item(POTION, "consumable", "Pocao", {
        quantity: 3,
        uses: { value: 1, max: 1, autoDestroy: true },
      }),
    ]),
    actor(
      B,
      "Receptor",
      "character",
      { default: OwnershipLevel.NONE, [p2]: OwnershipLevel.OWNER },
      [item("takerRope000000", "equipment", "Corda", { bulk: 0.1, quantity: 1 })],
    ),
    actor(C, "Monstro", "npc", { default: OwnershipLevel.NONE }, []),
    actor(D, "Vigiada", "npc", { default: OwnershipLevel.NONE, [p1]: OwnershipLevel.OBSERVER }, []),
  ];
  for (const d of docs) {
    db.raw
      .prepare(
        `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(d._id, JSON.stringify(d), d.name, d.type, now, now);
  }
}

async function build(): Promise<Ctx> {
  const dataDir = join(
    tmpdir(),
    `fusion-item-transfer-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-item-transfer-world";
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
  seed(fusionDb, p1.id, p2.id);
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

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Test", systemId: "test-system" },
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
    systemId: "test-system",
    systemModule: defineSystem(
      {
        id: "test-system",
        title: "Test System",
        version: "0.1.0",
        engineCompat: ">=0.1.0 <2.0.0",
        authors: [{ name: "Test Author" }],
        documentTypes: {},
        languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
      },
      () => {},
    ),
  });
  const port = await reserveFreePort();
  await fastify.listen({ port, host: "127.0.0.1" });
  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
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

function connect(ctx: Ctx, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    socket.once("connect", () => {
      socket.once("op", () => resolve(socket));
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 15_000);
  });
}

function send(socket: ClientSocket, payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.emit(
      "op",
      {
        type: "item:transfer",
        ts: Date.now(),
        payload,
        requestId: Math.random().toString(36).slice(2),
      },
      (ack: unknown) => {
        if (!ack || typeof ack !== "object") reject(new Error("No ack"));
        else resolve(ack as Record<string, unknown>);
      },
    );
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

interface Raw {
  items: Record<string, unknown>[];
  _stats: { version: number };
}
function read(ctx: Ctx, id: string): Raw {
  const row = ctx.fusionDb.raw.prepare(`SELECT data FROM actors WHERE id = ?`).get(id) as {
    data: string;
  };
  return JSON.parse(row.data) as Raw;
}
const qty = (it: Record<string, unknown> | undefined): number | undefined =>
  (it?.["system"] as { quantity?: number } | undefined)?.quantity;
const byId = (raw: Raw, id: string) => raw.items.find((i) => i["_id"] === id);
const byName = (raw: Raw, name: string) => raw.items.filter((i) => i["name"] === name);

function give(ctx: Ctx, extra: Record<string, unknown>) {
  const version = read(ctx, (extra["fromActorId"] as string | undefined) ?? A)._stats.version;
  return {
    fromActorId: A,
    toActorId: B,
    itemId: ROPE,
    quantity: 1,
    expectedVersion: version,
    ...extra,
  };
}

describe("item:transfer", () => {
  let ctx: Ctx;
  let p1: ClientSocket;
  let p2: ClientSocket;
  let gm: ClientSocket;

  beforeEach(async () => {
    ctx = await build();
    p1 = await connect(ctx, ctx.p1Token);
    p2 = await connect(ctx, ctx.p2Token);
    gm = await connect(ctx, ctx.gmToken);
  });
  afterEach(async () => {
    p1.close();
    p2.close();
    gm.close();
    await teardown(ctx);
  });

  it("the owner gives part of a stack: the sender keeps the rest, the receiver's identical stack grows", async () => {
    const ack = await send(p1, give(ctx, { quantity: 2 }));
    expect(ack["ok"]).toBe(true);
    expect(ack["result"]).toMatchObject({
      moved: 2,
      itemName: "Corda",
      toActorId: B,
      merged: true,
    });
    expect(qty(byId(read(ctx, A), ROPE))).toBe(3);
    const receiver = read(ctx, B);
    expect(byName(receiver, "Corda")).toHaveLength(1);
    expect(qty(byName(receiver, "Corda")[0])).toBe(3);
  });

  it("a different item arrives as a new stack, out of use, with a fresh id", async () => {
    const ack = await send(p1, give(ctx, { itemId: POTION, quantity: 1 }));
    expect(ack["result"]).toMatchObject({ moved: 1, merged: false });
    expect(qty(byId(read(ctx, A), POTION))).toBe(2);
    const arrived = byName(read(ctx, B), "Pocao")[0];
    expect(arrived?.["_id"]).not.toBe(POTION);
    expect(qty(arrived)).toBe(1);
  });

  it("giving the whole stack removes it from the sender", async () => {
    await send(p1, give(ctx, { itemId: POTION, quantity: 3 }));
    expect(byId(read(ctx, A), POTION)).toBeUndefined();
    expect(qty(byName(read(ctx, B), "Pocao")[0])).toBe(3);
  });

  it("a worn or held item arrives in the pack: not in use, not invested", async () => {
    await send(p1, give(ctx, { itemId: SWORD, quantity: 1 }));
    expect(byId(read(ctx, A), SWORD)).toBeUndefined();
    const arrived = byName(read(ctx, B), "Espada")[0];
    expect((arrived?.["system"] as { equipped: unknown }).equipped).toEqual({
      value: false,
      carryType: "carried",
      handsHeld: 0,
      invested: false,
    });
  });

  it("a container goes WITH its contents and keeps them inside the new one", async () => {
    const ack = await send(p1, give(ctx, { itemId: BAG, quantity: 1 }));
    expect(ack["ok"]).toBe(true);
    expect(byId(read(ctx, A), BAG)).toBeUndefined();
    expect(byId(read(ctx, A), BAG_ROPE)).toBeUndefined();
    const receiver = read(ctx, B);
    const bag = byName(receiver, "Mochila")[0];
    const inside = byName(receiver, "Corda de Mochila")[0];
    expect((inside?.["system"] as { containerId: string }).containerId).toBe(bag?.["_id"]);
    expect(qty(inside)).toBe(2);
  });

  it("refuses more than the sender has, the same actor and an unknown item, writing nothing", async () => {
    const tooMany = await send(p1, give(ctx, { quantity: 6 }));
    expect(tooMany).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(await send(p1, give(ctx, { toActorId: A }))).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(await send(p1, give(ctx, { itemId: "ghost" }))).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(qty(byId(read(ctx, A), ROPE))).toBe(5);
  });

  it("refuses a stale read (CONFLICT) and writes nothing", async () => {
    const stale = give(ctx, {});
    await send(p1, { ...stale, quantity: 1 });
    const ack = await send(p1, { ...stale, quantity: 1 });
    expect(ack).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(qty(byId(read(ctx, A), ROPE))).toBe(4);
  });

  it("a player who does not own the sender is refused", async () => {
    const ack = await send(p2, give(ctx, {}));
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(qty(byId(read(ctx, A), ROPE))).toBe(5);
  });

  it("a player cannot give to an actor nobody plays and the player cannot see; can to one they can see", async () => {
    expect(await send(p1, give(ctx, { toActorId: C }))).toMatchObject({
      ok: false,
      code: "PERMISSION_DENIED",
    });
    expect((await send(p1, give(ctx, { toActorId: D }))).ok).toBe(true);
  });

  it("the Mestre gives from and to anyone", async () => {
    const ack = await send(gm, give(ctx, { toActorId: C, quantity: 5 }));
    expect(ack["ok"]).toBe(true);
    expect(byId(read(ctx, A), ROPE)).toBeUndefined();
    expect(qty(byName(read(ctx, C), "Corda")[0])).toBe(5);
  });

  it("rejects a malformed payload", async () => {
    expect(await send(p1, { fromActorId: A })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(await send(p1, give(ctx, { quantity: 0 }))).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
  });
});
