/**
 * Owner level change re-derives the animal companions on the server (BHR-F4-03, D-B02, REQ-PET-107..108).
 *
 * Rule under test (PF2e remaster, written here, not read from the pack): an animal companion level is its
 * owner level, and a young Bear (ancestry HP 8, Con +2) has HP = 8 + level x (6 + 2): 32 at level 3, 40 at
 * level 4. Only the server writes `system.master.level`; the client never does.
 *
 * Runs on the REAL doc:create / doc:update handlers (boot()), over a socket.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors embedded-item-actor.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-companion-master-level-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  outsiderToken: string;
  outsiderUserId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "companion_master_level_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  // Plain PLAYER: owns the master, must be able to create/delete its familiar.
  const { user: owner } = await authService.createUser({
    name: "OwnerPlayer",
    role: Role.PLAYER,
    password: "owner-pass",
  });
  // A second player who does NOT own the master — used to prove a companion
  // pointing at someone else's master is rejected.
  const { user: outsider } = await authService.createUser({
    name: "OutsiderPlayer",
    role: Role.PLAYER,
    password: "outsider-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const ownerLogin = await authService.login({
    userId: owner.id,
    password: "owner-pass",
    ip: "127.0.0.1",
  });
  const outsiderLogin = await authService.login({
    userId: outsider.id,
    password: "outsider-pass",
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
      worldTitle: "Companion Master Level World",
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
    outsiderToken: outsiderLogin.accessToken,
    outsiderUserId: outsider.id,
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

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FEATS = resolve(
  __dirname,
  "../../../../external/fusion-systems-2e/systems/pf2e/packs/feats-core/documents.json",
);

function featItem(name: string, id: string): Record<string, unknown> {
  const docs = JSON.parse(readFileSync(FEATS, "utf-8")) as Array<Record<string, unknown>>;
  const found = docs.find((d) => d["name"] === name && d["type"] === "feat");
  if (!found) throw new Error(`feat ${name} missing from feats-core`);
  return { ...found, _id: id };
}

/** `level` is explicit test data, never a player's record. */
function character(
  ownerId: string,
  name: string,
  level: number,
  items: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    name,
    type: "character",
    system: { level: { value: level } },
    ownership: { default: 0, [ownerId]: 3 },
    items,
  };
}

function bearPayload(
  masterId: string,
  name: string,
  slot: string,
  extraSystem: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    type: "familiar",
    system: {
      companionKind: "animalCompanion",
      masterActorId: masterId,
      companion: { typeSlug: "bear", stage: "young", grantSlotId: slot, active: true },
      ...extraSystem,
    },
  };
}

type Ack = Record<string, unknown>;
type Doc = Record<string, unknown>;
type Env = { type: string; payload: Record<string, unknown> };

function docsOf(ack: Ack): Doc[] {
  return (ack["result"] as { documents: Doc[] }).documents;
}

function sysOf(doc: Doc): Record<string, unknown> {
  return doc["system"] as Record<string, unknown>;
}

function derivedOf(doc: Doc): Record<string, unknown> {
  return sysOf(doc)["derived"] as Record<string, unknown>;
}

function hpMax(doc: Doc): unknown {
  return (derivedOf(doc)["hp"] as Record<string, unknown>)["max"];
}

function cachedLevel(doc: Doc): unknown {
  return (sysOf(doc)["master"] as Record<string, unknown> | undefined)?.["level"];
}

function nextActorUpdate(socket: ClientSocket, timeoutMs = 4000): Promise<Env> {
  return new Promise((resolveEnv, reject) => {
    const timer = setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("Timeout waiting for the Actor doc:update envelope"));
    }, timeoutMs);
    function handler(env: Env): void {
      if (env.type !== "doc:update" || env.payload["documentType"] !== "Actor") return;
      clearTimeout(timer);
      socket.off("op", handler);
      resolveEnv(env);
    }
    socket.on("op", handler);
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Owner change re-derives the animal companion on the server (BHR-F4-03)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ownerSocket: ClientSocket;
  const versions = new Map<string, number>();

  async function createAs(socket: ClientSocket, data: Doc[]): Promise<Ack> {
    return sendOp(socket, "doc:create", { documentType: "Actor", data });
  }

  /** Players must send the version they read (STALE_WRITE guard); the GM may omit it. */
  async function updateAs(
    socket: ClientSocket,
    id: string,
    diff: Doc,
    expectedVersion?: number,
  ): Promise<Ack> {
    const update: Doc = { _id: id, diff };
    if (expectedVersion !== undefined) update["expectedVersion"] = expectedVersion;
    return sendOp(socket, "doc:update", { documentType: "Actor", updates: [update] });
  }

  async function createMaster(level: number, name: string, items: Doc[] = []): Promise<string> {
    const ack = await createAs(gm, [character(ctx.ownerUserId, name, level, items)]);
    expect(ack["ok"]).toBe(true);
    const doc = docsOf(ack)[0]!;
    versions.set(doc["_id"] as string, (doc["_stats"] as { version: number }).version);
    return doc["_id"] as string;
  }

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    ownerSocket = connectClient(ctx.port, ctx.worldId, ctx.ownerToken);
    gm.connect();
    ownerSocket.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(ownerSocket)]);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    ownerSocket?.disconnect();
    await teardown(ctx);
  });

  it("a companion is born with the owner's level cached: HP 32 at level 3, no derived error", async () => {
    const masterId = await createMaster(3, "Owner3");
    const ack = await createAs(gm, [bearPayload(masterId, "Urso", "slot-a")]);
    expect(ack["ok"]).toBe(true);
    const bear = docsOf(ack)[0]!;
    expect(cachedLevel(bear)).toBe(3);
    expect(derivedOf(bear)["companion"]).not.toHaveProperty("error");
    expect(hpMax(bear)).toBe(32); // 8 + 3 x (6 + 2)
  });

  it("a player-created companion (Animal Companion grant) ignores a forged master level", async () => {
    const masterId = await createMaster(2, "Ranger2", [
      featItem("Animal Companion (Ranger)", "ac1"),
    ]);
    const ack = await createAs(ownerSocket, [
      bearPayload(masterId, "Urso", "slot-p", { master: { level: 20 } }),
    ]);
    expect(ack["ok"]).toBe(true);
    const bear = docsOf(ack)[0]!;
    expect(cachedLevel(bear)).toBe(2);
    expect(hpMax(bear)).toBe(24); // 8 + 2 x 8
  });

  it("owner level 3 -> 4: the same broadcast carries the bear with HP 40 and the cache at 4", async () => {
    const masterId = await createMaster(3, "Owner34");
    const created = await createAs(gm, [bearPayload(masterId, "Urso", "slot-b")]);
    const bearId = docsOf(created)[0]!["_id"] as string;

    const broadcast = nextActorUpdate(gm);
    const ack = await updateAs(
      ownerSocket,
      masterId,
      { "system.level.value": 4 },
      versions.get(masterId),
    );
    expect(ack["ok"]).toBe(true);

    const env = await broadcast;
    const sent = env.payload["documents"] as Doc[];
    const bear = sent.find((d) => d["_id"] === bearId);
    expect(bear).toBeDefined();
    expect(sent.some((d) => d["_id"] === masterId)).toBe(true);
    expect(cachedLevel(bear!)).toBe(4);
    expect(hpMax(bear!)).toBe(40); // 8 + 4 x (6 + 2)
    expect(docsOf(ack).some((d) => d["_id"] === bearId)).toBe(true);
  });

  it("owner update that does not change the level does not re-transmit the companion", async () => {
    const masterId = await createMaster(3, "OwnerNoop");
    const created = await createAs(gm, [bearPayload(masterId, "Urso", "slot-c")]);
    const bearId = docsOf(created)[0]!["_id"] as string;

    const ack = await updateAs(
      ownerSocket,
      masterId,
      { name: "OwnerNoop renamed" },
      versions.get(masterId),
    );
    expect(ack["ok"]).toBe(true);
    expect(docsOf(ack).map((d) => d["_id"])).toEqual([masterId]);
    expect(docsOf(ack).map((d) => d["_id"])).not.toContain(bearId);
  });

  it("the player cannot write system.master.* on the companion; the cache stays the owner's level", async () => {
    const masterId = await createMaster(3, "OwnerGuard");
    const created = await createAs(gm, [bearPayload(masterId, "Urso", "slot-d")]);
    const bearId = docsOf(created)[0]!["_id"] as string;

    const bearVersion = (docsOf(created)[0]!["_stats"] as { version: number }).version;

    const refused = await updateAs(ownerSocket, bearId, { "system.master.level": 20 }, bearVersion);
    expect(refused["ok"]).toBe(false);
    expect(refused["message"]).not.toMatch(/version|stale/i);

    const touched = await updateAs(gm, bearId, { name: "Urso renamed" });
    expect(touched["ok"]).toBe(true);
    expect(cachedLevel(docsOf(touched)[0]!)).toBe(3);
  });

  it("a companion edited directly (Trocar tipo) gets the owner's level refreshed before it is derived", async () => {
    const masterId = await createMaster(3, "OwnerSwap");
    const created = await createAs(gm, [bearPayload(masterId, "Urso", "slot-e")]);
    const bearId = docsOf(created)[0]!["_id"] as string;
    // The same diff also tries to stale the cache: the handler must put the owner's level back.
    const ack = await updateAs(gm, bearId, {
      "system.companion.typeSlug": "antelope",
      "system.master.level": 1,
    });
    expect(ack["ok"]).toBe(true);
    const swapped = docsOf(ack)[0]!;
    expect(cachedLevel(swapped)).toBe(3);
    expect(derivedOf(swapped)["companion"]).not.toHaveProperty("error");
    expect((derivedOf(swapped)["companion"] as Record<string, unknown>)["typeSlug"]).toBe(
      "antelope",
    );
  });
});
