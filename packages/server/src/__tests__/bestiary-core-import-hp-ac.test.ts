/**
 * bestiary-core (r28/A2) — HP/AC regression for the expanded pack (10 → 492).
 *
 * Non-circular by construction (lição #48, ver project_fusion memory): the
 * expected HP/AC values below were read directly from the VENDOR source
 * (tools/importer-pf2e/vendor/pf2e/packs/pf2e/pathfinder-monster-core/*.json,
 * `system.attributes.hp.max` / `system.attributes.ac.value`) — an input the
 * importer pipeline (normalize.mjs → transform.mjs → build-mvp-subset.mjs)
 * never touches for these two fields — NOT from the committed pack itself.
 * A regression in the pipeline that silently corrupted HP/AC while
 * relabelling documents would still be caught here.
 *
 * Flow mirrors npc-import-initiative.test.ts (the established non-circular
 * pattern for this repo): boot the REAL server with the REAL committed
 * bestiary-core pack (no fixture), import each creature via
 * `compendium:import` (the server op the client's "drag to scene" UI calls),
 * create a Token linked to the resulting Actor (the actual "vira token" step
 * — proves the import path produces a document the scene can host, not just
 * a bare actor row), then read the ACTOR's persisted `system.derived.hp` /
 * `system.derived.ac` — the values a combatant's health bar and AC checks
 * would read at the table.
 *
 * Three creatures spanning the level range added by this pack expansion:
 *   - Eagle          level -1 (starter tier, already in the pre-r28 10)
 *   - Cave Bear      level  6 (mid tier, NEW in r28)
 *   - Norn           level 20 (top tier, NEW in r28)
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
import { pf2eSystem } from "@fusion/system-pf2e";

function makeTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `fusion-${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
}

async function buildCtx(worldId: string): Promise<Ctx> {
  const dataDir = makeTempDir(worldId);
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

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
      worldTitle: "Bestiary HP/AC World",
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

  return { dataDir, fusionDb, bootResult, port, worldId, gmToken: gmLogin.accessToken };
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

// ---------------------------------------------------------------------------
// Ground truth — read directly from the vendor statblocks (independent of
// the committed pack), see file header.
// ---------------------------------------------------------------------------
interface Scenario {
  npcName: string;
  level: number;
  expectedHpMax: number;
  expectedAc: number;
}

const SCENARIOS: Scenario[] = [
  { npcName: "Eagle", level: -1, expectedHpMax: 6, expectedAc: 15 },
  { npcName: "Cave Bear", level: 6, expectedHpMax: 95, expectedAc: 24 },
  { npcName: "Norn", level: 20, expectedHpMax: 375, expectedAc: 46 },
];

describe("bestiary-core (r28/A2) — imported creature has correct HP/AC and hosts a Token", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let sceneId: string;

  beforeAll(async () => {
    ctx = await buildCtx("bestiary_hp_ac_pf2e");
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);

    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [
        {
          name: "Bestiary HP/AC Scene",
          grid: { type: "square", size: 100 },
          active: false,
          width: 1000,
          height: 1000,
          ownership: { default: 2 },
        },
      ],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  for (const scenario of SCENARIOS) {
    const { npcName, level, expectedHpMax, expectedAc } = scenario;

    it(`imports "${npcName}" (level ${String(level)}) with derived.hp.max=${String(expectedHpMax)} and derived.ac.total=${String(expectedAc)}, and hosts a Token`, async () => {
      const indexAck = await sendQuery(gm, "compendium:index", { packId: "pf2e.bestiary-core" });
      expect(indexAck["ok"]).toBe(true);
      const entries = (indexAck["result"] as { entries: Array<{ uuid: string; name: string }> })
        .entries;
      const npcEntry = entries.find((e) => e.name === npcName);
      expect(npcEntry).toBeDefined();

      const importAck = await sendOp(gm, "compendium:import", { uuids: [npcEntry!.uuid] });
      expect(importAck["ok"]).toBe(true);
      const importResult = importAck["result"] as { created: string[]; failed: unknown[] };
      expect(importResult.failed).toEqual([]);
      expect(importResult.created.length).toBe(1);
      const actorId = importResult.created[0]!;

      const actorRow = ctx.fusionDb.raw
        .prepare(`SELECT data FROM actors WHERE id = ?`)
        .get(actorId) as { data: string } | undefined;
      expect(actorRow).toBeDefined();
      const actorDoc = JSON.parse(actorRow!.data) as Record<string, unknown>;
      const actorSys = actorDoc["system"] as Record<string, unknown>;

      // Sanity: the raw (pre-derive) statblock level in the committed pack
      // matches the level this scenario claims — guards against picking the
      // wrong document if the pack's ids ever change.
      const details = actorSys["details"] as Record<string, unknown>;
      expect((details["level"] as { value: number }).value).toBe(level);

      const derived = actorSys["derived"] as Record<string, unknown> | undefined;
      expect(derived).toBeDefined();

      const derivedHp = derived!["hp"] as { max: number } | undefined;
      expect(derivedHp?.max).toBe(expectedHpMax);

      const derivedAc = derived!["ac"] as { total: number } | undefined;
      expect(derivedAc?.total).toBe(expectedAc);

      // "vira token": drag-to-scene equivalent — create a Token document
      // hosted on the scene, linked to the imported Actor.
      const tokenAck = await sendOp(gm, "doc:create", {
        documentType: "Token",
        data: [
          {
            name: npcName,
            actorId,
            actorLink: false,
            x: 0,
            y: 0,
          },
        ],
        parent: { type: "Scene", id: sceneId },
      });
      expect(tokenAck["ok"]).toBe(true);
      const tokenDocs = (tokenAck["result"] as { documents: Array<Record<string, unknown>> })
        .documents;
      expect(tokenDocs.length).toBe(1);
      expect(tokenDocs[0]!["actorId"]).toBe(actorId);
    });
  }
});
