/**
 * Adversarial probes over the unlinked-token model — REQ-DOC-031, REQ-DOC-032,
 * REQ-DOC-033, REQ-DOC-034, REQ-DOC-061, REQ-DOC-062, REQ-CNV-093, REQ-CNV-094.
 *
 * The happy path lives in `token-actor-delta-e2e.test.ts`. This file only asks
 * the questions that break things:
 *
 *   - can a client corrupt its own token's actor by sending the collection
 *     instruction the CLIENT refuses (`items.+` / `items.-<id>`)?
 *   - does a malformed `actorDelta` (a string, an array, a `system` that is a
 *     number) take the world's derivation or the snapshot down with it?
 *   - can a player who owns the base Actor write privileged fields into the
 *     delta by addressing the Token directly, going around `token:updateActor`?
 *   - does a linked token still share the world Actor with its siblings?
 *
 * Real server, real sockets, real SQLite — same reason as the e2e file: only a
 * round trip through persistence can tell an accepted field from a silently
 * dropped one.
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
import { PROTOCOL_VERSION, applyActorDelta, isActorDeltaEmpty } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Harness (mirrors token-actor-delta-e2e.test.ts)
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
  const worldId = "token_actor_attack_world";
  const dataDir = join(
    tmpdir(),
    `fusion-token-attack-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
      worldTitle: "Token Actor Attack World",
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

function hpOf(actor: Record<string, unknown> | undefined): unknown {
  const system = actor?.["system"] as Record<string, unknown> | undefined;
  const attributes = system?.["attributes"] as Record<string, unknown> | undefined;
  return (attributes?.["hp"] as Record<string, unknown> | undefined)?.["value"];
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

describe("attacks on the unlinked-token model", () => {
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
      data: [{ name: "Cripta hostil" }],
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
          system: {
            attributes: { hp: { value: 20, max: 20 } },
          },
          items: [{ _id: "item-espada", name: "Espada", type: "weapon", system: {} }],
        },
      ],
    });
    skeletonActorId = (
      (skeletonAck["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

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
  // 1. The collection instruction the client refuses — does the SERVER refuse?
  // -------------------------------------------------------------------------

  // REQ-DOC-034 / REQ-CNV-094: the refusal belongs to the AUTHORITY, not only
  // to the client that happens to ship with it.
  it("refuses an array instruction in the delta instead of turning items into an object", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto saqueado",
      actorId: skeletonActorId,
      actorLink: false,
      x: 100,
      y: 100,
    });

    const ack = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId,
      diff: { "items.-item-espada": true },
    });
    expect(ack["ok"]).toBe(false);

    const scene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    const base = firstDocument(
      await snapshotFor(ctx, ctx.gmToken),
      "Actor",
      skeletonActorId,
    ) as Record<string, unknown>;
    const effective = applyActorDelta(base, tokenOf(scene, tokenId)["actorDelta"]);
    // The item collection must still be a collection.
    expect(Array.isArray(effective["items"])).toBe(true);
  }, 30000);

  it("refuses `items.+` too — the append form of the same instruction", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto abençoado",
      actorId: skeletonActorId,
      actorLink: false,
      x: 110,
      y: 110,
    });

    const ack = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId,
      diff: { "items.+": { type: "condition", name: "prone" } },
    });
    expect(ack["ok"]).toBe(false);

    const scene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    expect(tokenOf(scene, tokenId)["actorDelta"]).toEqual({});
  }, 30000);

  // -------------------------------------------------------------------------
  // 2. A malformed delta must not take the world down (WIRING-DERIVE)
  // -------------------------------------------------------------------------

  it("a token whose actorDelta is not even an object leaves every actor readable", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto corrompido",
      actorId: skeletonActorId,
      actorLink: false,
      x: 200,
      y: 200,
    });

    // Write junk straight into the token document, the way a hostile client or
    // a bad import would.
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { actorDelta: "não sou um objeto" },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    const documents = await snapshotFor(ctx, ctx.gmToken);
    // The whole actor list still arrives — the failure mode WIRING-DERIVE
    // records is an EMPTY list for everyone because of one bad document.
    expect((documents["Actor"] ?? []).length).toBeGreaterThanOrEqual(2);
    const scene = firstDocument(documents, "Scene", sceneId);
    const base = firstDocument(documents, "Actor", skeletonActorId) as Record<string, unknown>;
    // ...and the token reads as the base actor rather than exploding.
    expect(hpOf(applyActorDelta(base, tokenOf(scene, tokenId)["actorDelta"]))).toBe(20);
  }, 30000);

  it("a delta whose `system` is a number does not break the next legitimate write", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto absurdo",
      actorId: skeletonActorId,
      actorLink: false,
      x: 210,
      y: 210,
    });

    const junk = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId,
      diff: { system: 42 },
    });
    expect(junk["ok"]).toBe(true);

    const ok = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId,
      diff: { "system.attributes.hp.value": 3 },
    });
    expect(ok["ok"]).toBe(true);

    const documents = await snapshotFor(ctx, ctx.gmToken);
    const scene = firstDocument(documents, "Scene", sceneId);
    const base = firstDocument(documents, "Actor", skeletonActorId) as Record<string, unknown>;
    expect(hpOf(applyActorDelta(base, tokenOf(scene, tokenId)["actorDelta"]))).toBe(3);
  }, 30000);

  // -------------------------------------------------------------------------
  // 3. Going around token:updateActor by addressing the Token directly
  // -------------------------------------------------------------------------

  // REQ-DOC-034 (única rota de autoria) + REQ-USR-015 (ownership é privilegiado).
  it("a player cannot smuggle `ownership` into the delta by writing the Token directly", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Heroína ambiciosa",
      actorId: heroActorId,
      actorLink: false,
      x: 300,
      y: 300,
    });

    const player = await connected(ctx, ctx.playerToken);
    let ack: Record<string, unknown>;
    try {
      ack = await sendOp(player, "doc:update", {
        documentType: "Token",
        updates: [
          {
            _id: tokenId,
            diff: { actorDelta: { ownership: { default: 3 } } },
            embedded: { type: "Token", id: sceneId },
          },
        ],
      });
    } finally {
      player.disconnect();
    }

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");

    const scene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    const delta = tokenOf(scene, tokenId)["actorDelta"] as Record<string, unknown>;
    expect(delta["ownership"]).toBeUndefined();
  }, 30000);

  it("the routed op still lets that same player edit their own token's actor", async () => {
    // The guard above must be a guard on the ROUTE, not on the player: closing
    // the direct write and closing the feature would look identical from the
    // ack, and only this test separates them.
    const tokenId = await createToken(gm, sceneId, {
      name: "Heroína legítima",
      actorId: heroActorId,
      actorLink: false,
      x: 320,
      y: 320,
    });

    const player = await connected(ctx, ctx.playerToken);
    try {
      const ack = await sendOp(player, "token:updateActor", {
        sceneId,
        tokenId,
        diff: { "system.attributes.hp.value": 5 },
      });
      expect(ack["ok"]).toBe(true);
    } finally {
      player.disconnect();
    }

    const documents = await snapshotFor(ctx, ctx.gmToken);
    const scene = firstDocument(documents, "Scene", sceneId);
    const base = firstDocument(documents, "Actor", heroActorId) as Record<string, unknown>;
    expect(hpOf(applyActorDelta(base, tokenOf(scene, tokenId)["actorDelta"]))).toBe(5);
  }, 30000);

  it("a player cannot forge `system.derived` in the delta by writing the Token directly", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Heroína blindada",
      actorId: heroActorId,
      actorLink: false,
      x: 310,
      y: 310,
    });

    const player = await connected(ctx, ctx.playerToken);
    let ack: Record<string, unknown>;
    try {
      ack = await sendOp(player, "doc:update", {
        documentType: "Token",
        updates: [
          {
            _id: tokenId,
            diff: { actorDelta: { system: { derived: { ac: { value: 99 } } } } },
            embedded: { type: "Token", id: sceneId },
          },
        ],
      });
    } finally {
      player.disconnect();
    }

    expect(ack["ok"]).toBe(false);

    const documents = await snapshotFor(ctx, ctx.gmToken);
    const scene = firstDocument(documents, "Scene", sceneId);
    const base = firstDocument(documents, "Actor", heroActorId) as Record<string, unknown>;
    const effective = applyActorDelta(base, tokenOf(scene, tokenId)["actorDelta"]);
    const derived = (effective["system"] as Record<string, unknown>)["derived"] as
      | Record<string, unknown>
      | undefined;
    const ac = derived?.["ac"] as Record<string, unknown> | undefined;
    expect(ac?.["value"]).not.toBe(99);
  }, 30000);

  // -------------------------------------------------------------------------
  // 4. The declared cost of REQ-DOC-062, pinned so it stops being invisible
  // -------------------------------------------------------------------------

  it("KNOWN COST (DEC-DOC-12): the owner of an unlinked token reads the BASE numbers, not its own", async () => {
    // REQ-DOC-062 cuts `actorDelta` by ROLE, not by ownership of the base
    // Actor. The consequence the spec names — and this test pins, because a
    // silent wrong number is worse than a loud one — is that a non-privileged
    // OWNER of an unlinked token receives an emptied delta and therefore reads
    // the base Actor. Their sheet is stale, and a write made FROM that stale
    // sheet overwrites the token's real value.
    //
    // When per-viewer redaction lands (it needs the base Actor's ownership map
    // threaded through all five Scene emitters), this test is the one that
    // should flip to "the owner reads their own numbers".
    const tokenId = await createToken(gm, sceneId, {
      name: "Heroína cega",
      actorId: heroActorId,
      actorLink: false,
      x: 330,
      y: 330,
    });

    const player = await connected(ctx, ctx.playerToken);
    try {
      const ack = await sendOp(player, "token:updateActor", {
        sceneId,
        tokenId,
        diff: { "system.attributes.hp.value": 4 },
      });
      expect(ack["ok"]).toBe(true);
    } finally {
      player.disconnect();
    }

    // The truth, as the GM sees it.
    const gmDocuments = await snapshotFor(ctx, ctx.gmToken);
    const gmBase = firstDocument(gmDocuments, "Actor", heroActorId) as Record<string, unknown>;
    const gmScene = firstDocument(gmDocuments, "Scene", sceneId);
    expect(hpOf(applyActorDelta(gmBase, tokenOf(gmScene, tokenId)["actorDelta"]))).toBe(4);

    // What the owner actually receives.
    const playerDocuments = await snapshotFor(ctx, ctx.playerToken);
    const playerBase = firstDocument(playerDocuments, "Actor", heroActorId) as Record<
      string,
      unknown
    >;
    const playerScene = firstDocument(playerDocuments, "Scene", sceneId);
    expect(tokenOf(playerScene, tokenId)["actorDelta"]).toEqual({});
    expect(hpOf(applyActorDelta(playerBase, tokenOf(playerScene, tokenId)["actorDelta"]))).toBe(
      hpOf(playerBase),
    );
  }, 30000);

  it("the ack echoed to the requester carries no delta either — path 4 of the redaction", async () => {
    // The three broadcast paths are covered elsewhere; the ack is the one that
    // travels back to the very socket that asked, and it returns the WHOLE
    // Scene, every other token included.
    const tokenId = await createToken(gm, sceneId, {
      name: "Heroína ecoada",
      actorId: heroActorId,
      actorLink: false,
      x: 340,
      y: 340,
    });
    const otherId = await createToken(gm, sceneId, {
      name: "Esqueleto vizinho",
      actorId: skeletonActorId,
      actorLink: false,
      x: 345,
      y: 345,
    });
    await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId: otherId,
      diff: { "system.attributes.hp.value": 1 },
    });

    const player = await connected(ctx, ctx.playerToken);
    try {
      const ack = await sendOp(player, "token:updateActor", {
        sceneId,
        tokenId,
        diff: { "system.attributes.hp.value": 6 },
      });
      expect(ack["ok"]).toBe(true);
      const documents = (ack["result"] as Record<string, unknown>)["documents"] as Record<
        string,
        unknown
      >[];
      for (const doc of documents) {
        for (const tok of (doc["tokens"] ?? []) as Record<string, unknown>[]) {
          // "Carries nothing" is `isActorDeltaEmpty` — the SAME predicate the
          // redaction gates on and the reconstruction reads with, so the two
          // cannot drift into disagreeing about what an empty delta is.
          expect(isActorDeltaEmpty(tok["actorDelta"])).toBe(true);
        }
      }
    } finally {
      player.disconnect();
    }
  }, 30000);

  // -------------------------------------------------------------------------
  // 5. The control on screen (REQ-CNV-093) — does Save really persist it?
  // -------------------------------------------------------------------------

  // REQ-CNV-093: the control has to reach persistence, and must not clear the delta.
  it("re-linking a token through the dialog's Save persists, and keeps the delta", async () => {
    const tokenId = await createToken(gm, sceneId, {
      name: "Esqueleto indeciso",
      actorId: skeletonActorId,
      actorLink: false,
      x: 500,
      y: 500,
    });
    await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId,
      diff: { "system.attributes.hp.value": 9 },
    });

    // Exactly the wire shape `buildTokenConfigPatch` + `updateToken` produce:
    // plain token fields, embedded Token update, and NO `actorDelta` key.
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { name: "Esqueleto indeciso", actorLink: true },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    const scene = firstDocument(await snapshotFor(ctx, ctx.gmToken), "Scene", sceneId);
    const token = tokenOf(scene, tokenId);
    expect(token["actorLink"]).toBe(true);
    // Re-linking is reversible: the delta must still be there to come back to.
    expect(token["actorDelta"]).toMatchObject({
      system: { attributes: { hp: { value: 9 } } },
    });

    // ...and unlinking again restores that private pool rather than the base's.
    const back = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: tokenId,
          diff: { actorLink: false },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(back["ok"]).toBe(true);

    const documents = await snapshotFor(ctx, ctx.gmToken);
    const base = firstDocument(documents, "Actor", skeletonActorId) as Record<string, unknown>;
    const again = tokenOf(firstDocument(documents, "Scene", sceneId), tokenId);
    expect(hpOf(applyActorDelta(base, again["actorDelta"]))).toBe(9);
  }, 30000);

  // -------------------------------------------------------------------------
  // 6. The inverse path must not have regressed
  // -------------------------------------------------------------------------

  it("two LINKED tokens of one Actor still share the pool — the player character is untouched", async () => {
    const a = await createToken(gm, sceneId, {
      name: "Heroína A",
      actorId: heroActorId,
      actorLink: true,
      x: 400,
      y: 400,
    });
    const b = await createToken(gm, sceneId, {
      name: "Heroína B",
      actorId: heroActorId,
      actorLink: true,
      x: 410,
      y: 410,
    });

    const ack = await sendOp(gm, "token:updateActor", {
      sceneId,
      tokenId: a,
      diff: { "system.attributes.hp.value": 12 },
    });
    expect(ack["ok"]).toBe(true);

    const documents = await snapshotFor(ctx, ctx.gmToken);
    const scene = firstDocument(documents, "Scene", sceneId);
    const base = firstDocument(documents, "Actor", heroActorId) as Record<string, unknown>;

    expect(hpOf(base)).toBe(12);
    for (const id of [a, b]) {
      const tok = tokenOf(scene, id);
      expect(tok["actorLink"]).toBe(true);
      expect(hpOf(applyActorDelta(base, tok["actorDelta"]))).toBe(12);
    }
  }, 30000);
});
