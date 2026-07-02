/**
 * Derivation pipeline wiring — real handler path integration test.
 *
 * WIRING-DERIVE: proves that SystemModule.deriveSteps (base → effects →
 * derived, M3-C) actually runs on the authoritative server path and
 * populates `system.derived` on persisted/broadcast Actor documents — not
 * just in system-package unit tests (systems/pf2e/src/__tests__/
 * derivations.test.ts) that call the pipeline manually.
 *
 * Boots through the real boot() sequence (same pattern as
 * boot-compendium.test.ts / augmentation-slot-limit.test.ts) with
 * netContext.systemModule = pf2eSystem / sf2eSystem, then drives:
 *   1. doc:create Actor (character) → asserts system.derived.ac/saves on the
 *      PERSISTED/BROADCAST doc returned by the ack.
 *   2. doc:create Item (Condition) embedded on that Actor via
 *      documentType="Item" + parent={type:"Actor", id} — the only real
 *      embedded-create path (see augmentation-slot-limit.test.ts) — then
 *      asserts system.derived.ac.total dropped by the condition's penalty.
 *   3. Repeats a minimal version for sf2e.
 *
 * Also re-asserts the pre-existing "not re-derived" contract for compendium
 * reads (compendium:get serves raw pack data verbatim) still holds — this is
 * the invariant e2e-dod-m3.test.ts / boot-compendium*.test.ts already lock
 * down; re-checking it here guards against a future regression where derive
 * wiring accidentally reaches into the compendium read path.
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-020..025, 17-sistema-pf2e.md,
 * 18-sistema-sf2e.md.
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
import { pf2eSystem } from "@fusion/system-pf2e";
import { sf2eSystem } from "@fusion/system-sf2e";
import type { SystemModule } from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors augmentation-slot-limit.test.ts)
// ---------------------------------------------------------------------------

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
  gmUserId: string;
}

async function buildCtx(
  worldId: string,
  systemId: string,
  systemModule: SystemModule,
): Promise<Ctx> {
  const dataDir = makeTempDir(worldId);
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

  // Boot through the REAL sequence with systemModule set — proves derivation
  // is wired on the production path, not just manually assembled in tests.
  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: `Derive Wiring World (${systemId})`,
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
      systemModule,
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
    gmUserId: gm.id,
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

function sendQuery(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit("query", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for query: ${type}`)), 8000);
  });
}

// ---------------------------------------------------------------------------
// Fixture: a level-5 fighter-shaped character document (mirrors
// systems/pf2e/src/__tests__/derivations.test.ts makeFighterDoc, without
// _equippedArmor/_equippedWeapons so AC = flat unarmored value).
//
// STR 18(+4) DEX 16(+3) CON 14(+2) INT 10(+0) WIS 12(+1) CHA 8(-1)
// Level 5. Fortitude Expert(2), Reflex Trained(1), Will Expert(2).
// Perception Expert(2). ClassDC Expert(2), key ability STR.
// Unarmored (no _equippedArmor): AC = 10 + dex(3) + armorProf(unarmored, rank
// from proficiencies.armor.unarmored=1 → Trained → 1*2+5=7) = 10+3+7 = 20.
// ---------------------------------------------------------------------------

function makeFighterCharacterData(name: string): Record<string, unknown> {
  return {
    name,
    type: "character",
    ownership: { default: 0 },
    system: {
      systemVersion: "0.1.0",
      level: { value: 5 },
      abilities: {
        str: { value: 18, mod: 0 },
        dex: { value: 16, mod: 0 },
        con: { value: 14, mod: 0 },
        int: { value: 10, mod: 0 },
        wis: { value: 12, mod: 0 },
        cha: { value: 8, mod: 0 },
      },
      attributes: {
        hp: { value: 75, max: 75, temp: 0 },
        ac: { value: 10 },
        speed: { value: 25, otherSpeeds: [] },
        dying: { value: 0, max: 4 },
        wounded: { value: 0 },
        doomed: { value: 0 },
        iwr: { immunities: [], weaknesses: [], resistances: [] },
      },
      saves: {
        fortitude: { rank: 2 },
        reflex: { rank: 1 },
        will: { rank: 2 },
      },
      perception: { rank: 2, senses: [] },
      skills: {
        athletics: { rank: 2 },
        acrobatics: { rank: 1 },
        stealth: { rank: 0 },
      },
      proficiencies: {
        classDC: { rank: 2 },
        weapons: { unarmed: 1, simple: 1, martial: 2, advanced: 0 },
        armor: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
      },
      resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
      details: { keyAbility: "str", level: 5 },
      traits: { rarity: "common", value: [], size: "med" },
    },
  };
}

// ---------------------------------------------------------------------------
// PF2e suite
// ---------------------------------------------------------------------------

describe("Derivation pipeline wired on the real doc:create/doc:update handler path (pf2e)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let actorId: string;
  let frightenedItemId: string;

  beforeAll(async () => {
    ctx = await buildCtx("derive_wiring_pf2e", "pf2e", pf2eSystem);
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  it("doc:create Actor populates system.derived.ac/saves/perception on the persisted+broadcast doc", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [makeFighterCharacterData("Wiring Fighter")],
    });
    expect(ack["ok"]).toBe(true);
    const docs = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents;
    expect(docs).toHaveLength(1);
    const doc = docs[0]!;
    actorId = doc["_id"] as string;
    expect(actorId).toBeTruthy();

    const sys = doc["system"] as Record<string, unknown>;
    const derived = sys["derived"] as Record<string, unknown> | undefined;
    expect(derived).toBeDefined();

    const ac = derived!["ac"] as { total: number } | undefined;
    // Unarmored: 10 + dexMod(3) + profBonus(Trained rank1, lvl5 = 1*2+5=7) = 20
    expect(ac?.total).toBe(20);

    const saves = derived!["saves"] as Record<string, { total: number }>;
    // Fortitude Expert(2) lvl5 = 2*2+5=9, + CON mod(2) = 11
    expect(saves["fortitude"]?.total).toBe(11);

    const perception = derived!["perception"] as { total: number };
    // Perception Expert(2) lvl5 = 9, + WIS mod(1) = 10
    expect(perception.total).toBe(10);

    // CONTRACT: authored fields are untouched, only system.derived is added.
    const attrs = sys["attributes"] as Record<string, unknown>;
    expect((attrs["hp"] as { max: number }).max).toBe(75);
  });

  it("doc:update on the Actor recomputes system.derived (ability score change moves AC)", async () => {
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { "system.abilities.dex.value": 20 } }],
    });
    expect(ack["ok"]).toBe(true);
    const docs = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents;
    const doc = docs[0]!;
    const sys = doc["system"] as Record<string, unknown>;
    const derived = sys["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number };
    // DEX 20 → mod +5 (was +3): 10 + 5 + 7 = 22
    expect(ac.total).toBe(22);

    // AUTHORSHIP (audit M4.5-corretor, BAIXA): the doc:update handler calls
    // recomputeDerivedIfNeeded, which performs a SECOND store.update() to
    // persist the recomputed system.derived subtree. That second write must
    // carry the same authorCtx as the first (ctx.userId) — previously it
    // omitted authorCtx entirely, silently reverting `_stats.lastModifiedBy`
    // to the store's defaultAuthor (`{ userId: null }`) even though the GM
    // made this change.
    const stats = doc["_stats"] as Record<string, unknown>;
    expect(stats["lastModifiedBy"]).toBe(ctx.gmUserId);
  });

  it("a client-supplied system.derived patch is stripped, never persisted verbatim", async () => {
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: actorId,
          diff: { "system.derived.ac": { total: 9999, base: 9999, modifiers: [] } },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { documents: Array<Record<string, unknown>> };
    // No-op diff (after stripping system.derived, nothing else changed) → empty documents.
    expect(result.documents).toHaveLength(0);

    // Fetch current snapshot state via a fresh resync to be sure the forged
    // value never landed.
    const resyncAck = await sendOp(gm, "resync:request", { lastSeq: 0 });
    expect(resyncAck["ok"]).toBe(true);
  });

  it("applying a Frightened condition (real embedded Item create) reduces system.derived.ac.total", async () => {
    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      data: [
        {
          name: "Frightened",
          type: "condition",
          system: { slug: "frightened", value: 2 },
        },
      ],
    });
    expect(createAck["ok"]).toBe(true);
    const parentDoc = (createAck["result"] as { parent: Record<string, unknown> }).parent;
    const sys = parentDoc["system"] as Record<string, unknown>;
    const derived = sys["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number };
    // AC was 22 (post DEX-20 update) — frightened 2 → -2 status penalty → 20.
    expect(ac.total).toBe(20);

    const createdItems = (createAck["result"] as { documents: Array<Record<string, unknown>> })
      .documents;
    frightenedItemId = createdItems[0]!["_id"] as string;
    expect(frightenedItemId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Audit issue 2: handleEmbeddedDelete must recompute system.derived — a
  // stale AC left over from a removed condition would silently mislead
  // players/GM about the actor's real defenses.
  // -------------------------------------------------------------------------

  it("removing the Frightened condition (real embedded Item delete) restores system.derived.ac.total", async () => {
    const deleteAck = await sendOp(gm, "doc:delete", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      ids: [frightenedItemId],
    });
    expect(deleteAck["ok"]).toBe(true);
    const parentDoc = (deleteAck["result"] as { parent: Record<string, unknown> }).parent;
    const sys = parentDoc["system"] as Record<string, unknown>;
    const derived = sys["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number };
    // Frightened removed — AC returns to 22 (post DEX-20 update, pre-condition).
    expect(ac.total).toBe(22);
  });

  // -------------------------------------------------------------------------
  // Audit issue 4: doc:create must strip a client-supplied system.derived,
  // same as doc:update already does. Uses an Actor subtype ("base") that has
  // no registered DeriveSteps, so recomputeDerivedIfNeeded is a no-op and
  // cannot overwrite a forged value — the strip on the create path is the
  // ONLY thing preventing it from persisting verbatim.
  // -------------------------------------------------------------------------

  it("strips a forged system.derived from doc:create data for a subtype with no DeriveSteps", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Forged Derived Actor",
          type: "base", // no DeriveSteps registered for this subtype
          ownership: { default: 0 },
          system: {
            derived: { ac: { total: 9999, base: 9999, modifiers: [] } },
          },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const docs = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents;
    const doc = docs[0]!;
    const sys = doc["system"] as Record<string, unknown> | undefined;
    // The forged system.derived must never have been persisted.
    expect(sys?.["derived"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // BAIXA (audit M4.5-corretor): the file docstring claims this suite
  // "re-asserts the pre-existing 'not re-derived' contract for compendium
  // reads (compendium:get serves raw pack data verbatim)", but no test here
  // actually called compendium:get — the assertion was missing. This test
  // fills that gap: compendium:get on a real bestiary-core NPC must return
  // the pack's raw `system` verbatim, with NO `system.derived` attached
  // (derive wiring only touches the doc:create/doc:update/embedded handler
  // path — see derive-runner.ts docstring — never the compendium read path).
  // -------------------------------------------------------------------------

  it("compendium:get serves raw pack data verbatim — no system.derived attached (not re-derived)", async () => {
    const indexAck = await sendQuery(gm, "compendium:index", { packId: "pf2e.bestiary-core" });
    expect(indexAck["ok"]).toBe(true);
    const entries = (indexAck["result"] as { entries: Array<{ uuid: string; name: string }> })
      .entries;
    const eagleEntry = entries.find((e) => e.name === "Eagle");
    expect(eagleEntry).toBeDefined();

    const getAck = await sendQuery(gm, "compendium:get", { uuid: eagleEntry!.uuid });
    expect(getAck["ok"]).toBe(true);
    const doc = (getAck["result"] as { document: Record<string, unknown> }).document;
    const sys = doc["system"] as Record<string, unknown>;

    // Authored fields are served verbatim from the pack.
    const attrs = sys["attributes"] as Record<string, unknown>;
    expect((attrs["ac"] as Record<string, unknown>)["value"]).toBe(15);

    // CONTRACT: compendium:get never runs derivation — system.derived must
    // be entirely absent, not even an empty object.
    expect(sys["derived"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SF2e suite (minimal — proves the same wiring works for a second system,
// per REQ-SF2-004 "identical formulas to pf2e").
// ---------------------------------------------------------------------------

describe("Derivation pipeline wired on the real doc:create handler path (sf2e)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx("derive_wiring_sf2e", "sf2e", sf2eSystem);
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  it("doc:create Actor populates system.derived.ac/saves for sf2e", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [makeFighterCharacterData("Wiring Operative")],
    });
    expect(ack["ok"]).toBe(true);
    const docs = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents;
    const doc = docs[0]!;
    const sys = doc["system"] as Record<string, unknown>;
    const derived = sys["derived"] as Record<string, unknown> | undefined;
    expect(derived).toBeDefined();

    const ac = derived!["ac"] as { total: number };
    expect(ac.total).toBe(20);

    const saves = derived!["saves"] as Record<string, { total: number }>;
    expect(saves["fortitude"]?.total).toBe(11);
  });
});
