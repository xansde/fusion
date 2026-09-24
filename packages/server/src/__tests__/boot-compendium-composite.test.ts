/**
 * Boot-path compendium integration test — the "mundo misto" (pf2e-sf2e)
 * composite system.
 *
 * Onda M1.1 (mundo-misto/desenho.md §Plano): "um mundo pf2e-sf2e de teste
 * expõe via compendium:list pelo menos 1 pack cujo `name` só existe hoje em
 * systems/pf2e/packs e 1 que só existe em systems/sf2e/packs — a asserção é
 * 'os dois aparecem', não 'o composto lista N packs'." This boots through
 * the REAL boot() sequence (mirrors boot-compendium.test.ts /
 * boot-compendium-sf2e.test.ts) with `netContext.systemId = "pf2e-sf2e"`
 * AND `netContext.systemModule = pf2eSf2eSystem` (the composite manifest's
 * `sourceSystemIds` is what boot.ts reads to discover BOTH source systems'
 * packs dirs — DEC-SYS-06-bis).
 *
 * Spec: 15-api-de-sistemas.md (DEC-SYS-06-bis), 16-compendiums-e-importacao.md.
 * REQ-CMP-006..012, REQ-SYS-006.
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
import { pf2eSf2eSystem } from "@fusion/system-pf2e-sf2e";

// A pack id that only exists under systems/pf2e/packs and one that only
// exists under systems/sf2e/packs (verified 2026-09-24 against the
// committed packs — see this repo's mundo-misto dedup measurement).
const PF2E_ONLY_PACK_ID = "pf2e.classes-core";
const SF2E_ONLY_PACK_ID = "sf2e.augmentations-core";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-boot-cmp-composite-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "boot_cmp_composite_world";

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
      worldTitle: "Boot Compendium Composite World",
      worldSystemId: "pf2e-sf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "pf2e-sf2e",
      systemModule: pf2eSf2eSystem,
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

describe("boot() discovers BOTH source systems' packs for the pf2e-sf2e composite", () => {
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

  it("compendium:list contains a pf2e-only pack AND an sf2e-only pack side by side", async () => {
    // No systemId filter: compendium:list's filter matches each PACK's own
    // declared systemId ("pf2e"/"sf2e", per pack.json) — not the world's
    // active (composite) system id. The world-level discovery already
    // happened at boot() (sourceSystemIds loop); an unfiltered list is what
    // proves both source systems' packs coexist for this world.
    const ack = await sendQuery(gm, "compendium:list", {});
    expect(ack["ok"]).toBe(true);
    const packs = (ack["result"] as { packs: Array<{ id: string }> }).packs;
    const ids = packs.map((p) => p.id);

    // The assertion is "the two source systems' packs both appear" — NOT
    // "the composite lists exactly N packs" (N legitimately grows whenever
    // either source system gains a pack, by design — no fixed count here).
    expect(ids).toContain(PF2E_ONLY_PACK_ID);
    expect(ids).toContain(SF2E_ONLY_PACK_ID);
  });

  it("B4 (revisão adversarial 3): compendium:list FILTERED by the composite's OWN systemId still returns both source systems' packs", async () => {
    // This is the exact call the ficha's pickers make (CompendiumPickerDialog,
    // PlanColumn, SpellPickerDialog): listPacks(sock, { systemId:
    // session.worldInfo.systemId, documentType: "Item" }). Before the fix,
    // filter.systemId="pf2e-sf2e" matched NO pack (every pack is loaded
    // under its own systemId, "pf2e"/"sf2e", never "pf2e-sf2e") — every
    // seletor in the mundo misto ficha was empty.
    const ack = await sendQuery(gm, "compendium:list", {
      systemId: "pf2e-sf2e",
      documentType: "Item",
    });
    expect(ack["ok"]).toBe(true);
    const packs = (ack["result"] as { packs: Array<{ id: string }> }).packs;
    const ids = packs.map((p) => p.id);
    expect(ids).toContain(PF2E_ONLY_PACK_ID);
    expect(ids).toContain(SF2E_ONLY_PACK_ID);
  });

  it("compendium:index works against a pack from EACH source system", async () => {
    const pf2eAck = await sendQuery(gm, "compendium:index", { packId: PF2E_ONLY_PACK_ID });
    expect(pf2eAck["ok"]).toBe(true);
    const pf2eEntries = (pf2eAck["result"] as { entries: unknown[] }).entries;
    expect(pf2eEntries.length).toBeGreaterThan(0);

    const sf2eAck = await sendQuery(gm, "compendium:index", { packId: SF2E_ONLY_PACK_ID });
    expect(sf2eAck["ok"]).toBe(true);
    const sf2eEntries = (sf2eAck["result"] as { entries: unknown[] }).entries;
    expect(sf2eEntries.length).toBeGreaterThan(0);
  });
});
