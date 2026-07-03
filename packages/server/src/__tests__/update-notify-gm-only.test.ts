/**
 * Negative broadcast-scope test for `server.update_available` (M6/B5 —
 * REQ-DST-021, B5-FIXES item 6).
 *
 * boot.ts wires update notifications through
 * SocketManager.broadcastToGm, which emits ONLY to each world namespace's
 * "gm" room — joined on connect exclusively by sockets whose role passes
 * `isRolePrivileged` (GAMEMASTER/ASSISTANT; see socket-manager.ts's
 * connection handler). Update availability is installation-admin
 * information: a PLAYER socket in the same world must NEVER receive it.
 *
 * Follows the real-socket.io-client setup of socket.test.ts (GM + PLAYER
 * tokens against an ephemeral-port server) — the same double-role shape the
 * redaction suites use to prove an event does NOT reach the unprivileged
 * side. The positive assertion (GM received it) doubles as proof the
 * broadcast actually fired, so the player-side silence is meaningful rather
 * than a vacuously-passing "nothing happened at all".
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
// Helpers (same scaffolding as socket.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-update-notify-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  playerToken: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-world";

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
    worldInfo: { id: worldId, title: "Test World", systemId: "stub" },
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
  });

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", (err) => {
      reject(err);
    });
  });
}

function connectClient(port: number, worldId: string, auth: Record<string, unknown>): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
    auth,
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(intervalMs);
  }
  if (!predicate()) {
    throw new Error("waitFor: timed out");
  }
}

/**
 * Round-trips a system:ping so that, by the time it resolves, the server has
 * fully finished this socket's connection handler (including the gm-room
 * join) — events are processed in order per socket, so a broadcast sent
 * after this cannot race the room membership.
 */
function pingRoundTrip(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.emit("op", { type: "system:ping", ts: Date.now(), payload: {} }, () => {
      resolve();
    });
    setTimeout(() => {
      reject(new Error("Timeout waiting for ping ack"));
    }, 5000);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("server.update_available broadcast scope (REQ-DST-021)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("reaches a GM socket but NEVER a PLAYER socket connected to the same world", async () => {
    gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    playerSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.playerToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    const gmReceived: unknown[] = [];
    const playerReceived: unknown[] = [];
    gmSocket.on("server.update_available", (payload: unknown) => gmReceived.push(payload));
    playerSocket.on("server.update_available", (payload: unknown) => playerReceived.push(payload));

    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
    // Ensure both connection handlers (and the GM's gm-room join) fully ran.
    await Promise.all([pingRoundTrip(gmSocket), pingRoundTrip(playerSocket)]);

    // Same event name + payload shape boot.ts broadcasts on a positive
    // update check (UpdateCheckResult).
    ctx.socketManager.broadcastToGm("server.update_available", {
      checked: true,
      updateAvailable: true,
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      releaseNotes: "Big new feature",
    });

    // Positive half: the GM must receive it (proves the broadcast fired)...
    await waitFor(() => gmReceived.length > 0);
    // ...then a further grace window in which the player's copy would have
    // arrived if one had been (wrongly) sent — both sockets share the same
    // local transport, so delivery latency is comparable.
    await sleep(300);

    expect(gmReceived).toHaveLength(1);
    expect(gmReceived[0]).toMatchObject({ updateAvailable: true, latestVersion: "2.0.0" });

    // Negative half (the point of this test): the PLAYER got nothing.
    expect(playerReceived).toHaveLength(0);
  });
});
