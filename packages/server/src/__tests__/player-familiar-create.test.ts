/**
 * Player-owned companion (familiar) create/delete — anti-cheat gate (r17-P1).
 *
 * A PLAYER who owns a master character with a familiar-granting feat may create
 * and delete their OWN familiar Actor WITHOUT a GM (Actor is otherwise strictly
 * GM_ONLY_CREATE_DELETE). This suite proves, on the REAL doc:create/doc:delete
 * handler path (packages/server/src/net/handlers/doc-handlers.ts), that the
 * escape hatch is exactly as narrow as specified — every forge is rejected:
 *
 *   POSITIVE
 *     - owner PLAYER creates a familiar linked to a master they own (master has
 *       the "Familiar" feat) → allowed; the familiar's ownership mirrors the
 *       master (owner gets OWNER).
 *     - owner PLAYER deletes their own familiar → allowed.
 *     - GM can still create/delete any Actor (ordinary NPC) → allowed.
 *
 *   NEGATIVE (anti-cheat)
 *     - PLAYER forges a create of an ordinary Actor (no companionKind) → denied.
 *     - PLAYER creates a companion pointing at a master they do NOT own → denied.
 *     - PLAYER creates a companion whose master has NO familiar-granting feat
 *       → denied.
 *     - PLAYER creates a SECOND familiar for the same master → denied (1/master).
 *     - PLAYER deletes an ordinary Actor (the master itself) → denied.
 *
 * Boots through the real boot() sequence (mirrors embedded-item-actor.test.ts)
 * with netContext.systemModule = pf2eSystem so detectFamiliarGrant runs against
 * the live master document server-side.
 *
 * Spec: 29-pets-companions-familiars.md; 05-usuarios-e-permissoes.md.
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
// Test infrastructure (mirrors embedded-item-actor.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-player-familiar-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "player_familiar_world";
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
      worldTitle: "Player Familiar World",
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

/** A master character with a familiar-granting feat ("Familiar") embedded. */
function masterWithFamiliarFeat(ownerId: string): Record<string, unknown> {
  return {
    name: "Wizard Master",
    type: "character",
    system: { details: { level: { value: 3 } } },
    ownership: { default: 0, [ownerId]: 3 },
    items: [{ _id: "feat-familiar", name: "Familiar", type: "feat", system: { rules: [] } }],
  };
}

/** A master character with NO familiar-granting feat. */
function masterWithoutFeat(ownerId: string): Record<string, unknown> {
  return {
    name: "Fighter Master",
    type: "character",
    system: { details: { level: { value: 3 } } },
    ownership: { default: 0, [ownerId]: 3 },
    items: [{ _id: "feat-power", name: "Power Attack", type: "feat", system: { rules: [] } }],
  };
}

/** A familiar create payload linked to `masterId`. */
function familiarPayload(masterId: string, name = "Tobias"): Record<string, unknown> {
  return {
    name,
    type: "familiar",
    system: {
      companionKind: "familiar",
      masterActorId: masterId,
      master: {
        level: 3,
        abilityMod: 4,
        ac: 18,
        saves: { fortitude: 1, reflex: 1, will: 1 },
        perception: 1,
      },
      attributes: { hp: { value: 15, max: 15, temp: 0 } },
      abilitiesBudget: { value: 2, max: 2 },
      selectedAbilities: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Player-owned familiar create/delete gate (pf2e, r17-P1)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ownerSocket: ClientSocket;
  let outsiderSocket: ClientSocket;
  /** Master owned by the owner PLAYER, WITH a familiar-granting feat. */
  let masterId: string;
  /** Master owned by the owner PLAYER, WITHOUT any familiar feat. */
  let masterNoFeatId: string;
  /** An ordinary NPC Actor (GM-owned) used for delete-forge tests. */
  let npcId: string;

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

    // GM creates the two masters + an NPC (Actor create is GM-authorized).
    const masterAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [masterWithFamiliarFeat(ctx.ownerUserId)],
    });
    expect(masterAck["ok"]).toBe(true);
    masterId = (masterAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const noFeatAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [masterWithoutFeat(ctx.ownerUserId)],
    });
    expect(noFeatAck["ok"]).toBe(true);
    masterNoFeatId = (noFeatAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
      ._id;

    const npcAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Goblin", type: "npc", system: {}, ownership: { default: 0 } }],
    });
    expect(npcAck["ok"]).toBe(true);
    npcId = (npcAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    ownerSocket?.disconnect();
    outsiderSocket?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // NEGATIVE — ordinary Actor forge by a player
  // -------------------------------------------------------------------------

  it("DENIES a player forging a create of an ordinary Actor (no companionKind)", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Forged NPC", type: "npc", system: {}, ownership: { default: 0 } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("DENIES a player forging a familiar-typed Actor with NO masterActorId", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Actor",
      // type familiar + companionKind but missing masterActorId → not a valid
      // companion payload, so it falls back to the GM-only denial.
      data: [{ name: "Orphan", type: "familiar", system: { companionKind: "familiar" } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  // -------------------------------------------------------------------------
  // NEGATIVE — companion pointing at a master the player does not own
  // -------------------------------------------------------------------------

  it("DENIES a player creating a companion for a master they do NOT own", async () => {
    // outsider does not own `masterId` (owned by the owner player).
    const ack = await sendOp(outsiderSocket, "doc:create", {
      documentType: "Actor",
      data: [familiarPayload(masterId, "StolenFam")],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  // -------------------------------------------------------------------------
  // NEGATIVE — master without a familiar-granting feat
  // -------------------------------------------------------------------------

  it("DENIES a player creating a companion when the master has no granting feat", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Actor",
      data: [familiarPayload(masterNoFeatId, "NoGrantFam")],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  // -------------------------------------------------------------------------
  // POSITIVE — owner player creates their own familiar
  // -------------------------------------------------------------------------

  let familiarId: string;

  it("ALLOWS the owner player to create a familiar linked to their master", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Actor",
      data: [familiarPayload(masterId, "Tobias")],
    });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
    familiarId = doc["_id"] as string;
    expect(familiarId).toBeTruthy();
    expect(doc["type"]).toBe("familiar");
    // Ownership is FORCED to the master's map — the owner player owns it.
    const ownership = doc["ownership"] as Record<string, number>;
    expect(ownership[ctx.ownerUserId]).toBe(3);
  });

  // -------------------------------------------------------------------------
  // NEGATIVE — second familiar for the same master
  // -------------------------------------------------------------------------

  it("DENIES a second familiar for the same master (1 per master)", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Actor",
      data: [familiarPayload(masterId, "SecondFam")],
    });
    expect(ack["ok"]).toBe(false);
    // Duplicate is a validation failure, not a permission failure.
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  // -------------------------------------------------------------------------
  // NEGATIVE — delete of an ordinary Actor by a player
  // -------------------------------------------------------------------------

  it("DENIES a player deleting an ordinary Actor (the master itself)", async () => {
    const ack = await sendOp(ownerSocket, "doc:delete", {
      documentType: "Actor",
      ids: [masterId],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("DENIES a player deleting a GM-owned NPC Actor", async () => {
    const ack = await sendOp(ownerSocket, "doc:delete", {
      documentType: "Actor",
      ids: [npcId],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("DENIES a non-owner player deleting someone else's familiar", async () => {
    const ack = await sendOp(outsiderSocket, "doc:delete", {
      documentType: "Actor",
      ids: [familiarId],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  // -------------------------------------------------------------------------
  // POSITIVE — owner player deletes their own familiar; GM keeps full power
  // -------------------------------------------------------------------------

  it("ALLOWS the owner player to delete their own familiar", async () => {
    const ack = await sendOp(ownerSocket, "doc:delete", {
      documentType: "Actor",
      ids: [familiarId],
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { ids: string[] };
    expect(result.ids).toContain(familiarId);
  });

  it("ALLOWS the GM to create and delete any ordinary Actor", async () => {
    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name: "GM NPC", type: "npc", system: {}, ownership: { default: 0 } }],
    });
    expect(createAck["ok"]).toBe(true);
    const gmNpcId = (createAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
      ._id;

    const deleteAck = await sendOp(gm, "doc:delete", {
      documentType: "Actor",
      ids: [gmNpcId],
    });
    expect(deleteAck["ok"]).toBe(true);
  });
});
