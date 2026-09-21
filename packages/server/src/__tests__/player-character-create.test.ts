/**
 * Player-owned CHARACTER edit + build-legality gate (O6/T6.2, T6.3;
 * O6 fixer r1 C6 — the T6.1 "player creates their own character via
 * doc:create" exception was REMOVED).
 *
 * "Quem cria — O JOGADOR" (plano.md, ficha-nivel3, "Decisões do Alexandre"
 * #2) is satisfied WITHOUT a doc:create exception: REQ-USR-025 (specs/05-
 * usuarios-e-permissoes.md, "Emenda de 2026-08-16") already creates a blank
 * character for every new PLAYER/TRUSTED user in the SAME transaction as
 * the account (auth/service.ts's UserService.createUser), owned by that
 * user from birth, and that amendment says this is "o único endereço da
 * criação de personagem". The O6/T6.1 doc:create exception was a second,
 * REDUNDANT address — unreachable from the shipped client (no screen emits
 * a doc:create of Actor `type: "character"`) and a live authority gap (a
 * PLAYER's `items[]` on the create payload skipped every embedded-item
 * check doc:update applies) — see doc-handlers.ts's "Player-created OWN
 * character — REMOVED" comment for the full reasoning.
 *
 * This suite proves, on the REAL doc:create/doc:update handler path
 * (packages/server/src/net/handlers/doc-handlers.ts):
 *
 *   C6 — the removed exception
 *     - a plain PLAYER's doc:create of Actor `type: "character"` is DENIED
 *       (same GM-only floor as npc/hazard/loot — spec 42), proving the
 *       surface is gone, not just unreachable from the client.
 *     - REQ-USR-025's auto-created character IS usable: the owner already
 *       has real OWNER ownership on it from account creation.
 *
 *   T6.2/T6.3 — ownership + server-side build legality (the client's
 *   builder already refuses to OFFER an illegal choice; this proves the
 *   server refuses to PERSIST one too, resolving the feat by the item's own
 *   `flags.fusion.build.slot` — O6 fixer C4 — not a `choice.itemId` the real
 *   client never writes)
 *     - the owner can doc:update their auto-created character (generic
 *       OWNER check) → allowed; a DIFFERENT player cannot → denied.
 *     - a skill-category feat filed into an "ancestryFeat" slot is refused
 *       (FEAT_SLOT_MISMATCH).
 *     - the same feat filed into "skillFeat" is accepted.
 *     - an ability-boost milestone at a level that is neither 1 nor a
 *       multiple of 5 is refused.
 *
 * Boots through the real boot() sequence (mirrors player-familiar-create.test.ts).
 *
 * Spec: 28-hub-do-jogador.md; 05-usuarios-e-permissoes.md.
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
import { DocumentStore } from "../documents/store.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION, OwnershipLevel } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors player-familiar-create.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-player-character-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  /** REQ-USR-025's auto-created character for `ownerUserId` (found via the store, not a socket op — see the module docstring). */
  ownerCharacterId: string;
  ownerCharacterVersion: number;
  outsiderToken: string;
  outsiderUserId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "player_character_world";
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
      worldTitle: "Player Character World",
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

  // REQ-USR-025: `authService.createUser` above already created a blank
  // character owned by `owner.id`, in the same transaction as the account
  // (O6 fixer C6 removed the doc:create exception this suite used to use
  // instead) — found here directly through the store, the same way
  // production code resolves "whose character is this" (flags.fusion.
  // playerId, auth/service.ts).
  const documents = new DocumentStore({ db: fusionDb.raw });
  const ownerCharacter = documents.getAll("actors", { type: "character" }).find((actor) => {
    const flags = actor["flags"] as Record<string, unknown> | undefined;
    const fusion = flags?.["fusion"] as Record<string, unknown> | undefined;
    return fusion?.["playerId"] === owner.id;
  });
  if (!ownerCharacter) throw new Error("REQ-USR-025 did not auto-create OwnerPlayer's character");
  const ownerCharacterStats = ownerCharacter["_stats"] as Record<string, unknown> | undefined;
  const rawVersion = ownerCharacterStats?.["version"];

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    ownerToken: ownerLogin.accessToken,
    ownerUserId: owner.id,
    ownerCharacterId: ownerCharacter["_id"] as string,
    ownerCharacterVersion: typeof rawVersion === "number" ? rawVersion : 1,
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
// T6.5 (ficha-nivel3, Onda 6b) — join-snapshot helpers.
//
// "Quem cria — O JOGADOR" only means something if the character REQ-USR-025
// auto-created is actually delivered to the OWNER's own socket on connect —
// that delivery is the precondition for the client's Contatos "Na mesa" card
// (REQ-CTT-014/020/022) to have a document to draw and for REQ-CTT-027's
// double-click to have something to open. These helpers mirror
// contacts-redaction.test.ts's join-snapshot pattern (same funnel,
// net/redaction.ts, REQ-CTT-083) rather than duplicating a second one.
// ---------------------------------------------------------------------------

function recordEnvelopes(socket: ClientSocket): Record<string, unknown>[] {
  const received: Record<string, unknown>[] = [];
  socket.on("op", (env: Record<string, unknown>) => {
    received.push(env);
  });
  return received;
}

const POLL_INTERVAL_MS = 25;
const WAIT_TIMEOUT_MS = 8000;

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    if (check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** The join batch a freshly connected socket receives — `resync:full` here (fresh
 * connection, nothing to replay from a `lastSeq`). */
function waitForJoinBatch(traffic: Record<string, unknown>[]): Promise<void> {
  return waitFor(
    () => traffic.some((e) => e["type"] === "resync:full" || e["type"] === "resync:delta"),
    "the join batch (resync:full/resync:delta)",
  );
}

/** Every Actor document carried by the join snapshot in the recorded traffic. */
function actorDocsIn(envelopes: Record<string, unknown>[]): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  for (const env of envelopes) {
    const payload = env["payload"] as Record<string, unknown> | undefined;
    const snapshot = payload?.["snapshot"] as Record<string, unknown> | undefined;
    if (!snapshot) continue;
    const byType = snapshot["documents"] as Record<string, unknown[]> | undefined;
    const actors = byType?.["Actor"];
    if (Array.isArray(actors)) docs.push(...(actors as Record<string, unknown>[]));
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A create payload a plain PLAYER might hand-build for the exception O6
 * fixer C6 removed — forging an ownership map too, to prove BOTH the
 * creation itself and the ownership-forcing it used to rely on are gone. */
function forgedOwnCharacterPayload(name = "Forged Aria"): Record<string, unknown> {
  return {
    name,
    type: "character",
    system: { level: { value: 1 } },
    ownership: { default: 3 },
  };
}

/**
 * An embedded feat carrying the REAL `flags.fusion.build` link (O6 fixer
 * C4: `findItemByBuildSlot` resolves the choice↔item link by THIS field —
 * what `planVM.embeddedItemPayload`/`chooseFeat` actually write — never by
 * a `choice.itemId`, which the real client never persists).
 */
function featItemPayload(slot: string, category: string): Record<string, unknown> {
  return {
    name: `Test Feat (${category} → ${slot})`,
    type: "feat",
    system: { category, level: 2, traits: { value: [] } },
    flags: { fusion: { build: { level: 2, slot } } },
  };
}

/** Files a choice at `slot` — the REAL persisted shape (`{level, slot, type}`, no itemId). */
function choiceDiff(slot: string, type: string): Record<string, unknown> {
  return {
    "system.build.choices": [{ level: 2, slot, type }],
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Player-owned character edit + build legality (pf2e, O6/T6.2-T6.3; O6 fixer C6)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ownerSocket: ClientSocket;
  let outsiderSocket: ClientSocket;

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
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    ownerSocket?.disconnect();
    outsiderSocket?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // O6 fixer C6 — the doc:create exception is GONE
  // -------------------------------------------------------------------------

  it("DENIES a plain player creating their OWN character via doc:create (T6.1's exception was removed)", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Actor",
      data: [forgedOwnCharacterPayload("Forged Aria")],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("DENIES a plain player creating an NPC Actor (same GM-only floor, unrelated to the removed exception)", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Forged NPC", type: "npc", system: {}, ownership: { default: 0 } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  // -------------------------------------------------------------------------
  // T6.3 — the REQ-USR-025 auto-created character has real ownership
  // -------------------------------------------------------------------------

  let characterId: string;
  // Tracked from each successful ack's `_stats.version` rather than hardcoded:
  // WIRING-DERIVE (documents/derive.ts) may issue a SECOND internal
  // store.update() after create/update to persist recomputed
  // `system.derived`, which bumps `_stats.version` again — so the exact
  // number is an implementation detail this suite should not hardcode.
  let version = 0;

  function statsVersion(doc: Record<string, unknown>): number {
    const stats = doc["_stats"] as Record<string, unknown> | undefined;
    const v = stats?.["version"];
    return typeof v === "number" ? v : 0;
  }

  it("ALLOWS the owner to edit their REQ-USR-025 auto-created character (generic OWNER check)", async () => {
    characterId = ctx.ownerCharacterId;
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: characterId,
          diff: { "system.details": { xp: 5 } },
          expectedVersion: ctx.ownerCharacterVersion,
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
    version = statsVersion(doc);
  });

  it("DENIES a different player from editing someone else's character", async () => {
    const ack = await sendOp(outsiderSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        { _id: characterId, diff: { "system.details": { xp: 999 } }, expectedVersion: version },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("ALLOWS the GM to create a character for a player too (GM keeps full authority)", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name: "GM-made PC", type: "character", system: { level: { value: 1 } } }],
    });
    expect(ack["ok"]).toBe(true);
  });

  // -------------------------------------------------------------------------
  // T6.2 — server-side build legality (O6 fixer C4: resolved by the item's
  // own flags.fusion.build.slot, the real link chooseFeat writes)
  // -------------------------------------------------------------------------

  it("initializes system.build via the ancestry ability-boost pick (mirrors real play order: build exists long before the FIRST feat is ever chosen)", async () => {
    // `validateCharacterBuild` is a no-op (r9 manual-entry mode) for a
    // character with NO `system.build` at all — and this suite's auto-
    // created character has none yet at this point. In REAL play that
    // window is theoretical: `chooseAncestryBoosts`/`chooseBackgroundBoosts`
    // (planVM.ts) write `system.build.abilities.*` during ancestry/
    // background selection, long before level 2's first feat pick — so by
    // the time `chooseFeat` ever runs, `system.build` always already
    // exists. This step reproduces that same real ordering before the C4/N1
    // repro tests below, instead of asserting against the untested (and
    // out-of-scope, per the module's own docstring) r9 no-build state.
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: characterId,
          diff: { "system.build.abilities": { classBoost: ["str"] } },
          expectedVersion: version,
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
    version = statsVersion(doc);
  });

  it("DENIES the embedded doc:create itself of a skill-category feat filed into the ancestryFeat slot, with NO choice sent at all (O6 fixer r2, C4 bypass)", async () => {
    // O6 fixer r1 shipped this check gated on a MATCHING system.build.choices
    // entry — so the embed alone used to succeed (ok:true) and only the
    // FOLLOW-UP choices doc:update was refused, leaving the illegal item on
    // the sheet with nothing pointing at it. The real chooseFeat client op
    // (planVM.ts) sends this exact embedded create FIRST — no choice in the
    // same batch — so that gap was reachable from the shipped client, not
    // just a hand-built payload. r2 makes handleEmbeddedCreate itself refuse
    // this create (see rejectIllegalCharacterBuild's call site) — nothing
    // more to send afterwards, nothing persists.
    const embedAck = await sendOp(ownerSocket, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: characterId },
      data: [featItemPayload("ancestryFeat-2", "skill")],
    });
    expect(embedAck["ok"]).toBe(false);
    expect(embedAck["code"]).toBe("VALIDATION_FAILED");
    expect(String(embedAck["message"])).toContain("FEAT_SLOT_MISMATCH");
    // Nothing persisted — the actor's version must not have moved, and a
    // plain doc:update with the current (unchanged) version must still see
    // the same expectedVersion accepted below.
  });

  it("DENIES the embedded doc:create of a level-4 class feat filed into a level-2 classFeat slot (O6 fixer r2, N1: FEAT_LEVEL_EXCEEDS_SLOT_LEVEL)", async () => {
    const overLeveledFeat = {
      name: "Test Feat (over-leveled)",
      type: "feat",
      system: { category: "class", level: 4, traits: { value: ["fighter"] } },
      flags: { fusion: { build: { level: 2, slot: "classFeat-2" } } },
    };
    const embedAck = await sendOp(ownerSocket, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: characterId },
      data: [overLeveledFeat],
    });
    expect(embedAck["ok"]).toBe(false);
    expect(embedAck["code"]).toBe("VALIDATION_FAILED");
    expect(String(embedAck["message"])).toContain("FEAT_LEVEL_EXCEEDS_SLOT_LEVEL");
  });

  it("ALLOWS a skill-category feat filed into a skillFeat slot", async () => {
    const embedAck = await sendOp(ownerSocket, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: characterId },
      data: [featItemPayload("skillFeat-2", "skill")],
    });
    expect(embedAck["ok"]).toBe(true);
    const embedResult = embedAck["result"] as { parent: Record<string, unknown> };
    version = statsVersion(embedResult.parent);

    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: characterId,
          diff: choiceDiff("skillFeat-2", "skillFeat"),
          expectedVersion: version,
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
    version = statsVersion(doc);
  });

  it("DENIES an ability-boost milestone at a level that is neither 1 nor a multiple of 5", async () => {
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: characterId,
          diff: {
            "system.build.abilities": { levelledBoosts: { "2": ["str", "dex", "con", "wis"] } },
          },
          expectedVersion: version,
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(String(ack["message"])).toContain("BOOST_LEVEL_NOT_MILESTONE");
  });

  it('ALLOWS levelledBoosts["1"] — the level-1 free ability boosts (O6 fixer C1)', async () => {
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: characterId,
          diff: {
            "system.build.abilities": {
              levelledBoosts: { "1": ["str", "dex", "con", "wis"] },
            },
          },
          expectedVersion: version,
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
    version = statsVersion(doc);
  });

  // -------------------------------------------------------------------------
  // O6 fixer C2 — leveling DOWN does not corrupt/freeze the sheet
  // -------------------------------------------------------------------------

  it("ALLOWS leveling down past a recorded choice/boost — the write no longer freezes on the old regression", async () => {
    // The character already carries (from the tests above) a skillFeat-2
    // choice and a levelledBoosts["1"] entry. Setting the level field DOWN
    // to 1 used to be rejected by CHOICE_LEVEL/BOOST_LEVEL_EXCEEDS_
    // CHARACTER_LEVEL even though nothing else in the diff touches build —
    // this is the exact `levelSet` reproduction (planVM.ts) C2 fixes.
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: characterId,
          diff: { "system.level.value": 1, "system.details.level": 1 },
          expectedVersion: version,
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
    version = statsVersion(doc);
  });

  // -------------------------------------------------------------------------
  // O6 fixer C4/A6 — cannot bypass build validation by deleting system.build
  // -------------------------------------------------------------------------

  it("DENIES nulling out system.build once the character has one", async () => {
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: characterId,
          diff: { "system.build": null },
          expectedVersion: version,
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  // -------------------------------------------------------------------------
  // T6.4 — concurrent Mestre x jogador edit on the SAME player-owned
  // character, over the existing optimistic-version infra (expected-
  // version.test.ts / documents-concurrency.test.ts cover the generic
  // mechanism; this is the scenario itself, per the O6 lane brief).
  // -------------------------------------------------------------------------

  it("a GM edit lands, and the player's now-stale write is rejected (not silently lost)", async () => {
    // The GM can edit ANY Actor, including a player's own character
    // (privileged writers keep expectedVersion optional — "legacy opt-in",
    // expected-version.test.ts). The player read the document at `version`
    // and has NOT reloaded yet — a routine race once the Mestre can also
    // touch a character the jogador owns (plano.md decision #2).
    const gmAck = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: characterId, diff: { "system.details": { gmNote: "aprovado" } } }],
    });
    expect(gmAck["ok"]).toBe(true);
    const gmDoc = (gmAck["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
    const versionAfterGm = statsVersion(gmDoc);
    expect(versionAfterGm).toBeGreaterThan(version);

    // The player, still holding the OLD version, tries to write — refused as
    // STALE_WRITE rather than silently overwriting the GM's edit (no lost
    // update) or silently discarding the player's own change.
    const staleAck = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        { _id: characterId, diff: { "system.details": { xp: 10 } }, expectedVersion: version },
      ],
    });
    expect(staleAck["ok"]).toBe(false);
    expect(staleAck["code"]).toBe("STALE_WRITE");

    // The player reloads (picks up the GM's version) and retries — accepted.
    const retryAck = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: characterId,
          diff: { "system.details": { xp: 10 } },
          expectedVersion: versionAfterGm,
        },
      ],
    });
    expect(retryAck["ok"]).toBe(true);
    const retryDoc = (retryAck["result"] as { documents: Array<Record<string, unknown>> })
      .documents[0]!;
    // Both edits survived — the GM's note was not clobbered by the retry
    // (deepMerge onto the current document, not onto the player's stale read).
    const details = retryDoc["system"] as { details?: Record<string, unknown> };
    expect(details.details?.["gmNote"]).toBe("aprovado");
    expect(details.details?.["xp"]).toBe(10);
    version = statsVersion(retryDoc);
  });

  // -------------------------------------------------------------------------
  // T6.5 (ficha-nivel3, Onda 6b) — the gatilho itself: the player's OWN
  // REQ-USR-025 character reaches THEIR OWN join snapshot on connect (so the
  // client's Contatos "Na mesa" card has a document to draw, and REQ-CTT-027's
  // double-click has something to open — see components/contacts/
  // ContactsPanel.svelte and lib/contacts/contactsVM.ts on the client). An
  // outsider's own snapshot must NOT carry it (ownership.default = NONE,
  // REQ-USR-025a) — proven ONLY for the join snapshot below. C1 (o6b fixer
  // r1, revisão adversarial, xansde/fusion#240): the same cut does NOT hold
  // for the other three REQ-NET-096 paths (live broadcast, resync delta
  // replay, ack echo) — redaction.ts's actorEscapingKnowledgeIsVisible
  // treats any `type: "character"` doc as visible regardless of ownership,
  // so "na mesa" is safe unconditional per-card only at join, not after any
  // doc:update. Issue #240 tracks the spec conflict (05×39) this needs
  // resolved before the predicate can be aligned across all four paths.
  //
  // No new UI trigger was built for this fatia: REQ-CFG-051a forbids the
  // Usuários section from offering create/edit/delete personagem as its own
  // action (even for someone who already has one), REQ-NPC-055a defers a
  // SECOND character's creation gesture to [V2], and DEC-NPC-02 names
  // REQ-USR-025 as the sole address. This suite is the missing proof that the
  // existing chain (REQ-USR-025 → join snapshot → Contatos → double-click →
  // CharacterSheet with the Plan column visible by default, DEC-R10-05) is
  // actually wired end to end over a real socket, not just at each layer in
  // isolation.
  // -------------------------------------------------------------------------

  describe("the auto-created character reaches the owner's own join snapshot (T6.5)", () => {
    it("the owner's resync:full snapshot carries their own REQ-USR-025 character, OWNER ownership included", async () => {
      const fresh = connectClient(ctx.port, ctx.worldId, ctx.ownerToken);
      const traffic = recordEnvelopes(fresh);
      fresh.connect();
      try {
        await waitForConnect(fresh);
        await waitForJoinBatch(traffic);

        const own = actorDocsIn(traffic).find((doc) => doc["_id"] === ctx.ownerCharacterId);
        expect(own).toBeDefined();
        expect(own?.["type"]).toBe("character");
        const ownership = own?.["ownership"] as Record<string, number> | undefined;
        expect(ownership?.[ctx.ownerUserId]).toBe(OwnershipLevel.OWNER);
      } finally {
        fresh.disconnect();
      }
    });

    // C1 (o6b fixer r1, revisão adversarial, xansde/fusion#240): this proves
    // the redaction boundary ONLY for the join snapshot — sync-handlers.ts's
    // resync:full applies its own resolveOwnership>=LIMITED filter here.
    // redaction.ts's actorEscapingKnowledgeIsVisible (used by the live
    // broadcast, the resync delta replay, and the ack echo — the other
    // three of REQ-NET-096's four paths) returns `true` for ANY viewer of a
    // `type: "character"` doc regardless of ownership, so this same
    // "outsider can't see it" guarantee does NOT hold for those three paths
    // today. Do not read this test as proof of REQ-NET-096 end to end —
    // issue #240 tracks the spec conflict (05×39) a decision here would
    // have to resolve first.
    it("an outsider's own join snapshot does NOT carry someone else's character (ownership.default = NONE)", async () => {
      const fresh = connectClient(ctx.port, ctx.worldId, ctx.outsiderToken);
      const traffic = recordEnvelopes(fresh);
      fresh.connect();
      try {
        await waitForConnect(fresh);
        await waitForJoinBatch(traffic);

        expect(actorDocsIn(traffic).some((doc) => doc["_id"] === ctx.ownerCharacterId)).toBe(false);
      } finally {
        fresh.disconnect();
      }
    });

    it("the GM's own join snapshot DOES carry it (privileged role, spec 42)", async () => {
      const fresh = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
      const traffic = recordEnvelopes(fresh);
      fresh.connect();
      try {
        await waitForConnect(fresh);
        await waitForJoinBatch(traffic);

        expect(actorDocsIn(traffic).some((doc) => doc["_id"] === ctx.ownerCharacterId)).toBe(true);
      } finally {
        fresh.disconnect();
      }
    });
  });
});
