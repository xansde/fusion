/**
 * T036 — Combat writes bump `_stats.version` without ever emitting a matching
 * `doc:update`.
 *
 * `store.update("combats", ...)` increments `_stats.version` on every combat
 * write (the same STALE_WRITE/`expectedVersion` counter doc-handlers.ts
 * checks, and the one T013 will make mandatory). The only broadcast every
 * combat write emits is `combat:updated`, whose payload is
 * `{combatId, diff, seq}` — it never carries `_stats`. A connected client's
 * `DocumentMirror._handleCombatUpdated` merges the diff with
 * `{...existing, ...diff}`, so the local `_stats.version` never advances.
 * Combat is in `TYPE_TO_TABLE` (doc-handlers.ts) — gravable by `doc:update`
 * with `expectedVersion` — so once T013 makes that field mandatory, every
 * write against a Combat document would be rejected as STALE_WRITE forever.
 *
 * The fix is combat-handlers.ts's shared `broadcastCombatVersionUpdate`
 * helper, and mirrors the T032 fix already proven for Scene/Actor in
 * version-broadcast.test.ts.
 *
 * Coverage:
 *   1. combat-handlers.ts's shared `broadcastUpdate` funnel (exercised via
 *      combat:setDefeated): a client receives a `doc:update` for the Combat
 *      whose `_stats.version` matches what is ACTUALLY in the database (not
 *      just what the handler claims), and `combat:updated` keeps firing.
 *   2. combat-handlers.ts's OTHER, manual emission site
 *      (buildCombatSetHiddenHandler, exercised via combat:setHidden): same
 *      version-sync guarantee, PLUS the redaction invariant this path must
 *      never break — a player never receives a hidden combatant via the new
 *      `doc:update`, while the GM does.
 *
 * Infrastructure mirrors version-broadcast.test.ts: real `boot()`, real
 * socket.io GM + PLAYER sockets, real `op` envelopes — not manual
 * SocketManager wiring — so the fix is proven reachable end-to-end.
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
import { stubSystem } from "@fusion/system-stub";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors version-broadcast.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-combat-version-broadcast-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerId: string;
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "combat_version_broadcast_world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

  const { user: player } = await authService.createUser({
    name: "player-1",
    role: 1, // PLAYER
    password: "player-password-123",
  });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-password-123",
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
      worldTitle: "Combat Version Broadcast World",
      worldSystemId: "stub",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "stub",
      systemModule: stubSystem,
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
    playerToken: playerLogin.accessToken,
    playerId: player.id,
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

/**
 * Wait for the next broadcast `op` envelope matching `predicate` on `socket`.
 * Mirrors version-broadcast.test.ts's helper of the same name.
 */
function waitForOp(
  socket: ClientSocket,
  type: string,
  predicate: (env: Record<string, unknown>) => boolean = () => true,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for op: ${type}`)), 8000);
    function handler(env: Record<string, unknown>): void {
      if (env["type"] === type && predicate(env)) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    }
    socket.on("op", handler);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read `_stats.version` straight from the database row — the source of
 * truth this suite compares broadcasts against, per the repo's own
 * discipline against circular tests (never assert a handler's claim against
 * itself; assert it against the bank).
 */
function readCombatVersion(fusionDb: FusionDatabase, combatId: string): number {
  const row = fusionDb.raw.prepare(`SELECT data FROM combats WHERE id = ?`).get(combatId) as
    | { data: string }
    | undefined;
  if (!row) throw new Error(`Row not found: combats/${combatId}`);
  const doc = JSON.parse(row.data) as { _stats?: { version?: number } };
  const version = doc._stats?.version;
  if (typeof version !== "number") throw new Error(`No _stats.version on combats/${combatId}`);
  return version;
}

function findCombatDoc(
  env: Record<string, unknown>,
  combatId: string,
): Record<string, unknown> | undefined {
  const payload = env["payload"] as Record<string, unknown> | undefined;
  if (payload?.["documentType"] !== "Combat") return undefined;
  const documents = payload["documents"] as Array<Record<string, unknown>> | undefined;
  return documents?.find((d) => d["_id"] === combatId);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("T036 — Combat writes that bump _stats.version must emit doc:update", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gm.connect();
    player.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(player)]);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // 1. combat-handlers.ts — broadcastUpdate() funnel (combat:setDefeated)
  // -------------------------------------------------------------------------

  describe("combat:setDefeated — the shared broadcastUpdate() funnel", () => {
    it("broadcasts doc:update for the Combat with the version actually persisted, and still emits combat:updated", async () => {
      const sceneAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [{ name: "Defeated Scene", grid: { type: "square", size: 100 }, active: false }],
      });
      const sceneId = (sceneAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const combatAck = await sendOp(gm, "combat:create", { sceneId });
      const combatId = (combatAck["result"] as { combat: Record<string, unknown> }).combat[
        "_id"
      ] as string;

      const addAck = await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: "t-defeat",
        hidden: false,
      });
      const combatantId = (
        (addAck["result"] as { combatant: Record<string, unknown> }).combatant as Record<
          string,
          unknown
        >
      )["_id"] as string;

      const combatUpdatedPromise = waitForOp(gm, "combat:updated", (env) => {
        const payload = env["payload"] as Record<string, unknown> | undefined;
        return payload?.["combatId"] === combatId;
      });
      const docUpdatePromise = waitForOp(
        gm,
        "doc:update",
        (env) => findCombatDoc(env, combatId) !== undefined,
      );

      const toggleAck = await sendOp(gm, "combat:setDefeated", {
        combatId,
        combatantId,
        defeated: true,
      });
      expect(toggleAck["ok"]).toBe(true);

      // combat:updated (the pre-existing event) still fires — requirement.
      await combatUpdatedPromise;

      const docUpdateEnv = await docUpdatePromise;
      const receivedCombat = findCombatDoc(docUpdateEnv, combatId)!;
      const receivedStats = receivedCombat["_stats"] as { version: number };

      // Compare against the DATABASE, not against what the handler claims.
      const dbVersion = readCombatVersion(ctx.fusionDb, combatId);
      expect(receivedStats.version).toBe(dbVersion);

      // The document also actually carries the toggled state.
      const combatants = receivedCombat["combatants"] as Array<Record<string, unknown>>;
      const target = combatants.find((c) => c["_id"] === combatantId);
      expect(target?.["defeated"]).toBe(true);
    }, 30000);
  });

  // -------------------------------------------------------------------------
  // 2. combat-handlers.ts — buildCombatSetHiddenHandler's manual emit site,
  //    PLUS the redaction invariant.
  // -------------------------------------------------------------------------

  describe("combat:setHidden — the other manual-emit site, and redaction", () => {
    it("a GM receives the hidden combatant via doc:update with the DB version; a player never does", async () => {
      // Attach the player collector FIRST, before any op is sent, so this
      // assertion never depends on cross-socket delivery timing (the GM's ack
      // and the player's own broadcast travel over two different
      // connections with no ordering guarantee between them — attaching the
      // listener "after awaiting the GM's ack" would race a late-arriving
      // pre-hide broadcast). Filtering by the post-hide `_stats.version`
      // below is what actually pins down "the broadcast this fix produced",
      // not attach timing.
      // combatId doesn't exist yet at attach time, so collect every Combat
      // doc:update unconditionally here; filtered by combatId + version below.
      const playerReceivedCombats: Array<Record<string, unknown>> = [];
      function collectPlayerCombat(env: Record<string, unknown>): void {
        const payload = env["payload"] as Record<string, unknown> | undefined;
        if (payload?.["documentType"] !== "Combat") return;
        const documents = payload["documents"] as Array<Record<string, unknown>> | undefined;
        for (const d of documents ?? []) playerReceivedCombats.push(d);
      }
      player.on("op", collectPlayerCombat);

      const sceneAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [{ name: "Hidden Scene", grid: { type: "square", size: 100 }, active: false }],
      });
      const sceneId = (sceneAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const combatAck = await sendOp(gm, "combat:create", { sceneId });
      const combatId = (combatAck["result"] as { combat: Record<string, unknown> }).combat[
        "_id"
      ] as string;

      // One visible PC, one NPC that starts visible and is hidden below —
      // this exercises the toggle (not just "already hidden at add time").
      const pcAddAck = await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: "t-pc-sh",
        hidden: false,
        initiative: 20,
      });
      const pcCombatantId = (
        (pcAddAck["result"] as { combatant: Record<string, unknown> }).combatant as Record<
          string,
          unknown
        >
      )["_id"] as string;

      const npcAddAck = await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: "t-npc-sh",
        hidden: false,
        initiative: 10,
      });
      const npcCombatantId = (
        (npcAddAck["result"] as { combatant: Record<string, unknown> }).combatant as Record<
          string,
          unknown
        >
      )["_id"] as string;

      const gmDocUpdatePromise = waitForOp(
        gm,
        "doc:update",
        (env) => findCombatDoc(env, combatId) !== undefined,
      );

      const setHiddenAck = await sendOp(gm, "combat:setHidden", {
        combatId,
        combatantId: npcCombatantId,
        hidden: true,
      });
      expect(setHiddenAck["ok"]).toBe(true);

      // --- GM side: full document, version matches the database -----------
      const gmDocUpdateEnv = await gmDocUpdatePromise;
      const gmCombat = findCombatDoc(gmDocUpdateEnv, combatId)!;
      const gmStats = gmCombat["_stats"] as { version: number };
      const dbVersion = readCombatVersion(ctx.fusionDb, combatId);
      expect(gmStats.version).toBe(dbVersion);

      const gmCombatants = gmCombat["combatants"] as Array<Record<string, unknown>>;
      expect(gmCombatants.some((c) => c["_id"] === npcCombatantId && c["hidden"] === true)).toBe(
        true,
      );

      // --- Player side: the hidden combatant must NEVER arrive -------------
      // Grace window so the player's copy of the post-hide broadcast — sent
      // over a DIFFERENT socket than the GM's, with no cross-socket delivery
      // ordering guarantee — has time to arrive.
      await sleep(300);
      player.off("op", collectPlayerCombat);

      // Isolate the broadcast THIS fix produced: the one carrying the
      // post-hide version. Earlier broadcasts for this same combatId (e.g.
      // the NPC's own combat:addCombatant, sent while it was still visible)
      // legitimately DID carry the NPC's id at the time — that is not a
      // leak, so asserting on every received doc regardless of version would
      // be a test bug, not a real invariant.
      const postHideCombats = playerReceivedCombats.filter(
        (d) =>
          d["_id"] === combatId &&
          ((d["_stats"] as { version?: number } | undefined)?.version ?? -1) === dbVersion,
      );
      expect(postHideCombats.length).toBeGreaterThan(0);

      for (const combat of postHideCombats) {
        const combatants = (combat["combatants"] ?? []) as Array<Record<string, unknown>>;
        expect(combatants.some((c) => c["_id"] === npcCombatantId)).toBe(false);
        expect(combatants.some((c) => c["hidden"] === true)).toBe(false);
        // The visible PC is still there — this is redaction, not blackout.
        expect(combatants.some((c) => c["_id"] === pcCombatantId)).toBe(true);
      }

      // --- And the same must hold on the REPLAY path ----------------------
      // The live broadcast redacts per socket, but the envelope pushed into
      // the op buffer is the GM-visible one. A player who reconnects inside
      // the buffer window replays it through filterOpsForRole — which, until
      // this fix, only ever redacted Scene. Reconnecting after the GM hid a
      // combatant would have been a way to read exactly what was hidden.
      const resyncAck = await sendOp(player, "resync:request", { lastSeq: 0 });
      expect(resyncAck["ok"]).toBe(true);
      const resyncResult = resyncAck["result"] as {
        type: string;
        payload: { ops?: Array<Record<string, unknown>> };
      };

      // A full snapshot means the buffer window was missed — then this case
      // proves nothing and the test would be silently vacuous.
      expect(resyncResult.type).toBe("delta");
      const replayedCombats = (resyncResult.payload.ops ?? []).flatMap((op) => {
        const payload = op["payload"] as Record<string, unknown> | undefined;
        if (payload?.["documentType"] !== "Combat") return [];
        return (payload["documents"] ?? []) as Array<Record<string, unknown>>;
      });
      const replayedPostHide = replayedCombats.filter(
        (d) =>
          d["_id"] === combatId &&
          ((d["_stats"] as { version?: number } | undefined)?.version ?? -1) === dbVersion,
      );
      expect(replayedPostHide.length).toBeGreaterThan(0);
      for (const combat of replayedPostHide) {
        const combatants = (combat["combatants"] ?? []) as Array<Record<string, unknown>>;
        expect(combatants.some((c) => c["_id"] === npcCombatantId)).toBe(false);
        expect(combatants.some((c) => c["hidden"] === true)).toBe(false);
        expect(combatants.some((c) => c["_id"] === pcCombatantId)).toBe(true);
      }
    }, 30000);
  });
});
