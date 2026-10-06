/**
 * REQ-CFG-039 — House rules of A Queda (2026-10-05) — the server validates a character
 * build WITH the world's variant flags.
 *
 * `rejectIllegalCharacterBuild` (doc-handlers.ts) resolves
 * `variantRules.{bonusGeneralFeatLevel1,ancestryFeatsInGeneralSlots,
 * ancestryFeatLevelMinus2}` from the world's Settings and passes them to
 * `validateCharacterBuild` for BOTH the merged and the pre-write document.
 *
 * Approach (least brittle): the slot/level logic itself lives in the satellite
 * and is covered there; what the core owns is the WIRING. So the test spies on
 * `validateCharacterBuild` (wrapping the real function, never replacing its
 * behaviour) and asserts the second argument that reaches it over a real
 * socket doc:update — independent of whichever rule the satellite pin
 * currently implements.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import { defineSystem, type SystemModule } from "@fusion/system-api";
import { boot } from "../boot.js";
import type { BootResult } from "../boot.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";

const validateSpy = vi.hoisted(() => vi.fn());

vi.mock("@fusion/system-pf2e", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  validateSpy.mockImplementation(
    original["validateCharacterBuild"] as (...a: unknown[]) => unknown,
  );
  return { ...original, validateCharacterBuild: validateSpy };
});

function buildFakeSystem(): SystemModule {
  return defineSystem(
    {
      id: "fake-variant-system",
      title: "Fake Variant System",
      version: "0.1.0",
      engineCompat: ">=0.1.0 <2.0.0",
      authors: [{ name: "Test" }],
      documentTypes: { Actor: ["hero"] },
      languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    },
    (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
    },
  );
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-house-rules-validation-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "house_rules_validation_world";
  const systemId = "fake-variant-system";
  const dataDir = makeTempDir();
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
      worldTitle: "House Rules Validation World",
      worldSystemId: systemId,
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId,
      systemModule: buildFakeSystem(),
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

describe("house rules — doc:update validates the build with the world's variants", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let actorId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Hero", type: "hero", ownership: { default: 0 }, system: {} }],
    });
    expect(ack["ok"]).toBe(true);
    actorId = (ack["result"] as { documents: Record<string, unknown>[] }).documents[0]![
      "_id"
    ] as string;
  });

  afterAll(async () => {
    gm.close();
    await teardown(ctx);
  });

  async function touchActor(note: string): Promise<void> {
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { name: note } }],
    });
    expect(ack["ok"]).toBe(true);
  }

  it("with no world Setting, validation receives an empty variants object (RAW)", async () => {
    validateSpy.mockClear();
    await touchActor("raw");
    expect(validateSpy).toHaveBeenCalled();
    for (const call of validateSpy.mock.calls) expect(call[1]).toEqual({});
  });

  it("with the Settings stored, BOTH validations (merged and pre-write doc) receive the flags", async () => {
    for (const [key, value] of [
      ["ancestryFeatsInGeneralSlots", true],
      ["bonusGeneralFeatLevel1", true],
      ["ancestryFeatLevelMinus2", false],
    ] as const) {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Setting",
        data: [
          { key: `fake-variant-system:variantRules.${key}`, value, ownership: { default: 0 } },
        ],
      });
      expect(ack["ok"]).toBe(true);
    }
    validateSpy.mockClear();
    // The pre-write document is only validated when the merged one reports
    // issues (to diff them), so force the SAME pre-existing issue on both
    // calls: the diff is empty and the write still goes through.
    const forced = () => ({
      ok: false,
      issues: [{ code: "FAKE", path: "system.build", message: "forced" }],
    });
    validateSpy.mockImplementationOnce(forced).mockImplementationOnce(forced);
    await touchActor("house");
    expect(validateSpy.mock.calls).toHaveLength(2);
    for (const call of validateSpy.mock.calls) {
      expect(call[1]).toEqual({
        ancestryFeatsInGeneralSlots: true,
        bonusGeneralFeatLevel1: true,
        ancestryFeatLevelMinus2: false,
      });
    }
  });
});
