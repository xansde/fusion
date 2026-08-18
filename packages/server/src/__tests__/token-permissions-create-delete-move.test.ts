/**
 * Token permissions — creating, deleting and moving a token (spec 41-token.md
 * Fase 4, TK050/TK051).
 *
 * DEC-TOK-06: "Pôr peça na cena, duplicar e tirar exigem papel privilegiado.
 * Mover exige ser OWNER do ator que a peça manifesta." Two different rulers
 * on purpose — REQ-TOK-030/031 gate create/duplicate/delete by ROLE alone
 * (never ownership, "inclusive pelo OWNER do ator manifestado"); REQ-TOK-032
 * gates move by OWNERSHIP of the effective actor (or privileged role).
 *
 * Before this file, `handleEmbeddedDelete` (doc-handlers.ts) had NO role gate
 * for Token at all — a non-privileged caller who happened to be OWNER of the
 * token's actor reached the same ownership-of-actor branch `handleEmbeddedUpdate`
 * (move) uses, and could delete their own token outright. That is exactly the
 * violation REQ-TOK-031 names ("mesma régua de REQ-TOK-030" — role, not
 * ownership) — reproduced below (the OWNER-delete case) before the fix that
 * adds the TOKEN_DELETE role floor to the Token branch of handleEmbeddedDelete.
 *
 * CA-TOK-005: a player OWNER of their own character tries to put the token on
 * the scene and is refused; the GM does the same and is accepted.
 * CA-TOK-006: that same player moves their own character's token (arrow keys
 * and drag both funnel into token:move — REQ-TOK-041), and is refused when
 * trying to move an NPC's token.
 * REQ-TOK-034: there is no "controle de token" predicate distinct from OWNER
 * of the effective actor — every check below reads ownership through the same
 * `resolveOwnership`/`testOwnership` core (documents/ownership.ts).
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
import { DocumentStore } from "../documents/store.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors token-actor-validation.test.ts / embedded-item-actor.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-token-permissions-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  ownerToken: string;
  ownerUserId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "token_permissions_world";
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

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Token Permissions World",
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

function newTokenData(actorId: string, name?: string): Record<string, unknown> {
  const data: Record<string, unknown> = { actorId, x: 0, y: 0 };
  if (name !== undefined) data["name"] = name;
  return data;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Token permissions — create/delete (papel privilegiado) vs. move (OWNER do ator)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let ownerSocket: ClientSocket;
  /** The player's own character — `ownerUserId` is OWNER. */
  let pcActorId: string;
  /** An NPC the player does NOT own — only the GM does. */
  let npcActorId: string;
  let sceneId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    ownerSocket = connectClient(ctx.port, ctx.worldId, ctx.ownerToken);
    gm.connect();
    ownerSocket.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(ownerSocket)]);

    const actorsAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Tobias",
          type: "character",
          system: {},
          ownership: { default: 0, [ctx.ownerUserId]: 3 },
        },
        { name: "Goblin", type: "npc", system: {} },
      ],
    });
    expect(actorsAck["ok"], JSON.stringify(actorsAck)).toBe(true);
    const actors = (actorsAck["result"] as { documents: Array<{ _id: string }> }).documents;
    pcActorId = actors[0]!._id;
    npcActorId = actors[1]!._id;

    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Taverna", tokens: [] }],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    // REQ-CEN-071/073: a Scene not "on air" does not exist for a non-privileged
    // caller — every check below as the player needs the scene active first,
    // or every op returns NOT_FOUND before it ever reaches the permission gate.
    const activateAck = await sendOp(gm, "world:activeScene", { sceneId });
    expect(activateAck["ok"], JSON.stringify(activateAck)).toBe(true);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    ownerSocket?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // TK050 — create (REQ-TOK-030, CA-TOK-005)
  // -------------------------------------------------------------------------

  it("CA-TOK-005/REQ-TOK-030: a player OWNER of their own character is refused when creating the token", async () => {
    const ack = await sendOp(ownerSocket, "doc:create", {
      documentType: "Token",
      data: [newTokenData(pcActorId, "Tobias")],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");

    const scene = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    expect((scene["tokens"] as unknown[]).length).toBe(0);
  });

  let pcTokenId: string;
  let npcTokenId: string;

  it("CA-TOK-005/REQ-TOK-030: the GM creates the same token and is accepted", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [newTokenData(pcActorId, "Tobias")],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const result = ack["result"] as { documents: Array<{ _id: string }> };
    pcTokenId = result.documents[0]!._id;
    expect(pcTokenId).toBeTruthy();
  });

  it("seeds the NPC token (GM) so the move test has something to refuse", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [newTokenData(npcActorId, "Goblin")],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const result = ack["result"] as { documents: Array<{ _id: string }> };
    npcTokenId = result.documents[0]!._id;
    expect(npcTokenId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // TK050 — delete (REQ-TOK-031, "mesma régua" de REQ-TOK-030)
  // -------------------------------------------------------------------------

  it("REQ-TOK-031: the player, OWNER of the actor, is refused when deleting their own token — same rule as create, not ownership", async () => {
    const ack = await sendOp(ownerSocket, "doc:delete", {
      documentType: "Token",
      ids: [pcTokenId],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");

    const scene = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    const tokens = scene["tokens"] as Array<Record<string, unknown>>;
    expect(tokens.some((t) => t["_id"] === pcTokenId)).toBe(true);
  });

  it("REQ-TOK-031: the GM deletes the same token and is accepted", async () => {
    const ack = await sendOp(gm, "doc:delete", {
      documentType: "Token",
      ids: [pcTokenId],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const scene = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    const tokens = scene["tokens"] as Array<Record<string, unknown>>;
    expect(tokens.some((t) => t["_id"] === pcTokenId)).toBe(false);
  });

  it("TK092 (REQ-TOK-092): deleting a token does not touch the actor it manifested", async () => {
    // The opposite direction of TK091's cascade (REQ-TOK-093): a token
    // leaving a scene must never reach into the actors table. Re-create the
    // PC's token (deleted above) and delete it again, then confirm the
    // actor is untouched.
    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [newTokenData(pcActorId, "Tobias")],
      parent: { type: "Scene", id: sceneId },
    });
    expect(createAck["ok"]).toBe(true);
    const anotherPcTokenId = (createAck["result"] as { documents: Array<{ _id: string }> })
      .documents[0]!._id;

    const actorBefore = ctx.store.get("actors", pcActorId) as Record<string, unknown>;

    const deleteAck = await sendOp(gm, "doc:delete", {
      documentType: "Token",
      ids: [anotherPcTokenId],
      parent: { type: "Scene", id: sceneId },
    });
    expect(deleteAck["ok"], JSON.stringify(deleteAck)).toBe(true);

    const actorAfter = ctx.store.get("actors", pcActorId) as Record<string, unknown>;
    expect(actorAfter).toEqual(actorBefore);
  });

  // -------------------------------------------------------------------------
  // TK051 — move (REQ-TOK-032, REQ-TOK-034, CA-TOK-006)
  // -------------------------------------------------------------------------

  it("CA-TOK-006/REQ-TOK-032: a player OWNER of the actor can move that actor's token", async () => {
    // Re-create the PC's token (deleted above by the GM) for this check.
    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [newTokenData(pcActorId, "Tobias")],
      parent: { type: "Scene", id: sceneId },
    });
    expect(createAck["ok"]).toBe(true);
    const newPcTokenId = (createAck["result"] as { documents: Array<{ _id: string }> })
      .documents[0]!._id;

    const moveAck = await sendOp(ownerSocket, "token:move", {
      sceneId,
      tokenId: newPcTokenId,
      x: 5,
      y: 5,
    });
    expect(moveAck["ok"], JSON.stringify(moveAck)).toBe(true);

    const scene = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    const token = (scene["tokens"] as Array<Record<string, unknown>>).find(
      (t) => t["_id"] === newPcTokenId,
    );
    expect(token?.["x"]).toBe(5);
    expect(token?.["y"]).toBe(5);
  });

  it("CA-TOK-006/REQ-TOK-032/034: the same player is refused moving the NPC's token — no separate 'controle de token' predicate, only OWNER-of-actor", async () => {
    const moveAck = await sendOp(ownerSocket, "token:move", {
      sceneId,
      tokenId: npcTokenId,
      x: 9,
      y: 9,
    });
    expect(moveAck["ok"]).toBe(false);
    expect(moveAck["code"]).toBe("PERMISSION_DENIED");

    const scene = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    const token = (scene["tokens"] as Array<Record<string, unknown>>).find(
      (t) => t["_id"] === npcTokenId,
    );
    expect(token?.["x"]).not.toBe(9);
  });

  it("REQ-TOK-032: the GM moves the NPC's token without owning it, via the privileged-role branch", async () => {
    const moveAck = await sendOp(gm, "token:move", {
      sceneId,
      tokenId: npcTokenId,
      x: 9,
      y: 9,
    });
    expect(moveAck["ok"], JSON.stringify(moveAck)).toBe(true);

    const scene = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    const token = (scene["tokens"] as Array<Record<string, unknown>>).find(
      (t) => t["_id"] === npcTokenId,
    );
    expect(token?.["x"]).toBe(9);
    expect(token?.["y"]).toBe(9);
  });

  // -------------------------------------------------------------------------
  // TK092 — dying does not touch the token (REQ-TOK-094/095, CA-TOK-014)
  // -------------------------------------------------------------------------

  it("TK092 (REQ-TOK-094/095, CA-TOK-014): the actor's hp reaching 0 leaves the token exactly as it was", async () => {
    const scene = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    const before = (scene["tokens"] as Array<Record<string, unknown>>).find(
      (t) => t["_id"] === npcTokenId,
    );
    expect(before).toBeDefined();

    // Kill the NPC's actor (nothing in this spec removes/replaces a token as
    // a consequence of the actor's state — REQ-TOK-094 — and there is no
    // hp-triggered token mutation anywhere in the server to begin with).
    const npcActorAck = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: npcActorId,
          diff: { system: { attributes: { hp: { value: 0, max: 6 } } } },
        },
      ],
    });
    expect(npcActorAck["ok"], JSON.stringify(npcActorAck)).toBe(true);

    const after = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    const token = (after["tokens"] as Array<Record<string, unknown>>).find(
      (t) => t["_id"] === npcTokenId,
    );
    // Same document, byte for byte — same _id (CA-TOK-014), same everything.
    expect(token).toEqual(before);
  });
});
