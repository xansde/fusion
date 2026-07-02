/**
 * M2-C combat unit tests — exercise the combat handlers directly against a real
 * DocumentStore + SQLite DB and a mock socket.io Namespace, bypassing the socket
 * transport for speed and determinism.
 *
 * Spec: 10-combate-e-iniciativa.md
 *
 * Coverage (complements the socket-level integration suite in
 * src/__tests__/combat-m2c.test.ts):
 *   - Lifecycle event order + payloads, with a FAKE system stub registered on
 *     the EventBus (REQ-CBT-026..029, DEC-CBT-05)
 *   - turnStart/turnEnd hooks receive the correct combatant/combat
 *   - skipDefeated skips defeated combatants on nextTurn (REQ-CBT-023)
 *   - rollInitiative with an INJECTED deterministic RNG (DEC-CBT-03)
 *   - tiebreaker + custom compare ordering via a registered formula (REQ-CBT-013)
 *   - one-active-combat-per-scene (DEC-CBT-06)
 *   - hidden combatant never leaks to a non-GM broadcast (REQ-CBT-031)
 *   - targeting: combat:target broadcasts token:targeted; cleared on the
 *     targeter's turnEnd (REQ-CBT-053..055)
 *   - forged userId / privilege: a player cannot advance turns or roll another's
 *     initiative
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase, applyMigrations } from "../../db/index.js";
import type { FusionDatabase } from "../../db/index.js";
import { DocumentStore } from "../../documents/store.js";
import { SeqStore } from "../../net/seq-store.js";
import { OpBuffer } from "../../net/op-buffer.js";
import { UserRole } from "../../documents/ownership.js";
import { RollService } from "../../chat/roll-service.js";
import { InitiativeFormulaRegistry } from "../initiative-registry.js";
import { registerSystemFormulas } from "../system-formula-adapter.js";
import { CombatEventBus } from "../combat-event-bus.js";
import { TargetingStore } from "../targeting-store.js";
import {
  buildCombatTargetHandler,
  registerTargetingCleanup,
  type TargetHandlerDeps,
} from "../target-handler.js";
import {
  buildCombatCreateHandler,
  buildCombatStartHandler,
  buildCombatAddCombatantHandler,
  buildCombatRollInitiativeHandler,
  buildCombatNextHandler,
  buildCombatToggleDefeatedHandler,
  type CombatHandlerDeps,
} from "../combat-handlers.js";
import { createDocumentId } from "@fusion/shared";
import type {
  Ack,
  Envelope,
  CombatDocument,
  CombatantDocument,
  CombatLifecycleEvent,
  InitiativeFormula,
} from "@fusion/shared";
import type { HandlerContext } from "../../net/handler-registry.js";
import { pf2eSystem } from "@fusion/system-pf2e";
import { sf2eSystem } from "@fusion/system-sf2e";
import { defineSystem } from "@fusion/system-api";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-combat-unit-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A minimal fake socket carrying role data, for per-socket broadcast paths. */
interface FakeSocket {
  data: { role: number };
  emit(event: string, payload: unknown): void;
}

/** Mock Namespace capturing all emitted envelopes + per-socket emits. */
class MockNamespace {
  readonly broadcasts: Array<{ event: string; envelope: Envelope }> = [];
  readonly perSocket: Array<{ role: number; envelope: Envelope }> = [];
  readonly sockets = new Map<string, FakeSocket>();

  emit(event: string, envelope: Envelope): void {
    this.broadcasts.push({ event, envelope });
  }

  addSocket(id: string, role: number): void {
    this.sockets.set(id, {
      data: { role },
      emit: (_event: string, envelope: unknown): void => {
        this.perSocket.push({ role, envelope: envelope as Envelope });
      },
    });
  }

  /** Envelopes of a given type seen by player (non-GM) sockets. */
  playerEnvelopes(type: string): Envelope[] {
    return this.perSocket
      .filter((p) => p.role < UserRole.ASSISTANT_GM && p.envelope.type === type)
      .map((p) => p.envelope);
  }
}

interface Harness {
  dataDir: string;
  fusionDb: FusionDatabase;
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: MockNamespace;
  eventBus: CombatEventBus;
  formulaRegistry: InitiativeFormulaRegistry;
  combatDeps: CombatHandlerDeps;
  targetDeps: TargetHandlerDeps;
  targetingStore: TargetingStore;
}

/**
 * Build a harness. `rng` is forwarded to the RollService for deterministic
 * initiative rolls (returns a constant raw uint32 — the dice library maps it
 * into the die range, so a fixed value yields a fixed result).
 *
 * `systemId` wires the InitiativeFormulaRegistry with a fallback key (see
 * InitiativeFormulaRegistry.getFormulaForCombatType) matching production
 * wiring in socket-manager.ts. When omitted, only generic-1d20 is resolvable.
 */
function buildHarness(rng?: { next(): number }, systemId?: string): Harness {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const seqStore = new SeqStore(fusionDb.raw);
  const opBuffer = new OpBuffer();
  const ns = new MockNamespace();
  const eventBus = new CombatEventBus();
  const rollService = new RollService(rng ? { db: fusionDb.raw, rng } : { db: fusionDb.raw });
  const formulaRegistry = new InitiativeFormulaRegistry(rollService, "unit-world", systemId);
  const targetingStore = new TargetingStore();

  const combatDeps: CombatHandlerDeps = {
    store,
    seqStore,
    opBuffer,
    ns: ns as unknown as CombatHandlerDeps["ns"],
    formulaRegistry,
    eventBus,
    db: fusionDb.raw,
    worldId: "unit-world",
  };

  const targetDeps: TargetHandlerDeps = {
    store,
    seqStore,
    ns: ns as unknown as TargetHandlerDeps["ns"],
    targetingStore,
  };

  return {
    dataDir,
    fusionDb,
    store,
    seqStore,
    opBuffer,
    ns,
    eventBus,
    formulaRegistry,
    combatDeps,
    targetDeps,
    targetingStore,
  };
}

function teardown(h: Harness): void {
  h.fusionDb.close();
  rmSync(h.dataDir, { recursive: true, force: true });
}

const GM_CTX: HandlerContext = {
  userId: "gm-user",
  role: UserRole.GAMEMASTER,
  worldId: "unit-world",
};
function playerCtx(userId: string): HandlerContext {
  return { userId, role: UserRole.PLAYER, worldId: "unit-world" };
}

/** Create a scene directly in the store, return its id. */
function createScene(h: Harness): string {
  const scene = h.store.create(
    "scenes",
    { name: "Unit Scene", width: 1000, height: 1000 },
    { userId: GM_CTX.userId },
  );
  return scene["_id"] as string;
}

/** Create an actor owned by `ownerId` (OWNER level), return its id. */
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

async function run(
  fn: ReturnType<typeof buildCombatCreateHandler>,
  payload: unknown,
  ctx: HandlerContext,
): Promise<Ack<Record<string, unknown>>> {
  return (await fn(payload, ctx)) as Ack<Record<string, unknown>>;
}

function combatFromAck(ack: Ack<Record<string, unknown>>): CombatDocument {
  expect(ack.ok).toBe(true);
  if (!ack.ok) throw new Error("ack not ok");
  return ack.result["combat"] as unknown as CombatDocument;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("M2-C combat unit (direct handlers)", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    teardown(h);
  });

  // -------------------------------------------------------------------------
  // DEC-CBT-06: one active combat per scene
  // -------------------------------------------------------------------------

  it("rejects a second active combat for the same scene (DEC-CBT-06)", async () => {
    const sceneId = createScene(h);
    const create = buildCombatCreateHandler(h.combatDeps);

    const first = await run(create, { sceneId }, GM_CTX);
    expect(first.ok).toBe(true);

    const second = await run(create, { sceneId }, GM_CTX);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("VALIDATION_FAILED");
  });

  // -------------------------------------------------------------------------
  // Lifecycle events with a FAKE system stub on the EventBus
  // -------------------------------------------------------------------------

  it("emits combatStart then turnStart for the first combatant on begin", async () => {
    const sceneId = createScene(h);
    const actorId = createActor(h, "Hero");

    const events: CombatLifecycleEvent[] = [];
    h.eventBus.onLifecycle("combatStart", (e) => events.push(e));
    h.eventBus.onLifecycle("turnStart", (e) => events.push(e));

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    const combatId = combat._id;
    const addAck = await run(add, { combatId, tokenId: "tok-1", actorId, initiative: 10 }, GM_CTX);
    const combatantId = (
      (addAck.result as Record<string, unknown>)["combatant"] as CombatantDocument
    )._id;

    await run(begin, { combatId }, GM_CTX);

    expect(events.map((e) => e.type)).toEqual(["combatStart", "turnStart"]);
    const turnStart = events[1]!;
    if (turnStart.type !== "turnStart") throw new Error("expected turnStart");
    expect(turnStart.combatant._id).toBe(combatantId);
    expect(turnStart.combat.round).toBe(1);
    expect(turnStart.combat.turnIndex).toBe(0);
  });

  it("emits turnEnd → roundEnd → roundStart → turnStart across a round boundary, with correct combatants", async () => {
    const sceneId = createScene(h);
    const a1 = createActor(h, "A");
    const a2 = createActor(h, "B");

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const next = buildCombatNextHandler(h.combatDeps);

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    const combatId = combat._id;
    const add1 = await run(add, { combatId, tokenId: "t1", actorId: a1, initiative: 20 }, GM_CTX);
    const id1 = ((add1.result as Record<string, unknown>)["combatant"] as CombatantDocument)._id;
    const add2 = await run(add, { combatId, tokenId: "t2", actorId: a2, initiative: 10 }, GM_CTX);
    const id2 = ((add2.result as Record<string, unknown>)["combatant"] as CombatantDocument)._id;

    await run(begin, { combatId }, GM_CTX); // round 1, turn 0 (id1 active)

    // Record events from here on
    const order: string[] = [];
    const turnEndIds: string[] = [];
    const turnStartIds: string[] = [];
    h.eventBus.onLifecycle("turnEnd", (e) => {
      order.push("turnEnd");
      if (e.type === "turnEnd") turnEndIds.push(e.combatant._id);
    });
    h.eventBus.onLifecycle("roundEnd", () => order.push("roundEnd"));
    h.eventBus.onLifecycle("roundStart", () => order.push("roundStart"));
    h.eventBus.onLifecycle("turnStart", (e) => {
      order.push("turnStart");
      if (e.type === "turnStart") turnStartIds.push(e.combatant._id);
    });

    // next → turn 1 (id2 active), same round → only turnEnd(id1), turnStart(id2)
    await run(next, { combatId }, GM_CTX);
    expect(order).toEqual(["turnEnd", "turnStart"]);
    expect(turnEndIds).toEqual([id1]);
    expect(turnStartIds).toEqual([id2]);

    // next again → wraps to round 2, turn 0 (id1) → turnEnd(id2), roundEnd, roundStart, turnStart(id1)
    order.length = 0;
    turnEndIds.length = 0;
    turnStartIds.length = 0;
    await run(next, { combatId }, GM_CTX);
    expect(order).toEqual(["turnEnd", "roundEnd", "roundStart", "turnStart"]);
    expect(turnEndIds).toEqual([id2]);
    expect(turnStartIds).toEqual([id1]);
  });

  // -------------------------------------------------------------------------
  // skipDefeated
  // -------------------------------------------------------------------------

  it("skips defeated combatants on nextTurn when skipDefeated=true (REQ-CBT-023)", async () => {
    const sceneId = createScene(h);
    const a1 = createActor(h, "A");
    const a2 = createActor(h, "B");
    const a3 = createActor(h, "C");

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const next = buildCombatNextHandler(h.combatDeps);
    const setDefeated = buildCombatToggleDefeatedHandler(h.combatDeps);

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    const combatId = combat._id;
    const add1 = await run(add, { combatId, tokenId: "t1", actorId: a1, initiative: 30 }, GM_CTX);
    const add2 = await run(add, { combatId, tokenId: "t2", actorId: a2, initiative: 20 }, GM_CTX);
    const add3 = await run(add, { combatId, tokenId: "t3", actorId: a3, initiative: 10 }, GM_CTX);
    const id2 = ((add2.result as Record<string, unknown>)["combatant"] as CombatantDocument)._id;
    void add1;
    void add3;

    // Mark the middle combatant (index 1) defeated
    await run(setDefeated, { combatId, combatantId: id2, defeated: true }, GM_CTX);

    await run(begin, { combatId }, GM_CTX); // turn 0 (index 0)
    const afterNext = combatFromAck(await run(next, { combatId }, GM_CTX));

    // index 1 is defeated → nextTurn must skip to index 2
    expect(afterNext.turnIndex).toBe(2);
    expect(afterNext.round).toBe(1);
  });

  // -------------------------------------------------------------------------
  // rollInitiative determinism with an injected RNG
  // -------------------------------------------------------------------------

  it("rolls initiative deterministically with an injected RNG and sorts descending", async () => {
    // Fixed RNG → every d20 yields the same face. We only assert determinism
    // and ordering, not the absolute value (library maps uint32 → die range).
    const fixedRng = { next: () => 0x40000000 };
    const hd = buildHarness(fixedRng);
    try {
      const sceneId = createScene(hd);
      const a1 = createActor(hd, "A");
      const a2 = createActor(hd, "B");

      const create = buildCombatCreateHandler(hd.combatDeps);
      const add = buildCombatAddCombatantHandler(hd.combatDeps);
      const roll = buildCombatRollInitiativeHandler(hd.combatDeps);

      const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
      const combatId = combat._id;
      await run(add, { combatId, tokenId: "t1", actorId: a1 }, GM_CTX);
      await run(add, { combatId, tokenId: "t2", actorId: a2 }, GM_CTX);

      const rolled = combatFromAck(await run(roll, { combatId }, GM_CTX));
      expect(rolled.combatants.length).toBe(2);
      for (const c of rolled.combatants) {
        expect(typeof c.initiative).toBe("number");
      }
      // Descending order invariant
      const inits = rolled.combatants.map((c) => c.initiative as number);
      for (let i = 0; i < inits.length - 1; i++) {
        expect(inits[i]!).toBeGreaterThanOrEqual(inits[i + 1]!);
      }
    } finally {
      teardown(hd);
    }
  });

  // -------------------------------------------------------------------------
  // System-formula wiring regression (REQ-CBT-012): the system's registered
  // InitiativeFormulaFn (pf2e/sf2e) must actually be used by
  // combat:rollInitiative — NOT the generic-1d20 fallback. Detected by
  // asserting initiativeStatistic === "Perception" (generic-1d20 never sets
  // a statistic) and, with a deterministic RNG, that total = d20 face + mod.
  // -------------------------------------------------------------------------

  it("wires the pf2e initiative formula into rollInitiative (statistic + total = d20 + perception mod)", async () => {
    // Fixed RNG → d20 face is always 5 (verified against the dice-roller lib).
    const fixedRng = { next: () => 0x40000000 };
    const hd = buildHarness(fixedRng, "pf2e");
    registerSystemFormulas(
      hd.formulaRegistry,
      pf2eSystem.manifest.id,
      pf2eSystem.combat.initiativeFormulas,
      new RollService({ db: hd.fusionDb.raw, rng: fixedRng }),
      "unit-world",
    );
    try {
      const sceneId = createScene(hd);
      const perceptionMod = 7;
      const actor = hd.store.create(
        "actors",
        {
          name: "Perceptive Hero",
          type: "character",
          ownership: { default: 0 },
          system: { derived: { perception: { total: perceptionMod } } },
        },
        { userId: GM_CTX.userId },
      );
      const actorId = actor["_id"] as string;

      const create = buildCombatCreateHandler(hd.combatDeps);
      const add = buildCombatAddCombatantHandler(hd.combatDeps);
      const roll = buildCombatRollInitiativeHandler(hd.combatDeps);

      // combatType defaults to "standard"; formula must resolve via the
      // systemId fallback (InitiativeFormulaRegistry.getFormulaForCombatType).
      const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
      const combatId = combat._id;
      await run(add, { combatId, tokenId: "t1", actorId }, GM_CTX);

      const rolled = combatFromAck(await run(roll, { combatId }, GM_CTX));
      const combatant = rolled.combatants[0]!;
      expect(combatant.initiativeStatistic).toBe("Perception");
      expect(combatant.initiative).toBe(5 + perceptionMod);
    } finally {
      teardown(hd);
    }
  });

  it("wires the sf2e initiative formula into rollInitiative (statistic + total = d20 + perception mod)", async () => {
    const fixedRng = { next: () => 0x40000000 };
    const hd = buildHarness(fixedRng, "sf2e");
    registerSystemFormulas(
      hd.formulaRegistry,
      sf2eSystem.manifest.id,
      sf2eSystem.combat.initiativeFormulas,
      new RollService({ db: hd.fusionDb.raw, rng: fixedRng }),
      "unit-world",
    );
    try {
      const sceneId = createScene(hd);
      const perceptionMod = 3;
      const actor = hd.store.create(
        "actors",
        {
          name: "Perceptive Envoy",
          type: "character",
          ownership: { default: 0 },
          system: { derived: { perception: { total: perceptionMod } } },
        },
        { userId: GM_CTX.userId },
      );
      const actorId = actor["_id"] as string;

      const create = buildCombatCreateHandler(hd.combatDeps);
      const add = buildCombatAddCombatantHandler(hd.combatDeps);
      const roll = buildCombatRollInitiativeHandler(hd.combatDeps);

      const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
      const combatId = combat._id;
      await run(add, { combatId, tokenId: "t1", actorId }, GM_CTX);

      const rolled = combatFromAck(await run(roll, { combatId }, GM_CTX));
      const combatant = rolled.combatants[0]!;
      expect(combatant.initiativeStatistic).toBe("Perception");
      expect(combatant.initiative).toBe(5 + perceptionMod);
    } finally {
      teardown(hd);
    }
  });

  it("falls back to generic-1d20 (no statistic) when no system formula is registered for the combatType", async () => {
    const fixedRng = { next: () => 0x40000000 };
    // No systemId passed → registry only has generic-1d20.
    const hd = buildHarness(fixedRng);
    try {
      const sceneId = createScene(hd);
      const actorId = createActor(hd, "Nobody Special");

      const create = buildCombatCreateHandler(hd.combatDeps);
      const add = buildCombatAddCombatantHandler(hd.combatDeps);
      const roll = buildCombatRollInitiativeHandler(hd.combatDeps);

      const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
      const combatId = combat._id;
      await run(add, { combatId, tokenId: "t1", actorId }, GM_CTX);

      const rolled = combatFromAck(await run(roll, { combatId }, GM_CTX));
      const combatant = rolled.combatants[0]!;
      expect(combatant.initiativeStatistic).toBeNull();
      expect(combatant.initiative).toBe(5); // plain 1d20, no modifier
    } finally {
      teardown(hd);
    }
  });

  // -------------------------------------------------------------------------
  // Custom compare() ordering via a registered formula (REQ-CBT-013)
  // -------------------------------------------------------------------------

  it("applies a system-registered compare() that puts player-owned combatants first regardless of total", async () => {
    const sceneId = createScene(h);
    const playerUser = "pc-owner";
    const npcActor = createActor(h, "Big NPC"); // no player owner
    const pcActor = createActor(h, "Small PC", playerUser); // player-owned

    // Register an Etmos-style "players beat NPCs" comparator on combatType.
    const proPlayerFormula: InitiativeFormula = {
      id: "pro-player",
      label: "Pro Player",
      roll: () => ({ total: 1 }),
      compare: (x, y) => {
        const xPlayer = x.combatant.hasPlayerOwner ? 1 : 0;
        const yPlayer = y.combatant.hasPlayerOwner ? 1 : 0;
        if (xPlayer !== yPlayer) return yPlayer - xPlayer; // players first
        return y.total - x.total;
      },
    };
    h.formulaRegistry.registerFormula(proPlayerFormula);

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);

    // getFormulaForCombatType now resolves for real (no monkey-patch): the
    // combat is created with combatType "pro-player" so it picks up the
    // formula registered above directly by its exact combatType key.
    const combat = combatFromAck(await run(create, { sceneId, combatType: "pro-player" }, GM_CTX));
    const combatId = combat._id;
    // NPC has a HIGHER initiative but must still sort AFTER the player.
    const addNpc = await run(
      add,
      { combatId, tokenId: "t-npc", actorId: npcActor, initiative: 100 },
      GM_CTX,
    );
    const npcId = ((addNpc.result as Record<string, unknown>)["combatant"] as CombatantDocument)
      ._id;
    const addPc = await run(
      add,
      { combatId, tokenId: "t-pc", actorId: pcActor, initiative: 1 },
      GM_CTX,
    );
    const pcId = ((addPc.result as Record<string, unknown>)["combatant"] as CombatantDocument)._id;

    const finalCombat = combatFromAck(addPc as Ack<Record<string, unknown>>);
    expect(finalCombat.combatants[0]!._id).toBe(pcId); // player first
    expect(finalCombat.combatants[1]!._id).toBe(npcId);
  });

  // -------------------------------------------------------------------------
  // M5-A E3: compare() registered via the system-API's
  // registerInitiativeFormula(combatType, { roll, compare }) object form,
  // propagated end-to-end through registerSystemFormulas/
  // adaptSystemInitiativeFormula (the REAL production wiring path), not by
  // hand-registering an already-built InitiativeFormula directly (that path
  // is covered by the "player-owned combatants" test above).
  // -------------------------------------------------------------------------

  it("propagates a system-registered { roll, compare } (M5-A E3, defineSystem → registerSystemFormulas) end-to-end", async () => {
    const sceneId = createScene(h);
    const playerUser = "etmos-pc-owner";
    const npcActor = createActor(h, "Big NPC"); // no player owner
    const pcActor = createActor(h, "Small PC", playerUser); // player-owned

    // A minimal Etmos-shaped fake system, registered via the real
    // registrar surface (defineSystem → registrar.registerInitiativeFormula
    // with the { roll, compare } object form — E3).
    const etmosLikeSystem = defineSystem(
      {
        id: "etmos-like-test",
        title: "Etmos-like Test System",
        version: "0.1.0",
        engineCompat: ">=0.1.0 <2.0.0",
        authors: [{ name: "Test" }],
        documentTypes: { Actor: ["orador"] },
        languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
      },
      (r) => {
        r.defineModel({ documentType: "Actor", subtype: "orador", schema: z.object({}) });
        r.registerInitiativeFormula("etmos-like", {
          roll: () => ({ formula: "1", statistic: "Corpo" }), // total = 1 for everyone
          compare: (x, y) => {
            const xPlayer = x.combatant.hasPlayerOwner ? 1 : 0;
            const yPlayer = y.combatant.hasPlayerOwner ? 1 : 0;
            if (xPlayer !== yPlayer) return yPlayer - xPlayer; // players first
            return (y.total ?? 0) - (x.total ?? 0);
          },
        });
      },
    );

    // Real production wiring path (mirrors socket-manager.ts): pass BOTH
    // initiativeFormulas AND initiativeCompares.
    registerSystemFormulas(
      h.formulaRegistry,
      etmosLikeSystem.manifest.id,
      etmosLikeSystem.combat.initiativeFormulas,
      new RollService({ db: h.fusionDb.raw }),
      "unit-world",
      etmosLikeSystem.combat.initiativeCompares,
    );

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const roll = buildCombatRollInitiativeHandler(h.combatDeps);

    const combat = combatFromAck(await run(create, { sceneId, combatType: "etmos-like" }, GM_CTX));
    const combatId = combat._id;
    const addNpc = await run(add, { combatId, tokenId: "t-npc", actorId: npcActor }, GM_CTX);
    const npcId = ((addNpc.result as Record<string, unknown>)["combatant"] as CombatantDocument)
      ._id;
    const addPc = await run(add, { combatId, tokenId: "t-pc", actorId: pcActor }, GM_CTX);
    const pcId = ((addPc.result as Record<string, unknown>)["combatant"] as CombatantDocument)._id;

    // Roll initiative for both — the registered `roll` always returns total=1
    // for every combatant, so a numeric-only sort would tie/preserve
    // insertion order; the registered `compare` must still put the
    // player-owned combatant first.
    const rolled = combatFromAck(await run(roll, { combatId }, GM_CTX));
    expect(rolled.combatants[0]!._id).toBe(pcId); // player first despite equal totals
    expect(rolled.combatants[1]!._id).toBe(npcId);
  });

  // -------------------------------------------------------------------------
  // SECURITY: privilege enforcement
  // -------------------------------------------------------------------------

  it("a player cannot advance turns (nextTurn is GM-only)", async () => {
    const sceneId = createScene(h);
    const create = buildCombatCreateHandler(h.combatDeps);
    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));

    const next = buildCombatNextHandler(h.combatDeps);
    const ack = await run(next, { combatId: combat._id }, playerCtx("intruder"));
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe("PERMISSION_DENIED");
  });

  it("a player cannot roll initiative for a combatant they do not own (REQ-CBT-034)", async () => {
    const sceneId = createScene(h);
    const otherPlayer = "other-player";
    const pcActor = createActor(h, "Other PC", otherPlayer);

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const roll = buildCombatRollInitiativeHandler(h.combatDeps);

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    const combatId = combat._id;
    const addAck = await run(add, { combatId, tokenId: "t1", actorId: pcActor }, GM_CTX);
    const combatantId = (
      (addAck.result as Record<string, unknown>)["combatant"] as CombatantDocument
    )._id;

    // A different player (not the owner) tries to roll for this combatant.
    const ack = await run(roll, { combatId, combatantIds: [combatantId] }, playerCtx("attacker"));
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe("PERMISSION_DENIED");
  });

  // -------------------------------------------------------------------------
  // Hidden combatant never reaches a non-GM broadcast (REQ-CBT-031)
  // -------------------------------------------------------------------------

  it("does not include a hidden combatant in the per-socket player broadcast", async () => {
    const sceneId = createScene(h);
    const pc = createActor(h, "PC");
    const npc = createActor(h, "Hidden NPC");

    // Register one GM socket and one player socket so the per-socket path runs.
    h.ns.addSocket("gm-sock", UserRole.GAMEMASTER);
    h.ns.addSocket("player-sock", UserRole.PLAYER);

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    const combatId = combat._id;
    await run(add, { combatId, tokenId: "t-pc", actorId: pc, hidden: false }, GM_CTX);
    await run(add, { combatId, tokenId: "t-npc", actorId: npc, hidden: true }, GM_CTX);

    // Inspect what player sockets received in combat:updated broadcasts.
    const playerUpdates = h.ns.playerEnvelopes("combat:updated");
    expect(playerUpdates.length).toBeGreaterThan(0);
    for (const env of playerUpdates) {
      const payload = env.payload as Record<string, unknown>;
      const diff = payload["diff"] as Record<string, unknown> | undefined;
      const combatants = diff?.["combatants"] as Record<string, unknown>[] | undefined;
      if (combatants) {
        expect(combatants.some((c) => c["hidden"] === true)).toBe(false);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Targeting (REQ-CBT-053..055)
  // -------------------------------------------------------------------------

  it("combat:target broadcasts token:targeted with the server-resolved userId, ignoring client userId", async () => {
    const target = buildCombatTargetHandler(h.targetDeps);

    // Client tries to forge a different userId — server must ignore it (the
    // schema is strict and has no userId field, so a forged field is rejected
    // by validation; we send a clean payload and assert the echoed userId).
    const ack = await target({ tokenId: "tok-xyz", targeted: true }, playerCtx("real-user"));
    expect(ack.ok).toBe(true);

    const broadcast = h.ns.broadcasts.find((b) => b.envelope.type === "token:targeted");
    expect(broadcast).toBeDefined();
    const payload = broadcast!.envelope.payload as Record<string, unknown>;
    expect(payload["tokenId"]).toBe("tok-xyz");
    expect(payload["targeted"]).toBe(true);
    expect(payload["userId"]).toBe("real-user");
  });

  it("clears a user's targets on the turnEnd of a combatant they own (REQ-CBT-055)", async () => {
    registerTargetingCleanup(h.targetDeps, h.eventBus);

    const sceneId = createScene(h);
    const ownerUser = "targeter";
    const pcActor = createActor(h, "Targeter PC", ownerUser);

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const next = buildCombatNextHandler(h.combatDeps);
    const target = buildCombatTargetHandler(h.targetDeps);

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    const combatId = combat._id;
    // Two combatants so nextTurn produces a turnEnd for the targeter's combatant.
    await run(add, { combatId, tokenId: "t-pc", actorId: pcActor, initiative: 20 }, GM_CTX);
    const a2 = createActor(h, "Other");
    await run(add, { combatId, tokenId: "t-2", actorId: a2, initiative: 10 }, GM_CTX);

    // The owning user targets a token.
    await target({ tokenId: "enemy-token", targeted: true }, playerCtx(ownerUser));
    expect([...h.targetingStore.getTargetsForUser(ownerUser)]).toEqual(["enemy-token"]);

    await run(begin, { combatId }, GM_CTX); // turn 0 = targeter's combatant active

    const broadcastsBefore = h.ns.broadcasts.length;

    // Advancing the turn ends the targeter's combatant's turn → clears targets.
    await run(next, { combatId }, GM_CTX);

    expect([...h.targetingStore.getTargetsForUser(ownerUser)]).toEqual([]);

    // A token:targeted(false) was broadcast for the cleared token.
    const cleared = h.ns.broadcasts
      .slice(broadcastsBefore)
      .find(
        (b) =>
          b.envelope.type === "token:targeted" &&
          (b.envelope.payload as Record<string, unknown>)["targeted"] === false,
      );
    expect(cleared).toBeDefined();
    expect((cleared!.envelope.payload as Record<string, unknown>)["tokenId"]).toBe("enemy-token");
  });

  it("targeting clear is scoped to one user (cross-user targets preserved, spec #6)", () => {
    const userA = "user-a";
    const userB = "user-b";
    h.targetingStore.setTarget(userA, "shared-token", true);
    h.targetingStore.setTarget(userB, "shared-token", true);

    const cleared = h.targetingStore.clearForUser(userA);
    expect(cleared).toEqual(["shared-token"]);
    // userB still targets it.
    expect([...h.targetingStore.getTargetsForUser(userB)]).toEqual(["shared-token"]);
    expect([...h.targetingStore.getTargetsForUser(userA)]).toEqual([]);
  });
});

// Silence unused import lint for createDocumentId (kept for potential fixtures).
void createDocumentId;
