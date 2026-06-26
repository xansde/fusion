/**
 * Integration tests for compendium server handlers.
 *
 * Spec: 16-compendiums-e-importacao.md
 * REQ-CMP-006..018, REQ-CMP-021..024
 *
 * Coverage:
 *   CompendiumService:
 *     - discoverPacks: registers packs from directory
 *     - listPacks: filters by systemId and documentType
 *     - getPackIndex: lazy index build from index.json + documents.json fallback
 *     - searchPack: text + field filters
 *     - getDocument: UUID resolution
 *     - importToWorld: GM imports actor, rejects player
 *
 *   Socket handlers (integration):
 *     - compendium:list → returns manifests
 *     - compendium:index → returns index entries
 *     - compendium:search → text filter
 *     - compendium:get → full document
 *     - compendium:import → GM OK, player PERMISSION_DENIED
 *     - compendium:import → creates actor in world DB
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
// Fixtures — minimal pack data for testing
// ---------------------------------------------------------------------------

const PACK_ID = "pf2e.test-items";

const TEST_MANIFEST = {
  id: PACK_ID,
  label: "Test Items",
  documentType: "Item",
  systemId: "pf2e",
  indexFields: ["system.level.value", "system.traits.value"],
  license: {
    license: "ORC",
    attribution: "Test Attribution",
    reservedNotice: "",
  },
  source: { repo: null, version: null, importerVersion: "0.1.0" },
  documentCount: 3,
  generatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
};

const TEST_DOCUMENTS = [
  {
    _id: "item001",
    name: "Longsword",
    type: "weapon",
    img: "icons/placeholder/item.svg",
    system: {
      level: { value: 0 },
      traits: { value: ["versatile-p", "martial"] },
      damage: { die: "1d8", damageType: "slashing" },
    },
    flags: {
      fusion: {
        conversion: "full",
        importerVersion: "0.1.0",
        sourceVersion: "v14-dev",
        sourceId: "abc",
        packName: "test",
        unconvertedRules: [],
        assetSubstitutions: [],
      },
    },
  },
  {
    _id: "item002",
    name: "Fireball",
    type: "spell",
    img: "icons/placeholder/spell.svg",
    system: {
      level: { value: 3 },
      traits: { value: ["fire", "evocation"] },
    },
    flags: {
      fusion: {
        conversion: "full",
        importerVersion: "0.1.0",
        sourceVersion: "v14-dev",
        sourceId: "bcd",
        packName: "test",
        unconvertedRules: [],
        assetSubstitutions: [],
      },
    },
  },
  {
    _id: "item003",
    name: "Ice Shield",
    type: "spell",
    img: "icons/placeholder/spell.svg",
    system: {
      level: { value: 2 },
      traits: { value: ["cold", "abjuration"] },
    },
    flags: {
      fusion: {
        conversion: "full",
        importerVersion: "0.1.0",
        sourceVersion: "v14-dev",
        sourceId: "cde",
        packName: "test",
        unconvertedRules: [],
        assetSubstitutions: [],
      },
    },
  },
];

const TEST_INDEX = TEST_DOCUMENTS.map((d) => ({
  _id: d._id,
  uuid: `Compendium.${PACK_ID}.Item.${d._id}`,
  name: d.name,
  img: d.img,
  type: d.type,
  index: {
    "system.level.value": d.system.level?.value,
    "system.traits.value": d.system.traits?.value ?? [],
  },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-cmp-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create a test pack directory with pack.json, documents.json, index.json. */
function setupPackDir(baseDir: string): string {
  const packDir = join(baseDir, PACK_ID.split(".")[1]);
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, "pack.json"), JSON.stringify(TEST_MANIFEST));
  writeFileSync(join(packDir, "documents.json"), JSON.stringify(TEST_DOCUMENTS));
  writeFileSync(join(packDir, "index.json"), JSON.stringify(TEST_INDEX));
  return baseDir; // return the parent (packs root)
}

interface TestContext {
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
  compendiumService: CompendiumService;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "compendium-test-world";

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

  // Set up packs directory
  const packsDir = makeTempDir();
  setupPackDir(packsDir);

  const compendiumService = new CompendiumService();
  compendiumService.discoverPacks(packsDir, "pf2e");

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Compendium Test World", systemId: "pf2e" },
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
    compendiumService,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
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
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

/** Send a query (read-only) and return the ack. */
function sendQuery(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.emit("query", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for query: ${type}`)), 8000);
  });
}

/** Send an op (mutation) and return the ack. */
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

// ---------------------------------------------------------------------------
// Unit tests: CompendiumService
// ---------------------------------------------------------------------------

describe("CompendiumService — unit", () => {
  it("discoverPacks registers packs and builds index", () => {
    const packsDir = makeTempDir();
    setupPackDir(packsDir);

    const svc = new CompendiumService();
    svc.discoverPacks(packsDir);

    const packs = svc.listPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0].id).toBe(PACK_ID);
    expect(packs[0].documentCount).toBe(3);

    rmSync(packsDir, { recursive: true, force: true });
  });

  it("listPacks filters by systemId", () => {
    const packsDir = makeTempDir();
    setupPackDir(packsDir);

    const svc = new CompendiumService();
    svc.discoverPacks(packsDir);

    const pf2e = svc.listPacks({ systemId: "pf2e" });
    expect(pf2e).toHaveLength(1);

    const sf2e = svc.listPacks({ systemId: "sf2e" });
    expect(sf2e).toHaveLength(0);

    rmSync(packsDir, { recursive: true, force: true });
  });

  it("getPackIndex returns entries from index.json", () => {
    const packsDir = makeTempDir();
    setupPackDir(packsDir);

    const svc = new CompendiumService();
    svc.discoverPacks(packsDir);

    const idx = svc.getPackIndex(PACK_ID);
    expect(idx).not.toBeNull();
    expect(idx!.entries).toHaveLength(3);
    expect(idx!.entries[0]._id).toBe("item001");
    expect(idx!.entries[0].uuid).toBe(`Compendium.${PACK_ID}.Item.item001`);

    rmSync(packsDir, { recursive: true, force: true });
  });

  it("getPackIndex builds from documents.json when index.json is absent", () => {
    const packsDir = makeTempDir();
    const packSlug = PACK_ID.split(".")[1];
    const packDir = join(packsDir, packSlug);
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify(TEST_MANIFEST));
    writeFileSync(join(packDir, "documents.json"), JSON.stringify(TEST_DOCUMENTS));
    // NO index.json

    const svc = new CompendiumService();
    svc.discoverPacks(packsDir);

    const idx = svc.getPackIndex(PACK_ID);
    expect(idx).not.toBeNull();
    expect(idx!.entries).toHaveLength(3);
    // Check that indexFields were extracted
    const longsword = idx!.entries.find((e) => e._id === "item001");
    expect(longsword?.index["system.level.value"]).toBe(0);

    rmSync(packsDir, { recursive: true, force: true });
  });

  it("searchPack filters by text", () => {
    const packsDir = makeTempDir();
    setupPackDir(packsDir);

    const svc = new CompendiumService();
    svc.discoverPacks(packsDir);

    const results = svc.searchPack(PACK_ID, { packId: PACK_ID, text: "fire" });
    expect(results).not.toBeNull();
    expect(results!.map((e) => e._id)).toEqual(["item002"]);

    rmSync(packsDir, { recursive: true, force: true });
  });

  it("searchPack filters by trait contains", () => {
    const packsDir = makeTempDir();
    setupPackDir(packsDir);

    const svc = new CompendiumService();
    svc.discoverPacks(packsDir);

    const results = svc.searchPack(PACK_ID, {
      packId: PACK_ID,
      filters: { "system.traits.value": { contains: "fire" } },
    });
    expect(results!.map((e) => e._id)).toEqual(["item002"]);

    rmSync(packsDir, { recursive: true, force: true });
  });

  it("getDocument returns full document by UUID", () => {
    const packsDir = makeTempDir();
    setupPackDir(packsDir);

    const svc = new CompendiumService();
    svc.discoverPacks(packsDir);

    const uuid = `Compendium.${PACK_ID}.Item.item001`;
    const doc = svc.getDocument(uuid);
    expect(doc).not.toBeNull();
    expect(doc!["name"]).toBe("Longsword");
    expect(doc!["type"]).toBe("weapon");

    rmSync(packsDir, { recursive: true, force: true });
  });

  it("getDocument returns null for unknown UUID", () => {
    const packsDir = makeTempDir();
    setupPackDir(packsDir);

    const svc = new CompendiumService();
    svc.discoverPacks(packsDir);

    const doc = svc.getDocument(`Compendium.${PACK_ID}.Item.nonexistent`);
    expect(doc).toBeNull();

    rmSync(packsDir, { recursive: true, force: true });
  });

  it("getDocument returns null for invalid UUID format", () => {
    const svc = new CompendiumService();
    expect(svc.getDocument("Actor.abc123")).toBeNull();
  });

  it("discoverPacks is tolerant of missing/corrupt packs", () => {
    const packsDir = makeTempDir();
    // Create a dir without pack.json
    const emptyDir = join(packsDir, "empty-pack");
    mkdirSync(emptyDir, { recursive: true });

    const svc = new CompendiumService();
    // Should not throw
    expect(() => svc.discoverPacks(packsDir)).not.toThrow();
    expect(svc.listPacks()).toHaveLength(0);

    rmSync(packsDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Integration tests: socket handlers
// ---------------------------------------------------------------------------

describe("compendium socket handlers", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();

    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);

    // Allow join snapshot to be delivered
    await new Promise((r) => setTimeout(r, 100));
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  // ---- compendium:list ----

  it("compendium:list returns available packs to GM", async () => {
    const ack = await sendQuery(gmSocket, "compendium:list", {});
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as Record<string, unknown>;
    const packs = result["packs"] as unknown[];
    expect(packs).toHaveLength(1);
    expect((packs[0] as Record<string, unknown>)["id"]).toBe(PACK_ID);
  });

  it("compendium:list returns packs to player (read-only, no auth needed)", async () => {
    const ack = await sendQuery(playerSocket, "compendium:list", {});
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as Record<string, unknown>;
    const packs = result["packs"] as unknown[];
    expect(packs).toHaveLength(1);
  });

  it("compendium:list filters by systemId", async () => {
    const ack = await sendQuery(gmSocket, "compendium:list", { systemId: "sf2e" });
    expect(ack["ok"]).toBe(true);
    const packs = (ack["result"] as Record<string, unknown>)["packs"] as unknown[];
    expect(packs).toHaveLength(0);
  });

  // ---- compendium:index ----

  it("compendium:index returns index entries for a known pack", async () => {
    const ack = await sendQuery(gmSocket, "compendium:index", { packId: PACK_ID });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as Record<string, unknown>;
    expect(result["packId"]).toBe(PACK_ID);
    const entries = result["entries"] as unknown[];
    expect(entries).toHaveLength(3);
    const first = entries[0] as Record<string, unknown>;
    expect(first["_id"]).toBe("item001");
    expect(first["name"]).toBe("Longsword");
  });

  it("compendium:index returns NOT_FOUND for unknown pack", async () => {
    const ack = await sendQuery(gmSocket, "compendium:index", { packId: "pf2e.unknown" });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("NOT_FOUND");
  });

  // ---- compendium:search ----

  it("compendium:search filters by text", async () => {
    const ack = await sendQuery(gmSocket, "compendium:search", {
      packId: PACK_ID,
      text: "fire",
    });
    expect(ack["ok"]).toBe(true);
    const entries = (ack["result"] as Record<string, unknown>)["entries"] as unknown[];
    expect(entries).toHaveLength(1);
    expect((entries[0] as Record<string, unknown>)["name"]).toBe("Fireball");
  });

  it("compendium:search filters by trait", async () => {
    const ack = await sendQuery(gmSocket, "compendium:search", {
      packId: PACK_ID,
      filters: { "system.traits.value": { contains: "cold" } },
    });
    expect(ack["ok"]).toBe(true);
    const entries = (ack["result"] as Record<string, unknown>)["entries"] as unknown[];
    expect(entries).toHaveLength(1);
    expect((entries[0] as Record<string, unknown>)["name"]).toBe("Ice Shield");
  });

  it("compendium:search filters by level lte", async () => {
    const ack = await sendQuery(gmSocket, "compendium:search", {
      packId: PACK_ID,
      filters: { "system.level.value": { lte: 2 } },
    });
    expect(ack["ok"]).toBe(true);
    const entries = (ack["result"] as Record<string, unknown>)["entries"] as unknown[];
    // Longsword (0) and Ice Shield (2)
    expect(entries).toHaveLength(2);
  });

  // ---- compendium:get ----

  it("compendium:get returns full document by UUID", async () => {
    const uuid = `Compendium.${PACK_ID}.Item.item001`;
    const ack = await sendQuery(gmSocket, "compendium:get", { uuid });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as Record<string, unknown>)["document"] as Record<string, unknown>;
    expect(doc["name"]).toBe("Longsword");
    expect(doc["type"]).toBe("weapon");
    expect((doc["system"] as Record<string, unknown>)?.["damage"]).toBeDefined();
  });

  it("compendium:get returns NOT_FOUND for unknown UUID", async () => {
    const ack = await sendQuery(gmSocket, "compendium:get", {
      uuid: `Compendium.${PACK_ID}.Item.nonexistent`,
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("NOT_FOUND");
  });

  // ---- compendium:import ----

  it("compendium:import creates world document (GM)", async () => {
    const uuid = `Compendium.${PACK_ID}.Item.item001`;
    const ack = await sendOp(gmSocket, "compendium:import", { uuids: [uuid] });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as Record<string, unknown>;
    const created = result["created"] as string[];
    expect(created).toHaveLength(1);
    expect(created[0]).toBeTruthy();

    // Verify the document exists in the world DB
    const row = ctx.fusionDb.raw.prepare("SELECT data FROM items WHERE id = ?").get(created[0]) as
      | { data: string }
      | undefined;
    expect(row).toBeDefined();
    const docData = JSON.parse(row!.data) as Record<string, unknown>;
    expect(docData["name"]).toBe("Longsword");
    expect((docData["flags"] as Record<string, unknown>)?.["fusion"]).toBeDefined();
  });

  it("compendium:import rejects player with PERMISSION_DENIED", async () => {
    const uuid = `Compendium.${PACK_ID}.Item.item001`;
    const ack = await sendOp(playerSocket, "compendium:import", { uuids: [uuid] });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
  });

  it("compendium:import reports failed UUIDs without aborting", async () => {
    const goodUuid = `Compendium.${PACK_ID}.Item.item001`;
    const badUuid = `Compendium.${PACK_ID}.Item.nonexistent`;
    const ack = await sendOp(gmSocket, "compendium:import", {
      uuids: [goodUuid, badUuid],
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as Record<string, unknown>;
    expect(result["created"] as string[]).toHaveLength(1);
    const failed = result["failed"] as Array<{ uuid: string; reason: string }>;
    expect(failed).toHaveLength(1);
    expect(failed[0].uuid).toBe(badUuid);
  });

  it("compendium:import broadcasts compendium:imported event to all clients", async () => {
    const uuid = `Compendium.${PACK_ID}.Item.item002`;

    // The generic broadcast goes to ALL clients (worldId only — no sensitive ids).
    const importedPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timeout waiting for compendium:imported")),
        5000,
      );
      gmSocket.once("compendium:imported", (payload: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    // The detail broadcast (with created[]) goes only to the "gm" room.
    const detailPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timeout waiting for compendium:imported:detail")),
        5000,
      );
      gmSocket.once("compendium:imported:detail", (payload: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    await sendOp(gmSocket, "compendium:import", { uuids: [uuid] });

    // Generic notification: worldId present, no created[] (security: ids not broadcast to all)
    const event = await importedPromise;
    expect(event["worldId"]).toBe(ctx.worldId);
    expect(event["created"]).toBeUndefined();

    // Detail notification: created[] present (privileged gm room only)
    const detail = await detailPromise;
    expect(detail["worldId"]).toBe(ctx.worldId);
    expect(Array.isArray(detail["created"])).toBe(true);
    expect(detail["created"] as string[]).toHaveLength(1);
  });
});
