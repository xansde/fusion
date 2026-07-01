/**
 * SF2e augmentation slot-limit — real handler path integration test.
 *
 * REQ-SF2-024 [MVP], CA-SF2-05: an actor may not have more than 4 non-apex
 * augmentations installed; apex augmentations do not count toward the limit.
 *
 * This is the PROOF that the validation actually runs in a real doc:create
 * round-trip: it boots the server through the real boot() sequence (same
 * pattern as boot-compendium.test.ts) with netContext.systemId = "sf2e", then
 * drives doc:create with documentType="Item" + parent={type:"Actor", id} —
 * the only real code path an embedded Item creation goes through in
 * production (packages/server/src/net/handlers/doc-handlers.ts,
 * handleEmbeddedCreate). The system-api hook bus (preCreateItem) is dead
 * code in production and is intentionally NOT exercised here — see
 * systems/sf2e/src/hooks/augmentation.ts docstring for the investigation.
 *
 * Spec: 18-sistema-sf2e.md REQ-SF2-024, CA-SF2-05.
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
// Test infrastructure (mirrors boot-compendium.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-aug-limit-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "aug_limit_world";

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

  // Boot through the REAL sequence with systemId="sf2e" — no manual wiring
  // of doc-handlers or the augmentation validation. If this test passes, the
  // slot limit is provably enforced on the actual production path.
  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Augmentation Slot Limit World",
      worldSystemId: "sf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "sf2e",
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

function makeAugmentation(name: string, isApex = false) {
  return {
    name,
    type: "augmentation",
    system: {
      augType: isApex ? "apex" : "biotech",
      isApex,
      level: { value: 1 },
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SF2e augmentation slot limit — enforced on the real doc:create handler path", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let actorId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);

    const actorAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Augmented Operative",
          type: "character",
          system: { details: { level: { value: 5 } } },
          ownership: { default: 0 },
        },
      ],
    });
    expect(actorAck["ok"]).toBe(true);
    const docs = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents;
    actorId = docs[0]!._id;
    expect(actorId).toBeTruthy();
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  it("allows installing 4 non-apex augmentations", async () => {
    for (let i = 1; i <= 4; i++) {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Item",
        parent: { type: "Actor", id: actorId },
        data: [makeAugmentation(`Augmentation ${String(i)}`)],
      });
      expect(ack["ok"]).toBe(true);
    }
  });

  it("rejects the 5th non-apex augmentation with the slot-limit i18n key", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      data: [makeAugmentation("Augmentation 5 (should fail)")],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(ack["message"]).toContain("sf2e.augmentation.slotLimit");
  });

  it("apex augmentations do not count toward the limit", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      data: [makeAugmentation("Apex Booster", true)],
    });
    expect(ack["ok"]).toBe(true);

    // A second apex augmentation should also be fine — apex never counts.
    const ack2 = await sendOp(gm, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      data: [makeAugmentation("Apex Booster 2", true)],
    });
    expect(ack2["ok"]).toBe(true);
  });

  it("a single batch of multiple non-apex augmentations is capped by the same limit", async () => {
    // At this point the actor already has 4 non-apex + 2 apex installed.
    // A fresh actor lets us test intra-batch counting cleanly.
    const freshActorAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Fresh Operative",
          type: "character",
          system: { details: { level: { value: 1 } } },
          ownership: { default: 0 },
        },
      ],
    });
    const freshActorId = (freshActorAck["result"] as { documents: Array<{ _id: string }> })
      .documents[0]!._id;

    // Single doc:create call with 5 non-apex augmentations in one batch.
    const batchAck = await sendOp(gm, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: freshActorId },
      data: [
        makeAugmentation("Batch Aug 1"),
        makeAugmentation("Batch Aug 2"),
        makeAugmentation("Batch Aug 3"),
        makeAugmentation("Batch Aug 4"),
        makeAugmentation("Batch Aug 5"),
      ],
    });
    expect(batchAck["ok"]).toBe(false);
    expect(batchAck["message"]).toContain("sf2e.augmentation.slotLimit");
  });
});
