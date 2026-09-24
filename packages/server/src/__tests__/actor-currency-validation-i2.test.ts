/**
 * I2 (revisão adversarial 3) — the server did not validate an Actor's
 * `system.currency` against the active system's model at all: on a
 * pf2e-sf2e (composite) world, `{credits:5}`, `{gp:5,sp:0,...}` and the
 * literal string `"lixo"` were ALL accepted, and a freshly created Actor
 * had no `currency` whatsoever — the M2.1 currency swap
 * (`CompositeCharacterSystemSchema`, PF2e coin shape) had zero effect at
 * runtime.
 *
 * Not circular: the assertion is the shape each system's OWN schema
 * declares (`Pf2eCurrencySchema` — pp/gp/sp/cp — for pf2e-sf2e vs
 * `CreditsSchema` — credits — for sf2e), never a literal this test invents.
 * Boots through the real boot() sequence + doc:create/doc:update over the
 * socket (packages/server/src/net/handlers/doc-handlers.ts
 * `validateActorCurrencyForSystem`), no manual handler wiring.
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
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { pf2eSf2eSystem } from "@fusion/system-pf2e-sf2e";

function makeTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `fusion-${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "actor_currency_i2_world";
  const dataDir = makeTempDir("actor-currency-i2");
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

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
      worldTitle: "Actor Currency I2 World",
      worldSystemId: "pf2e-sf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "pf2e-sf2e",
      systemModule: pf2eSf2eSystem,
    },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

  return { dataDir, fusionDb, bootResult, port, worldId, gmToken: gmLogin.accessToken };
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

describe("I2 — Actor system.currency is validated against the active system's model", () => {
  let ctx: Ctx;
  let gm: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  it("rejects SF2e-shaped currency ({credits}) on a pf2e-sf2e Actor create", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Bad Wallet",
          type: "character",
          system: { currency: { credits: 5 } },
          ownership: { default: 0 },
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(ack["message"]).toContain("currency");
  });

  it('rejects a garbage currency payload ("lixo") on Actor create', async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Garbage Wallet",
          type: "character",
          system: { currency: "lixo" },
          ownership: { default: 0 },
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  it("accepts the PF2e coin shape (pp/gp/sp/cp) on Actor create", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Good Wallet",
          type: "character",
          system: { currency: { pp: 1, gp: 5, sp: 0, cp: 3 } },
          ownership: { default: 0 },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
  });

  it("rejects a doc:update that overwrites currency with a bad shape", async () => {
    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Updatable Wallet",
          type: "character",
          system: { currency: { pp: 0, gp: 0, sp: 0, cp: 0 } },
          ownership: { default: 0 },
        },
      ],
    });
    expect(createAck["ok"]).toBe(true);
    const doc = (createAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!;

    const updateAck = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: doc._id, diff: { "system.currency": { credits: 999 } } }],
    });
    expect(updateAck["ok"]).toBe(false);
    expect(updateAck["code"]).toBe("VALIDATION_FAILED");
  });
});
