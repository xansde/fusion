/**
 * T016 — write instrumentation of the DocumentStore.
 *
 * THE ORACLES, AND WHY NONE OF THEM IS CIRCULAR
 * ---------------------------------------------
 * The report has four kinds of number, and each is anchored to a source the
 * collector cannot influence:
 *
 *   - COUNTS → `_stats.version` read straight from the database (below);
 *   - BYTES  → either `length(data)` of the row SQLite holds, or a payload
 *              the TEST itself built, byte-counted independently;
 *   - LATENCY / RATES → fed as known input into a collector of the test's
 *              own and asserted as known output;
 *   - LIFECYCLE (flush on close, timer unref, rollback) → observed on the
 *              real objects, never on a counter.
 *
 * Nothing here compares a report field against the expression that produced
 * it: an assertion that only re-runs the implementation would survive any
 * change to that implementation, which is lesson #48 of this project.
 *
 * The count oracle, in detail. `_stats.version` is bumped by
 * `buildUpdateStats` every time
 * `_updateInTxn` reaches its end without the no-op early return, and a create
 * lands with version 1 — so for any window:
 *
 *     writes to a table  ==  Σ (version_after − version_before)  over rows that
 *                            already existed
 *                        +   Σ version_after  over rows created in the window
 *
 * That number is produced by the database, which knows nothing about the
 * collector. What the comparison actually catches is not "does the store bump
 * the version" (T013 already covers that) but "did the write reach the place
 * where the metric is counted, or did it find a path around it" — the exact
 * defect that sank the first T016 design, where a metric counted at handler
 * level was blind to writes that still reached `_updateInTxn`.
 *
 * For that reason the cases below drive PRODUCTION HANDLERS over a real socket
 * (doc/vision/combat), not `store.update` — with one deliberate exception, the
 * batch case, which has no production caller at all and is where a metric
 * placed around the public `update()` would go silently blind.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import type { Database as RawDb } from "better-sqlite3";
import pino from "pino";

import { boot } from "../boot.js";
import type { BootResult } from "../boot.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { DocumentStore } from "../documents/store.js";
import { WriteMetricsCollector, WRITE_METRICS_SCOPE } from "../documents/write-metrics.js";
import type { WriteMetricsEvent } from "../documents/write-metrics.js";
import type { Logger } from "../logger.js";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

/** Tables the oracle watches. `settings`/`chat_messages` are written by raw SQL
 * elsewhere and are not part of what T016 instruments. */
const MEASURED_TABLES = ["scenes", "actors", "combats"] as const;
type MeasuredTable = (typeof MEASURED_TABLES)[number];

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  collector: WriteMetricsCollector;
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-write-metrics-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "write_metrics_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: await reserveFreePort(), host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Write Metrics World",
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
    },
  });

  const collector = bootResult.socketManager?.writeMetricsFor(worldId);
  if (!collector) throw new Error("SocketManager did not register a write-metrics collector");
  // Kill the periodic flush for the duration of the test: a flush resets the
  // window, and one landing between a measurement's "before" and "after" would
  // make the oracle read a truncated count. World close still flushes.
  collector.stop();

  return {
    dataDir,
    fusionDb,
    bootResult,
    port: listeningPort(bootResult.fastify),
    worldId,
    gmToken: gmLogin.accessToken,
    collector,
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
// The oracle: version deltas read from the database
// ---------------------------------------------------------------------------

type VersionMap = Map<string, number>;

function readVersions(raw: RawDb, table: MeasuredTable): VersionMap {
  const rows = raw.prepare(`SELECT id, data FROM ${table}`).all() as Array<{
    id: string;
    data: string;
  }>;
  const versions: VersionMap = new Map();
  for (const row of rows) {
    const doc = JSON.parse(row.data) as { _stats?: { version?: number } };
    versions.set(row.id, doc._stats?.version ?? 0);
  }
  return versions;
}

/**
 * Real writes a table took, derived only from the database.
 *
 * A row that already existed took one write per version bump. A row that did
 * not exist took its create (which lands at version 1) plus one write per
 * later bump — so its total is exactly its final version. A row that vanished
 * took a `delete`, which is out of T016's scope and correctly contributes 0.
 */
function expectedWrites(before: VersionMap, after: VersionMap): number {
  let total = 0;
  for (const [id, version] of after) {
    const previous = before.get(id);
    total += previous === undefined ? version : version - previous;
  }
  return total;
}

function metricCounts(collector: WriteMetricsCollector): Record<string, number> {
  const report = collector.snapshot();
  const counts: Record<string, number> = {};
  if (report === null) return counts;
  for (const [table, entry] of Object.entries(report.byTable)) counts[table] = entry.count;
  return counts;
}

function readAllVersions(raw: RawDb): Map<MeasuredTable, VersionMap> {
  return new Map(MEASURED_TABLES.map((t) => [t, readVersions(raw, t)]));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("T016 — DocumentStore write metrics", () => {
  let ctx: Ctx;
  let gm: ClientSocket;

  /**
   * Runs `act` and asserts, for every measured table, that the collector
   * counted exactly as many writes as the database says happened.
   */
  async function withOracle(step: string, act: () => Promise<void>): Promise<void> {
    const versionsBefore = readAllVersions(ctx.fusionDb.raw);
    const countsBefore = metricCounts(ctx.collector);

    await act();

    const versionsAfter = readAllVersions(ctx.fusionDb.raw);
    const countsAfter = metricCounts(ctx.collector);

    for (const table of MEASURED_TABLES) {
      const expected = expectedWrites(
        versionsBefore.get(table) ?? new Map(),
        versionsAfter.get(table) ?? new Map(),
      );
      const counted = (countsAfter[table] ?? 0) - (countsBefore[table] ?? 0);
      expect({ step, table, writes: counted }).toEqual({ step, table, writes: expected });
    }
  }

  async function createScene(name: string): Promise<string> {
    const ack = await sendOp(gm, "doc:create", { documentType: "Scene", data: [{ name }] });
    expect(ack["ok"]).toBe(true);
    return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }

  async function createToken(sceneId: string, name: string, x = 10, y = 10): Promise<string> {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name, x, y }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(true);
    return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }

  async function createActor(name: string): Promise<string> {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name, type: "npc", system: {}, ownership: { default: 0 } }],
    });
    expect(ack["ok"]).toBe(true);
    return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
  }, 30000);

  afterAll(async () => {
    gm.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // Case 1 — coverage through the real paths
  // -------------------------------------------------------------------------

  it("counts every write driven by a production handler (doc / vision / combat)", async () => {
    let sceneId = "";
    let actorId = "";
    let tokenId = "";
    let wallId = "";
    let combatId = "";

    await withOracle("doc:create Scene", async () => {
      sceneId = await createScene("Metrics Scene");
    });

    // The oracle's arithmetic assumes a create lands at version 1 — stated
    // here explicitly instead of being buried in `expectedWrites`.
    const freshScene = JSON.parse(
      (
        ctx.fusionDb.raw.prepare(`SELECT data FROM scenes WHERE id = ?`).get(sceneId) as {
          data: string;
        }
      ).data,
    ) as { _stats: { version: number } };
    expect(freshScene._stats.version).toBe(1);

    // A fresh window so the create below is the ONLY write in it, and its
    // reported bytes can be compared against the row SQLite ended up with.
    ctx.collector.flush();

    let bornWithTokensId = "";
    await withOracle("doc:create Scene with embedded tokens", async () => {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Scene",
        data: [
          {
            name: "Scene Born With Tokens",
            tokens: [{ _id: "aaaaaaaaaaaaaaaa", name: "Seed", x: 0, y: 0, hidden: false }],
          },
        ],
      });
      expect(ack["ok"]).toBe(true);
      bornWithTokensId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    });

    // The create path's own bytes and attribution, both read from outside the
    // collector: the row as persisted, and the fact that a scene born with a
    // token is token pressure too (that is what `embeddedCollectionKeys` is
    // for, and it is invisible in every count-only assertion).
    const createWindow = ctx.collector.snapshot();
    const createdScene = createWindow?.byTable["scenes"];
    const bornRow = (
      ctx.fusionDb.raw.prepare(`SELECT data FROM scenes WHERE id = ?`).get(bornWithTokensId) as {
        data: string;
      }
    ).data;
    expect(createdScene?.count).toBe(1);
    expect(createdScene?.byOp).toEqual({ create: 1, update: 0 });
    expect(createdScene?.rowBytesTotal).toBe(Buffer.byteLength(bornRow, "utf8"));
    // A create rewrites nothing it did not bring: payload == row.
    expect(createdScene?.deltaBytesAvg).toBe(Buffer.byteLength(bornRow, "utf8"));
    expect(createdScene?.byPatchKey).toEqual({ tokens: 1 });

    await withOracle("doc:create Actor", async () => {
      actorId = await createActor("Metrics Actor");
    });

    await withOracle("doc:create Token (embedded → writes the Scene row)", async () => {
      tokenId = await createToken(sceneId, "Metrics Token", 50, 100);
    });

    await withOracle("doc:update Token (embedded)", async () => {
      const ack = await sendOp(gm, "doc:update", {
        documentType: "Token",
        updates: [
          { _id: tokenId, diff: { x: 60, y: 110 }, embedded: { type: "Token", id: sceneId } },
        ],
      });
      expect(ack["ok"]).toBe(true);
    });

    await withOracle("token:move (vision handler)", async () => {
      const ack = await sendOp(gm, "token:move", { sceneId, tokenId, x: 80, y: 120 });
      expect(ack["ok"]).toBe(true);
    });

    await withOracle("doc:update Actor (generic primary path)", async () => {
      const ack = await sendOp(gm, "doc:update", {
        documentType: "Actor",
        updates: [{ _id: actorId, diff: { name: "Metrics Actor Renamed" } }],
      });
      expect(ack["ok"]).toBe(true);
    });

    // Embedded Item on the OTHER polymorphic branch: `items` lives on the
    // `actors` row exactly as `tokens` lives on `scenes`, and until this step
    // existed the `items` attribution had never run at all.
    let itemId = "";
    await withOracle("doc:create Item (embedded → writes the Actor row)", async () => {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Item",
        data: [{ name: "Metrics Item", type: "equipment", system: {} }],
        parent: { type: "Actor", id: actorId },
      });
      expect(ack["ok"]).toBe(true);
      itemId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    });

    await withOracle("doc:update Item (embedded)", async () => {
      const ack = await sendOp(gm, "doc:update", {
        documentType: "Item",
        updates: [
          {
            _id: itemId,
            diff: { name: "Metrics Item Renamed" },
            embedded: { type: "Item", id: actorId },
          },
        ],
      });
      expect(ack["ok"]).toBe(true);
    });

    await withOracle("wall:create", async () => {
      const ack = await sendOp(gm, "wall:create", {
        documentType: "Wall",
        data: [{ a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, doorType: "door", doorState: "closed" }],
        parent: { type: "Scene", id: sceneId },
      });
      expect(ack["ok"]).toBe(true);
      wallId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    });

    await withOracle("wall:update", async () => {
      const ack = await sendOp(gm, "wall:update", {
        documentType: "Wall",
        updates: [
          { _id: wallId, diff: { sight: "limited" }, embedded: { type: "Wall", id: sceneId } },
        ],
      });
      expect(ack["ok"]).toBe(true);
    });

    await withOracle("scene:doorState", async () => {
      const ack = await sendOp(gm, "scene:doorState", { sceneId, wallId, state: "open" });
      expect(ack["ok"]).toBe(true);
    });

    await withOracle("light:create", async () => {
      const ack = await sendOp(gm, "light:create", {
        documentType: "Light",
        data: [{ x: 200, y: 200, dimRadius: 5, brightRadius: 2 }],
        parent: { type: "Scene", id: sceneId },
      });
      expect(ack["ok"]).toBe(true);
    });

    await withOracle("wall:delete (embedded delete → writes the Scene row)", async () => {
      const ack = await sendOp(gm, "wall:delete", {
        documentType: "Wall",
        ids: [wallId],
        parent: { type: "Scene", id: sceneId },
      });
      expect(ack["ok"]).toBe(true);
    });

    await withOracle("combat:create", async () => {
      const ack = await sendOp(gm, "combat:create", { sceneId });
      expect(ack["ok"]).toBe(true);
      combatId = ((ack["result"] as Record<string, unknown>)["combat"] as { _id: string })._id;
    });

    await withOracle("combat:addCombatant (persistCombat)", async () => {
      const ack = await sendOp(gm, "combat:addCombatant", {
        combatId,
        tokenId,
        actorId,
        hidden: false,
      });
      expect(ack["ok"]).toBe(true);
    });

    await withOracle("doc:delete Token (embedded → writes the Scene row)", async () => {
      const ack = await sendOp(gm, "doc:delete", {
        documentType: "Token",
        ids: [tokenId],
        parent: { type: "Scene", id: sceneId },
      });
      expect(ack["ok"]).toBe(true);
    });

    // The window has to have contained real writes, or every equality above
    // was 0 === 0 and this test proved nothing.
    const report = ctx.collector.snapshot();
    expect(report).not.toBeNull();
    expect(report?.byTable["scenes"]?.count ?? 0).toBeGreaterThan(5);
    expect(report?.byTable["actors"]?.count ?? 0).toBeGreaterThan(0);
    expect(report?.byTable["combats"]?.count ?? 0).toBeGreaterThan(0);
    // The embedded Item write is attributed to `items` ON THE ACTORS TABLE —
    // the mirror image of `tokens` on scenes.
    expect(Object.keys(report?.byTable["actors"]?.byPatchKey ?? {})).toContain("items");
  });

  // -------------------------------------------------------------------------
  // Case 2 — a no-op counts as nothing
  // -------------------------------------------------------------------------

  it("does not count a doc:update whose diff changes nothing", async () => {
    const actorId = await createActor("No Op Actor");
    const versionBefore = readVersions(ctx.fusionDb.raw, "actors").get(actorId);
    const countsBefore = metricCounts(ctx.collector);

    // Same name it already has — computeDiff returns null and _updateInTxn
    // returns before any SQL runs.
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { name: "No Op Actor" } }],
    });
    expect(ack["ok"]).toBe(true);

    const versionAfter = readVersions(ctx.fusionDb.raw, "actors").get(actorId);
    const counted = (metricCounts(ctx.collector)["actors"] ?? 0) - (countsBefore["actors"] ?? 0);

    // Both stay put, together: the version because nothing was written, the
    // metric because it sits AFTER the no-op early return.
    expect(versionAfter).toBe(versionBefore);
    expect(counted).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Case 3 — a path refused by the T031 guard counts as nothing
  // -------------------------------------------------------------------------

  it("does not count a doc:update rejected by the embedded-collection guard", async () => {
    const sceneId = await createScene("Guarded Scene");
    await createToken(sceneId, "Guarded Token");

    const versionBefore = readVersions(ctx.fusionDb.raw, "scenes").get(sceneId);
    const countsBefore = metricCounts(ctx.collector);

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Scene",
      updates: [
        {
          _id: sceneId,
          diff: {
            tokens: [{ _id: "zzzzzzzzzzzzzzzz", name: "Injected", x: 999, y: 777, hidden: true }],
          },
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");

    const versionAfter = readVersions(ctx.fusionDb.raw, "scenes").get(sceneId);
    const counted = (metricCounts(ctx.collector)["scenes"] ?? 0) - (countsBefore["scenes"] ?? 0);

    // Absolute zero on both sides, not just "equal to each other": if the
    // guard disappeared, the write WOULD happen and both would read 1, which
    // an equality-only assertion would happily accept.
    expect(versionAfter).toBe(versionBefore);
    expect(counted).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Case 4 — polymorphism: scenes and actors are counted apart
  // -------------------------------------------------------------------------

  it("attributes writes to the right table when scenes and actors are touched together", async () => {
    const sceneId = await createScene("Polymorphic Scene");
    const tokenId = await createToken(sceneId, "Polymorphic Token");
    const actorId = await createActor("Polymorphic Actor");

    const versionsBefore = readAllVersions(ctx.fusionDb.raw);
    const countsBefore = metricCounts(ctx.collector);

    // The same shape of operation on both tables, interleaved. Every `x` here
    // differs from the token's starting position (10) and from the previous
    // step — a repeated value would be a no-op and write nothing, which the
    // oracle catches but the fixed counts below could not.
    for (const step of [1, 2, 3]) {
      const sceneAck = await sendOp(gm, "doc:update", {
        documentType: "Token",
        updates: [
          { _id: tokenId, diff: { x: step * 10 + 5 }, embedded: { type: "Token", id: sceneId } },
        ],
      });
      expect(sceneAck["ok"]).toBe(true);

      const actorAck = await sendOp(gm, "doc:update", {
        documentType: "Actor",
        updates: [{ _id: actorId, diff: { name: `Polymorphic Actor ${String(step)}` } }],
      });
      expect(actorAck["ok"]).toBe(true);
    }

    const versionsAfter = readAllVersions(ctx.fusionDb.raw);
    const countsAfter = metricCounts(ctx.collector);

    const sceneWrites = expectedWrites(
      versionsBefore.get("scenes") ?? new Map(),
      versionsAfter.get("scenes") ?? new Map(),
    );
    const actorWrites = expectedWrites(
      versionsBefore.get("actors") ?? new Map(),
      versionsAfter.get("actors") ?? new Map(),
    );

    expect(sceneWrites).toBe(3);
    expect(actorWrites).toBe(3);
    expect((countsAfter["scenes"] ?? 0) - (countsBefore["scenes"] ?? 0)).toBe(sceneWrites);
    expect((countsAfter["actors"] ?? 0) - (countsBefore["actors"] ?? 0)).toBe(actorWrites);

    // The attribution key travels with the table, so a scene write never shows
    // up as `items` and an actor write never as `tokens`.
    const report = ctx.collector.snapshot();
    expect(Object.keys(report?.byTable["scenes"]?.byPatchKey ?? {})).toContain("tokens");
    expect(Object.keys(report?.byTable["actors"]?.byPatchKey ?? {})).not.toContain("tokens");
  });

  // -------------------------------------------------------------------------
  // Case 5 — a batch does not escape
  // -------------------------------------------------------------------------

  it("counts one write per applied entry of updateBatch / createBatch", async () => {
    const sceneId = await createScene("Batch Scene");

    // A dedicated store+collector: `updateBatch` has NO production caller
    // today, and this is precisely the shape a metric wrapped around the
    // public `update()` would miss — it calls `_updateInTxn` directly.
    const batchCollector = new WriteMetricsCollector({
      logger: createLogger("silent"),
      worldId: "batch",
      flushIntervalMs: 0,
    });
    const batchStore = new DocumentStore({
      db: ctx.fusionDb.raw,
      metrics: batchCollector,
    });

    const sceneVersionBefore = readVersions(ctx.fusionDb.raw, "scenes").get(sceneId) ?? 0;

    batchStore.updateBatch("scenes", [
      { _id: sceneId, name: "Batch Scene A" },
      { _id: sceneId, name: "Batch Scene B" },
      { _id: sceneId, name: "Batch Scene C" },
    ]);
    batchStore.createBatch("actors", [
      { name: "Batch Actor 1", type: "npc", system: {} },
      { name: "Batch Actor 2", type: "npc", system: {} },
    ]);

    const sceneVersionAfter = readVersions(ctx.fusionDb.raw, "scenes").get(sceneId) ?? 0;
    const report = batchCollector.snapshot();

    // Three entries applied to the same document → three real writes.
    expect(sceneVersionAfter - sceneVersionBefore).toBe(3);
    expect(report?.byTable["scenes"]?.count).toBe(3);
    expect(report?.byTable["scenes"]?.byOp).toEqual({ create: 0, update: 3 });

    expect(report?.byTable["actors"]?.count).toBe(2);
    expect(report?.byTable["actors"]?.byOp).toEqual({ create: 2, update: 0 });

    batchCollector.stop();
  });

  // -------------------------------------------------------------------------
  // Case 5b — a rolled-back batch leaves nothing behind
  // -------------------------------------------------------------------------

  it("does not count the writes of a batch that rolled back", async () => {
    const sceneId = await createScene("Rollback Scene");

    const collector = new WriteMetricsCollector({
      logger: createLogger("silent"),
      worldId: "rollback",
      flushIntervalMs: 0,
    });
    const store = new DocumentStore({ db: ctx.fusionDb.raw, metrics: collector });

    const versionBefore = readVersions(ctx.fusionDb.raw, "scenes").get(sceneId) ?? 0;

    // The first entry writes; the second throws, and REQ-PER-020 rolls the
    // whole transaction back — including the write that already ran its SQL.
    expect(() =>
      store.updateBatch("scenes", [
        { _id: sceneId, name: "Rolled Back A" },
        { _id: "0000000000000000", name: "No Such Scene" },
      ]),
    ).toThrow();

    const versionAfter = readVersions(ctx.fusionDb.raw, "scenes").get(sceneId) ?? 0;

    // The database says nothing happened, so the report must say the same —
    // otherwise the log carries a write that never existed, with row bytes
    // and latency to make it look real.
    expect(versionAfter).toBe(versionBefore);
    expect(collector.snapshot()).toBeNull();

    collector.stop();
  });

  // -------------------------------------------------------------------------
  // Case 6 — the amplification in the report matches the database
  // -------------------------------------------------------------------------

  it("reports rowBytes that match the row SQLite holds and a delta of only what changed", async () => {
    const sceneId = await createScene("Amplification Scene");
    const tokenId = await createToken(sceneId, "Amplified Token", 40, 40);
    // Four more tokens, so "the array the handler resent" and "the element
    // that actually changed" are far apart. With a single token the two are
    // the same size and the narrowing would be untestable.
    for (const i of [1, 2, 3, 4]) {
      await createToken(sceneId, `Bystander ${String(i)}`, i * 30, i * 30);
    }
    // Extra non-token content in the SAME row: this is what a token move
    // rewrites for free, and therefore what write amplification is made of.
    for (const x of [100, 200, 300]) {
      const ack = await sendOp(gm, "wall:create", {
        documentType: "Wall",
        data: [{ a: { x, y: 0 }, b: { x, y: 400 } }],
        parent: { type: "Scene", id: sceneId },
      });
      expect(ack["ok"]).toBe(true);
    }

    // Fresh window: exactly one write to `scenes` will land in it.
    ctx.collector.flush();

    const moveAck = await sendOp(gm, "token:move", { sceneId, tokenId, x: 45, y: 45, force: true });
    expect(moveAck["ok"]).toBe(true);

    const report = ctx.collector.snapshot();
    const scenes = report?.byTable["scenes"];
    expect(scenes?.count).toBe(1);

    // The row as SQLite holds it, read back independently of the collector.
    const persisted = (
      ctx.fusionDb.raw.prepare(`SELECT data FROM scenes WHERE id = ?`).get(sceneId) as {
        data: string;
      }
    ).data;
    const rowBytes = Buffer.byteLength(persisted, "utf8");
    expect(scenes?.rowBytesTotal).toBe(rowBytes);
    expect(scenes?.rowBytesAvg).toBe(rowBytes);

    // THE DELTA ORACLE. `token:move` hands the store `{ tokens: <all five> }`,
    // but only one of them moved. The expected payload is built here, from
    // the row the database holds — not from anything the collector computed:
    // the one token whose coordinates changed, as it now stands.
    const persistedScene = JSON.parse(persisted) as { tokens: Array<Record<string, unknown>> };
    const movedToken = persistedScene.tokens.find((t) => t["_id"] === tokenId);
    expect(movedToken).toBeDefined();
    const expectedDelta = Buffer.byteLength(JSON.stringify({ tokens: [movedToken] }), "utf8");
    const resentBytes = Buffer.byteLength(
      JSON.stringify({ tokens: persistedScene.tokens }),
      "utf8",
    );
    expect(scenes?.deltaBytesAvg).toBe(expectedDelta);
    // And that number is genuinely the narrowed one — measuring the resent
    // array instead would have reported at least four times as much.
    expect(expectedDelta * 4).toBeLessThan(resentBytes);

    // The headline ratio, recomputed from two independently-obtained numbers
    // (the row SQLite holds ÷ the delta this test built), never from the
    // report's own averages.
    expect(scenes?.amplificationRatio).toBe(Math.round((rowBytes / expectedDelta) * 10) / 10);
    expect(scenes?.amplificationRatio).toBeGreaterThan(1);
    expect(scenes?.byPatchKey).toEqual({ tokens: 1 });

    // A real SQL write took real time. Rounded to 1 µs, a multi-KB row
    // rewrite is never 0.
    expect(scenes?.latencyMsP50).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Case 6b — a patch of known size is measured as its known size
  // -------------------------------------------------------------------------

  it("measures deltaBytes as the payload the test built, byte for byte", async () => {
    const actorId = await createActor("Byte Counted Actor");
    const longName = "A".repeat(500);

    ctx.collector.flush();

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { name: longName } }],
    });
    expect(ack["ok"]).toBe(true);

    const actors = ctx.collector.snapshot()?.byTable["actors"];
    expect(actors?.count).toBe(1);
    // Input → output. The only thing that changed is the name, so the delta
    // is exactly the JSON of that one field, counted here from the string
    // this test chose. No implementation expression is re-run.
    expect(actors?.deltaBytesAvg).toBe(
      Buffer.byteLength(JSON.stringify({ name: longName }), "utf8"),
    );
  });
});

// ---------------------------------------------------------------------------
// Case 7 — closing the world flushes the tail and takes the timer down
//
// Its own boot, because it needs a logger whose output can be read and it
// SHUTS THE SERVER DOWN — the shared context above could not survive it.
// ---------------------------------------------------------------------------

describe("T016 — the world close flushes", () => {
  it("logs the last partial window on shutdown and deregisters the collector", async () => {
    const worldId = "write_metrics_close_world";
    const dataDir = makeTempDir();
    const dbPath = join(dataDir, "world.db");

    const secret = loadOrCreateSecret(dataDir);
    const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);
    const authService = new AuthService(fusionDb.raw, secret, worldId);
    await authService.bootstrapGm();

    // A real pino logger writing into an array, so the flush line can be read
    // exactly as it would land in the daily log file.
    const lines: string[] = [];
    const logger = pino(
      { level: "info", base: { pkg: "@fusion/server" }, timestamp: pino.stdTimeFunctions.isoTime },
      {
        write(chunk: string) {
          lines.push(chunk);
        },
      },
    );

    const bootResult = await boot({
      config: loadConfig({
        dataDirOverride: dataDir,
        cliOverrides: { port: await reserveFreePort(), host: "127.0.0.1", logLevel: "info" },
      }),
      logger,
      skipSignalHandlers: true,
      authContext: {
        worldId,
        worldTitle: "Write Metrics Close World",
        worldSystemId: "stub",
        db: fusionDb.raw,
        secret,
      },
      netContext: { worldId, db: fusionDb.raw, secret, authService, origin: "http://127.0.0.1" },
    });

    try {
      const collector = bootResult.socketManager?.writeMetricsFor(worldId);
      expect(collector).toBeDefined();

      // One write in the window, straight into the world's own collector.
      collector?.record({
        op: "update",
        table: "scenes",
        patchKeys: ["tokens"],
        rowBytes: 5740,
        deltaBytes: 61,
        latencyNs: 310_000n,
      });

      expect(lines.some((l) => l.includes("doc-store write metrics"))).toBe(false);

      // `shutdown()` is exactly what the SIGINT/SIGTERM handler registered in
      // boot.ts calls, so proving it here proves the signal path too.
      await bootResult.shutdown();

      const flushLine = lines.find((l) => l.includes("doc-store write metrics"));
      expect(flushLine).toBeDefined();
      const report = JSON.parse(flushLine ?? "{}") as Record<string, unknown>;
      expect(report["worldId"]).toBe(worldId);
      const scenes = (report["byTable"] as Record<string, { count: number; latencyMsP50: number }>)[
        "scenes"
      ];
      expect(scenes?.count).toBe(1);
      // 310_000 ns in → 0.31 ms out. The only assertion in the suite on the
      // latency arithmetic that runs through the REAL logged line.
      expect(scenes?.latencyMsP50).toBe(0.31);
      // The line says what it does and does not cover, so nobody reads
      // `writesPerMinute` as "every write this database took".
      expect(report["scope"]).toEqual(WRITE_METRICS_SCOPE);

      // The collector is gone from the manager — nothing left holding an
      // interval for a world that no longer exists.
      expect(bootResult.socketManager?.writeMetricsFor(worldId)).toBeUndefined();
    } finally {
      await bootResult.shutdown();
      fusionDb.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30000);
});

// ---------------------------------------------------------------------------
// Cases 8-11 — the arithmetic of the report itself
//
// These need no server: they feed the collector KNOWN input and assert the
// KNOWN output, which is the only way to pin down the numbers that no
// count-oracle can reach (percentiles, rate, and the two lifecycle guards).
// ---------------------------------------------------------------------------

describe("T016 — collector arithmetic and lifecycle", () => {
  function sampleEvent(latencyNs: bigint): WriteMetricsEvent {
    return {
      op: "update",
      table: "scenes",
      patchKeys: ["tokens"],
      rowBytes: 5000,
      deltaBytes: 100,
      latencyNs,
    };
  }

  it("turns the latencies it was given into nearest-rank percentiles", () => {
    const collector = new WriteMetricsCollector({
      logger: createLogger("silent"),
      worldId: "unit",
      flushIntervalMs: 0,
    });

    // 1 ms … 100 ms, fed out of order so a sort really has to happen.
    for (const ms of [...Array(100).keys()].map((i) => 100 - i)) {
      collector.record(sampleEvent(BigInt(ms) * 1_000_000n));
    }

    const scenes = collector.snapshot()?.byTable["scenes"];
    // Nearest rank over 100 samples: p50 is the 50th, p95 the 95th.
    expect(scenes?.latencyMsP50).toBe(50);
    expect(scenes?.latencyMsP95).toBe(95);

    collector.stop();
  });

  it("reports the busiest minute and a rate above zero", () => {
    const collector = new WriteMetricsCollector({
      logger: createLogger("silent"),
      worldId: "unit",
      flushIntervalMs: 0,
    });

    for (let i = 0; i < 7; i += 1) collector.record(sampleEvent(1_000_000n));

    const report = collector.snapshot();
    // Seven writes, all in the same wall-clock minute (they take microseconds).
    expect(report?.writesPerMinute.peakMinute).toBe(7);
    expect(report?.writesPerMinute.avg).toBeGreaterThan(0);

    collector.stop();
  });

  it("keeps the periodic flush from holding the process open", () => {
    // The default interval, i.e. the one the live server gets.
    const collector = new WriteMetricsCollector({
      logger: createLogger("silent"),
      worldId: "unit",
    });

    // Reaching for the handle is the point: an interval that keeps a ref
    // makes the server refuse to exit after Ctrl+C, and the vitest `forks`
    // pool kills its workers anyway — so the suite is blind to it unless the
    // handle itself is asserted on.
    const timer = (collector as unknown as { timer: NodeJS.Timeout | undefined }).timer;
    expect(timer).toBeDefined();
    expect(timer?.hasRef()).toBe(false);

    collector.stop();
  });

  it("survives a logger that throws, from both the direct and the timed flush", async () => {
    const explode = (): never => {
      throw new Error("ENOSPC: no space left on device");
    };
    const throwingLogger = {
      info: explode,
      warn: explode,
      error: explode,
      debug: explode,
    } as unknown as Logger;

    const collector = new WriteMetricsCollector({
      logger: throwingLogger,
      worldId: "unit",
      flushIntervalMs: 5,
    });

    // Direct path: world shutdown calls this, and a throw here would abort
    // the rest of the teardown.
    collector.record(sampleEvent(1_000_000n));
    expect(() => {
      collector.flush();
    }).not.toThrow();

    // Timed path: a throw inside a timer callback has no frame to catch it —
    // it becomes an uncaughtException, which vitest reports as a failure of
    // this file. Surviving the wait IS the assertion.
    collector.record(sampleEvent(1_000_000n));
    await new Promise((resolve) => setTimeout(resolve, 60));

    collector.stop();
  });
});

// ---------------------------------------------------------------------------
// Case 12 — compendium:import is not a blind spot
//
// `CompendiumService.importToWorld` builds a DocumentStore OF ITS OWN. The
// collector is per store instance, so a second instance is a second funnel —
// and `compendium:import` is a live session op (registered on the world
// namespace), writing full Actor rows under the same IMMEDIATE lock. Its own
// boot, because it needs a packs directory.
// ---------------------------------------------------------------------------

describe("T016 — compendium import", () => {
  it("counts the rows an import writes into the world", async () => {
    const worldId = "write_metrics_import_world";
    const dataDir = makeTempDir();
    const packsDir = makeTempDir();
    const dbPath = join(dataDir, "world.db");

    // A minimal Actor pack: two documents, so the import is plainly a batch.
    const packDir = join(packsDir, "metrics-pack");
    mkdirSync(packDir, { recursive: true });
    const packId = "stub.metrics-pack";
    const packDocs = [1, 2].map((n) => ({
      _id: `npc00${String(n)}`,
      name: `Metrics NPC ${String(n)}`,
      type: "npc",
      img: "icons/placeholder/actor.svg",
      system: { level: { value: n } },
      flags: {
        fusion: {
          conversion: "full",
          importerVersion: "0.1.0",
          sourceVersion: "v14-dev",
          sourceId: `src00${String(n)}`,
          packName: "metrics-pack",
          unconvertedRules: [],
          assetSubstitutions: [],
        },
      },
    }));
    writeFileSync(
      join(packDir, "pack.json"),
      JSON.stringify({
        id: packId,
        label: "Metrics Pack",
        documentType: "Actor",
        systemId: "stub",
        indexFields: [],
        license: { license: "ORC", attribution: "Test Attribution", reservedNotice: "" },
        source: { repo: null, version: null, importerVersion: "0.1.0" },
        documentCount: packDocs.length,
        generatedAt: "2026-01-01T00:00:00.000Z",
        schemaVersion: 1,
      }),
    );
    writeFileSync(join(packDir, "documents.json"), JSON.stringify(packDocs));
    writeFileSync(
      join(packDir, "index.json"),
      JSON.stringify(
        packDocs.map((d) => ({
          _id: d._id,
          uuid: `Compendium.${packId}.Actor.${d._id}`,
          name: d.name,
          img: d.img,
          type: d.type,
          index: {},
        })),
      ),
    );

    const secret = loadOrCreateSecret(dataDir);
    const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);
    const authService = new AuthService(fusionDb.raw, secret, worldId);
    const { user: gm, password: gmPw } = await authService.bootstrapGm();
    const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

    const bootResult = await boot({
      config: loadConfig({
        dataDirOverride: dataDir,
        cliOverrides: { port: await reserveFreePort(), host: "127.0.0.1", logLevel: "silent" },
      }),
      logger: createLogger("silent"),
      skipSignalHandlers: true,
      authContext: {
        worldId,
        worldTitle: "Write Metrics Import World",
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
        packsDir,
      },
    });

    const client = connectClient(listeningPort(bootResult.fastify), worldId, gmLogin.accessToken);
    try {
      const collector = bootResult.socketManager?.writeMetricsFor(worldId);
      expect(collector).toBeDefined();
      collector?.stop();

      client.connect();
      await waitForConnect(client);

      const before = readVersions(fusionDb.raw, "actors");
      const ack = await sendOp(client, "compendium:import", {
        uuids: packDocs.map((d) => `Compendium.${packId}.Actor.${d._id}`),
      });
      expect(ack["ok"]).toBe(true);
      expect((ack["result"] as { created: string[] }).created).toHaveLength(2);

      const after = readVersions(fusionDb.raw, "actors");
      const realWrites = expectedWrites(before, after);
      expect(realWrites).toBe(2);

      // Same oracle as everywhere else: the database says two rows were
      // written, so the report has to say two.
      const actors = collector?.snapshot()?.byTable["actors"];
      expect(actors?.count).toBe(realWrites);
      expect(actors?.byOp).toEqual({ create: 2, update: 0 });
    } finally {
      client.disconnect();
      await bootResult.shutdown();
      fusionDb.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(packsDir, { recursive: true, force: true });
    }
  }, 30000);
});

// ---------------------------------------------------------------------------
// Case 13 — the collector is released even when the teardown fails
// ---------------------------------------------------------------------------

describe("T016 — world removal always releases the collector", () => {
  it("stops and drops the collector even when disconnecting the sockets throws", async () => {
    const worldId = "write_metrics_finally_world";
    const dataDir = makeTempDir();
    const dbPath = join(dataDir, "world.db");

    const secret = loadOrCreateSecret(dataDir);
    const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);
    const authService = new AuthService(fusionDb.raw, secret, worldId);
    await authService.bootstrapGm();

    const bootResult = await boot({
      config: loadConfig({
        dataDirOverride: dataDir,
        cliOverrides: { port: await reserveFreePort(), host: "127.0.0.1", logLevel: "silent" },
      }),
      logger: createLogger("silent"),
      skipSignalHandlers: true,
      authContext: {
        worldId,
        worldTitle: "Write Metrics Finally World",
        worldSystemId: "stub",
        db: fusionDb.raw,
        secret,
      },
      netContext: { worldId, db: fusionDb.raw, secret, authService, origin: "http://127.0.0.1" },
    });

    try {
      const manager = bootResult.socketManager;
      expect(manager?.writeMetricsFor(worldId)).toBeDefined();

      // Force the disconnect step to fail. Without a `finally`, the collector
      // below would stay in the map with its interval alive — a handle that
      // keeps the process up after the world it belonged to is gone.
      const ns = manager?.io.of(`/world/${worldId}`) as unknown as {
        fetchSockets: () => Promise<unknown[]>;
      };
      const realFetchSockets = ns.fetchSockets;
      ns.fetchSockets = () => Promise.reject(new Error("adapter is gone"));

      await expect(manager?.removeWorldNamespace(worldId)).rejects.toThrow("adapter is gone");
      expect(manager?.writeMetricsFor(worldId)).toBeUndefined();

      ns.fetchSockets = realFetchSockets;
    } finally {
      await bootResult.shutdown();
      fusionDb.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30000);
});
