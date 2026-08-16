/**
 * Contact knowledge over the real socket — general rule + per-character
 * exceptions (G060, spec 39 §5.8/§5.9).
 *
 * Covers REQ-CTT-070, REQ-CTT-071, REQ-CTT-072, REQ-CTT-073, REQ-CTT-074,
 * REQ-CTT-075 and REQ-CTT-076 against a booted server: no mocked store, no
 * mocked handler registry. Every assertion about what a user may or may not
 * do reads the ACK or the broadcast PAYLOAD the socket actually received —
 * never a screen, and never the helper's own return value fed back to itself.
 *
 * The model under test has no table and no migration: knowledge is
 * `flags.fusion.knowledge` on the contact's own Actor document, exactly as
 * spec 39 §7 and spec 42 §7 record it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { io as ioClient } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import { boot } from "../boot.js";
import type { BootResult } from "../boot.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { AuthService } from "../auth/service.js";
import { Role } from "../auth/user-store.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { PROTOCOL_VERSION, KnowledgeState, readKnowledgeMap } from "@fusion/shared";
import type { KnowledgeMap } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";
import { reserveFreePort } from "./helpers/ports.js";

// ---------------------------------------------------------------------------
// Infrastructure (mirrors condition-toggle.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  // Data dir lives in the OS temp dir, never inside the worktree.
  const dir = join(
    tmpdir(),
    `fusion-contacts-knowledge-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Ctx {
  dataDir: string;
  fusionDb: FusionDatabase;
  bootResult: BootResult;
  port: number;
  worldId: string;
  gmToken: string;
  playerAToken: string;
  playerAId: string;
  playerBToken: string;
  playerBId: string;
}

async function buildCtx(): Promise<Ctx> {
  const worldId = "contacts_knowledge_world";
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");

  const secret = loadOrCreateSecret(dataDir);
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const authService = new AuthService(fusionDb.raw, secret, worldId);
  const { user: gm, password: gmPw } = await authService.bootstrapGm();
  const { user: playerA } = await authService.createUser({
    name: "KnowledgePlayerA",
    role: Role.PLAYER,
    password: "player-a-pass",
  });
  const { user: playerB } = await authService.createUser({
    name: "KnowledgePlayerB",
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

  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: await reserveFreePort(), host: "127.0.0.1", logLevel: "silent" },
  });
  const logger = createLogger("silent");

  const bootResult = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    authContext: {
      worldId,
      worldTitle: "Contacts Knowledge World",
      worldSystemId: "pf2e",
      db: fusionDb.raw,
      secret,
    },
    netContext: {
      worldId,
      db: fusionDb.raw,
      secret,
      authService,
      origin: "http://127.0.0.1",
      systemId: "pf2e",
      systemModule: pf2eSystem,
    },
  });

  const address = bootResult.fastify.server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");

  return {
    dataDir,
    fusionDb,
    bootResult,
    port: address.port,
    worldId,
    gmToken: gmLogin.accessToken,
    playerAToken: aLogin.accessToken,
    playerAId: playerA.id,
    playerBToken: bLogin.accessToken,
    playerBId: playerB.id,
  };
}

async function teardown(ctx: Ctx): Promise<void> {
  await ctx.bootResult.shutdown();
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
    socket.emit("op", { type, ts: Date.now(), payload }, (r: Record<string, unknown>) =>
      resolve(r),
    );
    setTimeout(() => reject(new Error(`Timeout for op: ${type}`)), 8000);
  });
}

interface OpEnvelope {
  type: string;
  seq?: number;
  payload: { documentType?: string; documents?: Record<string, unknown>[]; ids?: string[] };
}

/** Every `op` envelope the socket receives, in arrival order. */
function collectOps(socket: ClientSocket): OpEnvelope[] {
  const ops: OpEnvelope[] = [];
  socket.on("op", (envelope: OpEnvelope) => ops.push(envelope));
  return ops;
}

async function waitForOp(
  ops: readonly OpEnvelope[],
  match: (envelope: OpEnvelope) => boolean,
  what: string,
): Promise<OpEnvelope> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const found = ops.find(match);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function docsOf(ack: Record<string, unknown>): Record<string, unknown>[] {
  const result = ack["result"] as { documents?: Record<string, unknown>[] } | undefined;
  return result?.documents ?? [];
}

/** Read the knowledge map straight out of a document as the server persisted it. */
function mapOf(doc: Record<string, unknown> | undefined): KnowledgeMap {
  return readKnowledgeMap(doc);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Contact knowledge — REQ-CTT-070..076 over the real socket (G060)", () => {
  let ctx: Ctx;
  let gm: ClientSocket;
  let playerA: ClientSocket;
  let playerB: ClientSocket;
  let gmOps: OpEnvelope[];
  let playerAOps: OpEnvelope[];

  let charAId: string;
  let charBId: string;
  let contactId: string;

  async function createActor(payload: Record<string, unknown>): Promise<string> {
    const ack = await sendOp(gm, "doc:create", { documentType: "Actor", data: [payload] });
    expect(ack["ok"]).toBe(true);
    const id = docsOf(ack)[0]?.["_id"];
    if (typeof id !== "string") throw new Error("Actor create returned no _id");
    return id;
  }

  /** The document exactly as it sits in world.db — the model's real home. */
  function readFromStore(actorId: string): Record<string, unknown> {
    const row = ctx.fusionDb.raw.prepare("SELECT data FROM actors WHERE id = ?").get(actorId) as
      | { data: string }
      | undefined;
    if (!row) throw new Error(`Actor ${actorId} not found in world.db`);
    return JSON.parse(row.data) as Record<string, unknown>;
  }

  beforeAll(async () => {
    ctx = await buildCtx();
    gm = connectClient(ctx.port, ctx.worldId, ctx.gmToken);
    playerA = connectClient(ctx.port, ctx.worldId, ctx.playerAToken);
    playerB = connectClient(ctx.port, ctx.worldId, ctx.playerBToken);
    gm.connect();
    playerA.connect();
    playerB.connect();
    await Promise.all([waitForConnect(gm), waitForConnect(playerA), waitForConnect(playerB)]);
    gmOps = collectOps(gm);
    playerAOps = collectOps(playerA);

    charAId = await createActor({
      name: "Character A",
      type: "character",
      ownership: { default: 0, [ctx.playerAId]: 3 },
    });
    charBId = await createActor({
      name: "Character B",
      type: "character",
      ownership: { default: 0, [ctx.playerBId]: 3 },
    });
    contactId = await createActor({
      name: "Innkeeper",
      type: "npc",
      ownership: { default: 0 },
    });
  }, 40000);

  afterAll(async () => {
    gm?.disconnect();
    playerA?.disconnect();
    playerB?.disconnect();
    await teardown(ctx);
  });

  // -------------------------------------------------------------------------
  // The field itself
  // -------------------------------------------------------------------------

  it("REQ-CTT-070: a contact starts hidden for everyone, with the map on its own document", () => {
    expect(mapOf(readFromStore(contactId))).toEqual({
      general: KnowledgeState.Hidden,
      exceptions: {},
    });
  });

  it("REQ-CTT-070/REQ-CTT-072: the GM writes a general rule and a per-character exception", async () => {
    const ack = await sendOp(gm, "actor:setKnowledge", {
      updates: [
        {
          actorId: contactId,
          general: KnowledgeState.Glimpsed,
          exceptions: { [charAId]: KnowledgeState.Known },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    const doc = docsOf(ack)[0];
    expect(doc?.["_id"]).toBe(contactId);
    expect(mapOf(doc)).toEqual({
      general: KnowledgeState.Glimpsed,
      exceptions: { [charAId]: KnowledgeState.Known },
    });
    // Persisted on the contact's own row — no side table was involved.
    expect(mapOf(readFromStore(contactId))).toEqual(mapOf(doc));
  });

  it("REQ-CTT-072: an exception equal to the general rule is REMOVED, not duplicated", async () => {
    const ack = await sendOp(gm, "actor:setKnowledge", {
      updates: [{ actorId: contactId, exceptions: { [charBId]: KnowledgeState.Glimpsed } }],
    });
    // The write is a no-op on the stored map: the state asked for is already
    // what the general rule gives, so nothing is stored and no seq is burned.
    expect(ack["ok"]).toBe(true);
    const stored = mapOf(readFromStore(contactId));
    expect(charBId in stored.exceptions).toBe(false);
    expect(stored.exceptions).toEqual({ [charAId]: KnowledgeState.Known });

    // And when an existing exception is overwritten with the general rule, it
    // disappears rather than lingering as a duplicate.
    const ack2 = await sendOp(gm, "actor:setKnowledge", {
      updates: [{ actorId: contactId, exceptions: { [charBId]: KnowledgeState.Known } }],
    });
    expect(ack2["ok"]).toBe(true);
    expect(mapOf(readFromStore(contactId)).exceptions).toEqual({
      [charAId]: KnowledgeState.Known,
      [charBId]: KnowledgeState.Known,
    });

    const ack3 = await sendOp(gm, "actor:setKnowledge", {
      updates: [{ actorId: contactId, exceptions: { [charBId]: KnowledgeState.Glimpsed } }],
    });
    expect(ack3["ok"]).toBe(true);
    expect(mapOf(readFromStore(contactId)).exceptions).toEqual({
      [charAId]: KnowledgeState.Known,
    });
  });

  // -------------------------------------------------------------------------
  // REQ-CTT-075 — the delta reaches the affected user without a reload
  // -------------------------------------------------------------------------

  it("REQ-CTT-075: changing knowledge broadcasts the delta to the affected user without a reload", async () => {
    const ack = await sendOp(gm, "actor:setKnowledge", {
      updates: [{ actorId: contactId, exceptions: { [charAId]: KnowledgeState.Glimpsed } }],
    });
    expect(ack["ok"]).toBe(true);
    const seq = ack["seq"] as number;

    // The player's live socket receives the very op the ack names — no
    // resync:request was sent, no page was reloaded: the same doc:update pipe
    // every other change uses, carrying the same seq.
    const envelope = await waitForOp(
      playerAOps,
      (e) => e.type === "doc:update" && e.seq === seq,
      "the knowledge delta on player A's socket",
    );
    expect(envelope.payload.documentType).toBe("Actor");
    expect((envelope.payload.documents ?? []).map((d) => d["_id"])).toContain(contactId);
  });

  // -------------------------------------------------------------------------
  // REQ-CTT-073 — a character created later inherits the general rule
  // -------------------------------------------------------------------------

  it("REQ-CTT-073: a character created after the fact inherits the general rule with no GM operation", async () => {
    const storedBefore = mapOf(readFromStore(contactId));
    const lateCharId = await createActor({
      name: "Character C (created later)",
      type: "character",
      ownership: { default: 0 },
    });

    const stored = mapOf(readFromStore(contactId));
    // Nothing was written for the new character — the map is byte-identical...
    expect(stored).toEqual(storedBefore);
    expect(lateCharId in stored.exceptions).toBe(false);
    // ...and yet the rule in force already applies to it.
    expect(stored.general).toBe(KnowledgeState.Glimpsed);
  });

  // -------------------------------------------------------------------------
  // REQ-CTT-080 / REQ-CTT-070 — only the server writes it, and only for GM
  // -------------------------------------------------------------------------

  it("REQ-CTT-070: a player who forges actor:setKnowledge is refused by the server", async () => {
    const before = mapOf(readFromStore(contactId));
    const ack = await sendOp(playerA, "actor:setKnowledge", {
      updates: [{ actorId: contactId, general: KnowledgeState.Known }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    expect(mapOf(readFromStore(contactId))).toEqual(before);
  });

  it("REQ-CTT-070: doc:update cannot write the knowledge flag — not even on a document the player owns", async () => {
    const before = mapOf(readFromStore(charAId));
    const ack = await sendOp(playerA, "doc:update", {
      documentType: "Actor",
      updates: [
        {
          _id: charAId,
          diff: { flags: { fusion: { knowledge: { general: 2, exceptions: {} } } } },
        },
      ],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(mapOf(readFromStore(charAId))).toEqual(before);

    // The dot-path form is the same door, and is shut too.
    const dotted = await sendOp(playerA, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: charAId, diff: { "flags.fusion.knowledge.general": 2 } }],
    });
    expect(dotted["ok"]).toBe(false);
    expect(dotted["code"]).toBe("VALIDATION_FAILED");
    expect(mapOf(readFromStore(charAId))).toEqual(before);
  });

  it("REQ-CTT-070: the GM's own doc:update is refused too — actor:setKnowledge is the only door", async () => {
    const before = mapOf(readFromStore(contactId));
    const ack = await sendOp(gm, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: contactId, diff: { flags: { fusion: { knowledge: { general: 2 } } } } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(mapOf(readFromStore(contactId))).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // REQ-CTT-074 — knowledge restricts; it never grants
  // -------------------------------------------------------------------------

  it("REQ-CTT-074: a contact known to a player still refuses that player's write — knowledge is not ownership", async () => {
    const raise = await sendOp(gm, "actor:setKnowledge", {
      updates: [{ actorId: contactId, general: KnowledgeState.Known }],
    });
    expect(raise["ok"]).toBe(true);
    expect(mapOf(readFromStore(contactId)).general).toBe(KnowledgeState.Known);

    // `Known` is the highest state there is, and the contact's ownership still
    // says NONE — so an ordinary edit stays denied.
    const ack = await sendOp(playerA, "doc:update", {
      documentType: "Actor",
      updates: [{ _id: contactId, diff: { name: "Renamed by a player" } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("PERMISSION_DENIED");
    expect(readFromStore(contactId)["name"]).toBe("Innkeeper");
  });

  // -------------------------------------------------------------------------
  // REQ-CTT-076 — deleting a character sweeps the exceptions that cite it
  // -------------------------------------------------------------------------

  it("REQ-CTT-076: deleting a character removes the exceptions naming it and leaves every general rule alone", async () => {
    // Put the contact back in a state with a real exception on character A.
    const setup = await sendOp(gm, "actor:setKnowledge", {
      updates: [
        {
          actorId: contactId,
          general: KnowledgeState.Hidden,
          clearExceptions: true,
          exceptions: { [charAId]: KnowledgeState.Known, [charBId]: KnowledgeState.Glimpsed },
        },
      ],
    });
    expect(setup["ok"]).toBe(true);
    expect(mapOf(readFromStore(contactId))).toEqual({
      general: KnowledgeState.Hidden,
      exceptions: { [charAId]: KnowledgeState.Known, [charBId]: KnowledgeState.Glimpsed },
    });

    const del = await sendOp(gm, "doc:delete", { documentType: "Actor", ids: [charAId] });
    expect(del["ok"]).toBe(true);
    const deleteSeq = del["seq"] as number;

    const after = mapOf(readFromStore(contactId));
    expect(charAId in after.exceptions).toBe(false);
    // The general rule and every other exception are exactly as they were.
    expect(after).toEqual({
      general: KnowledgeState.Hidden,
      exceptions: { [charBId]: KnowledgeState.Glimpsed },
    });

    // REQ-CTT-075: the sweep travels as its own delta, so no client has to
    // reload to stop showing a rule about a character that no longer exists.
    const sweep = await waitForOp(
      gmOps,
      (e) =>
        e.type === "doc:update" &&
        (e.seq ?? 0) > deleteSeq &&
        e.payload.documentType === "Actor" &&
        (e.payload.documents ?? []).some((d) => d["_id"] === contactId),
      "the knowledge sweep broadcast after the character delete",
    );
    expect(mapOf((sweep.payload.documents ?? []).find((d) => d["_id"] === contactId))).toEqual(
      after,
    );
  });

  it("REQ-CTT-076: deleting a non-character actor sweeps nothing", async () => {
    const spare = await createActor({ name: "A Barrel", type: "npc", ownership: { default: 0 } });
    const before = mapOf(readFromStore(contactId));
    const del = await sendOp(gm, "doc:delete", { documentType: "Actor", ids: [spare] });
    expect(del["ok"]).toBe(true);
    expect(mapOf(readFromStore(contactId))).toEqual(before);
  });

  it("REQ-CTT-071/REQ-CTT-072: an exception naming an actor that is not a character is refused", async () => {
    const before = mapOf(readFromStore(contactId));
    const ack = await sendOp(gm, "actor:setKnowledge", {
      updates: [{ actorId: contactId, exceptions: { [contactId]: KnowledgeState.Known } }],
    });
    expect(ack["ok"]).toBe(false);
    expect(ack["code"]).toBe("VALIDATION_FAILED");
    expect(mapOf(readFromStore(contactId))).toEqual(before);

    // A stale key may always be REMOVED, whatever it names — that is how the
    // map is cleaned up after a character is gone.
    const cleanup = await sendOp(gm, "actor:setKnowledge", {
      updates: [{ actorId: contactId, exceptions: { [charAId]: null } }],
    });
    expect(cleanup["ok"]).toBe(true);
  });

  it("REQ-CTT-071: a user's effective state is the highest among the characters they own", async () => {
    // charB is player B's; a second character of player B sits at Hidden.
    const secondCharB = await createActor({
      name: "Character B2",
      type: "character",
      ownership: { default: 0, [ctx.playerBId]: 3 },
    });
    const ack = await sendOp(gm, "actor:setKnowledge", {
      updates: [
        {
          actorId: contactId,
          general: KnowledgeState.Hidden,
          clearExceptions: true,
          exceptions: { [charBId]: KnowledgeState.Known },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);

    const stored = mapOf(readFromStore(contactId));
    // The pair-by-pair states the server persisted: one Known, one Hidden.
    expect(stored.exceptions[charBId]).toBe(KnowledgeState.Known);
    expect(stored.exceptions[secondCharB]).toBeUndefined();
    expect(stored.general).toBe(KnowledgeState.Hidden);
    // Player B therefore sits at Known for this contact: the maximum wins.
    const states = [charBId, secondCharB].map((id) => stored.exceptions[id] ?? stored.general);
    expect(Math.max(...states)).toBe(KnowledgeState.Known);
  });
});
