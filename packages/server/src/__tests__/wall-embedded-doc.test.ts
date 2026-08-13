/**
 * Wall as an embedded document of Scene, through the GENERIC doc:create /
 * doc:update / doc:delete handler path (issue #83).
 *
 * Fusion already ships a DEDICATED wall:create/wall:update/wall:delete path
 * (vision-handlers.ts, covered by vision-m2a.test.ts) that behaves correctly.
 * This suite proves the SEPARATE generic doc:* path — the one every other
 * embedded type (Token, Tile, Item) goes through — now handles Wall the same
 * way, on the real production handler (doc-handlers.ts):
 *
 *   1. EMBEDDED_PARENT_MAP resolves "Wall" -> "Scene" for doc:update's
 *      embedded path (handleEmbeddedUpdate) — without it, moving a wall or
 *      flipping a door via doc:update fails with "Unknown parent type: Wall".
 *   2. Wall joins GM_ONLY_EMBEDDED: a PLAYER is rejected on create/update/
 *      delete, matching the design already shipped for Tile/Note and for the
 *      dedicated wall:* handlers.
 *   3. handleEmbeddedCreate validates a created Wall against the SAME
 *      WallDocumentSchema Scene.walls is typed with (@fusion/shared) — never
 *      a second copy — and the created wall round-trips every field.
 *   4. _id is always server-generated, never the client-supplied one.
 *   5. Secret-door redaction (redactSecretDoors / scenePayloadHasSecretDoors,
 *      redaction.ts) applies to a wall created through THIS path exactly as
 *      it does for the dedicated wall:create path, because both paths store
 *      into the same Scene.walls[] field and broadcastToWorld/buildSnapshot
 *      redact structurally (by shape), not by which handler wrote the data.
 *
 * Emission-path coverage (repo convention: 4 paths — snapshot, broadcast,
 * delta replay, ack echo):
 *   - snapshot: exercised below (a fresh player join must never see the
 *     secret door).
 *   - broadcast: exercised below (a live player socket must receive the
 *     redacted wall).
 *   - delta replay: exercised below (a player reconnecting with lastSeq must
 *     receive the redacted wall in the replayed ops).
 *   - ack echo (redactAckResultForNonPrivileged): NOT exercised, and
 *     structurally UNREACHABLE for Wall — the ack-echo redaction only fires
 *     for a non-privileged REQUESTER, and Wall create/update/delete is
 *     GM_ONLY_EMBEDDED, so the requester who receives a Wall-carrying ack is
 *     always privileged already. Same reasoning already applies to Tile
 *     (tile-gm-only.test.ts has no ack-echo test either).
 *
 * Harness mirrors tile-gm-only.test.ts / embedded-item-actor.test.ts.
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
import { pf2eSystem } from "@fusion/system-pf2e";

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
  playerToken: string;
  /**
   * TRUSTED on purpose: high enough to place tokens (the generic embedded
   * role floor), still not a GM. Rejecting THIS role is what actually proves
   * "Wall is GM-only, not merely TRUSTED+" — a plain PLAYER would already be
   * rejected by the pre-existing TRUSTED+ floor regardless of GM_ONLY_EMBEDDED,
   * so that assertion alone would not distinguish the two rules (mirrors
   * tile-gm-only.test.ts, same reasoning).
   */
  trustedToken: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "wall_embedded_doc_world";
  const dataDir = join(
    tmpdir(),
    `fusion-wall-embedded-doc-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "PlainPlayer",
    role: Role.PLAYER,
    password: "player-pass",
  });
  const { user: trusted } = await authService.createUser({
    name: "TrustedPlayer",
    role: Role.TRUSTED,
    password: "trusted-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });
  const trustedLogin = await authService.login({
    userId: trusted.id,
    password: "trusted-pass",
    ip: "127.0.0.1",
  });

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: 0, host: "127.0.0.1", logLevel: "silent" },
  });

  const bootResult = await boot({
    config,
    logger: createLogger("silent"),
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Wall Embedded Doc World",
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

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");

  return {
    dataDir,
    fusionDb,
    bootResult,
    port: address.port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    trustedToken: trustedLogin.accessToken,
  };
}

function connectClient(
  port: number,
  worldId: string,
  token: string,
  extraAuth: Record<string, unknown> = {},
): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth: { token, protocolVersion: PROTOCOL_VERSION, ...extraAuth },
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
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout for op: ${type}`));
    }, 8000);
  });
}

/** Wait for the next "op" event matching a predicate. */
function waitForOp(
  socket: ClientSocket,
  predicate: (env: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for op")), timeoutMs);
    const handler = (env: Record<string, unknown>) => {
      if (predicate(env)) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(env);
      }
    };
    socket.on("op", handler);
  });
}

function drain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 80));
}

/** The error code of a rejected ack (`{ ok: false, code, message }`). */
function errorCode(ack: Record<string, unknown>): string {
  return typeof ack["code"] === "string" ? ack["code"] : "";
}

function wallsOf(scene: Record<string, unknown>): Record<string, unknown>[] {
  const walls = scene["walls"];
  return Array.isArray(walls) ? (walls as Record<string, unknown>[]) : [];
}

// ---------------------------------------------------------------------------

describe("Wall embedded in Scene — generic doc:create/doc:update/doc:delete path (#83)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let trusted: ClientSocket;
  let sceneId = "";

  beforeAll(async () => {
    ctx = await buildCtx();

    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);

    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    player.connect();
    await waitForConnect(player);

    trusted = connectClient(ctx.port, ctx.worldId, ctx.trustedToken);
    trusted.connect();
    await waitForConnect(trusted);
    await drain();

    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Wall Test Scene" }],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 60000);

  afterAll(async () => {
    gm.disconnect();
    player.disconnect();
    trusted.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // (a) GM create — _id server-generated, full round-trip
  // -------------------------------------------------------------------------

  let wallId = "";

  it("(a) GM creates a Wall via doc:create — server-generated _id, Scene.walls holds it", async () => {
    const forgedId = "ZZZZZZZZZZZZZZZZ"; // 16 chars, well-formed but client-supplied
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Wall",
      parent: { type: "Scene", id: sceneId },
      data: [
        {
          _id: forgedId,
          a: { x: 0, y: 0 },
          b: { x: 200, y: 0 },
          move: "normal",
          sight: "normal",
          dir: "both",
          doorType: "door",
          doorState: "closed",
        },
      ],
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as {
      documentType: string;
      documents: Array<Record<string, unknown>>;
      parent: Record<string, unknown>;
    };
    expect(result.documentType).toBe("Wall");
    const created = result.documents[0];
    expect(created).toBeDefined();

    // _id is server-generated: it must NOT be the client-supplied one.
    expect(created?.["_id"]).not.toBe(forgedId);
    expect(typeof created?.["_id"]).toBe("string");
    expect((created?.["_id"] as string).length).toBe(16);
    wallId = created!["_id"] as string;

    // Full round-trip: every authored field survives create + persist.
    expect(created?.["a"]).toEqual({ x: 0, y: 0 });
    expect(created?.["b"]).toEqual({ x: 200, y: 0 });
    expect(created?.["move"]).toBe("normal");
    expect(created?.["sight"]).toBe("normal");
    expect(created?.["dir"]).toBe("both");
    expect(created?.["doorType"]).toBe("door");
    expect(created?.["doorState"]).toBe("closed");

    const walls = wallsOf(result.parent);
    expect(walls).toHaveLength(1);
    expect(walls[0]?.["_id"]).toBe(wallId);
    expect(walls[0]?.["a"]).toEqual({ x: 0, y: 0 });
    expect(walls[0]?.["doorType"]).toBe("door");
  });

  it("rejects a Wall payload that fails WallDocumentSchema (bad `a` point)", async () => {
    const ack = await sendOp(gm, "doc:create", {
      documentType: "Wall",
      parent: { type: "Scene", id: sceneId },
      data: [{ a: { x: "not-a-number" }, b: { x: 10, y: 10 } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(errorCode(ack)).toBe("VALIDATION_FAILED");
  });

  // -------------------------------------------------------------------------
  // (b) PLAYER create — PERMISSION_DENIED (proves the design rule, not a
  //     re-read of the same table the code produced).
  // -------------------------------------------------------------------------

  it("(b) a PLAYER cannot create a Wall via doc:create", async () => {
    const ack = await sendOp(player, "doc:create", {
      documentType: "Wall",
      parent: { type: "Scene", id: sceneId },
      data: [{ a: { x: 300, y: 0 }, b: { x: 400, y: 0 } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(errorCode(ack)).toBe("PERMISSION_DENIED");
  });

  it("(b) a TRUSTED player — who may place tokens — cannot create a Wall (GM-only, not TRUSTED+)", async () => {
    const ack = await sendOp(trusted, "doc:create", {
      documentType: "Wall",
      parent: { type: "Scene", id: sceneId },
      data: [{ a: { x: 300, y: 0 }, b: { x: 400, y: 0 } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(errorCode(ack)).toBe("PERMISSION_DENIED");
  });

  // -------------------------------------------------------------------------
  // (c) doc:update embedded — move + door state, GM applies / PLAYER denied
  // -------------------------------------------------------------------------

  it("(c) a PLAYER cannot update a Wall via doc:update embedded", async () => {
    const ack = await sendOp(player, "doc:update", {
      documentType: "Wall",
      updates: [
        {
          _id: wallId,
          diff: { doorState: "open" },
          embedded: { type: "Wall", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(errorCode(ack)).toBe("PERMISSION_DENIED");
  });

  it("(c) GM moves the Wall via doc:update embedded — applies", async () => {
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Wall",
      updates: [
        {
          _id: wallId,
          diff: { a: { x: 10, y: 10 }, b: { x: 250, y: 10 } },
          embedded: { type: "Wall", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { documents: Array<Record<string, unknown>> };
    const updatedScene = result.documents[0]!;
    const walls = wallsOf(updatedScene);
    const wall = walls.find((w) => w["_id"] === wallId);
    expect(wall?.["a"]).toEqual({ x: 10, y: 10 });
    expect(wall?.["b"]).toEqual({ x: 250, y: 10 });
  });

  it("(c) GM toggles the Wall's door state via doc:update embedded — applies", async () => {
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Wall",
      updates: [
        {
          _id: wallId,
          diff: { doorState: "open" },
          embedded: { type: "Wall", id: sceneId },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { documents: Array<Record<string, unknown>> };
    const walls = wallsOf(result.documents[0]!);
    const wall = walls.find((w) => w["_id"] === wallId);
    expect(wall?.["doorState"]).toBe("open");
  });

  // -------------------------------------------------------------------------
  // (d) doc:delete embedded — GM applies / PLAYER denied
  // -------------------------------------------------------------------------

  it("(d) a PLAYER cannot delete a Wall via doc:delete", async () => {
    const ack = await sendOp(player, "doc:delete", {
      documentType: "Wall",
      ids: [wallId],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(false);
    expect(errorCode(ack)).toBe("PERMISSION_DENIED");
  });

  it("(d) GM deletes the Wall via doc:delete — gone from the Scene", async () => {
    const ack = await sendOp(gm, "doc:delete", {
      documentType: "Wall",
      ids: [wallId],
      parent: { type: "Scene", id: sceneId },
    });
    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { parent: Record<string, unknown> };
    const walls = wallsOf(result.parent);
    expect(walls.find((w) => w["_id"] === wallId)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (e) Secret-door redaction across emission paths, for a Wall created
//     through the GENERIC doc:create path (not the dedicated wall:create).
// ---------------------------------------------------------------------------

describe("Wall embedded in Scene — secret door redaction via doc:create path (#83)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let player: ClientSocket;
  let sceneId = "";

  beforeAll(async () => {
    ctx = await buildCtx();

    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gm.connect();
    await waitForConnect(gm);

    player = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    player.connect();
    await waitForConnect(player);
    await drain();

    const sceneAck = await sendOp(gm, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Secret Door Scene" }],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;
  }, 60000);

  afterAll(async () => {
    gm.disconnect();
    player.disconnect();
    await ctx.bootResult.shutdown();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("broadcast: a live PLAYER socket receives the secret door redacted as a plain wall", async () => {
    const playerBroadcast = waitForOp(player, (env) => {
      if (env["type"] !== "doc:update") return false;
      const payload = env["payload"] as Record<string, unknown>;
      if (payload["documentType"] !== "Scene") return false;
      const docs = payload["documents"] as Record<string, unknown>[];
      return wallsOf(docs[0] ?? {}).length === 1;
    });

    const ack = await sendOp(gm, "doc:create", {
      documentType: "Wall",
      parent: { type: "Scene", id: sceneId },
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, doorType: "secret", doorState: "closed" }],
    });
    expect(ack["ok"]).toBe(true);
    // Ack echo goes to the GM, who is privileged — sees the real doorType.
    const created = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents[0];
    expect(created?.["doorType"]).toBe("secret");

    const broadcast = await playerBroadcast;
    const payload = broadcast["payload"] as Record<string, unknown>;
    const docs = payload["documents"] as Record<string, unknown>[];
    const wall = wallsOf(docs[0]!)[0];
    expect(wall?.["doorType"]).toBe("none");
    expect(wall?.["doorState"]).toBe("closed");
  });

  it("snapshot: a fresh PLAYER join never receives the secret door", async () => {
    const fresh = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    const snapshot = new Promise<Record<string, unknown>>((resolve, reject) => {
      fresh.on("op", (envelope: { type: string; payload: Record<string, unknown> }) => {
        if (envelope.type === "resync:full") resolve(envelope.payload);
      });
      setTimeout(() => reject(new Error("no snapshot")), 8000);
    });

    fresh.connect();
    await waitForConnect(fresh);
    const payload = await snapshot;
    fresh.disconnect();

    const snap = payload["snapshot"] as Record<string, unknown> | null;
    expect(snap).toBeDefined();
    const docs = snap?.["documents"] as Record<string, Record<string, unknown>[]> | undefined;
    const scenes = docs?.["Scene"] ?? [];
    const scene = scenes.find((s) => s["_id"] === sceneId);
    expect(scene).toBeDefined();
    const walls = wallsOf(scene ?? {});
    expect(walls.length).toBeGreaterThan(0);
    for (const w of walls) {
      expect(w["doorType"]).not.toBe("secret");
    }

    // The literal secret marker must not appear anywhere in what the player
    // received, not merely be absent from the one field we thought to check.
    expect(JSON.stringify(payload)).not.toContain('"doorType":"secret"');
  }, 20000);

  it("the GM's own fresh snapshot still shows the secret door as-is", async () => {
    const fresh = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    const snapshot = new Promise<Record<string, unknown>>((resolve, reject) => {
      fresh.on("op", (envelope: { type: string; payload: Record<string, unknown> }) => {
        if (envelope.type === "resync:full") resolve(envelope.payload);
      });
      setTimeout(() => reject(new Error("no snapshot")), 8000);
    });

    fresh.connect();
    await waitForConnect(fresh);
    const payload = await snapshot;
    fresh.disconnect();

    expect(JSON.stringify(payload)).toContain('"doorType":"secret"');
  }, 20000);

  it("delta replay: a PLAYER reconnecting with lastSeq receives the secret door redacted", async () => {
    // Player disconnects, GM creates another secret door while offline.
    player.disconnect();
    await drain();

    const createAck = await sendOp(gm, "doc:create", {
      documentType: "Wall",
      parent: { type: "Scene", id: sceneId },
      data: [{ a: { x: 500, y: 0 }, b: { x: 600, y: 0 }, doorType: "secret" }],
    });
    expect(createAck["ok"]).toBe(true);

    const freshPlayer = connectClient(ctx.port, ctx.worldId, ctx.playerToken, { lastSeq: 0 });
    freshPlayer.connect();
    await waitForConnect(freshPlayer);
    await drain();

    const deltaAck = await new Promise<Record<string, unknown>>((resolve, reject) => {
      freshPlayer.emit(
        "op",
        { type: "resync:request", ts: Date.now(), payload: { lastSeq: 0 } },
        (r: Record<string, unknown>) => resolve(r),
      );
      setTimeout(() => reject(new Error("Delta resync timeout")), 5000);
    });
    expect(deltaAck["ok"]).toBe(true);

    // resync:request's ack shape is { type: "delta", payload: { fromSeq,
    // toSeq, ops } } or { type: "full", payload: { reason, snapshot } } — see
    // buildResyncRequestHandler (sync-handlers.ts). Assert the delta branch
    // was actually taken instead of silently tolerating "full" (a resync just
    // after one create should always fit in the op buffer).
    const result = deltaAck["result"] as Record<string, unknown>;
    expect(result["type"]).toBe("delta");
    const deltaPayload = result["payload"] as Record<string, unknown>;
    const ops = deltaPayload["ops"] as Array<Record<string, unknown>> | undefined;
    expect(ops).toBeDefined();

    let sawWalls = false;
    for (const op of ops ?? []) {
      if (op["type"] !== "doc:update" && op["type"] !== "doc:create") continue;
      const payload = op["payload"] as Record<string, unknown>;
      const docs = payload["documents"] as Record<string, unknown>[] | undefined;
      if (!docs) continue;
      for (const doc of docs) {
        const walls = wallsOf(doc);
        if (walls.length === 0) continue;
        sawWalls = true;
        for (const w of walls) {
          expect(w["doorType"]).not.toBe("secret");
        }
      }
    }
    expect(sawWalls).toBe(true);

    freshPlayer.disconnect();
  }, 20000);
});
