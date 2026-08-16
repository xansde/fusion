/**
 * Contact knowledge over the real socket — general rule + per-character
 * exceptions (G060, spec 39 §5.8/§5.9).
 *
 * Covers REQ-CTT-070, REQ-CTT-071, REQ-CTT-072, REQ-CTT-073, REQ-CTT-074,
 * REQ-CTT-075, REQ-CTT-076 and the creation half of REQ-CTT-080 against a
 * booted server: no mocked store, no
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
import {
  PROTOCOL_VERSION,
  KnowledgeState,
  readKnowledgeMap,
  touchesKnowledgeFlag,
} from "@fusion/shared";
import type { KnowledgeMap } from "@fusion/shared";
import { pf2eSystem } from "@fusion/system-pf2e";
import { sf2eSystem } from "@fusion/system-sf2e";
import { etmosSystem } from "@fusion/system-etmos";
import { isCharacterActor, isNonPlayableActor } from "../documents/knowledge.js";
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
  payload: {
    documentType?: string;
    documents?: Record<string, unknown>[];
    ids?: string[];
    removedIds?: string[];
  };
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
  let playerBOps: OpEnvelope[];

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
    playerBOps = collectOps(playerB);

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

  // -------------------------------------------------------------------------
  // REQ-CTT-070 — a refused batch writes NOTHING
  //
  // The window cycles a whole column with ONE op carrying one edit per contact
  // (`columnCycleEdits`). If the handler persisted as it looped and only then
  // hit a bad edit, the contacts before it would already be written while the
  // ack said `ok:false` and no broadcast ever left — server and clients
  // diverging in silence until the next resync. The batch is all-or-nothing.
  // -------------------------------------------------------------------------

  describe("REQ-CTT-070: a batch refused halfway writes nothing at all", () => {
    let firstContact: string;
    let secondContact: string;

    beforeAll(async () => {
      firstContact = await createActor({
        name: "Batch Contact One",
        type: "npc",
        ownership: { default: 0 },
      });
      secondContact = await createActor({
        name: "Batch Contact Two",
        type: "npc",
        ownership: { default: 0 },
      });
    }, 20000);

    /** Every knowledge state on both contacts, as world.db holds it right now. */
    function snapshot(): [KnowledgeMap, KnowledgeMap] {
      return [mapOf(readFromStore(firstContact)), mapOf(readFromStore(secondContact))];
    }

    /** True when any op after `from` carried one of the two contacts. */
    function broadcastTouchedContacts(from: number): boolean {
      return gmOps
        .slice(from)
        .some((envelope) =>
          (envelope.payload.documents ?? []).some(
            (doc) => doc["_id"] === firstContact || doc["_id"] === secondContact,
          ),
        );
    }

    it("REQ-CTT-070: an edit naming an actor that no longer exists rolls the whole batch back", async () => {
      // Give the first contact a state worth losing, so a partial write would
      // be visible rather than coincidentally equal to the default.
      const seed = await sendOp(gm, "actor:setKnowledge", {
        updates: [{ actorId: firstContact, general: KnowledgeState.Hidden }],
      });
      expect(seed["ok"]).toBe(true);
      const before = snapshot();
      const opsBefore = gmOps.length;

      // Edit 0 is perfectly valid and comes FIRST; edit 1 names a contact the
      // world does not have. The order is the whole point: a handler that
      // writes as it loops has already committed edit 0 when edit 1 is refused.
      const ack = await sendOp(gm, "actor:setKnowledge", {
        updates: [
          { actorId: firstContact, general: KnowledgeState.Known },
          { actorId: "does-not-exist01", general: KnowledgeState.Known },
        ],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("NOT_FOUND");

      // The valid edit did NOT land: world.db is byte-identical to before.
      expect(snapshot()).toEqual(before);
      expect(mapOf(readFromStore(firstContact)).general).toBe(KnowledgeState.Hidden);
      // And nothing was broadcast either — no client was told a half-truth.
      expect(broadcastTouchedContacts(opsBefore)).toBe(false);
    });

    it("REQ-CTT-070/REQ-CTT-072: an exception naming a non-character rolls the whole batch back", async () => {
      const before = snapshot();
      const opsBefore = gmOps.length;
      // Edit 0 has to be a REAL change, or a handler that writes as it loops
      // would pass this by coincidence: a no-op leaves the store untouched for
      // the wrong reason. `Glimpsed` differs from whatever sits there now.
      expect(before[0].general).not.toBe(KnowledgeState.Glimpsed);

      // Same shape, refused by the other guard: edit 0 is valid, edit 1 keys an
      // exception on a contact (an `npc`), which is not a character.
      const ack = await sendOp(gm, "actor:setKnowledge", {
        updates: [
          { actorId: firstContact, general: KnowledgeState.Glimpsed },
          { actorId: secondContact, exceptions: { [secondContact]: KnowledgeState.Known } },
        ],
      });
      expect(ack["ok"]).toBe(false);
      expect(ack["code"]).toBe("VALIDATION_FAILED");

      expect(snapshot()).toEqual(before);
      expect(broadcastTouchedContacts(opsBefore)).toBe(false);
    });

    it("REQ-CTT-070/REQ-CTT-075: the same batch with every edit valid lands in one delta", async () => {
      // The counter-proof: the rollback above is the guard firing, not the
      // batch path being broken. Both contacts move, on ONE seq.
      const ack = await sendOp(gm, "actor:setKnowledge", {
        updates: [
          { actorId: firstContact, general: KnowledgeState.Known },
          { actorId: secondContact, general: KnowledgeState.Glimpsed },
        ],
      });
      expect(ack["ok"]).toBe(true);
      const seq = ack["seq"] as number;

      expect(snapshot()).toEqual([
        { general: KnowledgeState.Known, exceptions: {} },
        { general: KnowledgeState.Glimpsed, exceptions: {} },
      ]);

      const envelope = await waitForOp(
        gmOps,
        (e) => e.type === "doc:update" && e.seq === seq,
        "the batched knowledge delta",
      );
      expect((envelope.payload.documents ?? []).map((d) => d["_id"])).toEqual(
        expect.arrayContaining([firstContact, secondContact]),
      );
    });
  });

  it("REQ-CTT-070/REQ-CTT-076: an etmos `orador` is a character — the exception is accepted, and deleting it sweeps", async () => {
    // The playable Actor subtype is the system's word: pf2e/sf2e say
    // "character", etmos says "orador" (`documentTypes.Actor`). Refusing the
    // exception here would leave the grid uneditable in every Etmos world.
    const oradorId = await createActor({
      name: "Voz do Bosque",
      type: "orador",
      ownership: { default: 0, [ctx.playerAId]: 3 },
    });

    const ack = await sendOp(gm, "actor:setKnowledge", {
      updates: [
        {
          actorId: contactId,
          general: KnowledgeState.Hidden,
          clearExceptions: true,
          exceptions: { [oradorId]: KnowledgeState.Known },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    expect(mapOf(readFromStore(contactId)).exceptions[oradorId]).toBe(KnowledgeState.Known);

    // REQ-CTT-076: and it sweeps like any other character when deleted.
    const del = await sendOp(gm, "doc:delete", { documentType: "Actor", ids: [oradorId] });
    expect(del["ok"]).toBe(true);
    expect(mapOf(readFromStore(contactId))).toEqual({
      general: KnowledgeState.Hidden,
      exceptions: {},
    });
  });

  it("REQ-CTT-071: the payload a user receives follows the HIGHEST state among the characters they own", async () => {
    // Player B owns two characters. The general rule stays `oculto` throughout,
    // so the ONLY thing that can put this contact on player B's socket is a
    // single exception on ONE of the two — which is exactly the maximum the
    // requirement asks for. The verdict is read off the envelope player B's
    // socket actually received, never recomputed here.
    const secondCharB = await createActor({
      name: "Character B2",
      type: "character",
      ownership: { default: 0, [ctx.playerBId]: 3 },
    });

    /** The `doc:update` player B received for the op the ack names. */
    async function envelopeFor(ack: Record<string, unknown>, what: string): Promise<OpEnvelope> {
      expect(ack["ok"]).toBe(true);
      const seq = ack["seq"] as number;
      return waitForOp(
        playerBOps,
        (e) => e.type === "doc:update" && e.seq === seq,
        `${what} on player B's socket`,
      );
    }

    // (1) The exception sits on the character created LAST. A rule that read
    // the general rule, the minimum, or the first character would leave player
    // B at `oculto` and the contact would never arrive.
    const onSecond = await sendOp(gm, "actor:setKnowledge", {
      updates: [
        {
          actorId: contactId,
          general: KnowledgeState.Hidden,
          clearExceptions: true,
          exceptions: { [secondCharB]: KnowledgeState.Known },
        },
      ],
    });
    const stored = mapOf(readFromStore(contactId));
    expect(stored).toEqual({
      general: KnowledgeState.Hidden,
      exceptions: { [secondCharB]: KnowledgeState.Known },
    });

    const first = await envelopeFor(onSecond, "the contact raised on the second character");
    const asKnown = (first.payload.documents ?? []).find((d) => d["_id"] === contactId);
    // Whole: name and all — a `glimpsed` or `hidden` verdict could not produce it.
    expect(asKnown?.["name"]).toBe("Innkeeper");
    expect(first.payload.removedIds ?? []).not.toContain(contactId);

    // (2) The same exception moved to the OTHER character keeps the contact
    // whole: no character slot is privileged, the maximum is over all of them.
    const onFirst = await sendOp(gm, "actor:setKnowledge", {
      updates: [
        {
          actorId: contactId,
          general: KnowledgeState.Hidden,
          clearExceptions: true,
          exceptions: { [charBId]: KnowledgeState.Known },
        },
      ],
    });
    const second = await envelopeFor(onFirst, "the contact raised on the first character");
    expect((second.payload.documents ?? []).find((d) => d["_id"] === contactId)?.["name"]).toBe(
      "Innkeeper",
    );
    expect(second.payload.removedIds ?? []).not.toContain(contactId);

    // (3) Drop the last exception and BOTH characters fall back to `oculto`:
    // the maximum is now `oculto` too, so the body leaves the batch and the id
    // travels as a removal (REQ-CTT-075/REQ-CTT-082).
    const dropped = await sendOp(gm, "actor:setKnowledge", {
      updates: [{ actorId: contactId, general: KnowledgeState.Hidden, clearExceptions: true }],
    });
    const third = await envelopeFor(dropped, "the contact dropping back to hidden");
    expect((third.payload.documents ?? []).some((d) => d["_id"] === contactId)).toBe(false);
    expect(third.payload.removedIds ?? []).toContain(contactId);
    expect(JSON.stringify(third)).not.toContain("Innkeeper");
  });

  // -------------------------------------------------------------------------
  // REQ-CTT-080 / REQ-CTT-072 — the OTHER door: doc:create
  //
  // doc:update refuses the knowledge flag outright (tested above). Creation is
  // the door next to it: a plain PLAYER may create exactly one Actor of their
  // own — the companion of r17-P1 — and that payload is written by the client.
  // If creation accepted the flag verbatim, authoring knowledge would simply
  // move from `doc:update` to `doc:create`.
  // -------------------------------------------------------------------------

  it("REQ-CTT-080: a player creating their own companion (r17-P1) cannot smuggle knowledge in the create payload", async () => {
    // The master: a character the player OWNS, carrying the feat that grants a
    // familiar — the only configuration in which a PLAYER may create an Actor.
    const masterId = await createActor({
      name: "Wizard Master",
      type: "character",
      system: { details: { level: { value: 3 } } },
      ownership: { default: 0, [ctx.playerAId]: 3 },
      items: [{ _id: "feat-familiar", name: "Familiar", type: "feat", system: { rules: [] } }],
    });

    // The player creates the familiar — legitimately — and forges a knowledge
    // map into the very same payload.
    const ack = await sendOp(playerA, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Tobias",
          type: "familiar",
          flags: {
            fusion: {
              knowledge: {
                general: KnowledgeState.Known,
                exceptions: { [masterId]: KnowledgeState.Known },
              },
              // An unrelated flag in the same namespace must survive: the guard
              // removes the knowledge key, not the player's own bookkeeping.
              companionNote: "familiar do mago",
            },
          },
          system: {
            companionKind: "familiar",
            masterActorId: masterId,
            master: {
              level: 3,
              abilityMod: 4,
              ac: 18,
              saves: { fortitude: 1, reflex: 1, will: 1 },
              perception: 1,
            },
            attributes: { hp: { value: 15, max: 15, temp: 0 } },
            abilitiesBudget: { value: 2, max: 2 },
            selectedAbilities: [],
          },
        },
      ],
    });

    // The create itself is allowed (r17-P1) — it is the knowledge that is not.
    expect(ack["ok"]).toBe(true);
    const familiarId = docsOf(ack)[0]?.["_id"];
    expect(typeof familiarId).toBe("string");

    // The document as world.db holds it carries NO knowledge flag at all: not
    // an empty map, not a default — the key was never written.
    const stored = readFromStore(familiarId as string);
    expect(touchesKnowledgeFlag(stored)).toBe(false);
    expect((stored["flags"] as Record<string, Record<string, unknown>>)["fusion"]).toEqual({
      companionNote: "familiar do mago",
    });

    // And the ack the player got back says the same thing — no leak either way.
    expect(touchesKnowledgeFlag(docsOf(ack)[0])).toBe(false);
  });

  it("REQ-CTT-072: a contact created by the GM is born normalized — an exception equal to the general rule is not stored", async () => {
    const charX = await createActor({
      name: "Character X",
      type: "character",
      ownership: { default: 0, [ctx.playerAId]: 3 },
    });
    const charY = await createActor({
      name: "Character Y",
      type: "character",
      ownership: { default: 0, [ctx.playerBId]: 3 },
    });

    const ack = await sendOp(gm, "doc:create", {
      documentType: "Actor",
      data: [
        {
          name: "Guildmaster",
          type: "npc",
          ownership: { default: 0 },
          flags: {
            fusion: {
              knowledge: {
                general: KnowledgeState.Glimpsed,
                exceptions: {
                  // Same state as the general rule: redundant, must not survive.
                  [charX]: KnowledgeState.Glimpsed,
                  // A real exception: must survive untouched.
                  [charY]: KnowledgeState.Known,
                },
              },
            },
          },
        },
      ],
    });
    expect(ack["ok"]).toBe(true);
    const newContactId = docsOf(ack)[0]?.["_id"];
    expect(typeof newContactId).toBe("string");

    expect(mapOf(readFromStore(newContactId as string))).toEqual({
      general: KnowledgeState.Glimpsed,
      exceptions: { [charY]: KnowledgeState.Known },
    });
  });
});

// ---------------------------------------------------------------------------
// The mirrors vs. the manifests they mirror
// ---------------------------------------------------------------------------

/**
 * `documents/knowledge.ts` mirrors by hand which Actor subtype is a player
 * character and which one is a contact, because the server package may not
 * import a system package. A hand mirror rots in silence: the day a system
 * declares a playable subtype nobody copied over, that world answers with NO
 * characters — no exception ever applies (REQ-CTT-071), every other player's
 * character is filtered out of the payload, and the grid refuses the write.
 *
 * So the mirror is checked against the manifests themselves — a different
 * source, read here as data (`manifest.documentTypes.Actor`), never the
 * mirror's own table compared to itself.
 */
describe("Actor subtype mirrors vs. the system manifests (REQ-CTT-071, REQ-CTT-074)", () => {
  const SYSTEMS = [
    { id: "pf2e", subtypes: pf2eSystem.manifest.documentTypes["Actor"] ?? [] },
    { id: "sf2e", subtypes: sf2eSystem.manifest.documentTypes["Actor"] ?? [] },
    { id: "etmos", subtypes: etmosSystem.manifest.documentTypes["Actor"] ?? [] },
  ];

  /**
   * Subtypes deliberately classified as NEITHER a character nor a contact: the
   * chest (`loot`, DEC-NPC-08) and a companion (`familiar`, DEC-CTT-06), both
   * of which answer to `ownership` alone (REQ-CTT-074). Naming them here is the
   * decision; what the test refuses is SILENCE about a subtype nobody decided.
   */
  const DECIDED_AS_NEITHER = new Set(["loot", "familiar"]);

  it("REQ-CTT-071/REQ-CTT-074: every Actor subtype a system declares is classified — none falls through unnoticed", () => {
    const unclassified: string[] = [];
    for (const system of SYSTEMS) {
      for (const subtype of system.subtypes) {
        const doc = { type: subtype };
        if (isCharacterActor(doc) || isNonPlayableActor(doc)) continue;
        if (DECIDED_AS_NEITHER.has(subtype)) continue;
        unclassified.push(`${system.id}:${subtype}`);
      }
    }
    expect(unclassified).toEqual([]);
  });

  it("REQ-CTT-071: the playable Actor each system declares first is read as a character, never as a contact", () => {
    // The manifests put the player's own Actor first: pf2e/sf2e `character`,
    // etmos `orador`. Reading only one of those literals is the bug this guards.
    const verdicts = SYSTEMS.map((system) => {
      const playable = system.subtypes[0] ?? "";
      return {
        id: system.id,
        playable,
        isCharacter: isCharacterActor({ type: playable }),
        isContact: isNonPlayableActor({ type: playable }),
      };
    });
    expect(verdicts).toEqual([
      { id: "pf2e", playable: "character", isCharacter: true, isContact: false },
      { id: "sf2e", playable: "character", isCharacter: true, isContact: false },
      { id: "etmos", playable: "orador", isCharacter: true, isContact: false },
    ]);
  });
});
