/**
 * E2E Integration Test — M1-B resync scenario
 *
 * Scenario:
 *   1. GM creates a Scene via doc:create → verify ack echoes requestId (REQ-NET-011)
 *   2. GM activates the scene via world:activeScene → client2 receives broadcast
 *   3. client2 disconnects
 *   4. GM makes exactly 3 doc:update ops on the scene
 *   5. client2 reconnects with lastSeq → receives exactly 3 ops via resync:delta
 *   6. Verify every ack in the flow echoes requestId
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
// Helpers (same pattern as sync.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-e2e-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface E2EContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  player2Token: string;
}

async function buildE2EContext(): Promise<E2EContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "e2e-resync-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "p2-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const p2Login = await authService.login({
    userId: player2.id,
    password: "p2-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "E2E Test World", systemId: "stub" },
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
    player2Token: p2Login.accessToken,
  };
}

async function teardownE2E(ctx: E2EContext): Promise<void> {
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
  requestId?: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.emit("op", { type, ts: Date.now(), requestId, payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout waiting for ack: ${type}`)), 8000);
  });
}

// ---------------------------------------------------------------------------
// E2E test suite
// ---------------------------------------------------------------------------

describe("E2E M1-B — full resync scenario", () => {
  let ctx: E2EContext;

  beforeEach(async () => {
    ctx = await buildE2EContext();
  });

  afterEach(async () => {
    await teardownE2E(ctx);
  });

  it("GM creates Scene + activates, client2 reconnects after 3 updates and resyncs exactly 3 ops with requestId in ack", async () => {
    // -----------------------------------------------------------------------
    // Step 1: Connect GM and client2
    // -----------------------------------------------------------------------
    const gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });

    // client2 needs to capture its initial snapshot seq
    let client2LastSeq = 0;
    const client2Socket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.player2Token,
      protocolVersion: PROTOCOL_VERSION,
    });

    // Set up listener before connect (boot buffer)
    const client2InitialSyncPromise = new Promise<void>((resolve) => {
      client2Socket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "resync:full") {
          const p = env["payload"] as Record<string, unknown>;
          const snap = p["snapshot"] as Record<string, unknown> | null;
          if (snap) client2LastSeq = snap["seq"] as number;
          resolve();
        } else if (env["type"] === "resync:delta") {
          client2LastSeq = env["seq"] as number;
          resolve();
        }
      });
    });

    gmSocket.connect();
    client2Socket.connect();
    await Promise.all([waitForConnect(gmSocket), waitForConnect(client2Socket)]);

    // Wait for client2 initial snapshot
    await client2InitialSyncPromise;

    // -----------------------------------------------------------------------
    // Step 2: GM creates a Scene (verify requestId is echoed — REQ-NET-011)
    // -----------------------------------------------------------------------
    const createRequestId = "e2e-create-req-001";

    // Listen for the broadcast on client2 before GM sends
    const broadcastPromise = new Promise<Record<string, unknown>>((resolve) => {
      client2Socket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "doc:create") {
          const pl = env["payload"] as Record<string, unknown>;
          if (pl["documentType"] === "Scene") {
            resolve(env);
          }
        }
      });
    });

    const createAck = await sendOp(
      gmSocket,
      "doc:create",
      { documentType: "Scene", data: [{ name: "E2E Scene" }] },
      createRequestId,
    );

    // Verify ack echoes requestId (REQ-NET-011)
    expect(createAck["ok"]).toBe(true);
    expect(createAck["requestId"]).toBe(createRequestId);
    expect(typeof createAck["seq"]).toBe("number");

    // Extract created scene _id
    const createdDocs = (createAck["result"] as Record<string, unknown>)["documents"] as Record<
      string,
      unknown
    >[];
    const sceneId = createdDocs[0]?.["_id"] as string;
    expect(typeof sceneId).toBe("string");

    // Wait for client2 to receive the broadcast. client2 is a PLAYER, so its
    // copy carries an empty `documents` — the scene is not on air yet
    // (REQ-CEN-071). The envelope itself still arrives, which is what this test
    // is about: the seq the player's mirror advances on must stay contiguous.
    const broadcastEnvelope = await broadcastPromise;
    expect(broadcastEnvelope["seq"]).toBe(createAck["seq"]);
    expect((broadcastEnvelope["payload"] as Record<string, unknown>)["documents"]).toEqual([]);

    // -----------------------------------------------------------------------
    // Step 3: GM activates the scene, client2 receives world:activeScene
    // -----------------------------------------------------------------------
    const activeSceneRequestId = "e2e-activescene-req-002";

    const activeSceneBroadcastPromise = new Promise<Record<string, unknown>>((resolve) => {
      client2Socket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "world:activeScene") {
          resolve(env);
        }
      });
    });

    // Activating a scene also emits a doc:update carrying the scene that went
    // on air (REQ-CEN-072, body BEFORE the world:activeScene pointer) and, for
    // any scene that left the air, the T032 version bump. This test measures
    // "3 ops after the client went away", so the baseline has to be the LAST
    // op the activation produced — whichever envelope carried the highest seq.
    const activationDocUpdatePromise = new Promise<Record<string, unknown>>((resolve) => {
      client2Socket.on("op", (env: Record<string, unknown>) => {
        if (env["type"] === "doc:update") {
          const p = env["payload"] as Record<string, unknown> | undefined;
          if (p?.["documentType"] === "Scene") resolve(env);
        }
      });
    });

    const activateAck = await sendOp(
      gmSocket,
      "world:activeScene",
      { sceneId },
      activeSceneRequestId,
    );

    expect(activateAck["ok"]).toBe(true);
    expect(activateAck["requestId"]).toBe(activeSceneRequestId);

    // client2 must receive the world:activeScene broadcast
    const activeSceneBroadcast = await activeSceneBroadcastPromise;
    expect(activeSceneBroadcast["type"]).toBe("world:activeScene");
    const activePayload = activeSceneBroadcast["payload"] as Record<string, unknown>;
    expect(activePayload["sceneId"]).toBe(sceneId);

    // Record client2's seq after receiving all broadcasts so far
    // client2LastSeq was from initial snapshot; advance it to account for
    // the doc:create, the doc:update carrying the scene that went on air and
    // the world:activeScene pointer. The body travels before the pointer
    // (REQ-CEN-072), so the pointer — whose seq the ack echoes — is the last
    // op of the activation: that is the baseline for "3 ops after".
    const activationDocUpdate = await activationDocUpdatePromise;
    expect(activationDocUpdate["seq"]).toBeLessThan(activateAck["seq"] as number);
    client2LastSeq = Math.max(activationDocUpdate["seq"] as number, activateAck["seq"] as number);

    // -----------------------------------------------------------------------
    // Step 4: Disconnect client2
    // -----------------------------------------------------------------------
    client2Socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // -----------------------------------------------------------------------
    // Step 5: GM makes exactly 3 doc:update ops
    // -----------------------------------------------------------------------
    const updateSeqs: number[] = [];

    for (let i = 0; i < 3; i++) {
      const updateRequestId = `e2e-update-req-${String(i + 10)}`;
      const updateAck = await sendOp(
        gmSocket,
        "doc:update",
        {
          documentType: "Scene",
          updates: [{ _id: sceneId, diff: { [`e2e_field_${String(i)}`]: i + 1 } }],
        },
        updateRequestId,
      );
      expect(updateAck["ok"]).toBe(true);
      expect(updateAck["requestId"]).toBe(updateRequestId);
      updateSeqs.push(updateAck["seq"] as number);
    }

    // Verify seqs are monotonically increasing
    for (let i = 1; i < updateSeqs.length; i++) {
      expect(updateSeqs[i]).toBeGreaterThan(updateSeqs[i - 1]!);
    }

    // -----------------------------------------------------------------------
    // Step 6: client2 reconnects with lastSeq → server sends resync:delta
    //         with exactly 3 ops
    // -----------------------------------------------------------------------
    const reconnectedClient2 = connectClient(ctx.port, ctx.worldId, {
      token: ctx.player2Token,
      protocolVersion: PROTOCOL_VERSION,
      lastSeq: client2LastSeq,
    });

    let resyncEnvelope: Record<string, unknown> | null = null;
    const resyncPromise = new Promise<void>((resolve) => {
      reconnectedClient2.on("op", (env: Record<string, unknown>) => {
        const t = env["type"];
        if (t === "resync:delta" || t === "resync:full") {
          resyncEnvelope = env;
          resolve();
        }
      });
    });

    reconnectedClient2.connect();
    await waitForConnect(reconnectedClient2);
    await resyncPromise;

    expect(resyncEnvelope).not.toBeNull();
    const re = resyncEnvelope!;

    // We expect a delta (3 ops are well within the 1000-op buffer)
    expect(re["type"]).toBe("resync:delta");

    const deltaPayload = re["payload"] as Record<string, unknown>;
    const deltaOps = deltaPayload["ops"] as Record<string, unknown>[];

    // Exactly 3 ops
    expect(deltaOps).toHaveLength(3);

    // Ops are all doc:update type with ascending seqs matching what GM sent
    for (let i = 0; i < 3; i++) {
      const op = deltaOps[i]!;
      expect(op["type"]).toBe("doc:update");
      expect(op["seq"]).toBe(updateSeqs[i]);
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------
    gmSocket.disconnect();
    reconnectedClient2.disconnect();
  }, 60000);

  // ---------------------------------------------------------------------------
  // Hidden-token delta-resync leak guard.
  //
  // Invariant (specs 04/05): a hidden token's position/existence must NEVER
  // reach a non-GM socket — including via delta resync replay.
  //
  // The auditor proved the previous guard was vacuously green: it filtered the
  // delta by payload.documentType === "Token" + payload.updates[]._id, a shape
  // that is NEVER buffered (embedded token ops are buffered as full Scene
  // documents under payload.documents[]).  The list was therefore always empty
  // regardless of whether the token leaked.  These tests assert against the
  // ACTUAL buffered shape and additionally scan the raw serialized delta for
  // the secret coordinates/name so no future shape drift can hide a leak.
  // ---------------------------------------------------------------------------

  // Secret marker values placed on the hidden token.  If ANY of these strings
  // survive in the serialized delta sent to a player, the token leaked.
  const SECRET_X = 7777;
  const SECRET_Y = 8888;
  const SECRET_NAME = "GhostSecretName";

  /** Connect a client and resolve once its initial snapshot/delta arrives. */
  async function connectAndAwaitInitialSync(
    auth: Record<string, unknown>,
  ): Promise<{ socket: ClientSocket; lastSeq: number }> {
    let lastSeq = 0;
    const socket = connectClient(ctx.port, ctx.worldId, {
      ...auth,
      protocolVersion: PROTOCOL_VERSION,
    });
    const initialSync = new Promise<void>((resolve) => {
      socket.on("op", (env: Record<string, unknown>) => {
        const t = env["type"];
        if (t === "resync:full") {
          const p = env["payload"] as Record<string, unknown>;
          const snap = p["snapshot"] as Record<string, unknown> | null;
          if (snap) lastSeq = snap["seq"] as number;
          resolve();
        } else if (t === "resync:delta") {
          lastSeq = env["seq"] as number;
          resolve();
        }
      });
    });
    socket.connect();
    await waitForConnect(socket);
    await initialSync;
    return { socket, lastSeq };
  }

  /**
   * Reconnect with the given lastSeq and resolve with the resync envelope.
   * The caller asserts on its type/contents.
   */
  async function reconnectAndCaptureResync(
    auth: Record<string, unknown>,
    lastSeq: number,
  ): Promise<{ socket: ClientSocket; envelope: Record<string, unknown> }> {
    const socket = connectClient(ctx.port, ctx.worldId, {
      ...auth,
      protocolVersion: PROTOCOL_VERSION,
      lastSeq,
    });
    let envelope: Record<string, unknown> | null = null;
    const resyncPromise = new Promise<void>((resolve) => {
      socket.on("op", (env: Record<string, unknown>) => {
        const t = env["type"];
        if (t === "resync:delta" || t === "resync:full") {
          envelope = env;
          resolve();
        }
      });
    });
    socket.connect();
    await waitForConnect(socket);
    await resyncPromise;
    if (!envelope) throw new Error("No resync envelope received");
    return { socket, envelope };
  }

  /** Collect every token across every Scene doc in a delta's ops. */
  function tokensInDelta(deltaPayload: Record<string, unknown>): Record<string, unknown>[] {
    const ops = deltaPayload["ops"] as Record<string, unknown>[];
    const tokens: Record<string, unknown>[] = [];
    for (const op of ops) {
      if (op["type"] !== "doc:create" && op["type"] !== "doc:update") continue;
      const pl = op["payload"] as Record<string, unknown> | undefined;
      if (!pl || pl["documentType"] !== "Scene") continue;
      const docs = pl["documents"] as Record<string, unknown>[] | undefined;
      if (!Array.isArray(docs)) continue;
      for (const doc of docs) {
        const docTokens = doc["tokens"];
        if (Array.isArray(docTokens)) {
          tokens.push(...(docTokens as Record<string, unknown>[]));
        }
      }
    }
    return tokens;
  }

  /** Build the payload for a hidden token carrying the secret marker values. */
  function hiddenTokenData(): Record<string, unknown> {
    return {
      name: SECRET_NAME,
      x: SECRET_X,
      y: SECRET_Y,
      hidden: true,
      width: 1,
      height: 1,
      rotation: 0,
      elevation: 0,
      disposition: 0,
      texture: null,
      actorId: null,
      bar1: { attribute: null },
      bar2: { attribute: null },
      flags: {},
    };
  }

  it("hidden token move during player disconnect does NOT leak via delta resync", async () => {
    const gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);

    const player = await connectAndAwaitInitialSync({ token: ctx.player2Token });

    // GM creates a Scene + a hidden token (BEFORE the player disconnects, so
    // the hidden token already exists in the player's seq baseline).
    const createSceneAck = await sendOp(
      gmSocket,
      "doc:create",
      { documentType: "Scene", data: [{ name: "Hidden Token Scene" }] },
      "hidden-test-scene-001",
    );
    expect(createSceneAck["ok"]).toBe(true);
    const sceneId = (
      (createSceneAck["result"] as Record<string, unknown>)["documents"] as Record<
        string,
        unknown
      >[]
    )[0]?.["_id"] as string;

    const addHiddenTokenAck = await sendOp(
      gmSocket,
      "doc:create",
      {
        documentType: "Token",
        data: [hiddenTokenData()],
        parent: { type: "Scene", id: sceneId },
      },
      "hidden-token-create-001",
    );
    expect(addHiddenTokenAck["ok"]).toBe(true);
    const tokenId = (
      (
        (addHiddenTokenAck["result"] as Record<string, unknown>)["parent"] as Record<
          string,
          unknown
        >
      )["tokens"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;
    expect(typeof tokenId).toBe("string");

    // Player's baseline seq = after the hidden token was added.
    const playerLastSeq = addHiddenTokenAck["seq"] as number;

    // Disconnect the player.
    player.socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // GM moves the hidden token while the player is away — this buffers a Scene
    // update with seq > playerLastSeq, guaranteeing a non-empty delta on
    // reconnect (so we exercise the delta path, not a vacuous resync:full).
    const moveAck = await sendOp(
      gmSocket,
      "doc:update",
      {
        documentType: "Token",
        updates: [
          { _id: tokenId, diff: { x: 1234, y: 5678 }, embedded: { type: "Token", id: sceneId } },
        ],
      },
      "hidden-token-move-001",
    );
    expect(moveAck["ok"]).toBe(true);
    expect(moveAck["seq"] as number).toBeGreaterThan(playerLastSeq);

    // Player reconnects.
    const { socket: reconnectedPlayer, envelope: re } = await reconnectAndCaptureResync(
      { token: ctx.player2Token },
      playerLastSeq,
    );

    // (a) Must be a genuine delta, not a fall-through to resync:full.
    expect(re["type"]).toBe("resync:delta");

    const deltaPayload = re["payload"] as Record<string, unknown>;

    // (b) The ENTIRE serialized delta must not contain the secret markers.
    //     SECRET_X/SECRET_Y/SECRET_NAME are deliberately distinctive values
    //     that cannot collide with timestamps/seqs.  The MOVED coordinates
    //     (1234/5678) are NOT checked by substring here — naked-number
    //     substring assertions are flaky (they collide with epoch-ms ts and
    //     seq digits) and are replaced by the structural token scan in (c).
    const serialized = JSON.stringify(deltaPayload);
    expect(serialized).not.toContain(String(SECRET_X));
    expect(serialized).not.toContain(String(SECRET_Y));
    expect(serialized).not.toContain(SECRET_NAME);

    // (c) STRUCTURAL: no Scene doc in the delta may carry the hidden token —
    //     not by _id, not by its moved coordinates.  Walking the actual
    //     tokens[] of every Scene in the delta is deterministic (no substring
    //     collisions with ts/seq).
    const MOVED_X = 1234;
    const MOVED_Y = 5678;
    const tokens = tokensInDelta(deltaPayload);
    expect(tokens.some((t) => t["_id"] === tokenId)).toBe(false);
    expect(tokens.some((t) => t["x"] === MOVED_X && t["y"] === MOVED_Y)).toBe(false);
    expect(tokens.some((t) => t["hidden"] === true)).toBe(false);

    gmSocket.disconnect();
    reconnectedPlayer.disconnect();
  }, 60000);

  it("hidden token CREATED during player disconnect leaves no trace in delta resync", async () => {
    const gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);

    const player = await connectAndAwaitInitialSync({ token: ctx.player2Token });

    // GM creates a Scene (no tokens yet) BEFORE the player disconnects.
    const createSceneAck = await sendOp(
      gmSocket,
      "doc:create",
      { documentType: "Scene", data: [{ name: "Created-While-Away Scene" }] },
      "created-away-scene-001",
    );
    expect(createSceneAck["ok"]).toBe(true);
    const sceneId = (
      (createSceneAck["result"] as Record<string, unknown>)["documents"] as Record<
        string,
        unknown
      >[]
    )[0]?.["_id"] as string;

    const playerLastSeq = createSceneAck["seq"] as number;

    // Disconnect the player.
    player.socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // GM creates a hidden token while the player is away.
    const addHiddenTokenAck = await sendOp(
      gmSocket,
      "doc:create",
      {
        documentType: "Token",
        data: [hiddenTokenData()],
        parent: { type: "Scene", id: sceneId },
      },
      "created-away-token-001",
    );
    expect(addHiddenTokenAck["ok"]).toBe(true);
    const tokenId = (
      (
        (addHiddenTokenAck["result"] as Record<string, unknown>)["parent"] as Record<
          string,
          unknown
        >
      )["tokens"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;
    expect(addHiddenTokenAck["seq"] as number).toBeGreaterThan(playerLastSeq);

    // Player reconnects.
    const { socket: reconnectedPlayer, envelope: re } = await reconnectAndCaptureResync(
      { token: ctx.player2Token },
      playerLastSeq,
    );

    expect(re["type"]).toBe("resync:delta");
    const deltaPayload = re["payload"] as Record<string, unknown>;

    // The hidden token created while away must leave no trace whatsoever.
    const serialized = JSON.stringify(deltaPayload);
    expect(serialized).not.toContain(String(SECRET_X));
    expect(serialized).not.toContain(String(SECRET_Y));
    expect(serialized).not.toContain(SECRET_NAME);

    const tokens = tokensInDelta(deltaPayload);
    expect(tokens.some((t) => t["_id"] === tokenId)).toBe(false);

    gmSocket.disconnect();
    reconnectedPlayer.disconnect();
  }, 60000);

  it("token made VISIBLE during player disconnect IS delivered by delta resync (live parity)", async () => {
    const gmSocket = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    gmSocket.connect();
    await waitForConnect(gmSocket);

    const player = await connectAndAwaitInitialSync({ token: ctx.player2Token });

    // GM creates a Scene + a hidden token before the player disconnects.
    const createSceneAck = await sendOp(
      gmSocket,
      "doc:create",
      { documentType: "Scene", data: [{ name: "Reveal Scene" }] },
      "reveal-scene-001",
    );
    expect(createSceneAck["ok"]).toBe(true);
    const sceneId = (
      (createSceneAck["result"] as Record<string, unknown>)["documents"] as Record<
        string,
        unknown
      >[]
    )[0]?.["_id"] as string;

    // Put the scene ON AIR: a Scene body only crosses to a non-privileged
    // socket while it is the active one (REQ-CEN-071/REQ-CEN-072), on the live
    // path and on this replay path alike. Off air there would be no Scene op in
    // the delta to look for the revealed token in.
    const activateAck = await sendOp(gmSocket, "world:activeScene", { sceneId }, "reveal-activate");
    expect(activateAck["ok"]).toBe(true);

    const addHiddenTokenAck = await sendOp(
      gmSocket,
      "doc:create",
      {
        documentType: "Token",
        data: [hiddenTokenData()],
        parent: { type: "Scene", id: sceneId },
      },
      "reveal-token-001",
    );
    expect(addHiddenTokenAck["ok"]).toBe(true);
    const tokenId = (
      (
        (addHiddenTokenAck["result"] as Record<string, unknown>)["parent"] as Record<
          string,
          unknown
        >
      )["tokens"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    const playerLastSeq = addHiddenTokenAck["seq"] as number;

    // Disconnect the player.
    player.socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // GM toggles the token hidden → visible while the player is away.
    const revealAck = await sendOp(
      gmSocket,
      "doc:update",
      {
        documentType: "Token",
        updates: [
          { _id: tokenId, diff: { hidden: false }, embedded: { type: "Token", id: sceneId } },
        ],
      },
      "reveal-toggle-001",
    );
    expect(revealAck["ok"]).toBe(true);
    expect(revealAck["seq"] as number).toBeGreaterThan(playerLastSeq);

    // Player reconnects — the now-visible token MUST be delivered (parity with
    // the live broadcast, where reveal arrives as a create-like Scene update).
    const { socket: reconnectedPlayer, envelope: re } = await reconnectAndCaptureResync(
      { token: ctx.player2Token },
      playerLastSeq,
    );

    expect(re["type"]).toBe("resync:delta");
    const deltaPayload = re["payload"] as Record<string, unknown>;
    const tokens = tokensInDelta(deltaPayload);

    // The revealed token must now be present, with its real coordinates/name.
    const revealed = tokens.find((t) => t["_id"] === tokenId);
    expect(revealed).toBeDefined();
    expect(revealed?.["hidden"]).toBe(false);
    expect(revealed?.["x"]).toBe(SECRET_X);
    expect(revealed?.["y"]).toBe(SECRET_Y);
    expect(revealed?.["name"]).toBe(SECRET_NAME);

    gmSocket.disconnect();
    reconnectedPlayer.disconnect();
  }, 60000);

  it("GM receives the hidden token in delta resync WITHOUT redaction", async () => {
    // Author GM (separate socket) creates the scene + hidden token first, so the
    // observer GM can establish a non-zero baseline seq AFTER they exist.  A
    // baseline of 0 would force resync:full (sendJoinSnapshot only attempts a
    // delta when lastSeq > 0), which would not exercise the GM delta path.
    const author = connectClient(ctx.port, ctx.worldId, {
      token: ctx.gmToken,
      protocolVersion: PROTOCOL_VERSION,
    });
    author.connect();
    await waitForConnect(author);

    const createSceneAck = await sendOp(
      author,
      "doc:create",
      { documentType: "Scene", data: [{ name: "GM Delta Scene" }] },
      "gm-delta-scene-001",
    );
    const sceneId = (
      (createSceneAck["result"] as Record<string, unknown>)["documents"] as Record<
        string,
        unknown
      >[]
    )[0]?.["_id"] as string;

    const addHiddenTokenAck = await sendOp(
      author,
      "doc:create",
      {
        documentType: "Token",
        data: [hiddenTokenData()],
        parent: { type: "Scene", id: sceneId },
      },
      "gm-delta-token-001",
    );
    const tokenId = (
      (
        (addHiddenTokenAck["result"] as Record<string, unknown>)["parent"] as Record<
          string,
          unknown
        >
      )["tokens"] as Record<string, unknown>[]
    )[0]?.["_id"] as string;

    // Observer GM connects now — its initial snapshot baseline is AFTER the
    // hidden token already exists (so the snapshot seq > 0).
    const gmObserver = await connectAndAwaitInitialSync({ token: ctx.gmToken });
    const gmObserverLastSeq = gmObserver.lastSeq;
    expect(gmObserverLastSeq).toBeGreaterThan(0);

    // Disconnect the observer GM, then move the hidden token while it is away.
    gmObserver.socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const moveAck = await sendOp(
      author,
      "doc:update",
      {
        documentType: "Token",
        updates: [
          { _id: tokenId, diff: { x: 4321, y: 8765 }, embedded: { type: "Token", id: sceneId } },
        ],
      },
      "gm-delta-move-001",
    );
    expect(moveAck["ok"]).toBe(true);
    expect(moveAck["seq"] as number).toBeGreaterThan(gmObserverLastSeq);

    // GM observer reconnects — as a privileged client it must receive the
    // hidden token UNREDACTED in the delta (the two-sided invariant).
    const { socket: reconnectedGm, envelope: re } = await reconnectAndCaptureResync(
      { token: ctx.gmToken },
      gmObserverLastSeq,
    );

    expect(re["type"]).toBe("resync:delta");
    const deltaPayload = re["payload"] as Record<string, unknown>;
    const tokens = tokensInDelta(deltaPayload);

    const seen = tokens.find((t) => t["_id"] === tokenId);
    expect(seen).toBeDefined();
    expect(seen?.["hidden"]).toBe(true);
    // GM sees the moved coordinates verbatim.
    expect(seen?.["x"]).toBe(4321);
    expect(seen?.["y"]).toBe(8765);

    author.disconnect();
    reconnectedGm.disconnect();
  }, 60000);
});
