/**
 * "+Novo" Actor button — regression test for two real bugs found in
 * ActorDirectory.svelte's create handler (client bug report, M6 follow-up):
 *
 *   1. WRONG WIRE KEY: the button sent `payload.documents` but
 *      DocCreatePayloadSchema (packages/shared/src/protocol.ts) requires
 *      `payload.data`. Every click was rejected with VALIDATION_FAILED —
 *      confirmed here by asserting the exact shape the server accepts vs.
 *      rejects, so a future refactor can't silently reintroduce the
 *      mismatch.
 *   2. NO ACK HANDLING: the op was fire-and-forget (no callback), so the
 *      VALIDATION_FAILED rejection was invisible — "clicking does nothing".
 *      The fix (ActorDirectory.svelte createActor()) now awaits sendOp()
 *      and surfaces failures. This file proves the SERVER side of the
 *      contract: a correctly-shaped minimal Actor (name + subtype +
 *      ownership + flags, NO `system`) is accepted, persisted, and
 *      broadcast — for both pf2e ("character") and etmos ("orador"), since
 *      the client no longer hardcodes pf2e's subtype (a world may run any
 *      target system — see project CLAUDE.md "Sistemas-alvo").
 *
 * Boots through the real boot() sequence (same pattern as
 * derive-wiring.test.ts / augmentation-slot-limit.test.ts) — no mocking of
 * the handler/store/validation stack.
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
import { PROTOCOL_VERSION, DocCreatePayloadSchema } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";
import { etmosSystem } from "@fusion/system-etmos";
import type { SystemModule } from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors derive-wiring.test.ts / augmentation-slot-limit.test.ts)
// ---------------------------------------------------------------------------

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

async function buildCtx(
  worldId: string,
  systemId: string,
  systemModule: SystemModule,
): Promise<Ctx> {
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
      worldTitle: `Actor Create Button World (${systemId})`,
      worldSystemId: systemId,
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId,
      systemModule,
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

/** The exact minimal document ActorDirectory.svelte's createActor() sends. */
function minimalActorData(name: string, subtype: string): Record<string, unknown> {
  return {
    name,
    type: subtype,
    ownership: { default: 0 },
    flags: {},
  };
}

// ---------------------------------------------------------------------------
// Wire-shape regression: `documents` (the pre-fix bug) vs `data` (correct)
// ---------------------------------------------------------------------------

describe("DocCreatePayloadSchema — wire key contract", () => {
  it("REJECTS the pre-fix payload shape (documents key) — this was bug 2's root cause", () => {
    const buggyPayload = {
      documentType: "Actor",
      documents: [minimalActorData("Novo Ator", "character")],
    };
    const result = DocCreatePayloadSchema.safeParse(buggyPayload);
    expect(result.success).toBe(false);
  });

  it("ACCEPTS the correct payload shape (data key)", () => {
    const fixedPayload = {
      documentType: "Actor",
      data: [minimalActorData("Novo Ator", "character")],
    };
    const result = DocCreatePayloadSchema.safeParse(fixedPayload);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: minimal Actor create over the real doc:create handler path
// ---------------------------------------------------------------------------

describe("doc:create Actor — minimal '+Novo' button payload (pf2e)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx("actor_create_btn_pf2e", "pf2e", pf2eSystem);
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  it("creates a minimal character Actor (no system field) and broadcasts it", async () => {
    const broadcastReceived = new Promise<Record<string, unknown>>((resolve) => {
      gm.once("op", (envelope: Record<string, unknown>) => resolve(envelope));
    });

    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [minimalActorData("Novo Ator", "character")],
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { documentType: string; documents: Array<Record<string, unknown>> };
    expect(result.documentType).toBe("Actor");
    expect(result.documents).toHaveLength(1);

    const doc = result.documents[0]!;
    expect(doc["_id"]).toEqual(expect.any(String));
    expect(doc["name"]).toBe("Novo Ator");
    expect(doc["type"]).toBe("character");
    // system defaults to {} per ActorSchema (server/src/documents/types.ts) —
    // no client-supplied system blob required for the doc to persist.
    expect(doc["system"]).toEqual(expect.any(Object));

    // The GM's own socket also receives the doc:create broadcast — this is
    // the event worldMirror.subscribe("Actor", ...) listens to client-side
    // to update ActorDirectory's list (directory.total increments).
    const broadcast = await broadcastReceived;
    expect(broadcast["type"]).toBe("doc:create");
    const broadcastPayload = broadcast["payload"] as {
      documentType: string;
      documents: Array<Record<string, unknown>>;
    };
    expect(broadcastPayload.documentType).toBe("Actor");
    expect(broadcastPayload.documents[0]?.["_id"]).toBe(doc["_id"]);
  });

  it("rejects the pre-fix payload shape (documents key) with VALIDATION_FAILED", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      // Deliberately the WRONG key (matches the pre-fix button code) to
      // prove the server-side symptom a silent fire-and-forget emit hid.
      documents: [minimalActorData("Ghost Actor", "character")],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });
});

describe("doc:create Actor — minimal '+Novo' button payload (etmos)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx("actor_create_btn_etmos", "etmos", etmosSystem);
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  it("creates a minimal orador Actor (etmos default subtype, not pf2e's character)", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [minimalActorData("Novo Ator", "orador")],
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { documentType: string; documents: Array<Record<string, unknown>> };
    const doc = result.documents[0]!;
    expect(doc["type"]).toBe("orador");
    expect(doc["_id"]).toEqual(expect.any(String));
  });
});
