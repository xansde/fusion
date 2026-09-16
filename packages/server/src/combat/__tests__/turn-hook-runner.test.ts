/**
 * TurnHookRunner — ALQ-F1-04.
 *
 * Spec: 10-combate-e-iniciativa.md DEC-CBT-09, REQ-CBT-057..060.
 * Spec: 15-api-de-sistemas.md REQ-SYS-138..141.
 * Plan: docs/design/alquimista/tasks.md §2.2 (TurnHooks).
 *
 * Coverage:
 *   - Unit level (no DB): a `SystemModule`'s registered hooks run in series,
 *     awaited; a throwing/rejecting callback is logged and does NOT stop the
 *     remaining callbacks (REQ-SYS-139); no systemModule / no hooks registered
 *     is a silent no-op.
 *   - Wired into combat-handlers.ts (real DocumentStore + SQLite, socket
 *     transport bypassed — same harness style as combat-unit.test.ts):
 *       * combat:beginCombat runs roundStart then turnStart, awaited
 *         (REQ-CBT-057).
 *       * combat:nextTurn runs turnEnd → turnStart in the same round, and
 *         turnEnd → roundEnd → roundStart → turnStart across a round
 *         boundary (REQ-CBT-057), with the correct combatant/actor per call
 *         (REQ-SYS-140).
 *       * the op's ack does not resolve until the last awaited hook settles
 *         (REQ-CBT-058).
 *       * combat:endCombat runs combatEnd with the DEDUPED actorIds of every
 *         combatant that has one, BEFORE the Combat document is persisted as
 *         ended (REQ-CBT-060) — a deliberate exception to the "after persist"
 *         timing that governs beginCombat/nextTurn.
 *       * combat:previousTurn does NOT run the new awaited hooks (spec 10
 *         open question 8: "proposta provisória: previousTurn não dispara
 *         hooks de sistema" — the task's own "Onde" list omits this handler).
 *   - `createStubTurnHookContextServices`: applyDamage/applyCondition resolve
 *     the documented NOT_SUPPORTED ack; every other service rejects with
 *     `TurnHookContextStubError` (ALQ-F1-08/F1-09 replace these).
 *
 * NOTE on "porta via helpers/ports.ts": this suite never boots a real
 * socket.io server (it calls the handler functions directly against a mock
 * Namespace, exactly like combat-unit.test.ts) — there is no port to
 * reserve. See that file's own header comment for why this bypass is the
 * established pattern for combat-handlers.ts unit coverage.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";

import { openDatabase, applyMigrations } from "../../db/index.js";
import type { FusionDatabase } from "../../db/index.js";
import { DocumentStore } from "../../documents/store.js";
import { SeqStore } from "../../net/seq-store.js";
import { OpBuffer } from "../../net/op-buffer.js";
import { UserRole } from "../../documents/ownership.js";
import { RollService } from "../../chat/roll-service.js";
import { InitiativeFormulaRegistry } from "../initiative-registry.js";
import { CombatEventBus } from "../combat-event-bus.js";
import {
  buildCombatCreateHandler,
  buildCombatStartHandler,
  buildCombatAddCombatantHandler,
  buildCombatNextHandler,
  buildCombatPreviousHandler,
  buildCombatEndHandler,
  type CombatHandlerDeps,
} from "../combat-handlers.js";
import {
  createTurnHookRunner,
  createStubTurnHookContextServices,
  TurnHookContextStubError,
  type TurnHookRunner,
} from "../turn-hook-runner.js";
import { defineSystem } from "@fusion/system-api";
import type { SystemModule } from "@fusion/system-api";
import type { Ack, CombatDocument, CombatantDocument } from "@fusion/shared";
import type { HandlerContext } from "../../net/handler-registry.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const VALID_MANIFEST = {
  id: "test-system",
  title: "Test System",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: {},
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

function makeCombat(overrides: Partial<CombatDocument> = {}): CombatDocument {
  return {
    _id: "CombatId12345678",
    sceneId: "SceneId12345678",
    round: 1,
    turnIndex: 0,
    activeCombatantId: null,
    started: true,
    ended: false,
    skipDefeated: true,
    autoPan: false,
    combatType: "standard",
    trackedResource: null,
    combatants: [],
    flags: {},
    sort: 0,
    ...overrides,
  };
}

function makeCombatant(overrides: Partial<CombatantDocument> = {}): CombatantDocument {
  return {
    _id: "AbcDef1234567890",
    tokenId: "TokenId12345678",
    actorId: "ActorId12345678",
    name: "Fighter",
    img: null,
    initiative: null,
    initiativeStatistic: null,
    hidden: false,
    defeated: false,
    hasPlayerOwner: true,
    flags: {},
    ...overrides,
  };
}

/** Fake pino Logger — only `error`/`warn` are ever called by this module. */
function makeFakeLogger(): Logger & {
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger & { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// Unit level — createTurnHookRunner against a bare SystemModule, no DB
// ---------------------------------------------------------------------------

describe("createTurnHookRunner (unit)", () => {
  it("runs onTurnStart/onTurnEnd/onRoundStart/onRoundEnd/onCombatEnd, awaited, in priority order", async () => {
    const log: string[] = [];
    const systemModule = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.onTurnStart("high", (e) => void log.push(`turnStart(10):${e.combatant._id}`), {
        priority: 10,
      });
      r.onTurnStart("low", (e) => void log.push(`turnStart(0):${e.combatant._id}`), {
        priority: 0,
      });
      r.onTurnEnd("te", (e) => void log.push(`turnEnd:${e.combatant._id}`));
      r.onRoundStart("rs", () => void log.push("roundStart"));
      r.onRoundEnd("re", () => void log.push("roundEnd"));
      r.onCombatEnd("ce", (e) => void log.push(`combatEnd:${e.actorIds.join(",")}`));
    });

    const runner = createTurnHookRunner({
      systemModule,
      services: createStubTurnHookContextServices(),
    });

    const combat = makeCombat();
    const combatant = makeCombatant({ _id: "B" });
    await runner.runTurnEnd(combat, makeCombatant({ _id: "A" }), null);
    await runner.runRoundEnd(combat, 1);
    await runner.runRoundStart(combat, 2);
    await runner.runTurnStart(combat, combatant, null);
    await runner.runCombatEnd(combat, ["A", "B"]);

    expect(log).toEqual([
      "turnEnd:A",
      "roundEnd",
      "roundStart",
      "turnStart(10):B",
      "turnStart(0):B",
      "combatEnd:A,B",
    ]);
  });

  it("delivers worldTime derived from the CombatDocument passed to the call", async () => {
    let seenWorldTime: { round: number; turn: number } | null = null;
    const systemModule = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.onTurnEnd("capture", (_e, ctx) => {
        seenWorldTime = ctx.worldTime;
      });
    });
    const runner = createTurnHookRunner({
      systemModule,
      services: createStubTurnHookContextServices(),
    });
    await runner.runTurnEnd(makeCombat({ round: 3, turnIndex: 2 }), makeCombatant(), null);
    expect(seenWorldTime).toEqual({ round: 3, turn: 2 });
  });

  it("isolates a callback that throws — later callbacks still run and the failure is logged (REQ-SYS-139)", async () => {
    const log: string[] = [];
    const logger = makeFakeLogger();
    const systemModule = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.onTurnStart(
        "throws",
        () => {
          throw new Error("boom");
        },
        { priority: 10 },
      );
      r.onTurnStart("survives", (e) => void log.push(`turnStart:${e.combatant._id}`), {
        priority: 0,
      });
    });
    const runner = createTurnHookRunner({
      systemModule,
      services: createStubTurnHookContextServices(),
      logger,
    });

    await expect(
      runner.runTurnStart(makeCombat(), makeCombatant({ _id: "B" }), null),
    ).resolves.toBeUndefined();

    expect(log).toEqual(["turnStart:B"]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [meta, message] = logger.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(meta["hookId"]).toBe("throws");
    expect(meta["systemId"]).toBe("test-system");
    expect(message).toContain("throws");
  });

  it("isolates a callback whose returned promise rejects", async () => {
    const logger = makeFakeLogger();
    const systemModule = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.onCombatEnd("rejects", () => Promise.reject(new Error("nope")));
    });
    const runner = createTurnHookRunner({
      systemModule,
      services: createStubTurnHookContextServices(),
      logger,
    });

    await expect(runner.runCombatEnd(makeCombat(), ["A"])).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("is a silent no-op when no SystemModule is loaded", async () => {
    const runner = createTurnHookRunner({
      systemModule: undefined,
      services: createStubTurnHookContextServices(),
    });
    await expect(runner.runTurnStart(makeCombat(), makeCombatant(), null)).resolves.toBeUndefined();
  });

  it("is a silent no-op when the loaded system registered no hooks for that event", async () => {
    const systemModule = defineSystem({ ...VALID_MANIFEST }, () => {});
    const runner = createTurnHookRunner({
      systemModule,
      services: createStubTurnHookContextServices(),
    });
    await expect(runner.runRoundStart(makeCombat(), 1)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createStubTurnHookContextServices
// ---------------------------------------------------------------------------

describe("createStubTurnHookContextServices", () => {
  it("applyDamage/applyCondition resolve a NOT_SUPPORTED ack (forward-compatible with ALQ-F1-08/09)", async () => {
    const services = createStubTurnHookContextServices();
    const damageAck = await services.applyDamage({ instances: [{ type: "fire", amount: 1 }] });
    expect(damageAck).toMatchObject({ ok: false, code: "NOT_SUPPORTED" });

    const conditionAck = await services.applyCondition({
      targetTokenIds: ["t1"],
      slug: "frightened",
      mode: "add",
    });
    expect(conditionAck).toMatchObject({ ok: false, code: "NOT_SUPPORTED" });
  });

  it("roll/chat/updateActor/createEmbedded/deleteEmbedded reject with TurnHookContextStubError", async () => {
    const services = createStubTurnHookContextServices();
    await expect(services.roll("1d20", { flavor: "test" })).rejects.toBeInstanceOf(
      TurnHookContextStubError,
    );
    await expect(services.chat({ content: "hi" })).rejects.toBeInstanceOf(TurnHookContextStubError);
    await expect(services.updateActor("a1", {})).rejects.toBeInstanceOf(TurnHookContextStubError);
    await expect(services.createEmbedded("a1", [])).rejects.toBeInstanceOf(
      TurnHookContextStubError,
    );
    await expect(services.deleteEmbedded("a1", [])).rejects.toBeInstanceOf(
      TurnHookContextStubError,
    );
  });
});

// ---------------------------------------------------------------------------
// Wired level — real DocumentStore + SQLite, mock Namespace (bypasses socket
// transport, same pattern as combat-unit.test.ts).
// ---------------------------------------------------------------------------

interface FakeSocket {
  data: { role: number };
  emit(event: string, payload: unknown): void;
}

class MockNamespace {
  readonly broadcasts: Array<{ event: string; envelope: unknown }> = [];
  readonly sockets = new Map<string, FakeSocket>();
  emit(event: string, envelope: unknown): void {
    this.broadcasts.push({ event, envelope });
  }
}

interface Harness {
  dataDir: string;
  fusionDb: FusionDatabase;
  store: DocumentStore;
  combatDeps: CombatHandlerDeps;
  log: string[];
  logger: ReturnType<typeof makeFakeLogger>;
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-turn-hook-runner-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Build a harness wired with a `turnHookRunner` backed by a test SystemModule
 * that appends to `log`. `configureSystem` lets a test add extra hooks (e.g.
 * a throwing one) on top of the baseline turnEnd/turnStart/roundEnd/
 * roundStart/combatEnd loggers.
 */
function buildHarness(configureSystem?: (r: Parameters<typeof defineSystem>[1]) => void): Harness {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const seqStore = new SeqStore(fusionDb.raw);
  const opBuffer = new OpBuffer();
  const ns = new MockNamespace();
  const eventBus = new CombatEventBus();
  const rollService = new RollService({ db: fusionDb.raw });
  const formulaRegistry = new InitiativeFormulaRegistry(rollService, "unit-world");

  const log: string[] = [];
  const systemModule: SystemModule = defineSystem({ ...VALID_MANIFEST }, (r) => {
    r.onTurnEnd("test.turnEnd", (e) => void log.push(`turnEnd:${e.combatant._id}`));
    r.onRoundEnd("test.roundEnd", () => void log.push("roundEnd"));
    r.onRoundStart("test.roundStart", () => void log.push("roundStart"));
    r.onTurnStart("test.turnStart", (e) => void log.push(`turnStart:${e.combatant._id}`));
    r.onCombatEnd(
      "test.combatEnd",
      (e) => void log.push(`combatEnd:${[...e.actorIds].sort().join(",")}`),
    );
    configureSystem?.(r);
  });

  const logger = makeFakeLogger();
  const turnHookRunner: TurnHookRunner = createTurnHookRunner({
    systemModule,
    services: createStubTurnHookContextServices(),
    logger,
  });

  const combatDeps: CombatHandlerDeps = {
    store,
    seqStore,
    opBuffer,
    ns: ns as unknown as CombatHandlerDeps["ns"],
    formulaRegistry,
    eventBus,
    db: fusionDb.raw,
    worldId: "unit-world",
    systemModule,
    turnHookRunner,
    logger,
  };

  return { dataDir, fusionDb, store, combatDeps, log, logger };
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

function createScene(h: Harness): string {
  const scene = h.store.create(
    "scenes",
    { name: "Unit Scene", width: 1000, height: 1000 },
    { userId: GM_CTX.userId },
  );
  return scene["_id"] as string;
}

function createActor(h: Harness, name: string): string {
  const actor = h.store.create(
    "actors",
    { name, type: "character", ownership: { default: 0 } },
    { userId: GM_CTX.userId },
  );
  return actor["_id"] as string;
}

async function run(
  fn: (payload: unknown, ctx: HandlerContext) => Promise<Ack<unknown>> | Ack<unknown>,
  payload: unknown,
  ctx: HandlerContext = GM_CTX,
): Promise<Ack<Record<string, unknown>>> {
  return (await fn(payload, ctx)) as Ack<Record<string, unknown>>;
}

function combatantId(ack: Ack<Record<string, unknown>>): string {
  expect(ack.ok).toBe(true);
  if (!ack.ok) throw new Error("ack not ok");
  return (ack.result["combatant"] as CombatantDocument)._id;
}

describe("TurnHookRunner wired into combat:beginCombat/nextTurn/endCombat/previousTurn", () => {
  let h: Harness;

  afterEach(() => {
    teardown(h);
  });

  it("runs roundStart then turnStart on beginCombat, awaited, with the actor resolved (REQ-CBT-057, REQ-SYS-140)", async () => {
    h = buildHarness();
    const sceneId = createScene(h);
    const actorId = createActor(h, "A");

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);

    const combat = await run(create, { sceneId });
    const combatId = combat.ok ? (combat.result["combat"] as CombatDocument)._id : "";
    const addAck = await run(add, { combatId, tokenId: "t1", actorId, initiative: 10 });
    const id = combatantId(addAck);

    await run(begin, { combatId });

    expect(h.log).toEqual(["roundStart", `turnStart:${id}`]);
  });

  it("awaits turnEnd->turnStart within a round, then turnEnd->roundEnd->roundStart->turnStart across a round boundary (REQ-CBT-057)", async () => {
    h = buildHarness();
    const sceneId = createScene(h);
    const a1 = createActor(h, "A");
    const a2 = createActor(h, "B");

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const next = buildCombatNextHandler(h.combatDeps);

    const combat = await run(create, { sceneId });
    const combatId = combat.ok ? (combat.result["combat"] as CombatDocument)._id : "";
    const id1 = combatantId(
      await run(add, { combatId, tokenId: "t1", actorId: a1, initiative: 20 }),
    );
    const id2 = combatantId(
      await run(add, { combatId, tokenId: "t2", actorId: a2, initiative: 10 }),
    );

    await run(begin, { combatId }); // round 1, turn 0 (id1 active)
    h.log.length = 0;

    await run(next, { combatId }); // -> turn 1 (id2), same round
    expect(h.log).toEqual([`turnEnd:${id1}`, `turnStart:${id2}`]);

    h.log.length = 0;
    await run(next, { combatId }); // wraps -> round 2, turn 0 (id1)
    expect(h.log).toEqual([`turnEnd:${id2}`, "roundEnd", "roundStart", `turnStart:${id1}`]);
  });

  it("does not resolve the nextTurn ack until the last awaited hook settles (REQ-CBT-058)", async () => {
    let hookSettled = false;
    h = buildHarness((r) => {
      r.onTurnStart("test.slow", async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        hookSettled = true;
      });
    });
    const sceneId = createScene(h);
    const a1 = createActor(h, "A");
    const a2 = createActor(h, "B");
    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const next = buildCombatNextHandler(h.combatDeps);

    const combat = await run(create, { sceneId });
    const combatId = combat.ok ? (combat.result["combat"] as CombatDocument)._id : "";
    await run(add, { combatId, tokenId: "t1", actorId: a1, initiative: 20 });
    await run(add, { combatId, tokenId: "t2", actorId: a2, initiative: 10 });
    await run(begin, { combatId });

    const ack = await run(next, { combatId });
    expect(ack.ok).toBe(true);
    expect(hookSettled).toBe(true);
  });

  it("a turnStart callback that throws does not block the ack or subsequent hooks (REQ-SYS-139)", async () => {
    h = buildHarness((r) => {
      r.onTurnStart(
        "test.throws",
        () => {
          throw new Error("boom");
        },
        { priority: 10 },
      );
    });
    const sceneId = createScene(h);
    const actorId = createActor(h, "A");
    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);

    const combat = await run(create, { sceneId });
    const combatId = combat.ok ? (combat.result["combat"] as CombatDocument)._id : "";
    const id = combatantId(await run(add, { combatId, tokenId: "t1", actorId, initiative: 10 }));

    const ack = await run(begin, { combatId });
    expect(ack.ok).toBe(true);
    expect(h.log).toEqual(["roundStart", `turnStart:${id}`]);
    expect(h.logger.error).toHaveBeenCalled();
  });

  it("endCombat runs combatEnd with deduped actorIds, before the Combat document is persisted as ended (REQ-CBT-060)", async () => {
    h = buildHarness();
    const sceneId = createScene(h);
    const a1 = createActor(h, "A");
    const a2 = createActor(h, "B");

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const end = buildCombatEndHandler(h.combatDeps);

    const combat = await run(create, { sceneId });
    const combatId = combat.ok ? (combat.result["combat"] as CombatDocument)._id : "";
    await run(add, { combatId, tokenId: "t1", actorId: a1, initiative: 20 });
    await run(add, { combatId, tokenId: "t2", actorId: a2, initiative: 10 });
    // Second combatant sharing a1's actor — proves dedup.
    await run(add, { combatId, tokenId: "t3", actorId: a1, initiative: 5 });
    await run(begin, { combatId });
    h.log.length = 0;

    const ack = await run(end, { combatId });
    expect(ack.ok).toBe(true);
    expect(h.log).toEqual([`combatEnd:${[a1, a2].sort().join(",")}`]);

    const persisted = h.store.get("combats", combatId);
    expect(persisted["ended"]).toBe(true);
  });

  it("combatEnd hooks observe the Combat document not yet archived (REQ-CBT-060 ordering)", async () => {
    let endedWhenHookRan: unknown;
    h = buildHarness((r) => {
      r.onCombatEnd("test.readsStore", (e) => {
        endedWhenHookRan = h.store.get("combats", e.combat._id)["ended"];
      });
    });
    const sceneId = createScene(h);
    const actorId = createActor(h, "A");
    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const end = buildCombatEndHandler(h.combatDeps);

    const combat = await run(create, { sceneId });
    const combatId = combat.ok ? (combat.result["combat"] as CombatDocument)._id : "";
    await run(add, { combatId, tokenId: "t1", actorId, initiative: 10 });
    await run(begin, { combatId });

    await run(end, { combatId });

    expect(endedWhenHookRan).not.toBe(true);
  });

  it("previousTurn does NOT run the new awaited system hooks (spec 10 open question 8)", async () => {
    h = buildHarness();
    const sceneId = createScene(h);
    const a1 = createActor(h, "A");
    const a2 = createActor(h, "B");
    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const next = buildCombatNextHandler(h.combatDeps);
    const previous = buildCombatPreviousHandler(h.combatDeps);

    const combat = await run(create, { sceneId });
    const combatId = combat.ok ? (combat.result["combat"] as CombatDocument)._id : "";
    await run(add, { combatId, tokenId: "t1", actorId: a1, initiative: 20 });
    await run(add, { combatId, tokenId: "t2", actorId: a2, initiative: 10 });
    await run(begin, { combatId });
    await run(next, { combatId });
    h.log.length = 0;

    const ack = await run(previous, { combatId });
    expect(ack.ok).toBe(true);
    expect(h.log).toEqual([]);
  });
});
