/**
 * effect-derived-live.test.ts — an effect the SERVER embeds (Mount, `effect:apply`) re-derives the actor's
 * `system.derived` in the SAME broadcast (L3 re-run, D4).
 *
 * The sheet reads the saves from `system.derived`. The two handlers wrote the embedded effect with a plain
 * `store.update` and never ran the derivation, so the open sheet listed the effect (-2 Reflex) while the number kept
 * the old value until a reload re-derived it. Real pf2e system module and the shipped "Montado" effect.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { DocumentStore } from "../documents/store.js";
import { CompendiumService } from "../compendium/service.js";
import { recomputeDerivedIfNeeded } from "../documents/derive.js";
import { MOUNTED_EFFECT_REF, PROTOCOL_VERSION } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

const PACKS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../external/fusion-systems-2e/systems/pf2e/packs",
);
const RIDER_ACTOR = "riderActor000001";
const MOUNT_ACTOR = "mountActor000001";
const RIDER = "riderToken000001";
const MOUNT = "mountToken000001";
const SCENE_ID = "sceneDerived0001";

type Rec = Record<string, unknown>;

function fighter(name: string, size: string, extra: Rec = {}): Rec {
  return {
    name,
    type: "character",
    ownership: { default: 3 },
    system: {
      systemVersion: "0.1.0",
      level: { value: 5 },
      abilities: {
        str: { value: 18, mod: 0 },
        dex: { value: 16, mod: 0 },
        con: { value: 14, mod: 0 },
        int: { value: 10, mod: 0 },
        wis: { value: 12, mod: 0 },
        cha: { value: 8, mod: 0 },
      },
      attributes: {
        hp: { value: 75, max: 75, temp: 0 },
        ac: { value: 10 },
        speed: { value: 25, otherSpeeds: [] },
        dying: { value: 0, max: 4 },
        wounded: { value: 0 },
        doomed: { value: 0 },
        iwr: { immunities: [], weaknesses: [], resistances: [] },
      },
      saves: { fortitude: { rank: 2 }, reflex: { rank: 1 }, will: { rank: 2 } },
      perception: { rank: 2, senses: [] },
      skills: {},
      proficiencies: {
        classDC: { rank: 2 },
        weapons: { unarmed: 1, simple: 1, martial: 2, advanced: 0 },
        armor: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
      },
      resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
      details: { keyAbility: "str", level: 5 },
      traits: { rarity: "common", value: [], size: { value: size } },
      ...extra,
    },
  };
}

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  store: DocumentStore;
  port: number;
  worldId: string;
  gmToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const dataDir = join(
    tmpdir(),
    `fusion-effderive-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-effderive-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const author = { userId: gm.id };
  const seeds: [string, Rec][] = [
    [RIDER_ACTOR, fighter("Rider", "sm")],
    [
      MOUNT_ACTOR,
      fighter("Mount", "med", {
        companionKind: "animalCompanion",
        masterActorId: RIDER_ACTOR,
        companion: { typeSlug: "x" },
      }),
    ],
  ];
  for (const [id, doc] of seeds) {
    const created = store.create("actors", { _id: id, ...doc }, author);
    // Born with the derived block, as every real actor is (doc:create derives).
    recomputeDerivedIfNeeded({ store, systemModule: pf2eSystem }, "Actor", created, author);
  }
  const token = (id: string, name: string, actorId: string, x: number) => ({
    _id: id,
    name,
    actorId,
    hidden: false,
    x,
    y: 500,
  });
  store.create(
    "scenes",
    {
      _id: SCENE_ID,
      name: "Cena",
      active: true,
      grid: { type: "square", size: 100, distance: 5, units: "ft" },
      tokens: [token(RIDER, "Rider", RIDER_ACTOR, 500), token(MOUNT, "Mount", MOUNT_ACTOR, 600)],
    },
    author,
  );

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Effect Derive World", systemId: "pf2e" },
  });
  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });
  const compendium = new CompendiumService();
  compendium.discoverPacks(PACKS, "pf2e");
  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
    compendiumService: compendium,
    systemId: "pf2e",
    systemModule: pf2eSystem,
  });
  const port = await reserveFreePort();
  await fastify.listen({ port, host: "127.0.0.1" });
  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    store,
    port: listeningPort(fastify),
    worldId,
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
  return new Promise<Rec>((resolve, reject) => {
    socket.emit(
      "op",
      { type, ts: Date.now(), payload, requestId: Math.random().toString(36).slice(2) },
      (ack: unknown) => {
        if (!ack || typeof ack !== "object") reject(new Error("No ack"));
        else resolve(ack as Rec);
      },
    );
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

/** Every Actor doc this socket hears for `actorId` (collected; read the last one after the ack). */
function collectActorDocs(socket: ClientSocket, actorId: string): Rec[] {
  const docs: Rec[] = [];
  socket.on("op", (envelope: Rec) => {
    if (envelope["type"] !== "doc:update") return;
    const payload = envelope["payload"] as { documentType?: string; documents?: Rec[] };
    if (payload.documentType !== "Actor") return;
    for (const d of payload.documents ?? []) if (d["_id"] === actorId) docs.push(d);
  });
  return docs;
}

const reflexTotal = (doc: Rec): number =>
  (doc["system"] as { derived: { saves: { reflex: { total: number } } } }).derived.saves.reflex
    .total;

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 200));

describe("a server-embedded effect re-derives the actor in the same broadcast (L3 D4)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let baseReflex: number;

  beforeEach(async () => {
    ctx = await buildCtx();
    gm = await connect(ctx.port, ctx.worldId, ctx.gmToken);
    baseReflex = reflexTotal(ctx.store.get("actors", RIDER_ACTOR));
  }, 20_000);

  afterEach(async () => {
    gm.disconnect();
    await ctx.socketManager.close();
    await ctx.fastify.close();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("mount:mount: the broadcast actor carries Reflex -2; dismount takes it back", async () => {
    const docs = collectActorDocs(gm, RIDER_ACTOR);
    const ack = await sendOp(gm, "mount:mount", { riderTokenId: RIDER, mountTokenId: MOUNT });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    await settle();
    expect(reflexTotal(docs[docs.length - 1] as Rec)).toBe(baseReflex - 2);
    expect(reflexTotal(ctx.store.get("actors", RIDER_ACTOR))).toBe(baseReflex - 2);

    const down = await sendOp(gm, "mount:dismount", {
      riderTokenId: RIDER,
      to: { x: 800, y: 800 },
    });
    expect(down["ok"], JSON.stringify(down)).toBe(true);
    await settle();
    expect(reflexTotal(docs[docs.length - 1] as Rec)).toBe(baseReflex);
  });

  it("effect:apply: the broadcast actor carries the effect modifier", async () => {
    const docs = collectActorDocs(gm, RIDER_ACTOR);
    const ack = await sendOp(gm, "effect:apply", {
      sourceActorId: RIDER_ACTOR,
      targetActorIds: [RIDER_ACTOR],
      effect: { ...MOUNTED_EFFECT_REF },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    await settle();
    expect(reflexTotal(docs[docs.length - 1] as Rec)).toBe(baseReflex - 2);
  });
});
