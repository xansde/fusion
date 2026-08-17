/**
 * A004 (ajustes r1, item 22) — adding a token to a scene ("Adicionar baú",
 * `TokenAddDialog.svelte`) used to fail with `tokens: Expected array,
 * received object`.
 *
 * Cause: `npcsFooter.ts`'s `buildPlaceChestTokenOp` and
 * `TokenAddDialog.svelte`'s submit handler both built the diff as a
 * `doc:update` with `diff: { tokens: { $push: {...} } }` — a MongoDB-style
 * pseudo-operator that does not exist anywhere on the server.
 * `applyDotPathDiff` (doc-handlers.ts) only assigns by dot-path: for the bare
 * key `"tokens"` it sets `result.tokens = { $push: {...} }` outright,
 * replacing the array with an object, and `Scene.tokens`
 * (`packages/shared/src/scene.ts`, `tokens: z.array(TokenDocumentSchema)`)
 * rejects it.
 *
 * Sending the WHOLE `tokens` array back through `doc:update` is not the fix
 * either: `rejectUnwritableField` (doc-handlers.ts) refuses ANY `doc:update`
 * diff that replaces an embedded collection wholesale, on purpose — the
 * message says exactly what to use instead: "use embedded operations". The
 * real fix is the write the server already has for landing ONE new token: an
 * embedded `doc:create` (`documentType: "Token"`,
 * `parent: { type: "Scene", id }`, handled by `handleEmbeddedCreate`), which
 * mints the `_id` server-side and appends to `Scene.tokens` atomically.
 *
 * Covers REQ-NPC-060 (the chest — and any token — lands on the scene via a
 * real write) and REQ-NPC-061 (the token the write adds carries the fields a
 * real placement needs — actorId, position) — spec 42 §5.8.
 *
 * The payload here is the spec 41 §7.2 one (TK022–TK025): `actorId` (which must
 * RESOLVE to a real Actor — REQ-TOK-002/DEC-TOK-04, hence the actors this suite
 * creates first) plus the obligatory `x`/`y` (REQ-TOK-020), and nothing the
 * server derives or refuses. `texture`/`width`/`height` are NOT sent, and are not
 * merely ignored: `validateTokenCreateContract`
 * (`packages/server/src/tokens/tokenValidation.ts`) answers VALIDATION_FAILED to
 * any of them (REQ-TOK-010/012/022, DEC-TOK-05) — pinned by the fourth case
 * below, so a client that reintroduces the pre-TK022 payload fails here loudly
 * instead of silently landing a token with art of its own.
 *
 * This file drives the real socket handler end-to-end (boot() + socket.io
 * client, mirroring contacts-title-expected-version.test.ts's
 * infrastructure) as the GM — REQ-CEN-070 makes Scene-embedded writes a
 * privileged-role gate, so both `npcsFooter.ts`'s `placeChest` and
 * `TokenAddDialog.svelte` (both GM/TRUSTED-only surfaces) always write as a
 * privileged role:
 *
 *   (a) the OLD shape — `doc:update` with `{ tokens: { $push: {...} } }` — is
 *       refused with the exact message the server produces, and nothing is
 *       persisted;
 *   (a2) the "obvious" fix — `doc:update` with the whole `tokens` array — is
 *       ALSO refused, with a different, more informative message, proving it
 *       is not a viable fix either;
 *   (b) the REAL fix — an embedded `doc:create` — succeeds, and the scene
 *       persists with the token appended, alongside whatever was already
 *       there.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
import { reserveFreePort } from "./helpers/ports.js";
import { DocumentStore } from "../documents/store.js";

// ---------------------------------------------------------------------------
// Test infrastructure (mirrors contacts-title-expected-version.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-scene-tokens-embedded-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "scene_tokens_embedded_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

  const port = await reserveFreePort();
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port, host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Scene Tokens Embedded World",
      worldSystemId: "stub",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: `http://127.0.0.1:${String(port)}`,
    },
  });

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

/**
 * A minimal, valid embedded-create token payload — the shape `npcsFooter.ts`'s
 * `buildPlaceChestTokenOp` and `TokenAddDialog.svelte`'s `buildCreateTokenOp`
 * send after TK022: `actorId` + the obligatory `x`/`y` (REQ-TOK-020), plus at
 * most an overridable `name` (REQ-TOK-060: absent means "inherit the actor's").
 * Never an `_id` (the server mints it), and never a derived field — art,
 * footprint and possession are refused outright (REQ-TOK-010/012/013/022).
 */
function newTokenData(actorId: string, name?: string): Record<string, unknown> {
  const data: Record<string, unknown> = { actorId, x: 0, y: 0 };
  if (name !== undefined) data["name"] = name;
  return data;
}

/** A pre-existing embedded token, seeded directly in a doc:create's `data`, with a valid 16-char id. */
function seededToken(id: string, actorId: string, name?: string): Record<string, unknown> {
  return { _id: id, ...newTokenData(actorId, name) };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("A004 — landing a token on a scene: $push and whole-array doc:update are both refused; embedded doc:create is the fix (REQ-NPC-060/-061)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let sceneId: string;
  /**
   * The wolf already on the scene, and the chest the fix lands — both REAL Actors:
   * REQ-TOK-002/DEC-TOK-04 refuses a token whose `actorId` resolves to nothing.
   */
  let loboActorId: string;
  let bauActorId: string;

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);

    const actorsAck = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        { name: "Lobo", type: "npc", folder: null },
        { name: "Baú", type: "loot", folder: null },
      ],
    });
    expect(actorsAck["ok"], JSON.stringify(actorsAck)).toBe(true);
    const actors = (actorsAck["result"] as { documents: Array<{ _id: string }> }).documents;
    loboActorId = actors[0]!._id;
    bauActorId = actors[1]!._id;
  }, 30000);

  afterAll(async () => {
    gm?.disconnect();
    await teardown(ctx);
  });

  // Fresh Scene per test, with one token already on it — so the fix has
  // something real to preserve alongside the newly landed one.
  beforeEach(async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Clareira", tokens: [seededToken("tokenlobo0000001", loboActorId)] }],
    });
    expect(ack["ok"]).toBe(true);
    sceneId = (ack["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
    const created = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    expect((created["tokens"] as unknown[]).length).toBe(1);
  });

  it("reproduces the OLD bug: a `$push` diff is refused with the exact Zod message, and nothing is persisted", async () => {
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Scene",
      updates: [
        {
          _id: sceneId,
          diff: { tokens: { $push: seededToken("tokenbau00000001", bauActorId) } },
        },
      ],
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(String(ack["message"])).toBe(
      "Validation failed for scenes: tokens: Expected array, received object",
    );

    const persisted = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    const tokens = persisted["tokens"] as Array<Record<string, unknown>>;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.["_id"]).toBe("tokenlobo0000001");
  });

  it("the WHOLE-ARRAY doc:update is ALSO refused — proving that is not the fix either", async () => {
    const currentTokens = (ctx.store.get("scenes", sceneId)["tokens"] as unknown[]) ?? [];
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Scene",
      updates: [
        {
          _id: sceneId,
          diff: { tokens: [...currentTokens, seededToken("tokenbau00000001", bauActorId)] },
        },
      ],
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(String(ack["message"])).toBe(
      "Scene.tokens is not writable as a whole through doc:update — use embedded operations (updates[].embedded)",
    );

    const persisted = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    const tokens = persisted["tokens"] as Array<Record<string, unknown>>;
    expect(tokens).toHaveLength(1);
  });

  it("the FIXED shape — an embedded doc:create — succeeds, mints the _id server-side, and the scene persists with both tokens", async () => {
    // What `buildPlaceChestTokenOp` / `buildCreateTokenOp` / `buildActorDropTokenOp`
    // send after the A004 fix, in the spec 41 §7.2 form (TK022).
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [newTokenData(bauActorId, "Baú")],
      parent: { type: "Scene", id: sceneId },
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as {
      documentType: string;
      documents: Array<Record<string, unknown>>;
    };
    expect(result.documentType).toBe("Token");
    expect(result.documents).toHaveLength(1);
    const mintedId = result.documents[0]?.["_id"];
    expect(typeof mintedId).toBe("string");
    expect(mintedId).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(result.documents[0]?.["actorId"]).toBe(bauActorId);

    const persisted = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    const tokens = persisted["tokens"] as Array<Record<string, unknown>>;
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.["_id"]).toBe("tokenlobo0000001");
    expect(tokens[1]?.["_id"]).toBe(mintedId);
    expect(tokens[1]?.["actorId"]).toBe(bauActorId);
    expect(tokens[1]?.["name"]).toBe("Baú");
  });

  it("REQ-TOK-010/012/022 (TK025): the PRE-TK022 payload — art and footprint on the token — is refused, not silently stripped", async () => {
    // The shape these same call sites used to send before spec 41 Fase 1. A token
    // has no art or footprint of its own: both derive from the effective actor
    // (DEC-TOK-03), and DEC-TOK-05 requires a REFUSAL rather than a quiet strip —
    // otherwise a caller would keep believing it had set a texture that never
    // existed on the document.
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [{ ...newTokenData(bauActorId, "Baú"), texture: null, width: 1, height: 1 }],
      parent: { type: "Scene", id: sceneId },
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(String(ack["message"])).toContain("Token.width");

    const persisted = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    expect((persisted["tokens"] as unknown[]).length).toBe(1);
  });

  it("REQ-TOK-002 (DEC-TOK-04): an actorId that resolves to no Actor is refused — there is no piece to draw", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Token",
      data: [newTokenData("actorbau00000001")],
      parent: { type: "Scene", id: sceneId },
    });

    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(String(ack["message"])).toContain("REQ-TOK-002");

    const persisted = ctx.store.get("scenes", sceneId) as Record<string, unknown>;
    expect((persisted["tokens"] as unknown[]).length).toBe(1);
  });
});
