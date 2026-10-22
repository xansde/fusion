/**
 * I4 (revisão adversarial 3) — server-side gates that were literally
 * comparing `systemId === "pf2e"`/`"sf2e"` silently turned OFF under the
 * pf2e+sf2e COMPOSITE system, because a composite world's `systemId` is
 * `"pf2e-sf2e"`, never `"pf2e"`/`"sf2e"` themselves.
 *
 * Both fixed gates go through `systemIncludes` (packages/system-api/src/
 * manifest.ts) instead of a raw string comparison:
 *   - familiar creation (doc-handlers.ts `authorizePlayerCompanionCreate`,
 *     REQ-PET-092) — was gated on `systemId !== "pf2e"`.
 *   - the SF2e augmentation slot limit (documents/embedded-item.ts
 *     `augmentationSlotLimitViolation`, REQ-SF2-024) — was gated on
 *     `systemId !== "sf2e"`.
 *
 * Not circular: the assertion is the same book rule each gate already has
 * its own dedicated single-system suite for (player-familiar-create.test.ts,
 * augmentation-slot-limit.test.ts) — this suite only proves the SAME rule
 * still holds when `netContext.systemId = "pf2e-sf2e"` +
 * `systemModule = pf2eSf2eSystem`, the real production composite wiring
 * (boot() sequence, doc:create over the socket, no manual handler wiring).
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
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { pf2eSf2eSystem } from "@fusion/system-pf2e-sf2e";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-composite-i4-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  ownerToken: string;
  ownerUserId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "composite_i4_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: owner } = await authService.createUser({
    name: "OwnerPlayer",
    role: Role.PLAYER,
    password: "owner-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const ownerLogin = await authService.login({
    userId: owner.id,
    password: "owner-pass",
    ip: "127.0.0.1",
  });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: 0, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  // Boot through the REAL sequence with the COMPOSITE system — no manual
  // wiring of doc-handlers or the two gates under test.
  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Composite I4 World",
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

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    ownerToken: ownerLogin.accessToken,
    ownerUserId: owner.id,
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

describe("I4 — systemIncludes gates hold under the pf2e+sf2e composite system", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ownerSocket: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
    ownerSocket = connectClient(ctx.port, ctx.worldId, ctx.ownerToken);
    ownerSocket.connect();
    await waitForConnect(ownerSocket);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    ownerSocket?.disconnect();
    await teardown(ctx);
  });

  it("a PLAYER may create their own familiar under the composite system (pf2e escape hatch, REQ-PET-092)", async () => {
    const masterAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Wizard Master",
          type: "character",
          system: { details: { level: { value: 3 } } },
          ownership: { default: 0, [ctx.ownerUserId]: 3 },
          items: [{ _id: "feat-familiar", name: "Familiar", type: "feat", system: { rules: [] } }],
        },
      ],
    });
    expect(masterAck["ok"]).toBe(true);
    const masterId = (masterAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!
      ._id;

    const familiarAck = await sendOp(ownerSocket, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Tobias",
          type: "familiar",
          system: {
            companionKind: "familiar",
            masterActorId: masterId,
            master: {
              level: 3,
              abilityMod: 4,
              ac: 18,
              saves: { fortitude: 1, reflex: 1, will: 1 },
              perception: 1,
            },
            attributes: { hp: { value: 15, max: 15, temp: 0 } },
            abilitiesBudget: { value: 2, max: 2 },
            selectedAbilities: [],
          },
        },
      ],
    });
    expect(familiarAck["ok"]).toBe(true);
  });

  it("the SF2e augmentation slot limit (4 non-apex max) still applies under the composite (REQ-SF2-024)", async () => {
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
    const actorId = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    for (let i = 1; i <= 4; i++) {
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Item",
        parent: { type: "Actor", id: actorId },
        data: [makeAugmentation(`Augmentation ${String(i)}`)],
      });
      expect(ack["ok"]).toBe(true);
    }

    const fifthAck = await sendOp(gm, "doc:create", {
      documentType: "Item",
      parent: { type: "Actor", id: actorId },
      data: [makeAugmentation("Augmentation 5 (should fail)")],
    });
    expect(fifthAck["ok"]).toBe(false);
    expect(fifthAck["code"]).toBe("VALIDATION_FAILED");
    expect(fifthAck["message"]).toContain("sf2e.augmentation.slotLimit");
  });
});
