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
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { stubSystem } from "@fusion/system-stub";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return (() => {
    const dir = join(
      tmpdir(),
      `fusion-scene-preload-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    return dir;
  })();
}

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  playerToken: string;
  playerId: string;
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "scene_preload_world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

  const { user: player } = await authService.createUser({
    name: "player-1",
    role: 1, // PLAYER
    password: "player-password-123",
  });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-password-123",
    ip: "127.0.0.1",
  });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: 0, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Scene Preload World",
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
      systemId: "stub",
      systemModule: stubSystem,
    },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    playerId: player.id,
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

/**
 * Wait for the next broadcast `op` envelope matching `predicate` on `socket`.
 */
function waitForOp(
  socket: ClientSocket,
  type: string,
  predicate: (env: Record<string, unknown>) => boolean = () => true,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for op: ${type}`)), 8000);
    function handler(env: Record<string, unknown>): void {
      if (env["type"] === type && predicate(env)) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    }
    socket.on("op", handler);
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

/** Resolve with the next `op` of `type` on `socket`, or reject after `ms` (for "never arrives" checks). */
function nextOpWithin(
  socket: ClientSocket,
  type: string,
  ms: number,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off("op", handler);
      resolve(null);
    }, ms);
    function handler(env: Record<string, unknown>): void {
      if (env["type"] === type) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    }
    socket.on("op", handler);
  });
}

describe("scene:preload — the GM asks every client to warm a scene's art without switching", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player)]);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  async function createScene(name: string, background: string): Promise<string> {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name, grid: { type: "square", size: 100 }, active: false, background }],
    });
    expect(ack["ok"]).toBe(true);
    return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }

  it("broadcasts the scene id and background to the player, with no seq and no scene switch", async () => {
    const sceneId = await createScene("Off-air map", "/assets/off-air-map.png");
    const playerGot = waitForOp(player, "scene:preload");
    const noSwitch = nextOpWithin(player, "world:activeScene", 400);

    const ack = await sendOp(gm, "scene:preload", { sceneId });
    expect(ack["ok"]).toBe(true);

    const env = await playerGot;
    expect(env["payload"]).toEqual({ sceneId, background: "/assets/off-air-map.png" });
    // Ephemeral: it must not consume a seq, or every client would see a hole in the stream.
    expect(env["seq"]).toBeUndefined();
    expect(await noSwitch).toBeNull();
  });

  it("refuses a player", async () => {
    const sceneId = await createScene("Another map", "/assets/another.png");
    const ack = await sendOp(player, "scene:preload", { sceneId });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("answers NOT_FOUND for a scene that does not exist", async () => {
    const ack = await sendOp(gm, "scene:preload", { sceneId: "nopenopenopenope" });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("NOT_FOUND");
  });
});
