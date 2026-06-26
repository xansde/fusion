/**
 * M2-C adversarial redaction tests — hidden combatants must NEVER reach a
 * non-GM socket through ANY emission path:
 *   1. join snapshot (resync:full)           — buildSnapshot
 *   2. live broadcast (combat:updated)        — broadcastCombatUpdate
 *   3. delta resync replay (resync:delta)     — filterOpsForRole
 *   4. op ack echoed to requester             — redactAckResultForNonPrivileged
 *
 * Spec: 10-combate-e-iniciativa.md §REQ-CBT-031..033, §REQ-CBT-NFR-002
 *
 * These mirror the style of the hidden-token adversarial tests (M1-C) but for
 * embedded combatants.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { PROTOCOL_VERSION } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Harness (compact — mirrors combat-m2c.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-combat-redact-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  playerToken: string;
  playerUserId: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "combat-redact-world";

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

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Combat Redact World", systemId: "stub" },
  });
  await fastify.listen({ port: 0, host: "127.0.0.1" });

  const address = fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: `http://127.0.0.1:${String(port)}`,
  });
  socketManager.registerWorldNamespace({ worldId, db: fusionDb.raw, secret, authService });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(port: number, worldId: string, auth: Record<string, unknown>): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth,
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 8000);
  });
}

/** Collect the resync:full snapshot the server pushes on join. */
function waitForSnapshot(socket: ClientSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for snapshot")), timeoutMs);
    const handler = (env: Record<string, unknown>) => {
      if (env["type"] === "resync:full") {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

/** Wait for the next socket event matching a predicate. */
function waitForOp(
  socket: ClientSocket,
  predicate: (env: Record<string, unknown>) => boolean,
  timeoutMs = 4000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for op event")), timeoutMs);
    const handler = (env: Record<string, unknown>) => {
      if (predicate(env)) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

/** Collect the resync:delta the server pushes on reconnect with a lastSeq. */
function waitForDelta(socket: ClientSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for delta")), timeoutMs);
    const handler = (env: Record<string, unknown>) => {
      if (env["type"] === "resync:delta") {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("M2-C hidden combatant redaction (adversarial)", { timeout: 30000 }, () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await drain();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  /**
   * GM sets up a combat with one visible PC + one hidden NPC; returns ids.
   *
   * When `hiddenActiveFirst` is true the hidden NPC is given the higher
   * initiative so that, once combat starts at turnIndex 0, the ACTIVE combatant
   * is the hidden NPC — the scenario that exercises activeCombatantId masking
   * (issue M2-C #1/#4).
   */
  async function setupCombatWithHidden(
    opts: { hiddenActiveFirst?: boolean } = {},
  ): Promise<{ combatId: string; sceneId: string; pcCombatantId: string; npcCombatantId: string }> {
    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Redact Scene", width: 1000, height: 1000 }],
    });
    const sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]!["_id"] as string;

    const pcAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        { name: "Visible PC", type: "character", ownership: { default: 0, [ctx.playerUserId]: 3 } },
      ],
    });
    const pcActorId = (
      (pcAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]!["_id"] as string;

    const npcAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [{ name: "Hidden NPC", type: "npc", ownership: { default: 0 } }],
    });
    const npcActorId = (
      (npcAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]!["_id"] as string;

    const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
    const combatId = (
      (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
    )["_id"] as string;

    // Initiatives: when hiddenActiveFirst, the hidden NPC sorts above the PC so
    // it is the active combatant at turnIndex 0. Otherwise the PC sorts first.
    const pcInit = opts.hiddenActiveFirst ? 10 : 20;
    const npcInit = opts.hiddenActiveFirst ? 20 : 10;

    const pcAddAck = await sendOp(gmSocket, "combat:addCombatant", {
      combatId,
      tokenId: "t-pc",
      actorId: pcActorId,
      hidden: false,
      initiative: pcInit,
    });
    const pcCombatantId = (
      (pcAddAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
    )["_id"] as string;

    const npcAddAck = await sendOp(gmSocket, "combat:addCombatant", {
      combatId,
      tokenId: "t-npc",
      actorId: npcActorId,
      hidden: true,
      initiative: npcInit,
    });
    const npcCombatantId = (
      (npcAddAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
    )["_id"] as string;

    return { combatId, sceneId, pcCombatantId, npcCombatantId };
  }

  it("a player's JOIN snapshot excludes the hidden combatant but includes the combat (REQ-CBT-031, REQ-CBT-NFR-002)", async () => {
    await setupCombatWithHidden();

    // A fresh player connects → receives a full snapshot.
    const playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const snapshotP = waitForSnapshot(playerSocket);
    playerSocket.connect();
    await waitForConnect(playerSocket);

    const snapshotEnv = await snapshotP;
    const payload = snapshotEnv["payload"] as Record<string, unknown>;
    const snapshot = payload["snapshot"] as Record<string, unknown>;
    const documents = snapshot["documents"] as Record<string, unknown[]>;
    const combats = (documents["Combat"] ?? []) as Record<string, unknown>[];

    // The combat IS present (shared world state) ...
    expect(combats.length).toBe(1);
    const combatants = combats[0]!["combatants"] as Record<string, unknown>[];
    // ... but the hidden NPC is stripped, only the visible PC remains.
    expect(combatants.length).toBe(1);
    expect(combatants.some((c) => c["hidden"] === true)).toBe(false);
    // The surviving combatant is the visible PC (tokenId t-pc), NOT the hidden NPC.
    expect(combatants[0]!["tokenId"]).toBe("t-pc");

    playerSocket.disconnect();
  });

  it("the GM's JOIN snapshot includes the hidden combatant (REQ-CBT-032)", async () => {
    await setupCombatWithHidden();

    // Reconnect a second GM socket to fetch a fresh snapshot.
    const gm2 = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const snapshotP = waitForSnapshot(gm2);
    gm2.connect();
    await waitForConnect(gm2);

    const snapshotEnv = await snapshotP;
    const snapshot = (snapshotEnv["payload"] as Record<string, unknown>)["snapshot"] as Record<
      string,
      unknown
    >;
    const documents = snapshot["documents"] as Record<string, unknown[]>;
    const combats = (documents["Combat"] ?? []) as Record<string, unknown>[];

    expect(combats.length).toBe(1);
    const combatants = combats[0]!["combatants"] as Record<string, unknown>[];
    // GM sees BOTH combatants, including the hidden one.
    expect(combatants.length).toBe(2);
    expect(combatants.some((c) => c["hidden"] === true)).toBe(true);

    gm2.disconnect();
  });

  it("a reconnecting player receives the combat state (round/turnIndex) without hidden combatants", async () => {
    const { combatId } = await setupCombatWithHidden();
    await sendOp(gmSocket, "combat:beginCombat", { combatId });

    const playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const snapshotP = waitForSnapshot(playerSocket);
    playerSocket.connect();
    await waitForConnect(playerSocket);

    const snapshotEnv = await snapshotP;
    const snapshot = (snapshotEnv["payload"] as Record<string, unknown>)["snapshot"] as Record<
      string,
      unknown
    >;
    const documents = snapshot["documents"] as Record<string, unknown[]>;
    const combat = ((documents["Combat"] ?? []) as Record<string, unknown>[])[0]!;

    // State restored (REQ-CBT-NFR-002)
    expect(combat["started"]).toBe(true);
    expect(combat["round"]).toBe(1);
    expect(combat["turnIndex"]).toBe(0);
    // No hidden combatant leaked
    const combatants = combat["combatants"] as Record<string, unknown>[];
    expect(combatants.some((c) => c["hidden"] === true)).toBe(false);

    playerSocket.disconnect();
  });

  // -------------------------------------------------------------------------
  // Path 3: delta resync replay (resync:delta) — REQ-CBT-031
  // -------------------------------------------------------------------------

  it("a player's DELTA resync replay excludes hidden combatants and masks a hidden active pointer (REQ-CBT-031, issue M2-C #6/#4)", async () => {
    // Player connects FIRST so it has a lastSeq baseline, then disconnects.
    const player1 = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const snap1P = waitForSnapshot(player1);
    player1.connect();
    await waitForConnect(player1);
    const snap1 = await snap1P;
    const baselineSeq = snap1["seq"] as number;
    player1.disconnect();

    // While the player is away, the GM builds a combat where the HIDDEN NPC is
    // the active combatant, and starts it. These ops are buffered.
    const { combatId, npcCombatantId } = await setupCombatWithHidden({ hiddenActiveFirst: true });
    await sendOp(gmSocket, "combat:beginCombat", { combatId });
    await drain();

    // Player reconnects with lastSeq → server replays buffered ops as a delta.
    const player2 = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
      lastSeq: baselineSeq,
    });
    const deltaP = waitForDelta(player2);
    player2.connect();
    await waitForConnect(player2);

    const deltaEnv = await deltaP;
    const deltaPayload = deltaEnv["payload"] as Record<string, unknown>;
    const ops = deltaPayload["ops"] as Record<string, unknown>[];

    // Inspect every combat op replayed to the player.
    for (const op of ops) {
      const type = op["type"] as string;
      if (type !== "combat:created" && type !== "combat:updated") continue;
      const payload = op["payload"] as Record<string, unknown>;

      // combat:created → { combat }
      const combat = payload["combat"] as Record<string, unknown> | undefined;
      if (combat && Array.isArray(combat["combatants"])) {
        const list = combat["combatants"] as Record<string, unknown>[];
        expect(list.some((c) => c["hidden"] === true)).toBe(false);
        // If the active pointer references the hidden NPC, it must be masked.
        if (combat["activeCombatantId"] === npcCombatantId) {
          throw new Error("hidden NPC id leaked via combat:created activeCombatantId");
        }
      }

      // combat:updated → { diff }
      const diff = payload["diff"] as Record<string, unknown> | undefined;
      if (diff) {
        const combatants = diff["combatants"] as Record<string, unknown>[] | undefined;
        if (Array.isArray(combatants)) {
          expect(combatants.some((c) => c["hidden"] === true)).toBe(false);
        }
        // The hidden NPC's id must NEVER appear as the active pointer in a
        // player's delta replay (it would reveal a hidden combatant's identity).
        expect(diff["activeCombatantId"]).not.toBe(npcCombatantId);
      }
    }

    player2.disconnect();
  });

  // -------------------------------------------------------------------------
  // Live broadcast: activeCombatantId masking + turnChange leak (issue #1/#4)
  // -------------------------------------------------------------------------

  it("the JOIN snapshot masks activeCombatantId when the active combatant is hidden (issue M2-C #1/#4)", async () => {
    const { combatId, npcCombatantId } = await setupCombatWithHidden({ hiddenActiveFirst: true });
    await sendOp(gmSocket, "combat:beginCombat", { combatId });

    // Player snapshot: active combatant is the hidden NPC → activeCombatantId
    // must be null for the player (no highlight / no turn marker).
    const playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const snapshotP = waitForSnapshot(playerSocket);
    playerSocket.connect();
    await waitForConnect(playerSocket);

    const snapshot = ((await snapshotP)["payload"] as Record<string, unknown>)[
      "snapshot"
    ] as Record<string, unknown>;
    const documents = snapshot["documents"] as Record<string, unknown[]>;
    const combat = ((documents["Combat"] ?? []) as Record<string, unknown>[])[0]!;

    expect(combat["activeCombatantId"]).toBeNull();
    expect(combat["activeCombatantId"]).not.toBe(npcCombatantId);
    playerSocket.disconnect();

    // The GM, by contrast, sees the real active pointer (the hidden NPC).
    const gm2 = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    const gmSnapP = waitForSnapshot(gm2);
    gm2.connect();
    await waitForConnect(gm2);
    const gmSnap = ((await gmSnapP)["payload"] as Record<string, unknown>)["snapshot"] as Record<
      string,
      unknown
    >;
    const gmDocs = gmSnap["documents"] as Record<string, unknown[]>;
    const gmCombat = ((gmDocs["Combat"] ?? []) as Record<string, unknown>[])[0]!;
    expect(gmCombat["activeCombatantId"]).toBe(npcCombatantId);
    gm2.disconnect();
  });

  it("combat:turnChange does NOT leak a hidden active combatant's id/tokenId to a player (issue M2-C #4)", async () => {
    const { combatId, npcCombatantId, pcCombatantId } = await setupCombatWithHidden({
      hiddenActiveFirst: true,
    });

    const playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    playerSocket.connect();
    await waitForConnect(playerSocket);
    await drain();

    // beginCombat fires turnChange. Active combatant is the hidden NPC.
    const playerTurnChangeP = waitForOp(
      playerSocket,
      (env) => env["type"] === "combat:turnChange",
      5000,
    );
    await sendOp(gmSocket, "combat:beginCombat", { combatId });

    const turnChange = await playerTurnChangeP;
    const payload = turnChange["payload"] as Record<string, unknown>;
    const current = payload["current"] as Record<string, unknown>;

    // The hidden NPC's id/tokenId must be masked for the player.
    expect(current["combatantId"]).toBeNull();
    expect(current["combatantId"]).not.toBe(npcCombatantId);
    expect(current["tokenId"]).toBeNull();
    expect(current["tokenId"]).not.toBe("t-npc");

    playerSocket.disconnect();

    // Sanity: the GM receives the unmasked turnChange pointing at the hidden NPC.
    const gm2 = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gm2.connect();
    await waitForConnect(gm2);
    await drain();
    const gmTurnChangeP = waitForOp(gm2, (env) => env["type"] === "combat:turnChange", 5000);
    // Advance to the PC's turn then back, to trigger a fresh turnChange for gm2.
    await sendOp(gmSocket, "combat:nextTurn", { combatId });
    const gmTurnChange = await gmTurnChangeP;
    const gmCurrent = (gmTurnChange["payload"] as Record<string, unknown>)["current"] as Record<
      string,
      unknown
    >;
    // After nextTurn the active is the visible PC — GM sees its real id.
    expect(gmCurrent["combatantId"]).toBe(pcCombatantId);
    gm2.disconnect();
  });
});
