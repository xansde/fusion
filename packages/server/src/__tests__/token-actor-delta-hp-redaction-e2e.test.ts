/**
 * REQ-DOC-062 / REQ-TOK-072 (spec 02-modelo-de-dados.md §501-508, spec
 * 41-token.md Fase 6, TK072) — an UNLINKED token's own `actorDelta` carries
 * `system.attributes.hp` inside the `Scene` document, a different emission
 * funnel from the `Actor` one `token-hp-redaction-e2e.test.ts` proves. This
 * file proves that funnel is ALSO redacted, across the FOUR emission paths
 * REQ-NET-096 names: snapshot on join, live broadcast, delta replay on
 * resync, and the ack echoed back to the requester.
 *
 * REQ-DOC-062: the `actorDelta` cut is fail-closed and BY ROLE — every
 * non-privileged viewer loses the delta's hp, not just non-owners. This is
 * the resolution TK072's own text records for the DEC-DOC-12/DEC-TOK-10
 * tension (tasks.md, Fase 6 header): "papel primeiro" — the known cost is
 * that even the player who OWNS the base Actor (an unlinked familiar posted
 * on the map) reads the base actor's hp, never the token's own delta.
 *
 * Infrastructure mirrors `token-hidden-seenby-e2e.test.ts` (same day, same
 * repo, same four-path harness).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
// Harness (mirrors token-hidden-seenby-e2e.test.ts)
// ---------------------------------------------------------------------------

interface TestContext {
  dataDir: string;
  fusionDb: FusionDatabase;
  fastify: FastifyInstance;
  socketManager: SocketManager;
  port: number;
  worldId: string;
  gmToken: string;
  playerAToken: string;
  playerAId: string;
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-token-delta-hp-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const worldId = "token-delta-hp-world";
  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: join(dataDir, "world.db"), skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, join(dataDir, "world.db"));

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: playerA } = await authService.createUser({
    name: "Jogadora A",
    role: Role.PLAYER,
    password: "player-a-pass",
  });

  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const aLogin = await authService.login({
    userId: playerA.id,
    password: "player-a-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Token Delta Hp World", systemId: "stub" },
  });
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
    playerAToken: aLogin.accessToken,
    playerAId: playerA.id,
  };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.socketManager.close();
  await ctx.fastify.close();
  ctx.fusionDb.close();
  rmSync(ctx.dataDir, { recursive: true, force: true });
}

function connectClient(ctx: TestContext, token: string, lastSeq?: number): ClientSocket {
  return ioClient(`http://127.0.0.1:${String(ctx.port)}/world/${ctx.worldId}`, {
    auth: { token, protocolVersion: PROTOCOL_VERSION, lastSeq },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function waitForConnectSocket(socket: ClientSocket): Promise<void> {
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
      reject(new Error(`Timeout waiting for ack: ${type}`));
    }, 8000);
  });
}

function recordEnvelopes(socket: ClientSocket): Record<string, unknown>[] {
  const received: Record<string, unknown>[] = [];
  socket.on("op", (env: Record<string, unknown>) => {
    received.push(env);
  });
  return received;
}

const POLL_INTERVAL_MS = 25;
const WAIT_TIMEOUT_MS = 8000;

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    if (check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

function waitForJoinBatch(traffic: Record<string, unknown>[]): Promise<void> {
  return waitFor(
    () => traffic.some((e) => e["type"] === "resync:full" || e["type"] === "resync:delta"),
    "the join batch (resync:full/resync:delta)",
  );
}

function waitForSeq(traffic: Record<string, unknown>[], seq: number, what: string): Promise<void> {
  return waitFor(() => traffic.some((e) => e["seq"] === seq), `${what} (seq ${String(seq)})`);
}

function seqOf(ack: Record<string, unknown>): number {
  const seq = ack["seq"];
  if (typeof seq !== "number") throw new Error("ack carried no seq");
  return seq;
}

function snapshotSeq(traffic: Record<string, unknown>[]): number {
  for (const env of traffic) {
    if (env["type"] !== "resync:full") continue;
    const snap = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
      string,
      unknown
    > | null;
    if (snap) return snap["seq"] as number;
  }
  throw new Error("no resync:full snapshot in the recorded traffic");
}

function hpOf(system: Record<string, unknown> | undefined): unknown {
  const attributes = system?.["attributes"] as Record<string, unknown> | undefined;
  return attributes?.["hp"];
}

/** Every token's `actorDelta.system` carried by any Scene body in the traffic, keyed by token id. */
function tokenDeltaSystemsIn(
  envelopes: Record<string, unknown>[],
): Map<string, Record<string, unknown> | undefined> {
  const out = new Map<string, Record<string, unknown> | undefined>();
  const walkScene = (scene: unknown): void => {
    if (!scene || typeof scene !== "object") return;
    const tokens = (scene as Record<string, unknown>)["tokens"];
    if (!Array.isArray(tokens)) return;
    for (const t of tokens as Record<string, unknown>[]) {
      const id = t["_id"];
      if (typeof id !== "string") continue;
      const delta = t["actorDelta"] as Record<string, unknown> | null | undefined;
      out.set(id, (delta?.["system"] as Record<string, unknown> | undefined) ?? undefined);
    }
  };
  const walkEnvelope = (env: Record<string, unknown>): void => {
    const payload = env["payload"] as Record<string, unknown> | undefined;
    if (!payload) return;
    if (payload["documentType"] === "Scene" && Array.isArray(payload["documents"])) {
      for (const doc of payload["documents"] as unknown[]) walkScene(doc);
    }
    if (payload["documentType"] === "Scene" && payload["parent"]) {
      walkScene(payload["parent"]);
    }
    if (Array.isArray(payload["ops"])) {
      for (const op of payload["ops"] as Record<string, unknown>[]) walkEnvelope(op);
    }
    const snapshot = payload["snapshot"] as Record<string, unknown> | undefined;
    if (snapshot) {
      const byType = snapshot["documents"] as Record<string, unknown[]> | undefined;
      const scenes = byType?.["Scene"];
      if (Array.isArray(scenes)) for (const s of scenes) walkScene(s);
    }
  };
  for (const env of envelopes) walkEnvelope(env);
  return out;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("REQ-DOC-062 — unlinked token's actorDelta hp redacted across the four emission paths", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerASocket: ClientSocket;
  let sceneId: string;
  let unlinkedTokenId: string;

  beforeAll(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx, ctx.gmToken);
    playerASocket = connectClient(ctx, ctx.playerAToken);
    gmSocket.connect();
    playerASocket.connect();
    await Promise.all([waitForConnectSocket(gmSocket), waitForConnectSocket(playerASocket)]);

    // An npc-subtype Actor OWNED by player A (an unlinked familiar posted on
    // the map — DEC-DOC-12's "seis esqueletos" scenario) — npc defaults to
    // actorLink: false (REQ-TOK-023/024, REQ-DOC-061), so no extra doc:update
    // is needed to unlink it.
    const actorAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Familiar de A",
          type: "npc",
          system: { attributes: { hp: { value: 6, max: 6 } } },
          ownership: { default: 0, [ctx.playerAId]: 3 }, // player A is OWNER
        },
      ],
    });
    expect(actorAck["ok"], JSON.stringify(actorAck)).toBe(true);
    const actorId = (actorAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const sceneAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Scene",
      data: [{ name: "Câmara do Familiar", tokens: [] }],
    });
    expect(sceneAck["ok"]).toBe(true);
    sceneId = (sceneAck["result"] as { documents: Array<{ _id: string }> }).documents[0]!._id;

    const activateAck = await sendOp(gmSocket, "world:activeScene", { sceneId });
    expect(activateAck["ok"]).toBe(true);

    const tokenAck = await sendOp(gmSocket, "doc:create", {
      documentType: "Token",
      data: [{ actorId, x: 0, y: 0 }],
      parent: { type: "Scene", id: sceneId },
    });
    expect(tokenAck["ok"], JSON.stringify(tokenAck)).toBe(true);
    const tokenDoc = (tokenAck["result"] as { documents: Array<Record<string, unknown>> })
      .documents[0]!;
    unlinkedTokenId = tokenDoc["_id"] as string;
    expect(tokenDoc["actorLink"]).toBe(false); // sanity: npc defaults to unlinked

    // Give the token its own delta with a DIFFERENT hp than the base actor —
    // the GM is privileged, and the token is already unlinked, so this is a
    // valid REQ-DOC-034 update.
    const deltaAck = await sendOp(gmSocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: unlinkedTokenId,
          diff: { actorDelta: { system: { attributes: { hp: { value: 3, max: 6 } } } } },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(deltaAck["ok"], JSON.stringify(deltaAck)).toBe(true);
    // Sanity: the GM's own ack (privileged) carries the delta's hp.
    const deltaScene = (deltaAck["result"] as { documents: Array<Record<string, unknown>> })
      .documents[0]!;
    const deltaTokens = deltaScene["tokens"] as Array<Record<string, unknown>>;
    const deltaToken = deltaTokens.find((t) => t["_id"] === unlinkedTokenId);
    const deltaSystem = (deltaToken?.["actorDelta"] as Record<string, unknown> | undefined)?.[
      "system"
    ] as Record<string, unknown> | undefined;
    expect(hpOf(deltaSystem)).toEqual({ value: 3, max: 6 });
  }, 30000);

  afterAll(async () => {
    gmSocket?.disconnect();
    playerASocket?.disconnect();
    await teardown(ctx);
  });

  it("LIVE BROADCAST: player A — OWNER of the base Actor — still does not receive the delta's hp", async () => {
    const trafficA = recordEnvelopes(playerASocket);

    const moveAck = await sendOp(gmSocket, "token:move", {
      sceneId,
      tokenId: unlinkedTokenId,
      x: 10,
      y: 0,
    });
    expect(moveAck["ok"], JSON.stringify(moveAck)).toBe(true);

    await waitForSeq(trafficA, seqOf(moveAck), "player A's copy of the move broadcast");

    const systems = tokenDeltaSystemsIn(trafficA);
    expect(systems.has(unlinkedTokenId)).toBe(true); // the token itself DID arrive
    expect(hpOf(systems.get(unlinkedTokenId))).toBeUndefined(); // but not the delta's hp
  });

  it("JOIN SNAPSHOT: a fresh connection for player A carries the token but not the delta's hp", async () => {
    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnectSocket(joiner);
    await waitForJoinBatch(traffic);

    const systems = tokenDeltaSystemsIn(traffic);
    expect(systems.has(unlinkedTokenId)).toBe(true);
    expect(hpOf(systems.get(unlinkedTokenId))).toBeUndefined();

    joiner.disconnect();
  });

  it("DELTA REPLAY: reconnecting inside the buffer window replays the token without the delta's hp", async () => {
    const probe = connectClient(ctx, ctx.playerAToken);
    const probeTraffic = recordEnvelopes(probe);
    probe.connect();
    await waitForConnectSocket(probe);
    await waitForJoinBatch(probeTraffic);
    const lastSeq = snapshotSeq(probeTraffic);
    probe.disconnect();

    const moveAck = await sendOp(gmSocket, "token:move", {
      sceneId,
      tokenId: unlinkedTokenId,
      x: 20,
      y: 0,
    });
    expect(moveAck["ok"]).toBe(true);

    const replayer = connectClient(ctx, ctx.playerAToken, lastSeq);
    const replayTraffic = recordEnvelopes(replayer);
    replayer.connect();
    await waitForConnectSocket(replayer);
    await waitFor(
      () => replayTraffic.some((e) => e["type"] === "resync:delta"),
      "player A's delta replay",
    );

    const systems = tokenDeltaSystemsIn(replayTraffic);
    expect(systems.has(unlinkedTokenId)).toBe(true);
    expect(hpOf(systems.get(unlinkedTokenId))).toBeUndefined();

    replayer.disconnect();
  });

  it("ACK ECHO: player A moving the token gets it back in the ack, but without the delta's hp", async () => {
    const ack = await sendOp(playerASocket, "doc:update", {
      documentType: "Token",
      updates: [
        {
          _id: unlinkedTokenId,
          diff: { x: 30, y: 0 },
          embedded: { type: "Token", id: sceneId },
        },
      ],
    });
    expect(ack["ok"], JSON.stringify(ack)).toBe(true);
    const scenes = (ack["result"] as { documents: Array<Record<string, unknown>> }).documents;
    const tokens = scenes[0]!["tokens"] as Array<Record<string, unknown>>;
    const token = tokens.find((t) => t["_id"] === unlinkedTokenId);
    expect(token).toBeDefined();
    const system = (token?.["actorDelta"] as Record<string, unknown> | undefined)?.["system"] as
      | Record<string, unknown>
      | undefined;
    expect(hpOf(system)).toBeUndefined();
  });
});
