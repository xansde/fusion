/**
 * Several tokens for the same Actor — REQ-DOC-031..034, DEC-DOC-08.
 *
 * The product ask, verbatim: "criar diversos tokens para uma ficha, podendo ter
 * vários tokens para o mesmo ator (útil para esqueletos, por exemplo)". The
 * behaviour that phrase demands is exactly one thing: the GM drops six
 * skeletons from ONE Actor and killing the third does not scratch the other
 * five.
 *
 * This runs against a REAL server, real sockets and real SQLite for the same
 * reason `token-display-bars-e2e.test.ts` does: the create path validates each
 * token with the strict `TokenDocumentSchema` (undeclared keys are dropped in
 * silence, which is how `grid` disappeared — docs/lessons.md), while the
 * update path travels the deep-merge engine and the loose `SceneSchema.tokens`
 * record. A field can be accepted on one and erased on the other, and only a
 * round trip through persistence can tell.
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
import { PROTOCOL_VERSION, applyActorDelta } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  playerId: string;
  playerToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "token_actor_delta_world";
  const dataDir = join(
    tmpdir(),
    `fusion-token-delta-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Jogadora",
    role: Role.PLAYER,
    password: "player-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  const port = await reserveFreePort();
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port, host: "127.0.0.1", logLevel: "silent" },
  });

  const bootResult = await boot({
    config,
    logger: createLogger("silent"),
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Token Actor Delta World",
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
      systemModule: pf2eSystem,
    },
  });

  return {
    dataDir,
    fusionDb,
    bootResult,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerId: player.id,
    playerToken: playerLogin.accessToken,
  };
}

function connectClient(ctx: Ctx, token: string): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
    auth: { token, protocolVersion: PROTOCOL_VERSION },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

async function connected(ctx: Ctx, token: string): Promise<ClientSocket> {
  const socket = connectClient(ctx, token);
  socket.connect();
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout for op: ${type}`));
    }, 8000);
  });
}

/**
 * Reconnect from scratch and read the whole snapshot — the only reading that
 * proves a value came out of SQLite rather than out of the handler's own
 * return value.
 */
async function snapshotFor(
  ctx: Ctx,
  token: string,
): Promise<Record<string, Record<string, unknown>[]>> {
  const socket = connectClient(ctx, token);
  const documents = await new Promise<Record<string, Record<string, unknown>[]>>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("no resync:full arrived"));
      }, 8000);
      socket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] !== "resync:full") return;
        clearTimeout(timer);
        const payload = env["payload"] as { snapshot?: Record<string, unknown> | null };
        resolve(
          (payload.snapshot?.["documents"] ?? {}) as Record<string, Record<string, unknown>[]>,
        );
      });
      socket.once("connect_error", reject);
      socket.connect();
    },
  );
  socket.disconnect();
  return documents;
}

function firstDocument(
  documents: Record<string, Record<string, unknown>[]>,
  type: string,
  id: string,
): Record<string, unknown> | undefined {
  return (documents[type] ?? []).find((d) => d["_id"] === id);
}

function tokenOf(scene: Record<string, unknown> | undefined, id: string): Record<string, unknown> {
  const tokens = scene?.["tokens"];
  const found = Array.isArray(tokens)
    ? (tokens as Record<string, unknown>[]).find((t) => t["_id"] === id)
    : undefined;
  if (!found) throw new Error(`token ${id} absent from scene payload`);
  return found;
}

/** Hit points of the actor a token actually plays with (REQ-DOC-032/033). */
function tokenHp(token: Record<string, unknown>, baseActor: Record<string, unknown>): unknown {
  const actor =
    token["actorLink"] === false ? applyActorDelta(baseActor, token["actorDelta"]) : baseActor;
  const system = actor["system"] as Record<string, unknown> | undefined;
  const attributes = system?.["attributes"] as Record<string, unknown> | undefined;
  return (attributes?.["hp"] as Record<string, unknown> | undefined)?.["value"];
}

function actorHp(actor: Record<string, unknown> | undefined): unknown {
  const system = actor?.["system"] as Record<string, unknown> | undefined;
  const attributes = system?.["attributes"] as Record<string, unknown> | undefined;
  return (attributes?.["hp"] as Record<string, unknown> | undefined)?.["value"];
}

function countActorRows(ctx: Ctx): number {
  const row = ctx.fusionDb.raw.prepare("SELECT COUNT(*) AS n FROM actors").get() as { n: number };
  return row.n;
}

async function createToken(
  gm: ClientSocket,
  sceneId: string,
  data: Record<string, unknown>,
): Promise<string> {
  const ack = await sendOp(gm, "doc:create", {
    documentType: "Token",
    data: [data],
    parent: { type: "Scene", id: sceneId },
  });
  expect(ack["ok"]).toBe(true);
  const created = (
    (ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
  )[0];
  return created?.["_id"] as string;
}

// ---------------------------------------------------------------------------

describe("several tokens for one Actor (REQ-DOC-031..034)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let sceneId = "";
  let skeletonActorId = "";
  let heroActorId = "";

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = await connected(ctx, ctx.gmToken);

    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Cripta" }],
    });
    sceneId = (
      (sceneAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const skeletonAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Esqueleto",
          type: "npc",
          system: { attributes: { hp: { value: 20, max: 20 } } },
        },
      ],
    });
    skeletonActorId = (
      (skeletonAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // A player-owned character: the linked case, where one pool of hit points
    // behind every token is the CORRECT behaviour.
    const heroAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Heroína",
          type: "character",
          system: { attributes: { hp: { value: 30, max: 30 } } },
          ownership: { default: 0, [ctx.playerId]: 3 },
        },
      ],
    });
    heroActorId = (
      (heroAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;
  }, 60000);

  afterAll(async () => {
    gm.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // The round trip (the trap that ate `grid`)
  // -------------------------------------------------------------------------

  it("actorLink and actorDelta survive the CREATE path", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto 1",
      actorId: skeletonActorId,
      actorLink: false,
      actorDelta: { system: { attributes: { hp: { value: 11 } } } },
      x: 0,
      y: 0,
    });

    const scene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    const token = tokenOf(scene, tokenId);
    expect(token["actorLink"]).toBe(false);
    expect(token["actorDelta"]).toMatchObject({ system: { attributes: { hp: { value: 11 } } } });
  }, 30000);

  it("a token that omits actorLink is created LINKED — every world already persisted stays as it was", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Sem opinião",
      actorId: heroActorId,
      x: 10,
      y: 10,
    });

    const scene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    const token = tokenOf(scene, tokenId);
    expect(token["actorLink"]).toBe(true);
    expect(token["actorDelta"]).toEqual({});
  }, 30000);

  it("a token dropped from an npc Actor is born UNLINKED (REQ-DOC-061)", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto arrastado",
      actorId: skeletonActorId,
      x: 15,
      y: 15,
    });

    const scene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    expect(tokenOf(scene, tokenId)["actorLink"]).toBe(false);
  }, 30000);

  it("an explicit actorLink always beats the per-subtype default", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto chefe",
      actorId: skeletonActorId,
      actorLink: true,
      x: 16,
      y: 16,
    });

    const scene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    expect(tokenOf(scene, tokenId)["actorLink"]).toBe(true);
  }, 30000);

  it("actorDelta survives the UPDATE path (embedded Token doc:update)", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto atualizável",
      actorId: skeletonActorId,
      actorLink: false,
      x: 20,
      y: 20,
    });

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { actorDelta: { name: "Esqueleto marcado" } },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    const scene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    expect(tokenOf(scene, tokenId)["actorDelta"]).toEqual({ name: "Esqueleto marcado" });
  }, 30000);

  // -------------------------------------------------------------------------
  // The product ask
  // -------------------------------------------------------------------------

  it("damage on one unlinked skeleton leaves the other one — and the base Actor — untouched", async () => {
    const third = await createToken(gm, sceneId, {
      name: "Esqueleto 3",
      actorId: skeletonActorId,
      actorLink: false,
      x: 100,
      y: 100,
    });
    const fourth = await createToken(gm, sceneId, {
      name: "Esqueleto 4",
      actorId: skeletonActorId,
      actorLink: false,
      x: 200,
      y: 200,
    });

    const ack = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId: third,
      diff: { "system.attributes.hp.value": 0 },
    });
    expect(ack["ok"]).toBe(true);

    const documents = await snapshotFor(ctx, ctx.gmToken);
    const scene = firstDocument(documents, "Scene", sceneId);
    const baseActor = firstDocument(documents, "Actor", skeletonActorId);
    expect(baseActor).toBeDefined();

    expect(tokenHp(tokenOf(scene, third), baseActor as Record<string, unknown>)).toBe(0);
    expect(tokenHp(tokenOf(scene, fourth), baseActor as Record<string, unknown>)).toBe(20);
    expect(actorHp(baseActor)).toBe(20);
  }, 30000);

  it("the synthetic TokenActor is never a row in the actors table", async () => {
    const before = countActorRows(ctx);

    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto efêmero",
      actorId: skeletonActorId,
      actorLink: false,
      x: 300,
      y: 300,
    });
    const ack = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId,
      diff: { "system.attributes.hp.value": 3, name: "Esqueleto efêmero" },
    });
    expect(ack["ok"]).toBe(true);

    expect(countActorRows(ctx)).toBe(before);
  }, 30000);

  it("a LINKED token still mutates the world Actor, and its siblings follow", async () => {
    const first = await createToken(gm, sceneId, {
      name: "Heroína (sala 1)",
      actorId: heroActorId,
      actorLink: true,
      x: 400,
      y: 400,
    });
    const second = await createToken(gm, sceneId, {
      name: "Heroína (sala 2)",
      actorId: heroActorId,
      actorLink: true,
      x: 500,
      y: 500,
    });

    const ack = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId: first,
      diff: { "system.attributes.hp.value": 24 },
    });
    expect(ack["ok"]).toBe(true);

    const documents = await snapshotFor(ctx, ctx.gmToken);
    const scene = firstDocument(documents, "Scene", sceneId);
    const baseActor = firstDocument(documents, "Actor", heroActorId) as Record<string, unknown>;

    expect(actorHp(baseActor)).toBe(24);
    expect(tokenHp(tokenOf(scene, first), baseActor)).toBe(24);
    expect(tokenHp(tokenOf(scene, second), baseActor)).toBe(24);
    // ...and no delta was invented on the way.
    expect(tokenOf(scene, first)["actorDelta"]).toEqual({});
  }, 30000);

  it("the effective TokenActor carries derived stats, like the world Actor does", async () => {
    // A `character`, because that is the subtype the pf2e pipeline definitely
    // derives — asserting against a subtype with no registered DeriveSteps
    // would be a test that passes by finding nothing.
    const tokenId = await createToken(gm, sceneId, {
      name: "Heroína derivada",
      actorId: heroActorId,
      actorLink: false,
      x: 600,
      y: 600,
    });
    const ack = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId,
      diff: { "system.attributes.hp.value": 9 },
    });
    expect(ack["ok"]).toBe(true);

    const documents = await snapshotFor(ctx, ctx.gmToken);
    const scene = firstDocument(documents, "Scene", sceneId);
    const baseActor = firstDocument(documents, "Actor", heroActorId) as Record<string, unknown>;
    const effective = applyActorDelta(baseActor, tokenOf(scene, tokenId)["actorDelta"]);

    // The world Actor is derived (that is the premise of this assertion)...
    expect((baseActor["system"] as Record<string, unknown>)["derived"]).toBeDefined();
    // ...and so is the actor this token plays with. A token reading raw
    // numbers is a token whose sheet is wrong.
    expect((effective["system"] as Record<string, unknown>)["derived"]).toBeDefined();
  }, 30000);

  // -------------------------------------------------------------------------
  // Permission — the inherited token→actor gate, not a new predicate
  // -------------------------------------------------------------------------

  it("a player without OWNER on the base Actor cannot mutate that token's delta", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto protegido",
      actorId: skeletonActorId,
      actorLink: false,
      x: 700,
      y: 700,
    });

    const player = await connected(ctx, ctx.playerToken);
    try {
      const ack = await sendOp(player, "token:updateActor", {
        sceneId,
        tokenId,
        diff: { "system.attributes.hp.value": 999 },
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("PERMISSION_DENIED");
    } finally {
      player.disconnect();
    }

    const scene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    expect(tokenOf(scene, tokenId)["actorDelta"]).toEqual({});
  }, 30000);

  it("the OWNER of the base Actor may mutate their own token's actor", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Heroína desgarrada",
      actorId: heroActorId,
      actorLink: false,
      x: 800,
      y: 800,
    });

    const player = await connected(ctx, ctx.playerToken);
    try {
      const ack = await sendOp(player, "token:updateActor", {
        sceneId,
        tokenId,
        diff: { "system.attributes.hp.value": 7 },
      });
      expect(ack["ok"]).toBe(true);
    } finally {
      player.disconnect();
    }

    const documents = await snapshotFor(ctx, ctx.gmToken);
    const scene = firstDocument(documents, "Scene", sceneId);
    const baseActor = firstDocument(documents, "Actor", heroActorId) as Record<string, unknown>;
    expect(tokenHp(tokenOf(scene, tokenId), baseActor)).toBe(7);
    // The world Actor is NOT where an unlinked token's damage lands (REQ-DOC-034).
    expect(actorHp(baseActor)).toBe(24);
  }, 30000);

  it("a player never receives an actorDelta — the monster's hit points are not public (REQ-DOC-062)", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto ferido",
      actorId: skeletonActorId,
      actorLink: false,
      x: 1000,
      y: 1000,
    });
    await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId,
      diff: { "system.attributes.hp.value": 2 },
    });

    // The GM sees it...
    const gmScene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    expect(tokenOf(gmScene, tokenId)["actorDelta"]).not.toEqual({});

    // ...and the player, who cannot even receive the Esqueleto Actor
    // (REQ-NET-096), must not get its hit points smuggled inside the Scene.
    const playerDocuments = await snapshotFor(ctx, ctx.playerToken);
    expect((playerDocuments["Actor"] ?? []).some((a) => a["_id"] === skeletonActorId)).toBe(false);

    const playerScene = firstDocument(playerDocuments, "Scene", sceneId);
    const playerTokens = playerScene?.["tokens"] as Record<string, unknown>[];
    for (const t of playerTokens) {
      expect(t["actorDelta"]).toEqual({});
    }
  }, 30000);

  it("a LIVE broadcast never carries the delta to a player either — not even a token drag", async () => {
    // The snapshot is the easy path to remember. The live emit is the one that
    // leaked for the HP indicator, and `token:move` broadcasts the WHOLE scene.
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto móvel",
      actorId: skeletonActorId,
      actorLink: false,
      x: 1100,
      y: 1100,
    });
    await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId,
      diff: { "system.attributes.hp.value": 1 },
    });

    const player = await connected(ctx, ctx.playerToken);
    const seen: Record<string, unknown>[] = [];
    player.on("op", (env: Record<string, unknown>) => {
      seen.push(env);
    });

    try {
      const ack = await sendOp(gm, "token:move", { sceneId, tokenId, x: 1200, y: 1200 });
      expect(ack["ok"]).toBe(true);
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      player.disconnect();
    }

    const scenesSeen = seen
      .filter((env) => env["type"] === "doc:update")
      .flatMap((env) => {
        const payload = env["payload"] as Record<string, unknown>;
        if (payload["documentType"] !== "Scene") return [];
        return (payload["documents"] as Record<string, unknown>[]) ?? [];
      });
    expect(scenesSeen.length).toBeGreaterThan(0);

    for (const s of scenesSeen) {
      for (const t of (s["tokens"] ?? []) as Record<string, unknown>[]) {
        expect(t["actorDelta"]).toEqual({});
      }
    }
  }, 30000);

  it("rejects an unknown token or scene instead of writing anywhere", async () => {
    const noScene = await sendOp(gm, "token:updateActor", {
      sceneId: "0000000000000000",
      tokenId: "0000000000000000",
      diff: { "system.attributes.hp.value": 1 },
    });
    expect(noScene["ok"]).toBe(false);
    expect(noScene["code"]).toBe("NOT_FOUND");

    const noToken = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId: "0000000000000000",
      diff: { "system.attributes.hp.value": 1 },
    });
    expect(noToken["ok"]).toBe(false);
    expect(noToken["code"]).toBe("NOT_FOUND");
  }, 30000);

  it("rejects a token with no Actor behind it — there is nothing to mutate", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Cenário",
      actorLink: false,
      x: 900,
      y: 900,
    });
    const ack = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId,
      diff: { "system.attributes.hp.value": 1 },
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  }, 30000);
});
