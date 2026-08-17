/**
 * Token.actorId validation (REQ-TOK-002, CA-TOK-003, DEC-TOK-04, DEC-TOK-05).
 *
 * TK022: a Token document is a placement of an EXISTING Actor — `actorId`
 * null, absent, or dangling (pointing at an Actor the world does not have)
 * must be REFUSED by the server with an explicit, specific error, both when
 * a Token is created and when an existing one is updated.
 *
 * T-5 (reproduce the real write, don't just assert the derivation): before
 * this module, `handleEmbeddedUpdate` (doc-handlers.ts) let a GM/ASSISTANT
 * reach the patched-token write with zero re-validation — `actorId: null` on
 * an existing token's diff was silently ACCEPTED and PERSISTED, orphaning the
 * token. The "GM sets actorId to null on an update" case below reproduces
 * that exact write and reads the server's stored document afterwards — not
 * just the ack — to prove the state never moved.
 *
 * Infrastructure boilerplate mirrors doc-update-routing.test.ts (same repo,
 * same day) rather than reinventing a second harness.
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

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors doc-update-routing.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-token-actor-validation-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
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
  const worldId = "token_actor_validation_world";
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
    cliOverrides: { port: 0, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Token Actor Validation World",
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

async function createActor(socket: ClientSocket, name: string): Promise<string> {
  const ack = await sendOp(socket, "doc:create", {
    documentType: "Actor",
    data: [{ name, type: "npc", system: {}, ownership: { default: 0 } }],
  });
  if (!ack["ok"]) {
    throw new Error(`Failed to create actor "${name}": ${JSON.stringify(ack)}`);
  }
  return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
}

async function createScene(socket: ClientSocket, name: string): Promise<string> {
  const ack = await sendOp(socket, "doc:create", { documentType: "Scene", data: [{ name }] });
  if (!ack["ok"]) {
    throw new Error(`Failed to create scene "${name}": ${JSON.stringify(ack)}`);
  }
  return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Token.actorId validation (REQ-TOK-002, CA-TOK-003)", () => {
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

  // -------------------------------------------------------------------------
  // Create path
  // -------------------------------------------------------------------------

  it("REQ-TOK-002/CA-TOK-003: refuses doc:create Token with actorId: null, with an explicit message", async () => {
    const sceneId = await createScene(gm, "Null actorId create scene");

    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "Ghost", actorId: null, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    const message = ack["message"] as string;
    expect(message).toContain("actorId");
    expect(message).toContain("required");
    expect(message).toContain("existing Actor");
    // The generic Zod message ("Expected string, received null") must NOT be
    // what the caller sees — the requirement itself has to be spelled out.
    expect(message).not.toMatch(/expected string, received/i);

    // Server state: the scene must have no token at all.
    const scene = ctx.store.get("scenes", sceneId);
    expect(scene["tokens"]).toEqual([]);
  });

  it("REQ-TOK-002: refuses doc:create Token with actorId missing entirely", async () => {
    const sceneId = await createScene(gm, "Missing actorId create scene");

    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "NoActor", x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    const message = ack["message"] as string;
    expect(message).toContain("actorId");
    expect(message).toContain("existing Actor");

    const scene = ctx.store.get("scenes", sceneId);
    expect(scene["tokens"]).toEqual([]);
  });

  it("REQ-TOK-002/CA-TOK-003: refuses doc:create Token whose actorId resolves to no Actor", async () => {
    const sceneId = await createScene(gm, "Dangling actorId create scene");

    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "Dangling", actorId: "doesNotExist12345", x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    const message = ack["message"] as string;
    expect(message).toContain("actorId");
    expect(message).toContain("existing Actor");
    expect(message).not.toMatch(/^\s*não existe\s*$/i);

    const scene = ctx.store.get("scenes", sceneId);
    expect(scene["tokens"]).toEqual([]);
  });

  it("REQ-TOK-002: accepts and persists doc:create Token whose actorId resolves to a real Actor", async () => {
    const sceneId = await createScene(gm, "Valid actorId create scene");
    const actorId = await createActor(gm, "Real Actor For Token");

    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ actorId, x: 10, y: 20 }],
      parent: { type: "Scene", id: sceneId },
    });

    expect(ack["ok"]).toBe(true);

    const scene = ctx.store.get("scenes", sceneId);
    const tokens = scene["tokens"] as Array<Record<string, unknown>>;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.["actorId"]).toBe(actorId);
  });

  // -------------------------------------------------------------------------
  // Update path — T-5: reproduce the real write, not just the derivation
  // -------------------------------------------------------------------------

  it("T-5/REQ-TOK-002: a GM update setting actorId: null on an existing Token is refused, and the stored token keeps its actorId", async () => {
    const sceneId = await createScene(gm, "Null actorId update scene");
    const actorId = await createActor(gm, "Actor To Keep");

    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ actorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(createAck["ok"]).toBe(true);
    const tokenId = (
      ((createAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>)[
        "tokens"
      ] as Array<{ _id: string }>
    )[0]!._id;

    // Reproduce the actual indulgent write: before this task, this update
    // was accepted (ok:true) and persisted actorId: null on the token.
    const updateAck = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { actorId: null },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });

    expect(updateAck["ok"]).toBe(false);
    expect(updateAck["code"]).toBe("VALIDATION_FAILED");
    const message = updateAck["message"] as string;
    expect(message).toContain("actorId");
    expect(message).toContain("existing Actor");

    // SERVER STATE, not the ack: the token must still reference the original actor.
    const scene = ctx.store.get("scenes", sceneId);
    const tokens = scene["tokens"] as Array<Record<string, unknown>>;
    const persistedToken = tokens.find((t) => t["_id"] === tokenId);
    expect(persistedToken?.["actorId"]).toBe(actorId);
  });

  it("REQ-TOK-002: a GM update setting actorId to a nonexistent Actor id is refused", async () => {
    const sceneId = await createScene(gm, "Dangling actorId update scene");
    const actorId = await createActor(gm, "Actor To Keep 2");

    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ actorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    const tokenId = (
      ((createAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>)[
        "tokens"
      ] as Array<{ _id: string }>
    )[0]!._id;

    const updateAck = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { actorId: "stillDoesNotExist" },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });

    expect(updateAck["ok"]).toBe(false);
    expect(updateAck["code"]).toBe("VALIDATION_FAILED");

    const scene = ctx.store.get("scenes", sceneId);
    const tokens = scene["tokens"] as Array<Record<string, unknown>>;
    const persistedToken = tokens.find((t) => t["_id"] === tokenId);
    expect(persistedToken?.["actorId"]).toBe(actorId);
  });

  it("REQ-TOK-002: a GM update reassigning actorId to a DIFFERENT existing Actor is accepted (not a regression)", async () => {
    const sceneId = await createScene(gm, "Reassign actorId update scene");
    const actorId = await createActor(gm, "Actor Original");
    const otherActorId = await createActor(gm, "Actor Replacement");

    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ actorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    const tokenId = (
      ((createAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>)[
        "tokens"
      ] as Array<{ _id: string }>
    )[0]!._id;

    const updateAck = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { actorId: otherActorId },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });

    expect(updateAck["ok"]).toBe(true);

    const scene = ctx.store.get("scenes", sceneId);
    const tokens = scene["tokens"] as Array<Record<string, unknown>>;
    const persistedToken = tokens.find((t) => t["_id"] === tokenId);
    expect(persistedToken?.["actorId"]).toBe(otherActorId);
  });
});
