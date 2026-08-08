/**
 * Tiles are GM-only, and hidden tiles never reach a player — through a real
 * server, real sockets and real auth.
 *
 * Why this is not covered by the role floor tokens already have: embedded
 * creation under a Scene requires TRUSTED+, which is right for tokens (a
 * trusted player placing a token is the intended path) and wrong for tiles.
 * A tile is a piece of the map and `hidden` on one is the GM's reveal — a
 * TRUSTED player who could add or unhide one could show the room the GM was
 * saving for later. So the gate is stricter, and a stricter gate that is only
 * asserted in a unit test is a gate nobody has walked through.
 *
 * Harness mirrors embedded-item-actor.test.ts.
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
import { pf2eSystem } from "@fusion/system-pf2e";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  /** TRUSTED on purpose: high enough to place tokens, still not a GM. */
  trustedToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "tile_gate_world";
  const dataDir = join(
    tmpdir(),
    `fusion-tile-gate-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: trusted } = await authService.createUser({
    name: "TrustedPlayer",
    role: Role.TRUSTED,
    password: "trusted-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const trustedLogin = await authService.login({
    userId: trusted.id,
    password: "trusted-pass",
    ip: "127.0.0.1",
  });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: 0, host: "127.0.0.1", logLevel: "silent" },
  });

  const bootResult = await boot({
    config,
    logger: createLogger("silent"),
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Tile Gate World",
      worldSystemId: "pf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "pf2e",
      systemModule: pf2eSystem,
    },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");

  return {
    dataDir,
    fusionDb,
    bootResult,
    port: address.port,
    worldId,
    gmToken: gmLogin.accessToken,
    trustedToken: trustedLogin.accessToken,
  };
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
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout for op: ${type}`));
    }, 8000);
  });
}

/** The error code of a rejected ack (`{ ok: false, code, message }`). */
function errorCode(ack: Record<string, unknown>): string {
  return typeof ack["code"] === "string" ? ack["code"] : "";
}

// ---------------------------------------------------------------------------

describe("tiles are GM-only and hidden tiles stay hidden", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let trusted: ClientSocket;
  let sceneId = "";
  let hiddenTileId = "";

  beforeAll(async () => {
    ctx = await buildCtx();

    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);

    trusted = connectClient(ctx.port, ctx.worldId, ctx.trustedToken);
    trusted.connect();
    await waitForConnect(trusted);

    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [
        {
          name: "Cripta",
          width: 2000,
          height: 2000,
          grid: { type: "square", size: 100 },
          ownership: { default: 2 },
        },
      ],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 60000);

  afterAll(async () => {
    gm.disconnect();
    trusted.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("the GM can add an image to the scene", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Tile",
      data: [
        {
          name: "Porão inundado",
          texture: "/assets/porao-secreto.webp",
          x: 0,
          y: 0,
          width: 2000,
          height: 2000,
          hidden: true,
        },
      ],
      parent: { type: "Scene", id: sceneId },
    });

    expect(ack["ok"]).toBe(true);
    const created = (ack["result"] as { documents: Array<{ _id: string; hidden: boolean }> })
      .documents;
    expect(created[0]?.hidden).toBe(true);
    hiddenTileId = created[0]!._id;
    expect(hiddenTileId).toBeTruthy();
  });

  it("a TRUSTED player — who may place tokens — may NOT add an image", async () => {
    const ack = await sendOp(trusted, "doc:create", {
      documentType: "Tile",
      data: [{ name: "Intrusa", texture: "/assets/x.webp", width: 100, height: 100 }],
      parent: { type: "Scene", id: sceneId },
    });

    expect(ack["ok"]).toBe(false);
    expect(errorCode(ack)).toBe("PERMISSION_DENIED");
  });

  it("a TRUSTED player may NOT reveal the GM's hidden image", async () => {
    const ack = await sendOp(trusted, "doc:update", {
      documentType: "Tile",
      updates: [
        { _id: hiddenTileId, diff: { hidden: false }, embedded: { type: "Tile", id: sceneId } },
      ],
    });

    expect(ack["ok"]).toBe(false);
    expect(errorCode(ack)).toBe("PERMISSION_DENIED");
  });

  it("a TRUSTED player may NOT delete an image", async () => {
    const ack = await sendOp(trusted, "doc:delete", {
      documentType: "Tile",
      ids: [hiddenTileId],
      parent: { type: "Scene", id: sceneId },
    });

    expect(ack["ok"]).toBe(false);
    expect(errorCode(ack)).toBe("PERMISSION_DENIED");
  });

  it("the hidden image is absent from the player's join snapshot", async () => {
    // A fresh connection: the snapshot is built from scratch for this socket.
    const fresh = connectClient(ctx.port, ctx.worldId, ctx.trustedToken);
    const snapshot = new Promise<Record<string, unknown>>((resolve, reject) => {
      fresh.on("op", (envelope: { type: string; payload: Record<string, unknown> }) => {
        if (envelope.type === "resync:full") resolve(envelope.payload);
      });
      setTimeout(() => {
        reject(new Error("no snapshot"));
      }, 8000);
    });

    fresh.connect();
    await waitForConnect(fresh);
    const payload = await snapshot;
    fresh.disconnect();

    // Assert on the serialized snapshot: the texture path must not appear
    // anywhere in it, not merely be filtered out of one array we thought to
    // check.
    expect(JSON.stringify(payload)).not.toContain("porao-secreto.webp");
  }, 20000);

  it("the GM's own snapshot still has it", async () => {
    const fresh = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    const snapshot = new Promise<Record<string, unknown>>((resolve, reject) => {
      fresh.on("op", (envelope: { type: string; payload: Record<string, unknown> }) => {
        if (envelope.type === "resync:full") resolve(envelope.payload);
      });
      setTimeout(() => {
        reject(new Error("no snapshot"));
      }, 8000);
    });

    fresh.connect();
    await waitForConnect(fresh);
    const payload = await snapshot;
    fresh.disconnect();

    expect(JSON.stringify(payload)).toContain("porao-secreto.webp");
  }, 20000);

  it("revealing it as GM makes it reach the player, and the reveal is the GM's alone", async () => {
    const reveal = new Promise<string>((resolve, reject) => {
      trusted.on("op", (envelope: { type: string; payload: unknown }) => {
        if (envelope.type !== "doc:update") return;
        const serialized = JSON.stringify(envelope.payload);
        if (serialized.includes("porao-secreto.webp")) resolve(serialized);
      });
      setTimeout(() => {
        reject(new Error("player never received the revealed tile"));
      }, 8000);
    });

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Tile",
      updates: [
        { _id: hiddenTileId, diff: { hidden: false }, embedded: { type: "Tile", id: sceneId } },
      ],
    });
    expect(ack["ok"]).toBe(true);

    await expect(reveal).resolves.toContain("porao-secreto.webp");
  }, 20000);
});
