/**
 * T013 — `expectedVersion` becomes mandatory on the doc:update PRIMARY path
 * for any non-privileged writer (doc-handlers.ts buildDocUpdateHandler).
 *
 * Policy (see doc-handlers.ts docstring above the check for the full
 * rationale): GM/ASSISTANT keep the legacy opt-in behavior — several
 * server-side writers (combat-handlers.ts, etc.) still bump `_stats.version`
 * without ever setting `expectedVersion`. A PLAYER omitting the field on the
 * primary path is refused outright instead of silently last-write-winning
 * over another player's edit; every real sheet VM supplies it automatically
 * via sendOp.ts's `normalizeDocUpdate` (packages/client/src/lib/docs/
 * sendOp.ts), reading the version off the client's DocumentMirror.
 *
 * This file drives the real socket handler end-to-end (boot() + socket.io
 * client), not a unit call into buildDocUpdateHandler — the whole point is to
 * prove the policy as the wire actually enforces it, including the
 * embedded/primary routing split.
 *
 * Coverage:
 *   (a) non-privileged OWNER, primary doc:update, no expectedVersion → refused
 *   (b) same, WITH the correct expectedVersion → accepted
 *   (c) GM, primary doc:update, no expectedVersion → still accepted (legacy)
 *   (d) monotonicity — read V, update once, resend V → STALE_WRITE (without
 *       this, a server with a version stuck at a constant would pass a-c too)
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
import { PROTOCOL_VERSION } from "@fusion/shared";
import { reserveFreePort } from "./helpers/ports.js";
import { DocumentStore } from "../documents/store.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors doc-update-routing.test.ts / condition-toggle.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-expected-version-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "expected_version_world";
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
    name: "ExpectedVersionPlayer",
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
      worldTitle: "Expected Version World",
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

describe("T013 — expectedVersion mandatory on primary doc:update for non-privileged writers", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
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

  // Fresh Actor per test, owned by the player — keeps each test's version
  // reasoning self-contained instead of chaining off a shared mutable count.
  beforeEach(async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Expected Version PC",
          type: "character",
          system: {},
          ownership: { default: 0, [ctx.playerUserId]: 3 },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    actorId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    const created = ctx.store.get("actors", actorId);
    expect((created["_stats"] as Record<string, unknown>)["version"]).toBe(1);
  });

  // -------------------------------------------------------------------------
  // (a) non-privileged OWNER, primary doc:update, no expectedVersion → refused
  // -------------------------------------------------------------------------

  it("a non-privileged OWNER updating their own Actor with no expectedVersion is refused", async () => {
    const ack = await sendOp(player, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { name: "Sneaky Rename" } }],
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(String(ack["message"])).toContain("expectedVersion");

    // Server state, not just the ack: nothing moved.
    const persisted = ctx.store.get("actors", actorId);
    expect(persisted["name"]).toBe("Expected Version PC");
    expect((persisted["_stats"] as Record<string, unknown>)["version"]).toBe(1);
  });

  // -------------------------------------------------------------------------
  // (b) same writer, WITH the correct expectedVersion → accepted
  // -------------------------------------------------------------------------

  it("a non-privileged OWNER updating with the correct expectedVersion is accepted", async () => {
    const ack = await sendOp(player, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { name: "Legit Rename" }, expectedVersion: 1 }],
    });

    expect(ack["ok"]).toBe(true);
    const persisted = ctx.store.get("actors", actorId);
    expect(persisted["name"]).toBe("Legit Rename");
    expect((persisted["_stats"] as Record<string, unknown>)["version"]).toBe(2);
  });

  // -------------------------------------------------------------------------
  // (c) GM, primary doc:update, no expectedVersion → still accepted (legacy)
  // -------------------------------------------------------------------------

  it("GM updating with no expectedVersion is still accepted (legacy opt-in preserved)", async () => {
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { name: "GM Rename" } }],
    });

    expect(ack["ok"]).toBe(true);
    const persisted = ctx.store.get("actors", actorId);
    expect(persisted["name"]).toBe("GM Rename");
  });

  // -------------------------------------------------------------------------
  // (d) monotonicity: read V, update once, resend V → STALE_WRITE
  //
  // Without this, a server whose version never actually advanced (e.g. stuck
  // returning a constant) would still pass (a)-(c): those only check that the
  // FIELD is present/correctly rejected, never that the counter really moves.
  // -------------------------------------------------------------------------

  it("resending the same expectedVersion after a successful update is rejected as STALE_WRITE", async () => {
    const first = await sendOp(player, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { name: "First Edit" }, expectedVersion: 1 }],
    });
    expect(first["ok"]).toBe(true);
    const afterFirst = ctx.store.get("actors", actorId);
    expect((afterFirst["_stats"] as Record<string, unknown>)["version"]).toBe(2);

    // Same expectedVersion=1 again — the document has already moved to 2.
    const second = await sendOp(player, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { name: "Second Edit" }, expectedVersion: 1 }],
    });
    expect(second["ok"]).toBe(false);
    expect(second["code"]).toBe("STALE_WRITE");

    // Server state: the second (stale) edit never landed.
    const afterSecond = ctx.store.get("actors", actorId);
    expect(afterSecond["name"]).toBe("First Edit");
    expect((afterSecond["_stats"] as Record<string, unknown>)["version"]).toBe(2);
  });
});
