/**
 * mount-effect-socket.test.ts — the "Montado" effect follows `mount:mount` / `mount:dismount`
 * (BHR-F5-04, REQ-BHR-177..178).
 *
 * The server owns the rule (a button hidden on the sheet protects nothing): climbing onto a mount
 * embeds the "Montado" effect on the RIDER's actor (the −2 circumstance to Reflex saves is the
 * effect's own rule, evaluated by the sheet); stepping down removes it and nothing else. A refused
 * mount leaves no effect behind. The effect content is read from the pack on the server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { DocumentStore } from "../documents/store.js";
import { CompendiumService } from "../compendium/service.js";
import { MOUNTED_EFFECT_REF, PROTOCOL_VERSION } from "@fusion/shared";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

const LESHY_ACTOR = "leshyActor000001";
const ANTELOPE_ACTOR = "antelopeActor001";
const BEAR_ACTOR = "bearActor0000001";
const LESHY = "leshyToken000001";
const ANTELOPE = "antelopeToken001";
const BEAR = "bearToken00000001";
const SCENE_ID = "sceneMount000001";
const OTHER_EFFECT_SRC = "other-effect-src";
const CELL = 100;
const at = (i: number, j: number) => ({ x: i * CELL, y: j * CELL });

interface Ctx {
  dataDir: string;
  packRoot: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  store: DocumentStore;
  port: number;
  worldId: string;
  p1Token: string;
  p2Token: string;
  gmToken: string;
}

function buildCompendium(): { compendium: CompendiumService; packRoot: string } {
  const packRoot = join(
    tmpdir(),
    `fusion-mount-effect-pack-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  const dir = join(packRoot, "effects");
  mkdirSync(dir, { recursive: true });
  const documents = [
    {
      _id: MOUNTED_EFFECT_REF.docId,
      name: "Effect: Mounted",
      type: "effect",
      flags: { fusion: { sourceId: MOUNTED_EFFECT_REF.docId } },
      system: { slug: "effect-mounted", fusion: { expiryTemplate: { on: "never" } } },
    },
  ];
  writeFileSync(
    join(dir, "pack.json"),
    JSON.stringify({
      id: MOUNTED_EFFECT_REF.packId,
      label: "effects (test)",
      documentType: "Item",
      systemId: "test",
      indexFields: ["system.slug"],
      license: { license: "custom", attribution: "test fixture", reservedNotice: "" },
      audience: "all",
      source: { repo: null, version: null, importerVersion: "test" },
      documentCount: documents.length,
      generatedAt: new Date(0).toISOString(),
      schemaVersion: 1,
    }),
    "utf8",
  );
  writeFileSync(join(dir, "documents.json"), JSON.stringify(documents), "utf8");
  const compendium = new CompendiumService();
  compendium.registerPackDir(dir);
  return { compendium, packRoot };
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = join(
    tmpdir(),
    `fusion-mount-effect-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-mount-effect-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: p1 } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
  });
  const { user: p2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
  });
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const p1Login = await authService.login({
    userId: p1.id,
    password: "player1-pass",
    ip: "127.0.0.1",
  });
  const p2Login = await authService.login({
    userId: p2.id,
    password: "player2-pass",
    ip: "127.0.0.1",
  });

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const author = { userId: gm.id };
  const actor = (
    id: string,
    name: string,
    size: string,
    extra: Record<string, unknown> = {},
    items: unknown[] = [],
  ) =>
    store.create(
      "actors",
      {
        _id: id,
        name,
        type: "character",
        ownership: { default: 2, [p1.id]: 3 },
        items,
        system: { traits: { size: { value: size } }, ...extra },
      },
      author,
    );
  const companion = {
    companionKind: "animalCompanion",
    masterActorId: LESHY_ACTOR,
    companion: { typeSlug: "x" },
  };
  // The rider already carries an unrelated effect: dismounting must not touch it.
  actor(LESHY_ACTOR, "Leshy", "sm", {}, [
    {
      _id: "otherEffect00001",
      name: "Outro efeito",
      type: "effect",
      system: { fusion: { origin: { actorId: LESHY_ACTOR, itemSourceId: OTHER_EFFECT_SRC } } },
    },
  ]);
  actor(ANTELOPE_ACTOR, "Antilope", "med", companion);
  actor(BEAR_ACTOR, "Urso", "sm", companion);
  const token = (id: string, name: string, actorId: string, pos: { x: number; y: number }) => ({
    _id: id,
    name,
    actorId,
    hidden: false,
    ...pos,
  });
  store.create(
    "scenes",
    {
      _id: SCENE_ID,
      name: "Cena",
      active: true,
      grid: { type: "square", size: CELL, distance: 5, units: "ft" },
      tokens: [
        token(LESHY, "Leshy", LESHY_ACTOR, at(5, 5)),
        token(ANTELOPE, "Antilope", ANTELOPE_ACTOR, at(6, 5)),
        token(BEAR, "Urso", BEAR_ACTOR, at(4, 5)),
      ],
    },
    author,
  );

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Mount Effect World", systemId: "stub" },
  });
  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });
  const { compendium, packRoot } = buildCompendium();
  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
    compendiumService: compendium,
  });
  const port = await reserveFreePort();
  await fastify.listen({ port, host: "127.0.0.1" });
  return {
    dataDir,
    packRoot,
    fusionDb,
    fastify,
    socketManager,
    store,
    port: listeningPort(fastify),
    worldId,
    p1Token: p1Login.accessToken,
    p2Token: p2Login.accessToken,
    gmToken: gmLogin.accessToken,
  };
}

function connect(port: number, worldId: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    socket.once("connect", () => {
      socket.once("op", () => resolve(socket));
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function sendOp(socket: ClientSocket, type: string, payload: unknown) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.emit(
      "op",
      { type, ts: Date.now(), payload, requestId: Math.random().toString(36).slice(2) },
      (ack: unknown) => {
        if (!ack || typeof ack !== "object") reject(new Error("No ack"));
        else resolve(ack as Record<string, unknown>);
      },
    );
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

/** The next Actor `doc:update` of `actorId` this socket receives. */
function nextActorUpdate(
  socket: ClientSocket,
  actorId: string,
  accept: (doc: Record<string, unknown>) => boolean = () => true,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Record<string, unknown>): void => {
      if (envelope["type"] !== "doc:update") return;
      const payload = envelope["payload"] as { documentType?: string; documents?: unknown[] };
      if (payload.documentType !== "Actor") return;
      const doc = (payload.documents ?? []).find(
        (d) => (d as Record<string, unknown>)["_id"] === actorId,
      );
      if (!doc || !accept(doc as Record<string, unknown>)) return;
      socket.off("op", handler);
      resolve(doc as Record<string, unknown>);
    };
    socket.on("op", handler);
    setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("no Actor doc:update"));
    }, 3000);
  });
}

describe("the Mounted effect follows Mount / Dismount (BHR-F5-04)", () => {
  let ctx: Ctx;
  let p1: ClientSocket;
  let p2: ClientSocket;

  beforeEach(async () => {
    ctx = await buildCtx();
    [p1, p2] = await Promise.all([
      connect(ctx.port, ctx.worldId, ctx.p1Token),
      connect(ctx.port, ctx.worldId, ctx.p2Token),
    ]);
  }, 15_000);

  afterEach(async () => {
    p1.disconnect();
    p2.disconnect();
    await ctx.socketManager.close();
    await ctx.fastify.close();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
    rmSync(ctx.packRoot, { recursive: true, force: true });
  });

  const mountedEffects = (actorId: string): Record<string, unknown>[] => {
    const items = (ctx.store.get("actors", actorId)["items"] ?? []) as Record<string, unknown>[];
    return items.filter((item) => {
      const fusion = (item["system"] as Record<string, unknown>)["fusion"] as
        | Record<string, unknown>
        | undefined;
      const origin = fusion?.["origin"] as Record<string, unknown> | undefined;
      return origin?.["itemSourceId"] === MOUNTED_EFFECT_REF.docId;
    });
  };

  it("mounting embeds the Montado effect on the RIDER only, and every client hears the actor change", async () => {
    const heard = nextActorUpdate(p2, LESHY_ACTOR);
    const ack = await sendOp(p1, "mount:mount", { riderTokenId: LESHY, mountTokenId: ANTELOPE });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const effects = mountedEffects(LESHY_ACTOR);
    expect(effects).toHaveLength(1);
    expect(effects[0]?.["type"]).toBe("effect");
    expect(effects[0]?.["name"]).toBe("Effect: Mounted");
    expect(mountedEffects(ANTELOPE_ACTOR)).toHaveLength(0);

    const doc = await heard;
    expect((doc["items"] as unknown[]).length).toBe(2);
  });

  it("dismounting removes the Montado effect and leaves the other effects of the rider alone", async () => {
    await sendOp(p1, "mount:mount", { riderTokenId: LESHY, mountTokenId: ANTELOPE });
    expect(mountedEffects(LESHY_ACTOR)).toHaveLength(1);

    const ack = await sendOp(p1, "mount:dismount", { riderTokenId: LESHY, to: at(6, 4) });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    expect(mountedEffects(LESHY_ACTOR)).toHaveLength(0);
    const names = ((ctx.store.get("actors", LESHY_ACTOR)["items"] ?? []) as { name: string }[]).map(
      (i) => i.name,
    );
    expect(names).toEqual(["Outro efeito"]);
  });

  it("a refused mount (same size as the rider) leaves no effect behind", async () => {
    const ack = await sendOp(p1, "mount:mount", { riderTokenId: LESHY, mountTokenId: BEAR });
    expect(ack["ok"]).toBe(false);
    expect(mountedEffects(LESHY_ACTOR)).toHaveLength(0);
  });

  it("mounting, dismounting and mounting again leaves exactly one effect", async () => {
    await sendOp(p1, "mount:mount", { riderTokenId: LESHY, mountTokenId: ANTELOPE });
    await sendOp(p1, "mount:dismount", { riderTokenId: LESHY, to: at(6, 4) });
    await sendOp(p1, "mount:mount", { riderTokenId: LESHY, mountTokenId: ANTELOPE });
    expect(mountedEffects(LESHY_ACTOR)).toHaveLength(1);
  });

  describe("the GM moving the mounted rider takes him off the mount (BHR-F5-03 x F5-04 x F5-05)", () => {
    const moveVia: Array<[string, (gm: ClientSocket) => Promise<Record<string, unknown>>]> = [
      [
        "doc:update",
        (gm) =>
          sendOp(gm, "doc:update", {
            documentType: "Token",
            updates: [{ _id: LESHY, diff: at(2, 2), embedded: { type: "Token", id: SCENE_ID } }],
          }),
      ],
      [
        "token:move",
        (gm) => sendOp(gm, "token:move", { sceneId: SCENE_ID, tokenId: LESHY, ...at(2, 2) }),
      ],
    ];

    it.each(moveVia)(
      "through %s: the Montado effect leaves the rider and the group MAP is republished",
      async (_n, move) => {
        const gm = await connect(ctx.port, ctx.worldId, ctx.gmToken);
        try {
          await sendOp(p1, "mount:mount", { riderTokenId: LESHY, mountTokenId: ANTELOPE });
          expect(mountedEffects(LESHY_ACTOR)).toHaveLength(1);

          const counter = ctx.socketManager.mapCounterFor(ctx.worldId);
          if (counter === undefined) throw new Error("no MAP counter for the world");
          const republish = vi.spyOn(counter, "republishScene");
          // A late mount broadcast may still be in flight: wait for the one WITHOUT the effect.
          const heard = nextActorUpdate(
            p2,
            LESHY_ACTOR,
            (d) => (d["items"] as unknown[]).length === 1,
          );

          const ack = await move(gm);
          expect(ack["ok"], JSON.stringify(ack)).toBe(true);

          expect(mountedEffects(LESHY_ACTOR)).toHaveLength(0);
          const names = (
            (ctx.store.get("actors", LESHY_ACTOR)["items"] ?? []) as { name: string }[]
          ).map((i) => i.name);
          expect(names).toEqual(["Outro efeito"]);
          expect(republish).toHaveBeenCalledWith(SCENE_ID);
          const doc = await heard;
          expect((doc["items"] as unknown[]).length).toBe(1);
        } finally {
          gm.disconnect();
        }
      },
    );
  });
});
