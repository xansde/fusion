/**
 * M5-C — Etmos Compositor de Magias server handlers, unit/integration tests.
 *
 * Exercises the five `etmos:conjuracao:*` handlers directly against a real
 * DocumentStore + SQLite DB and a mock socket.io Namespace (mirrors
 * combat/__tests__/combat-unit.test.ts's harness pattern).
 *
 * Coverage:
 *   - Full E2E flow proposta -> arbitrada -> rolada -> resolvida, applying
 *     the correct Estresse cost and recomputing Fadiga (CA-9).
 *   - Exausto conjurador triggers the Fadiga control roll and fails on
 *     `> Corpo+4` (CA-10) — Estresse still accumulates.
 *   - Totem Rank > 0 sums into the arbitrated cost for non-Trivial magic
 *     (CA-12, REQ-ETM-043).
 *   - Cancel before rolada applies zero cost.
 *   - Permission guards: player cannot arbitrar/resolver; non-owner cannot
 *     propor/rolar/cancelar another player's Actor.
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
import {
  buildConjuracaoProporHandler,
  buildConjuracaoArbitrarHandler,
  buildConjuracaoRolarHandler,
  buildConjuracaoResolverHandler,
  buildConjuracaoCancelarHandler,
  type ConjuracaoHandlerDeps,
} from "../conjuracao-handlers.js";
import type { HandlerContext } from "../../net/handler-registry.js";
import type { Ack, Envelope, ChatMessage } from "@fusion/shared";
import { CHAT_DOCUMENT_TYPE } from "@fusion/shared";
import type { ConjuracaoCard } from "@fusion/system-etmos";
import type { SystemModule } from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-etmos-conjuracao-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
    this.sockets.set(id, {
      data: { role },
      emit: (): void => {
        // no-op — broadcasts array above already captures ns.emit calls;
        // per-socket emit content is asserted via the ns-wide broadcast log.
      },
    });
  }
}

interface Harness {
  dataDir: string;
  fusionDb: FusionDatabase;
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: MockNamespace;
  deps: ConjuracaoHandlerDeps;
}

function buildHarness(rng?: { next(): number }, systemModule?: SystemModule): Harness {
  const dataDir = makeTempDir();
  const dbPath = join(dataDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const store = new DocumentStore({ db: fusionDb.raw, coreVersion: "0.1.0" });
  const seqStore = new SeqStore(fusionDb.raw);
  const opBuffer = new OpBuffer();
  const ns = new MockNamespace();
  ns.addSocket("gm-socket", UserRole.GAMEMASTER);
  ns.addSocket("player-socket", UserRole.PLAYER);

  const deps: ConjuracaoHandlerDeps = {
    store,
    db: fusionDb.raw,
    ns: ns as unknown as ConjuracaoHandlerDeps["ns"],
    seqStore,
    opBuffer,
    worldId: "unit-world",
    rollServiceOptions: rng ? { rng } : undefined,
    ...(systemModule ? { systemModule } : {}),
  };

  return { dataDir, fusionDb, store, seqStore, opBuffer, ns, deps };
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

/**
 * A constant-raw-uint32 RNG engine. `@dice-roller/rpg-dice-roller` maps the
 * raw uint32 into the die's range; a fixed value yields a fixed die face.
 * Mirrors the pattern used by combat-unit.test.ts / roll-service tests.
 */
function constantEngine(raw: number): { next(): number } {
  return { next: () => raw };
}

/** Create an Orador Actor with given atributos/estresse/fadiga/totem, owned by ownerId. */
function createOrador(
  h: Harness,
  ownerId: string,
  overrides: {
    corpo?: number;
    alma?: number;
    mente?: number;
    estresseAtual?: number;
    estresseLimite?: number;
    fadigaEstado?: string;
    totemRank?: number;
  } = {},
): string {
  const {
    corpo = 3,
    alma = 3,
    mente = 3,
    estresseAtual = 0,
    estresseLimite = 7,
    fadigaEstado = "normal",
    totemRank = 0,
  } = overrides;

  const ownership: Record<string, number> = { default: 0, [ownerId]: 3 };
  const actor = h.store.create(
    "actors",
    {
      name: "Test Orador",
      type: "orador",
      ownership,
      system: {
        atributos: {
          corpo: { value: corpo, max: 6 },
          alma: { value: alma, max: 6 },
          mente: { value: mente, max: 6 },
        },
        estresse: { atual: estresseAtual, limite: estresseLimite },
        fadiga: { estado: fadigaEstado },
        totem: { possui: totemRank > 0, rank: totemRank },
      },
    },
    { userId: GM_CTX.userId },
  );
  return actor["_id"] as string;
}

function fraseFixture(): Record<string, unknown> {
  return {
    funcao_slug: "et",
    objeto_slugs: ["imu"],
    caracteristica_slugs: [],
    criadores: [],
    modificador_slugs: [],
    intencao: "Curar um ferimento leve",
    frase_completa: "Etimu",
    complexidade: null,
    estresse_gerado: 0,
    favorita: false,
  };
}

async function propor(
  h: Harness,
  ctx: HandlerContext,
  conjuradorActorId: string,
): Promise<Ack<{ message: ChatMessage }>> {
  const handler = buildConjuracaoProporHandler(h.deps);
  return (await handler({ conjuradorActorId, frase: fraseFixture() }, ctx)) as Ack<{
    message: ChatMessage;
  }>;
}

function cardOf(ack: Ack<{ message: ChatMessage }>): ConjuracaoCard {
  expect(ack.ok).toBe(true);
  if (!ack.ok) throw new Error("ack not ok");
  const flags = ack.result.message.flags as Record<string, Record<string, unknown>>;
  return flags["etmos"]?.["conjuracao"] as unknown as ConjuracaoCard;
}

function messageIdOf(ack: Ack<{ message: ChatMessage }>): string {
  expect(ack.ok).toBe(true);
  if (!ack.ok) throw new Error("ack not ok");
  return ack.result.message._id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("etmos conjuração handlers — full lifecycle", () => {
  let h: Harness;

  beforeEach(() => {
    // 8 maps to a "2" on a d6 (rpg-dice-roller: value = (raw % 6) + 1 style
    // mapping is internal; we assert on message/card mechanics, not exact
    // pips, since the exact mapping is an implementation detail of the dice
    // library — this fixed raw value just needs to be DETERMINISTIC).
    h = buildHarness(constantEngine(1000));
  });

  afterEach(() => {
    teardown(h);
  });

  it("CA-9: proposta -> arbitrada -> rolada -> resolvida applies custo_estresse and recomputes Fadiga", async () => {
    const actorId = createOrador(h, "player-1", { alma: 3, estresseAtual: 0, estresseLimite: 7 });

    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    expect(proporAck.ok).toBe(true);
    let card = cardOf(proporAck);
    expect(card.estado).toBe("proposta");
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    const arbitrarAck = (await arbitrar(
      { messageId, complexidade: "regular", notasNarrador: "Cura simples." },
      GM_CTX,
    )) as Ack<{ message: ChatMessage }>;
    expect(arbitrarAck.ok).toBe(true);
    card = cardOf(arbitrarAck);
    expect(card.estado).toBe("arbitrada");
    expect(card.complexidade).toBe("regular");
    expect(card.custo_estresse).toBe(1); // CUSTO_BASE.regular = 1, rankTotem=0

    const rolar = buildConjuracaoRolarHandler(h.deps);
    const rolarAck = (await rolar({ messageId }, playerCtx("player-1"))) as Ack<{
      message: ChatMessage;
    }>;
    expect(rolarAck.ok).toBe(true);
    card = cardOf(rolarAck);
    expect(card.estado).toBe("rolada");
    expect(card.roll_message_id).not.toBeNull();

    const resolver = buildConjuracaoResolverHandler(h.deps);
    const resolverAck = (await resolver({ messageId }, GM_CTX)) as Ack<{
      message: ChatMessage;
      actor: Record<string, unknown>;
    }>;
    expect(resolverAck.ok).toBe(true);
    card = cardOf(resolverAck);
    expect(card.estado).toBe("resolvida");

    if (!resolverAck.ok) throw new Error("resolver ack not ok");
    const updatedActor = resolverAck.result.actor;
    const sys = updatedActor["system"] as Record<string, unknown>;
    const estresse = sys["estresse"] as Record<string, unknown>;
    expect(estresse["atual"]).toBe(1); // 0 + custoEstresse("regular", 0) = 1

    // Fadiga recomputed from the DeriveStep-equivalent estadoFadiga() formula:
    // d = estresse.atual(1) - estresse.limite(7) = -6 <= 0 -> "normal"
    const fadiga = sys["fadiga"] as Record<string, unknown>;
    expect(fadiga["estado"]).toBe("normal");
  });

  it("CA-12: Totem Rank 2 sums +2 Estresse for non-Trivial magic", async () => {
    const actorId = createOrador(h, "player-1", { totemRank: 2, estresseLimite: 10 });

    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    const arbitrarAck = (await arbitrar({ messageId, complexidade: "regular" }, GM_CTX)) as Ack<{
      message: ChatMessage;
    }>;
    const card = cardOf(arbitrarAck);
    // CUSTO_BASE.regular (1) + rankTotem (2) = 3 — REQ-ETM-043/CA-12.
    expect(card.custo_estresse).toBe(3);
  });

  it("Rank de Totem NÃO soma para Complexidade trivial", async () => {
    const actorId = createOrador(h, "player-1", { totemRank: 2 });
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    const arbitrarAck = (await arbitrar({ messageId, complexidade: "trivial" }, GM_CTX)) as Ack<{
      message: ChatMessage;
    }>;
    const card = cardOf(arbitrarAck);
    expect(card.custo_estresse).toBe(0);
  });

  it("cancelar antes de rolada aplica custo zero e não toca o Actor", async () => {
    const actorId = createOrador(h, "player-1", { estresseAtual: 0 });
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    await arbitrar({ messageId, complexidade: "complexa" }, GM_CTX);

    const cancelar = buildConjuracaoCancelarHandler(h.deps);
    const cancelarAck = (await cancelar({ messageId }, playerCtx("player-1"))) as Ack<{
      message: ChatMessage;
    }>;
    expect(cancelarAck.ok).toBe(true);
    const card = cardOf(cancelarAck);
    expect(card.estado).toBe("cancelada");

    const actor = h.store.get("actors", actorId);
    const sys = actor["system"] as Record<string, unknown>;
    const estresse = sys["estresse"] as Record<string, unknown>;
    expect(estresse["atual"]).toBe(0); // untouched
  });

  it("cancelar depois de rolada é rejeitado (REQ-ETM-033: só antes de rolar)", async () => {
    const actorId = createOrador(h, "player-1");
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    await arbitrar({ messageId, complexidade: "regular" }, GM_CTX);

    const rolar = buildConjuracaoRolarHandler(h.deps);
    await rolar({ messageId }, playerCtx("player-1"));

    const cancelar = buildConjuracaoCancelarHandler(h.deps);
    const cancelarAck = (await cancelar({ messageId }, playerCtx("player-1"))) as Ack<never>;
    expect(cancelarAck.ok).toBe(false);
  });
});

describe("etmos conjuração handlers — Fadiga control roll (REQ-ETM-025, CA-10)", () => {
  let h: Harness;

  afterEach(() => {
    teardown(h);
  });

  it("Exausto + Complexidade não-trivial: controle falha quando > Corpo+4, Estresse ainda acumula ao resolver", async () => {
    // Force the control roll (2d6) to roll HIGH (deterministic max via a
    // near-ceiling raw uint32 — verified to map every die to its highest
    // face: 0xfeffffff -> 2d6=12). NOTE: 0xffffffff itself (and other values
    // extremely close to the uint32 ceiling) makes rpg-dice-roller's uniform
    // rejection-sampling loop spin forever (it never accepts a raw value
    // that normalizes to exactly 1.0) — confirmed by direct repro against
    // the installed library. Always use 0xfeffffff (or lower) for a
    // deterministic "always rolls max" test engine, never 0xffffffff.
    h = buildHarness(constantEngine(0xfeffffff));

    const actorId = createOrador(h, "player-1", {
      corpo: 1, // Corpo+4 = 5 — low threshold, easy to exceed with max rolls
      alma: 3,
      fadigaEstado: "exausto",
      estresseAtual: 0,
      estresseLimite: 7,
    });

    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    await arbitrar({ messageId, complexidade: "regular" }, GM_CTX);

    const rolar = buildConjuracaoRolarHandler(h.deps);
    const rolarAck = (await rolar({ messageId }, playerCtx("player-1"))) as Ack<{
      message: ChatMessage;
    }>;
    expect(rolarAck.ok).toBe(true);
    const card = cardOf(rolarAck);

    expect(card.controle_fadiga).not.toBeNull();
    expect(card.controle_fadiga?.rolou).toBe(true);
    // With corpo=1, threshold is Corpo+4=5; a 2d6 roll can reach at most 12,
    // and the constant max-uint32 engine drives the dice library to its
    // highest face each time, so total > 5 is expected here.
    expect(card.controle_fadiga?.valor).toBeGreaterThan(5);
    expect(card.controle_fadiga?.falhou).toBe(true);
    expect(card.sucesso).toBe(false); // REQ-ETM-025: falha sobrepõe sucesso

    // REQ-ETM-024: Estresse ainda acumula mesmo com a magia falhando.
    const resolver = buildConjuracaoResolverHandler(h.deps);
    const resolverAck = (await resolver({ messageId }, GM_CTX)) as Ack<{
      message: ChatMessage;
      actor: Record<string, unknown>;
    }>;
    expect(resolverAck.ok).toBe(true);
    if (!resolverAck.ok) throw new Error("resolver ack not ok");
    const sys = resolverAck.result.actor["system"] as Record<string, unknown>;
    const estresse = sys["estresse"] as Record<string, unknown>;
    expect(estresse["atual"]).toBe(1); // custoEstresse("regular", 0) = 1, applied regardless of sucesso
  });

  it("Esgotado + Complexidade não-trivial: controle_fadiga.morreu=true quando > Corpo+3, sem travar dados nem matar o Actor automaticamente (REQ-ETM-025)", async () => {
    // Same deterministic "always rolls max" engine as the Exausto test above
    // (0xfeffffff -> 2d6=12 every time — see that test's comment for why
    // 0xffffffff itself must never be used).
    h = buildHarness(constantEngine(0xfeffffff));

    const actorId = createOrador(h, "player-1", {
      corpo: 1, // Corpo+3 = 4 — low threshold, easy to exceed with max rolls
      alma: 3,
      fadigaEstado: "esgotado",
      estresseAtual: 0,
      estresseLimite: 7,
    });

    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    await arbitrar({ messageId, complexidade: "regular" }, GM_CTX);

    const rolar = buildConjuracaoRolarHandler(h.deps);
    const rolarAck = (await rolar({ messageId }, playerCtx("player-1"))) as Ack<{
      message: ChatMessage;
    }>;
    expect(rolarAck.ok).toBe(true);
    const card = cardOf(rolarAck);

    expect(card.controle_fadiga).not.toBeNull();
    expect(card.controle_fadiga?.rolou).toBe(true);
    // With corpo=1, threshold is Corpo+3=4; the max-uint32 engine drives the
    // dice library to its highest face each time, so total > 4 is expected.
    expect(card.controle_fadiga?.valor).toBeGreaterThan(4);
    expect(card.controle_fadiga?.morreu).toBe(true);
    // REQ-ETM-025: unlike Exausto, Esgotado's control roll does NOT override
    // `sucesso` — "risco de morte" is a narrative flag for the Narrador to
    // confirm, not an automatic magic-failure or Actor-death side effect.
    expect(card.controle_fadiga?.falhou).toBe(false);
    expect(card.sucesso).toBeNull();

    // The flag must not have auto-killed or otherwise mutated the Actor —
    // resolver still runs normally and Estresse still accumulates exactly
    // like any other resolution (REQ-ETM-024).
    const resolver = buildConjuracaoResolverHandler(h.deps);
    const resolverAck = (await resolver({ messageId }, GM_CTX)) as Ack<{
      message: ChatMessage;
      actor: Record<string, unknown>;
    }>;
    expect(resolverAck.ok).toBe(true);
    if (!resolverAck.ok) throw new Error("resolver ack not ok");
    const sys = resolverAck.result.actor["system"] as Record<string, unknown>;
    const estresse = sys["estresse"] as Record<string, unknown>;
    expect(estresse["atual"]).toBe(1); // custoEstresse("regular", 0) = 1 — unaffected by morreu
  });

  it("Normal (não Exausto/Esgotado): nenhum controle de Fadiga é rolado", async () => {
    h = buildHarness(constantEngine(1234));
    const actorId = createOrador(h, "player-1", { fadigaEstado: "normal" });
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    await arbitrar({ messageId, complexidade: "regular" }, GM_CTX);

    const rolar = buildConjuracaoRolarHandler(h.deps);
    const rolarAck = (await rolar({ messageId }, playerCtx("player-1"))) as Ack<{
      message: ChatMessage;
    }>;
    const card = cardOf(rolarAck);
    expect(card.controle_fadiga).toBeNull();
  });

  it("Exausto + Complexidade trivial: nenhum controle de Fadiga é rolado (só magia não-trivial dispara)", async () => {
    h = buildHarness(constantEngine(0xfeffffff));
    const actorId = createOrador(h, "player-1", { fadigaEstado: "exausto" });
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    await arbitrar({ messageId, complexidade: "trivial" }, GM_CTX);

    const rolar = buildConjuracaoRolarHandler(h.deps);
    const rolarAck = (await rolar({ messageId }, playerCtx("player-1"))) as Ack<{
      message: ChatMessage;
    }>;
    const card = cardOf(rolarAck);
    expect(card.controle_fadiga).toBeNull();
  });
});

describe("etmos conjuração handlers — permission guards", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness(constantEngine(1000));
  });

  afterEach(() => {
    teardown(h);
  });

  it("jogador NÃO pode arbitrar (PERMISSION_DENIED)", async () => {
    const actorId = createOrador(h, "player-1");
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    const ack = (await arbitrar(
      { messageId, complexidade: "regular" },
      playerCtx("player-1"),
    )) as Ack<never>;
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe("PERMISSION_DENIED");
  });

  it("jogador NÃO pode resolver (PERMISSION_DENIED)", async () => {
    const actorId = createOrador(h, "player-1");
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    await arbitrar({ messageId, complexidade: "regular" }, GM_CTX);

    const rolar = buildConjuracaoRolarHandler(h.deps);
    await rolar({ messageId }, playerCtx("player-1"));

    const resolver = buildConjuracaoResolverHandler(h.deps);
    const ack = (await resolver({ messageId }, playerCtx("player-1"))) as Ack<never>;
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe("PERMISSION_DENIED");
  });

  it("outro jogador (não dono) NÃO pode propor em nome de um Actor alheio", async () => {
    const actorId = createOrador(h, "player-1");
    const handler = buildConjuracaoProporHandler(h.deps);
    const ack = (await handler(
      { conjuradorActorId: actorId, frase: fraseFixture() },
      playerCtx("player-2"),
    )) as Ack<never>;
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe("PERMISSION_DENIED");
  });

  it("outro jogador (não dono) NÃO pode rolar por um Actor alheio", async () => {
    const actorId = createOrador(h, "player-1");
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    await arbitrar({ messageId, complexidade: "regular" }, GM_CTX);

    const rolar = buildConjuracaoRolarHandler(h.deps);
    const ack = (await rolar({ messageId }, playerCtx("player-2"))) as Ack<never>;
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe("PERMISSION_DENIED");
  });

  it("dono reconhecido via ownership.default (sem entrada por-usuário) — usa resolveOwnership/testOwnership, não leitura hand-rolled", async () => {
    // No per-user ownership entry for "player-3" — only `default: OWNER (3)`.
    // The old hand-rolled `ownership[userId] >= 3` read ignores `default`
    // entirely and would report player-3 as NOT the owner (regression guard
    // for FIX 3).
    const actor = h.store.create(
      "actors",
      {
        name: "Default-Owned Orador",
        type: "orador",
        ownership: { default: 3 },
        system: {
          atributos: {
            corpo: { value: 3, max: 6 },
            alma: { value: 3, max: 6 },
            mente: { value: 3, max: 6 },
          },
          estresse: { atual: 0, limite: 7 },
          fadiga: { estado: "normal" },
          totem: { possui: false, rank: 0 },
        },
      },
      { userId: GM_CTX.userId },
    );
    const actorId = actor["_id"] as string;

    const proporAck = await propor(h, playerCtx("player-3"), actorId);
    expect(proporAck.ok).toBe(true);
    const card = cardOf(proporAck);
    expect(card.estado).toBe("proposta");
  });

  it("GM pode arbitrar/rolar/resolver mesmo sem ser dono do Actor", async () => {
    const actorId = createOrador(h, "player-1");
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    const arbitrarAck = (await arbitrar({ messageId, complexidade: "regular" }, GM_CTX)) as Ack<{
      message: ChatMessage;
    }>;
    expect(arbitrarAck.ok).toBe(true);

    const rolar = buildConjuracaoRolarHandler(h.deps);
    const rolarAck = (await rolar({ messageId }, GM_CTX)) as Ack<{ message: ChatMessage }>;
    expect(rolarAck.ok).toBe(true);

    const resolver = buildConjuracaoResolverHandler(h.deps);
    const resolverAck = (await resolver({ messageId }, GM_CTX)) as Ack<{
      message: ChatMessage;
    }>;
    expect(resolverAck.ok).toBe(true);
  });
});

describe("etmos conjuração handlers — OpBuffer resync coverage (FIX 1)", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness(constantEngine(1000));
  });

  afterEach(() => {
    teardown(h);
  });

  it("resolver's doc:update (Actor) and card-state broadcast are both pushed into OpBuffer for resync:delta replay", async () => {
    const actorId = createOrador(h, "player-1", { alma: 3, estresseAtual: 0, estresseLimite: 7 });

    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);
    const seqBeforeResolve = h.seqStore.peek();

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    await arbitrar({ messageId, complexidade: "regular" }, GM_CTX);

    const rolar = buildConjuracaoRolarHandler(h.deps);
    await rolar({ messageId }, playerCtx("player-1"));

    const resolver = buildConjuracaoResolverHandler(h.deps);
    const resolverAck = (await resolver({ messageId }, GM_CTX)) as Ack<{
      message: ChatMessage;
      actor: Record<string, unknown>;
    }>;
    expect(resolverAck.ok).toBe(true);

    // Simulate a client that reconnects with the seq it had right after
    // "propor" — resync:delta must replay EVERY op since then, including
    // the resolver's doc:update Actor patch (Estresse/Fadiga) and the final
    // card-state ChatMessage broadcast. Before FIX 1 these were consumed
    // from SeqStore but never pushed into OpBuffer, so a reconnecting client
    // would silently miss them until the next full snapshot.
    const currentSeq = h.seqStore.peek();
    const replay = h.opBuffer.opsAfter(seqBeforeResolve, currentSeq);
    expect(replay).not.toBeNull();

    const docUpdateOps = (replay ?? []).filter((op) => op.type === "doc:update");
    expect(docUpdateOps.length).toBeGreaterThanOrEqual(1);
    const actorUpdatePayload = docUpdateOps[docUpdateOps.length - 1]!.payload as {
      documentType: string;
      documents: Array<Record<string, unknown>>;
    };
    expect(actorUpdatePayload.documentType).toBe("Actor");
    const replayedActor = actorUpdatePayload.documents[0]!;
    const replayedSys = replayedActor["system"] as Record<string, unknown>;
    const replayedEstresse = replayedSys["estresse"] as Record<string, unknown>;
    expect(replayedEstresse["atual"]).toBe(1);

    // CHAT_BROADCAST_EVENT (packages/shared/src/chat/protocol.ts) is "doc:create"
    // — chat messages piggyback on the doc:create envelope type, distinguished
    // from real Actor/Item creates by payload.documentType === "chat-message".
    const chatOps = (replay ?? []).filter((op) => {
      if (op.type !== "doc:create") return false;
      const payload = op.payload as { documentType?: string };
      return payload.documentType === CHAT_DOCUMENT_TYPE;
    });
    expect(chatOps.length).toBeGreaterThanOrEqual(1);
    const lastChatPayload = chatOps[chatOps.length - 1]!.payload as {
      documents: Array<{ flags: Record<string, Record<string, unknown>> }>;
    };
    const replayedCard = lastChatPayload.documents[0]!.flags["etmos"]?.["conjuracao"] as Record<
      string,
      unknown
    >;
    expect(replayedCard["estado"]).toBe("resolvida");
  });
});

describe("etmos conjuração handlers — rollData single source of truth (FIX 2)", () => {
  it("rolar() consumes the registered rollData builder instead of hand-assembling { atributos }", async () => {
    // A fake SystemModule whose rollData builder returns a DIFFERENT alma
    // value than the Actor's real system.atributos.alma.value — if the
    // handler still hand-assembles rollData from sys.atributos directly
    // (pre-fix behaviour), the roll total will reflect the REAL alma (3),
    // not the builder's override (10). We assert the override wins.
    const fakeSystemModule = {
      registries: {
        rollData: [
          {
            id: "Actor:orador,antagonista",
            documentType: "Actor",
            subtypes: ["orador", "antagonista"],
            build(_doc: Record<string, unknown>): Record<string, unknown> {
              return { atributos: { alma: { value: 10 } } };
            },
          },
        ],
      },
    } as unknown as SystemModule;

    // Deterministic 2d6 via the constant-raw-uint32 engine (raw=1 maps to a
    // fixed-but-unspecified 2d6 total — the exact pip mapping is an
    // implementation detail of the dice library, see the harness comment
    // above `constantEngine`). We only need it to be the SAME base roll in
    // both this test and the fallback test below, so the alma delta
    // (10 - 3 = 7) isolates whether the builder's override was used:
    // total = base2d6 + alma.
    const h = buildHarness(constantEngine(1), fakeSystemModule);
    try {
      const actorId = createOrador(h, "player-1", { alma: 3 });
      const proporAck = await propor(h, playerCtx("player-1"), actorId);
      const messageId = messageIdOf(proporAck);

      const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
      await arbitrar({ messageId, complexidade: "regular" }, GM_CTX);

      const rolar = buildConjuracaoRolarHandler(h.deps);
      const rolarAck = (await rolar({ messageId }, playerCtx("player-1"))) as Ack<{
        message: ChatMessage;
        roll: { total: number };
      }>;
      expect(rolarAck.ok).toBe(true);
      if (!rolarAck.ok) throw new Error("rolar ack not ok");
      // base2d6(raw=1) + 10 (builder override) — proves the registered
      // builder's output was used, not the Actor's real alma=3 (which the
      // fallback test below shows produces base2d6(raw=1) + 3 instead).
      expect(rolarAck.result.roll.total).toBe(14);
    } finally {
      teardown(h);
    }
  });

  it("falls back to { atributos: sys.atributos } when no systemModule is wired (documented fallback)", async () => {
    const h = buildHarness(constantEngine(1)); // no systemModule
    try {
      const actorId = createOrador(h, "player-1", { alma: 3 });
      const proporAck = await propor(h, playerCtx("player-1"), actorId);
      const messageId = messageIdOf(proporAck);

      const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
      await arbitrar({ messageId, complexidade: "regular" }, GM_CTX);

      const rolar = buildConjuracaoRolarHandler(h.deps);
      const rolarAck = (await rolar({ messageId }, playerCtx("player-1"))) as Ack<{
        message: ChatMessage;
        roll: { total: number };
      }>;
      expect(rolarAck.ok).toBe(true);
      if (!rolarAck.ok) throw new Error("rolar ack not ok");
      // base2d6(raw=1) + 3 (real alma, via fallback shape) — the SAME
      // base2d6(raw=1) as the test above (7), confirming the 7-point delta
      // between the two tests' totals (14 vs 7) is entirely attributable to
      // alma (10 vs 3), i.e. the rollData source, not RNG drift.
      expect(rolarAck.result.roll.total).toBe(7);
    } finally {
      teardown(h);
    }
  });
});

describe("etmos conjuração handlers — corrupted card flags (FIX 5)", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness(constantEngine(1000));
  });

  afterEach(() => {
    teardown(h);
  });

  it("arbitrar on a message with a corrupted conjuracao flag returns VALIDATION_FAILED, not a thrown/generic error", async () => {
    const actorId = createOrador(h, "player-1");
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    // Corrupt the persisted flags directly in SQLite — simulates a
    // hand-edited or forward-incompatible flags blob (e.g. `estado` value
    // no longer in EstadoConjuracaoSchema's enum).
    const row = h.fusionDb.raw
      .prepare(`SELECT data FROM chat_messages WHERE id = ?`)
      .get(messageId) as { data: string };
    const msg = JSON.parse(row.data) as { flags: Record<string, Record<string, unknown>> };
    msg.flags["etmos"]!["conjuracao"] = { estado: "not-a-real-state", garbage: true };
    h.fusionDb.raw
      .prepare(`UPDATE chat_messages SET data = ? WHERE id = ?`)
      .run(JSON.stringify(msg), messageId);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    const ack = (await arbitrar({ messageId, complexidade: "regular" }, GM_CTX)) as Ack<never>;
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe("VALIDATION_FAILED");
  });
});

describe("etmos conjuração handlers — excede_maxima advisory flag (FIX 6, REQ-ETM-026)", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness(constantEngine(1000));
  });

  afterEach(() => {
    teardown(h);
  });

  it("arbitrar acima da complexidadeMaxima(mente) grava excede_maxima=true mas NÃO bloqueia (GM override legítimo)", async () => {
    // mente=1 -> complexidadeMaxima = "regular" (Tabela A). Arbitrando
    // "milagre" — well above the ceiling.
    const actorId = createOrador(h, "player-1", { mente: 1 });
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    const ack = (await arbitrar({ messageId, complexidade: "milagre" }, GM_CTX)) as Ack<{
      message: ChatMessage;
    }>;

    // GM-only arbitrar is never blocked by this check.
    expect(ack.ok).toBe(true);
    const card = cardOf(ack);
    expect(card.estado).toBe("arbitrada");
    expect(card.complexidade).toBe("milagre");
    expect(card.excede_maxima).toBe(true);
  });

  it("arbitrar dentro da complexidadeMaxima(mente) grava excede_maxima=false", async () => {
    // mente=6 -> complexidadeMaxima = "milagre" (max). Arbitrando "regular"
    // is well within the ceiling.
    const actorId = createOrador(h, "player-1", { mente: 6 });
    const proporAck = await propor(h, playerCtx("player-1"), actorId);
    const messageId = messageIdOf(proporAck);

    const arbitrar = buildConjuracaoArbitrarHandler(h.deps);
    const ack = (await arbitrar({ messageId, complexidade: "regular" }, GM_CTX)) as Ack<{
      message: ChatMessage;
    }>;
    expect(ack.ok).toBe(true);
    const card = cardOf(ack);
    expect(card.excede_maxima).toBe(false);
  });
});
