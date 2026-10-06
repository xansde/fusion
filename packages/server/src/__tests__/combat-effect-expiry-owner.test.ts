/**
 * BHR-F0-03 — an effect counts by its OWNER's turn, and the removal reaches
 * every client before the owner's turn starts (REQ-BHR-005..008).
 *
 * Server integration test over real sockets. The system is a FAKE module whose
 * turn-start hook applies the rule written in this file (an effect whose
 * `fusion.expiry.ownerActorId` is the actor now starting its turn leaves every
 * actor that carries a copy) through the real `TurnHookContext` services
 * (`listActors` + `deleteEmbedded`) — it asserts the core plumbing, never a
 * game rule, so it is not circular against the satellite resolver.
 *
 * Scenario: the companion acts first; the effect it applied on the owner (and
 * a copy on an ally who is not in the encounter) carries `ownerActorId` =
 * the owner. It must survive the companion's turn start and be gone, on every
 * actor and in the broadcast, by the time the owner's turn starts.
 *
 * Port: reserved via helpers/ports.ts (never a literal).
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
import { defineSystem } from "@fusion/system-api";
import type { SystemModule } from "@fusion/system-api";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

const MANIFEST = {
  id: "test-expiry-owner",
  title: "Expiry Owner Test",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: {},
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

interface TestEffect {
  _id: string;
  system?: { fusion?: { expiry?: { on?: string; ownerActorId?: string } } };
}

/** The rule under test: leave at the start of the OWNER's turn, from every carrier. */
function buildFakeSystem(): SystemModule {
  return defineSystem({ ...MANIFEST }, (r) => {
    r.onTurnStart("test.ownerExpiry", async ({ combatant }, ctx) => {
      if (!combatant.actorId) return;
      for (const holder of ctx.listActors()) {
        const items = Array.isArray(holder["items"]) ? (holder["items"] as TestEffect[]) : [];
        const expired = items
          .filter((i) => {
            const expiry = i.system?.fusion?.expiry;
            return expiry?.on === "turn-start" && expiry.ownerActorId === combatant.actorId;
          })
          .map((i) => i._id);
        if (expired.length > 0) await ctx.deleteEmbedded(holder["_id"] as string, expired);
      }
    });
  });
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-expiry-owner-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "expiry-owner-world";
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
    worldInfo: { id: worldId, title: "Expiry Owner World", systemId: MANIFEST.id },
  });
  await fastify.listen({ port: await reserveFreePort(), host: "127.0.0.1" });
  const port = listeningPort(fastify);

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: `http://127.0.0.1:${String(port)}`,
  });
  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
    systemModule: buildFakeSystem(),
  });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
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

function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

function resultOf(ack: Record<string, unknown>): Record<string, unknown> {
  return ack["result"] as Record<string, unknown>;
}

function firstDocId(ack: Record<string, unknown>): string {
  return (resultOf(ack)["documents"] as Record<string, unknown>[])[0]!["_id"] as string;
}

function effectItem(id: string, ownerActorId: string): Record<string, unknown> {
  return {
    _id: id,
    type: "effect",
    name: "Apoio",
    system: {
      duration: { value: 1, unit: "round" },
      fusion: { expiry: { on: "turn-start", ownerActorId } },
    },
  };
}

describe(
  "BHR-F0-03 — efeito expira no turno do DONO (REQ-BHR-005..008)",
  { timeout: 30000 },
  () => {
    let ctx: TestContext;
    let gm: ClientSocket;
    let player: ClientSocket;
    /** Every envelope the player received, in arrival order. */
    let seen: Record<string, unknown>[];

    beforeEach(async () => {
      ctx = await buildTestContext();
      gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
      player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
      gm.connect();
      player.connect();
      await Promise.all([waitForConnect(gm), waitForConnect(player)]);
      await drain();
      seen = [];
      player.on("op", (env: Record<string, unknown>) => seen.push(env));
    });

    afterEach(async () => {
      gm.disconnect();
      player.disconnect();
      await teardown(ctx);
    });

    async function createActor(name: string) {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [{ name, type: "character", ownership: { default: 2 } }],
      });
      expect(ack["ok"]).toBe(true);
      return firstDocId(ack);
    }

    /** Persisted state, straight from the world database. */
    function itemIds(actorId: string): string[] {
      const row = ctx.fusionDb.raw.prepare("SELECT data FROM actors WHERE id = ?").get(actorId) as
        | { data: string }
        | undefined;
      const doc = JSON.parse(row?.data ?? "{}") as { items?: { _id: string }[] };
      return (doc.items ?? []).map((i) => i._id);
    }

    it("não sai no início do turno do companheiro; sai de TODOS os portadores no início do turno do dono, antes do broadcast do avanço", async () => {
      const ownerId = await createActor("Dono");
      const companionId = await createActor("Companheiro");
      const allyId = await createActor("Aliado fora do encontro");
      // The owner's own id is only known now, so stamp the effects afterwards.
      // Actor.items is not writable through doc:update, so seed the world DB.
      for (const [actorId, itemId] of [
        [ownerId, "effOwnerCopy0001"],
        [allyId, "effAllyCopy00001"],
      ] as const) {
        ctx.fusionDb.raw
          .prepare("UPDATE actors SET data = json_set(data, '$.items', json(?)) WHERE id = ?")
          .run(JSON.stringify([effectItem(itemId, ownerId)]), actorId);
      }

      const sceneAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [{ name: "Cena", width: 1000, height: 1000 }],
      });
      const sceneId = firstDocId(sceneAck);
      const combatAck = await sendOp(gm, "combat:create", { sceneId });
      const combatId = (resultOf(combatAck)["combat"] as Record<string, unknown>)["_id"] as string;
      // Companion has the higher initiative: it acts first, the owner second.
      await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: "t-companion",
        actorId: companionId,
        initiative: 20,
      });
      await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: "t-owner",
        actorId: ownerId,
        initiative: 10,
      });

      // Companion's turn starts (beginCombat): nothing leaves.
      const begin = await sendOp(gm, "combat:beginCombat", { combatId });
      expect(begin["ok"]).toBe(true);
      expect(itemIds(ownerId)).toEqual(["effOwnerCopy0001"]);
      expect(itemIds(allyId)).toEqual(["effAllyCopy00001"]);

      // Owner's turn starts: the effect leaves both carriers.
      await drain(); // let the begin-combat broadcasts land before watching
      seen.length = 0;
      const next = await sendOp(gm, "combat:nextTurn", { combatId });
      expect(next["ok"]).toBe(true);
      expect(itemIds(ownerId)).toEqual([]);
      expect(itemIds(allyId)).toEqual([]);
      await drain();

      // REQ-BHR-008: the removals reached the client, and BEFORE the turn advance.
      const indexOfRemoval = (actorId: string) =>
        seen.findIndex((env) => {
          if (env["type"] !== "doc:update") return false;
          const docs =
            (env["payload"] as { documents?: Record<string, unknown>[] }).documents ?? [];
          return docs.some(
            (d) => d["_id"] === actorId && ((d["items"] ?? []) as unknown[]).length === 0,
          );
        });
      const ownerRemoval = indexOfRemoval(ownerId);
      const allyRemoval = indexOfRemoval(allyId);
      const turnAdvance = seen.findIndex((env) => env["type"] === "combat:updated");
      expect(ownerRemoval).toBeGreaterThanOrEqual(0);
      expect(allyRemoval).toBeGreaterThanOrEqual(0);
      expect(turnAdvance).toBeGreaterThanOrEqual(0);
      expect(ownerRemoval).toBeLessThan(turnAdvance);
      expect(allyRemoval).toBeLessThan(turnAdvance);
    });
  },
);
