/**
 * Deleting a scene — spec 44 §5.7 (DEC-CEN-07), plan G085.
 *
 * REQ-CEN-064: the scene that is ON AIR must not be deletable. The destructive
 *              operation cannot be the one that resolves the state: without the
 *              refusal, one click of housekeeping drops the whole table onto the
 *              waiting screen and nothing brings the scene back. The way out is the
 *              one the confirmation names — put another scene on air first.
 * REQ-CEN-065: creating a scene does NOT put it on air. The pointer of DEC-CEN-02
 *              does not move, and the new document is born `active: false`.
 *
 * The refusal shown by the client (`SceneDeleteConfirm`) is ergonomics; THIS is the
 * boundary (DEC-CEN-11). These tests read the ACK and the DATABASE — never a screen.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
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
import { PROTOCOL_VERSION } from "@fusion/shared";
import { listeningPort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Harness (same shape as scene-on-air.test.ts)
// ---------------------------------------------------------------------------

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
}

function makeTempDir(): string {
  // Data dir lives in the OS temp dir — never inside the worktree.
  const dir = join(
    tmpdir(),
    `fusion-scene-delete-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const worldId = "scene-delete-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: join(dataDir, "world.db"), skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, join(dataDir, "world.db"));

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  await authService.createUser({ name: "Jogador", role: Role.PLAYER, password: "player-pass" });
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Scene Delete World", systemId: "stub" },
  });
  // port 0 + listeningPort(): this test never goes through boot(), so the OS picks
  // the port and nothing hardcodes one (helpers/ports.ts).
  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const port = listeningPort(fastify);

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: `http://127.0.0.1:${String(port)}`,
  });
  socketManager.registerWorldNamespace({ worldId, db: fusionDb.raw, secret, authService });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(ctx: TestContext, token: string): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
    auth: { token, protocolVersion: PROTOCOL_VERSION },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) => {
      resolve(r);
    });
    setTimeout(() => {
      reject(new Error(`Timeout waiting for ack: ${type}`));
    }, 6000);
  });
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 150));

async function createScene(gmSocket: ClientSocket, name: string): Promise<string> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [{ name }],
  });
  expect(ack["ok"]).toBe(true);
  const docs = (ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[];
  return docs[0]?.["_id"] as string;
}

/** Does the row still exist in the scenes table? */
function sceneRowExists(ctx: TestContext, sceneId: string): boolean {
  const row = ctx.fusionDb.raw.prepare(`SELECT id FROM scenes WHERE id = ?`).get(sceneId);
  return row !== undefined;
}

/** The single source of truth of DEC-CEN-02, read straight from the settings table. */
function onAirIdInDb(ctx: TestContext): string | null {
  const row = ctx.fusionDb.raw
    .prepare(`SELECT data FROM settings WHERE id = ?`)
    .get("_meta:activeScene") as { data: string } | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.data) as { value?: unknown };
  return typeof parsed.value === "string" ? parsed.value : null;
}

/** The persisted `active` mirror of a scene, read straight from its row. */
function activeMirrorInDb(ctx: TestContext, sceneId: string): boolean {
  const row = ctx.fusionDb.raw.prepare(`SELECT data FROM scenes WHERE id = ?`).get(sceneId) as
    | { data: string }
    | undefined;
  if (!row) return false;
  return (JSON.parse(row.data) as { active?: unknown }).active === true;
}

// ---------------------------------------------------------------------------

describe("spec 44 §5.7 — deleting a scene (DEC-CEN-07)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx, ctx.gmToken);
    gmSocket.connect();
    await waitForConnect(gmSocket);
    await settle();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  it("REQ-CEN-064: the scene on air is refused, and the row is still there", async () => {
    const onAirId = await createScene(gmSocket, "Taverna");
    expect((await sendOp(gmSocket, "world:activeScene", { sceneId: onAirId }))["ok"]).toBe(true);
    await settle();

    const ack = await sendOp(gmSocket, "doc:delete", {
      documentType: "Scene",
      ids: [onAirId],
    });

    expect(ack["ok"]).toBe(false);
    // The message names the reason, so the client has something honest to show even
    // when it did not know the scene was on air.
    expect(String(ack["message"])).toMatch(/on air/i);
    // Nothing was destroyed, and the pointer did not move.
    expect(sceneRowExists(ctx, onAirId)).toBe(true);
    expect(onAirIdInDb(ctx)).toBe(onAirId);
    expect(activeMirrorInDb(ctx, onAirId)).toBe(true);
  });

  it("REQ-CEN-064: the way out works — put another scene on air, then it deletes", async () => {
    const first = await createScene(gmSocket, "Taverna");
    const second = await createScene(gmSocket, "Cripta");
    expect((await sendOp(gmSocket, "world:activeScene", { sceneId: first }))["ok"]).toBe(true);
    await settle();

    expect(
      (await sendOp(gmSocket, "doc:delete", { documentType: "Scene", ids: [first] }))["ok"],
    ).toBe(false);

    // The path the refusal names: put the OTHER scene on air first.
    expect((await sendOp(gmSocket, "world:activeScene", { sceneId: second }))["ok"]).toBe(true);
    await settle();

    const ack = await sendOp(gmSocket, "doc:delete", { documentType: "Scene", ids: [first] });
    expect(ack["ok"]).toBe(true);
    expect(sceneRowExists(ctx, first)).toBe(false);
    // And the scene that took its place is untouched.
    expect(onAirIdInDb(ctx)).toBe(second);
    expect(sceneRowExists(ctx, second)).toBe(true);
  });

  it("REQ-CEN-064: a batch that contains the scene on air deletes NOTHING", async () => {
    const onAirId = await createScene(gmSocket, "Taverna");
    const offAirId = await createScene(gmSocket, "Cripta");
    expect((await sendOp(gmSocket, "world:activeScene", { sceneId: onAirId }))["ok"]).toBe(true);
    await settle();

    const ack = await sendOp(gmSocket, "doc:delete", {
      documentType: "Scene",
      ids: [offAirId, onAirId],
    });

    expect(ack["ok"]).toBe(false);
    // Atomic: the off-air scene of the same batch survives too, so there is no half
    // deletion to undo.
    expect(sceneRowExists(ctx, offAirId)).toBe(true);
    expect(sceneRowExists(ctx, onAirId)).toBe(true);
  });

  it("REQ-CEN-064: with nothing on air, deleting is allowed", async () => {
    const sceneId = await createScene(gmSocket, "Cripta");
    await settle();

    const ack = await sendOp(gmSocket, "doc:delete", {
      documentType: "Scene",
      ids: [sceneId],
    });

    expect(ack["ok"]).toBe(true);
    expect(sceneRowExists(ctx, sceneId)).toBe(false);
  });

  it("REQ-CEN-065: creating a scene does not put it on air", async () => {
    const sceneId = await createScene(gmSocket, "Cripta");
    await settle();

    // The pointer of DEC-CEN-02 never moved, and the document is off air...
    expect(onAirIdInDb(ctx)).toBeNull();
    expect(activeMirrorInDb(ctx, sceneId)).toBe(false);

    // ...even when the client is impertinent enough to ask for it in the create
    // payload: `active` is not a field a document write may set (REQ-CEN-042), and the
    // create path used to be the way around that guard. A scene "active" that the
    // pointer never heard of is exactly the divergence no resync repairs — and worse,
    // `sceneIsOnAir` would have shown it to every player (REQ-CEN-071).
    const ack = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Atrevida", active: true }],
    });
    expect(ack["ok"]).toBe(false);
    expect(String(ack["message"])).toContain("world:activeScene");

    // Nothing was written, and the pointer still says nothing is on air.
    const rows = ctx.fusionDb.raw.prepare(`SELECT id FROM scenes`).all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([sceneId]);
    expect(onAirIdInDb(ctx)).toBeNull();
  });
});
