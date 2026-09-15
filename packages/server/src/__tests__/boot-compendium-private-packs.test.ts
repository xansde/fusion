/**
 * Boot-path private packs integration test (DEC-CMP-11, REQ-CMP-056/057).
 *
 * Proves that a real boot() picks up a second, non-versioned packs root at
 * `<dataDir>/private-packs/<systemId>/` — content the GM curates locally and
 * that must never reach git (e.g. Paizo playtest classes, same restriction
 * as docs/etmos-fontes/) — WITHOUT any manual CompendiumService wiring.
 *
 * Three scenarios, one per `it`:
 *   1. A private pack under the data-dir shows up in compendium:list.
 *   2. No private-packs directory at all: boot behaves exactly as before
 *      (no error, official packs unaffected).
 *   3. A private pack whose id COLLIDES with an official one never
 *      overwrites the official pack — the official manifest wins.
 *
 * Spec: 16-compendiums-e-importacao.md, DEC-CMP-11, REQ-CMP-056/057.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
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
// Test infrastructure
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-boot-priv-cmp-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Minimal valid pack.json + documents.json + index.json under <root>/<slug>/. */
function writeMinimalPack(
  root: string,
  slug: string,
  packId: string,
  opts: { documentName?: string } = {},
): void {
  const packDir = join(root, slug);
  mkdirSync(packDir, { recursive: true });

  const manifest = {
    id: packId,
    label: `Test pack ${slug}`,
    documentType: "Item",
    systemId: "pf2e",
    indexFields: [],
    license: {
      license: "custom",
      attribution: "Test fixture — not real content.",
      reservedNotice: "",
    },
    audience: "all",
    source: {
      repo: null,
      version: null,
      importerVersion: "test",
    },
    documentCount: 1,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
  writeFileSync(join(packDir, "pack.json"), JSON.stringify(manifest, null, 2), "utf8");

  const documents = [
    {
      _id: "aaaaaaaaaaaaaaaa",
      name: opts.documentName ?? "Test Document",
      type: "feat",
      img: "icons/placeholder/item.svg",
      system: {},
    },
  ];
  writeFileSync(join(packDir, "documents.json"), JSON.stringify(documents, null, 2), "utf8");
}

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
}

async function buildCtx(dataDir: string): Promise<Ctx> {
  const dbPath = join(dataDir, "world.db");
  const worldId = "boot_priv_cmp_world";

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
      worldTitle: "Boot Private Compendium World",
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

async function listPackIds(ctx: Ctx): Promise<string[]> {
  const gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
  gm.connect();
  await waitForConnect(gm);
  try {
    const ack = await sendQuery(gm, "compendium:list", { systemId: "pf2e" });
    expect(ack["ok"]).toBe(true);
    const packs = (ack["result"] as { packs: Array<{ id: string; label: string }> }).packs;
    return packs.map((p) => p.id);
  } finally {
    gm.disconnect();
  }
}

async function getPackLabel(ctx: Ctx, packId: string): Promise<string> {
  const gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
  gm.connect();
  await waitForConnect(gm);
  try {
    const ack = await sendQuery(gm, "compendium:list", { systemId: "pf2e" });
    const packs = (ack["result"] as { packs: Array<{ id: string; label: string }> }).packs;
    const found = packs.find((p) => p.id === packId);
    if (!found) throw new Error(`Pack ${packId} not found in list`);
    return found.label;
  } finally {
    gm.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("boot() discovers private (non-versioned) compendium packs — DEC-CMP-11", () => {
  let ctx: Ctx | null = null;

  afterEach(async () => {
    if (ctx) {
      await teardown(ctx);
      ctx = null;
    }
  });

  it("REQ-CMP-056: a private pack under <dataDir>/private-packs/pf2e/ appears in compendium:list", async () => {
    const dataDir = makeTempDir();
    const privateRoot = join(dataDir, "private-packs", "pf2e");
    writeMinimalPack(privateRoot, "private-classes-playtest", "pf2e.private-classes-playtest");

    ctx = await buildCtx(dataDir);
    const ids = await listPackIds(ctx);

    expect(ids).toContain("pf2e.private-classes-playtest");
    // Official committed packs are still there — the private root is additive.
    expect(ids).toContain("pf2e.conditions");
  }, 30000);

  it("REQ-CMP-056: no private-packs directory at all — boot behaves exactly as before", async () => {
    const dataDir = makeTempDir();
    // Deliberately do NOT create <dataDir>/private-packs/ — this is the
    // expected, silent common case.

    ctx = await buildCtx(dataDir);
    const ids = await listPackIds(ctx);

    // No crash, no private pack, official packs present.
    expect(ids).toContain("pf2e.conditions");
    expect(ids.some((id) => id.startsWith("pf2e.private-"))).toBe(false);
  }, 30000);

  it("REQ-CMP-057: a private pack whose id collides with an official one never overwrites it", async () => {
    const dataDir = makeTempDir();
    const privateRoot = join(dataDir, "private-packs", "pf2e");
    // Collide with the real official "pf2e.conditions" packId, but with a
    // different label so the test can tell which manifest won.
    writeMinimalPack(privateRoot, "conditions", "pf2e.conditions", {
      documentName: "Should never be visible",
    });

    ctx = await buildCtx(dataDir);
    const label = await getPackLabel(ctx, "pf2e.conditions");

    // The official manifest's label ("PF2e Conditions") must win — the
    // private "Test pack conditions" label must NOT have overwritten it.
    expect(label).toBe("PF2e Conditions");
    expect(label).not.toBe("Test pack conditions");
  }, 30000);
});
