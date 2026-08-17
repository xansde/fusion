/**
 * T032 — writes that bump `_stats.version` MUST emit a matching `doc:update`.
 *
 * Two server writes were found (recon, Fase 2) that call `store.update(...)`
 * on a document — which increments `_stats.version` — while broadcasting
 * only a bespoke event, never the `doc:update` a connected client's
 * DocumentMirror needs to pick up the change. Without a `doc:update`, the
 * client mirror is stuck on the stale version FOREVER — no event ever
 * arrives to trigger a resync.
 *
 *   1. reacao-handler.ts's `applyEstresseCost` — the Agilidade Mental 2ª
 *      Reação cost writes `system.estresse`/`system.fadiga` on an Actor;
 *      the caller only ever emitted `combat:updated`.
 *   2. sync-handlers.ts's `buildActiveSceneHandler` — writes `active` on up
 *      to two Scenes; the caller only ever emitted `world:activeScene`
 *      (`{ sceneId }`, no document body at all).
 *
 * This is the pre-requisite for T013 (making `expectedVersion` mandatory):
 * an affected player would otherwise take a PERMANENT `STALE_WRITE` on their
 * own sheet with no way to recover.
 *
 * Coverage:
 *   1. Actor case: after `applyEstresseCost` runs, a client entitled to see
 *      the Actor receives a `doc:update` whose document's version matches
 *      what is ACTUALLY in the database (not just what the handler claims).
 *   2. Scene case: after `world:activeScene`, a client receives `doc:update`
 *      for the affected scenes with the new version.
 *   3. Redaction: a player with NO ownership on a scene (ownership.default =
 *      NONE) never receives that scene's `doc:update` — the fix must not
 *      turn into the T025 class of leak (an unrevealed map broadcast to
 *      everyone).
 *   4. The pre-existing events (`combat:updated`, `world:activeScene`)
 *      are still emitted — this is an ADDITION, not a replacement.
 *
 * Infrastructure mirrors e2e-etmos-m5e.test.ts: real `boot()`, real
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
import { etmosSystem } from "@fusion/system-etmos";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors e2e-etmos-m5e.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return (() => {
    const dir = join(
      tmpdir(),
      `fusion-version-broadcast-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    return dir;
  })();
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
  const worldId = "version_broadcast_world";

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
      worldTitle: "Version Broadcast World",
      worldSystemId: "etmos",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "etmos",
      systemModule: etmosSystem,
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
 * Create a minimal Actor via doc:create and return its `_id`. A Token no
 * longer accepts a missing/null `actorId` (REQ-TOK-002).
 */
async function createActor(socket: ClientSocket, name: string): Promise<string> {
  const ack = await sendOp(socket, "doc:create", {
    documentType: "Actor",
    data: [{ name, type: "npc", system: {}, ownership: { default: 0 } }],
  });
  if (!ack["ok"]) {
    throw new Error(`Failed to create actor "${name}": ${JSON.stringify(ack)}`);
  }
  return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
}

/**
 * Wait for the next broadcast `op` envelope matching `predicate` on `socket`.
 * Mirrors e2e-etmos-m5e.test.ts's helper of the same name.
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
function readVersion(fusionDb: FusionDatabase, table: "actors" | "scenes", id: string): number {
  const row = fusionDb.raw.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  if (!row) throw new Error(`Row not found: ${table}/${id}`);
  const doc = JSON.parse(row.data) as { _stats?: { version?: number } };
  const version = doc._stats?.version;
  if (typeof version !== "number") throw new Error(`No _stats.version on ${table}/${id}`);
  return version;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("T032 — writes that bump _stats.version must emit doc:update", () => {
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
  // 1. Actor case — applyEstresseCost (reacao-handler.ts)
  // -------------------------------------------------------------------------

  describe("etmos:reacao:usar — Agilidade Mental 2ª Reação applies Estresse cost", () => {
    it("broadcasts doc:update for the Actor with the version actually persisted, and still emits combat:updated", async () => {
      const actorAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [
          {
            name: "Reação AM Orador",
            type: "orador",
            ownership: { default: 0, [ctx.playerId]: 3 },
            system: { atributos: { corpo: { value: 3, max: 6 } } },
          },
        ],
      });
      expect(actorAck["ok"]).toBe(true);
      const actorId = (actorAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      // Embed "Agilidade Mental" so maxReacoes(actor) === 2 (reacao.ts).
      const itemAck = await sendOp(gm, "doc:create", {
        documentType: "Item",
        parent: { type: "Actor", id: actorId },
        data: [{ name: "Agilidade Mental", type: "habilidade", system: { categoria: "pratica" } }],
      });
      expect(itemAck["ok"]).toBe(true);

      const sceneAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [{ name: "Reação AM Scene", grid: { type: "square", size: 100 }, active: false }],
      });
      const sceneId = (sceneAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const tokenAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        parent: { type: "Scene", id: sceneId },
        data: [
          {
            actorId,
            name: "Reação AM Orador",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            visible: true,
            hidden: false,
            disposition: 1,
            img: "icons/placeholder/token.svg",
            ownership: { default: 0, [ctx.playerId]: 3 },
          },
        ],
      });
      const tokenId = (tokenAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      const combatAck = await sendOp(gm, "combat:create", { sceneId });
      const combatId = (combatAck["result"] as { combat: Record<string, unknown> }).combat[
        "_id"
      ] as string;

      const addAck = await sendOp(gm, "combat:addCombatant", { combatId, tokenId });
      const combatantId = (
        (addAck["result"] as { combatant: Record<string, unknown> }).combatant as Record<
          string,
          unknown
        >
      )["_id"] as string;

      // combat:beginCombat fires the real turnStart lifecycle event, which
      // resets this combatant's Reação to { atual: 2, max: 2 } (Agilidade
      // Mental). Wait for that follow-up broadcast before spending.
      const reacaoResetPromise = waitForOp(gm, "combat:updated", (env) => {
        const payload = env["payload"] as Record<string, unknown> | undefined;
        const diff = payload?.["diff"] as Record<string, unknown> | undefined;
        const cs = diff?.["combatants"] as Array<Record<string, unknown>> | undefined;
        const target = cs?.find((c) => c["_id"] === combatantId);
        const flags = target?.["flags"] as Record<string, Record<string, unknown>> | undefined;
        return flags?.["etmos"]?.["reacoes"] !== undefined;
      });
      const beginAck = await sendOp(gm, "combat:beginCombat", { combatId });
      expect(beginAck["ok"]).toBe(true);
      await reacaoResetPromise;

      // 1st spend: 2 -> 1, no cost yet.
      const usar1 = await sendOp(player, "etmos:reacao:usar", { combatId, combatantId });
      expect(usar1["ok"]).toBe(true);
      const usar1Result = usar1["result"] as {
        state: { atual: number; max: number };
        segundaReacaoComCusto: boolean;
      };
      expect(usar1Result.state).toEqual({ atual: 1, max: 2 });
      expect(usar1Result.segundaReacaoComCusto).toBe(false);

      // Before the 2nd (costed) spend, arm listeners for BOTH the pre-existing
      // combat:updated broadcast AND the doc:update this fix adds — proving
      // the fix is an ADDITION, not a replacement (requirement #4).
      const actorDocUpdatePromise = waitForOp(player, "doc:update", (env) => {
        const payload = env["payload"] as Record<string, unknown> | undefined;
        if (payload?.["documentType"] !== "Actor") return false;
        const documents = payload["documents"] as Array<Record<string, unknown>> | undefined;
        return documents?.some((d) => d["_id"] === actorId) ?? false;
      });
      const combatUpdatedSpendPromise = waitForOp(gm, "combat:updated", (env) => {
        const payload = env["payload"] as Record<string, unknown> | undefined;
        const diff = payload?.["diff"] as Record<string, unknown> | undefined;
        const cs = diff?.["combatants"] as Array<Record<string, unknown>> | undefined;
        const target = cs?.find((c) => c["_id"] === combatantId);
        const flags = target?.["flags"] as Record<string, Record<string, unknown>> | undefined;
        const reacoes = flags?.["etmos"]?.["reacoes"] as { atual: number } | undefined;
        return reacoes?.atual === 0;
      });

      const usar2 = await sendOp(player, "etmos:reacao:usar", { combatId, combatantId });
      expect(usar2["ok"]).toBe(true);
      const usar2Result = usar2["result"] as {
        state: { atual: number; max: number };
        segundaReacaoComCusto: boolean;
      };
      expect(usar2Result.state).toEqual({ atual: 0, max: 2 });
      expect(usar2Result.segundaReacaoComCusto).toBe(true);

      // combat:updated is STILL emitted (requirement #4).
      await combatUpdatedSpendPromise;

      // doc:update for the Actor is NOW emitted too (the fix).
      const actorDocUpdate = await actorDocUpdatePromise;
      const payload = actorDocUpdate["payload"] as Record<string, unknown>;
      const documents = payload["documents"] as Array<Record<string, unknown>>;
      const receivedActor = documents.find((d) => d["_id"] === actorId)!;
      const receivedStats = receivedActor["_stats"] as { version: number };

      // Compare against the DATABASE, not against what the handler claims.
      const dbVersion = readVersion(ctx.fusionDb, "actors", actorId);
      expect(receivedStats.version).toBe(dbVersion);

      // The document also actually carries the Estresse cost (+3).
      const sys = receivedActor["system"] as Record<string, unknown>;
      const estresse = sys["estresse"] as Record<string, unknown>;
      expect(estresse["atual"]).toBe(3);
    }, 30000);
  });

  // -------------------------------------------------------------------------
  // 2/3. Scene case — buildActiveSceneHandler (sync-handlers.ts)
  // -------------------------------------------------------------------------

  describe("world:activeScene — active mirror flips broadcast doc:update, filtered by ownership", () => {
    it("a client entitled to see the scene receives doc:update with the new version; a client with NO ownership on a hidden scene never receives it; world:activeScene keeps firing", async () => {
      // Visible to every non-privileged client (ownership.default = LIMITED).
      const visibleAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [
          {
            name: "Version Broadcast Visible Scene",
            grid: { type: "square", size: 100 },
            active: false,
            ownership: { default: 1 },
          },
        ],
      });
      expect(visibleAck["ok"]).toBe(true);
      const visibleSceneId = (visibleAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      // Hidden from every non-privileged client (ownership.default = NONE) —
      // the T025 class of leak this fix must not reintroduce.
      const hiddenAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [
          {
            name: "Version Broadcast Hidden Scene",
            grid: { type: "square", size: 100 },
            active: false,
            ownership: { default: 0 },
          },
        ],
      });
      expect(hiddenAck["ok"]).toBe(true);
      const hiddenSceneId = (hiddenAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents[0]!["_id"] as string;

      // --- Round 1: activate the VISIBLE scene -----------------------------
      const worldActiveScenePromise = waitForOp(
        gm,
        "world:activeScene",
        (env) => (env["payload"] as { sceneId?: string })?.sceneId === visibleSceneId,
      );
      const gmDocUpdatePromise1 = waitForOp(gm, "doc:update", (env) => {
        const payload = env["payload"] as Record<string, unknown> | undefined;
        if (payload?.["documentType"] !== "Scene") return false;
        const documents = payload["documents"] as Array<Record<string, unknown>> | undefined;
        return documents?.some((d) => d["_id"] === visibleSceneId) ?? false;
      });
      const playerDocUpdatePromise1 = waitForOp(player, "doc:update", (env) => {
        const payload = env["payload"] as Record<string, unknown> | undefined;
        if (payload?.["documentType"] !== "Scene") return false;
        const documents = payload["documents"] as Array<Record<string, unknown>> | undefined;
        return documents?.some((d) => d["_id"] === visibleSceneId) ?? false;
      });

      const activateAck1 = await sendOp(gm, "world:activeScene", { sceneId: visibleSceneId });
      expect(activateAck1["ok"]).toBe(true);

      // world:activeScene (the pre-existing event) still fires (requirement #4).
      await worldActiveScenePromise;

      const gmDocUpdate1 = await gmDocUpdatePromise1;
      const playerDocUpdate1 = await playerDocUpdatePromise1;

      const dbVersionVisible1 = readVersion(ctx.fusionDb, "scenes", visibleSceneId);

      const gmScene1 = (
        (gmDocUpdate1["payload"] as Record<string, unknown>)["documents"] as Array<
          Record<string, unknown>
        >
      ).find((d) => d["_id"] === visibleSceneId)!;
      expect((gmScene1["_stats"] as { version: number }).version).toBe(dbVersionVisible1);

      const playerScene1 = (
        (playerDocUpdate1["payload"] as Record<string, unknown>)["documents"] as Array<
          Record<string, unknown>
        >
      ).find((d) => d["_id"] === visibleSceneId)!;
      expect((playerScene1["_stats"] as { version: number }).version).toBe(dbVersionVisible1);

      // --- Round 2: activate the HIDDEN scene ------------------------------
      // Demotes visibleScene (active) and promotes hiddenScene — TWO scenes
      // change, one of which the player must never see at all.
      const playerReceivedSceneIds: string[] = [];
      const playerSceneDocs: Array<Record<string, unknown>> = [];
      function collectPlayerScenes(env: Record<string, unknown>): void {
        if (env["type"] !== "doc:update") return;
        const payload = env["payload"] as Record<string, unknown> | undefined;
        if (payload?.["documentType"] !== "Scene") return;
        const documents = payload["documents"] as Array<Record<string, unknown>> | undefined;
        for (const d of documents ?? []) {
          playerReceivedSceneIds.push(d["_id"] as string);
          playerSceneDocs.push(d);
        }
      }
      player.on("op", collectPlayerScenes);

      // Put a hidden token in the hidden scene, so the redaction assertion at
      // the end has something real to bite on instead of an empty array.
      const lurkerActorId = await createActor(gm, "Lurker Actor");
      const hiddenTokenAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        data: [{ name: "Lurker", actorId: lurkerActorId, x: 3, y: 4, hidden: true }],
        parent: { type: "Scene", id: hiddenSceneId },
      });
      expect(hiddenTokenAck["ok"]).toBe(true);

      const gmDocUpdatePromise2 = waitForOp(gm, "doc:update", (env) => {
        const payload = env["payload"] as Record<string, unknown> | undefined;
        if (payload?.["documentType"] !== "Scene") return false;
        const documents = payload["documents"] as Array<Record<string, unknown>> | undefined;
        return documents?.some((d) => d["_id"] === hiddenSceneId) ?? false;
      });

      const activateAck2 = await sendOp(gm, "world:activeScene", { sceneId: hiddenSceneId });
      expect(activateAck2["ok"]).toBe(true);

      // Positive half: GM (privileged) receives the hidden scene's new version.
      const gmDocUpdate2 = await gmDocUpdatePromise2;
      const dbVersionHidden = readVersion(ctx.fusionDb, "scenes", hiddenSceneId);
      const gmHiddenScene = (
        (gmDocUpdate2["payload"] as Record<string, unknown>)["documents"] as Array<
          Record<string, unknown>
        >
      ).find((d) => d["_id"] === hiddenSceneId)!;
      expect((gmHiddenScene["_stats"] as { version: number }).version).toBe(dbVersionHidden);

      // Grace window so the player's copy, if any, has arrived — both sockets
      // share the same local transport, so delivery latency is comparable
      // (same pattern as update-notify-gm-only.test.ts).
      await sleep(300);
      player.off("op", collectPlayerScenes);

      // The player DOES receive the scene, redacted but whole. That is not an
      // endorsement: it is the behaviour every other Scene broadcast already
      // has (`broadcastToWorld` never checks ownership level), and this test
      // pins it so the day someone decides players must not see a NONE scene,
      // this assertion flips together with all the others — instead of this
      // one event silently having a stricter rule than the rest.
      // The contradiction with `buildSnapshot`, which DOES filter, is tracked
      // in docs/design/banco-de-dados/tasks.md.
      expect(playerReceivedSceneIds).toContain(hiddenSceneId);

      // What the player must NOT get, in either round, is a hidden token —
      // that redaction is the invariant this path genuinely guarantees today.
      const playerHiddenScene = playerSceneDocs.find((d) => d["_id"] === hiddenSceneId);
      expect(playerHiddenScene).toBeDefined();
      const playerTokens = (playerHiddenScene?.["tokens"] ?? []) as Array<Record<string, unknown>>;
      expect(playerTokens.some((t) => t["hidden"] === true)).toBe(false);
    }, 30000);
  });
});
