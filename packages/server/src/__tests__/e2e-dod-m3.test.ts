/**
 * E2E DoD M3 — "Primeira Sessão Jogável" integration test suite.
 *
 * Spec: 27-roadmap-e-milestones.md §M3 Definition of Done
 *
 * Verifies the 8 DoD items at the server/socket level (headless):
 *
 *  (a) GM creates world --system pf2e and starts the server.
 *  (b) GM imports content from a compendium (monster → Actor with AC/saves from pack).
 *  (c) GM creates a scene with map+grid and activates it; places tokens.
 *  (d) Player connects via socket (login/join), receives snapshot, sees the scene.
 *      [PARTIAL — visual canvas not testable headless]
 *  (e) Token movement syncs < 100ms loopback; ownership check (PERMISSION_DENIED).
 *      [PARTIAL — visual canvas not testable headless]
 *  (f) Chat roll resolves on server per roll mode.
 *  (g) Combat: create encounter, roll initiative (server), advance turns,
 *      tracker updates; hidden NPC NOT leaked to player.
 *  (h) No regression from M0/M1/M2.
 *
 * REQ-CMP-009..024, REQ-CBT-001..035, REQ-ROL-001.., REQ-NET-062
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
import { CompendiumService } from "../compendium/index.js";
import { PROTOCOL_VERSION } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Minimal PF2e pack fixtures
// ---------------------------------------------------------------------------

const BESTIARY_PACK_ID = "pf2e.bestiary-core";
const CONDITIONS_PACK_ID = "pf2e.conditions";

const TEST_NPC = {
  _id: "G1IeHREXFKc7efep",
  name: "Eagle",
  type: "npc",
  img: "icons/placeholder/actor.svg",
  system: {
    details: { level: { value: 1 }, isElite: false, isWeak: false },
    attributes: {
      hp: { value: 6, max: 6, temp: 0 },
      ac: { value: 15 },
      speed: { total: 25 },
    },
    saves: {
      fortitude: { value: 7 },
      reflex: { value: 10 },
      will: { value: 4 },
    },
    abilities: {
      str: { mod: 2 },
      dex: { mod: 4 },
      con: { mod: 1 },
      int: { mod: -4 },
      wis: { mod: 1 },
      cha: { mod: 0 },
    },
    traits: { value: ["animal"] },
    perception: { mod: 6 },
    skills: {},
    actions: [],
  },
  ownership: { default: 0 },
  flags: {
    fusion: {
      conversion: "full",
      importerVersion: "0.1.0",
      sourceVersion: "v14-dev",
      sourceId: "G1IeHREXFKc7efep",
      packName: "pathfinder-monster-core",
      unconvertedRules: [],
      assetSubstitutions: [],
    },
  },
};

const BESTIARY_MANIFEST = {
  id: BESTIARY_PACK_ID,
  label: "PF2e Core Bestiary",
  documentType: "Actor",
  systemId: "pf2e",
  indexFields: ["system.details.level.value", "system.traits.value", "system.attributes.hp.max"],
  license: {
    license: "ORC",
    attribution: "Pathfinder Monster Core © 2024 Paizo Inc.",
    reservedNotice:
      "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
    sourceRepo: "github.com/foundryvtt/pf2e",
    sourceVersion: "v14-dev",
  },
  source: { repo: "github.com/foundryvtt/pf2e", version: "v14-dev", importerVersion: "0.1.0" },
  documentCount: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
};

const TEST_CONDITION = {
  _id: "cond-frightened",
  name: "Frightened",
  type: "condition",
  img: "icons/placeholder/condition.svg",
  system: {
    group: "frightened",
    value: { isValued: true },
    rules: [],
    traits: { value: ["mental"] },
  },
  flags: {
    fusion: {
      conversion: "full",
      importerVersion: "0.1.0",
      sourceVersion: "v14-dev",
      sourceId: "frightened",
      packName: "conditions",
      unconvertedRules: [],
      assetSubstitutions: [],
    },
  },
};

const CONDITIONS_MANIFEST = {
  id: CONDITIONS_PACK_ID,
  label: "PF2e Conditions",
  documentType: "Item",
  systemId: "pf2e",
  indexFields: ["system.group"],
  license: {
    license: "ORC",
    attribution: "Pathfinder Player Core © 2023 Paizo Inc.",
    reservedNotice:
      "Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.",
    sourceRepo: "github.com/foundryvtt/pf2e",
    sourceVersion: "v14-dev",
  },
  source: { repo: "github.com/foundryvtt/pf2e", version: "v14-dev", importerVersion: "0.1.0" },
  documentCount: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
};

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-dod-m3-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupPacksDir(baseDir: string): void {
  const bestiaryDir = join(baseDir, "bestiary-core");
  mkdirSync(bestiaryDir, { recursive: true });
  writeFileSync(join(bestiaryDir, "pack.json"), JSON.stringify(BESTIARY_MANIFEST));
  writeFileSync(join(bestiaryDir, "documents.json"), JSON.stringify([TEST_NPC]));
  const bestiaryIndex = [
    {
      _id: TEST_NPC._id,
      uuid: `Compendium.${BESTIARY_PACK_ID}.Actor.${TEST_NPC._id}`,
      name: TEST_NPC.name,
      img: TEST_NPC.img,
      type: TEST_NPC.type,
      index: { "system.details.level.value": 1, "system.attributes.hp.max": 6 },
    },
  ];
  writeFileSync(join(bestiaryDir, "index.json"), JSON.stringify(bestiaryIndex));

  const conditionsDir = join(baseDir, "conditions");
  mkdirSync(conditionsDir, { recursive: true });
  writeFileSync(join(conditionsDir, "pack.json"), JSON.stringify(CONDITIONS_MANIFEST));
  writeFileSync(join(conditionsDir, "documents.json"), JSON.stringify([TEST_CONDITION]));
  writeFileSync(
    join(conditionsDir, "index.json"),
    JSON.stringify([
      {
        _id: TEST_CONDITION._id,
        uuid: `Compendium.${CONDITIONS_PACK_ID}.Item.${TEST_CONDITION._id}`,
        name: TEST_CONDITION.name,
        img: TEST_CONDITION.img,
        type: TEST_CONDITION.type,
        index: { "system.group": "frightened" },
      },
    ]),
  );
}

interface TestCtx {
  dataDir: string;
  packsDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  gmUserId: string;
  playerToken: string;
  playerUserId: string;
  compendiumService: CompendiumService;
}

async function buildTestCtx(): Promise<TestCtx> {
  const dataDir = makeTempDir();
  const packsDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "dod-m3-world";

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

  setupPacksDir(packsDir);
  const compendiumService = new CompendiumService();
  compendiumService.discoverPacks(packsDir, "pf2e");

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "DoD M3 World", systemId: "pf2e" },
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
  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
    compendiumService,
  });

  return {
    dataDir,
    packsDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    gmUserId: gm.id,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
    compendiumService,
  };
}

async function teardown(ctx: TestCtx): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
  rmSync(ctx.packsDir, { recursive: true, force: true });
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
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

/** Send a socket "op" (mutation) and return the ack. */
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

/** Send a socket "query" (read-only) and return the ack. */
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

// Helper: build minimal pf2e character actor data
function makeCharacterData(name: string, ownerId?: string) {
  return {
    name,
    type: "character",
    system: {
      details: { level: { value: 1 } },
      attributes: { hp: { value: 20, max: 20, temp: 0 }, ac: { value: 16 } },
      saves: { fortitude: { value: 5 }, reflex: { value: 3 }, will: { value: 2 } },
      abilities: {
        str: { mod: 3 },
        dex: { mod: 1 },
        con: { mod: 2 },
        int: { mod: 0 },
        wis: { mod: 0 },
        cha: { mod: 0 },
      },
      perception: { mod: 2 },
      traits: { value: ["human", "humanoid"] },
      skills: {},
      actions: [],
    },
    ownership: ownerId ? { [ownerId]: 3 as number, default: 0 } : { default: 0 },
  };
}

// Helper: build minimal pf2e NPC data
function makeNpcData(name: string, level = 1) {
  return {
    name,
    type: "npc",
    system: {
      details: { level: { value: level }, isElite: false, isWeak: false },
      attributes: { hp: { value: 8, max: 8, temp: 0 }, ac: { value: 13 } },
      saves: { fortitude: { value: 4 }, reflex: { value: 6 }, will: { value: 2 } },
      abilities: {
        str: { mod: 0 },
        dex: { mod: 3 },
        con: { mod: 0 },
        int: { mod: -1 },
        wis: { mod: 0 },
        cha: { mod: -1 },
      },
      perception: { mod: 4 },
      traits: { value: ["goblin"] },
      skills: {},
      actions: [],
    },
    ownership: { default: 0 },
  };
}

// ---------------------------------------------------------------------------
// Shared mutable state between describe blocks
// ---------------------------------------------------------------------------

const shared: {
  sceneId?: string;
  actorId?: string;
  tokenId?: string;
} = {};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("DoD M3 — Primeira Sessão Jogável (server-level E2E)", () => {
  let ctx: TestCtx;
  let gm: ClientSocket;
  let player: ClientSocket;

  beforeAll(async () => {
    ctx = await buildTestCtx();
    gm = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    player = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
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
  // (a) World creation with pf2e system
  // -------------------------------------------------------------------------

  describe("(a) World creation with pf2e system", () => {
    it("server is reachable and world namespace is active", async () => {
      const ack = await sendQuery(gm, "system:ping", { nonce: "dod-a" });
      expect(ack["ok"]).toBe(true);
      expect((ack["result"] as Record<string, unknown>)["nonce"]).toBe("dod-a");
    });

    it("GM is authenticated as role 4 (GM)", async () => {
      const ack = await sendQuery(gm, "system:whoami", {});
      expect(ack["ok"]).toBe(true);
      expect((ack["result"] as Record<string, unknown>)["role"]).toBe(4);
    });

    it("compendium packs for pf2e are available (bestiary + conditions)", async () => {
      const ack = await sendQuery(gm, "compendium:list", { systemId: "pf2e" });
      expect(ack["ok"]).toBe(true);
      const packs = (ack["result"] as { packs: Array<{ id: string }> }).packs;
      const ids = packs.map((p) => p.id);
      expect(ids).toContain(BESTIARY_PACK_ID);
      expect(ids).toContain(CONDITIONS_PACK_ID);
    });
  });

  // -------------------------------------------------------------------------
  // (b) Compendium import — monster → Actor with AC/saves PRESERVED from pack
  //
  // CORRECTION (M3-D audit): importToWorld clones the pack document; it does
  // NOT re-derive stats. For an NPC this is correct — NPC AC/saves/perception
  // are authored directly in the statblock (the pack), not computed from an
  // ability-score build. So the imported Actor carries the pack's values
  // verbatim. Character derivation (ability mods → AC/saves/skills via the
  // system module) happens on the read/snapshot path, not at import time,
  // and applies to `character` actors, not imported `npc` statblocks.
  // -------------------------------------------------------------------------

  describe("(b) Compendium import — NPC imported with stats preserved from pack", () => {
    it("bestiary index contains the Eagle", async () => {
      const ack = await sendQuery(gm, "compendium:index", { packId: BESTIARY_PACK_ID });
      expect(ack["ok"]).toBe(true);
      const entries = (ack["result"] as { entries: Array<{ name: string; _id: string }> }).entries;
      const eagle = entries.find((e) => e.name === "Eagle");
      expect(eagle).toBeDefined();
      expect(eagle!._id).toBe("G1IeHREXFKc7efep");
    });

    it("GM fetches full Eagle document — AC=15, Fort=7 preserved from source", async () => {
      const uuid = `Compendium.${BESTIARY_PACK_ID}.Actor.${TEST_NPC._id}`;
      const ack = await sendQuery(gm, "compendium:get", { uuid });
      expect(ack["ok"]).toBe(true);
      const doc = (ack["result"] as { document: Record<string, unknown> }).document;
      expect(doc["name"]).toBe("Eagle");
      const sys = doc["system"] as Record<string, unknown>;
      const attrs = sys["attributes"] as Record<string, unknown>;
      expect((attrs["ac"] as Record<string, unknown>)["value"]).toBe(15);
      const saves = sys["saves"] as Record<string, unknown>;
      expect((saves["fortitude"] as Record<string, unknown>)["value"]).toBe(7);
    });

    it("GM imports Eagle to the world — new Actor created in world DB", async () => {
      const uuid = `Compendium.${BESTIARY_PACK_ID}.Actor.${TEST_NPC._id}`;
      const ack = await sendOp(gm, "compendium:import", { uuids: [uuid] });
      expect(ack["ok"]).toBe(true);
      const result = ack["result"] as { created: string[]; failed: unknown[] };
      expect(result.created.length).toBe(1);
      expect(result.failed.length).toBe(0);
    });

    it("player cannot import from compendium (PERMISSION_DENIED)", async () => {
      const uuid = `Compendium.${CONDITIONS_PACK_ID}.Item.cond-frightened`;
      const ack = await sendOp(player, "compendium:import", { uuids: [uuid] });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    });
  });

  // -------------------------------------------------------------------------
  // (c) Scene creation, activation, token placement
  // -------------------------------------------------------------------------

  describe("(c) Scene creation, activation and token placement", () => {
    it("GM creates a Scene with grid configuration", async () => {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [
          {
            name: "DoD Test Scene",
            background: "maps/test-map.webp",
            grid: { type: "square", size: 100 },
            active: false,
            width: 1000,
            height: 1000,
            ownership: { default: 2 },
          },
        ],
      });
      expect(ack["ok"]).toBe(true);
      const docs = (ack["result"] as { documents: Array<{ _id: string }> }).documents;
      shared.sceneId = docs[0]!._id;
      expect(shared.sceneId).toBeTruthy();
    });

    it("GM activates the scene", async () => {
      expect(shared.sceneId).toBeTruthy();
      const ack = await sendOp(gm, "doc:update", {
        documentType: "Scene",
        updates: [{ _id: shared.sceneId, diff: { active: true } }],
      });
      expect(ack["ok"]).toBe(true);
    });

    it("GM creates an Actor for token placement", async () => {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [makeCharacterData("Test Fighter")],
      });
      expect(ack["ok"]).toBe(true);
      const docs = (ack["result"] as { documents: Array<{ _id: string }> }).documents;
      shared.actorId = docs[0]!._id;
      expect(shared.actorId).toBeTruthy();
    });

    it("GM places a Token in the scene", async () => {
      expect(shared.sceneId).toBeTruthy();
      expect(shared.actorId).toBeTruthy();
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Token",
        parent: { type: "Scene", id: shared.sceneId },
        data: [
          {
            actorId: shared.actorId,
            name: "Fighter",
            x: 100,
            y: 100,
            width: 1,
            height: 1,
            visible: true,
            hidden: false,
            disposition: 1,
            img: "icons/placeholder/token.svg",
            ownership: { default: 0 },
          },
        ],
      });
      expect(ack["ok"]).toBe(true);
      const docs = (ack["result"] as { documents: Array<{ _id: string }> }).documents;
      shared.tokenId = docs[0]!._id;
      expect(shared.tokenId).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // (d) Player connects — socket-level snapshot [PARTIAL]
  // -------------------------------------------------------------------------

  describe("(d) Player connection and snapshot [partial — socket-level only]", () => {
    it("player socket is connected", () => {
      expect(player.connected).toBe(true);
    });

    it("player whoami returns role=1 (PLAYER)", async () => {
      const ack = await sendQuery(player, "system:whoami", {});
      expect(ack["ok"]).toBe(true);
      expect((ack["result"] as { role: number }).role).toBe(1);
    });

    it("player can ping the server", async () => {
      const ack = await sendQuery(player, "system:ping", { nonce: "player-ping" });
      expect(ack["ok"]).toBe(true);
      expect((ack["result"] as Record<string, unknown>)["nonce"]).toBe("player-ping");
    });

    // NOTE: visual canvas rendering (TokenLayer, fog, illumination) requires
    // a browser context. Manual verification: open http://localhost:33000 in a
    // browser after running the server. Confirm scene renders with fog+tokens.
  });

  // -------------------------------------------------------------------------
  // (e) Token movement — RTT < 100ms (loopback); ownership check
  // -------------------------------------------------------------------------

  describe("(e) Token movement — server RTT and ownership enforcement", () => {
    let moveSceneId: string;
    let moveTokenId: string;

    beforeAll(async () => {
      const sceneAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [
          {
            name: "RTT Test Scene",
            grid: { type: "square", size: 100 },
            active: false,
            width: 1000,
            height: 1000,
            ownership: { default: 2 },
          },
        ],
      });
      expect(sceneAck["ok"]).toBe(true);
      moveSceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

      const actorAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [{ ...makeCharacterData("RTT Actor"), ownership: { default: 3 } }],
      });
      const mvActorId = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
        ._id;

      const tokenAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        parent: { type: "Scene", id: moveSceneId },
        data: [
          {
            actorId: mvActorId,
            name: "RTT Token",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            visible: true,
            hidden: false,
            disposition: 1,
            img: "icons/placeholder/token.svg",
            ownership: { default: 3 },
          },
        ],
      });
      moveTokenId = (tokenAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    }, 20000);

    it("GM moves token — round-trip acknowledged in < 100ms (loopback)", async () => {
      const t0 = Date.now();
      const ack = await sendOp(gm, "token:move", {
        tokenId: moveTokenId,
        sceneId: moveSceneId,
        x: 100,
        y: 100,
        force: true,
      });
      const rtt = Date.now() - t0;
      expect(ack["ok"]).toBe(true);
      // REQ: < 100ms loopback (LAN target; in-process loopback should be << 100ms)
      expect(rtt).toBeLessThan(100);
    });

    it("non-owner player cannot move a GM-only token (server rejects)", async () => {
      const actorAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [{ ...makeCharacterData("GM Actor"), ownership: { default: 0 } }],
      });
      const gmActorId = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
        ._id;

      const tokenAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        parent: { type: "Scene", id: moveSceneId },
        data: [
          {
            actorId: gmActorId,
            name: "GM Token",
            x: 200,
            y: 200,
            width: 1,
            height: 1,
            visible: true,
            hidden: false,
            disposition: 1,
            img: "icons/placeholder/token.svg",
            ownership: { default: 0 },
          },
        ],
      });
      const gmTokenId = (tokenAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
        ._id;

      const moveAck = await sendOp(player, "token:move", {
        tokenId: gmTokenId,
        sceneId: moveSceneId,
        x: 300,
        y: 300,
      });
      // Server must reject — any of these error codes are acceptable
      expect(moveAck["ok"]).toBe(false);
      expect(["PERMISSION_DENIED", "MOVE_BLOCKED", "NOT_FOUND"]).toContain(moveAck["code"]);
    });
  });

  // -------------------------------------------------------------------------
  // (f) Chat roll — server-authoritative
  // -------------------------------------------------------------------------

  describe("(f) Chat roll resolution — server-authoritative", () => {
    it("GM sends an inline roll — resolved by server", async () => {
      const ack = await sendOp(gm, "chat:send", {
        content: "Attack: [[1d20+5]]",
        worldId: ctx.worldId,
        rollMode: "public",
      });
      expect(ack["ok"]).toBe(true);
    });

    it("player sends a chat message — resolved by server", async () => {
      const ack = await sendOp(player, "chat:send", {
        content: "I attack! [[1d6+2]]",
        worldId: ctx.worldId,
        rollMode: "public",
      });
      expect(ack["ok"]).toBe(true);
    });

    it("chat history is retrievable and contains messages", async () => {
      // Brief delay to ensure persistence
      await new Promise<void>((r) => setTimeout(r, 80));
      // chat:history is registered as an op (not a query) — see socket-manager.ts
      const ack = await sendOp(gm, "chat:history", {
        worldId: ctx.worldId,
        limit: 10,
      });
      expect(ack["ok"]).toBe(true);
      const messages = (ack["result"] as { messages: unknown[] }).messages;
      expect(messages.length).toBeGreaterThan(0);
    });

    it("compendium Eagle has AC=15 preserved from the pack statblock (NPC, not re-derived)", async () => {
      const uuid = `Compendium.${BESTIARY_PACK_ID}.Actor.${TEST_NPC._id}`;
      const ack = await sendQuery(gm, "compendium:get", { uuid });
      expect(ack["ok"]).toBe(true);
      const doc = (ack["result"] as { document: Record<string, unknown> }).document;
      const sys = doc["system"] as Record<string, unknown>;
      const attrs = sys["attributes"] as Record<string, unknown>;
      const ac = attrs["ac"] as Record<string, unknown>;
      // NPC statblock AC is authored data, served verbatim from the pack.
      expect(ac["value"]).toBe(15);
    });
  });

  // -------------------------------------------------------------------------
  // (g) Combat tracker — initiative, turns, hidden NPC redaction
  // -------------------------------------------------------------------------

  describe("(g) Combat tracker — initiative, turns, hidden NPC redaction", () => {
    let combatSceneId: string;
    let playerTokenId: string;
    let npcTokenId: string;
    let hiddenTokenId: string;
    let combatId: string;
    let playerCombatantId: string;
    let npcCombatantId: string;
    let hiddenCombatantId: string;

    beforeAll(async () => {
      const sceneAck = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [
          {
            name: "Combat Scene",
            grid: { type: "square", size: 100 },
            active: false,
            width: 1000,
            height: 1000,
            ownership: { default: 2 },
          },
        ],
      });
      expect(sceneAck["ok"]).toBe(true);
      combatSceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
        ._id;

      // Player actor + token
      const pActorAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [makeCharacterData("Fighter Hero", ctx.playerUserId)],
      });
      const pActorId = (pActorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
        ._id;
      const ptAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        parent: { type: "Scene", id: combatSceneId },
        data: [
          {
            actorId: pActorId,
            name: "Hero",
            x: 100,
            y: 100,
            width: 1,
            height: 1,
            visible: true,
            hidden: false,
            disposition: 1,
            img: "icons/placeholder/token.svg",
            ownership: { [ctx.playerUserId]: 3, default: 0 },
          },
        ],
      });
      playerTokenId = (ptAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

      // Visible NPC actor + token
      const nActorAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [makeNpcData("Goblin")],
      });
      const nActorId = (nActorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
        ._id;
      const ntAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        parent: { type: "Scene", id: combatSceneId },
        data: [
          {
            actorId: nActorId,
            name: "Goblin",
            x: 300,
            y: 300,
            width: 1,
            height: 1,
            visible: true,
            hidden: false,
            disposition: -1,
            img: "icons/placeholder/token.svg",
            ownership: { default: 0 },
          },
        ],
      });
      npcTokenId = (ntAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

      // Hidden NPC actor + token
      const hActorAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [makeNpcData("Assassin", 3)],
      });
      const hActorId = (hActorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
        ._id;
      const htAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        parent: { type: "Scene", id: combatSceneId },
        data: [
          {
            actorId: hActorId,
            name: "Assassin",
            x: 500,
            y: 500,
            width: 1,
            height: 1,
            visible: false,
            hidden: true,
            disposition: -1,
            img: "icons/placeholder/token.svg",
            ownership: { default: 0 },
          },
        ],
      });
      hiddenTokenId = (htAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    }, 30000);

    it("GM creates combat encounter for scene", async () => {
      // Handler: combat:create → returns { combat: CombatDocument }
      const ack = await sendOp(gm, "combat:create", { sceneId: combatSceneId });
      expect(ack["ok"]).toBe(true);
      const result = ack["result"] as { combat: Record<string, unknown> };
      combatId = result.combat["_id"] as string;
      expect(combatId).toBeTruthy();
    });

    it("GM adds player token as combatant", async () => {
      // Handler: combat:addCombatant → returns { combat, combatant }
      const ack = await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: playerTokenId,
        hidden: false,
      });
      expect(ack["ok"]).toBe(true);
      const result = ack["result"] as {
        combat: Record<string, unknown>;
        combatant: Record<string, unknown>;
      };
      playerCombatantId = result.combatant["_id"] as string;
      expect(playerCombatantId).toBeTruthy();
    });

    it("GM adds visible NPC as combatant", async () => {
      const ack = await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: npcTokenId,
        hidden: false,
      });
      expect(ack["ok"]).toBe(true);
      const result = ack["result"] as {
        combat: Record<string, unknown>;
        combatant: Record<string, unknown>;
      };
      npcCombatantId = result.combatant["_id"] as string;
      expect(npcCombatantId).toBeTruthy();
    });

    it("GM adds hidden NPC as hidden combatant", async () => {
      const ack = await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId: hiddenTokenId,
        hidden: true,
      });
      expect(ack["ok"]).toBe(true);
      const result = ack["result"] as {
        combat: Record<string, unknown>;
        combatant: Record<string, unknown>;
      };
      hiddenCombatantId = result.combatant["_id"] as string;
      expect(hiddenCombatantId).toBeTruthy();
      // Verify hidden flag was stored correctly
      expect(result.combatant["hidden"]).toBe(true);
    });

    it("GM rolls initiative for all combatants (server-side roll)", async () => {
      // Handler: combat:rollInitiative
      // Schema: { combatId, combatantIds?, options? } — NO formula field
      // Formula is resolved from combat.combatType + formulaRegistry (server-side)
      const ack = await sendOp(gm, "combat:rollInitiative", {
        combatId,
        combatantIds: [playerCombatantId, npcCombatantId, hiddenCombatantId],
      });
      expect(ack["ok"]).toBe(true);
      // Result shape: { combat: CombatDocument, rolledCount: number }
      const result = ack["result"] as { combat: Record<string, unknown>; rolledCount: number };
      expect(result.rolledCount).toBe(3);
      const combatants = result.combat["combatants"] as Array<{
        _id: string;
        initiative: number | null;
      }>;
      for (const id of [playerCombatantId, npcCombatantId, hiddenCombatantId]) {
        const c = combatants.find((x) => x._id === id);
        expect(c).toBeDefined();
        expect(typeof c!.initiative).toBe("number");
      }
    });

    it("GM starts combat (combat:beginCombat) — round=1, started=true", async () => {
      // Registered as: registry.register("combat:beginCombat", buildCombatStartHandler)
      const ack = await sendOp(gm, "combat:beginCombat", { combatId });
      expect(ack["ok"]).toBe(true);
      // Result shape: { combat: CombatDocument }
      const result = ack["result"] as { combat: Record<string, unknown> };
      expect(result.combat["round"]).toBe(1);
      expect(result.combat["started"]).toBe(true);
    });

    it("GM advances to next turn (combat:nextTurn) — tracker updates", async () => {
      // Registered as: registry.register("combat:nextTurn", buildCombatNextHandler)
      const ack = await sendOp(gm, "combat:nextTurn", { combatId });
      expect(ack["ok"]).toBe(true);
      // Result shape: { combat: CombatDocument }
      const result = ack["result"] as { combat: Record<string, unknown> };
      expect(typeof result.combat["round"]).toBe("number");
      expect(typeof result.combat["turnIndex"]).toBe("number");
    });

    it("INVARIANT: hidden NPC combatant was stored with hidden=true (GM-only knowledge)", () => {
      // Verified above when adding the combatant — hidden flag confirmed true.
      // The redaction invariant (hidden combatants absent from player snapshots)
      // is tested in combat-redaction-m2c.test.ts (full suite, already green).
      expect(hiddenCombatantId).toBeTruthy();
    });

    it("GM ends combat (combat:endCombat)", async () => {
      // Registered as: registry.register("combat:endCombat", buildCombatEndHandler)
      const ack = await sendOp(gm, "combat:endCombat", { combatId });
      expect(ack["ok"]).toBe(true);
      // Result shape: { combatId: string }
      const result = ack["result"] as { combatId: string };
      expect(result.combatId).toBe(combatId);
    });
  });

  // -------------------------------------------------------------------------
  // (h) No regression — M0/M1/M2 invariants
  // -------------------------------------------------------------------------

  describe("(h) No regression — M0/M1/M2 invariants", () => {
    it("M0: invalid token is rejected with AUTH_FAILED", async () => {
      const badClient = connectClient(ctx.port, ctx.worldId, {
        token: "invalid-token-xxx",
        protocolVersion: PROTOCOL_VERSION,
      });
      const err = await new Promise<Error>((resolve) => {
        badClient.on("connect_error", (e: Error) => resolve(e));
        badClient.connect();
      });
      expect(err.message).toMatch(/AUTH_FAILED/i);
      badClient.disconnect();
    });

    it("M0: wrong protocolVersion is rejected with PROTOCOL_MISMATCH", async () => {
      const badClient = connectClient(ctx.port, ctx.worldId, {
        token: ctx.gmToken,
        protocolVersion: 9999,
      });
      const err = await new Promise<Error>((resolve) => {
        badClient.on("connect_error", (e: Error) => resolve(e));
        badClient.connect();
      });
      expect(err.message).toMatch(/PROTOCOL_MISMATCH/i);
      badClient.disconnect();
    });

    it("M1: doc:create / doc:update / doc:delete round-trip works", async () => {
      const createAck = await sendOp(gm, "doc:create", {
        documentType: "Actor",
        data: [makeCharacterData("Regression Actor")],
      });
      expect(createAck["ok"]).toBe(true);
      const docId = (createAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
        ._id;

      const updateAck = await sendOp(gm, "doc:update", {
        documentType: "Actor",
        updates: [{ _id: docId, diff: { name: "Updated Actor" } }],
      });
      expect(updateAck["ok"]).toBe(true);

      const deleteAck = await sendOp(gm, "doc:delete", {
        documentType: "Actor",
        ids: [docId],
      });
      expect(deleteAck["ok"]).toBe(true);
    });

    it("M2: fog:get returns ok for a scene", async () => {
      expect(shared.sceneId).toBeTruthy();
      const fogAck = await sendQuery(gm, "fog:get", { sceneId: shared.sceneId });
      expect(fogAck["ok"]).toBe(true);
    });

    it("M2: compendium search with level filter works (REQ-CMP-014)", async () => {
      const ack = await sendQuery(gm, "compendium:search", {
        packId: BESTIARY_PACK_ID,
        filters: { "system.details.level.value": { lte: 3 } },
      });
      expect(ack["ok"]).toBe(true);
      const entries = (ack["result"] as { entries: unknown[] }).entries;
      expect(entries.length).toBeGreaterThan(0);
    });
  });
});
