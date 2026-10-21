/**
 * The actor's previous image is remembered by the server on EVERY img change.
 *
 * Incident (mesa real, 18/10, Bhrotto): right after "Usar como token" set the
 * actor's `img` to the avatar PNG, a second write from the same player set it to
 * "" — the only writer of an empty `img` in the codebase is the sheet's
 * portrait "remove" button. The previous token art was gone with no way back.
 *
 * So the safeguard lives where every writer passes: the doc:update handler keeps
 * the image being replaced in `flags.fusion.imagemAnterior`, whoever replaced it
 * and with whatever (a new path, an empty string, null). Restoring is then just
 * writing it back to `img` — which in turn remembers the image it replaced, so
 * restore toggles instead of losing the newer image.
 *
 * Driven through the real socket handler (boot + socket.io), like
 * expected-version.test.ts, because what matters is the wire's behaviour.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
import { PROTOCOL_VERSION, readImagemAnterior, IMAGEM_ANTERIOR_FLAG_PATH } from "@fusion/shared";
import { reserveFreePort } from "./helpers/ports.js";
import { DocumentStore } from "../documents/store.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors doc-update-routing.test.ts / condition-toggle.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-actor-img-history-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerToken: string;
  playerUserId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "actor_img_history_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  // Plain PLAYER — the "dono do próprio Actor" case the task calls out as the
  // most common one at the table, and the one no pre-existing test covered.
  const { user: player } = await authService.createUser({
    name: "ImgHistoryPlayer",
    role: Role.PLAYER,
    password: "player-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  const port = await reserveFreePort();
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Actor Img History World",
      worldSystemId: "stub",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: `http://127.0.0.1:${String(port)}`,
    },
  });

  return {
    dataDir,
    fusionDb,
    store: new DocumentStore({ db: fusionDb.raw }),
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("the server remembers the actor's previous img", () => {
  let ctx: Ctx;
  let player: ClientSocket;
  let gm: ClientSocket;
  let actorId: string;

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

  beforeEach(async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Bhrotto",
          type: "character",
          img: "/assets/heroictoken-785db055.png",
          system: {},
          ownership: { default: 0, [ctx.playerUserId]: 3 },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    actorId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  });

  function versao(): number {
    const doc = ctx.store.get("actors", actorId);
    return (doc["_stats"] as Record<string, unknown>)["version"] as number;
  }

  async function escrever(diff: Record<string, unknown>): Promise<Record<string, unknown>> {
    return sendOp(player, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff, expectedVersion: versao() }],
    });
  }

  it("keeps the replaced image when the avatar token replaces it", async () => {
    const ack = await escrever({ img: "/assets/avatar-token-79449d7e.png" });
    expect(ack["ok"]).toBe(true);
    const doc = ctx.store.get("actors", actorId);
    expect(doc["img"]).toBe("/assets/avatar-token-79449d7e.png");
    expect(readImagemAnterior(doc)).toBe("/assets/heroictoken-785db055.png");
  });

  it("keeps it when the sheet's remove button blanks the image (the incident)", async () => {
    await escrever({ img: "/assets/avatar-token-79449d7e.png" });
    const ack = await escrever({ img: "" });
    expect(ack["ok"]).toBe(true);
    const doc = ctx.store.get("actors", actorId);
    expect(doc["img"]).toBe("");
    expect(readImagemAnterior(doc)).toBe("/assets/avatar-token-79449d7e.png");
  });

  it("a blank never overwrites the remembered image", async () => {
    await escrever({ img: "" });
    await escrever({ img: "" });
    await escrever({ img: null });
    expect(readImagemAnterior(ctx.store.get("actors", actorId))).toBe("/assets/heroictoken-785db055.png");
  });

  it("restoring swaps: the image restored over is remembered in turn", async () => {
    await escrever({ img: "/assets/avatar-token-79449d7e.png" });
    await escrever({ img: "/assets/heroictoken-785db055.png" });
    const doc = ctx.store.get("actors", actorId);
    expect(doc["img"]).toBe("/assets/heroictoken-785db055.png");
    expect(readImagemAnterior(doc)).toBe("/assets/avatar-token-79449d7e.png");
  });

  it("a write that does not touch img, or rewrites the same img, leaves the memory alone", async () => {
    await escrever({ img: "/assets/avatar-token-79449d7e.png" });
    await escrever({ name: "Bhrotto Raiz-funda" });
    await escrever({ img: "/assets/avatar-token-79449d7e.png" });
    expect(readImagemAnterior(ctx.store.get("actors", actorId))).toBe("/assets/heroictoken-785db055.png");
  });

  it("a client cannot forge the memory in the same write that changes img", async () => {
    await escrever({ img: "/assets/x-11111111.png", [IMAGEM_ANTERIOR_FLAG_PATH]: "/assets/forjado.png" });
    expect(readImagemAnterior(ctx.store.get("actors", actorId))).toBe("/assets/heroictoken-785db055.png");
  });
});
