/**
 * Boot-path compendium integration test.
 *
 * This is the PROOF that a real live session is playable: it boots the server
 * through the actual boot() sequence (NOT manual SocketManager wiring) with only
 * `netContext.systemId = "pf2e"`, and asserts that compendium:list returns the
 * committed packs under systems/pf2e/packs/.
 *
 * Regression target: previously boot()/serve.ts never instantiated a
 * CompendiumService nor called discoverPacks(), so socket-manager fell back to
 * `new CompendiumService()` (empty) and compendium:list returned [] in a real
 * CLI server — import was impossible. The e2e-dod-m3 suite masked this by wiring
 * the service manually. This test refuses any manual wiring.
 *
 * Spec: 16-compendiums-e-importacao.md, 27-roadmap §M3 DoD (b).
 * REQ-CMP-006..012.
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

// ---------------------------------------------------------------------------
// Expected committed packs (systems/pf2e/packs/)
// ---------------------------------------------------------------------------

const EXPECTED_PACK_IDS = [
  "pf2e.bestiary-core",
  "pf2e.conditions",
  "pf2e.weapons-core",
  "pf2e.spells-core",
];

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-boot-cmp-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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

async function buildCtx(): Promise<Ctx> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "boot_cmp_world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

  // Boot through the REAL sequence. Only systemId is supplied — no manual
  // CompendiumService, no packsDir override. The boot must resolve
  // systems/pf2e/packs from the monorepo layout on its own.
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
      worldTitle: "Boot Compendium World",
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
// Suite
// ---------------------------------------------------------------------------

describe("boot() wires CompendiumService and discovers committed pf2e packs", () => {
  let ctx: Ctx;
  let gm: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  it("compendium:list returns the committed packs (no manual wiring)", async () => {
    const ack = await sendQuery(gm, "compendium:list", { systemId: "pf2e" });
    expect(ack["ok"]).toBe(true);
    const packs = (ack["result"] as { packs: Array<{ id: string }> }).packs;
    const ids = packs.map((p) => p.id);
    for (const expected of EXPECTED_PACK_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it("compendium:index returns entries for the committed bestiary pack", async () => {
    const ack = await sendQuery(gm, "compendium:index", { packId: "pf2e.bestiary-core" });
    expect(ack["ok"]).toBe(true);
    const entries = (ack["result"] as { entries: unknown[] }).entries;
    expect(entries.length).toBeGreaterThan(0);
  });

  it("compendium:get loads a full document from a committed pack with mechanical fields", async () => {
    // Grab the first bestiary entry's uuid from the index, then fetch the full doc.
    const indexAck = await sendQuery(gm, "compendium:index", { packId: "pf2e.bestiary-core" });
    const entries = (indexAck["result"] as { entries: Array<{ uuid: string }> }).entries;
    expect(entries.length).toBeGreaterThan(0);
    const uuid = entries[0]!.uuid;

    const ack = await sendQuery(gm, "compendium:get", { uuid });
    expect(ack["ok"]).toBe(true);
    const doc = (ack["result"] as { document: Record<string, unknown> }).document;
    const sys = doc["system"] as Record<string, unknown>;
    // NPC mechanical stats are preserved from the pack (not re-derived on import).
    expect(sys["attributes"]).toBeDefined();
    expect(sys["saves"]).toBeDefined();
  });
});
