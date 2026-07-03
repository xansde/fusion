/**
 * Etmos Marcos de Crescimento + Tabela E — server handler tests
 * (REQ-ETM-035..039, CA-11).
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
  buildProgressaoConfirmarHandler,
  type ProgressaoHandlerDeps,
} from "../progressao-handler.js";
import type { HandlerContext } from "../../net/handler-registry.js";
import type { Ack, Envelope } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-etmos-progressao-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  deps: ProgressaoHandlerDeps;
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

  const deps: ProgressaoHandlerDeps = {
    store,
    ns: ns as unknown as ProgressaoHandlerDeps["ns"],
    seqStore,
    opBuffer,
    worldId: "unit-world",
  };

  return { dataDir, fusionDb, store, deps };
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

function createOradorAtNivel(h: Harness, ownerId: string, nivel: number, trilhaValue = 5): string {
  const ownership: Record<string, number> = { default: 0, [ownerId]: 3 };
  const trilha = { value: trilhaValue, max: 5 };
  const actor = h.store.create(
    "actors",
    {
      name: "Test Orador",
      type: "orador",
      ownership,
      system: {
        nivel,
        atributos: {
          corpo: { value: 3, max: 6 },
          alma: { value: 3, max: 6 },
          mente: { value: 3, max: 6 },
        },
        marcos_crescimento: { fisicos: trilha, mentais: trilha, emocionais: trilha },
      },
      items: [],
    },
    { userId: GM_CTX.userId },
  );
  return actor["_id"] as string;
}

function createHabilidadeItem(h: Harness, nome: string): string {
  const item = h.store.create(
    "items",
    { name: nome, type: "habilidade", system: { categoria: "pratica", bonus: 0 } },
    { userId: GM_CTX.userId },
  );
  return item["_id"] as string;
}

async function confirmar(
  h: Harness,
  ctx: HandlerContext,
  payload: unknown,
): Promise<Ack<{ actor: Record<string, unknown>; novoNivel: number }>> {
  const handler = buildProgressaoConfirmarHandler(h.deps);
  return (await handler(payload, ctx)) as Ack<{
    actor: Record<string, unknown>;
    novoNivel: number;
  }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("etmos:progressao:confirmar (REQ-ETM-035..039, CA-11)", () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  afterEach(() => {
    teardown(h);
  });

  it("CA-11: caso completo de subida — increments nivel, resets trilhas, applies bônus", async () => {
    const actorId = createOradorAtNivel(h, "player-1", 1, 5);
    const habilidadeId = createHabilidadeItem(h, "Enganar");

    const ack = await confirmar(h, playerCtx("player-1"), {
      actorId,
      fisica: { tipo: "items", itemIds: [habilidadeId] },
      mental: { tipo: "atributo", atributo: "corpo" },
      emocional: { tipo: "items", itemIds: [habilidadeId] },
    });

    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error("ack not ok");
    expect(ack.result.novoNivel).toBe(2);

    const sys = ack.result.actor["system"] as Record<string, unknown>;
    expect(sys["nivel"]).toBe(2);
    expect(sys["marcos_crescimento"]).toEqual({
      fisicos: { value: 0, max: 5 },
      mentais: { value: 0, max: 5 },
      emocionais: { value: 0, max: 5 },
    });
    const atributos = sys["atributos"] as Record<string, unknown>;
    expect((atributos["corpo"] as Record<string, unknown>)["value"]).toBe(4); // 3 -> 4

    const items = ack.result.actor["items"] as Record<string, unknown>[];
    expect(items.length).toBe(2); // embedded twice (fisica + emocional both picked it)
  });

  it("rejects when trilhas are not all completas (5/5/5)", async () => {
    const actorId = createOradorAtNivel(h, "player-1", 1, 4); // only 4/5
    const ack = await confirmar(h, GM_CTX, {
      actorId,
      fisica: { tipo: "atributo", atributo: "corpo" },
      mental: { tipo: "atributo", atributo: "alma" },
      emocional: { tipo: "atributo", atributo: "mente" },
    });
    expect(ack.ok).toBe(false);
  });

  it("rejects at nivel 6 (max)", async () => {
    const actorId = createOradorAtNivel(h, "player-1", 6, 5);
    const ack = await confirmar(h, GM_CTX, {
      actorId,
      fisica: { tipo: "atributo", atributo: "corpo" },
      mental: { tipo: "atributo", atributo: "alma" },
      emocional: { tipo: "atributo", atributo: "mente" },
    });
    expect(ack.ok).toBe(false);
  });

  it("CA-11: rejeição de opção repetida — a second confirm right after a successful one is rejected (trilhas reset)", async () => {
    const actorId = createOradorAtNivel(h, "player-1", 1, 5);
    const habilidadeId = createHabilidadeItem(h, "Enganar");
    // Nivel 1->2 Tabela E: fisica/emocional grant Items, mental grants Atributo
    // (see systems/etmos/src/compositor/progressao.ts) — the payload must
    // match that shape or the anti-forge check (FIX 1) rejects it upfront.
    const payload = {
      actorId,
      fisica: { tipo: "items", itemIds: [habilidadeId] },
      mental: { tipo: "atributo", atributo: "alma" },
      emocional: { tipo: "items", itemIds: [habilidadeId] },
    };

    const first = await confirmar(h, GM_CTX, payload);
    expect(first.ok).toBe(true);

    // Immediately confirming AGAIN (as if a duplicate/replayed op) must be
    // rejected — the trilhas were just reset to 0/5, so they are no longer
    // completas, and the same categoria bônus cannot be granted twice.
    const second = await confirmar(h, GM_CTX, payload);
    expect(second.ok).toBe(false);
  });

  it("rejects an invalid Item id for a items-type bônus", async () => {
    const actorId = createOradorAtNivel(h, "player-1", 1, 5);
    const habilidadeId = createHabilidadeItem(h, "Enganar");
    // fisica/emocional must be "items" at nivel 1->2 (Tabela E) to pass the
    // anti-forge check (FIX 1) and actually reach the Item-resolution code
    // this test exercises.
    const ack = await confirmar(h, GM_CTX, {
      actorId,
      fisica: { tipo: "items", itemIds: ["does-not-exist"] },
      mental: { tipo: "atributo", atributo: "alma" },
      emocional: { tipo: "items", itemIds: [habilidadeId] },
    });
    expect(ack.ok).toBe(false);
  });

  it("M5-E audit FIX 1 (anti-forge): rejects a payload where a categoria's tipo diverges from Tabela E's opção for the current transição", async () => {
    const actorId = createOradorAtNivel(h, "player-1", 1, 5);
    // Nivel 1->2 Tabela E: fisica/emocional grant Items, never Atributo — a
    // payload claiming {tipo:"atributo"} for fisica (as if the owner forged
    // all 3 categorias to Atributo, netting +3 Atributo instead of the +1
    // Tabela E actually grants for "mental" alone) must be rejected.
    const ack = await confirmar(h, GM_CTX, {
      actorId,
      fisica: { tipo: "atributo", atributo: "corpo" },
      mental: { tipo: "atributo", atributo: "alma" },
      emocional: { tipo: "atributo", atributo: "mente" },
    });
    expect(ack.ok).toBe(false);
    if (ack.ok) throw new Error("ack should not be ok");
    expect(ack.code).toBe("VALIDATION_FAILED");

    // The forged confirm must not have mutated the Actor's atributos at all.
    const afterAttempt = h.store.get("actors", actorId);
    const sys = afterAttempt["system"] as Record<string, unknown>;
    const atributos = sys["atributos"] as Record<string, Record<string, unknown>>;
    expect(atributos["corpo"]!["value"]).toBe(3);
    expect(atributos["alma"]!["value"]).toBe(3);
    expect(atributos["mente"]!["value"]).toBe(3);
    expect(sys["nivel"]).toBe(1);
  });

  it("rejects a non-owner, non-GM player", async () => {
    const actorId = createOradorAtNivel(h, "player-1", 1, 5);
    const ack = await confirmar(h, playerCtx("player-2"), {
      actorId,
      fisica: { tipo: "atributo", atributo: "corpo" },
      mental: { tipo: "atributo", atributo: "alma" },
      emocional: { tipo: "atributo", atributo: "mente" },
    });
    expect(ack.ok).toBe(false);
  });

  it("clamps an Atributo bônus at 6 (D2 max)", async () => {
    const ownership: Record<string, number> = { default: 0, "player-1": 3 };
    const trilha = { value: 5, max: 5 };
    const actor = h.store.create(
      "actors",
      {
        name: "Maxed Orador",
        type: "orador",
        ownership,
        system: {
          nivel: 1,
          atributos: {
            corpo: { value: 3, max: 6 },
            alma: { value: 6, max: 6 },
            mente: { value: 3, max: 6 },
          },
          marcos_crescimento: { fisicos: trilha, mentais: trilha, emocionais: trilha },
        },
        items: [],
      },
      { userId: GM_CTX.userId },
    );
    const actorId = actor["_id"] as string;
    const habilidadeId = createHabilidadeItem(h, "Enganar");

    // Nivel 1->2 Tabela E: only "mental" grants an Atributo point — pick
    // "alma" (already at the max 6) to exercise the clamp; fisica/emocional
    // must be the Items shape the anti-forge check (FIX 1) requires.
    const ack = await confirmar(h, GM_CTX, {
      actorId,
      fisica: { tipo: "items", itemIds: [habilidadeId] },
      mental: { tipo: "atributo", atributo: "alma" },
      emocional: { tipo: "items", itemIds: [habilidadeId] },
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error("ack not ok");
    const sys = ack.result.actor["system"] as Record<string, unknown>;
    const atributos = sys["atributos"] as Record<string, unknown>;
    expect((atributos["alma"] as Record<string, unknown>)["value"]).toBe(6); // clamped, not 7
  });
});
