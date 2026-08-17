/**
 * doc:update routing guards — two write leaks found by execution while
 * investigating the doc:update path (not part of any plan; live defects).
 *
 * LEAK 1 (mixed batch): buildDocUpdateHandler routes the WHOLE batch to
 * handleEmbeddedUpdate as soon as ANY entry has `embedded`. Inside, entries
 * without `embedded` are silently skipped (`if (!upd.embedded) continue;`),
 * so a batch mixing a primary update with an embedded one drops the primary
 * entry with ack.ok === true and no error at all — the caller has no way to
 * know its primary write never happened.
 *
 * LEAK 2 (tokens via generic path): the primary (non-embedded) doc:update
 * path validates and persists Scene diffs via the generic
 * applyDotPathDiff + store.update path, which has zero awareness of tokens —
 * no per-token ownership check, no Token schema validation, no hidden-token
 * filtering on broadcast. A Scene update whose diff carries `tokens` (a full
 * array replacement, bypassing embedded update entirely) sails straight
 * through.
 *
 * Both are closed the same way the existing `Scene.active` guard (T010,
 * doc-handlers.ts ~:800) was closed: reject the shape explicitly at the
 * primary doc:update path with VALIDATION_FAILED, pointing the caller at the
 * correct path.
 *
 * Every assertion here reads the persisted document straight from the
 * DocumentStore (bypassing the socket ack) — the whole point of these tests
 * is to prove the SERVER STATE didn't move, not just that the ack shape is
 * right.
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
// Test infrastructure (mirrors player-familiar-create.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return (() => {
    const dir = join(
      tmpdir(),
      `fusion-doc-update-routing-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    return dir;
  })();
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
  const worldId = "doc_update_routing_world";
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
      worldTitle: "Doc Update Routing World",
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
    // Reads directly from the same underlying DB the handler wrote to —
    // independent of the socket/ack layer under test.
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

/**
 * Create a minimal Actor and return its `_id`. A Token no longer accepts a
 * missing/null `actorId` (REQ-TOK-002) — every embedded Token created below
 * needs a resolvable actor to reference.
 */
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("doc:update routing guards (mixed batch + Scene.tokens generic path)", () => {
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
  // Case 1 — mixed batch [primary, embedded] is rejected atomically
  // -------------------------------------------------------------------------

  it("rejects a mixed batch [primary Actor, embedded Token] and leaves the Actor untouched", async () => {
    const actorAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name: "B", type: "npc", system: {}, ownership: { default: 0 } }],
    });
    expect(actorAck["ok"]).toBe(true);
    const actorId = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Mixed Batch Scene" }],
    });
    expect(sceneAck["ok"]).toBe(true);
    const sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    const tokenActorId = await createActor(gm, "Mixed Batch Token Actor");

    const tokenAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "T", actorId: tokenActorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);
    const tokenId = (
      (tokenAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>
    )["tokens"] as Array<{ _id: string }>;
    const tId = tokenId[0]!._id;

    const before = ctx.store.get("actors", actorId);
    expect(before["name"]).toBe("B");
    const versionBefore = (before["_stats"] as Record<string, unknown>)["version"];

    const mixedAck = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        // Primary entry — no expectedVersion, would otherwise succeed.
        { _id: actorId, diff: { name: "HIJACKED" } },
        // Embedded entry — routes the whole batch through handleEmbeddedUpdate today.
        {
          _id: tId,
          diff: { x: 999, y: 777 },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });

    expect(mixedAck["ok"]).toBe(false);
    expect(mixedAck["code"]).toBe("VALIDATION_FAILED");

    // SERVER STATE, not the ack: the Actor must be exactly as it was.
    const after = ctx.store.get("actors", actorId);
    expect(after["name"]).toBe("B");
    expect((after["_stats"] as Record<string, unknown>)["version"]).toBe(versionBefore);
  });

  it("rejects a mixed batch even when the primary entry carries a grossly stale expectedVersion", async () => {
    const actorAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name: "StaleCheck", type: "npc", system: {}, ownership: { default: 0 } }],
    });
    expect(actorAck["ok"]).toBe(true);
    const actorId = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Mixed Batch Scene 2" }],
    });
    const sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    const staleActorId = await createActor(gm, "Stale Batch Token Actor");
    const tokenAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "T2", actorId: staleActorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    const tId = (
      ((tokenAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>)[
        "tokens"
      ] as Array<{ _id: string }>
    )[0]!._id;

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        { _id: actorId, diff: { name: "HIJACKED2" }, expectedVersion: 999999 },
        { _id: tId, diff: { x: 1, y: 1 }, embedded: { type: "Token", id: sceneId } },
      ],
    });

    // Before the fix this returned ok:true and never raised STALE_WRITE at
    // all (the primary entry was silently dropped, never reaching the
    // expectedVersion check). After the fix it's rejected up front.
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
  });

  // -------------------------------------------------------------------------
  // Case 2 — pure-primary and pure-embedded batches keep working
  // -------------------------------------------------------------------------

  it("a batch with only primary entries still succeeds (no regression)", async () => {
    const actorAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [{ name: "OnlyPrimary", type: "npc", system: {}, ownership: { default: 0 } }],
    });
    const actorId = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { name: "RenamedPrimary" } }],
    });

    expect(ack["ok"]).toBe(true);
    const persisted = ctx.store.get("actors", actorId);
    expect(persisted["name"]).toBe("RenamedPrimary");
  });

  it("a batch with only embedded entries still succeeds (no regression)", async () => {
    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Only Embedded Scene" }],
    });
    const sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    const onlyEmbeddedActorId = await createActor(gm, "Only Embedded Token Actor");
    const tokenAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "OnlyEmbedded", actorId: onlyEmbeddedActorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    const tId = (
      ((tokenAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>)[
        "tokens"
      ] as Array<{ _id: string }>
    )[0]!._id;

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [{ _id: tId, diff: { x: 42, y: 43 }, embedded: { type: "Token", id: sceneId } }],
    });

    expect(ack["ok"]).toBe(true);
    const scene = ctx.store.get("scenes", sceneId);
    const tokens = scene["tokens"] as Array<{ _id: string; x: number; y: number }>;
    const moved = tokens.find((t) => t._id === tId);
    expect(moved?.x).toBe(42);
    expect(moved?.y).toBe(43);
  });

  // -------------------------------------------------------------------------
  // Case 3 — Scene.tokens through the GENERIC (non-embedded) doc:update path
  // -------------------------------------------------------------------------

  it("rejects Scene doc:update carrying `tokens` in the diff without `embedded`, leaving tokens byte-identical", async () => {
    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Generic Tokens Scene" }],
    });
    const sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    const guardedActorId = await createActor(gm, "Guarded Token Actor");
    const tokenAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "Guarded", actorId: guardedActorId, x: 5, y: 5, hidden: false }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"]).toBe(true);

    const before = ctx.store.get("scenes", sceneId);
    const tokensBefore = JSON.stringify(before["tokens"]);

    // No `embedded` on the update entry — this is the GENERIC primary path.
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Scene",
      updates: [
        {
          _id: sceneId,
          diff: {
            tokens: [{ _id: "zzzzzzzzzzzzzzzz", name: "Injected", x: 999, y: 777, hidden: true }],
          },
        },
      ],
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");

    const after = ctx.store.get("scenes", sceneId);
    // BYTE-IDENTICAL — not just "still has 1 token": no injected token, no
    // moved coordinates, no flipped hidden flag.
    expect(JSON.stringify(after["tokens"])).toBe(tokensBefore);
  });

  // -------------------------------------------------------------------------
  // Case 4 — the legitimate embedded path for tokens keeps working
  // -------------------------------------------------------------------------

  it("Scene token move via the embedded path still succeeds", async () => {
    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Legit Embedded Scene" }],
    });
    const sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    const movableActorId = await createActor(gm, "Movable Token Actor");
    const tokenAck = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ name: "Movable", actorId: movableActorId, x: 1, y: 1 }],
      parent: { type: "Scene", id: sceneId },
    });
    const tId = (
      ((tokenAck["result"] as Record<string, unknown>)["parent"] as Record<string, unknown>)[
        "tokens"
      ] as Array<{ _id: string }>
    )[0]!._id;

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Token",
      updates: [{ _id: tId, diff: { x: 321, y: 654 }, embedded: { type: "Token", id: sceneId } }],
    });

    expect(ack["ok"]).toBe(true);
    const scene = ctx.store.get("scenes", sceneId);
    const tokens = scene["tokens"] as Array<{ _id: string; x: number; y: number }>;
    const moved = tokens.find((t) => t._id === tId);
    expect(moved?.x).toBe(321);
    expect(moved?.y).toBe(654);
  });

  // -------------------------------------------------------------------------
  // Case 5 — the guard is scoped to doc:update only; doc:create is unaffected
  // -------------------------------------------------------------------------

  it("doc:create of a Scene WITH tokens still succeeds (guard must not leak into create)", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [
        {
          name: "Create With Tokens",
          tokens: [{ _id: "aaaaaaaaaaaaaaaa", name: "Seed", x: 0, y: 0, hidden: false }],
        },
      ],
    });

    expect(ack["ok"]).toBe(true);
    const docs = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents;
    const tokens = docs[0]!["tokens"] as Array<Record<string, unknown>>;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!["name"]).toBe("Seed");
  });

  // -------------------------------------------------------------------------
  // Case 6 — Actor.items has the same escape, and is the dangerous one:
  // Scene ownership means GM in practice, but a player owns their own sheet.
  // -------------------------------------------------------------------------

  it("rejects Actor doc:update replacing `items` wholesale, leaving items byte-identical", async () => {
    const actorAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Items Guard Actor",
          type: "npc",
          items: [{ _id: "itemitemitemitem", name: "Frightened", type: "condition", system: {} }],
        },
      ],
    });
    const actorId = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const before = ctx.store.get("actors", actorId);
    const itemsBefore = JSON.stringify(before["items"]);

    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: actorId,
          diff: {
            items: [
              {
                _id: "zzzzzzzzzzzzzzzz",
                name: "Bogus",
                type: "not-a-real-type",
                system: { cheat: true },
              },
            ],
          },
        },
      ],
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");

    const after = ctx.store.get("actors", actorId);
    expect(JSON.stringify(after["items"])).toBe(itemsBefore);
  });

  // -------------------------------------------------------------------------
  // Case 7 — the guard refuses only the wholesale array. The dot-path operator
  // forms the character sheet sends (`items.+`, `items.-<id>`) must keep the
  // rejection they already had from schema validation, not gain a new one:
  // they are unimplemented, and a guard here would disguise that.
  // -------------------------------------------------------------------------

  it("leaves the dot-path item operators on the path they already had", async () => {
    const actorAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Dot Path Actor",
          type: "npc",
          items: [{ _id: "itemitemitemitem", name: "Frightened", type: "condition", system: {} }],
        },
      ],
    });
    const actorId = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const removeAck = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { "items.-itemitemitemitem": true } }],
    });
    expect(removeAck["ok"]).toBe(false);
    expect(removeAck["message"]).not.toContain("not writable as a whole");

    const addAck = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [
        { _id: actorId, diff: { "items.+": { type: "condition", name: "sickened", system: {} } } },
      ],
    });
    expect(addAck["ok"]).toBe(false);
    expect(addAck["message"]).not.toContain("not writable as a whole");
  });
});
