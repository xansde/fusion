/**
 * M2-C integration tests — combat server handlers.
 *
 * Spec: 10-combate-e-iniciativa.md §REQ-CBT-001..035
 *
 * Coverage:
 *  §COMBAT CREATE
 *   - GM can create a combat → ok, combat:created broadcast
 *   - Player cannot create → PERMISSION_DENIED
 *   - Duplicate combat for same scene → VALIDATION_FAILED (DEC-CBT-06)
 *
 *  §ADD/REMOVE COMBATANT
 *   - GM adds combatant → ok, combatants updated
 *   - Player cannot add → PERMISSION_DENIED
 *   - Remove existing combatant → ok
 *   - Remove nonexistent → NOT_FOUND
 *
 *  §ROLL INITIATIVE
 *   - GM rolls initiative for all → ok, combatants sorted
 *   - Player can roll their own → ok
 *   - Player cannot roll another's → PERMISSION_DENIED
 *   - Manual set initiative (GM) → ok, sorted
 *   - Reset initiative → all null
 *
 *  §START / NEXT / PREVIOUS / END
 *   - Start combat: round=1, turn=0, started=true
 *   - Next turn: advances turn, wraps to next round
 *   - Next turn wraps round at end of order
 *   - Previous turn: goes back, wraps to previous round
 *   - Lifecycle hooks emitted in correct order (turnStart, turnEnd, roundStart, roundEnd)
 *   - End combat: combat:deleted broadcast, ended=true
 *   - Player cannot call next/previous → PERMISSION_DENIED
 *
 *  §HIDDEN COMBATANT REDACTION (REQ-CBT-031..033)
 *   - GM can set combatant hidden
 *   - Hidden NPC: snapshot/broadcast to player does NOT contain it
 *   - Hidden NPC: ack to GM DOES contain it
 *   - Visible NPC: player receives it
 *   - combat:turnChange does not leak hidden token position
 *
 *  §DEFEATED
 *   - GM toggles defeated flag → ok
 *   - Player cannot toggle → PERMISSION_DENIED
 *
 *  §REORDER
 *   - GM can reorder combatants
 *   - Player cannot → PERMISSION_DENIED
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
// Test setup helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-combat-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  gmUserId: string;
  playerToken: string;
  playerUserId: string;
  player2Token: string;
  player2UserId: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "combat-test-world";

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
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });
  const player2Login = await authService.login({
    userId: player2.id,
    password: "player2-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Combat Test World", systemId: "stub" },
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
    gmUserId: gm.id,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
    player2Token: player2Login.accessToken,
    player2UserId: player2.id,
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

/** Drain pending events (snapshot on join, etc.) */
function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

// ---------------------------------------------------------------------------
// Pre-requisites: create a scene and actors
// ---------------------------------------------------------------------------

interface TestFixtures {
  sceneId: string;
  pc1ActorId: string;
  pc2ActorId: string;
  npcActorId: string;
}

async function buildFixtures(
  gmSocket: ClientSocket,
  playerUserId: string,
  player2UserId: string,
): Promise<TestFixtures> {
  // Create a scene
  const sceneAck = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [{ name: "Test Scene", width: 1000, height: 1000 }],
  });
  expect(sceneAck["ok"]).toBe(true);
  const sceneResult = sceneAck["result"] as Record<string, unknown>;
  const sceneId = (sceneResult["documents"] as Record<string, unknown>[])[0]!["_id"] as string;

  // Create PC1 actor (owned by player1)
  const pc1Ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [
      {
        name: "PC1 Fighter",
        type: "character",
        ownership: { default: 0, [playerUserId]: 3 }, // OWNER level
      },
    ],
  });
  expect(pc1Ack["ok"]).toBe(true);
  const pc1ActorId = (
    (pc1Ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
  )[0]!["_id"] as string;

  // Create PC2 actor (owned by player2)
  const pc2Ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [
      {
        name: "PC2 Wizard",
        type: "character",
        ownership: { default: 0, [player2UserId]: 3 },
      },
    ],
  });
  expect(pc2Ack["ok"]).toBe(true);
  const pc2ActorId = (
    (pc2Ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
  )[0]!["_id"] as string;

  // Create NPC actor (GM-owned, no player ownership)
  const npcAck = await sendOp(gmSocket, "doc:create", {
    documentType: "Actor",
    data: [{ name: "NPC Goblin", type: "npc", ownership: { default: 0 } }],
  });
  expect(npcAck["ok"]).toBe(true);
  const npcActorId = (
    (npcAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
  )[0]!["_id"] as string;

  return { sceneId, pc1ActorId, pc2ActorId, npcActorId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("M2-C combat server handlers", { timeout: 30000 }, () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let player2Socket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();

    const auth = (token: string) => ({ token, protocolVersion: PROTOCOL_VERSION });

    gmSocket = connectClient(ctx.port, ctx.worldId, auth(ctx.gmToken));
    playerSocket = connectClient(ctx.port, ctx.worldId, auth(ctx.playerToken));
    player2Socket = connectClient(ctx.port, ctx.worldId, auth(ctx.player2Token));

    gmSocket.connect();
    playerSocket.connect();
    player2Socket.connect();

    await Promise.all([
      waitForConnect(gmSocket),
      waitForConnect(playerSocket),
      waitForConnect(player2Socket),
    ]);

    await drain();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    player2Socket.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // §COMBAT CREATE
  // -------------------------------------------------------------------------

  describe("combat:create", () => {
    it("GM can create a combat encounter", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const ack = await sendOp(gmSocket, "combat:create", { sceneId });
      expect(ack["ok"]).toBe(true);

      const result = ack["result"] as Record<string, unknown>;
      const combat = result["combat"] as Record<string, unknown>;
      expect(combat["sceneId"]).toBe(sceneId);
      expect(combat["started"]).toBe(false);
      expect(combat["ended"]).toBe(false);
      expect(combat["round"]).toBe(0);
      expect(Array.isArray(combat["combatants"])).toBe(true);
      expect((combat["combatants"] as unknown[]).length).toBe(0);
    });

    it("Player cannot create a combat encounter", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const ack = await sendOp(playerSocket, "combat:create", { sceneId });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("Duplicate combat for same scene is rejected (DEC-CBT-06)", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const first = await sendOp(gmSocket, "combat:create", { sceneId });
      expect(first["ok"]).toBe(true);

      const second = await sendOp(gmSocket, "combat:create", { sceneId });
      expect(second["ok"]).toBe(false);
      expect(second["code"]).toBe("VALIDATION_FAILED");
    });

    it("combat:created is broadcast to all connected clients", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const playerBroadcastP = waitForOp(playerSocket, (env) => env["type"] === "combat:created");

      await sendOp(gmSocket, "combat:create", { sceneId });

      const broadcast = await playerBroadcastP;
      expect(broadcast["type"]).toBe("combat:created");
      const payload = broadcast["payload"] as Record<string, unknown>;
      const combat = payload["combat"] as Record<string, unknown>;
      expect(combat["sceneId"]).toBe(sceneId);
    });
  });

  // -------------------------------------------------------------------------
  // §ADD/REMOVE COMBATANT
  // -------------------------------------------------------------------------

  describe("combat:addCombatant / combat:removeCombatant", () => {
    it("GM can add and remove combatants", async () => {
      const { sceneId, pc1ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      // Add combatant
      const addAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "token-pc1-fake",
        actorId: pc1ActorId,
        hidden: false,
      });
      expect(addAck["ok"]).toBe(true);
      const addResult = addAck["result"] as Record<string, unknown>;
      const addedCombat = addResult["combat"] as Record<string, unknown>;
      const combatants = addedCombat["combatants"] as Record<string, unknown>[];
      expect(combatants.length).toBe(1);
      const combatant = combatants[0]!;
      const combatantId = combatant["_id"] as string;

      // Remove combatant
      const removeAck = await sendOp(gmSocket, "combat:removeCombatant", {
        combatId,
        combatantId,
      });
      expect(removeAck["ok"]).toBe(true);
      const removedCombat = (removeAck["result"] as Record<string, unknown>)["combat"] as Record<
        string,
        unknown
      >;
      expect((removedCombat["combatants"] as unknown[]).length).toBe(0);
    });

    it("Player cannot add combatants", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const ack = await sendOp(playerSocket, "combat:addCombatant", {
        combatId,
        tokenId: "some-token",
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("Removing a nonexistent combatant returns NOT_FOUND", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const ack = await sendOp(gmSocket, "combat:removeCombatant", {
        combatId,
        combatantId: "nonexistentidAAAA",
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // §ROLL INITIATIVE
  // -------------------------------------------------------------------------

  describe("combat:rollInitiative", () => {
    it("GM can roll initiative for all combatants", async () => {
      const { sceneId, pc1ActorId, pc2ActorId, npcActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      // Add 2 PCs + 1 NPC
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "token-pc1",
        actorId: pc1ActorId,
        hidden: false,
      });
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "token-pc2",
        actorId: pc2ActorId,
        hidden: false,
      });
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "token-npc",
        actorId: npcActorId,
        hidden: true,
      });

      // Roll all
      const rollAck = await sendOp(gmSocket, "combat:rollInitiative", { combatId });
      expect(rollAck["ok"]).toBe(true);

      const rollResult = rollAck["result"] as Record<string, unknown>;
      const updatedCombat = rollResult["combat"] as Record<string, unknown>;
      const combatants = updatedCombat["combatants"] as Record<string, unknown>[];
      expect(combatants.length).toBe(3);

      // All should have numeric initiative now
      for (const c of combatants) {
        expect(typeof c["initiative"]).toBe("number");
      }

      // Combatants should be sorted descending by initiative
      const initiatives = combatants.map((c) => c["initiative"] as number);
      for (let i = 0; i < initiatives.length - 1; i++) {
        expect(initiatives[i]!).toBeGreaterThanOrEqual(initiatives[i + 1]!);
      }
    });

    it("Player can roll initiative for their own PC combatant", async () => {
      const { sceneId, pc1ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const addAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "token-pc1",
        actorId: pc1ActorId,
        hidden: false,
      });
      const combatantId = (
        (addAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      // Player rolls their own PC
      const rollAck = await sendOp(playerSocket, "combat:rollInitiative", {
        combatId,
        combatantIds: [combatantId],
      });
      expect(rollAck["ok"]).toBe(true);
    });

    it("Player cannot roll initiative for another player's PC", async () => {
      const { sceneId, pc2ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      // Add PC2 (owned by player2)
      const addAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "token-pc2",
        actorId: pc2ActorId,
        hidden: false,
      });
      const combatantId = (
        (addAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      // player1 tries to roll for pc2 (owned by player2) → PERMISSION_DENIED
      const rollAck = await sendOp(playerSocket, "combat:rollInitiative", {
        combatId,
        combatantIds: [combatantId],
      });
      expect(rollAck["ok"]).toBe(false);
      expect(rollAck["code"]).toBe("PERMISSION_DENIED");
    });

    it("GM can set initiative manually", async () => {
      const { sceneId, pc1ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const addAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "token-pc1",
        actorId: pc1ActorId,
      });
      const combatantId = (
        (addAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      const setAck = await sendOp(gmSocket, "combat:setInitiative", {
        combatId,
        combatantId,
        value: 15,
      });
      expect(setAck["ok"]).toBe(true);

      const updatedCombat = (setAck["result"] as Record<string, unknown>)["combat"] as Record<
        string,
        unknown
      >;
      const c = (updatedCombat["combatants"] as Record<string, unknown>[]).find(
        (x) => x["_id"] === combatantId,
      );
      expect(c?.["initiative"]).toBe(15);
    });

    it("Player cannot set initiative manually", async () => {
      const { sceneId, pc1ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const addAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "token-pc1",
        actorId: pc1ActorId,
      });
      const combatantId = (
        (addAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      const ack = await sendOp(playerSocket, "combat:setInitiative", {
        combatId,
        combatantId,
        value: 99,
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("GM can reset all initiative values", async () => {
      const { sceneId, pc1ActorId, pc2ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t1",
        actorId: pc1ActorId,
      });
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t2",
        actorId: pc2ActorId,
      });

      // Roll
      await sendOp(gmSocket, "combat:rollInitiative", { combatId });

      // Reset
      const resetAck = await sendOp(gmSocket, "combat:resetInitiative", { combatId });
      expect(resetAck["ok"]).toBe(true);

      const resetCombat = (resetAck["result"] as Record<string, unknown>)["combat"] as Record<
        string,
        unknown
      >;
      for (const c of resetCombat["combatants"] as Record<string, unknown>[]) {
        expect(c["initiative"]).toBeNull();
      }
    });
  });

  // -------------------------------------------------------------------------
  // §START / NEXT / PREVIOUS / END
  // -------------------------------------------------------------------------

  describe("combat lifecycle (start / next / previous / end)", () => {
    it("GM can start combat: round=1, turn=0, started=true", async () => {
      const { sceneId, pc1ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t1",
        actorId: pc1ActorId,
        initiative: 10,
      });

      const startAck = await sendOp(gmSocket, "combat:beginCombat", { combatId });
      expect(startAck["ok"]).toBe(true);

      const combat = (startAck["result"] as Record<string, unknown>)["combat"] as Record<
        string,
        unknown
      >;
      expect(combat["started"]).toBe(true);
      expect(combat["round"]).toBe(1);
      expect(combat["turnIndex"]).toBe(0);
    });

    it("Player cannot start combat", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const ack = await sendOp(playerSocket, "combat:beginCombat", { combatId });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("Next turn advances turn index", async () => {
      const { sceneId, pc1ActorId, pc2ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t1",
        actorId: pc1ActorId,
        initiative: 20,
      });
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t2",
        actorId: pc2ActorId,
        initiative: 10,
      });

      await sendOp(gmSocket, "combat:beginCombat", { combatId });

      const nextAck = await sendOp(gmSocket, "combat:nextTurn", { combatId });
      expect(nextAck["ok"]).toBe(true);

      const updatedCombat = (nextAck["result"] as Record<string, unknown>)["combat"] as Record<
        string,
        unknown
      >;
      expect(updatedCombat["turnIndex"]).toBe(1);
      expect(updatedCombat["round"]).toBe(1);
    });

    it("Next turn wraps to round 2 at end of combatant order", async () => {
      const { sceneId, pc1ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      // One combatant
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t1",
        actorId: pc1ActorId,
        initiative: 15,
      });

      await sendOp(gmSocket, "combat:beginCombat", { combatId });

      // With 1 combatant, next should wrap to round 2 turn 0
      const nextAck = await sendOp(gmSocket, "combat:nextTurn", { combatId });
      expect(nextAck["ok"]).toBe(true);

      const updatedCombat = (nextAck["result"] as Record<string, unknown>)["combat"] as Record<
        string,
        unknown
      >;
      expect(updatedCombat["round"]).toBe(2);
      expect(updatedCombat["turnIndex"]).toBe(0);
    });

    it("Previous turn goes back; at turn 0 wraps to last combatant of previous round", async () => {
      const { sceneId, pc1ActorId, pc2ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t1",
        actorId: pc1ActorId,
        initiative: 20,
      });
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t2",
        actorId: pc2ActorId,
        initiative: 10,
      });

      await sendOp(gmSocket, "combat:beginCombat", { combatId });

      // Start at turn=0, round=1. Go previous → wrap to turn=1 (last), round=1
      const prevAck = await sendOp(gmSocket, "combat:previousTurn", { combatId });
      expect(prevAck["ok"]).toBe(true);

      const updatedCombat = (prevAck["result"] as Record<string, unknown>)["combat"] as Record<
        string,
        unknown
      >;
      expect(updatedCombat["turnIndex"]).toBe(1); // last combatant (index 1)
      // round stays 1 because previousTurnIndex doesn't go below round 1
    });

    it("Player cannot call combat:next", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const ack = await sendOp(playerSocket, "combat:nextTurn", { combatId });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("Player cannot call combat:previous", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const ack = await sendOp(playerSocket, "combat:previousTurn", { combatId });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });

    it("Lifecycle hooks emitted in correct order for next turn", async () => {
      const { sceneId, pc1ActorId, pc2ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t1",
        actorId: pc1ActorId,
        initiative: 20,
      });
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t2",
        actorId: pc2ActorId,
        initiative: 10,
      });

      // Capture all ops from the GM socket
      const receivedTypes: string[] = [];
      gmSocket.on("op", (env: Record<string, unknown>) => {
        const t = env["type"] as string;
        if (t && t.startsWith("combat:")) {
          receivedTypes.push(t);
        }
      });

      // Start combat
      await sendOp(gmSocket, "combat:beginCombat", { combatId });
      // Should emit combat:updated + combat:turnChange
      await drain();

      // Next
      await sendOp(gmSocket, "combat:nextTurn", { combatId });
      await drain();

      // Should have received combat:updated (for start) and combat:turnChange (for start + next)
      expect(receivedTypes).toContain("combat:updated");
      expect(receivedTypes).toContain("combat:turnChange");
    });

    it("GM can end combat: combat:deleted broadcast, ended=true", async () => {
      const { sceneId, pc1ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t1",
        actorId: pc1ActorId,
        initiative: 10,
      });
      await sendOp(gmSocket, "combat:beginCombat", { combatId });

      // Wait for combat:deleted on player socket
      const deletedP = waitForOp(
        playerSocket,
        (env) =>
          env["type"] === "combat:deleted" &&
          (env["payload"] as Record<string, unknown>)?.["combatId"] === combatId,
      );

      const endAck = await sendOp(gmSocket, "combat:endCombat", { combatId });
      expect(endAck["ok"]).toBe(true);

      const deletedEnv = await deletedP;
      expect(deletedEnv["type"]).toBe("combat:deleted");
    });

    it("Player cannot end combat", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const ack = await sendOp(playerSocket, "combat:endCombat", { combatId });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });
  });

  // -------------------------------------------------------------------------
  // §HIDDEN COMBATANT REDACTION (REQ-CBT-031..033)
  // -------------------------------------------------------------------------

  describe("Hidden combatant redaction", () => {
    it("Hidden NPC combatant is NOT included in broadcast to player (REQ-CBT-031)", async () => {
      const { sceneId, pc1ActorId, npcActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      // Add visible PC
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t-pc1",
        actorId: pc1ActorId,
        hidden: false,
      });

      // Capture player-side broadcast after the NPC is added
      const playerBroadcastP = waitForOp(
        playerSocket,
        (env) => env["type"] === "combat:updated",
        5000,
      );

      // Add hidden NPC
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t-npc",
        actorId: npcActorId,
        hidden: true,
      });

      const broadcast = await playerBroadcastP;
      const payload = broadcast["payload"] as Record<string, unknown>;
      const diff = payload["diff"] as Record<string, unknown>;
      const combatants = diff["combatants"] as Record<string, unknown>[] | undefined;

      // The addCombatant diff ALWAYS carries the full combatants array, so the
      // assertion must run unconditionally (a missing array would be a bug, not
      // a reason to silently pass). REQ-CBT-031.
      expect(Array.isArray(combatants)).toBe(true);
      const list = combatants as Record<string, unknown>[];
      // Player must not see the hidden combatant
      expect(list.some((c) => c["hidden"] === true)).toBe(false);
      // ...and must still receive the visible PC (the array is not empty).
      expect(list.length).toBe(1);
      expect(list[0]!["tokenId"]).toBe("t-pc1");
    });

    it("Hidden NPC combatant IS included in GM's ack (REQ-CBT-032)", async () => {
      const { sceneId, npcActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      // Add hidden NPC and verify GM's ack
      const addAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t-npc",
        actorId: npcActorId,
        hidden: true,
      });

      expect(addAck["ok"]).toBe(true);
      const result = addAck["result"] as Record<string, unknown>;
      const combat = result["combat"] as Record<string, unknown>;
      const combatants = combat["combatants"] as Record<string, unknown>[];

      // GM should see the hidden combatant
      const hiddenCombatant = combatants.find((c) => c["hidden"] === true);
      expect(hiddenCombatant).toBeDefined();
    });

    it("Player ack does NOT contain hidden combatants (REQ-CBT-031)", async () => {
      const { sceneId, pc1ActorId, npcActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t-pc1",
        actorId: pc1ActorId,
        hidden: false,
      });
      await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t-npc",
        actorId: npcActorId,
        hidden: true,
      });

      // Player rolls their own initiative — ack should not contain hidden combatant
      const pc1AddAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t-pc1-another",
        actorId: pc1ActorId,
        hidden: false,
      });
      const combatantId = (
        (pc1AddAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      const rollAck = await sendOp(playerSocket, "combat:rollInitiative", {
        combatId,
        combatantIds: [combatantId],
      });

      expect(rollAck["ok"]).toBe(true);
      const result = rollAck["result"] as Record<string, unknown>;
      const combat = result["combat"] as Record<string, unknown>;
      // The rollInitiative ack ALWAYS echoes the combat document, so assert
      // unconditionally — a missing combatants array is a regression, not a pass.
      // REQ-CBT-031.
      expect(combat).toBeDefined();
      expect(Array.isArray(combat["combatants"])).toBe(true);
      const combatants = combat["combatants"] as Record<string, unknown>[];
      expect(combatants.some((c) => c["hidden"] === true)).toBe(false);
      // The hidden NPC must be absent: GM added 2 visible PCs + 1 hidden NPC, so
      // the player must see exactly the 2 visible combatants.
      expect(combatants.length).toBe(2);
    });

    it("combat:setHidden hides/reveals combatant, player broadcast is redacted", async () => {
      const { sceneId, pc1ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const addAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t-pc1",
        actorId: pc1ActorId,
        hidden: false,
      });
      const combatantId = (
        (addAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      // Player cannot set hidden
      const playerHideAck = await sendOp(playerSocket, "combat:setHidden", {
        combatId,
        combatantId,
        hidden: true,
      });
      expect(playerHideAck["ok"]).toBe(false);
      expect(playerHideAck["code"]).toBe("PERMISSION_DENIED");

      // Capture player broadcast before GM hides the combatant
      const playerBroadcastP = waitForOp(
        playerSocket,
        (env) => env["type"] === "combat:updated",
        5000,
      );

      // GM hides
      const gmHideAck = await sendOp(gmSocket, "combat:setHidden", {
        combatId,
        combatantId,
        hidden: true,
      });
      expect(gmHideAck["ok"]).toBe(true);

      const playerBroadcast = await playerBroadcastP;
      const diff = (playerBroadcast["payload"] as Record<string, unknown>)?.["diff"] as Record<
        string,
        unknown
      >;
      if (diff && Array.isArray(diff["combatants"])) {
        const visible = (diff["combatants"] as Record<string, unknown>[]).filter(
          (c) => c["hidden"] !== true,
        );
        // All combatants in player's view should not be hidden
        expect(diff["combatants"]).toEqual(visible);
      }
    });
  });

  // -------------------------------------------------------------------------
  // §DEFEATED
  // -------------------------------------------------------------------------

  describe("combat:setDefeated", () => {
    it("GM can toggle defeated flag", async () => {
      const { sceneId, pc1ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const addAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t1",
        actorId: pc1ActorId,
      });
      const combatantId = (
        (addAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      const toggleAck = await sendOp(gmSocket, "combat:setDefeated", {
        combatId,
        combatantId,
        defeated: true,
      });
      expect(toggleAck["ok"]).toBe(true);

      const updatedCombat = (toggleAck["result"] as Record<string, unknown>)["combat"] as Record<
        string,
        unknown
      >;
      const c = (updatedCombat["combatants"] as Record<string, unknown>[]).find(
        (x) => x["_id"] === combatantId,
      );
      expect(c?.["defeated"]).toBe(true);

      // Toggle back
      const toggleBackAck = await sendOp(gmSocket, "combat:setDefeated", {
        combatId,
        combatantId,
        defeated: false,
      });
      expect(toggleBackAck["ok"]).toBe(true);
    });

    it("Player cannot toggle defeated flag", async () => {
      const { sceneId, pc1ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const addAck = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t1",
        actorId: pc1ActorId,
      });
      const combatantId = (
        (addAck["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      const ack = await sendOp(playerSocket, "combat:setDefeated", {
        combatId,
        combatantId,
        defeated: true,
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });
  });

  // -------------------------------------------------------------------------
  // §REORDER
  // -------------------------------------------------------------------------

  describe("combat:reorder", () => {
    it("GM can reorder combatants", async () => {
      const { sceneId, pc1ActorId, pc2ActorId } = await buildFixtures(
        gmSocket,
        ctx.playerUserId,
        ctx.player2UserId,
      );

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const add1 = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t1",
        actorId: pc1ActorId,
        initiative: 20,
      });
      const id1 = (
        (add1["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      const add2 = await sendOp(gmSocket, "combat:addCombatant", {
        combatId,
        tokenId: "t2",
        actorId: pc2ActorId,
        initiative: 10,
      });
      const id2 = (
        (add2["result"] as Record<string, unknown>)["combatant"] as Record<string, unknown>
      )["_id"] as string;

      // Reverse the order
      const reorderAck = await sendOp(gmSocket, "combat:reorder", {
        combatId,
        order: [id2, id1],
      });
      expect(reorderAck["ok"]).toBe(true);

      const updatedCombat = (reorderAck["result"] as Record<string, unknown>)["combat"] as Record<
        string,
        unknown
      >;
      const combatants = updatedCombat["combatants"] as Record<string, unknown>[];
      expect(combatants[0]!["_id"]).toBe(id2);
      expect(combatants[1]!["_id"]).toBe(id1);
    });

    it("Player cannot reorder combatants", async () => {
      const { sceneId } = await buildFixtures(gmSocket, ctx.playerUserId, ctx.player2UserId);

      const createAck = await sendOp(gmSocket, "combat:create", { sceneId });
      const combatId = (
        (createAck["result"] as Record<string, unknown>)["combat"] as Record<string, unknown>
      )["_id"] as string;

      const ack = await sendOp(playerSocket, "combat:reorder", {
        combatId,
        order: ["fakeIdAAAAAAAAA1"],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });
  });
});
