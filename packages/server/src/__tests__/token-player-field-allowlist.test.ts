/**
 * What a PLAYER may write on a token (REQ-TOK-030a / REQ-TOK-032, mesa 21/10/2026).
 *
 * The client of a player sends exactly two things about a token: `{ actorId, x, y }` when it drops its own
 * character, and `{ x, y }` when it drags it. Everything else — light, vision, seenBy, disposition,
 * elevation, flags — is the Mestre's, so the owner path refuses it on update AND on create. An owner also
 * puts at most ONE token of the same actor on a scene, and a scene that is not on air does not exist for him.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import { boot } from "../boot.js";
import type { BootResult } from "../boot.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { DocumentStore } from "../documents/store.js";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors token-actor-validation.test.ts / embedded-item-actor.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-token-allowlist-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  store: DocumentStore;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  ownerToken: string;
  ownerUserId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "token_allowlist_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: owner } = await authService.createUser({
    name: "OwnerPlayer",
    role: Role.PLAYER,
    password: "owner-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const ownerLogin = await authService.login({
    userId: owner.id,
    password: "owner-pass",
    ip: "127.0.0.1",
  });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: await reserveFreePort(), host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Token Allowlist World",
      worldSystemId: "stub",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
    },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

  return {
    dataDir,
    fusionDb,
    store: new DocumentStore({ db: fusionDb.raw }),
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    ownerToken: ownerLogin.accessToken,
    ownerUserId: owner.id,
  };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.bootResult.shutdown();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(port: number, worldId: string, token: string): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth: { token, protocolVersion: PROTOCOL_VERSION },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 8000);
  });
}

const PLAYER_ONLY_UPDATES: Array<[string, Record<string, unknown>]> = [
  ["light", { light: { dim: 30, bright: 15 } }],
  ["vision", { vision: { enabled: true } }],
  ["seenBy", { seenBy: ["someone"] }],
  ["disposition", { disposition: 1 }],
  ["elevation", { elevation: 5 }],
  ["flags", { flags: { fusion: { note: "x" } } }],
  ["dotted flags", { "flags.fusion.note": "x" }],
  ["x with an extra field", { x: 7, elevation: 3 }],
];

const PLAYER_ONLY_DROP_FIELDS: Array<[string, Record<string, unknown>]> = [
  ["light", { light: { dim: 30, bright: 15 } }],
  ["vision", { vision: { enabled: true } }],
  ["seenBy", { seenBy: ["someone"] }],
  ["disposition", { disposition: 1 }],
  ["elevation", { elevation: 5 }],
  ["flags", { flags: { fusion: { note: "x" } } }],
];

describe("Token field allowlist for the owner path", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let pcActorId: string;
  let sceneId: string;
  let freshSceneId: string;
  let offAirSceneId: string;
  let tokenId: string;

  const tokenOf = (id: string, scene = sceneId): Record<string, unknown> | undefined =>
    (ctx.store.get("scenes", scene)["tokens"] as Array<Record<string, unknown>>).find(
      (t) => t["_id"] === id,
    );

  const tokenCount = (scene: string): number =>
    (ctx.store.get("scenes", scene)["tokens"] as unknown[]).length;

  const drop = (
    scene: string,
    ...tokens: Array<Record<string, unknown>>
  ): Promise<Record<string, unknown>> =>
    sendOp(player, "doc:create", {
      documentType: "Token",
      data: tokens,
      parent: { type: "Scene", id: scene },
    });

  const updateToken = (
    socket: ClientSocket,
    diff: Record<string, unknown>,
    scene = sceneId,
    id = tokenId,
  ): Promise<Record<string, unknown>> =>
    sendOp(socket, "doc:update", {
      documentType: "Token",
      updates: [{ _id: id, diff, embedded: { type: "Token", id: scene } }],
    });

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.ownerToken);
    gm.connect();
    player.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player)]);

    const actorsAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Tobias",
          type: "character",
          system: {},
          ownership: { default: 0, [ctx.ownerUserId]: 3 },
        },
      ],
    });
    pcActorId = (actorsAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const scenesAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [
        { name: "No ar", tokens: [] },
        { name: "Vazia", tokens: [] },
        { name: "Fora do ar", tokens: [] },
      ],
    });
    const scenes = (scenesAck["result"] as { documents: Array<{ _id: string }> }).documents;
    sceneId = scenes[0]!._id;
    freshSceneId = scenes[1]!._id;
    offAirSceneId = scenes[2]!._id;
    expect((await sendOp(gm, "world:activeScene", { sceneId }))["ok"]).toBe(true);

    // The GM seeds the token the player drags.
    const tokenAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ actorId: pcActorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"], JSON.stringify(tokenAck)).toBe(true);
    tokenId = (tokenAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  it("the owner drags the token with { x, y } — the only update his client sends", async () => {
    const ack = await updateToken(player, { x: 140, y: 70 });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(tokenOf(tokenId)?.["x"]).toBe(140);
    expect(tokenOf(tokenId)?.["y"]).toBe(70);
  });

  it("the owner may turn the token (rotation, BHR-F5-03)", async () => {
    const ack = await updateToken(player, { rotation: 90 });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(tokenOf(tokenId)?.["rotation"]).toBe(90);
  });

  for (const [label, diff] of PLAYER_ONLY_UPDATES) {
    it(`the owner is refused an update that writes ${label}`, async () => {
      const before = JSON.stringify(tokenOf(tokenId));
      const ack = await updateToken(player, diff);
      expect(ack["ok"], JSON.stringify(ack)).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
      expect(JSON.stringify(tokenOf(tokenId))).toBe(before);
    });
  }

  it("the Mestre keeps writing elevation", async () => {
    const ack = await updateToken(gm, { elevation: 5 });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(tokenOf(tokenId)?.["elevation"]).toBe(5);
  });

  for (const [label, extra] of PLAYER_ONLY_DROP_FIELDS) {
    it(`the owner is refused a drop that carries ${label}`, async () => {
      const ack = await drop(sceneId, { actorId: pcActorId, x: 10, y: 10, ...extra });
      expect(ack["ok"], JSON.stringify(ack)).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });
  }

  it("the owner drops a second token of the same actor on the scene: refused (one per scene)", async () => {
    // The GM's seed already put one on this scene; the player may not add another.
    const ack = await drop(sceneId, { actorId: pcActorId, x: 10, y: 10 });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(tokenCount(sceneId)).toBe(1);
  });

  it("a batch with two tokens of the same actor is refused as a whole; a single drop is accepted", async () => {
    expect((await sendOp(gm, "world:activeScene", { sceneId: freshSceneId }))["ok"]).toBe(true);
    const batch = await drop(
      freshSceneId,
      { actorId: pcActorId, x: 0, y: 0 },
      { actorId: pcActorId, x: 70, y: 0 },
    );
    expect(batch["ok"]).toBe(false);
    expect(tokenCount(freshSceneId)).toBe(0);

    const single = await drop(freshSceneId, { actorId: pcActorId, x: 0, y: 0 });
    expect(single["ok"], JSON.stringify(single)).toBe(true);
    expect(tokenCount(freshSceneId)).toBe(1);
    expect((await sendOp(gm, "world:activeScene", { sceneId }))["ok"]).toBe(true);
  });

  it("a scene that is not on air does not exist for the owner: create and update are refused", async () => {
    const seed = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ actorId: pcActorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: offAirSceneId },
    });
    expect(seed["ok"], JSON.stringify(seed)).toBe(true);
    const offTokenId = (seed["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const create = await drop(offAirSceneId, { actorId: pcActorId, x: 10, y: 10 });
    expect(create["ok"]).toBe(false);

    const update = await updateToken(player, { x: 999, y: 999 }, offAirSceneId, offTokenId);
    expect(update["ok"]).toBe(false);
    expect(tokenOf(offTokenId, offAirSceneId)?.["x"]).toBe(0);
    expect(tokenCount(offAirSceneId)).toBe(1);
  });
});
