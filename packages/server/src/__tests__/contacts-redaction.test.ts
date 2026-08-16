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

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 200));

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

  /** The world's characters, read the same way the server reads them. */
  function knowledgeSource(): ContactKnowledgeSource {
    return {
      listCharacterOwnership: () => {
        const rows = ctx.fusionDb.raw.prepare("SELECT data FROM actors").all() as {
          data: string;
        }[];
        return rows
          .map((r) => JSON.parse(r.data) as Record<string, unknown>)
          .filter((doc) => doc["type"] === "character")
          .map((doc) => ({ id: doc["_id"] as string, ownership: doc["ownership"] }));
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
    return redactActorDocsForViewer([readFromStore(actorId)], viewer)[0];
  }

  beforeEach(async () => {
    ctx = await buildTestContext();
    gmSocket = connectClient(ctx, ctx.gmToken);
    playerASocket = connectClient(ctx, ctx.playerAToken);
    playerBSocket = connectClient(ctx, ctx.playerBToken);
    gmSocket.connect();
    playerASocket.connect();
    playerBSocket.connect();
    await Promise.all([
      waitForConnect(gmSocket),
      waitForConnect(playerASocket),
      waitForConnect(playerBSocket),
    ]);
    await settle();

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
    await settle();
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
    await settle();

    expect(JSON.stringify(traffic)).not.toContain(HIDDEN_NAME);
    expect(JSON.stringify(traffic)).not.toContain(hiddenId);
    expect(actorDocsIn(traffic).some((doc) => doc["_id"] === hiddenId)).toBe(false);
    joiner.disconnect();
  });

  it("REQ-CTT-081/REQ-CTT-013: a glimpsed contact arrives with no name, title, portrait or system data", async () => {
    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await settle();

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
    await settle();

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
    await settle();

    expect(JSON.stringify(traffic)).not.toContain(DENIED_NAME);
    expect(actorDocsIn(traffic).some((doc) => doc["_id"] === deniedId)).toBe(false);
    joiner.disconnect();
  });

  it("REQ-CTT-084: no payload a player receives carries the knowledge map", async () => {
    const joiner = connectClient(ctx, ctx.playerAToken);
    const traffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await settle();

    for (const doc of actorDocsIn(traffic)) {
      const flags = doc["flags"] as Record<string, unknown> | undefined;
      const fusion = flags?.["fusion"] as Record<string, unknown> | undefined;
      expect(fusion === undefined || !("knowledge" in fusion)).toBe(true);
    }
    // The GM, on the same world, still gets it: the redaction is scoped by
    // role, not a blanket strip.
    const gmTraffic = recordEnvelopes(gmSocket);
    await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [{ actorId: knownId, general: KnowledgeState.Glimpsed }],
    });
    await settle();
    const gmDoc = actorDocsIn(gmTraffic).find((d) => d["_id"] === knownId);
    expect((gmDoc?.["flags"] as Record<string, Record<string, unknown>>)["fusion"]).toHaveProperty(
      "knowledge",
    );
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
    await settle();

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
    await settle();

    // The envelope still arrives, with an empty batch: swallowing it would jump
    // the client mirror's seq and put every player into a resync loop.
    const envelope = aTraffic.find((env) => env["seq"] === ack["seq"]);
    expect(envelope).toBeDefined();
    expect((envelope?.["payload"] as Record<string, unknown>)["documents"]).toEqual([]);
    expect(JSON.stringify(aTraffic)).not.toContain(KNOWN_NAME);
  });

  // -------------------------------------------------------------------------
  // REQ-CTT-083 — one funnel for snapshot, broadcast and replay
  // -------------------------------------------------------------------------

  it("REQ-CTT-083: snapshot, live broadcast and delta replay all yield exactly what the redaction module yields", async () => {
    // 1. Where the player stands right now, so the replay has a starting seq.
    let lastSeq = 0;
    const probe = connectClient(ctx, ctx.playerAToken);
    probe.on("op", (env: Record<string, unknown>) => {
      if (env["type"] === "resync:full") {
        const snap = (env["payload"] as Record<string, unknown>)["snapshot"] as Record<
          string,
          unknown
        > | null;
        if (snap) lastSeq = snap["seq"] as number;
      }
    });
    probe.connect();
    await waitForConnect(probe);
    await settle();
    probe.disconnect();

    // 2. LIVE BROADCAST — the GM touches all three contacts at once.
    const liveTraffic = recordEnvelopes(playerASocket);
    await sendOp(gmSocket, "actor:setKnowledge", {
      updates: [
        { actorId: hiddenId, exceptions: { [charBId]: KnowledgeState.Known } },
        { actorId: glimpsedId, exceptions: { [charBId]: KnowledgeState.Known } },
        { actorId: knownId, exceptions: { [charBId]: KnowledgeState.Glimpsed } },
      ],
    });
    await settle();

    // 3. JOIN SNAPSHOT — a fresh socket for the same user.
    const joiner = connectClient(ctx, ctx.playerAToken);
    const snapshotTraffic = recordEnvelopes(joiner);
    joiner.connect();
    await waitForConnect(joiner);
    await settle();

    // 4. DELTA REPLAY — the same user reconnecting inside the buffer window.
    const replayer = connectClient(ctx, ctx.playerAToken, lastSeq);
    const replayTraffic = recordEnvelopes(replayer);
    replayer.connect();
    await waitForConnect(replayer);
    await settle();

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
