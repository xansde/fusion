/**
 * BHR-F3-04 / GUE-F1-04 — the server counts the multiple attack penalty (D-G03).
 *
 * Assertions follow the PF2e remaster rule, written here: the first attack of
 * a turn takes 0, the second -5 and the third and later -10; with an agile
 * weapon 0, -4, -8. The count restarts when the combatant's turn starts.
 *
 * Real chat:send + real combat handlers (same harness as target-selection).
 * The wiring through SocketManager has its own socket test in
 * `__tests__/map-counter-socket.test.ts` (port from helpers/ports.ts).
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
import {
  buildCombatCreateHandler,
  buildCombatAddCombatantHandler,
  buildCombatStartHandler,
  buildCombatNextHandler,
} from "../combat-handlers.js";
import type { CombatHandlerDeps } from "../combat-handlers.js";
import { buildChatSendHandler } from "../../chat/chat-handler.js";
import { MapCounter, registerMapCounterReset } from "../map-counter.js";
import type { HandlerContext } from "../../net/handler-registry.js";
import type { Ack, CombatDocument } from "@fusion/shared";

const WORLD_ID = "map-counter-world";
const GM_CTX: HandlerContext = { userId: "gm-user", role: UserRole.GAMEMASTER, worldId: WORLD_ID };
const PLAYER_CTX: HandlerContext = { userId: "player-p", role: UserRole.PLAYER, worldId: WORLD_ID };

function fakeNs(): Namespace {
  return { emit: () => {}, sockets: new Map() } as unknown as Namespace;
}

interface Harness {
  dataDir: string;
  fusionDb: FusionDatabase;
  counter: MapCounter;
  chat: ReturnType<typeof buildChatSendHandler>;
  next: ReturnType<typeof buildCombatNextHandler>;
  combatId: string;
  pc: string;
  other: string;
  store: DocumentStore;
  combatDeps: CombatHandlerDeps;
  /** Adds an NPC actor (no owner) to the world and returns its id. */
  makeActor: (name: string) => string;
}

/** A PC (initiative 20, owned by player-p) and an NPC (10) in a started combat; the foe token has AC 15. */
async function buildHarness(): Promise<Harness> {
  const dataDir = join(
    tmpdir(),
    `fusion-map-counter-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const seqStore = new SeqStore(fusionDb.raw);
  const ns = fakeNs();
  const eventBus = new CombatEventBus();
  const counter = new MapCounter();
  counter.setStore(store);
  registerMapCounterReset(counter, eventBus);
  const rollService = new RollService({ db: fusionDb.raw });

  const combatDeps: CombatHandlerDeps = {
    store,
    seqStore,
    opBuffer: new OpBuffer(),
    ns,
    formulaRegistry: new InitiativeFormulaRegistry(rollService, WORLD_ID),
    eventBus,
    db: fusionDb.raw,
    worldId: WORLD_ID,
  };
  const chat = buildChatSendHandler({
    db: fusionDb.raw,
    ns,
    seqStore,
    worldId: WORLD_ID,
    store,
    targetingStore: new TargetingStore(),
    mapCounter: counter,
  });

  const actor = (name: string, ownerId?: string): string => {
    const ownership: Record<string, number> = { default: 0 };
    if (ownerId) ownership[ownerId] = 3;
    const created = store.create(
      "actors",
      { name, type: "character", ownership, system: { derived: { ac: { total: 15 } } } },
      { userId: GM_CTX.userId },
    );
    return created["_id"] as string;
  };
  const pcActor = actor("PC", PLAYER_CTX.userId);
  const otherActor = actor("Other");
  const foeActor = actor("Foe");
  const scene = store.create(
    "scenes",
    {
      name: "Scene",
      active: true,
      tokens: [{ _id: "tok-foe", name: "Foe", actorId: foeActor, hidden: false }],
    },
    { userId: GM_CTX.userId },
  );

  const created = (await buildCombatCreateHandler(combatDeps)(
    { sceneId: scene["_id"] },
    GM_CTX,
  )) as Ack<{ combat: CombatDocument }>;
  if (!created.ok) throw new Error("combat:create failed");
  const combatId = created.result.combat._id;
  const add = buildCombatAddCombatantHandler(combatDeps);
  await add({ combatId, tokenId: "tok-pc", actorId: pcActor, initiative: 20 }, GM_CTX);
  await add({ combatId, tokenId: "tok-other", actorId: otherActor, initiative: 10 }, GM_CTX);
  await buildCombatStartHandler(combatDeps)({ combatId }, GM_CTX);

  const doc = store.get("combats", combatId) as unknown as CombatDocument;
  const idOf = (tokenId: string): string => {
    const c = doc.combatants.find((x) => x.tokenId === tokenId);
    if (!c) throw new Error(`combatant ${tokenId} missing`);
    return c._id;
  };
  return {
    dataDir,
    fusionDb,
    counter,
    chat,
    next: buildCombatNextHandler(combatDeps),
    combatId,
    pc: idOf("tok-pc"),
    other: idOf("tok-other"),
    store,
    combatDeps,
    makeActor: (name) => actor(name),
  };
}

/** One graded attack by `speakerTokenId` against the foe token. */
function attack(h: Harness, speakerTokenId: string, ctx: HandlerContext = GM_CTX): void {
  const ack = h.chat(
    {
      content: "/r 1d20+5",
      worldId: WORLD_ID,
      rollMode: "public",
      speakerTokenId,
      target: { tokenId: "tok-foe" },
    },
    ctx,
  ) as Ack<unknown>;
  expect(ack.ok).toBe(true);
}

describe("MapCounter (BHR-F3-04)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  afterEach(() => {
    h.fusionDb.close();
    rmSync(h.dataDir, { recursive: true, force: true });
  });

  it("three attacks in the turn: counts 0/1/2 and penalties 0, -5, -10", () => {
    const seen: number[] = [];
    const penalties: number[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(h.counter.getAttackCount(h.combatId, h.pc));
      penalties.push(h.counter.getMapPenalty(h.combatId, h.pc, false));
      attack(h, "tok-pc");
    }
    expect(seen).toEqual([0, 1, 2]);
    expect(penalties).toEqual([0, -5, -10]);
    expect(h.counter.getAttackCount(h.combatId, h.pc)).toBe(3);
  });

  it("agile weapon: 0, -4, -8", () => {
    const penalties: number[] = [];
    for (let i = 0; i < 3; i++) {
      penalties.push(h.counter.getMapPenalty(h.combatId, h.pc, true));
      attack(h, "tok-pc");
    }
    expect(penalties).toEqual([0, -4, -8]);
  });

  it("a player owner counts his own attack", () => {
    attack(h, "tok-pc", PLAYER_CTX);
    expect(h.counter.getAttackCount(h.combatId, h.pc)).toBe(1);
  });

  it("turnStart zeroes the combatant that starts its turn", async () => {
    attack(h, "tok-pc");
    attack(h, "tok-pc");
    await h.next({ combatId: h.combatId }, GM_CTX);
    expect(h.counter.getAttackCount(h.combatId, h.pc)).toBe(2);
    await h.next({ combatId: h.combatId }, GM_CTX);
    expect(h.counter.getAttackCount(h.combatId, h.pc)).toBe(0);
  });

  it("an attack outside the count does not increment", () => {
    attack(h, "tok-pc");
    expect(h.counter.noteAttack(h.combatId, h.pc, { countsForMap: false })).toBe(1);
    expect(h.counter.getAttackCount(h.combatId, h.pc)).toBe(1);
  });

  it("an attack by someone who is not the active combatant changes no count", () => {
    attack(h, "tok-other");
    expect(h.counter.getAttackCount(h.combatId, h.other)).toBe(0);
    expect(h.counter.getAttackCount(h.combatId, h.pc)).toBe(0);
  });

  it("a player cannot count an attack for an actor he does not own", async () => {
    await h.next({ combatId: h.combatId }, GM_CTX);
    attack(h, "tok-other", PLAYER_CTX);
    expect(h.counter.getAttackCount(h.combatId, h.other)).toBe(0);
  });

  it("a roll without a graded target is not an attack", () => {
    const ack = h.chat(
      { content: "/r 1d20+5", worldId: WORLD_ID, rollMode: "public", speakerTokenId: "tok-pc" },
      GM_CTX,
    ) as Ack<unknown>;
    expect(ack.ok).toBe(true);
    expect(h.counter.getAttackCount(h.combatId, h.pc)).toBe(0);
  });

  it("mapGroupOf is the identity without a mount and one shared key for a mounted pair (BHR-F5-05)", () => {
    expect(h.counter.mapGroupOf("x")).toBe("x");
    // Mount link on the scene tokens (flags.fusion.mount, BHR-F5-02): the hero rides the other's token.
    const scene = h.store.getAll("scenes")[0] as Record<string, unknown>;
    const tokens = [
      {
        _id: "tok-pc",
        actorId: "pcActorAAAAAAAA1",
        flags: { fusion: { mount: { mountTokenId: "tok-other" } } },
      },
      {
        _id: "tok-other",
        actorId: "otherActorAAAAA1",
        flags: { fusion: { mount: { riderTokenId: "tok-pc" } } },
      },
    ];
    // Raw row write: the scene schema is not under test here, only the link the counter reads.
    h.fusionDb.raw
      .prepare("UPDATE scenes SET data = ? WHERE id = ?")
      .run(JSON.stringify({ ...scene, tokens }), String(scene["_id"]));
    expect(h.counter.mapGroupOf(h.pc, h.combatId)).toBe(h.counter.mapGroupOf(h.other, h.combatId));
    h.counter.noteAttack(h.combatId, h.pc);
    expect(h.counter.getAttackCount(h.combatId, h.other)).toBe(1);
  });

  it("I5: dois combatentes do mesmo ator sem token — conta o ATIVO; se o ativo é outro, não conta nem atribui", async () => {
    const goblin = h.makeActor("Goblin");
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    await add({ combatId: h.combatId, tokenId: "tok-g1", actorId: goblin, initiative: 5 }, GM_CTX);
    await add({ combatId: h.combatId, tokenId: "tok-g2", actorId: goblin, initiative: 4 }, GM_CTX);
    const doc = h.store.get("combats", h.combatId) as unknown as CombatDocument;
    const g1 = doc.combatants.find((c) => c.tokenId === "tok-g1")?._id ?? "";
    const g2 = doc.combatants.find((c) => c.tokenId === "tok-g2")?._id ?? "";
    const speaker = { userId: GM_CTX.userId, role: GM_CTX.role, actorId: goblin };

    // Turn order: pc, other, g1, g2. Walk to g2's turn.
    for (let i = 0; i < 3; i++) await h.next({ combatId: h.combatId }, GM_CTX);
    expect(h.counter.noteAttackFromSpeaker(h.store, speaker, {})).toBe(1);
    expect(h.counter.getAttackCount(h.combatId, g2)).toBe(1);
    expect(h.counter.getAttackCount(h.combatId, g1)).toBe(0);

    // The PC's turn again: an ambiguous goblin attack counts for nobody.
    await h.next({ combatId: h.combatId }, GM_CTX);
    expect(h.counter.noteAttackFromSpeaker(h.store, speaker, {})).toBeNull();
    expect(h.counter.getAttackCount(h.combatId, g1)).toBe(0);
    expect(h.counter.getAttackCount(h.combatId, g2)).toBe(1);
  });
});
