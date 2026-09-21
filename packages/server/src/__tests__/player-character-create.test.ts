/**
 * Player-owned CHARACTER create + build-legality gate (O6/T6.1, T6.2, T6.3).
 *
 * "Quem cria — O JOGADOR" (plano.md, ficha-nivel3, "Decisões do Alexandre" #2;
 * spec 28 / emenda 37/05 — "o personagem nasce com o player"). A PLAYER may
 * create their OWN character Actor WITHOUT a GM (Actor is otherwise strictly
 * GM_ONLY_CREATE_DELETE, ACTOR_CREATE defaults to ASSISTANT) — a second,
 * narrow exception alongside r17-P1's companion one.
 *
 * This suite proves, on the REAL doc:create/doc:update handler path
 * (packages/server/src/net/handlers/doc-handlers.ts):
 *
 *   T6.1/T6.3 — creation + ownership
 *     - a plain PLAYER creates their own character → allowed; ownership is
 *       FORCED to {creator: OWNER}, never a client-forged ownership map.
 *     - the creator can then doc:update their own character (generic OWNER
 *       check, unlocked by the ownership just forced) → allowed.
 *     - a DIFFERENT player cannot update someone else's character → denied.
 *     - the own-character exception does NOT widen Actor creation to other
 *       subtypes (npc/hazard/loot stay GM/ASSISTANT-only — spec 42).
 *
 *   T6.2 — server-side build legality (the client's builder already refuses
 *   to OFFER an illegal choice; this proves the server refuses to PERSIST
 *   one too)
 *     - an archetype-trait feat filed into a "classFeat" slot is refused.
 *     - the same feat filed into "archetypeFeat" is accepted.
 *     - an ability-boost milestone at a level that is not a PF2e boost level
 *       (multiple of 5) is refused.
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
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
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

/** A minimal own-character create payload, forging an ownership map that
 * would (if trusted) hand every player OWNER on it. */
function ownCharacterPayload(name = "Aria"): Record<string, unknown> {
  return {
    name,
    type: "character",
    system: { level: { value: 1 } },
    // Forged: a create payload's ownership must never be trusted verbatim
    // for this exception (see doc-handlers.ts authorizePlayerCharacterCreate).
    ownership: { default: 3 },
  };
}

/** An embedded dedication feat (category "class" + trait "archetype"). */
const DEDICATION_FEAT_PAYLOAD = {
  name: "Test Dedication",
  type: "feat",
  system: { category: "class", level: 2, traits: { value: ["archetype"] } },
};

/** Files the (already-embedded) dedication `itemId` into `slot` at level 2. */
function buildChoiceDiff(
  slot: "classFeat" | "archetypeFeat",
  itemId: string,
): Record<string, unknown> {
  return {
    "system.level.value": 2,
    "system.build.choices": [{ level: 2, slot: `${slot}-2`, type: slot, itemId }],
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Player-owned character create + build legality (pf2e, O6/T6.1-T6.3)", () => {
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
  // T6.1/T6.3 — creation + ownership
  // -------------------------------------------------------------------------

  it("DENIES a plain player creating an NPC Actor (own-character exception does not widen NPC authoring)", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Forged NPC", type: "npc", system: {}, ownership: { default: 0 } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

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

  it("ALLOWS a plain player to create their OWN character", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Actor",
      data: [ownCharacterPayload("Aria")],
    });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
    characterId = doc["_id"] as string;
    version = statsVersion(doc);
    expect(doc["type"]).toBe("character");
    expect(doc["name"]).toBe("Aria");

    // Ownership is FORCED to {creator: OWNER}, never the forged {default: 3}
    // the payload asked for.
    const ownership = doc["ownership"] as Record<string, number>;
    expect(ownership[ctx.ownerUserId]).toBe(3); // OwnershipLevel.OWNER
    expect(ownership["default"]).toBe(0); // OwnershipLevel.NONE — forged default ignored
  });

  it("ALLOWS the creator to edit their own character (generic OWNER check)", async () => {
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        { _id: characterId, diff: { "system.details": { xp: 5 } }, expectedVersion: version },
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
  // T6.2 — server-side build legality
  // -------------------------------------------------------------------------

  let dedicationItemId: string;

  it("(setup) embeds a dedication feat on the owner's own character", async () => {
    // Embedded Item create on an Actor parent is OWNER-gated (r10-C) — this
    // is exactly the path the client's builder uses, and only works because
    // T6.1 gave the creator real OWNER ownership on their own character.
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: characterId },
      data: [DEDICATION_FEAT_PAYLOAD],
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as {
      documents: Array<Record<string, unknown>>;
      parent: Record<string, unknown>;
    };
    dedicationItemId = result.documents[0]!["_id"] as string;
    expect(dedicationItemId).toBeTruthy();
    // The embedded create updates the PARENT (the character) too — track its
    // new version for the next doc:update.
    version = statsVersion(result.parent);
  });

  it("DENIES an update that files an archetype-trait feat into a classFeat slot", async () => {
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: characterId,
          diff: buildChoiceDiff("classFeat", dedicationItemId),
          expectedVersion: version,
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(String(ack["message"])).toContain("FEAT_SLOT_MISMATCH");
    // Rejected — version must not have moved (nothing was persisted).
  });

  it("ALLOWS the same dedication filed into archetypeFeat", async () => {
    const ack = await sendOp(ownerSocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: characterId,
          diff: buildChoiceDiff("archetypeFeat", dedicationItemId),
          expectedVersion: version,
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0]!;
    version = statsVersion(doc);
  });

  it("DENIES an ability-boost milestone at a level that is not a multiple of 5", async () => {
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
});
