/**
 * Companion model — the Witch's bound familiar authorizes off the CLASS item
 * (I2, onda-3 adversarial review of ficha-nivel3 T3.2/T3.3).
 *
 * Rule under test (PF2e remaster, Witch class): a Witch is bonded to ONE
 * familiar from level 1 — a class rule, not an opt-in feat. The client
 * embeds the Witch class item SYNCHRONOUSLY with the class pick (same op
 * batch as applyClass) and only fires the "Familiar (Witch)" class FEATURE
 * embed afterwards, in a separate async round trip
 * (materializeClassGrants/runClassGrantRefs). Before this fix,
 * `companionGrantAllows("familiar", master)` only recognized that later
 * feature (via `detectFamiliarGrant`'s familiarAbilities rule signal) — so a
 * master carrying ONLY the Witch class item (the feature not yet
 * materialized) was denied, exactly the race PlanColumn.svelte's
 * `autoCreateClassCompanion`/`sendAutoCompanionOp` retry existed to paper
 * over. `detectWitchFamiliarGrant` closes the race at the SOURCE: the class
 * item alone is now sufficient, mirroring `detectEidolonGrant`/Summoner.
 *
 * Runs on the REAL doc:create handler (boot()) — no mock of
 * companionGrantAllows.
 *
 * REQ-PET-092, REQ-PET-095 (spec 29, DEC-PET-04).
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
import { pf2eSystem, WITCH_CLASS_SOURCE_ID } from "@fusion/system-pf2e";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors companion-eidolon.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-companion-witch-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  ownerToken: string;
  ownerUserId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "companion_witch_world";
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

  const reservedPort = await reserveFreePort();
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: reservedPort, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Companion Witch World",
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
  const port = address.port;

  return {
    dataDir,
    fusionDb,
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The Witch class item ALONE — `rules: []`, exactly as the client's
 * `applyClass` embeds it, WITHOUT the "Familiar (Witch)" class feature that
 * `materializeClassGrants` embeds afterwards. This is the master document
 * that existed at the moment the T3.2/T3.3 race could fire the auto-create
 * before that feature landed.
 */
function witchClassItemOnly(): Record<string, unknown> {
  return {
    _id: "class-witch",
    name: "Witch",
    type: "class",
    system: { rules: [] },
    flags: { fusion: { sourceId: WITCH_CLASS_SOURCE_ID } },
  };
}

function character(ownerId: string, items: Record<string, unknown>[]): Record<string, unknown> {
  return {
    name: "Witch-only master",
    type: "character",
    system: { details: { level: { value: 1 } } },
    ownership: { default: 0, [ownerId]: 3 },
    items,
  };
}

function companionPayload(masterId: string, kind: string, name: string): Record<string, unknown> {
  return { name, type: "familiar", system: { companionKind: kind, masterActorId: masterId } };
}

type Ack = Record<string, unknown>;

function firstDoc(ack: Ack): Record<string, unknown> {
  return (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Witch's bound familiar authorizes off the class item alone (I2, onda 3 review)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ownerSocket: ClientSocket;
  let witchOnlyId = "";

  async function createAs(socket: ClientSocket, data: Record<string, unknown>): Promise<Ack> {
    return sendOp(socket, "doc:create", { documentType: "Actor", data: [data] });
  }

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    ownerSocket = connectClient(ctx.port, ctx.worldId, ctx.ownerToken);
    gm.connect();
    ownerSocket.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(ownerSocket)]);

    const ack = await createAs(gm, character(ctx.ownerUserId, [witchClassItemOnly()]));
    expect(ack["ok"]).toBe(true);
    witchOnlyId = firstDoc(ack)["_id"] as string;
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    ownerSocket?.disconnect();
    await teardown(ctx);
  });

  it("ALLOWS the owner's FIRST attempt to create the familiar — no feature, no retry needed (REQ-PET-092/095)", async () => {
    const ack = await createAs(ownerSocket, companionPayload(witchOnlyId, "familiar", "Familiar"));
    expect(ack["ok"]).toBe(true);
    const doc = firstDoc(ack);
    expect(doc["type"]).toBe("familiar");
    const system = doc["system"] as Record<string, unknown>;
    expect(system["companionKind"]).toBe("familiar");
    expect(system["masterActorId"]).toBe(witchOnlyId);
  });

  it("still DENIES a 'pet' off the bare class item — the class rule binds a familiar, not an interchangeable pet", async () => {
    const ack = await createAs(ownerSocket, companionPayload(witchOnlyId, "pet", "Bicho"));
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });
});
