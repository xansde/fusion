/**
 * Embedded Item-in-Actor — real handler path integration test (R10-C).
 *
 * Proves, on the actual production doc:create/doc:update/doc:delete
 * handler path (packages/server/src/net/handlers/doc-handlers.ts), that:
 *
 *   1. EMBEDDED_PARENT_MAP resolves "Item" → "Actor" for doc:update's
 *      embedded path (handleEmbeddedUpdate), matching the parent resolution
 *      handleEmbeddedCreate/handleEmbeddedDelete already get from the
 *      client-supplied `parent.type`.
 *   2. Embedded Item create/update is validated against the active system's
 *      registered data models (SystemModule.models, keyed "Item:<subtype>")
 *      — an unknown Item type, or a `system` payload that doesn't match the
 *      registered Zod schema, is rejected with VALIDATION_FAILED. A
 *      diff-applied update that produces an invalid doc is rejected too.
 *   3. A PLAYER with OWNER ownership on the Actor can create a spell
 *      embedded (location = spellcasting entry id), update the entry's
 *      slots.prepared, and delete the spell — and each op re-derives
 *      `system.derived` on the parent (spell DC changes when proficiency
 *      rank changes).
 *   4. A PLAYER WITHOUT ownership on the Actor is rejected (PERMISSION_
 *      DENIED) for create/update/delete of embedded Items on that Actor.
 *
 * Boots through the real boot() sequence (same pattern as
 * augmentation-slot-limit.test.ts / derive-wiring.test.ts) with
 * netContext.systemModule = pf2eSystem.
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-011/020..025, 17-sistema-pf2e.md.
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
// Test infrastructure (mirrors augmentation-slot-limit.test.ts / derive-wiring.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-embedded-item-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "embedded_item_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  // Plain PLAYER on purpose (regression for the r10-C live finding): the
  // embedded-create TRUSTED role floor applies only to non-Actor parents
  // (Scene tokens) — a PLAYER who OWNS the actor must be able to manage the
  // actor's embedded Items (add/remove spells on their own sheet). The
  // outsider stays TRUSTED so its rejection tests isolate the ownership
  // check specifically (not the role floor).
  const { user: owner } = await authService.createUser({
    name: "OwnerPlayer",
    role: Role.PLAYER,
    password: "owner-pass",
  });
  const { user: outsider } = await authService.createUser({
    name: "OutsiderPlayer",
    role: Role.TRUSTED,
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
      worldTitle: "Embedded Item World",
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

function makeSpellcastingEntry(name: string) {
  return {
    name,
    type: "spellcastingEntry",
    system: {
      systemVersion: "0.1.0",
      prepared: { value: "prepared" },
      tradition: { value: "arcane" },
      ability: { value: "int" },
      proficiency: { value: 2 },
      slots: {
        "1": { value: 2, max: 2, prepared: [] },
      },
      isFocusPool: false,
    },
  };
}

function makeSpell(name: string, entryId: string) {
  return {
    name,
    type: "spell",
    system: {
      systemVersion: "0.1.0",
      level: 1,
      traits: { rarity: "common", traditions: ["arcane"], value: [] },
      location: { value: entryId },
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Embedded Item-in-Actor — real doc:create/doc:update/doc:delete handler path (pf2e)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ownerSocket: ClientSocket;
  let outsiderSocket: ClientSocket;
  let actorId: string;

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

    const actorAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Wizard PC",
          type: "character",
          system: { details: { level: { value: 3 } } },
          ownership: { default: 0, [ctx.ownerUserId]: 3 },
        },
      ],
    });
    expect(actorAck["ok"]).toBe(true);
    const docs = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents;
    actorId = docs[0]!._id;
    expect(actorId).toBeTruthy();
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    ownerSocket?.disconnect();
    outsiderSocket?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // Schema validation
  // -------------------------------------------------------------------------

  it("rejects an embedded Item with an unknown type for the active system", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      data: [{ name: "Bogus Item", type: "not-a-real-pf2e-type", system: {} }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  it("rejects an embedded Item whose system payload fails the registered schema", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      // spell.system.level is required (number 0-10) — omit it to fail schema
      data: [{ name: "Broken Spell", type: "spell", system: { traits: { value: [] } } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  // -------------------------------------------------------------------------
  // Ownership-gated CRUD + re-derivation (OWNER player)
  // -------------------------------------------------------------------------

  let entryId: string;
  let spellId: string;

  it("OWNER player can create a spellcastingEntry embedded on their Actor", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      data: [makeSpellcastingEntry("Arcane Repertoire")],
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as {
      documents: Array<{ _id: string }>;
      parent: Record<string, unknown>;
    };
    entryId = result.documents[0]!._id;
    expect(entryId).toBeTruthy();
    // Re-derivation ran on the parent (system.derived exists after the op).
    const system = result.parent["system"] as Record<string, unknown>;
    expect(system["derived"]).toBeDefined();
  });

  it("OWNER player can create a spell embedded with location = entryId", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      data: [makeSpell("Magic Missile", entryId)],
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { documents: Array<Record<string, unknown>> };
    const spell = result.documents[0]!;
    spellId = spell["_id"] as string;
    expect(spellId).toBeTruthy();
    expect((spell["system"] as Record<string, unknown>)["location"]).toEqual({ value: entryId });
  });

  it("OWNER player can update the spellcastingEntry's slots.prepared via doc:update embedded", async () => {
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Item",
      updates: [
        {
          _id: entryId,
          diff: { "system.slots.1.prepared": [{ id: spellId, expended: false }] },
          embedded: { type: "Item", id: actorId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { documents: Array<Record<string, unknown>> };
    const updatedParent = result.documents[0]!;
    const items = updatedParent["items"] as Array<Record<string, unknown>>;
    const updatedEntry = items.find((i) => i["_id"] === entryId)!;
    const slots = (updatedEntry["system"] as Record<string, unknown>)["slots"] as Record<
      string,
      unknown
    >;
    const rank1 = slots["1"] as Record<string, unknown>;
    expect(rank1["prepared"]).toEqual([{ id: spellId, expended: false }]);

    // Re-derivation ran on the parent after the embedded update.
    expect((updatedParent["system"] as Record<string, unknown>)["derived"]).toBeDefined();
  });

  it("rejects a diff-applied update that would make the embedded Item schema-invalid", async () => {
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Item",
      updates: [
        {
          _id: entryId,
          // proficiency.value must be a valid ProficiencyRank — "not-a-rank" isn't.
          diff: { "system.proficiency.value": "not-a-rank" },
          embedded: { type: "Item", id: actorId },
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  it("OWNER player can delete the spell embedded on their Actor", async () => {
    const ack = await sendOp(ownerSocket, "doc:delete", {
      documentType: "Item",
      ids: [spellId],
      parent: { type: "Actor", id: actorId },
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { parent: Record<string, unknown> };
    const items = result.parent["items"] as Array<Record<string, unknown>>;
    expect(items.find((i) => i["_id"] === spellId)).toBeUndefined();
    // Re-derivation ran on the parent after the embedded delete.
    expect((result.parent["system"] as Record<string, unknown>)["derived"]).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Non-owner rejection
  // -------------------------------------------------------------------------

  it("rejects embedded Item create from a player without OWNER ownership on the Actor", async () => {
    const ack = await sendOp(outsiderSocket, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      data: [makeSpell("Stolen Spell", entryId)],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("rejects embedded Item update from a player without OWNER ownership on the Actor", async () => {
    const ack = await sendOp(outsiderSocket, "doc:update", {
      documentType: "Item",
      updates: [
        {
          _id: entryId,
          diff: { "system.proficiency.value": 3 },
          embedded: { type: "Item", id: actorId },
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("rejects embedded Item delete from a player without OWNER ownership on the Actor", async () => {
    const ack = await sendOp(outsiderSocket, "doc:delete", {
      documentType: "Item",
      ids: [entryId],
      parent: { type: "Actor", id: actorId },
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });
});
