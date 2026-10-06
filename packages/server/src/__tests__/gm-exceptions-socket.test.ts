/**
 * gm-exceptions-socket.test.ts — `system.build.gmExceptions` is Mestre-only on `doc:update`
 * (BHR-F7-02, D-B12, DC-10, REQ-BHR-226..229). The wallet (`system.currency`) stays player-writable.
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

const OWN_ID = "ownActor00000001";
const OTHER_ID = "otherActor000001";

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
    `fusion-gm-exceptions-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-gm-exceptions-world";
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
  // p1 owns OWN_ID; p2 owns nothing and only observes OTHER_ID.
  store.create(
    "actors",
    { _id: OWN_ID, name: "Heroi", type: "character", ownership: { default: 2, [p1.id]: 3 } },
    author,
  );
  store.create(
    "actors",
    { _id: OTHER_ID, name: "Outro", type: "character", ownership: { default: 2 } },
    author,
  );

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "GM Exceptions World", systemId: "stub" },
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

describe("system.build.gmExceptions is Mestre-only (BHR-F7-02)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let p1: ClientSocket;

  beforeEach(async () => {
    ctx = await buildCtx();
    [gm, p1] = await Promise.all([
      connect(ctx.port, ctx.worldId, ctx.gmToken),
      connect(ctx.port, ctx.worldId, ctx.p1Token),
    ]);
  }, 15_000);

  afterEach(async () => {
    gm.disconnect();
    p1.disconnect();
    await teardown(ctx);
  });

  const exceptions = { "noble-bloom": { grantedBy: "gm" } };
  const update = (socket: ClientSocket, actorId: string, diff: Record<string, unknown>) => {
    const stats = ctx.store.get("actors", actorId)["_stats"] as { version: number };
    return sendOp(socket, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff, expectedVersion: stats.version }],
    });
  };
  const stored = (actorId: string, path: string[]): unknown =>
    path.reduce<unknown>(
      (cur, k) =>
        cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined,
      ctx.store.get("actors", actorId),
    );

  it("the owner keeps editing their own wallet (regression, DC-10)", async () => {
    const ack = await update(p1, OWN_ID, { "system.currency": { gp: 15 } });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(stored(OWN_ID, ["system", "currency", "gp"])).toBe(15);
  });

  it("the owner cannot write gmExceptions by dot path, by nested object, or by replacing system/build", async () => {
    const diffs: Record<string, unknown>[] = [
      { "system.build.gmExceptions": exceptions },
      { "system.build.gmExceptions.noble-bloom": { grantedBy: "gm" } },
      { system: { build: { gmExceptions: exceptions } } },
      { "system.build": { gmExceptions: exceptions } },
      { system: { build: null } },
      { system: null },
    ];
    for (const diff of diffs) {
      const ack = await update(p1, OWN_ID, diff);
      expect(ack, JSON.stringify(diff)).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    }
    expect(stored(OWN_ID, ["system", "build", "gmExceptions"])).toBeUndefined();
  });

  it("the owner cannot release Noble Bloom for themselves (the real shape: a list of feat ids)", async () => {
    const nobleBloomSourceId = "B7VfoCspflTNfmde";
    const ack = await update(p1, OWN_ID, { "system.build.gmExceptions": [nobleBloomSourceId] });
    expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(stored(OWN_ID, ["system", "build", "gmExceptions"])).toBeUndefined();
    // The Mestre releases it, and the list lands as written.
    const granted = await update(gm, OWN_ID, { "system.build.gmExceptions": [nobleBloomSourceId] });
    expect(granted["ok"], JSON.stringify(granted)).toBe(true);
    expect(stored(OWN_ID, ["system", "build", "gmExceptions"])).toEqual([nobleBloomSourceId]);
    // Once released the owner still cannot revoke or extend it.
    const revoke = await update(p1, OWN_ID, { "system.build.gmExceptions": [] });
    expect(revoke).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(stored(OWN_ID, ["system", "build", "gmExceptions"])).toEqual([nobleBloomSourceId]);
  });

  it("the owner cannot write them on an actor they do not own either", async () => {
    const ack = await update(p1, OTHER_ID, { "system.build.gmExceptions": exceptions });
    expect(ack["ok"]).toBe(false);
    expect(stored(OTHER_ID, ["system", "build", "gmExceptions"])).toBeUndefined();
  });

  it("a diff that does not touch gmExceptions is unaffected (sibling build fields)", async () => {
    const ack = await update(p1, OWN_ID, { "system.build.plan": { level: 3 } });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(stored(OWN_ID, ["system", "build", "plan", "level"])).toBe(3);
  });

  it("the Mestre writes gmExceptions, by dot path and by object", async () => {
    const a = await update(gm, OWN_ID, { "system.build.gmExceptions": exceptions });
    expect(a["ok"], JSON.stringify(a)).toBe(true);
    expect(stored(OWN_ID, ["system", "build", "gmExceptions", "noble-bloom", "grantedBy"])).toBe(
      "gm",
    );
    const b = await update(gm, OTHER_ID, { system: { build: { gmExceptions: exceptions } } });
    expect(b["ok"], JSON.stringify(b)).toBe(true);
  });

  it("a player cannot write an unlinked token's actorDelta (existing gate, covers gmExceptions in it)", async () => {
    // Players are refused `actorDelta` outright on token updates (REQ-DOC-034): nothing to add here beyond
    // the unit-level guarantee in validateTokenUpdateActorDelta.
    const { validateTokenUpdateActorDelta } = await import("../tokens/tokenValidation.js");
    expect(validateTokenUpdateActorDelta(1, false, true)).toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
});
