/**
 * B3 (revisão 3, 2026-09-24): in a SF2e-only world, `documentTypes.Item`
 * never listed `classFeature`, so the server rejected every document from
 * `sf2e.class-features-core` with `VALIDATION_FAILED: Unknown Item type
 * "classFeature" for system "sf2e"`. `classes-core-book-truth.test.ts`
 * (systems/sf2e) never caught this because it derives a character in
 * process from the pack data directly — it never goes through the
 * server's registrar/model-validation path that a real
 * `compendium:importToActor` (or the `doc:create` a grant materializer
 * would use) exercises.
 *
 * This test boots a real server with `worldSystemId: "sf2e"` (no pf2e/
 * composite involved — the exact case that was broken), imports the
 * Soldier class AND every class feature in `sf2e.class-features-core`
 * into a character actor over the socket, and asserts every uuid landed
 * with zero failures — the concession of class features actually works
 * end-to-end in the SF2e-only world.
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
import { reserveFreePort } from "./helpers/ports.js";
import { DocumentStore } from "../documents/store.js";
import { sf2eSystem } from "@fusion/system-sf2e";

const CLASS_PACK_ID = "sf2e.classes-core";
const CLASS_FEATURES_PACK_ID = "sf2e.class-features-core";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-sf2e-classfeature-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "sf2e_classfeature_world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

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
      worldTitle: "SF2e ClassFeature Import World",
      worldSystemId: "sf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: `http://127.0.0.1:${String(port)}`,
      systemId: "sf2e",
      systemModule: sf2eSystem,
    },
  });

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
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

function send(
  socket: ClientSocket,
  event: "op" | "query",
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit(event, { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout for ${event}: ${type}`));
    }, 8000);
  });
}

function readActorItems(ctx: Ctx, actorId: string): Record<string, unknown>[] {
  const store = new DocumentStore({ db: ctx.fusionDb.raw });
  const actor = store.get("actors", actorId);
  const items = actor["items"];
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

describe("sf2e-only world: classFeature concession via the real server path (B3)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let actorId: string;
  let soldierUuid: string;
  let classFeatureUuids: string[];

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);

    const classIndex = await send(gm, "query", "compendium:index", { packId: CLASS_PACK_ID });
    const classEntries = (classIndex["result"] as { entries: Array<{ uuid: string; name: string }> })
      .entries;
    const soldier = classEntries.find((e) => e.name === "Soldier");
    expect(soldier, "Soldier not found in sf2e.classes-core").toBeDefined();
    soldierUuid = soldier!.uuid;

    const featuresIndex = await send(gm, "query", "compendium:index", {
      packId: CLASS_FEATURES_PACK_ID,
    });
    const featureEntries = (
      featuresIndex["result"] as { entries: Array<{ uuid: string }> }
    ).entries;
    expect(featureEntries.length).toBeGreaterThan(0);
    classFeatureUuids = featureEntries.map((e) => e.uuid);

    const actorAck = await send(gm, "op", "doc:create", {
      documentType: "Actor",
      data: [{ name: "Soldier Test Subject", type: "character" }],
    });
    actorId = (
      (actorAck["result"] as { documents: Array<Record<string, unknown>> }).documents[0] as {
        _id: string;
      }
    )._id;
  }, 120_000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  it("imports the Soldier class into the actor without failures", async () => {
    const ack = await send(gm, "op", "compendium:importToActor", {
      uuids: [soldierUuid],
      actorId,
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { created: string[]; failed: Array<{ reason: string }> };
    expect(result.failed).toEqual([]);
    expect(result.created).toHaveLength(1);
  });

  it("B3: imports every sf2e.class-features-core document into the actor — the server no longer rejects classFeature", async () => {
    const before = readActorItems(ctx, actorId).length;

    const ack = await send(gm, "op", "compendium:importToActor", {
      uuids: classFeatureUuids,
      actorId,
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { created: string[]; failed: Array<{ reason: string }> };
    expect(result.failed, JSON.stringify(result.failed)).toEqual([]);
    expect(result.created).toHaveLength(classFeatureUuids.length);

    const items = readActorItems(ctx, actorId);
    expect(items).toHaveLength(before + classFeatureUuids.length);
    expect(items.some((i) => i["type"] === "classFeature")).toBe(true);
  });
});
