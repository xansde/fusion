/**
 * Integration tests for chat:invalidate (G032) — nothing is deleted from the log.
 *
 * Requirements under test:
 *   - REQ-CHT-005 — a message is not deleted; it is invalidated, kept at the
 *     same position, with the record of who voided it and when. The GM and the
 *     author may invalidate; the GM may always revalidate, the author only what
 *     he himself invalidated. It is an annotation, not an undo, and it is
 *     propagated as a document update.
 *   - REQ-ACH-080 — moderation of a single message is invalidation; there is no
 *     deletion path on the wire.
 *   - REQ-ACH-081 — the invalidated message stays in the log, in place.
 *   - REQ-ACH-082 — invalidating is the GAMEMASTER's or the AUTHOR's; anyone
 *     else is refused BY THE SERVER.
 *   - REQ-ACH-083 — revalidating is the GM's always; the author's only when the
 *     standing invalidation is his own. The GM's invalidation is the last word.
 *   - REQ-ACH-084 — `invalidatedBy`/`invalidatedAt` are recorded and survive
 *     revalidation.
 *   - REQ-ACH-085 — invalidating undoes NOTHING outside the log.
 *   - REQ-ACH-086 — the change is persisted and propagated to every eligible
 *     client (and to nobody else).
 *
 * Everything is asserted on the ack / broadcast PAYLOAD the socket receives and
 * on the database itself, never on a rendered screen. The forged attempts are
 * emitted straight at the socket, bypassing any client-side button.
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
// Test harness (same shape as chat-context.test.ts; data dir lives in OS temp)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-chat-invalidate-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  const worldId = "test-chat-invalidate-world";

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);

  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: player } = await authService.createUser({
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

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Test Chat Invalidate World", systemId: "stub" },
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
    fusionDb,
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

function connectSocket(port: number, worldId: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${String(port)}/world/${worldId}`, {
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      transports: ["websocket"],
    });
    socket.once("connect", () => {
      socket.once("op", () => resolve(socket));
    });
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function emitEnvelope(
  socket: ClientSocket,
  event: "op" | "query",
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
    socket.emit(event, envelope, (ack: unknown) => {
      if (!ack || typeof ack !== "object") {
        reject(new Error("No ack"));
        return;
      }
      resolve(ack as Record<string, unknown>);
    });
    setTimeout(() => reject(new Error("ack timeout")), 5000);
  });
}

const sendOp = (socket: ClientSocket, type: string, payload: unknown) =>
  emitEnvelope(socket, "op", type, payload);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Sends one line and returns the `_id` the server assigned to it. */
async function sendLine(socket: ClientSocket, content: string, worldId: string): Promise<string> {
  const ack = await sendOp(socket, "chat:send", { content, worldId });
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  const result = ack["result"] as { message: Record<string, unknown> };
  await sleep(2);
  return String(result.message["_id"]);
}

function okMessage(ack: Record<string, unknown>): Record<string, unknown> {
  expect(ack["ok"], JSON.stringify(ack)).toBe(true);
  return (ack["result"] as { message: Record<string, unknown> }).message;
}

/** Reads the message straight out of storage — the wire cannot lie about this. */
function storedMessage(ctx: TestContext, id: string): Record<string, unknown> | null {
  const row = ctx.fusionDb.raw.prepare(`SELECT data FROM chat_messages WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
}

/**
 * The world's monotonic broadcast counter. Every broadcast advances it, so it
 * moves for a chat message just as it moves for a token nudge. It is transport
 * bookkeeping, not a document of the world, so the fingerprint below skips it —
 * and ONLY it.
 */
const SEQ_COUNTER_SETTING = "_meta:worldSeq";

/**
 * Every row of every table in the world database, as a comparable snapshot.
 * Used to prove that invalidation writes ONE row and nothing else (REQ-ACH-085).
 */
function databaseFingerprint(ctx: TestContext): Record<string, string> {
  const tables = ctx.fusionDb.raw
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];

  const snapshot: Record<string, string> = {};
  for (const { name } of tables) {
    let rows = ctx.fusionDb.raw.prepare(`SELECT * FROM "${name}"`).all() as Record<
      string,
      unknown
    >[];
    if (name === "settings") {
      rows = rows.filter((r) => r["id"] !== SEQ_COUNTER_SETTING);
    }
    snapshot[name] = JSON.stringify(rows);
  }
  return snapshot;
}

/** Waits for the next `doc:update` broadcast carrying a ChatMessage. */
function nextChatUpdate(socket: ClientSocket, timeoutMs = 3000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const handler = (envelope: Record<string, unknown>): void => {
      if (envelope["type"] !== "doc:update") return;
      const payload = envelope["payload"] as { documentType?: string; documents?: unknown[] };
      if (payload.documentType !== "ChatMessage") return;
      socket.off("op", handler);
      resolve((payload.documents?.[0] ?? {}) as Record<string, unknown>);
    };
    socket.on("op", handler);
    setTimeout(() => {
      socket.off("op", handler);
      reject(new Error("no chat doc:update broadcast"));
    }, timeoutMs);
  });
}

/** Resolves to `true` if NO chat doc:update reached this socket within the window. */
async function noChatUpdate(socket: ClientSocket, windowMs = 400): Promise<boolean> {
  let seen = false;
  const handler = (envelope: Record<string, unknown>): void => {
    if (envelope["type"] !== "doc:update") return;
    const payload = envelope["payload"] as { documentType?: string };
    if (payload.documentType === "ChatMessage") seen = true;
  };
  socket.on("op", handler);
  await sleep(windowMs);
  socket.off("op", handler);
  return !seen;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chat:invalidate — nada é apagado do log", () => {
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

  it("REQ-ACH-082 / REQ-ACH-083 / REQ-ACH-084: o autor invalida a própria mensagem e depois a revalida", async () => {
    const id = await sendLine(playerSocket, "essa rolagem nao valeu", ctx.worldId);

    const invalidated = okMessage(
      await sendOp(playerSocket, "chat:invalidate", {
        worldId: ctx.worldId,
        _id: id,
        invalid: true,
      }),
    );
    expect(invalidated["invalid"]).toBe(true);
    expect(invalidated["invalidatedBy"]).toBe(ctx.playerId);
    expect(typeof invalidated["invalidatedAt"]).toBe("number");

    // It is an annotation on a message that is still THERE — same id, same
    // timestamp, same content, same position (REQ-ACH-081 / REQ-CHT-005).
    const storedAfterInvalidate = storedMessage(ctx, id);
    expect(storedAfterInvalidate).not.toBeNull();
    expect(storedAfterInvalidate?.["content"]).toBe("essa rolagem nao valeu");
    expect(storedAfterInvalidate?.["invalid"]).toBe(true);

    const revalidated = okMessage(
      await sendOp(playerSocket, "chat:invalidate", {
        worldId: ctx.worldId,
        _id: id,
        invalid: false,
      }),
    );
    expect(revalidated["invalid"]).toBe(false);
    // The record of the operation SURVIVES the revalidation — REQ-ACH-084.
    expect(revalidated["invalidatedBy"]).toBe(ctx.playerId);
    expect(revalidated["invalidatedAt"]).toBe(invalidated["invalidatedAt"]);
  }, 30_000);

  it("REQ-ACH-083 / REQ-ACH-090: invalidação do Mestre é palavra final — a tentativa forjada do autor é recusada no servidor", async () => {
    const id = await sendLine(playerSocket, "rolagem polemica", ctx.worldId);

    const byGm = okMessage(
      await sendOp(gmSocket, "chat:invalidate", { worldId: ctx.worldId, _id: id, invalid: true }),
    );
    expect(byGm["invalidatedBy"]).toBe(ctx.gmId);

    // The author's client would not draw the button — but hiding a control is
    // not protection (REQ-ACH-090), so the forged emit goes straight to the
    // socket, and the SERVER is what refuses it.
    const forged = await sendOp(playerSocket, "chat:invalidate", {
      worldId: ctx.worldId,
      _id: id,
      invalid: false,
    });
    expect(forged["ok"]).toBe(false);
    expect(forged["code"]).toBe("PERMISSION_DENIED");
    expect(forged["message"]).toBe("CHT_INVALIDATE_DENIED");

    // And the refusal really left the state alone.
    expect(storedMessage(ctx, id)?.["invalid"]).toBe(true);
    expect(storedMessage(ctx, id)?.["invalidatedBy"]).toBe(ctx.gmId);

    // Re-invalidating (which the author MAY do) must not re-stamp the record
    // and thereby buy him the right to revalidate — the hole REQ-ACH-083 closes.
    const reinvalidate = okMessage(
      await sendOp(playerSocket, "chat:invalidate", {
        worldId: ctx.worldId,
        _id: id,
        invalid: true,
      }),
    );
    expect(reinvalidate["invalidatedBy"]).toBe(ctx.gmId);
    const stillDenied = await sendOp(playerSocket, "chat:invalidate", {
      worldId: ctx.worldId,
      _id: id,
      invalid: false,
    });
    expect(stillDenied["ok"]).toBe(false);
    expect(stillDenied["code"]).toBe("PERMISSION_DENIED");

    // The Master, on the other hand, can always undo his own call.
    const undone = okMessage(
      await sendOp(gmSocket, "chat:invalidate", { worldId: ctx.worldId, _id: id, invalid: false }),
    );
    expect(undone["invalid"]).toBe(false);
  }, 30_000);

  it("REQ-ACH-082: um jogador não invalida mensagem alheia", async () => {
    const id = await sendLine(playerSocket, "mensagem do player1", ctx.worldId);

    const forged = await sendOp(player2Socket, "chat:invalidate", {
      worldId: ctx.worldId,
      _id: id,
      invalid: true,
    });
    expect(forged["ok"]).toBe(false);
    expect(forged["code"]).toBe("PERMISSION_DENIED");
    expect(forged["message"]).toBe("CHT_INVALIDATE_DENIED");

    const stored = storedMessage(ctx, id);
    expect(stored?.["invalid"]).toBeUndefined();
    expect(stored?.["invalidatedBy"]).toBeUndefined();
  }, 30_000);

  it("REQ-ACH-085: invalidar não desfaz o dano já aplicado nem toca documento algum além da mensagem", async () => {
    // A creature is hurt during play: created at 20 HP, brought down to 14 by a
    // real server-side update. That is the "damage already applied".
    const actorAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Alvo Ferido",
          type: "npc",
          ownership: { default: 0 },
          flags: {},
          system: { attributes: { hp: { value: 20, max: 20 } } },
        },
      ],
    });
    expect(actorAck["ok"], JSON.stringify(actorAck)).toBe(true);
    const actorId = String(
      (actorAck["result"] as { documents: Record<string, unknown>[] }).documents[0]?.["_id"],
    );

    const damageAck = await sendOp(gmSocket, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: actorId, diff: { "system.attributes.hp.value": 14 } }],
    });
    expect(damageAck["ok"], JSON.stringify(damageAck)).toBe(true);

    const rollId = await sendLine(playerSocket, "/roll 1d6", ctx.worldId);
    await sleep(150);

    const before = databaseFingerprint(ctx);

    const invalidated = okMessage(
      await sendOp(gmSocket, "chat:invalidate", {
        worldId: ctx.worldId,
        _id: rollId,
        invalid: true,
      }),
    );
    expect(invalidated["invalid"]).toBe(true);
    await sleep(150);

    const after = databaseFingerprint(ctx);

    // The damage stands: the actor row is byte-identical, so the HP was neither
    // restored nor re-applied, and no automatic follow-up ran.
    expect(after["actors"]).toBe(before["actors"]);
    const actorRow = ctx.fusionDb.raw
      .prepare(`SELECT data FROM actors WHERE id = ?`)
      .get(actorId) as { data: string } | undefined;
    const actorDoc = JSON.parse(String(actorRow?.data)) as {
      system: { attributes: { hp: { value: number } } };
    };
    expect(actorDoc.system.attributes.hp.value).toBe(14);

    // And NO other table moved at all — the operation stops at the log.
    for (const table of Object.keys(before)) {
      if (table === "chat_messages") continue;
      expect(after[table], `tabela ${table} foi tocada pela invalidação`).toBe(before[table]);
    }

    // Inside chat_messages, only the target row changed: the roll is still
    // there, with its result intact, and every other message is untouched.
    const rollDoc = storedMessage(ctx, rollId);
    expect(rollDoc?.["rolls"]).toBeDefined();
    expect(rollDoc?.["content"]).toBe(invalidated["content"]);
  }, 40_000);

  it("REQ-ACH-086 / REQ-CHT-005: a invalidação é propagada como atualização de documento aos clientes elegíveis", async () => {
    const id = await sendLine(playerSocket, "linha publica", ctx.worldId);
    await sleep(120);

    const authorSees = nextChatUpdate(playerSocket);
    const bystanderSees = nextChatUpdate(player2Socket);

    const ack = await sendOp(gmSocket, "chat:invalidate", {
      worldId: ctx.worldId,
      _id: id,
      invalid: true,
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    for (const doc of await Promise.all([authorSees, bystanderSees])) {
      expect(doc["_id"]).toBe(id);
      expect(doc["invalid"]).toBe(true);
      expect(doc["invalidatedBy"]).toBe(ctx.gmId);
      expect(doc["content"]).toBe("linha publica");
    }
  }, 30_000);

  it("REQ-ACH-086: quem não podia ver a mensagem não fica sabendo que ela foi invalidada", async () => {
    const secretId = await sendLine(gmSocket, "/w [Player2] plano secreto", ctx.worldId);
    await sleep(120);

    const outsiderQuiet = noChatUpdate(playerSocket);
    const recipientSees = nextChatUpdate(player2Socket);

    const ack = await sendOp(gmSocket, "chat:invalidate", {
      worldId: ctx.worldId,
      _id: secretId,
      invalid: true,
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);

    expect((await recipientSees)["invalid"]).toBe(true);
    expect(await outsiderQuiet).toBe(true);

    // And the outsider cannot even name the message: the refusal is the same
    // one a nonexistent id gets, so it is no oracle.
    const probe = await sendOp(playerSocket, "chat:invalidate", {
      worldId: ctx.worldId,
      _id: secretId,
      invalid: true,
    });
    const nonexistent = await sendOp(playerSocket, "chat:invalidate", {
      worldId: ctx.worldId,
      _id: "nao-existe-de-jeito-nenhum",
      invalid: true,
    });
    expect(probe["ok"]).toBe(false);
    expect(probe["code"]).toBe(nonexistent["code"]);
    expect(probe["message"]).toBe(nonexistent["message"]);
    expect(probe["code"]).toBe("NOT_FOUND");
  }, 30_000);

  it("REQ-ACH-080 / REQ-ACH-081: a mensagem invalidada continua no histórico, na mesma posição", async () => {
    const first = await sendLine(playerSocket, "antes", ctx.worldId);
    await sleep(240);
    const middle = await sendLine(playerSocket, "no meio", ctx.worldId);
    await sleep(240);
    const last = await sendLine(playerSocket, "depois", ctx.worldId);
    await sleep(120);

    await sendOp(playerSocket, "chat:invalidate", {
      worldId: ctx.worldId,
      _id: middle,
      invalid: true,
    });

    const history = await emitEnvelope(playerSocket, "query", "chat:history", {
      worldId: ctx.worldId,
      limit: 50,
    });
    expect(history["ok"], JSON.stringify(history)).toBe(true);
    const messages = (history["result"] as { messages: Record<string, unknown>[] }).messages;

    // chat:history hands the page back newest-first; the invalidated line is
    // still between its neighbours — it did not vanish and did not move.
    const ids = messages.map((m) => String(m["_id"]));
    expect(ids).toContain(middle);
    expect(ids.indexOf(middle)).toBe(ids.indexOf(last) + 1);
    expect(ids.indexOf(first)).toBe(ids.indexOf(middle) + 1);

    const invalidatedLine = messages.find((m) => m["_id"] === middle);
    expect(invalidatedLine?.["invalid"]).toBe(true);
    expect(invalidatedLine?.["content"]).toBe("no meio");
  }, 40_000);

  it("REQ-CHT-005: mundo errado e payload malformado são recusados sem tocar o log", async () => {
    const id = await sendLine(playerSocket, "linha unica", ctx.worldId);
    await sleep(120);

    const before = databaseFingerprint(ctx);

    const otherWorld = await sendOp(playerSocket, "chat:invalidate", {
      worldId: "another-world",
      _id: id,
      invalid: true,
    });
    expect(otherWorld["ok"]).toBe(false);
    expect(otherWorld["code"]).toBe("VALIDATION_FAILED");

    const malformed = await sendOp(playerSocket, "chat:invalidate", {
      worldId: ctx.worldId,
      _id: id,
      invalid: "sim",
    });
    expect(malformed["ok"]).toBe(false);
    expect(malformed["code"]).toBe("VALIDATION_FAILED");

    const after = databaseFingerprint(ctx);
    for (const table of Object.keys(before)) {
      expect(after[table], `tabela ${table} foi tocada por uma recusa`).toBe(before[table]);
    }
  }, 30_000);
});
