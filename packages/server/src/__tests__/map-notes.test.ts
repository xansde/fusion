/**
 * map-notes.test.ts - map pins (Scene.notes): scene:noteCreate / noteUpdate / noteDelete.
 *
 *   - the GM creates, moves, hides and deletes pins;
 *   - a GM-only pin NEVER reaches a player: not in the live broadcast, not in an ack,
 *     not in the join snapshot (checked after a fresh connection);
 *   - a player edits only title/text, only of a visible pin the GM marked editable.
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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-vision-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  gmUserId: string;
  playerToken: string;
  playerUserId: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "vision-test-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Vision Test World", systemId: "stub" },
  });
  await fastify.listen({ port: 0, host: "127.0.0.1" });

  const address = fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  const port = address.port;

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
    gmUserId: gm.id,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(port: number, worldId: string, auth: Record<string, unknown>): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth,
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
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 6000);
  });
}

/** Wait for the next "op" event matching a predicate. */
function waitForOp(
  socket: ClientSocket,
  predicate: (env: Record<string, unknown>) => boolean,
  timeoutMs = 3000,
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

/** Drain any pending events (snapshot etc.) */
function drain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 80));
}

// ---------------------------------------------------------------------------
// Helper: create a Scene via GM (returns scene _id and full doc)
// ---------------------------------------------------------------------------

/**
 * The scene is put ON AIR right away: a Scene body only crosses to a
 * non-privileged socket while it is the active one (REQ-CEN-071, REQ-CEN-072),
 * and every walls/lights/doors assertion below reads what the PLAYER received.
 * Off air, those assertions would be measuring the scene-list boundary instead
 * of the wall/light/secret-door behaviour they are about.
 */
async function createScene(
  gmSocket: ClientSocket,
  name = "Test Scene",
): Promise<Record<string, unknown>> {
  const ack = await sendOp(gmSocket, "doc:create", {
    documentType: "Scene",
    data: [{ name }],
  });
  expect(ack["ok"]).toBe(true);
  const docs = (ack["result"] as Record<string, unknown>)["documents"] as Record<string, unknown>[];
  const scene = docs[0]!;
  const activateAck = await sendOp(gmSocket, "world:activeScene", {
    sceneId: scene["_id"] as string,
  });
  expect(activateAck["ok"]).toBe(true);
  return scene;
}

interface Note {
  id: string;
  x: number;
  y: number;
  title: string;
  text: string;
  gmOnly: boolean;
  playersCanEdit: boolean;
}

function notesOf(env: Record<string, unknown>): Note[] | null {
  const payload = env["payload"] as Record<string, unknown>;
  const docs = payload["documents"] as Record<string, unknown>[] | undefined;
  const scene = docs?.[0];
  return scene && Array.isArray(scene["notes"]) ? (scene["notes"] as Note[]) : null;
}

describe("map pins (Scene.notes)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    await drain();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  async function addNote(
    sceneId: string,
    over: Partial<Note> = {},
  ): Promise<{ ack: Record<string, unknown>; note: Note }> {
    const ack = await sendOp(gmSocket, "scene:noteCreate", {
      sceneId,
      note: { x: 100, y: 200, title: "Porta", text: "Rangeu", gmOnly: false, ...over },
    });
    const note = (ack["result"] as Record<string, unknown> | undefined)?.["note"] as Note;
    return { ack, note };
  }

  async function joinSnapshot(token: string): Promise<string> {
    const fresh = connectClient(ctx.port, ctx.worldId, {
      token,
      protocolVersion: PROTOCOL_VERSION,
    });
    const snapshot = new Promise<Record<string, unknown>>((resolve) => {
      fresh.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "resync:full") resolve(env);
      });
    });
    fresh.connect();
    await waitForConnect(fresh);
    const text = JSON.stringify(await snapshot);
    fresh.disconnect();
    return text;
  }

  it("a public pin is persisted and reaches the player", async () => {
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;
    const seen = waitForOp(playerSocket, (env) => (notesOf(env)?.length ?? 0) === 1);
    const { ack, note } = await addNote(sceneId);
    expect(ack["ok"]).toBe(true);
    expect(note.id).toBeTruthy();
    expect(note.playersCanEdit).toBe(false);
    const got = notesOf(await seen);
    expect(got?.[0]).toMatchObject({ title: "Porta", text: "Rangeu", x: 100, y: 200 });
  });

  it("a GM-only pin never reaches the player: broadcast, ack and join snapshot", async () => {
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;
    const seenByPlayer: string[] = [];
    playerSocket.on("op", (env: Record<string, unknown>) => {
      seenByPlayer.push(JSON.stringify(env));
    });

    const secret = await addNote(sceneId, { title: "Armadilha", text: "CD 25", gmOnly: true });
    expect(secret.ack["ok"]).toBe(true);
    // A later write rebroadcasts the whole scene.
    const pub = await addNote(sceneId, { title: "Estatua" });
    expect(pub.ack["ok"]).toBe(true);
    await drain();
    await drain();

    const live = seenByPlayer.join("\n");
    expect(live).toContain("Estatua");
    expect(live).not.toContain("Armadilha");
    expect(live).not.toContain("CD 25");

    const playerSnap = await joinSnapshot(ctx.playerToken);
    expect(playerSnap).toContain("Estatua");
    expect(playerSnap).not.toContain("Armadilha");

    expect(await joinSnapshot(ctx.gmToken)).toContain("Armadilha");
  });

  it("hiding a visible pin removes it from the player's copy", async () => {
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;
    const { note } = await addNote(sceneId);
    const gone = waitForOp(playerSocket, (env) => notesOf(env)?.length === 0);
    const ack = await sendOp(gmSocket, "scene:noteUpdate", {
      sceneId,
      noteId: note.id,
      patch: { gmOnly: true },
    });
    expect(ack["ok"]).toBe(true);
    await gone;
  });

  it("a player cannot create, move, hide or delete a pin", async () => {
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;
    const { note } = await addNote(sceneId, { playersCanEdit: true });

    const create = await sendOp(playerSocket, "scene:noteCreate", {
      sceneId,
      note: { x: 1, y: 1, title: "Meu", gmOnly: false },
    });
    expect(create["code"]).toBe("PERMISSION_DENIED");

    const move = await sendOp(playerSocket, "scene:noteUpdate", {
      sceneId,
      noteId: note.id,
      patch: { x: 999 },
    });
    expect(move["code"]).toBe("PERMISSION_DENIED");

    const hide = await sendOp(playerSocket, "scene:noteUpdate", {
      sceneId,
      noteId: note.id,
      patch: { gmOnly: true },
    });
    expect(hide["code"]).toBe("PERMISSION_DENIED");

    const del = await sendOp(playerSocket, "scene:noteDelete", { sceneId, noteId: note.id });
    expect(del["code"]).toBe("PERMISSION_DENIED");
  });

  it("a player edits title and text only where the GM allowed it", async () => {
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;
    const open = (await addNote(sceneId, { title: "Aberto", playersCanEdit: true })).note;
    const closed = (await addNote(sceneId, { title: "Fechado" })).note;
    const hidden = (await addNote(sceneId, { title: "Oculto", gmOnly: true, playersCanEdit: true }))
      .note;

    const ok = await sendOp(playerSocket, "scene:noteUpdate", {
      sceneId,
      noteId: open.id,
      patch: { title: "Aberto 2", text: "anotado" },
    });
    expect(ok["ok"]).toBe(true);
    expect((ok["result"] as Record<string, unknown>)["note"]).toMatchObject({ text: "anotado" });

    const no = await sendOp(playerSocket, "scene:noteUpdate", {
      sceneId,
      noteId: closed.id,
      patch: { text: "x" },
    });
    expect(no["code"]).toBe("PERMISSION_DENIED");

    // A GM-only pin answers as if it did not exist.
    const ghost = await sendOp(playerSocket, "scene:noteUpdate", {
      sceneId,
      noteId: hidden.id,
      patch: { text: "x" },
    });
    expect(ghost["code"]).toBe("NOT_FOUND");
  });

  it("the GM edits and deletes pins", async () => {
    const scene = await createScene(gmSocket);
    const sceneId = scene["_id"] as string;
    const { note } = await addNote(sceneId);
    const upd = await sendOp(gmSocket, "scene:noteUpdate", {
      sceneId,
      noteId: note.id,
      patch: { x: 5, y: 6, title: "Novo" },
    });
    expect(upd["ok"]).toBe(true);
    expect((upd["result"] as Record<string, unknown>)["note"]).toMatchObject({
      x: 5,
      y: 6,
      title: "Novo",
    });
    const del = await sendOp(gmSocket, "scene:noteDelete", { sceneId, noteId: note.id });
    expect(del["ok"]).toBe(true);
    const again = await sendOp(gmSocket, "scene:noteDelete", { sceneId, noteId: note.id });
    expect(again["code"]).toBe("NOT_FOUND");
  });

  it("refuses an invalid pin (empty title) and an unknown scene", async () => {
    const scene = await createScene(gmSocket);
    const bad = await sendOp(gmSocket, "scene:noteCreate", {
      sceneId: scene["_id"],
      note: { x: 0, y: 0, title: "  ", gmOnly: false },
    });
    expect(bad["code"]).toBe("VALIDATION_FAILED");
    const none = await sendOp(gmSocket, "scene:noteCreate", {
      sceneId: "nope",
      note: { x: 0, y: 0, title: "t", gmOnly: false },
    });
    expect(none["code"]).toBe("NOT_FOUND");
  });
});
