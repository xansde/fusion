/**
 * target-selection.test.ts — TargetSelection contract (ALQ-F1-05).
 *
 * Spec: 10-combate-e-iniciativa.md REQ-CBT-056; plan §2.3.
 *
 * Covers the task's TDD acceptance:
 *   - P marks T1 and T2 and rolls -> the message records targetSnapshot [T1, T2].
 *   - P un-marks T2 afterwards -> the PERSISTED snapshot does not change.
 *   - After turnEnd of P's combatant (REQ-CBT-055) the live selection empties,
 *     and the persisted snapshot still does not change.
 * Plus direct coverage of resolveTargetSelection/assertTargetsSelected as the
 * owning contract (plan §2.3): empty selection, a dangling tokenId, and the
 * GM-bypass / FORBIDDEN+missing paths.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Namespace } from "socket.io";

import { openDatabase, applyMigrations } from "../../db/index.js";
import type { FusionDatabase } from "../../db/index.js";
import { DocumentStore } from "../../documents/store.js";
import { SeqStore } from "../../net/seq-store.js";
import { OpBuffer } from "../../net/op-buffer.js";
import { UserRole } from "../../documents/ownership.js";
import { RollService } from "../../chat/roll-service.js";
import { InitiativeFormulaRegistry } from "../initiative-registry.js";
import { CombatEventBus } from "../combat-event-bus.js";
import { TargetingStore } from "../targeting-store.js";
import { buildCombatTargetHandler, registerTargetingCleanup } from "../target-handler.js";
import type { TargetHandlerDeps } from "../target-handler.js";
import {
  buildCombatCreateHandler,
  buildCombatAddCombatantHandler,
  buildCombatStartHandler,
  buildCombatNextHandler,
} from "../combat-handlers.js";
import type { CombatHandlerDeps } from "../combat-handlers.js";
import { buildChatSendHandler } from "../../chat/chat-handler.js";
import type { ChatHandlerDeps } from "../../chat/chat-handler.js";
import { resolveTargetSelection, assertTargetsSelected } from "../target-selection.js";
import type { HandlerContext } from "../../net/handler-registry.js";
import type { Ack, ChatMessage, CombatDocument } from "@fusion/shared";

const WORLD_ID = "target-selection-world";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-target-selection-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Minimal fake Namespace — only `emit`/`sockets` are ever touched by the handlers exercised here. */
function fakeNs(): Namespace {
  return { emit: () => {}, sockets: new Map() } as unknown as Namespace;
}

interface Harness {
  dataDir: string;
  fusionDb: FusionDatabase;
  store: DocumentStore;
  targetingStore: TargetingStore;
  eventBus: CombatEventBus;
  chatHandler: ReturnType<typeof buildChatSendHandler>;
  targetDeps: TargetHandlerDeps;
  combatDeps: CombatHandlerDeps;
}

function buildHarness(): Harness {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const seqStore = new SeqStore(fusionDb.raw);
  const ns = fakeNs();
  const targetingStore = new TargetingStore();
  const eventBus = new CombatEventBus();
  const rollService = new RollService({ db: fusionDb.raw });
  const formulaRegistry = new InitiativeFormulaRegistry(rollService, WORLD_ID);

  const targetDeps: TargetHandlerDeps = { store, seqStore, ns, targetingStore };

  const combatDeps: CombatHandlerDeps = {
    store,
    seqStore,
    opBuffer: new OpBuffer(),
    ns,
    formulaRegistry,
    eventBus,
    db: fusionDb.raw,
    worldId: WORLD_ID,
  };

  const chatDeps: ChatHandlerDeps = {
    db: fusionDb.raw,
    ns,
    seqStore,
    worldId: WORLD_ID,
    store,
    targetingStore,
  };
  const chatHandler = buildChatSendHandler(chatDeps);

  return {
    dataDir,
    fusionDb,
    store,
    targetingStore,
    eventBus,
    chatHandler,
    targetDeps,
    combatDeps,
  };
}

function teardown(h: Harness): void {
  h.fusionDb.close();
  rmSync(h.dataDir, { recursive: true, force: true });
}

const GM_CTX: HandlerContext = { userId: "gm-user", role: UserRole.GAMEMASTER, worldId: WORLD_ID };
function playerCtx(userId: string): HandlerContext {
  return { userId, role: UserRole.PLAYER, worldId: WORLD_ID };
}

/** Create a scene embedding the given tokens (loosely-typed records — matches DocumentStore's scene schema), return its id. */
function createSceneWithTokens(
  h: Harness,
  tokens: Array<{ _id: string; name: string; actorId: string }>,
): string {
  const scene = h.store.create("scenes", { name: "Unit Scene", tokens }, { userId: GM_CTX.userId });
  return scene["_id"] as string;
}

/** Create an actor, optionally owned (OWNER level) by `ownerId`. Returns its id. */
function createActor(h: Harness, name: string, ownerId?: string): string {
  const ownership: Record<string, number> = { default: 0 };
  if (ownerId) ownership[ownerId] = 3; // OWNER
  const actor = h.store.create(
    "actors",
    { name, type: "character", ownership },
    { userId: GM_CTX.userId },
  );
  return actor["_id"] as string;
}

function readPersistedMessage(h: Harness, messageId: string): ChatMessage {
  const row = h.fusionDb.raw
    .prepare(`SELECT data FROM chat_messages WHERE id = ?`)
    .get(messageId) as { data: string } | undefined;
  if (!row) throw new Error(`message not persisted: ${messageId}`);
  return JSON.parse(row.data) as ChatMessage;
}

function readTargetSnapshot(msg: ChatMessage): unknown {
  const fusion = (msg.flags as Record<string, Record<string, unknown>> | undefined)?.["fusion"];
  return fusion?.["targetSnapshot"];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TargetSelection (ALQ-F1-05, REQ-CBT-056)", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    teardown(h);
  });

  it("records targetSnapshot [T1, T2] on the roll message when the author has live targets", async () => {
    const enemy1 = createActor(h, "Enemy 1");
    const enemy2 = createActor(h, "Enemy 2");
    const sceneId = createSceneWithTokens(h, [
      { _id: "tok-t1", name: "T1", actorId: enemy1 },
      { _id: "tok-t2", name: "T2", actorId: enemy2 },
    ]);

    const target = buildCombatTargetHandler(h.targetDeps);
    await target({ tokenId: "tok-t1", targeted: true }, playerCtx("player-p"));
    await target({ tokenId: "tok-t2", targeted: true }, playerCtx("player-p"));

    const ack = h.chatHandler(
      { content: "/r 1d20", worldId: WORLD_ID, rollMode: "public" },
      playerCtx("player-p"),
    ) as Ack<{ message: ChatMessage }>;
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;

    expect(readTargetSnapshot(ack.result.message)).toEqual([
      { tokenId: "tok-t1", actorId: enemy1, sceneId },
      { tokenId: "tok-t2", actorId: enemy2, sceneId },
    ]);
  });

  it("records an empty targetSnapshot when the author has no live targets", () => {
    const ack = h.chatHandler(
      { content: "/r 1d20", worldId: WORLD_ID, rollMode: "public" },
      playerCtx("no-target-user"),
    ) as Ack<{ message: ChatMessage }>;
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(readTargetSnapshot(ack.result.message)).toEqual([]);
  });

  it("does not change the persisted snapshot when the author later un-marks a target", async () => {
    const enemy1 = createActor(h, "Enemy 1");
    const enemy2 = createActor(h, "Enemy 2");
    const sceneId = createSceneWithTokens(h, [
      { _id: "tok-t1", name: "T1", actorId: enemy1 },
      { _id: "tok-t2", name: "T2", actorId: enemy2 },
    ]);

    const target = buildCombatTargetHandler(h.targetDeps);
    await target({ tokenId: "tok-t1", targeted: true }, playerCtx("player-p"));
    await target({ tokenId: "tok-t2", targeted: true }, playerCtx("player-p"));

    const ack = h.chatHandler(
      { content: "/r 1d20", worldId: WORLD_ID, rollMode: "public" },
      playerCtx("player-p"),
    ) as Ack<{ message: ChatMessage }>;
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    const messageId = ack.result.message._id;

    // Un-mark T2 AFTER the roll was persisted.
    await target({ tokenId: "tok-t2", targeted: false }, playerCtx("player-p"));
    expect([...h.targetingStore.getTargetsForUser("player-p")]).toEqual(["tok-t1"]);

    // The message stored on disk must still carry the original photo.
    const persisted = readPersistedMessage(h, messageId);
    expect(readTargetSnapshot(persisted)).toEqual([
      { tokenId: "tok-t1", actorId: enemy1, sceneId },
      { tokenId: "tok-t2", actorId: enemy2, sceneId },
    ]);
  });

  it("empties the live selection on turnEnd (REQ-CBT-055) while the persisted snapshot stays [T1, T2]", async () => {
    registerTargetingCleanup(h.targetDeps, h.eventBus);

    const enemy1 = createActor(h, "Enemy 1");
    const enemy2 = createActor(h, "Enemy 2");
    const sceneId = createSceneWithTokens(h, [
      { _id: "tok-t1", name: "T1", actorId: enemy1 },
      { _id: "tok-t2", name: "T2", actorId: enemy2 },
    ]);
    const pcActor = createActor(h, "Targeter PC", "player-p");
    const otherActor = createActor(h, "Other");

    const target = buildCombatTargetHandler(h.targetDeps);
    await target({ tokenId: "tok-t1", targeted: true }, playerCtx("player-p"));
    await target({ tokenId: "tok-t2", targeted: true }, playerCtx("player-p"));

    const ack = h.chatHandler(
      { content: "/r 1d20", worldId: WORLD_ID, rollMode: "public" },
      playerCtx("player-p"),
    ) as Ack<{ message: ChatMessage }>;
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    const messageId = ack.result.message._id;

    // Combat: P's combatant (higher initiative, acts first) + another combatant.
    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const next = buildCombatNextHandler(h.combatDeps);

    const createAck = (await create({ sceneId }, GM_CTX)) as Ack<{ combat: CombatDocument }>;
    expect(createAck.ok).toBe(true);
    if (!createAck.ok) return;
    const combatId = createAck.result.combat._id;

    await add({ combatId, tokenId: "tok-pc", actorId: pcActor, initiative: 20 }, GM_CTX);
    await add({ combatId, tokenId: "tok-other", actorId: otherActor, initiative: 10 }, GM_CTX);
    await begin({ combatId }, GM_CTX); // turn 0 = P's combatant (initiative 20)

    await next({ combatId }, GM_CTX); // ends P's turn -> REQ-CBT-055 cleanup fires

    expect([...h.targetingStore.getTargetsForUser("player-p")]).toEqual([]);

    const persisted = readPersistedMessage(h, messageId);
    expect(readTargetSnapshot(persisted)).toEqual([
      { tokenId: "tok-t1", actorId: enemy1, sceneId },
      { tokenId: "tok-t2", actorId: enemy2, sceneId },
    ]);
  });

  it("resolveTargetSelection skips a tokenId that does not resolve to any real token", async () => {
    createSceneWithTokens(h, []); // no real tokens anywhere
    const target = buildCombatTargetHandler(h.targetDeps);
    await target({ tokenId: "ghost-token", targeted: true }, playerCtx("player-p"));

    expect(resolveTargetSelection(h.store, h.targetingStore, "player-p")).toEqual([]);
  });

  it("assertTargetsSelected: GM/privileged role always passes, regardless of selection", () => {
    const result = assertTargetsSelected(
      h.store,
      h.targetingStore,
      "gm-user",
      UserRole.GAMEMASTER,
      ["tok-t1"],
    );
    expect(result).toEqual({ ok: true });
  });

  it("assertTargetsSelected: a player passes when every requested id is in their live selection", async () => {
    const enemy1 = createActor(h, "Enemy 1");
    createSceneWithTokens(h, [{ _id: "tok-t1", name: "T1", actorId: enemy1 }]);
    const target = buildCombatTargetHandler(h.targetDeps);
    await target({ tokenId: "tok-t1", targeted: true }, playerCtx("player-p"));

    const result = assertTargetsSelected(h.store, h.targetingStore, "player-p", UserRole.PLAYER, [
      "tok-t1",
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("assertTargetsSelected: a player is FORBIDDEN with the missing ids when a requested token is not in their live selection", async () => {
    const enemy1 = createActor(h, "Enemy 1");
    createSceneWithTokens(h, [{ _id: "tok-t1", name: "T1", actorId: enemy1 }]);
    const target = buildCombatTargetHandler(h.targetDeps);
    await target({ tokenId: "tok-t1", targeted: true }, playerCtx("player-p"));

    const result = assertTargetsSelected(h.store, h.targetingStore, "player-p", UserRole.PLAYER, [
      "tok-t1",
      "tok-t2",
    ]);
    expect(result).toEqual({ ok: false, code: "FORBIDDEN", missing: ["tok-t2"] });
  });
});
