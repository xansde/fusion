/**
 * REQ-ATR-083 (#243): an Actor must not point at itself through `system.masterActorId`, and the server
 * must refuse a cycle (A -> B -> A) — on doc:create (batch included) and on doc:update, dotted or nested.
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
import { DocumentStore } from "../documents/store.js";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors player-familiar-create.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return (() => {
    const dir = join(
      tmpdir(),
      `fusion-master-cycle-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    return dir;
  })();
}

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  store: DocumentStore;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "master_cycle_world";
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
      worldTitle: "Master Cycle World",
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

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

  return {
    dataDir,
    fusionDb,
    // Reads directly from the same underlying DB the handler wrote to —
    // independent of the socket/ack layer under test.
    store: new DocumentStore({ db: fusionDb.raw }),
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
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

async function createActorWith(
  socket: ClientSocket,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return sendOp(socket, "doc:create", {
    documentType: "Actor",
    data: [{ type: "npc", system: {}, ownership: { default: 0 }, ...data }],
  });
}

function updateActor(
  socket: ClientSocket,
  id: string,
  diff: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return sendOp(socket, "doc:update", { documentType: "Actor", updates: [{ _id: id, diff }] });
}

function idOf(ack: Record<string, unknown>): string {
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
}

describe("masterActorId cannot point at itself or close a cycle (REQ-ATR-083, #243)", () => {
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

  it("doc:create refuses a self-referencing master (client-supplied _id)", async () => {
    const ack = await createActorWith(gm, {
      _id: "selfref000000000",
      name: "Self",
      system: { masterActorId: "selfref000000000" },
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  it("doc:update refuses a self-referencing master (nested and dotted)", async () => {
    const id = idOf(await createActorWith(gm, { name: "Solo" }));
    for (const diff of [{ "system.masterActorId": id }, { system: { masterActorId: id } }]) {
      const ack = await updateActor(gm, id, diff);
      expect(ack["ok"], JSON.stringify(diff)).toBe(false);
      expect(ack["code"]).toBe("VALIDATION_FAILED");
    }
    expect(ctx.store.get("actors", id)["system"]).not.toHaveProperty("masterActorId", id);
  });

  it("doc:update refuses a link that closes a cycle (A -> B -> A, and the longer A -> B -> C -> A)", async () => {
    const a = idOf(await createActorWith(gm, { name: "A" }));
    const b = idOf(await createActorWith(gm, { name: "B", system: { masterActorId: a } }));
    const c = idOf(await createActorWith(gm, { name: "C", system: { masterActorId: b } }));
    const direct = await updateActor(gm, a, { "system.masterActorId": b });
    expect(direct["ok"]).toBe(false);
    expect(direct["code"]).toBe("VALIDATION_FAILED");
    const long = await updateActor(gm, a, { "system.masterActorId": c });
    expect(long["ok"]).toBe(false);
    expect(long["code"]).toBe("VALIDATION_FAILED");
  });

  it("doc:create refuses the second link of a cycle inside one batch", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          _id: "cycleA0000000000",
          name: "CA",
          type: "npc",
          system: { masterActorId: "cycleB0000000000" },
        },
        {
          _id: "cycleB0000000000",
          name: "CB",
          type: "npc",
          system: { masterActorId: "cycleA0000000000" },
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  it("a legitimate chain still works, including re-pointing and unlinking", async () => {
    const a = idOf(await createActorWith(gm, { name: "Root" }));
    const b = idOf(await createActorWith(gm, { name: "Mid", system: { masterActorId: a } }));
    const c = idOf(await createActorWith(gm, { name: "Leaf" }));
    expect((await updateActor(gm, c, { "system.masterActorId": b }))["ok"]).toBe(true);
    expect((await updateActor(gm, c, { "system.masterActorId": a }))["ok"]).toBe(true);
    expect((await updateActor(gm, c, { "system.masterActorId": "" }))["ok"]).toBe(true);
  });
});
