/**
 * M3 mapa-som — ambient table track server handler integration tests.
 *
 * Spec: packages/shared/src/sound/types.ts (contract — immutable)
 *
 * Coverage:
 *  §SOUND PLAY
 *   - GM play → ack ok; GM and player both receive sound:state op with
 *     src and a numeric startedAt
 *   - player sends sound:play → PERMISSION_DENIED, no broadcast
 *   - invalid payloads → VALIDATION_FAILED ({src: "../x.mp3"}, {src: "a.wav"}, {})
 *   - play of an asset that does not exist in the world assets dir → NOT_FOUND
 *
 *  §SOUND STOP
 *   - GM stop → broadcasts sound:state {state: null}
 *   - player sends sound:stop → PERMISSION_DENIED, no broadcast, and the
 *     persisted track is untouched (a rejected stop must not silence anyone)
 *
 *  §LATE JOINER / SNAPSHOT
 *   - after play, a newly-connecting client's resync:full snapshot carries
 *     ambientTrack with the currently playing src
 *
 *  §PERSISTENCE
 *   - ambient track state survives a SocketManager restart over the same db
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

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SocketManager } from "../net/socket-manager.js";
import { getAmbientTrackState } from "../net/handlers/sound-handlers.js";
import { PROTOCOL_VERSION } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-sound-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface TestContext {
  dataDir: string;
  assetsDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  gmUserId: string;
  playerToken: string;
  playerUserId: string;
  secret: Uint8Array;
  dbPath: string;
}

async function buildTestContext(options?: { withAssetsDir?: boolean }): Promise<TestContext> {
  const withAssetsDir = options?.withAssetsDir ?? true;
  const dataDir = makeTempDir();
  const assetsDir = join(dataDir, "assets");
  mkdirSync(assetsDir, { recursive: true });
  // Seed a real asset so assetExists() has something to find.
  writeFileSync(join(assetsDir, "tavern.mp3"), "fake-mp3-bytes");

  const dbPath = join(dataDir, "world.db");
  const worldId = "sound-test-world";

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
    worldInfo: { id: worldId, title: "Sound Test World", systemId: "stub" },
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
  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
    ...(withAssetsDir ? { assetsDir } : {}),
  });

  return {
    dataDir,
    assetsDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    gmUserId: gm.id,
    playerToken: playerLogin.accessToken,
    playerUserId: player.id,
    secret,
    dbPath,
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

/** Wait for the next socket event matching a predicate. */
function waitForEvent(
  socket: ClientSocket,
  eventName: string,
  predicate: (env: Record<string, unknown>) => boolean,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${eventName}`)),
      timeoutMs,
    );
    const handler = (env: Record<string, unknown>) => {
      if (predicate(env)) {
        clearTimeout(timer);
        socket.off(eventName, handler);
        resolve(env);
      }
    };
    socket.on(eventName, handler);
  });
}

/** Drain pending events (snapshot on join, etc.) */
function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("M3 mapa-som sound server handlers", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // §SOUND PLAY
  // -------------------------------------------------------------------------

  describe("sound:play", () => {
    it("GM play → ack ok; GM and player both receive sound:state broadcast", async () => {
      const gmSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.gmToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      const playerSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.playerToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      gmSocket.connect();
      playerSocket.connect();
      await waitForConnect(gmSocket);
      await waitForConnect(playerSocket);
      await drain();

      const gmBroadcast = waitForEvent(
        gmSocket,
        "op",
        (env) => (env as { type?: string }).type === "sound:state",
        4000,
      );
      const playerBroadcast = waitForEvent(
        playerSocket,
        "op",
        (env) => (env as { type?: string }).type === "sound:state",
        4000,
      );

      const ack = await sendOp(gmSocket, "sound:play", { src: "tavern.mp3" });
      expect(ack).toMatchObject({ ok: true });
      const ackState = (
        ack as { result?: { state?: { src?: string; startedAt?: number } } }
      ).result?.state;
      expect(ackState?.src).toBe("tavern.mp3");
      expect(typeof ackState?.startedAt).toBe("number");

      const gmEnv = await gmBroadcast;
      const playerEnv = await playerBroadcast;

      for (const env of [gmEnv, playerEnv]) {
        const payload = (env as { payload?: { state?: { src?: string; startedAt?: number } } })
          .payload;
        expect(payload?.state?.src).toBe("tavern.mp3");
        expect(typeof payload?.state?.startedAt).toBe("number");
      }

      gmSocket.disconnect();
      playerSocket.disconnect();
    });

    it("player sends sound:play → PERMISSION_DENIED, no broadcast", async () => {
      const playerSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.playerToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      playerSocket.connect();
      await waitForConnect(playerSocket);
      await drain();

      const received: unknown[] = [];
      playerSocket.on("op", (env: unknown) => {
        const e = env as { type?: string };
        if (e?.type === "sound:state") received.push(env);
      });

      const ack = await sendOp(playerSocket, "sound:play", { src: "tavern.mp3" });
      expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });

      await drain();
      await new Promise((r) => setTimeout(r, 100));
      expect(received).toHaveLength(0);

      playerSocket.disconnect();
    });

    it("invalid payloads → VALIDATION_FAILED", async () => {
      const gmSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.gmToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      gmSocket.connect();
      await waitForConnect(gmSocket);
      await drain();

      const traversal = await sendOp(gmSocket, "sound:play", { src: "../x.mp3" });
      expect(traversal).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });

      const badExt = await sendOp(gmSocket, "sound:play", { src: "a.wav" });
      expect(badExt).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });

      const empty = await sendOp(gmSocket, "sound:play", {});
      expect(empty).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });

      gmSocket.disconnect();
    });

    it("play of a non-existent asset → NOT_FOUND", async () => {
      const gmSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.gmToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      gmSocket.connect();
      await waitForConnect(gmSocket);
      await drain();

      const ack = await sendOp(gmSocket, "sound:play", { src: "does-not-exist.mp3" });
      expect(ack).toMatchObject({ ok: false, code: "NOT_FOUND" });

      gmSocket.disconnect();
    });
  });

  // -------------------------------------------------------------------------
  // §SOUND STOP
  // -------------------------------------------------------------------------

  describe("sound:stop", () => {
    it("GM stop → broadcasts sound:state {state: null}", async () => {
      const gmSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.gmToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      gmSocket.connect();
      await waitForConnect(gmSocket);
      await drain();

      await sendOp(gmSocket, "sound:play", { src: "tavern.mp3" });

      const stopBroadcast = waitForEvent(
        gmSocket,
        "op",
        (env) => (env as { type?: string }).type === "sound:state",
        4000,
      );

      const ack = await sendOp(gmSocket, "sound:stop", {});
      expect(ack).toMatchObject({ ok: true });
      expect((ack as { result?: { state?: unknown } }).result?.state).toBeNull();

      const env = await stopBroadcast;
      expect((env as { payload?: { state?: unknown } }).payload?.state).toBeNull();

      gmSocket.disconnect();
    });

    it("player sends sound:stop → PERMISSION_DENIED, track keeps playing", async () => {
      const gmSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.gmToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      gmSocket.connect();
      await waitForConnect(gmSocket);
      await drain();

      await sendOp(gmSocket, "sound:play", { src: "tavern.mp3" });
      await drain();

      const playerSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.playerToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      playerSocket.connect();
      await waitForConnect(playerSocket);
      await drain();

      const received: unknown[] = [];
      playerSocket.on("op", (env2: unknown) => {
        if ((env2 as { type?: string })?.type === "sound:state") received.push(env2);
      });

      const ack = await sendOp(playerSocket, "sound:stop", {});
      expect(ack).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });

      await drain();
      await new Promise((r) => setTimeout(r, 100));
      // A rejected stop must not reach anyone: no broadcast, and the
      // persisted state still names the track the GM started.
      expect(received).toHaveLength(0);
      expect(getAmbientTrackState(ctx.fusionDb.raw)).toMatchObject({ src: "tavern.mp3" });

      playerSocket.disconnect();
      gmSocket.disconnect();
    });
  });

  // -------------------------------------------------------------------------
  // §LATE JOINER / SNAPSHOT
  // -------------------------------------------------------------------------

  describe("late joiner snapshot", () => {
    it("resync:full snapshot carries ambientTrack after a play", async () => {
      const gmSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.gmToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      gmSocket.connect();
      await waitForConnect(gmSocket);
      await drain();

      await sendOp(gmSocket, "sound:play", { src: "tavern.mp3" });

      const lateSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.playerToken,
        protocolVersion: PROTOCOL_VERSION,
      });

      const snapshotPromise = waitForEvent(
        lateSocket,
        "op",
        (env) => (env as { type?: string }).type === "resync:full",
        4000,
      );

      lateSocket.connect();
      await waitForConnect(lateSocket);

      const snapshotEnv = await snapshotPromise;
      const snapshot = (
        snapshotEnv as {
          payload?: { snapshot?: { ambientTrack?: { src?: string; startedAt?: number } | null } };
        }
      ).payload?.snapshot;
      expect(snapshot?.ambientTrack?.src).toBe("tavern.mp3");
      expect(typeof snapshot?.ambientTrack?.startedAt).toBe("number");

      gmSocket.disconnect();
      lateSocket.disconnect();
    });
  });

  // -------------------------------------------------------------------------
  // §PERSISTENCE
  // -------------------------------------------------------------------------

  describe("persistence across SocketManager restart", () => {
    it("ambient track survives a SocketManager restart over the same db", async () => {
      const gmSocket = connectClient(ctx.port, ctx.worldId, {
        token: ctx.gmToken,
        protocolVersion: PROTOCOL_VERSION,
      });
      gmSocket.connect();
      await waitForConnect(gmSocket);
      await drain();

      await sendOp(gmSocket, "sound:play", { src: "tavern.mp3" });
      gmSocket.disconnect();

      // Tear down the whole first server (SocketManager.close() also closes
      // the underlying http.Server it was attached to — socket.io does this
      // unconditionally, regardless of who created the server). Simulate a
      // process restart with a SECOND, independent Fastify + SocketManager
      // pair bound to a fresh port, opened over the SAME world.db file —
      // that's what "restart" means for persistence: the setting survives in
      // the db, not in any in-memory server state.
      await ctx.socketManager.close();
      await ctx.fastify.close();

      const fastify2 = Fastify({ logger: false }) as unknown as FastifyInstance;
      await fastify2.register(fastifyCookie);
      const authService2 = new AuthService(ctx.fusionDb.raw, ctx.secret, ctx.worldId);
      await registerAuthRoutes(fastify2, {
        authService: authService2,
        worldInfo: { id: ctx.worldId, title: "Sound Test World", systemId: "stub" },
      });
      await fastify2.listen({ port: 0, host: "127.0.0.1" });
      const address2 = fastify2.server.address();
      if (!address2 || typeof address2 === "string") throw new Error("Bad server address");
      const port2 = address2.port;

      const socketManager2 = new SocketManager({
        httpServer: fastify2.server,
        logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
        origin: `http://127.0.0.1:${String(port2)}`,
      });
      socketManager2.registerWorldNamespace({
        worldId: ctx.worldId,
        db: ctx.fusionDb.raw,
        secret: ctx.secret,
        authService: authService2,
        assetsDir: ctx.assetsDir,
      });

      const newSocket = connectClient(port2, ctx.worldId, {
        token: ctx.playerToken,
        protocolVersion: PROTOCOL_VERSION,
      });

      const snapshotPromise = waitForEvent(
        newSocket,
        "op",
        (env) => (env as { type?: string }).type === "resync:full",
        4000,
      );

      newSocket.connect();
      await waitForConnect(newSocket);

      const snapshotEnv = await snapshotPromise;
      const snapshot = (
        snapshotEnv as {
          payload?: { snapshot?: { ambientTrack?: { src?: string; startedAt?: number } | null } };
        }
      ).payload?.snapshot;
      expect(snapshot?.ambientTrack?.src).toBe("tavern.mp3");

      newSocket.disconnect();
      await socketManager2.close();
      await fastify2.close();
    });
  });
});
