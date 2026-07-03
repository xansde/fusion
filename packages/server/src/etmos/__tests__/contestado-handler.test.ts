/**
 * Etmos Teste Contestado — server handler tests (REQ-ETM-021, CA-6).
 *
 * Mirrors conjuracao-handlers.test.ts's harness (real DocumentStore + SQLite,
 * mock socket.io Namespace). Determinism is achieved via `1d1 + N` formulas
 * (a 1-sided die always rolls exactly 1 — mirrors chat-roll.test.ts's pattern)
 * rather than trying to control the underlying dice-library's raw->pip
 * mapping, so each side's total is exactly `1 + N`.
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
import { buildContestadoHandler, type ContestadoHandlerDeps } from "../contestado-handler.js";
import type { HandlerContext } from "../../net/handler-registry.js";
import type { Ack, Envelope, ChatMessage } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Test harness (mirrors conjuracao-handlers.test.ts)
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-etmos-contestado-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
        // no-op — ns-wide broadcast log above already captures every emit.
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
  deps: ContestadoHandlerDeps;
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
  ns.addSocket("gm-socket", UserRole.GAMEMASTER);
  ns.addSocket("player-socket", UserRole.PLAYER);

  const deps: ContestadoHandlerDeps = {
    store,
    db: fusionDb.raw,
    ns: ns as unknown as ContestadoHandlerDeps["ns"],
    seqStore,
    opBuffer,
    worldId: "unit-world",
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

/** Create an Actor (orador subtype) owned by ownerId, or an ownerless NPC when ownerId is null. */
function createActor(h: Harness, name: string, ownerId: string | null): string {
  const ownership: Record<string, number> = ownerId ? { default: 0, [ownerId]: 3 } : { default: 0 };
  const actor = h.store.create(
    "actors",
    {
      name,
      type: "orador",
      ownership,
      system: {
        atributos: {
          corpo: { value: 3, max: 6 },
          alma: { value: 3, max: 6 },
          mente: { value: 3, max: 6 },
        },
      },
    },
    { userId: GM_CTX.userId },
  );
  return actor["_id"] as string;
}

/** Deterministic formula: 1d1 always rolls 1, so total = 1 + n. */
function detFormula(n: number): string {
  return `1d1 + ${String(n)}`;
}

async function contestado(
  h: Harness,
  ctx: HandlerContext,
  payload: unknown,
): Promise<
  Ack<{
    message: ChatMessage;
    resultado: { vencedor: string | null; motivo: string; margem: number };
    totalA: number;
    totalB: number;
  }>
> {
  const handler = buildContestadoHandler(h.deps);
  return (await handler(payload, ctx)) as Ack<{
    message: ChatMessage;
    resultado: { vencedor: string | null; motivo: string; margem: number };
    totalA: number;
    totalB: number;
  }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("etmos:teste:contestado (REQ-ETM-021, CA-6)", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    teardown(h);
  });

  it("vitória clara: higher total wins", async () => {
    const pcId = createActor(h, "Herói", "player-1");
    const npcId = createActor(h, "Vilão", null);

    const ack = await contestado(h, playerCtx("player-1"), {
      a: { actorId: pcId, formula: detFormula(9), provocador: false },
      b: { actorId: npcId, formula: detFormula(4), provocador: false },
    });

    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error("ack not ok");
    expect(ack.result.totalA).toBe(10);
    expect(ack.result.totalB).toBe(5);
    expect(ack.result.resultado.vencedor).toBe("a");
    expect(ack.result.resultado.motivo).toBe("maiorTotal");

    // A public ChatMessage documents the outcome (broadcast via per-socket
    // emit, mirroring conjuracao-handlers.ts's broadcastChatMessage — the
    // MockNamespace's `broadcasts` log only captures ns-wide `emit`, not the
    // per-socket path, so we assert on the persisted/returned message itself).
    expect(ack.result.message.content).toContain("Herói");
    expect(ack.result.message.content).toContain("Vilão");
    expect(ack.result.message.flags["etmos"]?.["contestado"]).toBeDefined();
  });

  it("empate com provocador: tied total, provocador side wins", async () => {
    const pcId = createActor(h, "Herói", "player-1");
    const npcId = createActor(h, "Vilão", null);

    const ack = await contestado(h, GM_CTX, {
      // Both a and b are PCs/NPCs irrelevant here — tie is broken by provocador.
      a: { actorId: npcId, formula: detFormula(6), provocador: true },
      b: { actorId: pcId, formula: detFormula(6), provocador: false },
    });

    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error("ack not ok");
    expect(ack.result.totalA).toBe(ack.result.totalB);
    expect(ack.result.resultado.vencedor).toBe("a");
    expect(ack.result.resultado.motivo).toBe("provocadorVenceEmpate");
  });

  it("CA-6: empate PC vs NPC — PC vence quando nenhum provocou", async () => {
    const pcId = createActor(h, "Herói", "player-1");
    const npcId = createActor(h, "Vilão", null);

    const ack = await contestado(h, GM_CTX, {
      a: { actorId: npcId, formula: detFormula(7), provocador: false },
      b: { actorId: pcId, formula: detFormula(7), provocador: false },
    });

    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error("ack not ok");
    expect(ack.result.totalA).toBe(ack.result.totalB);
    // b is the PC (player-1 owns npcId=false for a, pcId=true for b) -> b wins.
    expect(ack.result.resultado.vencedor).toBe("b");
    expect(ack.result.resultado.motivo).toBe("pcVenceEmpateContraNpc");
  });

  it("empate total sem vencedor mecânico quando ambos são NPCs (ou ambos PCs)", async () => {
    const npcA = createActor(h, "Monstro A", null);
    const npcB = createActor(h, "Monstro B", null);

    const ack = await contestado(h, GM_CTX, {
      a: { actorId: npcA, formula: detFormula(5), provocador: false },
      b: { actorId: npcB, formula: detFormula(5), provocador: false },
    });

    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error("ack not ok");
    expect(ack.result.resultado.vencedor).toBeNull();
    expect(ack.result.resultado.motivo).toBe("empate");
  });

  it("rejects an invalid payload", async () => {
    const ack = await contestado(h, GM_CTX, { a: { formula: "" } });
    expect(ack.ok).toBe(false);
  });
});
