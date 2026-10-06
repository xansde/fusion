/**
 * effect-apply-socket.test.ts — `effect:apply` over the real socket
 * (BHR-F4-08, REQ-BHR-102..105, REQ-SYS-163, DEC-BHR-09).
 *
 * The rule under test is PERMISSION, decided on the server (DC-06): the GM
 * applies anywhere; a player must own `sourceActorId` AND every target must be
 * (a) the source itself, (b) linked to it by a companion link in either
 * direction, or (c) in the `targetSnapshot` of a message the player may cite,
 * and then only for an effect flagged `system.fusion.allowOnTarget`. The
 * effect content is always read from the pack on the server — the client only
 * names `{ packId, docId }`.
 *
 * A fixture pack carries the effects so the assertion never rests on a real
 * pack table; one case also runs the real bear Apoio on the `pf2e-sf2e`
 * composite world the table plays in.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { pf2eSf2eSystem } from "@fusion/system-pf2e-sf2e";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { DocumentStore } from "../documents/store.js";
import { CompendiumService, resolveSystemPacksDir } from "../compendium/service.js";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { reserveFreePort, listeningPort } from "./helpers/ports.js";

const HUNTER_ID = "hunterActor00001"; // p1's character
const BEAR_ID = "bearActor0000001"; // p1's companion (linked to the hunter)
const FOE_ID = "foeActor00000001"; // an NPC on the scene
const ALLY_ID = "allyActor0000001"; // p2's character
const FOE_TOKEN = "foeToken00000001";
const HIDDEN_TOKEN = "hiddenToken00001";
const ALLY_TOKEN = "allyToken0000001";
const MSG_ID = "msgHunter0000001";
const MSG_FOREIGN_ID = "msgForeign000001";

const PACK_ID = "test.effects";
const PLAIN_EFFECT = "effectPlain00001";
const ALLOW_EFFECT = "effectAllow00001";
const NOT_AN_EFFECT = "notAnEffect00001";
const UNREFERENCED_EFFECT = "effectUnref0001";
const BEAR_TYPE = "companionType001";
const HIDDEN_PACK_ID = "test.hidden-effects";
const HIDDEN_EFFECT = "effectHidden0001";

interface Ctx {
  dataDir: string;
  packRoot: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  store: DocumentStore;
  port: number;
  worldId: string;
  gmToken: string;
  p1Token: string;
  p2Token: string;
}

function writePack(
  packDir: string,
  id: string,
  audience: "all" | "gm",
  documents: unknown[],
): void {
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, "pack.json"),
    JSON.stringify({
      id,
      label: `${id} (test)`,
      documentType: "Item",
      systemId: "test",
      indexFields: ["system.slug"],
      license: { license: "custom", attribution: "test fixture", reservedNotice: "" },
      audience,
      source: { repo: null, version: null, importerVersion: "test" },
      documentCount: documents.length,
      generatedAt: new Date(0).toISOString(),
      schemaVersion: 1,
    }),
    "utf8",
  );
  writeFileSync(join(packDir, "documents.json"), JSON.stringify(documents), "utf8");
}

const sourceFlags = (sourceId: string) => ({ fusion: { sourceId } });

function buildFixtureCompendium(): { compendium: CompendiumService; packRoot: string } {
  const packRoot = join(
    tmpdir(),
    `fusion-effect-apply-pack-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  writePack(join(packRoot, "effects"), PACK_ID, "all", [
    {
      _id: PLAIN_EFFECT,
      name: "Plain",
      type: "effect",
      flags: sourceFlags("plain-src"),
      // The pack's own duration: what the server stamps, whatever the client sends.
      system: { fusion: { expiryTemplate: { on: "turn-start" } } },
    },
    {
      _id: ALLOW_EFFECT,
      name: "Allowed on target",
      type: "effect",
      flags: sourceFlags("allow-src"),
      system: { fusion: { allowOnTarget: true } },
    },
    { _id: NOT_AN_EFFECT, name: "A sword", type: "weapon", system: {} },
    {
      _id: UNREFERENCED_EFFECT,
      name: "Nobody references me",
      type: "effect",
      flags: sourceFlags("unref-src"),
      system: { fusion: {} },
    },
    {
      // A companion type whose Support is the plain effect (spec section 2.4).
      _id: BEAR_TYPE,
      name: "Bear",
      type: "companionType",
      system: {
        slug: "bear",
        support: { effectRef: { packId: PACK_ID, docId: PLAIN_EFFECT } },
      },
    },
  ]);
  // A pack the Mestre hides from players (REQ-CPD-071).
  writePack(join(packRoot, "hidden"), HIDDEN_PACK_ID, "gm", [
    {
      _id: HIDDEN_EFFECT,
      name: "Secret",
      type: "effect",
      flags: sourceFlags("hidden-src"),
      system: { fusion: {} },
    },
  ]);
  const compendium = new CompendiumService();
  compendium.registerPackDir(join(packRoot, "effects"));
  compendium.registerPackDir(join(packRoot, "hidden"));
  return { compendium, packRoot };
}

async function buildCtx(opts: { composite?: boolean } = {}): Promise<Ctx> {
  const dataDir = join(
    tmpdir(),
    `fusion-effect-apply-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-effect-apply-world";
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
  // p1 owns the hunter and its bear; p2 owns the ally; everyone observes everyone.
  store.create(
    "actors",
    {
      _id: HUNTER_ID,
      name: "Hunter",
      type: "character",
      ownership: { default: 2, [p1.id]: 3 },
      // The talents that reference effects (`system.fusion.effectRefs` are source ids).
      items: [
        {
          _id: "hunterTalent0001",
          name: "Talent",
          type: "feat",
          system: { fusion: { effectRefs: ["allow-src", "hidden-src"] } },
        },
      ],
    },
    author,
  );
  store.create(
    "actors",
    {
      _id: BEAR_ID,
      name: "Bear",
      type: "familiar",
      ownership: { default: 2, [p1.id]: 3 },
      system: {
        companionKind: "animalCompanion",
        masterActorId: HUNTER_ID,
        companion: { typeSlug: "bear" },
      },
    },
    author,
  );
  store.create(
    "actors",
    { _id: ALLY_ID, name: "Ally", type: "character", ownership: { default: 2, [p2.id]: 3 } },
    author,
  );
  store.create(
    "actors",
    { _id: FOE_ID, name: "Foe", type: "npc", ownership: { default: 2 } },
    author,
  );
  store.create(
    "scenes",
    {
      name: "Scene",
      active: true,
      tokens: [
        { _id: FOE_TOKEN, name: "Foe", actorId: FOE_ID, hidden: false },
        { _id: ALLY_TOKEN, name: "Ally", actorId: ALLY_ID, hidden: false },
        { _id: HIDDEN_TOKEN, name: "Hidden", actorId: FOE_ID, hidden: true },
      ],
    },
    author,
  );
  const snapshot = (tokenId: string, actorId: string) => ({ tokenId, actorId, sceneId: "s" });
  store.create(
    "chat_messages",
    {
      _id: MSG_ID,
      author: gm.id,
      timestamp: 1,
      speaker: { actorId: HUNTER_ID },
      content: "",
      flags: {
        fusion: {
          targetSnapshot: [snapshot(ALLY_TOKEN, ALLY_ID), snapshot(HIDDEN_TOKEN, FOE_ID)],
        },
      },
    },
    author,
  );
  // A roll by somebody p1 does NOT own: its snapshot must not be citable by p1.
  store.create(
    "chat_messages",
    {
      _id: MSG_FOREIGN_ID,
      author: gm.id,
      timestamp: 2,
      speaker: { actorId: ALLY_ID },
      content: "",
      flags: { fusion: { targetSnapshot: [snapshot(FOE_TOKEN, FOE_ID)] } },
    },
    author,
  );

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Effect Apply World", systemId: "stub" },
  });
  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });

  let compendium: CompendiumService;
  let packRoot = "";
  if (opts.composite) {
    compendium = new CompendiumService();
    for (const sourceSystemId of ["pf2e", "sf2e"]) {
      const dir = resolveSystemPacksDir(sourceSystemId);
      if (dir !== null) compendium.discoverPacks(dir, sourceSystemId);
    }
  } else {
    ({ compendium, packRoot } = buildFixtureCompendium());
  }
  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
    ...(opts.composite ? { systemId: "pf2e-sf2e", systemModule: pf2eSf2eSystem } : {}),
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
    gmToken: gmLogin.accessToken,
    p1Token: p1Login.accessToken,
    p2Token: p2Login.accessToken,
  };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
  if (ctx.packRoot !== "") rmSync(ctx.packRoot, { recursive: true, force: true });
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

const itemsOf = (store: DocumentStore, actorId: string): Record<string, unknown>[] => {
  const items = store.get("actors", actorId)["items"];
  // Only the embedded effects: the hunter also carries a talent (the effectRefs origin).
  return Array.isArray(items)
    ? (items as Record<string, unknown>[]).filter((i) => i["type"] === "effect")
    : [];
};

const fusionOf = (item: Record<string, unknown>): Record<string, unknown> =>
  (item["system"] as { fusion: Record<string, unknown> }).fusion;

describe("effect:apply over the socket (BHR-F4-08)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let p1: ClientSocket;
  let p2: ClientSocket;

  beforeEach(async () => {
    ctx = await buildCtx();
    [gm, p1, p2] = await Promise.all([
      connect(ctx.port, ctx.worldId, ctx.gmToken),
      connect(ctx.port, ctx.worldId, ctx.p1Token),
      connect(ctx.port, ctx.worldId, ctx.p2Token),
    ]);
  }, 15_000);

  afterEach(async () => {
    gm.disconnect();
    p1.disconnect();
    p2.disconnect();
    await teardown(ctx);
  });

  const apply = (over: Record<string, unknown> = {}) => ({
    sourceActorId: BEAR_ID,
    targetActorIds: [HUNTER_ID],
    effect: { packId: PACK_ID, docId: PLAIN_EFFECT },
    ...over,
  });

  it("the companion's owner applies from the bear onto the hunter, with origin, start and expiry.ownerActorId stored", async () => {
    const ack = await sendOp(
      p1,
      "effect:apply",
      apply({ expiry: { on: "turn-start", ownerActorId: HUNTER_ID } }),
    );
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    const items = itemsOf(ctx.store, HUNTER_ID);
    expect(items).toHaveLength(1);
    const item = items[0] as Record<string, unknown>;
    expect(item["type"]).toBe("effect");
    expect(item["name"]).toBe("Plain");
    expect(item["_id"]).not.toBe(PLAIN_EFFECT); // a fresh embedded id, not the pack's
    const fusion = fusionOf(item);
    expect(fusion["origin"]).toMatchObject({ actorId: BEAR_ID });
    expect(fusion["startedAt"]).toEqual({ combatId: null, round: null });
    expect(fusion["expiry"]).toEqual({ on: "turn-start", ownerActorId: HUNTER_ID });
    // the pack's own data is never written back
    expect(itemsOf(ctx.store, BEAR_ID)).toHaveLength(0);
  });

  it("works in the other direction too: the hunter applies onto its own companion, and onto itself", async () => {
    const toBear = await sendOp(
      p1,
      "effect:apply",
      apply({ sourceActorId: HUNTER_ID, targetActorIds: [BEAR_ID] }),
    );
    expect(toBear["ok"], JSON.stringify(toBear)).toBe(true);
    const toSelf = await sendOp(
      p1,
      "effect:apply",
      apply({ sourceActorId: HUNTER_ID, targetActorIds: [HUNTER_ID] }),
    );
    expect(toSelf["ok"], JSON.stringify(toSelf)).toBe(true);
    expect(itemsOf(ctx.store, BEAR_ID)).toHaveLength(1);
    expect(itemsOf(ctx.store, HUNTER_ID)).toHaveLength(1);
  });

  it("denies a player applying onto another player's actor without a messageId, and writes nothing", async () => {
    const denied = await sendOp(p1, "effect:apply", apply({ targetActorIds: [ALLY_ID] }));
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(itemsOf(ctx.store, ALLY_ID)).toHaveLength(0);
  });

  it("denies a player who does not own sourceActorId, even onto a linked actor", async () => {
    const denied = await sendOp(p2, "effect:apply", apply());
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(itemsOf(ctx.store, HUNTER_ID)).toHaveLength(0);
  });

  it("with a messageId, an effect WITHOUT allowOnTarget is denied; WITH it, the snapshot target is accepted", async () => {
    const plain = await sendOp(
      p1,
      "effect:apply",
      apply({ sourceActorId: HUNTER_ID, targetActorIds: [ALLY_ID], messageId: MSG_ID }),
    );
    expect(plain).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(itemsOf(ctx.store, ALLY_ID)).toHaveLength(0);

    const allowed = await sendOp(
      p1,
      "effect:apply",
      apply({
        sourceActorId: HUNTER_ID,
        targetActorIds: [ALLY_ID],
        messageId: MSG_ID,
        effect: { packId: PACK_ID, docId: ALLOW_EFFECT },
      }),
    );
    expect(allowed["ok"], JSON.stringify(allowed)).toBe(true);
    expect(itemsOf(ctx.store, ALLY_ID)).toHaveLength(1);
  });

  it("a target only reachable through a token hidden from the player, and another player's message, are denied", async () => {
    const allow = { packId: PACK_ID, docId: ALLOW_EFFECT };
    // FOE_ID is in MSG_ID's snapshot only through HIDDEN_TOKEN, hidden from p1.
    const hiddenOnly = await sendOp(
      p1,
      "effect:apply",
      apply({
        sourceActorId: HUNTER_ID,
        targetActorIds: [FOE_ID],
        messageId: MSG_ID,
        effect: allow,
      }),
    );
    expect(hiddenOnly).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });

    // MSG_FOREIGN_ID was spoken by an actor p1 does not own.
    const foreignMessage = await sendOp(
      p1,
      "effect:apply",
      apply({
        sourceActorId: HUNTER_ID,
        targetActorIds: [FOE_ID],
        messageId: MSG_FOREIGN_ID,
        effect: allow,
      }),
    );
    expect(foreignMessage).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(itemsOf(ctx.store, FOE_ID)).toHaveLength(0);
  });

  it("the Mestre applies onto any actor, without owning the source", async () => {
    const ack = await sendOp(
      gm,
      "effect:apply",
      apply({ sourceActorId: ALLY_ID, targetActorIds: [FOE_ID, HUNTER_ID] }),
    );
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    expect(itemsOf(ctx.store, FOE_ID)).toHaveLength(1);
    expect(itemsOf(ctx.store, HUNTER_ID)).toHaveLength(1);
  });

  it("is all-or-nothing: one forbidden target among several writes nothing", async () => {
    const denied = await sendOp(
      p1,
      "effect:apply",
      apply({ targetActorIds: [HUNTER_ID, ALLY_ID] }),
    );
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(itemsOf(ctx.store, HUNTER_ID)).toHaveLength(0);
  });

  it("a player cannot make an unrelated actor the clock owner of the effect", async () => {
    const denied = await sendOp(
      p1,
      "effect:apply",
      apply({ expiry: { on: "turn-start", ownerActorId: ALLY_ID } }),
    );
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(itemsOf(ctx.store, HUNTER_ID)).toHaveLength(0);
  });

  it("a player cannot forge the companion link by turning an owned character into a familiar", async () => {
    const forged = await sendOp(p1, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: HUNTER_ID,
          expectedVersion: (ctx.store.get("actors", HUNTER_ID)["_stats"] as { version: number })
            .version,
          diff: { type: "familiar", system: { masterActorId: ALLY_ID } },
        },
      ],
    });
    expect(forged).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(ctx.store.get("actors", HUNTER_ID)["type"]).toBe("character");

    const denied = await sendOp(
      p1,
      "effect:apply",
      apply({ sourceActorId: HUNTER_ID, targetActorIds: [ALLY_ID] }),
    );
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(itemsOf(ctx.store, ALLY_ID)).toHaveLength(0);
  });

  it("refuses a pack document that is not an effect, and a missing one", async () => {
    const notEffect = await sendOp(
      gm,
      "effect:apply",
      apply({ effect: { packId: PACK_ID, docId: NOT_AN_EFFECT } }),
    );
    expect(notEffect).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    const missing = await sendOp(
      gm,
      "effect:apply",
      apply({ effect: { packId: PACK_ID, docId: "doesNotExist0001" } }),
    );
    expect(missing).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(itemsOf(ctx.store, HUNTER_ID)).toHaveLength(0);
  });

  it("I-1: the expiry comes from the pack's expiryTemplate; the player only picks ownerActorId", async () => {
    // Rule (D-B10): Apoio ends at the start of the owner's next turn. A player
    // asking for `never` must not make it permanent.
    const ack = await sendOp(
      p1,
      "effect:apply",
      apply({ expiry: { on: "never", remainingRounds: 99, ownerActorId: HUNTER_ID } }),
    );
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const item = itemsOf(ctx.store, HUNTER_ID).find((i) => i["type"] === "effect");
    expect(fusionOf(item as Record<string, unknown>)["expiry"]).toEqual({
      on: "turn-start",
      ownerActorId: HUNTER_ID,
    });
  });

  it("I-1: without a client expiry the template is still stamped, clocked on the source", async () => {
    const ack = await sendOp(p1, "effect:apply", apply());
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const item = itemsOf(ctx.store, HUNTER_ID).find((i) => i["type"] === "effect");
    expect(fusionOf(item as Record<string, unknown>)["expiry"]).toEqual({
      on: "turn-start",
      ownerActorId: BEAR_ID,
    });
  });

  it("I-1: the Mestre may override the whole expiry", async () => {
    const ack = await sendOp(
      gm,
      "effect:apply",
      apply({ expiry: { on: "turn-end", remainingRounds: 3, ownerActorId: HUNTER_ID } }),
    );
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const item = itemsOf(ctx.store, HUNTER_ID).find((i) => i["type"] === "effect");
    expect(fusionOf(item as Record<string, unknown>)["expiry"]).toEqual({
      on: "turn-end",
      remainingRounds: 3,
      ownerActorId: HUNTER_ID,
    });
  });

  it("I-2: a player cannot apply an effect the origin does not reference", async () => {
    const denied = await sendOp(
      p1,
      "effect:apply",
      apply({ effect: { packId: PACK_ID, docId: UNREFERENCED_EFFECT } }),
    );
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(itemsOf(ctx.store, HUNTER_ID).filter((i) => i["type"] === "effect")).toHaveLength(0);
  });

  it("I-2: an effect of a pack hidden from players is PERMISSION_DENIED even when an item references it; the Mestre may", async () => {
    const hidden = { packId: HIDDEN_PACK_ID, docId: HIDDEN_EFFECT };
    const denied = await sendOp(
      p1,
      "effect:apply",
      apply({ sourceActorId: HUNTER_ID, targetActorIds: [HUNTER_ID], effect: hidden }),
    );
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    const ok = await sendOp(
      gm,
      "effect:apply",
      apply({ sourceActorId: HUNTER_ID, targetActorIds: [HUNTER_ID], effect: hidden }),
    );
    expect(ok["ok"], JSON.stringify(ok)).toBe(true);
  });

  it("I-2: the owner's item effectRefs and the companion type's Support both count as references", async () => {
    // hunter's talent references ALLOW_EFFECT; the bear's type references PLAIN_EFFECT
    const viaTalent = await sendOp(
      p1,
      "effect:apply",
      apply({
        sourceActorId: HUNTER_ID,
        targetActorIds: [HUNTER_ID],
        effect: { packId: PACK_ID, docId: ALLOW_EFFECT },
      }),
    );
    expect(viaTalent["ok"], JSON.stringify(viaTalent)).toBe(true);
    const viaType = await sendOp(p1, "effect:apply", apply());
    expect(viaType["ok"], JSON.stringify(viaType)).toBe(true);
  });

  it("rejects a missing target actor with NOT_FOUND and a prototype-polluting payload with VALIDATION_FAILED", async () => {
    const ghost = await sendOp(gm, "effect:apply", apply({ targetActorIds: ["ghostActor000001"] }));
    expect(ghost).toMatchObject({ ok: false, code: "NOT_FOUND" });

    const polluted = JSON.parse(
      `{"sourceActorId":"${BEAR_ID}","targetActorIds":["${HUNTER_ID}"],` +
        `"effect":{"packId":"${PACK_ID}","docId":"${PLAIN_EFFECT}"},` +
        `"expiry":{"on":"turn-start","ownerActorId":"${HUNTER_ID}","__proto__":{"polluted":true}}}`,
    ) as unknown;
    const rejected = await sendOp(gm, "effect:apply", polluted);
    expect(rejected).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(itemsOf(ctx.store, HUNTER_ID)).toHaveLength(0);
  });
});

describe("effect:apply on the pf2e-sf2e composite world (the table's system)", () => {
  let ctx: Ctx;
  let p1: ClientSocket;

  beforeEach(async () => {
    ctx = await buildCtx({ composite: true });
    p1 = await connect(ctx.port, ctx.worldId, ctx.p1Token);
  }, 30_000);

  afterEach(async () => {
    p1.disconnect();
    await teardown(ctx);
  });

  it("the owner applies the real bear Apoio from the companion onto the hunter", async () => {
    const ack = await sendOp(p1, "effect:apply", {
      sourceActorId: BEAR_ID,
      targetActorIds: [HUNTER_ID],
      effect: { packId: "pf2e.effects-ranger-homebrew", docId: "effect-support-bear" },
      expiry: { on: "turn-start", ownerActorId: HUNTER_ID },
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const items = itemsOf(ctx.store, HUNTER_ID);
    expect(items).toHaveLength(1);
    expect(fusionOf(items[0] as Record<string, unknown>)["expiry"]).toEqual({
      on: "turn-start",
      ownerActorId: HUNTER_ID,
    });
  });
});
