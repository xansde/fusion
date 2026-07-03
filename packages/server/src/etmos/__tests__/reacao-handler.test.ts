/**
 * Etmos Reação por rodada — server tests (REQ-ETM-023).
 *
 * Exercises registerReacaoResetOnTurnStart (reset half, wired to the REAL
 * production turnStart lifecycle via CombatEventBus, exactly like
 * combat-handlers.ts's buildCombatStartHandler/buildCombatNextHandler emit
 * it) and buildReacaoUsarHandler (spend half), against a real DocumentStore +
 * SQLite DB and a mock socket.io Namespace — mirrors combat/__tests__/combat-unit.test.ts's
 * harness pattern.
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
import { InitiativeFormulaRegistry } from "../../combat/initiative-registry.js";
import { CombatEventBus } from "../../combat/combat-event-bus.js";
import {
  buildCombatCreateHandler,
  buildCombatStartHandler,
  buildCombatAddCombatantHandler,
  buildCombatNextHandler,
  type CombatHandlerDeps,
} from "../../combat/combat-handlers.js";
import { registerReacaoResetOnTurnStart, buildReacaoUsarHandler } from "../reacao-handler.js";
import type { HandlerContext } from "../../net/handler-registry.js";
import type { Ack, Envelope, CombatDocument, CombatantDocument } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-etmos-reacao-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface FakeSocket {
  data: { role: number };
  emit(event: string, payload: unknown): void;
}

class MockNamespace {
  readonly broadcasts: Array<{ event: string; envelope: Envelope }> = [];
  readonly sockets = new Map<string, FakeSocket>();

  emit(event: string, envelope: Envelope): void {
    this.broadcasts.push({ event, envelope });
  }

  addSocket(id: string, role: number): void {
    this.sockets.set(id, { data: { role }, emit: (): void => {} });
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
  combatDeps: CombatHandlerDeps;
}

function buildHarness(): Harness {
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
  const formulaRegistry = new InitiativeFormulaRegistry(rollService, "unit-world", "etmos");

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

  // Wire the Reação reset listener exactly like socket-manager.ts's boot path.
  registerReacaoResetOnTurnStart(eventBus, {
    store,
    seqStore,
    opBuffer,
    ns: ns as unknown as CombatHandlerDeps["ns"],
  });

  return { dataDir, fusionDb, store, seqStore, opBuffer, ns, eventBus, combatDeps };
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

function createScene(h: Harness): string {
  const scene = h.store.create(
    "scenes",
    { name: "Unit Scene", width: 1000, height: 1000 },
    { userId: GM_CTX.userId },
  );
  return scene["_id"] as string;
}

/** Create an Orador Actor, optionally with the Agilidade Mental habilidade embedded. */
function createOrador(
  h: Harness,
  ownerId: string,
  opts: { comAgilidadeMental?: boolean; estresseAtual?: number; estresseLimite?: number } = {},
): string {
  const { comAgilidadeMental = false, estresseAtual = 0, estresseLimite = 8 } = opts;
  const ownership: Record<string, number> = { default: 0, [ownerId]: 3 };
  const items = comAgilidadeMental
    ? [
        {
          _id: "item-am",
          type: "habilidade",
          name: "Agilidade Mental",
          system: { categoria: "teorica" },
        },
      ]
    : [];
  const actor = h.store.create(
    "actors",
    {
      name: "Test Orador",
      type: "orador",
      ownership,
      system: {
        atributos: {
          corpo: { value: 3, max: 6 },
          alma: { value: 3, max: 6 },
          mente: { value: 3, max: 6 },
        },
        estresse: { atual: estresseAtual, limite: estresseLimite },
        fadiga: { estado: "normal" },
      },
      items,
    },
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
  return ack.result["combat"] as CombatDocument;
}

function combatantOf(combat: CombatDocument, actorId: string): CombatantDocument {
  const c = combat.combatants.find((x) => x.actorId === actorId);
  if (!c) throw new Error("combatant not found");
  return c;
}

function reacoesOf(combatant: CombatantDocument): { atual: number; max: number } | undefined {
  return combatant.flags["etmos"]?.["reacoes"] as { atual: number; max: number } | undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Etmos Reação por rodada (REQ-ETM-023)", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    teardown(h);
  });

  it("resets Reação to { atual: 1, max: 1 } when a plain Orador's turn starts", async () => {
    const sceneId = createScene(h);
    const actorId = createOrador(h, "player-1");

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    await run(add, { combatId: combat._id, tokenId: "t-1", actorId, initiative: 5 }, GM_CTX);
    await run(begin, { combatId: combat._id }, GM_CTX);

    // Read fresh from the store — buildCombatStartHandler's own ack captures
    // `updatedCombat` BEFORE emitTurnStart() runs synchronously and our
    // turnStart listener performs its OWN follow-up store.update; the ack's
    // snapshot is stale by the time our listener's write lands.
    const persisted = h.store.get("combats", combat._id) as unknown as CombatDocument;
    const combatant = combatantOf(persisted, actorId);
    expect(reacoesOf(combatant)).toEqual({ atual: 1, max: 1 });
  });

  it("resets Reação to { atual: 2, max: 2 } for an Orador with Agilidade Mental", async () => {
    const sceneId = createScene(h);
    const actorId = createOrador(h, "player-1", { comAgilidadeMental: true });

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    await run(add, { combatId: combat._id, tokenId: "t-1", actorId, initiative: 5 }, GM_CTX);
    await run(begin, { combatId: combat._id }, GM_CTX);

    const persisted = h.store.get("combats", combat._id) as unknown as CombatDocument;
    const combatant = combatantOf(persisted, actorId);
    expect(reacoesOf(combatant)).toEqual({ atual: 2, max: 2 });
  });

  it("re-resets to full on the combatant's NEXT turn (round 2), not just once", async () => {
    const sceneId = createScene(h);
    const actorId = createOrador(h, "player-1");

    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const next = buildCombatNextHandler(h.combatDeps);
    const usar = buildReacaoUsarHandler({
      store: h.store,
      db: h.fusionDb.raw,
      ns: h.ns as unknown as CombatHandlerDeps["ns"],
      seqStore: h.seqStore,
      opBuffer: h.opBuffer,
      worldId: "unit-world",
    });

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    // Single combatant: nextTurn on a 1-combatant encounter wraps back to
    // the same combatant's turn on the next round (REQ-CBT-021).
    await run(add, { combatId: combat._id, tokenId: "t-1", actorId, initiative: 5 }, GM_CTX);
    const started = combatFromAck(await run(begin, { combatId: combat._id }, GM_CTX));
    const combatantId = combatantOf(started, actorId)._id;

    // Spend the only Reação.
    const usarAck = await usar({ combatId: combat._id, combatantId }, playerCtx("player-1"));
    expect(usarAck.ok).toBe(true);

    const afterSpend = h.store.get("combats", combat._id) as unknown as CombatDocument;
    expect(reacoesOf(combatantOf(afterSpend, actorId))).toEqual({ atual: 0, max: 1 });

    // Advance the turn (wraps back to the same single combatant, new round) —
    // this fires a REAL turnStart event, which must reset the counter again.
    await run(next, { combatId: combat._id }, GM_CTX);

    const afterNext = h.store.get("combats", combat._id) as unknown as CombatDocument;
    expect(reacoesOf(combatantOf(afterNext, actorId))).toEqual({ atual: 1, max: 1 });
  });

  it("usar: rejects spending past zero", async () => {
    const sceneId = createScene(h);
    const actorId = createOrador(h, "player-1");
    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const usar = buildReacaoUsarHandler({
      store: h.store,
      db: h.fusionDb.raw,
      ns: h.ns as unknown as CombatHandlerDeps["ns"],
      seqStore: h.seqStore,
      opBuffer: h.opBuffer,
      worldId: "unit-world",
    });

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    await run(add, { combatId: combat._id, tokenId: "t-1", actorId, initiative: 5 }, GM_CTX);
    const started = combatFromAck(await run(begin, { combatId: combat._id }, GM_CTX));
    const combatantId = combatantOf(started, actorId)._id;

    const first = await usar({ combatId: combat._id, combatantId }, playerCtx("player-1"));
    expect(first.ok).toBe(true);
    const second = await usar({ combatId: combat._id, combatantId }, playerCtx("player-1"));
    expect(second.ok).toBe(false);
  });

  it("usar: Agilidade Mental's 2ª Reação accumulates +3 Estresse via the shared cost path", async () => {
    const sceneId = createScene(h);
    const actorId = createOrador(h, "player-1", {
      comAgilidadeMental: true,
      estresseAtual: 2,
      estresseLimite: 8,
    });
    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const usar = buildReacaoUsarHandler({
      store: h.store,
      db: h.fusionDb.raw,
      ns: h.ns as unknown as CombatHandlerDeps["ns"],
      seqStore: h.seqStore,
      opBuffer: h.opBuffer,
      worldId: "unit-world",
    });

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    await run(add, { combatId: combat._id, tokenId: "t-1", actorId, initiative: 5 }, GM_CTX);
    const started = combatFromAck(await run(begin, { combatId: combat._id }, GM_CTX));
    const combatantId = combatantOf(started, actorId)._id;

    // 1st Reação — no cost.
    const first = await usar({ combatId: combat._id, combatantId }, playerCtx("player-1"));
    expect(first.ok).toBe(true);
    if (first.ok)
      expect((first.result as { segundaReacaoComCusto: boolean }).segundaReacaoComCusto).toBe(
        false,
      );
    const actorAfterFirst = h.store.get("actors", actorId);
    expect((actorAfterFirst["system"] as Record<string, unknown>)["estresse"]).toMatchObject({
      atual: 2,
    });

    // 2nd Reação — +3 Estresse (2 -> 5), Fadiga recomputed.
    const second = await usar({ combatId: combat._id, combatantId }, playerCtx("player-1"));
    expect(second.ok).toBe(true);
    if (second.ok)
      expect((second.result as { segundaReacaoComCusto: boolean }).segundaReacaoComCusto).toBe(
        true,
      );
    const actorAfterSecond = h.store.get("actors", actorId);
    const sys = actorAfterSecond["system"] as Record<string, unknown>;
    expect(sys["estresse"]).toMatchObject({ atual: 5 });
  });

  it("usar: rejects a non-owner player", async () => {
    const sceneId = createScene(h);
    const actorId = createOrador(h, "player-1");
    const create = buildCombatCreateHandler(h.combatDeps);
    const add = buildCombatAddCombatantHandler(h.combatDeps);
    const begin = buildCombatStartHandler(h.combatDeps);
    const usar = buildReacaoUsarHandler({
      store: h.store,
      db: h.fusionDb.raw,
      ns: h.ns as unknown as CombatHandlerDeps["ns"],
      seqStore: h.seqStore,
      opBuffer: h.opBuffer,
      worldId: "unit-world",
    });

    const combat = combatFromAck(await run(create, { sceneId }, GM_CTX));
    await run(add, { combatId: combat._id, tokenId: "t-1", actorId, initiative: 5 }, GM_CTX);
    const started = combatFromAck(await run(begin, { combatId: combat._id }, GM_CTX));
    const combatantId = combatantOf(started, actorId)._id;

    const ack = await usar({ combatId: combat._id, combatantId }, playerCtx("player-2"));
    expect(ack.ok).toBe(false);
  });
});
