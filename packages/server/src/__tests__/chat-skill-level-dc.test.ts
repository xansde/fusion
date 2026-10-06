/**
 * chat-skill-level-dc.test.ts — Recall Knowledge about a creature is graded
 * against the creature-level DC, read by the SERVER (BHR-F3-09, spec 52 §2.9,
 * `against: "level"`; REQ-BHR-095..097).
 *
 * PF2e remaster (GM Core, "DCs by Level"): the DC of a Recall Knowledge check
 * about a creature is the standard DC for the creature's level, adjusted by its
 * rarity: uncommon +2, rare +5, unique +10. The table is written below from the
 * rule, not read from any pack. Recall Knowledge is not an attack: it never
 * counts for the MAP. The d20 is pinned through the RollService `rng`.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";

import { openDatabase, applyMigrations } from "../db/index.js";
import { SeqStore } from "../net/seq-store.js";
import { buildChatSendHandler } from "../chat/chat-handler.js";
import type { HandlerContext } from "../net/handler-registry.js";
import type { Ack, ChatMessage } from "@fusion/shared";
import type { MapCounter } from "../combat/map-counter.js";

const WORLD_ID = "level-dc-world";
const GM_CTX: HandlerContext = { userId: "user000000000001", role: 4, worldId: WORLD_ID };
const SCENE_ID = "levelScene000001";

/** GM Core "DCs by Level", level 0..25. */
const DC_BY_LEVEL = [
  14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46,
  48, 50,
];
const RARITY_ADJUST: Record<string, number> = { common: 0, uncommon: 2, rare: 5, unique: 10 };

let tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  tempDirs = [];
});

interface Creature {
  id: string;
  system: Record<string, unknown>;
}

function creatureFor(level: number, rarity: string, n: number): Creature {
  return {
    id: `lvlActor${String(n).padStart(8, "0")}`,
    system: { details: { level: { value: level } }, traits: { rarity } },
  };
}

const NO_LEVEL: Creature = { id: "lvlActorNoLevel01", system: { derived: { ac: { total: 20 } } } };

function tokenIdOf(c: Creature): string {
  return `tok${c.id.slice(-12)}`;
}

function seed(db: Db, creatures: Creature[]): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, data, name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    GM_CTX.userId,
    JSON.stringify({ _id: GM_CTX.userId, name: "GM", role: 4 }),
    "GM",
    4,
    now,
    now,
  );
  const insertActor = db.prepare(
    `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, 'npc', 0, ?, ?)`,
  );
  const tokens = creatures.map((c) => {
    insertActor.run(
      c.id,
      JSON.stringify({ _id: c.id, name: "Criatura", type: "npc", system: c.system }),
      "Criatura",
      now,
      now,
    );
    return { _id: tokenIdOf(c), name: "Alvo", actorId: c.id, hidden: false };
  });
  db.prepare(
    `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)`,
  ).run(
    SCENE_ID,
    JSON.stringify({ _id: SCENE_ID, name: "Cena", active: true, tokens }),
    "Cena",
    now,
    now,
  );
}

type RollAck = Ack<{ message: ChatMessage }>;

function setup(creature: Creature, natural: number, mapCounter?: MapCounter) {
  const dir = join(
    tmpdir(),
    `fusion-lvldc-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const dbPath = join(dir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  seed(fusionDb.raw, [creature]);
  return buildChatSendHandler({
    db: fusionDb.raw,
    ns: { sockets: new Map() } as unknown as Namespace,
    seqStore: new SeqStore(fusionDb.raw),
    worldId: WORLD_ID,
    rollServiceOptions: { rng: { next: () => natural - 1 } },
    ...(mapCounter !== undefined ? { mapCounter } : {}),
  });
}

/** Recall Knowledge: natural 10 and the given total, against the creature level DC. */
function recall(
  creature: Creature,
  total: number,
  mapCounter?: MapCounter,
  extra: Record<string, unknown> = {},
): RollAck {
  const handler = setup(creature, 10, mapCounter);
  const tokenId = tokenIdOf(creature);
  const mod = total - 10;
  return handler(
    {
      content: `/r 1d20${mod >= 0 ? "+" : ""}${String(mod)} # Natureza`,
      worldId: WORLD_ID,
      rollMode: "public",
      target: { tokenId },
      flags: {
        checkContext: { kind: "skill", targetTokenId: tokenId, against: "level", ...extra },
      },
    },
    GM_CTX,
  ) as RollAck;
}

function degreeOf(ack: RollAck): string | undefined {
  expect(ack.ok, JSON.stringify(ack)).toBe(true);
  return ack.result?.message.rolls?.[0]?.degreeOfSuccess;
}

describe("BHR-F3-09 — Rememorar Conhecimento contra a CD por nivel", () => {
  it.each(DC_BY_LEVEL.map((dc, level) => [level, dc] as const))(
    "nivel %i: CD %i (sucesso exato; falha por 1)",
    (level, dc) => {
      const c = creatureFor(level, "common", level);
      expect(degreeOf(recall(c, dc))).toBe("success");
      expect(degreeOf(recall(c, dc - 1))).toBe("failure");
    },
  );

  it.each([
    ["uncommon", 2],
    ["rare", 5],
    ["unique", 10],
  ])("raridade %s soma +%i a CD (nivel 5, CD base 20)", (rarity, bump) => {
    const dc = DC_BY_LEVEL[5]! + RARITY_ADJUST[rarity]!;
    expect(dc).toBe(20 + bump);
    const c = creatureFor(5, rarity, 100);
    expect(degreeOf(recall(c, dc))).toBe("success");
    expect(degreeOf(recall(c, dc - 1))).toBe("failure");
  });

  it("sucesso critico com +10 e falha critica com -10 sobre a CD ajustada", () => {
    const c = creatureFor(3, "rare", 101); // 18 + 5 = 23
    expect(degreeOf(recall(c, 33))).toBe("criticalSuccess");
    expect(degreeOf(recall(c, 13))).toBe("criticalFailure");
  });

  it("aceita raridade em system.traits.rarity.value (forma aninhada)", () => {
    const c: Creature = {
      id: "lvlActorNested001",
      system: { details: { level: { value: 5 } }, traits: { rarity: { value: "rare" } } },
    };
    expect(degreeOf(recall(c, 25))).toBe("success");
    expect(degreeOf(recall(c, 24))).toBe("failure");
  });

  it("sem raridade gravada, assume comum", () => {
    const c: Creature = { id: "lvlActorNoRarity1", system: { details: { level: { value: 5 } } } };
    expect(degreeOf(recall(c, 20))).toBe("success");
  });

  it("alvo sem nivel legivel: so o total, sem grau", () => {
    expect(degreeOf(recall(NO_LEVEL, 60))).toBeUndefined();
  });

  it("nivel fora da tabela (< -1 ou > 25) nao inventa CD", () => {
    expect(degreeOf(recall(creatureFor(-2, "common", 102), 60))).toBeUndefined();
    expect(degreeOf(recall(creatureFor(-1, "common", 109), 13))).toBe("success");
    expect(degreeOf(recall(creatureFor(26, "common", 103), 60))).toBeUndefined();
  });

  it("a CD forjada no payload e ignorada", () => {
    const c = creatureFor(5, "common", 104);
    expect(degreeOf(recall(c, 12, undefined, { dc: 1, dcValue: 1 }))).toBe("failure");
  });

  it("o retrato do alvo nao carrega a CD", () => {
    const ack = recall(creatureFor(5, "common", 105), 20);
    expect(ack.result!.message.rolls?.[0]?.target).toEqual({ name: "Alvo" });
  });

  it("grava against: level no contexto da mensagem", () => {
    const ack = recall(creatureFor(5, "common", 106), 20);
    const flags = ack.result?.message.flags as Record<string, Record<string, unknown>> | undefined;
    expect(flags?.["pf2e"]?.["checkContext"]).toEqual({ kind: "skill", against: "level" });
  });

  it("Rememorar Conhecimento nao conta no MAP", () => {
    const calls: unknown[] = [];
    const counter = {
      noteAttackFromSpeaker: (...args: unknown[]) => {
        calls.push(args);
        return 1;
      },
    } as unknown as MapCounter;
    degreeOf(recall(creatureFor(5, "common", 107), 20, counter));
    expect(calls).toHaveLength(0);
  });

  it("manobra com against: level e recusada (a defesa da manobra e fixa)", () => {
    const ack = recall(creatureFor(5, "common", 108), 20, undefined, { maneuver: "trip" });
    expect(ack).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });
});
