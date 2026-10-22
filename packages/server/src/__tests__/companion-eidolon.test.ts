/**
 * Companion model — the Summoner's eidolon (ficha-nivel3 T3.1).
 *
 * Spec 29 DEC-PET-01/02/03 and spec 45 DEC-ATR-19: a companion is its OWN
 * Actor (subtype `familiar`) linked to its master by `system.masterActorId`;
 * the eidolon is `companionKind: "eidolon"`; it is born with a copy of the
 * master's ownership map; and the server alone decides, from what the master
 * carries, whether a PLAYER may create it.
 *
 * Rule under test (PF2e remaster, Summoner class): a Summoner is bonded to ONE
 * eidolon from level 1; a Wizard is not. The familiar is a separate grant, so
 * a Summoner who also took a familiar-granting feat keeps both.
 *
 * Runs on the REAL doc:create handler (boot()), plus the single redaction
 * funnel for Actors (net/redaction.ts) — no new predicate is introduced.
 *
 * REQ-PET-091, REQ-PET-092, REQ-PET-093, REQ-ATR-064, REQ-ATR-080.
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
import { pf2eSystem, SUMMONER_CLASS_SOURCE_ID } from "@fusion/system-pf2e";
import { reserveFreePort } from "./helpers/ports.js";
import { redactActorDocsForViewer } from "../net/redaction.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors embedded-item-actor.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-companion-eidolon-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "companion_eidolon_world";
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
      worldTitle: "Companion Eidolon World",
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

/** The Summoner class item as embedded on a character (identity = sourceId). */
function summonerClassItem(): Record<string, unknown> {
  return {
    _id: "class-summoner",
    name: "Summoner",
    type: "class",
    system: { rules: [] },
    flags: { fusion: { sourceId: SUMMONER_CLASS_SOURCE_ID } },
  };
}

const FAMILIAR_FEAT: Record<string, unknown> = {
  _id: "feat-familiar",
  name: "Familiar",
  type: "feat",
  system: { rules: [] },
};

function character(
  ownerId: string,
  name: string,
  items: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    name,
    type: "character",
    system: { details: { level: { value: 1 } } },
    ownership: { default: 0, [ownerId]: 3 },
    items,
  };
}

function companionPayload(
  masterId: string,
  kind: string,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    type: "familiar",
    system: { companionKind: kind, masterActorId: masterId },
    ...extra,
  };
}

type Ack = Record<string, unknown>;

function firstDoc(ack: Ack): Record<string, unknown> {
  return (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Eidolon as a linked companion Actor (T3.1)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ownerSocket: ClientSocket;
  let outsiderSocket: ClientSocket;
  /** Summoner owned by the owner player. */
  let summonerId = "";
  /** Summoner owned by the owner player who ALSO has the Familiar feat. */
  let summonerWithFamiliarId = "";
  /** Wizard with the Familiar feat, owned by the owner player. */
  let wizardId = "";
  /** Summoner whose eidolon the GM creates. */
  let gmSummonerId = "";
  let eidolonId = "";

  async function createAs(socket: ClientSocket, data: Record<string, unknown>): Promise<Ack> {
    return sendOp(socket, "doc:create", { documentType: "Actor", data: [data] });
  }

  async function createMaster(doc: Record<string, unknown>): Promise<string> {
    const ack = await createAs(gm, doc);
    expect(ack["ok"]).toBe(true);
    return firstDoc(ack)["_id"] as string;
  }

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    ownerSocket = connectClient(ctx.port, ctx.worldId, ctx.ownerToken);
    outsiderSocket = connectClient(ctx.port, ctx.worldId, ctx.outsiderToken);
    gm.connect();
    ownerSocket.connect();
    outsiderSocket.connect();
    await Promise.all([
      waitForConnect(gm),
      waitForConnect(ownerSocket),
      waitForConnect(outsiderSocket),
    ]);
    summonerId = await createMaster(character(ctx.ownerUserId, "Summoner", [summonerClassItem()]));
    summonerWithFamiliarId = await createMaster(
      character(ctx.ownerUserId, "Summoner Familiar", [summonerClassItem(), FAMILIAR_FEAT]),
    );
    wizardId = await createMaster(character(ctx.ownerUserId, "Wizard", [FAMILIAR_FEAT]));
    gmSummonerId = await createMaster(
      character(ctx.ownerUserId, "Summoner GM", [summonerClassItem()]),
    );
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    ownerSocket?.disconnect();
    outsiderSocket?.disconnect();
    await teardown(ctx);
  });

  it("DENIES an eidolon for a master that is not a Summoner (REQ-PET-092)", async () => {
    const ack = await createAs(ownerSocket, companionPayload(wizardId, "eidolon", "Fake"));
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("DENIES a player a kind with no grant detector, even with a granting feat (REQ-PET-092)", async () => {
    const ack = await createAs(ownerSocket, companionPayload(wizardId, "animalCompanion", "Wolf"));
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("DENIES an eidolon for a Summoner the player does not own", async () => {
    const ack = await createAs(outsiderSocket, companionPayload(summonerId, "eidolon", "Stolen"));
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("ALLOWS the owner to create the eidolon as its own linked Actor, owned like the master (REQ-PET-091, REQ-ATR-064)", async () => {
    const ack = await createAs(
      ownerSocket,
      // A forged ownership in the payload must not widen access.
      companionPayload(summonerId, "eidolon", "Aurora", {
        ownership: { default: 3, [ctx.outsiderUserId]: 3 },
      }),
    );
    expect(ack["ok"]).toBe(true);
    const doc = firstDoc(ack);
    eidolonId = doc["_id"] as string;
    expect(eidolonId).not.toBe(summonerId);
    expect(doc["type"]).toBe("familiar");
    const system = doc["system"] as Record<string, unknown>;
    expect(system["companionKind"]).toBe("eidolon");
    expect(system["masterActorId"]).toBe(summonerId);
    expect(doc["ownership"]).toEqual({ default: 0, [ctx.ownerUserId]: 3 });
  });

  it("DENIES a second eidolon for the same Summoner (REQ-PET-093)", async () => {
    const ack = await createAs(ownerSocket, companionPayload(summonerId, "eidolon", "Twin"));
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  it("ALLOWS a familiar and an eidolon side by side on one Summoner; a pet shares the familiar's slot (REQ-PET-093)", async () => {
    const fam = await createAs(
      ownerSocket,
      companionPayload(summonerWithFamiliarId, "familiar", "Rato"),
    );
    expect(fam["ok"]).toBe(true);
    const eid = await createAs(
      ownerSocket,
      companionPayload(summonerWithFamiliarId, "eidolon", "Brasa"),
    );
    expect(eid["ok"]).toBe(true);
    const pet = await createAs(
      ownerSocket,
      companionPayload(summonerWithFamiliarId, "pet", "Gato"),
    );
    expect(pet["ok"]).toBe(false);
    expect(pet["code"]).toBe("VALIDATION_FAILED");
  });

  it("a GM-created eidolon with no ownership is born owned like its master (REQ-ATR-064)", async () => {
    const ack = await createAs(gm, companionPayload(gmSummonerId, "eidolon", "Lume"));
    expect(ack["ok"]).toBe(true);
    expect(firstDoc(ack)["ownership"]).toEqual({ default: 0, [ctx.ownerUserId]: 3 });
  });

  it("a GM-created companion keeps an EXPLICIT ownership (GM override, REQ-DOC-029)", async () => {
    const ack = await createAs(
      gm,
      companionPayload(gmSummonerId, "familiar", "Corvo", { ownership: { default: 0 } }),
    );
    expect(ack["ok"]).toBe(true);
    expect(firstDoc(ack)["ownership"]).toEqual({ default: 0 });
  });

  it("the eidolon reaches its owner with HP and never reaches another player (redaction.ts)", () => {
    const doc: Record<string, unknown> = {
      _id: eidolonId,
      type: "familiar",
      ownership: { default: 0, [ctx.ownerUserId]: 3 },
      system: {
        companionKind: "eidolon",
        masterActorId: summonerId,
        attributes: { hp: { value: 20, max: 20, temp: 0 } },
      },
    };
    const toOwner = redactActorDocsForViewer([doc], {
      userId: ctx.ownerUserId,
      role: Role.PLAYER,
      ownedCharacterIds: [summonerId],
    });
    expect(toOwner.documents).toHaveLength(1);
    const ownerSys = toOwner.documents[0]!["system"] as Record<string, unknown>;
    expect((ownerSys["attributes"] as Record<string, unknown>)["hp"]).toBeDefined();

    const toOutsider = redactActorDocsForViewer([doc], {
      userId: ctx.outsiderUserId,
      role: Role.PLAYER,
      ownedCharacterIds: [],
    });
    expect(toOutsider.documents).toHaveLength(0);
    expect(toOutsider.removedIds).toEqual([eidolonId]);
  });
});
