/**
 * Contact knowledge in the single redaction module (G061, spec 39 §5.9).
 *
 * REQ-CTT-080: hiding a control on the client is not protection — the refusal
 *              is the server's, and a request that asks for a hidden contact
 *              gets nothing back.
 * REQ-CTT-081: the payload of a contact the viewer only GLIMPSED carries no
 *              name, no title, no portrait and no system data.
 * REQ-CTT-082: the payload of a HIDDEN contact is not delivered at all — not in
 *              the snapshot, not in the broadcast, not in the replay.
 * REQ-CTT-075: changing knowledge propagates the DELTA to each affected user —
 *              including the removal of a contact that dropped to `oculto`, on
 *              the same envelope, so nobody has to reload the page to stop
 *              seeing it.
 * REQ-CTT-083: all of it happens in `net/redaction.ts`, the same module that
 *              redacts hidden tokens and the scene list, and no emission path
 *              bypasses it.
 * REQ-CTT-084: the knowledge map itself (general rule + exceptions) never
 *              reaches a socket without a privileged role.
 * REQ-CTT-085: changing the title is checked on the server — privileged role or
 *              OWNER, anybody else refused.
 * REQ-CTT-013: a glimpsed contact cannot be found by name, because there is no
 *              name in the payload to find.
 *
 * Every assertion reads the PAYLOAD the player's socket received — never a
 * screen. The three emission paths are exercised for real: the join snapshot,
 * the live per-socket broadcast and the delta-resync replay out of the
 * OpBuffer.
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
import { buildContactViewer, redactActorDocsForViewer } from "../net/redaction.js";
import type { ContactKnowledgeSource } from "../net/redaction.js";
import { listeningPort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const HIDDEN_NAME = "Assassino Encapuzado";
const GLIMPSED_NAME = "Ferreiro da Vila";
const KNOWN_NAME = "Taverneiro Bartolomeu";
const DENIED_NAME = "Segredo Fechado a Sete Chaves";
const GLIMPSED_TITLE = "Mestre da Forja";
const GLIMPSED_PORTRAIT = "assets/retratos/ferreiro.webp";
const KNOWN_TITLE = "Anfitrião do Javali";

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
  /** A player who owns NO character at all — session zero (REQ-CTT-071). */
  playerCToken: string;
  playerCId: string;
}

function makeTempDir(): string {
  // Data dir lives in the OS temp dir — never inside the worktree.
  const dir = join(
    tmpdir(),
    `fusion-contacts-redaction-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildTestContext(): Promise<TestContext> {
  const dataDir = makeTempDir();
  const worldId = "contacts-redaction-world";
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
  // Player C never receives a character: the session-zero case REQ-CTT-071 is
  // written about ("o maior estado entre os personagens que ele possui" — over
  // an empty set).
  const { user: playerC } = await authService.createUser({
    name: "Jogadora C",
    role: Role.PLAYER,
    password: "player-c-pass",
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
  const cLogin = await authService.login({
    userId: playerC.id,
    password: "player-c-pass",
    ip: "127.0.0.1",
  });

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  await registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: worldId, title: "Contacts Redaction World", systemId: "stub" },
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
    playerCToken: cLogin.accessToken,
    playerCId: playerC.id,
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

/**
 * The join batch a freshly connected socket receives — `resync:full`, or
 * `resync:delta` when it reconnects with a `lastSeq` still inside the buffer.
 *
 * Every assertion of ABSENCE below waits on this first, and states a positive
 * anchor next: an empty `traffic` proves nothing, so a fixed sleep would turn a
 * loaded box into a silently green leak test.
 */
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

/** The seq an ack reports, so a wait can name the envelope it produced. */
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
    // Live broadcast / replayed op.
    if (payload["documentType"] === "Actor" && Array.isArray(payload["documents"])) {
      docs.push(...(payload["documents"] as Record<string, unknown>[]));
    }
    // resync:delta — ops nested inside the payload.
    if (Array.isArray(payload["ops"])) {
      docs.push(...actorDocsIn(payload["ops"] as Record<string, unknown>[]));
    }
    // resync:full — the join snapshot.
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
 * The payload of the op a socket received at a given seq — the unit REQ-CTT-075
 * is written about: one user, one envelope, both halves of the delta on it.
 */
function aPayloadAtSeq(envelopes: Record<string, unknown>[], seq: number): Record<string, unknown> {
  const env = envelopes.find((e) => e["seq"] === seq);
  if (!env) throw new Error(`no envelope with seq ${String(seq)} in the recorded traffic`);
  return env["payload"] as Record<string, unknown>;
}

/** The ops a `resync:delta` replayed out of the OpBuffer, flattened. */
function replayedOps(envelopes: Record<string, unknown>[]): Record<string, unknown>[] {
  const ops: Record<string, unknown>[] = [];
  for (const env of envelopes) {
    const payload = env["payload"] as Record<string, unknown> | undefined;
    if (payload && Array.isArray(payload["ops"])) {
      ops.push(...(payload["ops"] as Record<string, unknown>[]));
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------

describe("spec 39 §5.9 — contact knowledge redacts in the single module (G061)", () => {
  let ctx: TestContext;
  let gmSocket: ClientSocket;
  let playerASocket: ClientSocket;
  let playerBSocket: ClientSocket;

  let charAId: string;
  let charBId: string;
  let hiddenId: string;
  let glimpsedId: string;
  let knownId: string;
  let deniedId: string;

  /** The broadcast seq of each Actor this suite created, so a wait can name it. */
  const createSeq = new Map<string, number>();

  async function createActor(payload: Record<string, unknown>): Promise<string> {
    const ack = await sendOp(gmSocket, "doc:create", { documentType: "Actor", data: [payload] });
    expect(ack["ok"]).toBe(true);
    const id = docsOf(ack)[0]?.["_id"];
    if (typeof id !== "string") throw new Error("Actor create returned no _id");
    createSeq.set(id, seqOf(ack));
    return id;
  }

  function seqOfCreate(actorId: string): number {
    const seq = createSeq.get(actorId);
    if (seq === undefined) throw new Error(`no create seq recorded for ${actorId}`);
    return seq;
  }

  /** The document exactly as world.db holds it — the unredacted truth. */
  function readFromStore(actorId: string): Record<string, unknown> {
    const row = ctx.fusionDb.raw.prepare("SELECT data FROM actors WHERE id = ?").get(actorId) as
      | { data: string }
      | undefined;
    if (!row) throw new Error(`Actor ${actorId} not found in world.db`);
    return JSON.parse(row.data) as Record<string, unknown>;
  }

  /** The world's characters, read the same way the server reads them. */
  function knowledgeSource(): ContactKnowledgeSource {
    return {
      listCharacterOwnership: () => {
        const rows = ctx.fusionDb.raw.prepare("SELECT data FROM actors").all() as {
          data: string;
        }[];
        return (
          rows
            .map((r) => JSON.parse(r.data) as Record<string, unknown>)
            // "character" (pf2e/sf2e) and "orador" (etmos) are both playable
            // subtypes — the oracle spells them out instead of importing the
            // server's own list, so it stays an independent reading.
            .filter((doc) => doc["type"] === "character" || doc["type"] === "orador")
            .map((doc) => ({ id: doc["_id"] as string, ownership: doc["ownership"] }))
        );
      },
    };
  }

  /**
   * What the single redaction module says a viewer is owed for a document.
   * Used as the reference the three emission paths are compared against —
   * the module IS the contract (REQ-CTT-083), so agreeing with it is the
   * definition of "same funnel".
   */
  function expectedFor(actorId: string, userId: string): Record<string, unknown> | undefined {
    const viewer = buildContactViewer(knowledgeSource(), userId, Role.PLAYER);
    return redactActorDocsForViewer([readFromStore(actorId)], viewer).documents[0];
  }

  beforeEach(async () => {
    createSeq.clear();
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx, ctx.gmToken);
    playerASocket = connectClient(ctx, ctx.playerAToken);
    playerBSocket = connectClient(ctx, ctx.playerBToken);
    // Recorders BEFORE `connect()`: the join batch is emitted server-side as
    // soon as the handshake is authenticated, so a listener attached afterwards
    // can miss it — and a missed batch is exactly what makes a "did not leak"
    // assertion vacuous.
    const gmJoin = recordEnvelopes(gmSocket);
    const aJoin = recordEnvelopes(playerASocket);
    const bJoin = recordEnvelopes(playerBSocket);
    gmSocket.connect();
    playerASocket.connect();
    playerBSocket.connect();
    await Promise.all([
      waitForConnect(gmSocket),
      waitForConnect(playerASocket),
      waitForConnect(playerBSocket),
    ]);
    await Promise.all([waitForJoinBatch(gmJoin), waitForJoinBatch(aJoin), waitForJoinBatch(bJoin)]);

    charAId = await createActor({
      name: "Fofurinha",
      type: "character",
      ownership: { default: 0, [ctx.playerAId]: 3 },
    });
    charBId = await createActor({
      name: "Tobias",
      type: "character",
      ownership: { default: 0, [ctx.playerBId]: 3 },
    });

    // The three contacts differ ONLY in their knowledge state: ownership is the
    // same OBSERVER for all three, so anything that changes between them is the
    // knowledge filter and nothing else.
    // Each contact carries its OWN title and portrait so an assertion about the
    // glimpsed one cannot be satisfied (or broken) by a sibling.
    const contactBody = (
      name: string,
      general: number,
      title: string,
      img: string,
    ): Record<string, unknown> => ({
      name,
      type: "npc",
      img,
      ownership: { default: 2 },
      system: { details: { level: { value: 4 } } },
      flags: { fusion: { title, knowledge: { general, exceptions: {} } } },
    });

    hiddenId = await createActor(
      contactBody(HIDDEN_NAME, KnowledgeState.Hidden, "Punhal nas Sombras", "assets/x/oculto.webp"),
    );
    glimpsedId = await createActor(
      contactBody(GLIMPSED_NAME, KnowledgeState.Glimpsed, GLIMPSED_TITLE, GLIMPSED_PORTRAIT),
    );
    knownId = await createActor(
      contactBody(KNOWN_NAME, KnowledgeState.Known, KNOWN_TITLE, "assets/x/taverneiro.webp"),
    );
    // Known to everyone, and owned by nobody: knowledge must not open a door
    // that ownership keeps shut (REQ-CTT-074).
    deniedId = await createActor({
      ...contactBody(DENIED_NAME, KnowledgeState.Known, "Sem Nome", "assets/x/negado.webp"),
      ownership: { default: 0 },
    });
    // Both players must have RECEIVED the last create before any test reads
    // their live traffic. Every Actor `doc:create` reaches every socket (the
    // per-user redaction only decides which body), so the seq of the last one
    // is a condition that actually holds — never a guess at how long 200 ms is.
    await Promise.all([
      waitForSeq(aJoin, seqOfCreate(deniedId), "player A's copy of the last create"),
      waitForSeq(bJoin, seqOfCreate(deniedId), "player B's copy of the last create"),
    ]);
  }, 40000);

  afterEach(async () => {
    gmSocket.disconnect();
    playerASocket.disconnect();
    playerBSocket.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // The three states, read off the join snapshot
  // -------------------------------------------------------------------------

  it("REQ-CTT-082/REQ-CTT-080: a hidden contact is absent from the player's snapshot — name, id and all", async () => {
    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await waitForJoinBatch(traffic);

    // Anchor first: the snapshot really carried contacts to this player. Without
    // it, "the hidden one is not here" would also be true of a snapshot that
    // never arrived — a leak test that passes on empty traffic proves nothing.
    expect(actorDocsIn(traffic).some((doc) => doc["_id"] === knownId)).toBe(true);

    expect(JSON.stringify(traffic)).not.toContain(HIDDEN_NAME);
    expect(JSON.stringify(traffic)).not.toContain(hiddenId);
    expect(actorDocsIn(traffic).some((doc) => doc["_id"] === hiddenId)).toBe(false);
    joiner.disconnect();
  });

  it("REQ-CTT-040/REQ-CTT-074: the knowledge filter runs over contacts only — a `loot` actor shared by ownership still reaches the player", async () => {
    // The chest (`loot`, DEC-NPC-08 of spec 42) is not one of "os não-jogadores"
    // REQ-CTT-040 populates the Conhecidos section with, so knowledge has nothing
    // to say about it: a party stash shared at OBSERVER is governed by `ownership`
    // alone. Deriving "is a contact" as "is not a character" subjected it to the
    // filter, whose default general rule is `oculto` — and the stash vanished from
    // every player until the Mestre wrote knowledge onto a chest.
    const stashName = "Estoque da Comitiva";
    const stashId = await createActor({
      name: stashName,
      type: "loot",
      img: "assets/x/bau.webp",
      ownership: { default: 2 },
    });

    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await waitForJoinBatch(traffic);

    const doc = actorDocsIn(traffic).find((d) => d["_id"] === stashId);
    expect(doc).toBeDefined();
    expect(doc?.["name"]).toBe(stashName);
    // REQ-CTT-074 is symmetric: escaping the filter is not a grant either. A
    // chest nobody may see is still shut by `ownership`.
    const privateStashId = await createActor({
      name: "Cofre do Mestre",
      type: "loot",
      ownership: { default: 0 },
    });
    // The envelope of that very create reaches this socket (with an empty
    // batch): waiting on it is what makes the absence below a verdict rather
    // than a race the test happened to win.
    await waitForSeq(traffic, seqOfCreate(privateStashId), "the private stash create");
    expect(actorDocsIn(traffic).some((d) => d["_id"] === privateStashId)).toBe(false);
    expect(JSON.stringify(traffic)).not.toContain("Cofre do Mestre");
    joiner.disconnect();
  });

  it("REQ-CTT-081/REQ-CTT-013: a glimpsed contact arrives with no name, title, portrait or system data", async () => {
    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await waitForJoinBatch(traffic);

    const doc = actorDocsIn(traffic).find((d) => d["_id"] === glimpsedId);
    expect(doc).toBeDefined();
    expect(doc).not.toHaveProperty("name");
    expect(doc).not.toHaveProperty("img");
    expect(doc).not.toHaveProperty("system");
    // REQ-CTT-013: with no name in the payload there is nothing for a search to
    // match — the whole traffic never spells it out, under any key.
    expect(JSON.stringify(traffic)).not.toContain(GLIMPSED_NAME);
    expect(JSON.stringify(traffic)).not.toContain(GLIMPSED_TITLE);
    expect(JSON.stringify(traffic)).not.toContain(GLIMPSED_PORTRAIT);
    joiner.disconnect();
  });

  it("REQ-CTT-081: a known contact arrives whole — the filter restricts, it does not blank everything", async () => {
    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await waitForJoinBatch(traffic);

    const doc = actorDocsIn(traffic).find((d) => d["_id"] === knownId);
    expect(doc?.["name"]).toBe(KNOWN_NAME);
    expect(doc?.["system"]).toBeDefined();
    joiner.disconnect();
  });

  it("REQ-CTT-074: knowledge never grants what ownership denies — a known contact owned by nobody still does not arrive", async () => {
    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await waitForJoinBatch(traffic);

    // Anchor: the batch that should have carried the denied contact did arrive
    // and did carry contacts — what is missing is the one ownership shuts out.
    expect(actorDocsIn(traffic).some((doc) => doc["_id"] === knownId)).toBe(true);

    expect(JSON.stringify(traffic)).not.toContain(DENIED_NAME);
    expect(actorDocsIn(traffic).some((doc) => doc["_id"] === deniedId)).toBe(false);
    joiner.disconnect();
  });

  it("REQ-CTT-071/REQ-CTT-082: a player with no character receives no contact — the funnel fails closed", async () => {
    // Session zero: player C exists, is connected, and owns no character. The
    // two visible contacts have ownership OBSERVER for everybody, so ownership
    // lets them through and only the knowledge rule can stop them. REQ-CTT-071
    // is a maximum over the characters the user OWNS — over an empty set that
    // is `oculto`, never the general rule the world wrote for characters.
    const joiner = connectClient(ctx, ctx.playerCToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await waitForJoinBatch(traffic);

    // Anchor: player C's snapshot was delivered. The list below is empty of
    // contacts because the funnel closed it, not because nothing arrived.
    expect(traffic.some((e) => e["type"] === "resync:full")).toBe(true);

    const ids = actorDocsIn(traffic).map((doc) => doc["_id"]);
    expect(ids).not.toContain(knownId);
    expect(ids).not.toContain(glimpsedId);
    expect(ids).not.toContain(hiddenId);
    expect(JSON.stringify(traffic)).not.toContain(KNOWN_NAME);
    expect(JSON.stringify(traffic)).not.toContain(KNOWN_TITLE);
    expect(JSON.stringify(traffic)).not.toContain(GLIMPSED_NAME);
    joiner.disconnect();

    // Not vacuous: the same world, the same contact, a player who DOES own a
    // character — the known contact arrives whole. What changed is the viewer's
    // characters, which is exactly what REQ-CTT-071 makes the state depend on.
    const withCharacter = connectClient(ctx, ctx.playerAToken);
    const trafficA = recordEnvelopes(withCharacter);
    withCharacter.connect();
    await waitForConnect(withCharacter);
    await waitForJoinBatch(trafficA);
    expect(actorDocsIn(trafficA).some((doc) => doc["_id"] === knownId)).toBe(true);
    withCharacter.disconnect();
  });

  it("REQ-CTT-084: no payload a player receives carries the knowledge map", async () => {
    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await waitForJoinBatch(traffic);

    // Anchor: there ARE Actor documents in this player's traffic to inspect —
    // a loop over an empty list would satisfy the check without proving it.
    expect(actorDocsIn(traffic).length).toBeGreaterThan(0);

    for (const doc of actorDocsIn(traffic)) {
      const flags = doc["flags"] as Record<string, unknown> | undefined;
      const fusion = flags?.["fusion"] as Record<string, unknown> | undefined;
      expect(fusion === undefined || !("knowledge" in fusion)).toBe(true);
    }
    // The GM, on the same world, still gets it: the redaction is scoped by
    // role, not a blanket strip.
    const gmTraffic = recordEnvelopes(gmSocket);
    const gmAck = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [{ actorId: knownId, general: KnowledgeState.Glimpsed }],
    });
    await waitForSeq(gmTraffic, seqOf(gmAck), "the GM's copy of the knowledge update");
    const gmDoc = actorDocsIn(gmTraffic).find((d) => d["_id"] === knownId);
    expect((gmDoc?.["flags"] as Record<string, Record<string, unknown>>)["fusion"]).toHaveProperty(
      "knowledge",
    );
    joiner.disconnect();
  });

  // -------------------------------------------------------------------------
  // A character is whatever the SYSTEM calls a character (spec 39 §5.8)
  //
  // Etmos names its playable Actor `orador`, pf2e/sf2e name it `character`.
  // Reading a single literal would make an Etmos world a world with no
  // characters at all — every player would read only the general rule, and the
  // other players' own characters would be filtered out of their payload.
  // -------------------------------------------------------------------------

  it("REQ-CTT-071: an exception on an etmos `orador` its owner holds reaches that owner's payload", async () => {
    // Player A's character in an Etmos world: same role in the model as
    // Fofurinha, different subtype because the system says so.
    const oradorId = await createActor({
      name: "Voz do Bosque",
      type: "orador",
      ownership: { default: 0, [ctx.playerAId]: 3 },
    });
    // The contact is hidden to everybody EXCEPT that orador, so the delivery
    // can only come from the exception being resolved against it.
    const ack = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [
        {
          actorId: knownId,
          general: KnowledgeState.Hidden,
          clearExceptions: true,
          exceptions: { [oradorId]: KnowledgeState.Known },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await waitForJoinBatch(traffic);

    const doc = actorDocsIn(traffic).find((d) => d["_id"] === knownId);
    expect(doc?.["name"]).toBe(KNOWN_NAME);

    // Player B owns no orador, so the same contact stays hidden for them —
    // the exception is the character's, never the world's.
    const other = connectClient(ctx, ctx.playerBToken);
    const otherTraffic = recordEnvelopes(other);
    other.connect();
    await waitForConnect(other);
    await waitForJoinBatch(otherTraffic);
    // Anchor: player B's snapshot arrived and carried their own character, so
    // the missing contact below is a refusal and not an unfinished delivery.
    expect(actorDocsIn(otherTraffic).some((d) => d["_id"] === charBId)).toBe(true);
    expect(actorDocsIn(otherTraffic).some((d) => d["_id"] === knownId)).toBe(false);

    joiner.disconnect();
    other.disconnect();
  });

  it("REQ-CTT-020/REQ-CTT-082: another player's `orador` is not a contact — it arrives whole, never filtered", async () => {
    // Visible by ownership (OBSERVER by default) and carrying no knowledge map
    // at all — a fresh map reads `hidden`, so running the contact filter over
    // it would drop it from the payload and empty the "Na mesa" section.
    const OTHER_ORADOR = "Guardiã das Marés";
    const oradorId = await createActor({
      name: OTHER_ORADOR,
      type: "orador",
      ownership: { default: 2, [ctx.playerBId]: 3 },
    });

    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await waitForJoinBatch(traffic);

    const doc = actorDocsIn(traffic).find((d) => d["_id"] === oradorId);
    expect(doc).toBeDefined();
    expect(doc?.["name"]).toBe(OTHER_ORADOR);
    joiner.disconnect();
  });

  // -------------------------------------------------------------------------
  // Per user, not per role (REQ-CTT-071 through the funnel)
  // -------------------------------------------------------------------------

  it("REQ-CTT-081/REQ-CTT-071: the same broadcast reaches two players differently, by the characters each owns", async () => {
    const aTraffic = recordEnvelopes(playerASocket);
    const bTraffic = recordEnvelopes(playerBSocket);

    // Only Fofurinha (player A's) comes to know the smith.
    const ack = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [{ actorId: glimpsedId, exceptions: { [charAId]: KnowledgeState.Known } }],
    });
    expect(ack["ok"]).toBe(true);
    await Promise.all([
      waitForSeq(aTraffic, seqOf(ack), "player A's copy of the knowledge update"),
      waitForSeq(bTraffic, seqOf(ack), "player B's copy of the knowledge update"),
    ]);

    const aDoc = actorDocsIn(aTraffic).find((d) => d["_id"] === glimpsedId);
    const bDoc = actorDocsIn(bTraffic).find((d) => d["_id"] === glimpsedId);
    expect(aDoc?.["name"]).toBe(GLIMPSED_NAME);
    expect(bDoc).toBeDefined();
    expect(bDoc).not.toHaveProperty("name");
    expect(JSON.stringify(bTraffic)).not.toContain(GLIMPSED_NAME);
    // Player B's character is Tobias, and nothing was written about him.
    expect(charBId.length).toBeGreaterThan(0);
  });

  it("REQ-CTT-082: lowering a contact to hidden empties the player's copy of the very same op", async () => {
    const aTraffic = recordEnvelopes(playerASocket);
    const ack = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [{ actorId: knownId, general: KnowledgeState.Hidden }],
    });
    expect(ack["ok"]).toBe(true);
    await waitForSeq(aTraffic, seqOf(ack), "player A's copy of the knowledge update");

    // The envelope still arrives, with an empty batch: swallowing it would jump
    // the client mirror's seq and put every player into a resync loop.
    const envelope = aTraffic.find((env) => env["seq"] === ack["seq"]);
    expect(envelope).toBeDefined();
    expect((envelope?.["payload"] as Record<string, unknown>)["documents"]).toEqual([]);
    expect(JSON.stringify(aTraffic)).not.toContain(KNOWN_NAME);
  });

  // -------------------------------------------------------------------------
  // REQ-CTT-075 — the removal is part of the delta, not of the next reload
  //
  // An empty batch says "here is nothing new about anybody"; it does NOT say
  // "forget the taverner". The client mirror only upserts, so without an
  // explicit id the contact would keep its name, portrait and title on the
  // player's screen — and keep matching the search — until F5.
  // -------------------------------------------------------------------------

  it("REQ-CTT-075/REQ-CTT-082: lowering a contact to hidden names it as removed in the very same envelope", async () => {
    const aTraffic = recordEnvelopes(playerASocket);
    const bTraffic = recordEnvelopes(playerBSocket);
    const gmTraffic = recordEnvelopes(gmSocket);

    const ack = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [{ actorId: knownId, general: KnowledgeState.Hidden }],
    });
    expect(ack["ok"]).toBe(true);
    await Promise.all([
      waitForSeq(aTraffic, seqOf(ack), "player A's copy of the knowledge update"),
      waitForSeq(bTraffic, seqOf(ack), "player B's copy of the knowledge update"),
      waitForSeq(gmTraffic, seqOf(ack), "the GM's copy of the knowledge update"),
    ]);

    for (const [label, traffic] of [
      ["player A", aTraffic],
      ["player B", bTraffic],
    ] as const) {
      const payload = aPayloadAtSeq(traffic, ack["seq"] as number);
      expect({ label, documents: payload["documents"] }).toEqual({ label, documents: [] });
      // The id, on the same op — a second envelope would break the mirror's
      // contiguous seq, and a later one would arrive after the stale render.
      expect({ label, removedIds: payload["removedIds"] }).toEqual({
        label,
        removedIds: [knownId],
      });
    }

    // The GM is told nothing of the sort: for a privileged socket the contact
    // never left, so `removedIds` must not appear at all (REQ-CTT-084 keeps the
    // map privileged; this keeps the *delta* honest for whoever can still see).
    const gmPayload = aPayloadAtSeq(gmTraffic, ack["seq"] as number);
    expect(gmPayload).not.toHaveProperty("removedIds");
    expect((gmPayload["documents"] as Record<string, unknown>[])[0]?.["name"]).toBe(KNOWN_NAME);
  });

  it("REQ-CTT-075: a contact that only went DOWN to glimpsed is not announced as removed", async () => {
    const aTraffic = recordEnvelopes(playerASocket);
    const ack = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [{ actorId: knownId, general: KnowledgeState.Glimpsed }],
    });
    expect(ack["ok"]).toBe(true);
    await waitForSeq(aTraffic, seqOf(ack), "player A's copy of the knowledge update");

    const payload = aPayloadAtSeq(aTraffic, ack["seq"] as number);
    // Still delivered, just stripped (REQ-CTT-081) — removing it from the
    // mirror would be a different lie: the contact is still on the panel, as
    // "não identificado".
    expect((payload["documents"] as Record<string, unknown>[])[0]?.["_id"]).toBe(knownId);
    expect(payload).not.toHaveProperty("removedIds");
  });

  it("REQ-CTT-075/REQ-CTT-083: the delta replay carries the removal too, not only the live broadcast", async () => {
    // Where the player stands before the change, so the replay has a start.
    const probe = connectClient(ctx, ctx.playerAToken);
    const probeTraffic = recordEnvelopes(probe);
    probe.connect();
    await waitForConnect(probe);
    await waitForJoinBatch(probeTraffic);
    const lastSeq = snapshotSeq(probeTraffic);
    probe.disconnect();

    const ack = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [{ actorId: knownId, general: KnowledgeState.Hidden }],
    });
    expect(ack["ok"]).toBe(true);

    // Reconnecting inside the buffer window replays the op out of the OpBuffer.
    const replayer = connectClient(ctx, ctx.playerAToken, lastSeq);
    const replayTraffic = recordEnvelopes(replayer);
    replayer.connect();
    await waitForConnect(replayer);
    // The wait IS the anchor: the replayed op must be there before anything is
    // read off it, so "no name in the traffic" cannot mean "no traffic".
    await waitFor(
      () => replayedOps(replayTraffic).some((op) => op["seq"] === ack["seq"]),
      "the replayed knowledge op in the delta",
    );

    const replayed = replayedOps(replayTraffic).find((op) => op["seq"] === ack["seq"]);
    expect(replayed).toBeDefined();
    const payload = replayed?.["payload"] as Record<string, unknown>;
    expect(payload["documents"]).toEqual([]);
    expect(payload["removedIds"]).toEqual([knownId]);
    expect(JSON.stringify(replayTraffic)).not.toContain(KNOWN_NAME);

    replayer.disconnect();
  });

  // -------------------------------------------------------------------------
  // REQ-CTT-083 — one funnel for snapshot, broadcast and replay
  // -------------------------------------------------------------------------

  it("REQ-CTT-083: snapshot, live broadcast and delta replay all yield exactly what the redaction module yields", async () => {
    // 1. Where the player stands right now, so the replay has a starting seq.
    const probe = connectClient(ctx, ctx.playerAToken);
    const probeTraffic = recordEnvelopes(probe);
    probe.connect();
    await waitForConnect(probe);
    await waitForJoinBatch(probeTraffic);
    const lastSeq = snapshotSeq(probeTraffic);
    probe.disconnect();

    // 2. LIVE BROADCAST — the GM touches all three contacts at once.
    const liveTraffic = recordEnvelopes(playerASocket);
    const liveAck = await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [
        { actorId: hiddenId, exceptions: { [charBId]: KnowledgeState.Known } },
        { actorId: glimpsedId, exceptions: { [charBId]: KnowledgeState.Known } },
        { actorId: knownId, exceptions: { [charBId]: KnowledgeState.Glimpsed } },
      ],
    });
    await waitForSeq(liveTraffic, seqOf(liveAck), "player A's copy of the live broadcast");

    // 3. JOIN SNAPSHOT — a fresh socket for the same user.
    const joiner = connectClient(ctx, ctx.playerAToken);
    const snapshotTraffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await waitForJoinBatch(snapshotTraffic);

    // 4. DELTA REPLAY — the same user reconnecting inside the buffer window.
    const replayer = connectClient(ctx, ctx.playerAToken, lastSeq);
    const replayTraffic = recordEnvelopes(replayer);
    replayer.connect();
    await waitForConnect(replayer);
    await waitFor(
      () => replayedOps(replayTraffic).some((op) => op["seq"] === liveAck["seq"]),
      "the replayed knowledge op in the delta",
    );

    for (const [label, actorId] of [
      ["hidden", hiddenId],
      ["glimpsed", glimpsedId],
      ["known", knownId],
    ] as const) {
      const expected = expectedFor(actorId, ctx.playerAId);
      const live = actorDocsIn(liveTraffic).find((d) => d["_id"] === actorId);
      const snap = actorDocsIn(snapshotTraffic).find((d) => d["_id"] === actorId);
      const replay = actorDocsIn(replayTraffic).find((d) => d["_id"] === actorId);
      // `undefined` on all three when the module drops the document — that IS
      // the agreement for the hidden state.
      expect({ label, doc: live }).toEqual({ label, doc: expected });
      expect({ label, doc: snap }).toEqual({ label, doc: expected });
      expect({ label, doc: replay }).toEqual({ label, doc: expected });
    }

    joiner.disconnect();
    replayer.disconnect();
  });

  it("REQ-CTT-083: the ack echoed back to the player goes through the same module", async () => {
    // The player owns Fofurinha, so this update is allowed — and the ack echoes
    // an Actor batch straight back to them.
    const ack = await sendOp(playerASocket, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: charAId, diff: { name: "Fofurinha, a Corajosa" } }],
    });
    expect(ack["ok"]).toBe(true);
    const echoed = docsOf(ack)[0];
    expect(echoed?.["_id"]).toBe(charAId);
    const flags = echoed?.["flags"] as Record<string, unknown> | undefined;
    const fusion = flags?.["fusion"] as Record<string, unknown> | undefined;
    // REQ-CTT-084 on the ack path too.
    expect(fusion === undefined || !("knowledge" in fusion)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // REQ-CTT-085 / REQ-CTT-080 — the title is a server-checked write
  // -------------------------------------------------------------------------

  it("REQ-CTT-085/REQ-CTT-080: a player without OWNER cannot write a contact's title, and the owner can write their own", async () => {
    const denied = await sendOp(playerASocket, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: knownId, diff: { flags: { fusion: { title: "Título forjado" } } } }],
    });
    expect(denied["ok"]).toBe(false);
    expect(denied["code"]).toBe("PERMISSION_DENIED");
    const storedFlags = readFromStore(knownId)["flags"] as Record<string, Record<string, unknown>>;
    expect(storedFlags["fusion"]["title"]).toBe(KNOWN_TITLE);

    // The owner of the character may set its title; so may the GM.
    const allowed = await sendOp(playerASocket, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: charAId, diff: { flags: { fusion: { title: "Guardiã da Ponte" } } } }],
    });
    expect(allowed["ok"]).toBe(true);
    const ownFlags = readFromStore(charAId)["flags"] as Record<string, Record<string, unknown>>;
    expect(ownFlags["fusion"]["title"]).toBe("Guardiã da Ponte");

    const byGm = await sendOp(gmSocket, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: knownId, diff: { flags: { fusion: { title: "Anfitrião" } } } }],
    });
    expect(byGm["ok"]).toBe(true);
  });
});
