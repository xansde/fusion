/**
 * Pack audience enforced by the SERVER (G020).
 *
 * Spec: 43-aba-compendio.md §5.8 — REQ-CPD-070 (manifest declares `audience`,
 * absence means `"all"`), REQ-CPD-071 (a `gm` pack is not listed, not searched
 * and not delivered to a non-privileged viewer, and the refusal is
 * indistinguishable from "does not exist" — REQ-SEC-020), REQ-CPD-072 (the
 * PF2e creature pack ships as `gm`) and REQ-CPD-074 (the decision may not live
 * only in the client). Spec 16: REQ-CMP-010a (the read API imposes the
 * audience server-side).
 *
 * WHY THE REAL PACK: this test drives the COMMITTED `systems/pf2e/packs/
 * bestiary-core`, whose manifest declares `"audience": "gm"`, through the real
 * `boot()` sequence — not a synthetic fixture. A synthetic pack would prove the
 * gate compiles; the real one proves the bestiary a Game Master actually plays
 * with is closed to players today (REQ-CPD-072).
 *
 * WHY THE PAYLOAD, NOT THE SCREEN: every assertion reads the ack the PLAYER's
 * socket receives. Hiding a tab would satisfy nothing here (REQ-CPD-074).
 *
 * HOW INDISTINGUISHABILITY IS ASSERTED: for each read, the player's ack for the
 * hidden pack is compared — whole object, after masking the identifier the
 * CLIENT itself supplied — against the ack for an identifier that was never
 * published. Same code, same message template, same shape: nothing in the
 * answer tells the player whether `pf2e.bestiary-core` exists (REQ-SEC-020).
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
import { reserveFreePort } from "./helpers/ports.js";
import { CompendiumService, resolveSystemPacksDir } from "../compendium/index.js";
import { buildCompendiumI18nBySourceRefHandler } from "../compendium/handlers.js";
import type { HandlerContext, HandlerFn } from "../net/handler-registry.js";

// ---------------------------------------------------------------------------
// The packs under test — committed, not synthetic
// ---------------------------------------------------------------------------

/** Declares `"audience": "gm"` in its committed pack.json (REQ-CPD-072). */
const GM_PACK_ID = "pf2e.bestiary-core";
/** Declares `"audience": "all"` — the control that must stay open to players. */
const PUBLIC_PACK_ID = "pf2e.conditions";
/** Never published by any system — the "does not exist" reference answer. */
const UNKNOWN_PACK_ID = "pf2e.no-such-pack-ever";

/**
 * A creature that lives in the gm pack, with the ORIGIN reference a world copy
 * would carry (`flags.fusion.packName` + `flags.fusion.sourceId`) — the input
 * of `compendium:i18nBySourceRef`, the side door that would otherwise leak the
 * creature's translated name out of a hidden bestiary.
 */
const GM_PACK_CREATURE = {
  packName: "pathfinder-monster-core",
  sourceId: "fLLKuOXwPq1Iq0U4",
  ptName: "Guerreiro Goblin",
};

/** An origin reference no pack resolves — the reference "unknown" answer. */
const UNKNOWN_SOURCE_REF = {
  packName: "pathfinder-monster-core",
  sourceId: "no-such-source-id-at-all",
};

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-cmp-audience-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "cmp_audience_world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

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
      worldTitle: "Compendium Audience World",
      worldSystemId: "pf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: `http://127.0.0.1:${String(port)}`,
      systemId: "pf2e",
    },
  });

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
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

function sendQuery(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit("query", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout for query: ${type}`));
    }, 8000);
  });
}

/**
 * Mask, inside an ack, the identifier the CLIENT supplied in the request, so
 * two acks about two different identifiers become comparable. What survives the
 * masking is everything the SERVER chose to say — code, message template,
 * shape. Two masked acks that are equal carry no signal about which identifier
 * exists (REQ-SEC-020).
 */
function maskId(ack: Record<string, unknown>, id: string): Record<string, unknown> {
  const json = JSON.stringify(ack);
  return JSON.parse(json.split(id).join("<masked-id>")) as Record<string, unknown>;
}

function packIds(ack: Record<string, unknown>): string[] {
  const result = ack["result"] as { packs: Array<{ id: string }> };
  return result.packs.map((p) => p.id);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("pack audience is imposed by the server (REQ-CPD-070, REQ-CPD-071, REQ-CPD-074, REQ-CMP-010a)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  /** A uuid inside the gm pack, learned from the GM's own index. */
  let gmPackUuid: string;
  /** A uuid inside the public pack — the control. */
  let publicPackUuid: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await waitForConnect(gm);
    await waitForConnect(player);

    const gmIndex = await sendQuery(gm, "compendium:index", { packId: GM_PACK_ID });
    const gmEntries = (gmIndex["result"] as { entries: Array<{ uuid: string }> }).entries;
    gmPackUuid = gmEntries[0]!.uuid;

    const publicIndex = await sendQuery(gm, "compendium:index", { packId: PUBLIC_PACK_ID });
    const publicEntries = (publicIndex["result"] as { entries: Array<{ uuid: string }> }).entries;
    publicPackUuid = publicEntries[0]!.uuid;
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  it("REQ-CPD-071 / REQ-CMP-010a: compendium:list does not name the gm pack to a player", async () => {
    const ack = await sendQuery(player, "compendium:list", {});
    expect(ack["ok"]).toBe(true);
    expect(packIds(ack)).not.toContain(GM_PACK_ID);
  });

  it("REQ-CPD-070: a pack declaring audience all stays listed to the player", async () => {
    const ack = await sendQuery(player, "compendium:list", {});
    expect(packIds(ack)).toContain(PUBLIC_PACK_ID);
  });

  it("REQ-CPD-071: the filtered list hides the gm pack too (no filter reopens it)", async () => {
    const ack = await sendQuery(player, "compendium:list", {
      systemId: "pf2e",
      documentType: "Actor",
    });
    expect(ack["ok"]).toBe(true);
    expect(packIds(ack)).not.toContain(GM_PACK_ID);
  });

  it("REQ-CPD-072: the GM does see the committed pf2e creature pack", async () => {
    const ack = await sendQuery(gm, "compendium:list", {});
    expect(ack["ok"]).toBe(true);
    expect(packIds(ack)).toContain(GM_PACK_ID);
  });

  // -------------------------------------------------------------------------
  // index
  // -------------------------------------------------------------------------

  it("REQ-CPD-071: compendium:index on the gm pack answers a player exactly like an unpublished pack", async () => {
    const hidden = await sendQuery(player, "compendium:index", { packId: GM_PACK_ID });
    const unknown = await sendQuery(player, "compendium:index", { packId: UNKNOWN_PACK_ID });

    expect(hidden["ok"]).toBe(false);
    expect(maskId(hidden, GM_PACK_ID)).toEqual(maskId(unknown, UNKNOWN_PACK_ID));
  });

  it("REQ-CPD-072: the same compendium:index call returns entries to the GM", async () => {
    const ack = await sendQuery(gm, "compendium:index", { packId: GM_PACK_ID });
    expect(ack["ok"]).toBe(true);
    const entries = (ack["result"] as { entries: unknown[] }).entries;
    expect(entries.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  it("REQ-CPD-071: compendium:search over the gm pack yields no entry to a player, and answers like an unpublished pack", async () => {
    const hidden = await sendQuery(player, "compendium:search", { packId: GM_PACK_ID });
    const unknown = await sendQuery(player, "compendium:search", { packId: UNKNOWN_PACK_ID });

    expect(hidden["ok"]).toBe(false);
    expect(hidden["result"]).toBeUndefined();
    expect(maskId(hidden, GM_PACK_ID)).toEqual(maskId(unknown, UNKNOWN_PACK_ID));
  });

  it("REQ-CPD-071: a text search a player CAN run never returns a document of the gm pack", async () => {
    // "goblin" matches a creature in the hidden bestiary; the player searching
    // the packs he can see must not receive it from any of them.
    const listAck = await sendQuery(player, "compendium:list", {});
    for (const packId of packIds(listAck)) {
      const ack = await sendQuery(player, "compendium:search", { packId, text: "goblin" });
      expect(ack["ok"]).toBe(true);
      const entries = (ack["result"] as { entries: Array<{ uuid: string }> }).entries;
      for (const entry of entries) {
        expect(entry.uuid.startsWith(`Compendium.${GM_PACK_ID}.`)).toBe(false);
      }
    }
  });

  it("REQ-CPD-072: the GM's search over the creature pack does return entries", async () => {
    const ack = await sendQuery(gm, "compendium:search", { packId: GM_PACK_ID, text: "goblin" });
    expect(ack["ok"]).toBe(true);
    const entries = (ack["result"] as { entries: unknown[] }).entries;
    expect(entries.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  it("REQ-CPD-071 / REQ-SEC-020: compendium:get with a REAL uuid of the gm pack answers a player like a made-up uuid", async () => {
    const madeUp = `Compendium.${UNKNOWN_PACK_ID}.Actor.doesnotexist`;
    const hidden = await sendQuery(player, "compendium:get", { uuid: gmPackUuid });
    const unknown = await sendQuery(player, "compendium:get", { uuid: madeUp });

    expect(hidden["ok"]).toBe(false);
    expect(hidden["result"]).toBeUndefined();
    expect(maskId(hidden, gmPackUuid)).toEqual(maskId(unknown, madeUp));
  });

  it("REQ-CPD-072 / REQ-CPD-074: the very same uuid loads for the GM — the player's refusal was the audience, not a broken uuid", async () => {
    const ack = await sendQuery(gm, "compendium:get", { uuid: gmPackUuid });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { document: Record<string, unknown> }).document;
    expect(typeof doc["name"]).toBe("string");
  });

  it("REQ-CPD-070: a document of the audience-all pack still loads for the player", async () => {
    const ack = await sendQuery(player, "compendium:get", { uuid: publicPackUuid });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { document: Record<string, unknown> }).document;
    expect(typeof doc["name"]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// i18nBySourceRef — the translation side door
//
// Exercised by invoking the handler with a HandlerContext instead of over a
// socket: `compendium:i18nBySourceRef` is registered in socket-manager.ts but
// is NOT one of the literals in shared's envelope type union, so a real socket
// envelope carrying it is rejected up front with "Malformed envelope" (see
// compendium-source-ref.test.ts, which invokes the handler the same way). That
// unreachability is a pre-existing gap of issue #43, not of this audience gate
// — and the gate must already be in place for the day the type is admitted.
// The role still comes from the ctx, never from the payload.
// ---------------------------------------------------------------------------

describe("compendium:i18nBySourceRef obeys the pack audience (REQ-CPD-071, REQ-CMP-010a)", () => {
  const PLAYER_CTX: HandlerContext = { userId: "p1", role: Role.PLAYER, worldId: "w1" };
  const GM_CTX: HandlerContext = { userId: "gm1", role: Role.GAMEMASTER, worldId: "w1" };

  function buildHandler(): HandlerFn {
    const svc = new CompendiumService();
    const packsDir = resolveSystemPacksDir("pf2e");
    if (packsDir === null) throw new Error("Committed pf2e packs not found");
    svc.discoverPacks(packsDir, "pf2e");
    return buildCompendiumI18nBySourceRefHandler({
      compendium: svc,
      db: undefined as never,
      ns: undefined as never,
    });
  }

  it("REQ-CPD-071: a player gets no translation for a creature of the gm pack — the same answer an unknown reference gets", async () => {
    const handler = buildHandler();

    const hidden = await handler(
      { packName: GM_PACK_CREATURE.packName, sourceId: GM_PACK_CREATURE.sourceId },
      PLAYER_CTX,
    );
    const unknown = await handler(UNKNOWN_SOURCE_REF, PLAYER_CTX);

    expect(hidden).toEqual(unknown);
    expect(hidden.ok).toBe(true);
    if (hidden.ok) {
      expect((hidden.result as { i18n: unknown }).i18n).toBeNull();
    }
  });

  it("REQ-CPD-072: the GM does get the pt-BR name for the same creature", async () => {
    const handler = buildHandler();

    const ack = await handler(
      { packName: GM_PACK_CREATURE.packName, sourceId: GM_PACK_CREATURE.sourceId },
      GM_CTX,
    );

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      const i18n = (ack.result as { i18n: { name: string } | null }).i18n;
      expect(i18n?.name).toBe(GM_PACK_CREATURE.ptName);
    }
  });
});
