/**
 * Token creation invocation contract (spec 41 §7.2, TK025).
 *
 * §7.2 splits everything a `doc:create` for a Token can carry into four
 * rows: OBLIGATORY (without it there is no token), OVERRIDABLE (absent →
 * inherited, present → respected), DERIVED (the server computes it — a
 * payload that brings it anyway is REFUSED, never silently recomputed) and
 * explicitly REFUSED (`actorDelta`, which has its own dedicated mutation
 * route — REQ-DOC-034). This file has one test (or one parameterized group)
 * per row, reproducing the real write over a socket and reading the
 * server's stored document back — not just the ack (T-5, DEC-TOK-05).
 *
 * `token-actor-validation.test.ts` (TK022) already owns the `actorId` half
 * of the OBLIGATORY row in depth (null/absent/dangling on both create and
 * update) — this file cites REQ-TOK-020 alongside its own `x`/`y` tests
 * rather than re-deriving those cases.
 *
 * Infrastructure mirrors `token-actor-validation.test.ts` (same day, same
 * repo) rather than inventing a second harness. The one addition is a
 * second, small `buildCtx` variant (mirroring `actor-create-button.test.ts`)
 * that wires a custom `SystemModule` declaring `primaryBarAttribute`/
 * `secondaryBarAttribute` — needed because no real system in this monorepo
 * declares them yet (REQ-SYS-004 makes them optional), so proving `bar1`/
 * `bar2` actually inherit from the system (not just coincide with the
 * schema's own `{ attribute: null }` default) requires a system that
 * declares something else.
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
import { defineSystem } from "@fusion/system-api";
import type { SystemModule } from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors token-actor-validation.test.ts)
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
  store: DocumentStore;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  playerToken: string;
  playerId: string;
}

async function buildCtx(worldId: string, systemModule?: SystemModule): Promise<Ctx> {
  const dataDir = makeTempDir(worldId);
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
  });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player1-pass",
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
      worldTitle: "Token Invocation Contract World",
      worldSystemId: systemModule?.manifest.id ?? "stub",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      ...(systemModule ? { systemId: systemModule.manifest.id, systemModule } : {}),
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
    playerToken: playerLogin.accessToken,
    playerId: player.id,
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

async function createActor(
  socket: ClientSocket,
  name: string,
  type: string = "npc",
): Promise<string> {
  const ack = await sendOp(socket, "doc:create", {
    documentType: "Actor",
    data: [{ name, type, system: {}, ownership: { default: 0 } }],
  });
  if (!ack["ok"]) {
    throw new Error(`Failed to create actor "${name}": ${JSON.stringify(ack)}`);
  }
  return (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
}

/**
 * Same as `createActor`, but grants OWNER ownership to `ownerId` — the shape
 * REQ-DOC-034's own example uses ("o dono de um ator npc, um familiar
 * posicionado unlinked", DEC-DOC-12): a non-privileged player who owns the
 * Actor a Token references.
 */
async function createActorOwnedBy(
  socket: ClientSocket,
  name: string,
  type: string,
  ownerId: string,
): Promise<string> {
  const ack = await sendOp(socket, "doc:create", {
    documentType: "Actor",
    data: [{ name, type, system: {}, ownership: { default: 0, [ownerId]: 3 } }],
  });
  if (!ack["ok"]) {
    throw new Error(`Failed to create owned actor "${name}": ${JSON.stringify(ack)}`);
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

async function createToken(
  socket: ClientSocket,
  sceneId: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ack = await sendOp(socket, "doc:create", {
    documentType: "Token",
    data: [fields],
    parent: { type: "Scene", id: sceneId },
  });
  if (!ack["ok"]) {
    throw new Error(`Failed to create token: ${JSON.stringify(ack)}`);
  }
  const tokens = ((ack["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>)[
    "tokens"
  ] as Array<Record<string, unknown>>;
  return tokens[tokens.length - 1]!;
}

// ---------------------------------------------------------------------------
// Suite A — default ("stub") system. Everything except the bar1/bar2
// system-inheritance test lives here.
// ---------------------------------------------------------------------------

describe("Token invocation contract (spec 41 §7.2)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx("token_invocation_contract_world");
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    player.connect();
    await waitForConnect(player);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    player?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // Obligatory — actorId, x, y; cena vem do embedding
  // -------------------------------------------------------------------------

  describe("obligatory (REQ-TOK-020)", () => {
    it("refuses creation with x missing", async () => {
      const sceneId = await createScene(gm, "Missing x scene");
      const actorId = await createActor(gm, "Actor for missing x");

      const ack = await sendOp(gm, "doc:create", {
        documentType: "Token",
        data: [{ actorId, y: 0 }],
        parent: { type: "Scene", id: sceneId },
      });

      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("VALIDATION_FAILED");
      expect(ack["message"] as string).toContain("x");
      const scene = ctx.store.get("scenes", sceneId);
      expect(scene["tokens"]).toEqual([]);
    });

    it("refuses creation with y missing", async () => {
      const sceneId = await createScene(gm, "Missing y scene");
      const actorId = await createActor(gm, "Actor for missing y");

      const ack = await sendOp(gm, "doc:create", {
        documentType: "Token",
        data: [{ actorId, x: 0 }],
        parent: { type: "Scene", id: sceneId },
      });

      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("VALIDATION_FAILED");
      expect(ack["message"] as string).toContain("y");
      const scene = ctx.store.get("scenes", sceneId);
      expect(scene["tokens"]).toEqual([]);
    });

    it("the scene comes from the embedding (`parent`), never from a field in the payload", async () => {
      const targetSceneId = await createScene(gm, "Embedding target scene");
      const decoySceneId = await createScene(gm, "Embedding decoy scene");
      const actorId = await createActor(gm, "Actor for embedding test");

      // A payload field that LOOKS like it might redirect the token is
      // simply not a thing this schema reads — the parent embedding is the
      // only route to a scene.
      const ack = await sendOp(gm, "doc:create", {
        documentType: "Token",
        data: [{ actorId, x: 0, y: 0, sceneId: decoySceneId }],
        parent: { type: "Scene", id: targetSceneId },
      });
      expect(ack["ok"]).toBe(true);

      const targetScene = ctx.store.get("scenes", targetSceneId);
      const decoyScene = ctx.store.get("scenes", decoySceneId);
      expect((targetScene["tokens"] as unknown[]).length).toBe(1);
      expect((decoyScene["tokens"] as unknown[]).length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Overridable — absent → inherited, present → respected
  // -------------------------------------------------------------------------

  describe("overridable: actorLink (REQ-TOK-023/024, REQ-DOC-061)", () => {
    it("absent + actor subtype npc → creates unlinked (actorLink: false)", async () => {
      const sceneId = await createScene(gm, "actorLink npc scene");
      const actorId = await createActor(gm, "NPC for actorLink default", "npc");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 });
      expect(token["actorLink"]).toBe(false);
    });

    it("absent + actor subtype character → creates linked (actorLink: true)", async () => {
      const sceneId = await createScene(gm, "actorLink character scene");
      const actorId = await createActor(gm, "PC for actorLink default", "character");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 });
      expect(token["actorLink"]).toBe(true);
    });

    it("present overrides the subtype default in both directions (REQ-TOK-024)", async () => {
      const sceneId = await createScene(gm, "actorLink override scene");
      const npcActorId = await createActor(gm, "NPC overridden to linked", "npc");
      const pcActorId = await createActor(gm, "PC overridden to unlinked", "character");

      const npcToken = await createToken(gm, sceneId, {
        actorId: npcActorId,
        x: 0,
        y: 0,
        actorLink: true,
      });
      expect(npcToken["actorLink"]).toBe(true);

      const pcToken = await createToken(gm, sceneId, {
        actorId: pcActorId,
        x: 0,
        y: 0,
        actorLink: false,
      });
      expect(pcToken["actorLink"]).toBe(false);
    });
  });

  describe("overridable: hidden, seenBy (REQ-TOK-050)", () => {
    it("absent → visible by default (hidden: false, seenBy: [])", async () => {
      const sceneId = await createScene(gm, "hidden default scene");
      const actorId = await createActor(gm, "Actor for hidden default");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 });
      expect(token["hidden"]).toBe(false);
      expect(token["seenBy"]).toEqual([]);
    });

    it("present is respected — an ambush can be created already hidden with exceptions", async () => {
      const sceneId = await createScene(gm, "hidden respected scene");
      const actorId = await createActor(gm, "Actor for hidden respected");

      const token = await createToken(gm, sceneId, {
        actorId,
        x: 0,
        y: 0,
        hidden: true,
        seenBy: ["some-user-id"],
      });
      expect(token["hidden"]).toBe(true);
      expect(token["seenBy"]).toEqual(["some-user-id"]);
    });
  });

  describe("overridable: disposition (REQ-TOK-080)", () => {
    it("absent → null (inherits from the actor at read time)", async () => {
      const sceneId = await createScene(gm, "disposition default scene");
      const actorId = await createActor(gm, "Actor for disposition default");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 });
      expect(token["disposition"]).toBeNull();
    });

    it("present is respected", async () => {
      const sceneId = await createScene(gm, "disposition respected scene");
      const actorId = await createActor(gm, "Actor for disposition respected");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0, disposition: -1 });
      expect(token["disposition"]).toBe(-1);
    });
  });

  describe("overridable: name (REQ-TOK-060)", () => {
    it("absent → null (inherits from the actor at read time — DEC-TOK-09)", async () => {
      const sceneId = await createScene(gm, "name default scene");
      const actorId = await createActor(gm, "Actor for name default");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 });
      expect(token["name"]).toBeNull();
    });

    it("present is respected", async () => {
      const sceneId = await createScene(gm, "name respected scene");
      const actorId = await createActor(gm, "Actor for name respected");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0, name: "Skeleton #3" });
      expect(token["name"]).toBe("Skeleton #3");
    });
  });

  describe("overridable: rotation, elevation (REQ-TOK-021)", () => {
    it("absent → zero", async () => {
      const sceneId = await createScene(gm, "rotation default scene");
      const actorId = await createActor(gm, "Actor for rotation default");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 });
      expect(token["rotation"]).toBe(0);
      expect(token["elevation"]).toBe(0);
    });

    it("present is respected", async () => {
      const sceneId = await createScene(gm, "rotation respected scene");
      const actorId = await createActor(gm, "Actor for rotation respected");

      const token = await createToken(gm, sceneId, {
        actorId,
        x: 0,
        y: 0,
        rotation: 90,
        elevation: 20,
      });
      expect(token["rotation"]).toBe(90);
      expect(token["elevation"]).toBe(20);
    });
  });

  describe("overridable: vision, light (REQ-TOK-021 — inert declaration, REQ-TOK-101)", () => {
    it("absent → the schema's own default (the Actor document carries no vision/light of its own today)", async () => {
      const sceneId = await createScene(gm, "vision default scene");
      const actorId = await createActor(gm, "Actor for vision default");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 });
      expect((token["vision"] as Record<string, unknown>)["enabled"]).toBe(false);
      expect((token["light"] as Record<string, unknown>)["intensity"]).toBe(0.5);
    });

    it("present is respected", async () => {
      const sceneId = await createScene(gm, "vision respected scene");
      const actorId = await createActor(gm, "Actor for vision respected");

      const token = await createToken(gm, sceneId, {
        actorId,
        x: 0,
        y: 0,
        vision: { enabled: true, range: 30 },
        light: { color: "#ff0000", intensity: 1 },
      });
      const vision = token["vision"] as Record<string, unknown>;
      const light = token["light"] as Record<string, unknown>;
      expect(vision["enabled"]).toBe(true);
      expect(vision["range"]).toBe(30);
      expect(light["color"]).toBe("#ff0000");
      expect(light["intensity"]).toBe(1);
    });
  });

  describe("overridable: bar1, bar2 (REQ-SYS-004) — present is respected", () => {
    it("present overrides whatever the (undeclared, stub) system default would be", async () => {
      const sceneId = await createScene(gm, "bar respected scene");
      const actorId = await createActor(gm, "Actor for bar respected");

      const token = await createToken(gm, sceneId, {
        actorId,
        x: 0,
        y: 0,
        bar1: { attribute: "system.custom.hp" },
        bar2: { attribute: "system.custom.mp" },
      });
      expect((token["bar1"] as Record<string, unknown>)["attribute"]).toBe("system.custom.hp");
      expect((token["bar2"] as Record<string, unknown>)["attribute"]).toBe("system.custom.mp");
    });

    it("absent, and the world's system declares nothing (REQ-SYS-004 is optional) → schema default", async () => {
      const sceneId = await createScene(gm, "bar undeclared scene");
      const actorId = await createActor(gm, "Actor for bar undeclared");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 });
      expect((token["bar1"] as Record<string, unknown>)["attribute"]).toBeNull();
      expect((token["bar2"] as Record<string, unknown>)["attribute"]).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Derived — the server computes it; a payload that brings it is REFUSED,
  // naming the field (REQ-TOK-022, DEC-TOK-05).
  // -------------------------------------------------------------------------

  describe("derived fields are refused at creation, naming the field (REQ-TOK-022)", () => {
    const cases: Array<{ field: string; value: unknown }> = [
      { field: "width", value: 2 },
      { field: "height", value: 2 },
      { field: "texture", value: "some/path.webp" },
      { field: "img", value: "some/path.webp" },
      { field: "ownership", value: { default: 2 } },
      { field: "userId", value: "some-user-id" },
    ];

    it.each(cases)("refuses $field, naming it in the error", async ({ field, value }) => {
      const sceneId = await createScene(gm, `derived ${field} scene`);
      const actorId = await createActor(gm, `Actor for derived ${field}`);

      const ack = await sendOp(gm, "doc:create", {
        documentType: "Token",
        data: [{ actorId, x: 0, y: 0, [field]: value }],
        parent: { type: "Scene", id: sceneId },
      });

      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("VALIDATION_FAILED");
      const message = ack["message"] as string;
      expect(message).toContain(field);
      expect(message).toContain("REQ-TOK-022");

      const scene = ctx.store.get("scenes", sceneId);
      expect(scene["tokens"]).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Refused explicitly — actorDelta (CA-TOK-004, DEC-TOK-05, REQ-DOC-034)
  // -------------------------------------------------------------------------

  describe("actorDelta (CA-TOK-004, REQ-DOC-034, DEC-TOK-05)", () => {
    it("refuses actorDelta on creation, unconditionally", async () => {
      const sceneId = await createScene(gm, "actorDelta create scene");
      const actorId = await createActor(gm, "Actor for actorDelta create refusal");

      const ack = await sendOp(gm, "doc:create", {
        documentType: "Token",
        data: [{ actorId, x: 0, y: 0, actorDelta: { system: { hp: { value: 3 } } } }],
        parent: { type: "Scene", id: sceneId },
      });

      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("VALIDATION_FAILED");
      const message = ack["message"] as string;
      expect(message).toContain("actorDelta");
      expect(message).toContain("REQ-DOC-034");

      const scene = ctx.store.get("scenes", sceneId);
      expect(scene["tokens"]).toEqual([]);
    });

    it("accepts actorDelta on an UPDATE of an unlinked token (REQ-DOC-034)", async () => {
      const sceneId = await createScene(gm, "actorDelta unlinked update scene");
      const actorId = await createActor(gm, "NPC for actorDelta unlinked update", "npc");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 }); // npc → actorLink: false
      expect(token["actorLink"]).toBe(false);

      const updateAck = await sendOp(gm, "doc:update", {
        documentType: "Token",
        updates: [
          {
            _id: token["_id"],
            diff: { actorDelta: { system: { hp: { value: 3 } } } },
            embedded: { type: "Token", id: sceneId },
          },
        ],
      });

      expect(updateAck["ok"]).toBe(true);
      const scene = ctx.store.get("scenes", sceneId);
      const tokens = scene["tokens"] as Array<Record<string, unknown>>;
      const persisted = tokens.find((t) => t["_id"] === token["_id"]);
      expect((persisted?.["actorDelta"] as Record<string, unknown> | null)?.["system"]).toEqual({
        hp: { value: 3 },
      });
    });

    it("refuses actorDelta on an UPDATE of a linked token, and the state does not change", async () => {
      const sceneId = await createScene(gm, "actorDelta linked update scene");
      const actorId = await createActor(gm, "PC for actorDelta linked update", "character");

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 }); // character → actorLink: true
      expect(token["actorLink"]).toBe(true);

      const updateAck = await sendOp(gm, "doc:update", {
        documentType: "Token",
        updates: [
          {
            _id: token["_id"],
            diff: { actorDelta: { system: { hp: { value: 3 } } } },
            embedded: { type: "Token", id: sceneId },
          },
        ],
      });

      expect(updateAck["ok"]).toBe(false);
      expect(updateAck["code"]).toBe("VALIDATION_FAILED");
      const message = updateAck["message"] as string;
      expect(message).toContain("actorDelta");
      expect(message).toContain("REQ-DOC-034");

      const scene = ctx.store.get("scenes", sceneId);
      const tokens = scene["tokens"] as Array<Record<string, unknown>>;
      const persisted = tokens.find((t) => t["_id"] === token["_id"]);
      expect(persisted?.["actorDelta"]).toBeNull();
    });

    it("refuses actorDelta on an UPDATE from a non-privileged OWNER of an unlinked token's actor, and the persisted actorDelta does not change (REQ-DOC-034)", async () => {
      const sceneId = await createScene(gm, "actorDelta player-owned unlinked scene");
      // REQ-CEN-071/073: a scene not on air does not exist for a
      // non-privileged caller — the player socket below needs the scene ON
      // AIR to reach the token at all, independent of the actorDelta gate
      // this test is actually about.
      const activateAck = await sendOp(gm, "world:activeScene", { sceneId });
      if (!activateAck["ok"]) {
        throw new Error(`Failed to activate scene: ${JSON.stringify(activateAck)}`);
      }
      // REQ-DOC-034's own example: "o dono de um ator npc (um familiar
      // posicionado unlinked)" — a player who OWNS the npc Actor a token
      // references, on a token that resolveActorLinkCreateDefault makes
      // unlinked by default (npc subtype).
      const actorId = await createActorOwnedBy(
        gm,
        "NPC owned by player for actorDelta permission gate",
        "npc",
        ctx.playerId,
      );

      const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 });
      expect(token["actorLink"]).toBe(false);

      // Sanity check: the player really does have OWNER-level write access
      // to this token via the actor-ownership route (REQ-DOC-025) — proving
      // the permission gate below is about `actorDelta` specifically, not
      // about the player being blocked from touching the token at all.
      const rotationAck = await sendOp(player, "doc:update", {
        documentType: "Token",
        updates: [
          {
            _id: token["_id"],
            diff: { rotation: 45 },
            embedded: { type: "Token", id: sceneId },
          },
        ],
      });
      expect(rotationAck["ok"]).toBe(true);

      const updateAck = await sendOp(player, "doc:update", {
        documentType: "Token",
        updates: [
          {
            _id: token["_id"],
            diff: { actorDelta: { system: { hp: { value: 3 } } } },
            embedded: { type: "Token", id: sceneId },
          },
        ],
      });

      expect(updateAck["ok"]).toBe(false);
      expect(updateAck["code"]).toBe("PERMISSION_DENIED");
      const message = updateAck["message"] as string;
      expect(message).toContain("actorDelta");
      expect(message).toContain("REQ-DOC-034");

      const scene = ctx.store.get("scenes", sceneId);
      const tokens = scene["tokens"] as Array<Record<string, unknown>>;
      const persisted = tokens.find((t) => t["_id"] === token["_id"]);
      expect(persisted?.["actorDelta"]).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Suite B — a custom system that DOES declare primaryBarAttribute/
// secondaryBarAttribute, proving bar1/bar2 actually read the manifest
// (REQ-SYS-004) rather than coincidentally landing on the schema default.
// ---------------------------------------------------------------------------

const barDeclaringSystem: SystemModule = defineSystem(
  {
    id: "bar-declaring-test-system",
    title: "Bar-Declaring Test System",
    version: "0.1.0",
    engineCompat: ">=0.1.0",
    authors: [{ name: "Fusion Engine Team" }],
    documentTypes: {},
    languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    primaryBarAttribute: "system.attributes.hp",
    secondaryBarAttribute: "system.attributes.mp",
  },
  () => {
    // No models/derive-steps needed — this system exists only to declare
    // primaryBarAttribute/secondaryBarAttribute for this test.
  },
);

describe("Token invocation contract — bar1/bar2 inherit from the system's manifest (REQ-SYS-004)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;

  beforeAll(async () => {
    ctx = await buildCtx("token_invocation_contract_bar_world", barDeclaringSystem);
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  it("absent bar1/bar2 inherit primaryBarAttribute/secondaryBarAttribute from the world's system", async () => {
    const sceneId = await createScene(gm, "bar system default scene");
    const actorId = await createActor(gm, "Actor for bar system default");

    const token = await createToken(gm, sceneId, { actorId, x: 0, y: 0 });
    expect((token["bar1"] as Record<string, unknown>)["attribute"]).toBe("system.attributes.hp");
    expect((token["bar2"] as Record<string, unknown>)["attribute"]).toBe("system.attributes.mp");
  });
});
