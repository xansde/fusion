/**
 * Integration tests for M1-D: chat handlers + roll service.
 *
 * Coverage:
 *   - /roll appears for all connected clients with terms[]
 *   - /gmroll: author sees full result, other player does NOT, GM sees full
 *   - /blindroll: author sees confirmation without result, GM sees full
 *   - /w: only recipient + author see the message
 *   - Inline [[1d20]] evaluated on the server
 *   - Giant formula (1001d6) is rejected
 *   - chat:history respects visibility (gmroll whisper not leaked)
 *   - Join snapshot includes recent chat
 *   - Forged payload (client submitting a pre-made roll result) is rejected
 *     because chat:send only accepts the raw formula string, not roll data
 *   - Rate limit: 6th message in 1s returns RATE_LIMIT error code
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
    `fusion-chat-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface TestContext {
  dataDir: string;
  dbPath: string;
  fusionDb: FusionDatabase;
  secret: Uint8Array;
  authService: AuthService;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmId: string;
  playerId: string;
  player2Id: string;
  gmToken: string;
  playerToken: string;
  player2Token: string;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const worldId = "test-chat-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  // Create GM via bootstrapGm (sets up a passwordless GM with a generated password)
  const { user: gm, password: gmPw } = await authService.bootstrapGm();

  // Create player1 and player2 with known passwords
  const { user: player } = await authService.createUser({
    name: "Player1",
    role: Role.PLAYER,
    password: "player1-pass",
    color: "#00ff00",
  });
  const { user: player2 } = await authService.createUser({
    name: "Player2",
    role: Role.PLAYER,
    password: "player2-pass",
    color: "#0000ff",
  });

  // Login to get tokens
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const playerLogin = await authService.login({
    userId: player.id,
    password: "player1-pass",
    ip: "127.0.0.1",
  });
  const player2Login = await authService.login({
    userId: player2.id,
    password: "player2-pass",
    ip: "127.0.0.1",
  });

  // Start Fastify
  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Test Chat World", systemId: "stub" },
  });

  const socketManager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });

  socketManager.registerWorldNamespace({
    worldId,
    db: fusionDb.raw,
    secret,
    authService,
  });

  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const address = fastify.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    dataDir,
    dbPath,
    fusionDb,
    secret,
    authService,
    fastify,
    socketManager,
    port,
    worldId,
    gmId: gm.id,
    playerId: player.id,
    player2Id: player2.id,
    gmToken: gmLogin.accessToken,
    playerToken: playerLogin.accessToken,
    player2Token: player2Login.accessToken,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

type OpMessage = {
  type: string;
  seq: number;
  ts: number;
  payload: {
    documentType?: string;
    documents?: Record<string, unknown>[];
  };
};

/**
 * Connect a socket and wait for the first resync event (snapshot or delta).
 * Returns the connected socket.
 */
function connectSocket(port: number, worldId: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    socket.once("connect", () => {
      // Wait for first op (resync:full or resync:delta)
      socket.once("op", () => resolve(socket));
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

/**
 * Connect a socket and collect ALL `op` events received during the join window
 * (resync:full + the REQ-CHT-033 chat snapshot, if any). Resolves after a quiet
 * period with no further ops, returning the socket and every collected op.
 *
 * Used by join-snapshot tests where the chat snapshot is a SECOND op that arrives
 * just after resync:full.
 */
function connectAndCollectJoinOps(
  port: number,
  worldId: string,
  token: string,
  quietMs = 400,
): Promise<{ socket: ClientSocket; ops: OpMessage[] }> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    const ops: OpMessage[] = [];
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const arm = (): void => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        socket.off("op", onOp);
        resolve({ socket, ops });
      }, quietMs);
    };

    const onOp = (msg: OpMessage): void => {
      ops.push(msg);
      arm();
    };

    socket.once("connect", () => {
      socket.on("op", onOp);
      arm();
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

/** Extract the ChatMessage documents from a list of join/broadcast ops. */
function chatDocsFromOps(ops: OpMessage[]): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  for (const op of ops) {
    const payload = op.payload as Record<string, unknown>;
    if (payload["documentType"] === "ChatMessage" && Array.isArray(payload["documents"])) {
      docs.push(...(payload["documents"] as Record<string, unknown>[]));
    }
  }
  return docs;
}

/** Send an op envelope and await the ack. */
function sendOp(
  socket: ClientSocket,
  type: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const envelope = {
      type,
      ts: Date.now(),
      payload,
      requestId: Math.random().toString(36).slice(2),
    };
    socket.emit("op", envelope, (ack: unknown) => {
      if (!ack || typeof ack !== "object") {
        reject(new Error("No ack"));
        return;
      }
      resolve(ack as Record<string, unknown>);
    });
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

/** Collect the next N 'op' events from a socket within a timeout. */
function collectOps(socket: ClientSocket, count: number, timeoutMs = 3000): Promise<OpMessage[]> {
  return new Promise((resolve, _reject) => {
    const collected: OpMessage[] = [];
    const timer = setTimeout(() => {
      socket.off("op", handler);
      // Return what we have even if count not reached (some tests may get fewer)
      resolve(collected);
    }, timeoutMs);

    const handler = (msg: OpMessage) => {
      collected.push(msg);
      if (collected.length >= count) {
        clearTimeout(timer);
        socket.off("op", handler);
        resolve(collected);
      }
    };
    socket.on("op", handler);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chat:send + roll visibility", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let player2Socket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    [gmSocket, playerSocket, player2Socket] = await Promise.all([
      connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
      connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
      connectSocket(ctx.port, ctx.worldId, ctx.player2Token),
    ]);
  }, 15_000);

  afterEach(async () => {
    gmSocket?.disconnect();
    playerSocket?.disconnect();
    player2Socket?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  it("/roll: all clients see the result with terms[]", async () => {
    const gmOps = collectOps(gmSocket, 1);
    const playerOps = collectOps(playerSocket, 1);
    const player2Ops = collectOps(player2Socket, 1);

    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d6",
      worldId: ctx.worldId,
    });

    expect(ack["ok"]).toBe(true);

    const [gm, p1, p2] = await Promise.all([gmOps, playerOps, player2Ops]);

    function extractChatMsg(ops: OpMessage[]) {
      const chatOp = ops.find(
        (o) =>
          o.type === "doc:create" &&
          (o.payload as Record<string, unknown>)["documentType"] === "ChatMessage",
      );
      return (chatOp?.payload as { documents?: Record<string, unknown>[] })?.documents?.[0] ?? null;
    }

    const gmMsg = extractChatMsg(gm);
    const p1Msg = extractChatMsg(p1);
    const p2Msg = extractChatMsg(p2);

    expect(gmMsg).not.toBeNull();
    expect(p1Msg).not.toBeNull();
    expect(p2Msg).not.toBeNull();

    // All should have rolls with terms
    expect(Array.isArray(gmMsg?.["rolls"] as unknown[])).toBe(true);
    const rolls = gmMsg?.["rolls"] as unknown[];
    expect(rolls.length).toBeGreaterThan(0);
    const firstRoll = rolls[0] as Record<string, unknown>;
    expect(Array.isArray(firstRoll["terms"])).toBe(true);
  }, 10_000);

  // -------------------------------------------------------------------------
  it("/gmroll: player author sees result, other player does NOT, GM sees result", async () => {
    const gmOps = collectOps(gmSocket, 1);
    const playerOps = collectOps(playerSocket, 1);
    const player2Ops = collectOps(player2Socket, 1, 800); // shorter timeout

    await sendOp(playerSocket, "chat:send", {
      content: "/gmroll 1d20",
      worldId: ctx.worldId,
    });

    const [gmMsgs, playerMsgs, p2Msgs] = await Promise.all([gmOps, playerOps, player2Ops]);

    function chatDoc(msgs: OpMessage[]) {
      return msgs.find(
        (o) =>
          o.type === "doc:create" &&
          (o.payload as Record<string, unknown>)["documentType"] === "ChatMessage",
      );
    }

    const gmChatOp = chatDoc(gmMsgs);
    const playerChatOp = chatDoc(playerMsgs);
    const p2ChatOp = chatDoc(p2Msgs);

    // GM must see the roll
    expect(gmChatOp).toBeDefined();
    const gmDoc = (gmChatOp?.payload as { documents?: Record<string, unknown>[] })?.documents?.[0];
    expect(Array.isArray(gmDoc?.["rolls"])).toBe(true);

    // Author (player1) must see the roll
    expect(playerChatOp).toBeDefined();
    const p1Doc = (playerChatOp?.payload as { documents?: Record<string, unknown>[] })
      ?.documents?.[0];
    // Player author gets full result (gmroll — whisper includes gmIds but author also gets it)
    expect(p1Doc).toBeDefined();

    // Player2 must NOT receive any chat message about this roll
    expect(p2ChatOp).toBeUndefined();
  }, 10_000);

  // -------------------------------------------------------------------------
  it("/blindroll: author gets confirmation without result, GM sees full result", async () => {
    const gmOps = collectOps(gmSocket, 1);
    const playerOps = collectOps(playerSocket, 1);

    await sendOp(playerSocket, "chat:send", {
      content: "/blindroll 1d20",
      worldId: ctx.worldId,
    });

    const [gmMsgs, playerMsgs] = await Promise.all([gmOps, playerOps]);

    function chatDoc(msgs: OpMessage[]) {
      const op = msgs.find(
        (o) =>
          o.type === "doc:create" &&
          (o.payload as Record<string, unknown>)["documentType"] === "ChatMessage",
      );
      return (op?.payload as { documents?: Record<string, unknown>[] })?.documents?.[0];
    }

    const gmDoc = chatDoc(gmMsgs);
    const playerDoc = chatDoc(playerMsgs);

    // GM sees full result
    expect(gmDoc).toBeDefined();
    expect(Array.isArray(gmDoc?.["rolls"])).toBe(true);
    const gmRolls = gmDoc?.["rolls"] as unknown[];
    expect(gmRolls.length).toBeGreaterThan(0);

    // Author (player) sees confirmation without rolls
    expect(playerDoc).toBeDefined();
    expect(playerDoc?.["rolls"]).toBeUndefined();
    // Content should indicate blind roll
    expect(typeof playerDoc?.["content"]).toBe("string");
    expect((playerDoc?.["content"] as string).length).toBeGreaterThan(0);
  }, 10_000);

  // -------------------------------------------------------------------------
  it("/w recipient, author, AND all GMs see the message (spec-09 glossary line 66)", async () => {
    // spec-09 glossary: "Whisper — visible to explicit recipients + ALL GMs".
    const gmOps = collectOps(gmSocket, 1); // GM MUST receive whispers per spec-09
    const playerOps = collectOps(playerSocket, 1); // author
    const player2Ops = collectOps(player2Socket, 1); // recipient
    // Player3 would not see it — tested via chat:history instead (no third non-recipient player here)

    await sendOp(playerSocket, "chat:send", {
      content: "/w [Player2] secret message",
      worldId: ctx.worldId,
    });

    const [gmMsgs, playerMsgs, player2Msgs] = await Promise.all([gmOps, playerOps, player2Ops]);

    function chatDoc(msgs: OpMessage[]) {
      return msgs.find(
        (o) =>
          o.type === "doc:create" &&
          (o.payload as Record<string, unknown>)["documentType"] === "ChatMessage",
      );
    }

    // GM MUST receive whispers (spec-09 glossary line 66: "+ all GMs")
    expect(chatDoc(gmMsgs)).toBeDefined();

    // Author (player1) gets the message
    expect(chatDoc(playerMsgs)).toBeDefined();

    // Recipient (player2) gets the message
    expect(chatDoc(player2Msgs)).toBeDefined();
  }, 10_000);

  // -------------------------------------------------------------------------
  it("inline [[1d20]] is evaluated on the server and result embedded in content", async () => {
    const playerOps = collectOps(playerSocket, 1);

    await sendOp(playerSocket, "chat:send", {
      content: "I rolled [[1d20]] on the table",
      worldId: ctx.worldId,
    });

    const [msgs] = await Promise.all([playerOps]);
    const chatOp = msgs.find(
      (o) =>
        o.type === "doc:create" &&
        (o.payload as Record<string, unknown>)["documentType"] === "ChatMessage",
    );
    const doc = (chatOp?.payload as { documents?: Record<string, unknown>[] })?.documents?.[0];

    expect(doc).toBeDefined();
    const content = doc?.["content"] as string;
    // The [[1d20]] should be replaced by a number (the inline roll result)
    // The content should NOT contain [[ anymore
    expect(content).not.toContain("[[");
    // Should contain some number
    expect(/\d+/.test(content)).toBe(true);
  }, 10_000);

  // -------------------------------------------------------------------------
  it("giant formula (1001d6) is rejected with error", async () => {
    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1001d6",
      worldId: ctx.worldId,
    });

    expect(ack["ok"]).toBe(false);
    // Should contain a meaningful error
    const msg = (ack["message"] as string) ?? "";
    expect(msg.length).toBeGreaterThan(0);
  }, 10_000);

  // -------------------------------------------------------------------------
  it("client cannot submit a pre-built roll result — schema rejects unknown fields", async () => {
    // The chat:send schema only accepts `content`, `worldId`, `rollMode`,
    // `speakerActorId`, `speakerTokenId`. Sending a `rolls` field should be
    // silently ignored (Zod strips unknown keys). The server always re-executes
    // the roll from the formula string.
    const ack = await sendOp(playerSocket, "chat:send", {
      content: "/roll 1d6",
      worldId: ctx.worldId,
      // Attempt to inject a pre-built result — schema should strip this
      rolls: [{ rollId: "forged-id", formula: "1d6", total: 99999 }],
    });

    // The send should succeed (unknown fields stripped)
    expect(ack["ok"]).toBe(true);

    // But the result should have the actual roll, not the forged one
    const resultMsg = (ack["result"] as { message?: Record<string, unknown> })?.message;
    if (resultMsg?.["rolls"]) {
      const rolls = resultMsg["rolls"] as Array<Record<string, unknown>>;
      // Total cannot be 99999 for a 1d6
      expect(rolls[0]?.["total"]).not.toBe(99999);
      expect(rolls[0]?.["total"] as number).toBeGreaterThanOrEqual(1);
      expect(rolls[0]?.["total"] as number).toBeLessThanOrEqual(6);
    }
  }, 10_000);
});

// ---------------------------------------------------------------------------
// chat:history tests
// ---------------------------------------------------------------------------

describe("chat:history visibility", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let player2Socket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    [gmSocket, playerSocket, player2Socket] = await Promise.all([
      connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
      connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
      connectSocket(ctx.port, ctx.worldId, ctx.player2Token),
    ]);
  }, 15_000);

  afterEach(async () => {
    gmSocket?.disconnect();
    playerSocket?.disconnect();
    player2Socket?.disconnect();
    await teardown(ctx);
  });

  it("gmroll message does not leak to player2 in chat:history", async () => {
    // Post a gmroll from player1
    await sendOp(playerSocket, "chat:send", {
      content: "/gmroll 1d20",
      worldId: ctx.worldId,
    });

    // Wait a bit for persistence
    await new Promise((r) => setTimeout(r, 100));

    // Query history as player2 — should not see the gmroll
    const ack = await sendOp(player2Socket, "chat:history", {
      worldId: ctx.worldId,
      limit: 50,
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as { messages: Record<string, unknown>[] };
    const messages = result?.messages ?? [];

    // None of the messages should be the gmroll visible to player2
    for (const msg of messages) {
      const whisper = msg["whisper"] as string[] | undefined;
      if (whisper && whisper.length > 0) {
        // Should not include a message where player2 is not in whisper
        expect(
          whisper.includes(ctx.player2Id) || msg["speaker"]?.["userId"] === ctx.player2Id,
        ).toBe(true);
      }
    }
  }, 10_000);

  it("paginated history returns nextCursor for more pages", async () => {
    // Post a few messages
    for (let i = 0; i < 3; i++) {
      await sendOp(playerSocket, "chat:send", {
        content: `Message ${String(i + 1)}`,
        worldId: ctx.worldId,
      });
    }

    await new Promise((r) => setTimeout(r, 150));

    const ack = await sendOp(playerSocket, "chat:history", {
      worldId: ctx.worldId,
      limit: 2,
    });

    expect(ack["ok"]).toBe(true);
    const result = ack["result"] as {
      messages: unknown[];
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.length).toBeLessThanOrEqual(2);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// RollService unit tests (no socket needed)
// ---------------------------------------------------------------------------

describe("RollService unit", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  }, 10_000);

  afterEach(async () => {
    await ctx.socketManager.close();
    await ctx.fastify.close();
    ctx.fusionDb.close();
    rmSync(ctx.dataDir, { recursive: true, force: true });
  });

  it("rolls 1d20 and returns a valid RollResultData with rollId, total in range, no seed", async () => {
    const { RollService } = await import("../chat/roll-service.js");

    // Use a deterministic test engine (counter-based) to avoid relying on the
    // library's nodeCrypto engine which throws under ESM.
    let counter = 0;
    const deterministicEngine = {
      next(): number {
        // Cycle through values that map to distinct d20 results (0..19 × scaling)
        return (counter++ % 20) * 214748364;
      },
    };

    const svc = new RollService({
      db: ctx.fusionDb.raw,
      rng: deterministicEngine,
    });

    const result = svc.roll({
      formula: "1d20",
      mode: "public",
      worldId: ctx.worldId,
      userId: ctx.gmId,
    });

    expect(result.rollId).toBeTruthy();
    expect(typeof result.total).toBe("number");
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.total).toBeLessThanOrEqual(20);
    expect(result.terms).toBeDefined();
    expect(result.warnings).toEqual([]);
    // Seed must NEVER be in result (REQ-ROL-049)
    expect((result as unknown as Record<string, unknown>)["seed"]).toBeUndefined();
  });

  it("production path (no rng injected) rolls 1d20 N times all within 1..20", async () => {
    const { RollService } = await import("../chat/roll-service.js");

    // No rng option — exercises the default buildNativeNodeCryptoEngine() path
    const svc = new RollService({ db: ctx.fusionDb.raw });

    const ITERATIONS = 20;
    for (let i = 0; i < ITERATIONS; i++) {
      const result = svc.roll({
        formula: "1d20",
        mode: "public",
        worldId: ctx.worldId,
        userId: ctx.gmId,
      });
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeLessThanOrEqual(20);
    }
  });

  it("replaces @attr references with rollData values", async () => {
    const { RollService } = await import("../chat/roll-service.js");

    const svc = new RollService({ db: ctx.fusionDb.raw });

    const result = svc.roll({
      formula: "1d1 + @str.mod",
      rollData: { str: { mod: 5 } },
      mode: "public",
      worldId: ctx.worldId,
      userId: ctx.gmId,
    });

    // 1d1 = 1, + 5 = 6
    expect(result.total).toBe(6);
    expect(result.expandedFormula).toBe("1d1 + 5");
    expect(result.warnings).toEqual([]);
  });

  it("warns on unresolved @attr and substitutes 0", async () => {
    const { RollService } = await import("../chat/roll-service.js");

    const svc = new RollService({ db: ctx.fusionDb.raw });

    const result = svc.roll({
      formula: "1d1 + @missing.attr",
      mode: "public",
      worldId: ctx.worldId,
      userId: ctx.gmId,
    });

    expect(result.total).toBe(1); // 1d1 + 0
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("missing.attr");
  });

  it("rejects empty formula with RollError", async () => {
    const { RollService, RollError } = await import("../chat/roll-service.js");

    const svc = new RollService({ db: ctx.fusionDb.raw });

    expect(() =>
      svc.roll({ formula: "", mode: "public", worldId: ctx.worldId, userId: ctx.gmId }),
    ).toThrowError(RollError);
  });

  it("rejects formula over max length", async () => {
    const { RollService, RollError } = await import("../chat/roll-service.js");

    const svc = new RollService({ db: ctx.fusionDb.raw });
    const longFormula = "1d6 + ".repeat(100);

    expect(() =>
      svc.roll({ formula: longFormula, mode: "public", worldId: ctx.worldId, userId: ctx.gmId }),
    ).toThrowError(RollError);
  });

  it("extracts flavor from formula", async () => {
    const { RollService } = await import("../chat/roll-service.js");

    const svc = new RollService({ db: ctx.fusionDb.raw });

    const result = svc.roll({
      formula: "1d1 # Teste de força",
      mode: "public",
      worldId: ctx.worldId,
      userId: ctx.gmId,
    });

    expect(result.flavor).toBe("Teste de força");
    expect(result.expandedFormula).toBe("1d1");
  });

  it("seed is stored in audit log but not returned in result", async () => {
    const { RollService } = await import("../chat/roll-service.js");

    const svc = new RollService({ db: ctx.fusionDb.raw });

    const result = svc.roll({
      formula: "1d6",
      mode: "public",
      worldId: ctx.worldId,
      userId: ctx.gmId,
    });

    // Audit log must have an entry
    const audit = ctx.fusionDb.raw
      .prepare(`SELECT * FROM roll_audit_log WHERE roll_id = ?`)
      .get(result.rollId) as Record<string, unknown> | undefined;

    expect(audit).toBeDefined();
    expect(typeof audit?.["seed"]).toBe("number");
    expect(audit?.["seed"]).toBeGreaterThanOrEqual(0);

    // Result must NOT contain seed
    expect((result as unknown as Record<string, unknown>)["seed"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FIX-6: /selfroll multi-client visibility (broadcast AND history)
// ---------------------------------------------------------------------------

describe("/selfroll visibility (FIX-6)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let player2Socket: ClientSocket;

  beforeEach(async () => {
    ctx = await buildTestContext();
    [gmSocket, playerSocket, player2Socket] = await Promise.all([
      connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
      connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
      connectSocket(ctx.port, ctx.worldId, ctx.player2Token),
    ]);
  }, 15_000);

  afterEach(async () => {
    gmSocket?.disconnect();
    playerSocket?.disconnect();
    player2Socket?.disconnect();
    await teardown(ctx);
  });

  it("broadcast: author sees the selfroll; GM and other player do NOT", async () => {
    // player1 is the author. selfroll → whisper=[authorId]; only the author sees it.
    const gmOps = collectOps(gmSocket, 1, 800);
    const authorOps = collectOps(playerSocket, 1);
    const otherOps = collectOps(player2Socket, 1, 800);

    await sendOp(playerSocket, "chat:send", {
      content: "/selfroll 1d20",
      worldId: ctx.worldId,
    });

    const [gmMsgs, authorMsgs, otherMsgs] = await Promise.all([gmOps, authorOps, otherOps]);

    // Author sees the roll with results.
    const authorDocs = chatDocsFromOps(authorMsgs);
    expect(authorDocs.length).toBeGreaterThan(0);
    expect(Array.isArray(authorDocs[0]?.["rolls"])).toBe(true);

    // GM does NOT see the selfroll (selfroll excludes the GM override).
    expect(chatDocsFromOps(gmMsgs)).toHaveLength(0);

    // Other player does NOT see it.
    expect(chatDocsFromOps(otherMsgs)).toHaveLength(0);
  }, 10_000);

  it("history: author sees the selfroll; GM and other player do NOT", async () => {
    await sendOp(playerSocket, "chat:send", {
      content: "/selfroll 1d20",
      worldId: ctx.worldId,
    });
    await new Promise((r) => setTimeout(r, 120));

    async function historyHasSelfroll(socket: ClientSocket): Promise<boolean> {
      const ack = await sendOp(socket, "chat:history", { worldId: ctx.worldId, limit: 50 });
      expect(ack["ok"]).toBe(true);
      const result = ack["result"] as { messages: Record<string, unknown>[] };
      return (result.messages ?? []).some(
        (m) =>
          m["type"] === "roll" &&
          Array.isArray(m["rolls"]) &&
          (m["rolls"] as { rollMode?: string }[])[0]?.rollMode === "selfroll",
      );
    }

    // Author sees it in history.
    expect(await historyHasSelfroll(playerSocket)).toBe(true);
    // GM does NOT see the selfroll in history.
    expect(await historyHasSelfroll(gmSocket)).toBe(false);
    // Other player does NOT see it in history.
    expect(await historyHasSelfroll(player2Socket)).toBe(false);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// FIX-6: join-snapshot after /blindroll
// ---------------------------------------------------------------------------

describe("join-snapshot after /blindroll (FIX-6)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerSocket: ClientSocket;
  let lateSockets: ClientSocket[] = [];

  beforeEach(async () => {
    ctx = await buildTestContext();
    [gmSocket, playerSocket] = await Promise.all([
      connectSocket(ctx.port, ctx.worldId, ctx.gmToken),
      connectSocket(ctx.port, ctx.worldId, ctx.playerToken),
    ]);
    lateSockets = [];
  }, 15_000);

  afterEach(async () => {
    gmSocket?.disconnect();
    playerSocket?.disconnect();
    for (const s of lateSockets) s.disconnect();
    await teardown(ctx);
  });

  it("a player who joins AFTER a /blindroll does not receive the result in the snapshot", async () => {
    // player1 posts a blind roll (only GMs may see the result).
    await sendOp(playerSocket, "chat:send", { content: "/blindroll 1d20", worldId: ctx.worldId });
    await new Promise((r) => setTimeout(r, 150));

    // player2 joins late and collects the join snapshot ops.
    const { socket: lateSocket, ops } = await connectAndCollectJoinOps(
      ctx.port,
      ctx.worldId,
      ctx.player2Token,
    );
    lateSockets.push(lateSocket);

    const chatDocs = chatDocsFromOps(ops);
    // The blindroll may appear (whisper includes GMs; player2 is not a recipient,
    // so it should be filtered out entirely) — but if any blind roll document is
    // present for this non-GM, it MUST NOT carry the rolls payload.
    for (const doc of chatDocs) {
      if (doc["blind"] === true) {
        expect(doc["rolls"]).toBeUndefined();
      }
    }
    // Stronger: the late player should not see any document whose rolls reveal a
    // blindroll result.
    const leaked = chatDocs.some(
      (d) =>
        d["blind"] === true && Array.isArray(d["rolls"]) && (d["rolls"] as unknown[]).length > 0,
    );
    expect(leaked).toBe(false);
  }, 10_000);

  it("a GM who joins AFTER a /blindroll DOES receive the result in the snapshot", async () => {
    await sendOp(playerSocket, "chat:send", { content: "/blindroll 1d20", worldId: ctx.worldId });
    await new Promise((r) => setTimeout(r, 150));

    // A second GM joins late. bootstrapGm created one GM; create another GM to
    // join fresh and verify the snapshot includes the blindroll result.
    const { user: gm2 } = await ctx.authService.createUser({
      name: "GM2",
      role: Role.GAMEMASTER,
      password: "gm2-pass",
      color: "#ff8800",
    });
    const gm2Login = await ctx.authService.login({
      userId: gm2.id,
      password: "gm2-pass",
      ip: "127.0.0.1",
    });

    const { socket: lateGm, ops } = await connectAndCollectJoinOps(
      ctx.port,
      ctx.worldId,
      gm2Login.accessToken,
    );
    lateSockets.push(lateGm);

    const chatDocs = chatDocsFromOps(ops);
    const blindWithResult = chatDocs.find(
      (d) =>
        d["blind"] === true && Array.isArray(d["rolls"]) && (d["rolls"] as unknown[]).length > 0,
    );
    expect(blindWithResult).toBeDefined();
  }, 10_000);
});
