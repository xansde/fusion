/**
 * The attitude of a non-playable towards the party, over the real socket
 * (G073, spec 42 §5.5 and §5.10).
 *
 * REQ-NPC-037: an attitude is `enemy` | `neutral` | `ally`, stored on the actor
 *              ITSELF (`flags.fusion.attitude`, spec 42 §7); a non-playable
 *              with no applicable attitude carries none — a hazard cannot be
 *              given one at all (CA-NPC-010).
 * REQ-NPC-038: one activation walks the cycle ally → neutral → enemy, and the
 *              server accepts each step as an ordinary `doc:update`.
 * REQ-NPC-039: the attitude is ONE value for the whole party — there is no
 *              per-character exception, unlike knowledge (DEC-CTT-03), and two
 *              players are never owed different answers.
 * REQ-NPC-080: writing it is checked on the SERVER by `isRolePrivileged` —
 *              owning the actor is not a licence to declare it an ally.
 * REQ-NPC-082: the attitude is never delivered to a socket without a privileged
 *              role, and the suppression happens in the single redaction module
 *              (`net/redaction.ts`), so no emission path can bypass it.
 *
 * Every assertion reads the PAYLOAD a socket received, or the document as
 * `world.db` kept it — never a screen. The three emission paths are exercised
 * for real: the join snapshot, the live per-socket broadcast and the
 * delta-resync replay out of the OpBuffer, plus the ack echoed to the writer.
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
import { PROTOCOL_VERSION, KnowledgeState } from "@fusion/shared";
import { listeningPort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Harness (mirrors contacts-redaction.test.ts)
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
  playerBToken: string;
  playerBId: string;
}

function makeTempDir(): string {
  // Data dir lives in the OS temp dir — never inside the worktree.
  const dir = join(
    tmpdir(),
    `fusion-npc-attitude-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const worldId = "npc-attitude-world";
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
  const { user: playerB } = await authService.createUser({
    name: "Jogador B",
    role: Role.PLAYER,
    password: "player-b-pass",
  });
  const gmLogin = await authService.login({ userId: gm.id, password: gmPw, ip: "127.0.0.1" });
  const aLogin = await authService.login({
    userId: playerA.id,
    password: "player-a-pass",
    ip: "127.0.0.1",
  });
  const bLogin = await authService.login({
    userId: playerB.id,
    password: "player-b-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "NPC Attitude World", systemId: "stub" },
  });
  // port 0 + listeningPort(): this test never goes through boot(), so the OS
  // picks the port and nothing hardcodes one (helpers/ports.ts).
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
    playerBToken: bLogin.accessToken,
    playerBId: playerB.id,
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
      reject(new Error(`Timeout waiting for ack: ${type}`));
    }, 8000);
  });
}

/** Record EVERY envelope a socket receives, so the whole traffic can be searched. */
function recordEnvelopes(socket: ClientSocket): Record<string, unknown>[] {
  const received: Record<string, unknown>[] = [];
  socket.on("op", (env: Record<string, unknown>) => {
    received.push(env);
  });
  return received;
}

const POLL_INTERVAL_MS = 25;
const WAIT_TIMEOUT_MS = 8000;

/** Poll until a condition holds — never a fixed sleep. */
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

/** The envelope carrying the seq an ack named — the broadcast of that very op. */
function waitForSeq(traffic: Record<string, unknown>[], seq: number, what: string): Promise<void> {
  return waitFor(() => traffic.some((e) => e["seq"] === seq), `${what} (seq ${String(seq)})`);
}

function seqOf(ack: Record<string, unknown>): number {
  const seq = ack["seq"];
  if (typeof seq !== "number") throw new Error("ack carried no seq");
  return seq;
}

/** The seq the join snapshot stands at — where a later delta replay starts. */
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

/** Every Actor document carried by any envelope, whatever path it arrived by. */
function actorDocsIn(envelopes: Record<string, unknown>[]): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  for (const env of envelopes) {
    const payload = env["payload"] as Record<string, unknown> | undefined;
    if (!payload) continue;
    if (payload["documentType"] === "Actor" && Array.isArray(payload["documents"])) {
      docs.push(...(payload["documents"] as Record<string, unknown>[]));
    }
    if (Array.isArray(payload["ops"])) {
      docs.push(...actorDocsIn(payload["ops"] as Record<string, unknown>[]));
    }
    const snapshot = payload["snapshot"] as Record<string, unknown> | undefined;
    if (snapshot) {
      const byType = snapshot["documents"] as Record<string, unknown[]> | undefined;
      const actors = byType?.["Actor"];
      if (Array.isArray(actors)) docs.push(...(actors as Record<string, unknown>[]));
    }
  }
  return docs;
}

function docsOf(ack: Record<string, unknown>): Record<string, unknown>[] {
  const result = ack["result"] as { documents?: Record<string, unknown>[] } | undefined;
  return result?.documents ?? [];
}

/**
 * The attitude a payload body carries, read structurally — `undefined` when the
 * body carries none at all. Read off the RAW payload rather than through the
 * shared helper on purpose: the assertion is about the bytes that crossed the
 * socket, so it must not depend on the same reader the server used.
 */
function attitudeOf(doc: Record<string, unknown> | undefined): unknown {
  if (!doc) return undefined;
  const flags = doc["flags"] as Record<string, unknown> | undefined;
  if (!flags || typeof flags !== "object") return undefined;
  const namespace = flags["fusion"] as Record<string, unknown> | undefined;
  if (!namespace || typeof namespace !== "object") return undefined;
  return namespace["attitude"];
}

/** Does any payload anywhere in this traffic mention the attitude key at all? */
function trafficMentionsAttitude(envelopes: Record<string, unknown>[]): boolean {
  return JSON.stringify(envelopes).includes('"attitude"');
}

// ---------------------------------------------------------------------------

describe("spec 42 §5.5/§5.10 — attitude is one per actor, and privileged (G073)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerASocket: ClientSocket;
  let playerBSocket: ClientSocket;
  let gmTraffic: Record<string, unknown>[];
  let aTraffic: Record<string, unknown>[];
  let bTraffic: Record<string, unknown>[];

  /** An npc the players merely KNOW: visible to them, attitude written on it. */
  let smithId: string;
  /** An npc PLAYER A owns outright — ownership is not a licence (REQ-NPC-080). */
  let ownedNpcId: string;

  async function createActor(payload: Record<string, unknown>): Promise<string> {
    const ack = await sendOp(gmSocket, "doc:create", { documentType: "Actor", data: [payload] });
    expect(ack["ok"]).toBe(true);
    const id = docsOf(ack)[0]?.["_id"];
    if (typeof id !== "string") throw new Error("Actor create returned no _id");
    return id;
  }

  /** The document exactly as world.db holds it — the unredacted truth. */
  function readFromStore(actorId: string): Record<string, unknown> {
    const row = ctx.fusionDb.raw.prepare("SELECT data FROM actors WHERE id = ?").get(actorId) as
      | { data: string }
      | undefined;
    if (!row) throw new Error(`Actor ${actorId} not found in world.db`);
    return JSON.parse(row.data) as Record<string, unknown>;
  }

  function versionInStore(actorId: string): number {
    const stats = (readFromStore(actorId)["_stats"] ?? {}) as Record<string, unknown>;
    return typeof stats["version"] === "number" ? stats["version"] : 0;
  }

  function setAttitude(
    socket: ClientSocket,
    actorId: string,
    value: unknown,
  ): Promise<Record<string, unknown>> {
    return sendOp(socket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: actorId,
          diff: { "flags.fusion.attitude": value },
          expectedVersion: versionInStore(actorId),
        },
      ],
    });
  }

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx, ctx.gmToken);
    playerASocket = connectClient(ctx, ctx.playerAToken);
    playerBSocket = connectClient(ctx, ctx.playerBToken);
    // Recorders BEFORE connect(): the join batch is emitted as soon as the
    // handshake is authenticated, and a missed batch makes an assertion of
    // absence vacuous.
    gmTraffic = recordEnvelopes(gmSocket);
    aTraffic = recordEnvelopes(playerASocket);
    bTraffic = recordEnvelopes(playerBSocket);
    gmSocket.connect();
    playerASocket.connect();
    playerBSocket.connect();
    await Promise.all([
      waitForConnect(gmSocket),
      waitForConnect(playerASocket),
      waitForConnect(playerBSocket),
    ]);
    await Promise.all([
      waitForJoinBatch(gmTraffic),
      waitForJoinBatch(aTraffic),
      waitForJoinBatch(bTraffic),
    ]);

    // Each player owns a character, so the knowledge rule has someone to
    // resolve over (REQ-CTT-071) and the npc below is delivered at all.
    await createActor({
      name: "Fofurinha",
      type: "character",
      ownership: { default: 0, [ctx.playerAId]: 3 },
    });
    await createActor({
      name: "Tobias",
      type: "character",
      ownership: { default: 0, [ctx.playerBId]: 3 },
    });

    smithId = await createActor({
      name: "Ferreiro Bram",
      type: "npc",
      ownership: { default: 2 },
      flags: {
        fusion: {
          attitude: "enemy",
          knowledge: { general: KnowledgeState.Known, exceptions: {} },
        },
      },
    });
    // Owned OUTRIGHT by player A: whatever happens to this document, it cannot
    // be blamed on ownership having refused the write.
    ownedNpcId = await createActor({
      name: "Cão de Guarda",
      type: "npc",
      ownership: { default: 0, [ctx.playerAId]: 3 },
      flags: { fusion: { attitude: "ally" } },
    });

    const settle = seqOf(
      await sendOp(gmSocket, "doc:update", {
        documentType: "Actor",
        updates: [{ _id: smithId, diff: { name: "Ferreiro Bram" } }],
      }),
    );
    await Promise.all([
      waitForSeq(gmTraffic, settle, "the settling update"),
      waitForSeq(aTraffic, settle, "the settling update"),
    ]);
  });

  afterEach(async () => {
    gmSocket.disconnect();
    playerASocket.disconnect();
    playerBSocket.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // REQ-NPC-082 — the attitude never reaches a non-privileged socket
  // -------------------------------------------------------------------------

  it("REQ-NPC-082: the join snapshot of a player carries no attitude, while the GM's does", async () => {
    // Positive anchor first: an empty payload would make the absence vacuous.
    const playerSmith = actorDocsIn(aTraffic).find((d) => d["_id"] === smithId);
    expect(playerSmith?.["name"]).toBe("Ferreiro Bram");
    expect(attitudeOf(playerSmith)).toBeUndefined();

    const gmSmith = actorDocsIn(gmTraffic).find((d) => d["_id"] === smithId);
    expect(attitudeOf(gmSmith)).toBe("enemy");
    // And the world.db copy still holds it: this is redaction, not deletion.
    expect(attitudeOf(readFromStore(smithId))).toBe("enemy");
  });

  it("REQ-NPC-082: the live broadcast of a change carries no attitude to a player", async () => {
    const ack = await setAttitude(gmSocket, smithId, "neutral");
    expect(ack["ok"]).toBe(true);
    const seq = seqOf(ack);
    await Promise.all([
      waitForSeq(gmTraffic, seq, "the attitude broadcast"),
      waitForSeq(aTraffic, seq, "the attitude broadcast"),
    ]);

    const gmBody = actorDocsIn(gmTraffic.filter((e) => e["seq"] === seq))[0];
    expect(attitudeOf(gmBody)).toBe("neutral");

    const playerBody = actorDocsIn(aTraffic.filter((e) => e["seq"] === seq))[0];
    // The body did arrive — the envelope is not swallowed, only the field is.
    expect(playerBody?.["_id"]).toBe(smithId);
    expect(attitudeOf(playerBody)).toBeUndefined();
  });

  it("REQ-NPC-082: the delta replay after a reconnect carries no attitude either", async () => {
    const fromSeq = snapshotSeq(aTraffic);
    const ack = await setAttitude(gmSocket, smithId, "neutral");
    const seq = seqOf(ack);
    await waitForSeq(aTraffic, seq, "the attitude broadcast");

    const rejoin = connectClient(ctx, ctx.playerAToken, fromSeq);
    const replayTraffic = recordEnvelopes(rejoin);
    rejoin.connect();
    await waitForConnect(rejoin);
    await waitForJoinBatch(replayTraffic);

    const replayed = actorDocsIn(replayTraffic).find((d) => d["_id"] === smithId);
    expect(replayed?.["_id"]).toBe(smithId);
    expect(attitudeOf(replayed)).toBeUndefined();
    rejoin.disconnect();
  });

  it("REQ-NPC-082: the ack a player receives for their own write carries no attitude", async () => {
    // Player A owns this npc outright, so the write itself succeeds — and the
    // ack echoes the document straight back, which is an emission path like
    // any other.
    const ack = await sendOp(playerASocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: ownedNpcId,
          diff: { name: "Cão de Guarda Fiel" },
          expectedVersion: versionInStore(ownedNpcId),
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const echoed = docsOf(ack)[0];
    expect(echoed?.["name"]).toBe("Cão de Guarda Fiel");
    expect(attitudeOf(echoed)).toBeUndefined();
    // The stored document kept it: only the payload lost it.
    expect(attitudeOf(readFromStore(ownedNpcId))).toBe("ally");
  });

  it("REQ-NPC-082: no envelope a player ever received mentions the attitude key", async () => {
    const seq = seqOf(await setAttitude(gmSocket, smithId, "ally"));
    await Promise.all([
      waitForSeq(gmTraffic, seq, "the attitude broadcast"),
      waitForSeq(aTraffic, seq, "the attitude broadcast"),
    ]);
    // Whole-traffic sweep, not a per-document read: a future path that adds a
    // second place to carry the field is caught here.
    expect(trafficMentionsAttitude(gmTraffic)).toBe(true);
    expect(trafficMentionsAttitude(aTraffic)).toBe(false);
    expect(trafficMentionsAttitude(bTraffic)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // REQ-NPC-080 — writing it is the server's call, not the owner's
  // -------------------------------------------------------------------------

  it("REQ-NPC-080: a player who OWNS the actor is still refused the attitude", async () => {
    const before = attitudeOf(readFromStore(ownedNpcId));
    const ack = await setAttitude(playerASocket, ownedNpcId, "enemy");
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    // The refusal is about the FIELD, not about the document: the same player
    // writes another field of the same actor and is accepted.
    expect(attitudeOf(readFromStore(ownedNpcId))).toBe(before);

    const allowed = await sendOp(playerASocket, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: ownedNpcId,
          diff: { name: "Cão Fiel" },
          expectedVersion: versionInStore(ownedNpcId),
        },
      ],
    });
    expect(allowed["ok"]).toBe(true);
  });

  it("REQ-NPC-080: the GM writes it, and the store keeps exactly what was asked", async () => {
    const ack = await setAttitude(gmSocket, smithId, "ally");
    expect(ack["ok"]).toBe(true);
    expect(attitudeOf(readFromStore(smithId))).toBe("ally");
  });

  it("REQ-NPC-080: a value outside the three is refused, and nothing is written", async () => {
    const before = attitudeOf(readFromStore(smithId));
    const ack = await setAttitude(gmSocket, smithId, "hostile");
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(attitudeOf(readFromStore(smithId))).toBe(before);
  });

  // -------------------------------------------------------------------------
  // REQ-NPC-037 — a hazard has none, and none can be given to it
  // -------------------------------------------------------------------------

  it("REQ-NPC-037: a hazard cannot be given an attitude on update (CA-NPC-010)", async () => {
    const hazardId = await createActor({ name: "Fosso de Espinhos", type: "hazard" });
    const ack = await setAttitude(gmSocket, hazardId, "enemy");
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(attitudeOf(readFromStore(hazardId))).toBeUndefined();
  });

  it("REQ-NPC-037: a hazard born with an attitude does not keep one", async () => {
    const hazardId = await createActor({
      name: "Armadilha de Dardos",
      type: "hazard",
      flags: { fusion: { attitude: "enemy" } },
    });
    expect(attitudeOf(readFromStore(hazardId))).toBeUndefined();
  });

  it("REQ-NPC-037: an npc may carry none, and clearing it is accepted", async () => {
    const ack = await setAttitude(gmSocket, smithId, null);
    expect(ack["ok"]).toBe(true);
    expect(attitudeOf(readFromStore(smithId))).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // REQ-NPC-038 / REQ-NPC-039 — the cycle, and one value for the whole party
  // -------------------------------------------------------------------------

  it("REQ-NPC-038: three successive writes walk ally → neutral → enemy (CA-NPC-009)", async () => {
    const seen: unknown[] = [];
    for (const value of ["ally", "neutral", "enemy"]) {
      const ack = await setAttitude(gmSocket, smithId, value);
      expect(ack["ok"]).toBe(true);
      seen.push(attitudeOf(readFromStore(smithId)));
    }
    expect(seen).toEqual(["ally", "neutral", "enemy"]);
  });

  it("REQ-NPC-039: the value is one for the party — two players are owed the same nothing", async () => {
    const seq = seqOf(await setAttitude(gmSocket, smithId, "enemy"));
    await Promise.all([
      waitForSeq(aTraffic, seq, "the attitude broadcast"),
      waitForSeq(bTraffic, seq, "the attitude broadcast"),
    ]);
    const forA = actorDocsIn(aTraffic.filter((e) => e["seq"] === seq))[0];
    const forB = actorDocsIn(bTraffic.filter((e) => e["seq"] === seq))[0];
    expect(attitudeOf(forA)).toBeUndefined();
    expect(attitudeOf(forB)).toBeUndefined();

    // And the stored shape offers no place to write a per-character override:
    // it is a scalar, not a map keyed by character (the contrast with
    // DEC-CTT-03 that REQ-NPC-039 is about).
    const stored = readFromStore(smithId);
    const namespace = (stored["flags"] as Record<string, Record<string, unknown>>)["fusion"];
    expect(namespace?.["attitude"]).toBe("enemy");
    expect(typeof namespace?.["attitude"]).toBe("string");
  });
});
