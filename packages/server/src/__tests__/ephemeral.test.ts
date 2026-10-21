/**
 * Integration tests for ephemeral presence handlers (M1-E).
 *
 * Tests multi-client scenarios using real socket.io connections:
 *   - cursor:move arrives at others but NOT the sender
 *   - presence:ping arrives at ALL clients including sender
 *   - cursor rate limit: excess events are dropped (sender receives no bounce back anyway;
 *     verified by checking that rapid-fire events don't cause unexpected broadcasts)
 *   - ruler:update and ruler:clear rebroadcast to all
 *   - Nothing ephemeral appears in resync / snapshot
 *
 * REQ-NET-040..044, REQ-NET-071, D7
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
import { DocumentStore } from "../documents/index.js";
import { defaultSceneDocument } from "@fusion/shared";
import { PROTOCOL_VERSION } from "@fusion/shared";
import { verifyGrant } from "../assets/asset-grant.js";
import type { Envelope } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-ephemeral-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Scenes the pinned-area tests pin on. */
const PINNED_SCENE_IDS = [
  "sceneA0000000000",
  "sceneB0000000000",
  "sceneS0000000000",
  "sceneS2000000000",
  "sceneS3000000000",
];

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  playerToken: string;
  player2Token: string;
  secret: Uint8Array;
  gmId: string;
  gmColor: string;
  playerId: string;
  playerColor: string;
  player2Id: string;
  player2Color: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-world-eph";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player1 } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
  });
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const p1Login = await authService.login({
    userId: player1.id,
    password: "player1-pass",
    ip: "127.0.0.1",
  });
  const p2Login = await authService.login({
    userId: player2.id,
    password: "player2-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Ephemeral Test", systemId: "stub" },
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

  // Pinned areas persist in Scene.templates, so the scenes they name must exist (on air:
  // players may only act in the scene on air).
  const seedStore = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  for (const id of PINNED_SCENE_IDS) {
    seedStore.create("scenes", { ...defaultSceneDocument(id), active: true });
  }

  return {
    dataDir,
    fusionDb,
    fastify,
    socketManager,
    port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerToken: p1Login.accessToken,
    player2Token: p2Login.accessToken,
    gmId: gm.id,
    secret,
    gmColor: gm.color,
    playerId: player1.id,
    playerColor: player1.color,
    player2Id: player2.id,
    player2Color: player2.color,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
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
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function waitForEphemeral(
  socket: ClientSocket,
  type: string,
  timeoutMs = 2000,
): Promise<Envelope<unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ephemeral type="${type}"`));
    }, timeoutMs);

    const handler = (envelope: Envelope<unknown>): void => {
      if (envelope.type === type) {
        clearTimeout(timer);
        socket.off("ephemeral", handler);
        resolve(envelope);
      }
    };

    socket.on("ephemeral", handler);
  });
}

function waitForNoEphemeral(socket: ClientSocket, type: string, windowMs = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Envelope<unknown>): void => {
      if (envelope.type === type) {
        socket.off("ephemeral", handler);
        reject(new Error(`Unexpected ephemeral type="${type}" received`));
      }
    };
    socket.on("ephemeral", handler);
    setTimeout(() => {
      socket.off("ephemeral", handler);
      resolve();
    }, windowMs);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Ephemeral handlers — presence:cursor", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();

    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);

    gmSocket.connect();
    playerSocket.connect();

    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("cursor:move arrives at other clients but NOT the sender", async () => {
    const senderReceivedPromise = waitForNoEphemeral(gmSocket, "presence:cursor", 500);
    const receiverReceivedPromise = waitForEphemeral(playerSocket, "presence:cursor", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:cursor",
      ts: Date.now(),
      payload: { x: 100, y: 200 },
    });

    const [, received] = await Promise.all([senderReceivedPromise, receiverReceivedPromise]);
    expect(received.type).toBe("presence:cursor");
    const payload = received.payload as Record<string, unknown>;
    expect(payload.x).toBe(100);
    expect(payload.y).toBe(200);
  });

  it("cursor payload is forwarded with userId attached", async () => {
    const receiverPromise = waitForEphemeral(playerSocket, "presence:cursor", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:cursor",
      ts: Date.now(),
      payload: { x: 50, y: 75 },
    });

    const envelope = await receiverPromise;
    const payload = envelope.payload as Record<string, unknown>;
    expect(typeof payload.userId).toBe("string");
    expect(payload.userId).toBeTruthy();
  });
});

describe("Ephemeral handlers — presence:ping", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("presence:ping arrives at ALL clients including sender", async () => {
    const senderReceivedPromise = waitForEphemeral(gmSocket, "presence:ping", 2000);
    const receiverReceivedPromise = waitForEphemeral(playerSocket, "presence:ping", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:ping",
      ts: Date.now(),
      payload: { x: 300, y: 400, color: "#ff0000" },
    });

    const [senderEnv, receiverEnv] = await Promise.all([
      senderReceivedPromise,
      receiverReceivedPromise,
    ]);

    // Both should receive the ping
    expect(senderEnv.type).toBe("presence:ping");
    expect(receiverEnv.type).toBe("presence:ping");

    const sp = senderEnv.payload as Record<string, unknown>;
    const rp = receiverEnv.payload as Record<string, unknown>;
    expect(sp.x).toBe(300);
    expect(sp.y).toBe(400);
    expect(rp.x).toBe(300);
    expect(rp.y).toBe(400);
  });

  it("ping payload includes userId from sender", async () => {
    const receiverPromise = waitForEphemeral(playerSocket, "presence:ping", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:ping",
      ts: Date.now(),
      payload: { x: 10, y: 20 },
    });

    const envelope = await receiverPromise;
    const payload = envelope.payload as Record<string, unknown>;
    expect(typeof payload.userId).toBe("string");
  });
});

describe("Ephemeral handlers — ping identity and pull", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("stamps the sender's server-side colour and name on the ping", async () => {
    const p = waitForEphemeral(gmSocket, "presence:ping", 2000);
    playerSocket.emit("ephemeral", {
      type: "presence:ping",
      ts: Date.now(),
      payload: { x: 1, y: 2, color: "#000001" },
    });
    const payload = (await p).payload as Record<string, unknown>;
    expect(payload.color).toBe(ctx.playerColor);
    expect(payload.userName).toBe("Player1");
  });

  it("keeps pull when a privileged user asks for it", async () => {
    const p = waitForEphemeral(playerSocket, "presence:ping", 2000);
    gmSocket.emit("ephemeral", {
      type: "presence:ping",
      ts: Date.now(),
      payload: { x: 7, y: 8, pull: true },
    });
    const payload = (await p).payload as Record<string, unknown>;
    expect(payload.pull).toBe(true);
  });

  it("strips pull from a player's ping (only the GM moves the camera)", async () => {
    const p = waitForEphemeral(gmSocket, "presence:ping", 2000);
    playerSocket.emit("ephemeral", {
      type: "presence:ping",
      ts: Date.now(),
      payload: { x: 7, y: 8, pull: true },
    });
    const payload = (await p).payload as Record<string, unknown>;
    expect(payload.x).toBe(7);
    expect(payload.pull).toBeUndefined();
  });
});

describe("Ephemeral handlers — presence:show (Show Players)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("reaches the player with an image grant signed for that player and that name", async () => {
    const p = waitForEphemeral(playerSocket, "presence:show", 2000);
    gmSocket.emit("ephemeral", {
      type: "presence:show",
      ts: Date.now(),
      payload: { title: "A porta", text: "Runas brilham.", image: "maps//door one.webp" },
    });
    const payload = (await p).payload as {
      title: string;
      text: string;
      image: { name: string; token: string; exp: number; userId: string };
    };
    expect(payload.title).toBe("A porta");
    expect(payload.text).toBe("Runas brilham.");
    expect(payload.image.name).toBe("maps/door one.webp");
    expect(payload.image.userId).toBe(ctx.playerId);
    expect(
      verifyGrant({
        scope: "doc",
        token: payload.image.token,
        userId: payload.image.userId,
        exp: payload.image.exp,
        name: "maps/door one.webp",
        secret: ctx.secret,
      }),
    ).toBe(true);
    // The grant opens that file only.
    expect(
      verifyGrant({
        scope: "doc",
        token: payload.image.token,
        userId: payload.image.userId,
        exp: payload.image.exp,
        name: "maps/other.webp",
        secret: ctx.secret,
      }),
    ).toBe(false);
  });

  it("ignores a player trying to show something", async () => {
    let received = false;
    gmSocket.on("ephemeral", (e: Envelope) => {
      if (e.type === "presence:show") received = true;
    });
    playerSocket.emit("ephemeral", {
      type: "presence:show",
      ts: Date.now(),
      payload: { text: "falso" },
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(received).toBe(false);
  });

  it("refuses a traversal image name and an empty payload", async () => {
    let received = 0;
    playerSocket.on("ephemeral", (e: Envelope) => {
      if (e.type === "presence:show") received++;
    });
    gmSocket.emit("ephemeral", {
      type: "presence:show",
      ts: Date.now(),
      payload: { image: "../world.db" },
    });
    await new Promise((r) => setTimeout(r, 700));
    gmSocket.emit("ephemeral", { type: "presence:show", ts: Date.now(), payload: {} });
    await new Promise((r) => setTimeout(r, 700));
    expect(received).toBe(0);
  });
});

describe("Ephemeral handlers — presence:ruler", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("ruler:update rebroadcasts to all clients including sender", async () => {
    const senderPromise = waitForEphemeral(gmSocket, "presence:ruler", 2000);
    const receiverPromise = waitForEphemeral(playerSocket, "presence:ruler", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:ruler",
      ts: Date.now(),
      payload: {
        waypoints: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      },
    });

    const [sEnv, rEnv] = await Promise.all([senderPromise, receiverPromise]);

    expect(sEnv.type).toBe("presence:ruler");
    expect(rEnv.type).toBe("presence:ruler");
    const sp = sEnv.payload as Record<string, unknown>;
    expect(Array.isArray(sp.waypoints)).toBe(true);
  });

  it("ruler:clear rebroadcasts userId to all clients", async () => {
    const senderPromise = waitForEphemeral(gmSocket, "presence:ruler:clear", 2000);
    const receiverPromise = waitForEphemeral(playerSocket, "presence:ruler:clear", 2000);

    gmSocket.emit("ephemeral", {
      type: "presence:ruler:clear",
      ts: Date.now(),
      payload: {},
    });

    const [sEnv, rEnv] = await Promise.all([senderPromise, receiverPromise]);

    expect(sEnv.type).toBe("presence:ruler:clear");
    expect(rEnv.type).toBe("presence:ruler:clear");
    const sp = sEnv.payload as Record<string, unknown>;
    expect(typeof sp.userId).toBe("string");
  });
});

describe("Ephemeral handlers — presence:template", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  const template = {
    kind: "cone",
    sizeFt: 15,
    origin: { x: 500, y: 500 },
    direction: 45,
  };

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("rebroadcasts a live template with the author id", async () => {
    const got = waitForEphemeral(playerSocket, "presence:template", 2000);
    gmSocket.emit("ephemeral", {
      type: "presence:template",
      ts: Date.now(),
      payload: { template },
    });
    const env = await got;
    const p = env.payload as Record<string, unknown>;
    expect(typeof p.userId).toBe("string");
    expect((p.template as Record<string, unknown>).kind).toBe("cone");
  });

  it("drops a malformed template (unknown kind)", async () => {
    let seen = false;
    playerSocket.on("ephemeral", (e: Envelope<unknown>) => {
      if (e.type === "presence:template") seen = true;
    });
    gmSocket.emit("ephemeral", {
      type: "presence:template",
      ts: Date.now(),
      payload: { template: { ...template, kind: "spiral" } },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toBe(false);
  });

  it("a pinned template reaches everyone and is replayed on sync", async () => {
    const pinned = waitForEphemeral(playerSocket, "presence:template:pin", 2000);
    gmSocket.emit("ephemeral", {
      type: "presence:template:pin",
      ts: Date.now(),
      payload: { id: "t1", sceneId: "sceneA0000000000", template },
    });
    const pin = await pinned;
    expect((pin.payload as Record<string, unknown>).id).toBe("t1");

    const replay = waitForEphemeral(playerSocket, "presence:template:pinned", 2000);
    playerSocket.emit("ephemeral", {
      type: "presence:template:sync",
      ts: Date.now(),
      payload: { sceneId: "sceneA0000000000" },
    });
    const env = await replay;
    const list = (env.payload as { templates: Array<{ id: string }> }).templates;
    expect(list.map((t) => t.id)).toEqual(["t1"]);
  });

  it("only the author or a GM may remove a pinned template", async () => {
    gmSocket.emit("ephemeral", {
      type: "presence:template:pin",
      ts: Date.now(),
      payload: { id: "t2", sceneId: "sceneB0000000000", template },
    });
    await waitForEphemeral(playerSocket, "presence:template:pin", 2000);

    // The player is neither author nor GM: refused, template stays.
    playerSocket.emit("ephemeral", {
      type: "presence:template:unpin",
      ts: Date.now(),
      payload: { id: "t2", sceneId: "sceneB0000000000" },
    });
    await new Promise((r) => setTimeout(r, 200));
    const replay = waitForEphemeral(gmSocket, "presence:template:pinned", 2000);
    gmSocket.emit("ephemeral", {
      type: "presence:template:sync",
      ts: Date.now(),
      payload: { sceneId: "sceneB0000000000" },
    });
    expect(((await replay).payload as { templates: unknown[] }).templates).toHaveLength(1);

    // The author removes it.
    const gone = waitForEphemeral(playerSocket, "presence:template:unpin", 2000);
    gmSocket.emit("ephemeral", {
      type: "presence:template:unpin",
      ts: Date.now(),
      payload: { id: "t2", sceneId: "sceneB0000000000" },
    });
    expect(((await gone).payload as Record<string, unknown>).id).toBe("t2");
  });
});

describe("Ephemeral handlers — anchored and styled templates", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  const template = {
    kind: "emanation",
    sizeFt: 10,
    origin: { x: 150, y: 150 },
    direction: 0,
    footprint: { i: 1, j: 1, width: 1, height: 1 },
    tokenId: "tok-a",
    style: { color: "#ff3b30", border: "thick", fill: 0.5 },
  };

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("keeps the token link and the style of a pinned template", async () => {
    const pinned = waitForEphemeral(playerSocket, "presence:template:pin", 2000);
    gmSocket.emit("ephemeral", {
      type: "presence:template:pin",
      ts: Date.now(),
      payload: { id: "a1", sceneId: "sceneS0000000000", template },
    });
    const t = ((await pinned).payload as { template: Record<string, unknown> }).template;
    expect(t.tokenId).toBe("tok-a");
    expect(t.style).toEqual(template.style);
  });

  it("the author restyles a pinned template and everyone gets the new style", async () => {
    gmSocket.emit("ephemeral", {
      type: "presence:template:pin",
      ts: Date.now(),
      payload: { id: "a2", sceneId: "sceneS2000000000", template },
    });
    await waitForEphemeral(playerSocket, "presence:template:pin", 2000);
    const again = waitForEphemeral(playerSocket, "presence:template:pin", 2000);
    gmSocket.emit("ephemeral", {
      type: "presence:template:style",
      ts: Date.now(),
      payload: {
        id: "a2",
        sceneId: "sceneS2000000000",
        style: { color: "#0a84ff", border: "thin", fill: 0.2 },
      },
    });
    const t = ((await again).payload as { template: Record<string, unknown> }).template;
    expect(t.style).toEqual({ color: "#0a84ff", border: "thin", fill: 0.2 });
    expect(t.tokenId).toBe("tok-a");
  });

  it("a player who is not the author cannot restyle", async () => {
    gmSocket.emit("ephemeral", {
      type: "presence:template:pin",
      ts: Date.now(),
      payload: { id: "a3", sceneId: "sceneS3000000000", template },
    });
    await waitForEphemeral(playerSocket, "presence:template:pin", 2000);
    let seen = false;
    gmSocket.on("ephemeral", (e: { type: string }) => {
      if (e.type === "presence:template:pin") seen = true;
    });
    playerSocket.emit("ephemeral", {
      type: "presence:template:style",
      ts: Date.now(),
      payload: {
        id: "a3",
        sceneId: "sceneS3000000000",
        style: { color: "#0a84ff", border: "thin", fill: 0.2 },
      },
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(seen).toBe(false);
  });

  it("relays the tokenId of a ping", async () => {
    const got = waitForEphemeral(gmSocket, "presence:ping", 2000);
    playerSocket.emit("ephemeral", {
      type: "presence:ping",
      ts: Date.now(),
      payload: { x: 10, y: 20, tokenId: "tok-a" },
    });
    expect(((await got).payload as Record<string, unknown>).tokenId).toBe("tok-a");
  });
});

describe("Ephemeral handlers — rate limiting", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("cursor rate limit: rapid-fire events cause some to be dropped", async () => {
    // Send 10 cursor events very quickly (much faster than 50 ms min interval)
    const received: unknown[] = [];
    playerSocket.on("ephemeral", (env: Envelope<unknown>) => {
      if (env.type === "presence:cursor") {
        received.push(env);
      }
    });

    for (let i = 0; i < 10; i++) {
      gmSocket.emit("ephemeral", {
        type: "presence:cursor",
        ts: Date.now(),
        payload: { x: i * 10, y: i * 10 },
      });
    }

    // Wait enough time for all to propagate if they weren't rate-limited
    await new Promise<void>((resolve) => setTimeout(resolve, 400));

    // At 50 ms min interval, only ~1 event should pass in a burst of 10 rapid messages
    // (The first one is always allowed, subsequent ones within 50 ms are dropped)
    expect(received.length).toBeLessThan(10);
    // At least 1 should get through
    expect(received.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Ephemeral events — do not appear in resync/snapshot", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    gmSocket.connect();
    await waitForConnect(gmSocket);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    await teardown(ctx);
  });

  it("ephemeral events are not included in world snapshot", async () => {
    // Emit some ephemeral events
    for (let i = 0; i < 3; i++) {
      gmSocket.emit("ephemeral", {
        type: "presence:cursor",
        ts: Date.now(),
        payload: { x: i * 10, y: i * 10 },
      });
    }

    // Request resync and verify no ephemeral events in the response
    const resyncResponse = await new Promise<Record<string, unknown>>((resolve, reject) => {
      gmSocket.emit(
        "op",
        { type: "resync:request", ts: Date.now(), payload: { lastSeq: 0 } },
        (ack: Record<string, unknown>) => resolve(ack),
      );
      setTimeout(() => reject(new Error("Timeout on resync")), 3000);
    });

    // The resync response should be ok and contain snapshot/delta — no ephemeral events
    expect(resyncResponse.ok).toBe(true);
    // If it's a delta, ops array should not contain presence:cursor, presence:ping etc.
    const result = resyncResponse.result as Record<string, unknown> | undefined;
    if (result && Array.isArray(result.ops)) {
      const ephemeralOps = (result.ops as Array<{ type: string }>).filter(
        (op) =>
          op.type === "presence:cursor" ||
          op.type === "presence:ping" ||
          op.type === "presence:ruler",
      );
      expect(ephemeralOps).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-NET-043 — presence:online roster
// ---------------------------------------------------------------------------
//
// This is the payload attachPresenceSync.ts wires into presenceState.onlineUsers
// (feeding resolveSpeakerColor/A022 and resolveInvalidatorLabel/A024 in
// ChatMessage.svelte). The client-side wiring is covered separately in
// attachPresenceSync.test.ts; these tests inspect the actual socket payload
// the server puts on the wire, per rule 7.

describe("Ephemeral handlers — presence:online (REQ-NET-043)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerSocket = connectClient(ctx.port, ctx.worldId, ctx.playerToken);
    gmSocket.connect();
    playerSocket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(playerSocket)]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerSocket.disconnect();
    await teardown(ctx);
  });

  it("broadcasts the full roster with color to already-connected clients when a new user connects", async () => {
    const rosterPromise = waitForEphemeral(playerSocket, "presence:online", 2000);

    const player2Socket = connectClient(ctx.port, ctx.worldId, ctx.player2Token);
    player2Socket.connect();
    await waitForConnect(player2Socket);

    const envelope = await rosterPromise;
    const payload = envelope.payload as { users: Array<Record<string, unknown>> };
    expect(Array.isArray(payload.users)).toBe(true);

    // REQ-NET-043: roster carries active state AND color (REQ-USR-002) for
    // every account — this is exactly what resolveSpeakerColor/resolveInvalidatorLabel
    // in ChatMessage.svelte need from presenceState.onlineUsers.
    const gmRow = payload.users.find((u) => u["userId"] === ctx.gmId);
    const player1Row = payload.users.find((u) => u["userId"] === ctx.playerId);
    const player2Row = payload.users.find((u) => u["userId"] === ctx.player2Id);

    expect(gmRow).toMatchObject({ online: true, color: ctx.gmColor });
    expect(player1Row).toMatchObject({ online: true, color: ctx.playerColor });
    expect(player2Row).toMatchObject({ online: true, color: ctx.player2Color });

    player2Socket.disconnect();
  });

  it("re-broadcasts the roster with online:false (account still listed) when a user disconnects", async () => {
    const player2Socket = connectClient(ctx.port, ctx.worldId, ctx.player2Token);
    player2Socket.connect();
    await waitForConnect(player2Socket);
    // Drain the connect-triggered broadcast before arming the disconnect one.
    await waitForEphemeral(playerSocket, "presence:online", 2000);

    const rosterPromise = waitForEphemeral(playerSocket, "presence:online", 2000);
    player2Socket.disconnect();

    const envelope = await rosterPromise;
    const payload = envelope.payload as { users: Array<Record<string, unknown>> };
    const player2Row = payload.users.find((u) => u["userId"] === ctx.player2Id);

    // The account is still in the roster (it did not stop existing) but no
    // longer online — this is what lets an invalidation stamp keep resolving
    // a name for a GM who has since logged off.
    expect(player2Row).toMatchObject({ online: false, color: ctx.player2Color });
  });
});
