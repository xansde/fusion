/**
 * chat-skill-degree.test.ts — the SERVER decides the degree of a skill check
 * rolled against another creature's DC (BHR-F6-01, importing GUE-F5-05;
 * REQ-BHR-201, REQ-ACH-070/071).
 *
 * A roll carrying `flags.checkContext = { kind: "skill", targetTokenId, against }`
 * is graded against the DC the server reads from the target's database row:
 * `system.derived.saves.<n>.dc` / `perception.dc` (or `10 + <authored mod>` for a
 * bestiary NPC never derived). The PF2e rule is written in each test:
 * total >= DC + 10 is a critical success, total >= DC a success, total <= DC - 10
 * a critical failure, anything else a failure; a natural 20 moves the degree one
 * step up and a natural 1 one step down. A DC sent on the wire is never used.
 *
 * The d20 is pinned through the RollService `rng` so every case is exact.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { SeqStore } from "../net/seq-store.js";
import { buildChatSendHandler } from "../chat/chat-handler.js";
import type { HandlerContext } from "../net/handler-registry.js";
import type { Ack, ChatMessage } from "@fusion/shared";
import type { MapCounter } from "../combat/map-counter.js";

const WORLD_ID = "skill-degree-world";
const GM_ID = "user000000000001";
const PLAYER_ID = "user000000000002";

const FORT_DC = 22;
const REFLEX_DC = 18;
const WILL_DC = 15;
const PERCEPTION_DC = 20;
const AC = 25;
const AUTHORED_FORT_VALUE = 12; // authored NPC: DC = 10 + 12 = 22
const AUTHORED_PERCEPTION_MOD = 9; // DC = 19

const ACTOR_ID = "ogreBrute000001a";
const TOKEN_ID = "ogreToken00000a1";
const BESTIARY_ACTOR_ID = "bestiaryNpc0001a";
const BESTIARY_TOKEN_ID = "bestiaryTok0001a";
const NO_DC_ACTOR_ID = "bareNpc00000001";
const NO_DC_TOKEN_ID = "bareToken000001a";
const HIDDEN_TOKEN_ID = "cloakToken00001a";
const HIDDEN_ACTOR_ID = "assassinNpc0001a";
const SCENE_ID = "targetScene00001";

const GM_CTX: HandlerContext = { userId: GM_ID, role: 4, worldId: WORLD_ID };
const PLAYER_CTX: HandlerContext = { userId: PLAYER_ID, role: 1, worldId: WORLD_ID };

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

function seed(db: Db): void {
  const now = Date.now();
  const insertUser = db.prepare(
    `INSERT INTO users (id, data, name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  insertUser.run(GM_ID, JSON.stringify({ _id: GM_ID, name: "GM", role: 4 }), "GM", 4, now, now);
  insertUser.run(
    PLAYER_ID,
    JSON.stringify({ _id: PLAYER_ID, name: "P1", role: 1 }),
    "P1",
    1,
    now,
    now,
  );
  const insertActor = db.prepare(
    `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, 'npc', 0, ?, ?)`,
  );
  const derived = {
    ac: { total: AC },
    saves: {
      fortitude: { total: FORT_DC - 10, dc: FORT_DC },
      reflex: { total: REFLEX_DC - 10, dc: REFLEX_DC },
      will: { total: WILL_DC - 10, dc: WILL_DC },
    },
    perception: { total: PERCEPTION_DC - 10, dc: PERCEPTION_DC },
  };
  const docs: [string, string, Record<string, unknown>][] = [
    [ACTOR_ID, "Ogro", { derived }],
    [HIDDEN_ACTOR_ID, "Assassino", { derived }],
    [
      BESTIARY_ACTOR_ID,
      "Lobo",
      {
        saves: {
          fortitude: { value: AUTHORED_FORT_VALUE },
          reflex: { value: 5 },
          will: { value: 3 },
        },
        perception: { mod: AUTHORED_PERCEPTION_MOD },
      },
    ],
    [NO_DC_ACTOR_ID, "Vazio", { derived: { ac: { total: AC } } }],
  ];
  for (const [id, name, system] of docs) {
    insertActor.run(id, JSON.stringify({ _id: id, name, type: "npc", system }), name, now, now);
  }
  const scene = {
    _id: SCENE_ID,
    name: "Clareira",
    active: true,
    tokens: [
      { _id: TOKEN_ID, name: "Ogro Batedor", actorId: ACTOR_ID, hidden: false },
      { _id: BESTIARY_TOKEN_ID, name: "Lobo Cinzento", actorId: BESTIARY_ACTOR_ID, hidden: false },
      { _id: NO_DC_TOKEN_ID, name: "Sem Defesa", actorId: NO_DC_ACTOR_ID, hidden: false },
      { _id: HIDDEN_TOKEN_ID, name: "Espreitador", actorId: HIDDEN_ACTOR_ID, hidden: true },
    ],
  };
  db.prepare(
    `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)`,
  ).run(SCENE_ID, JSON.stringify(scene), "Clareira", now, now);
}

function fakeNs(): Namespace {
  return { sockets: new Map() } as unknown as Namespace;
}

/** A handler whose d20 always lands on `natural` (the rng picks the face). */
function makeHandler(
  natural: number,
  mapCounter?: MapCounter,
): {
  fusionDb: FusionDatabase;
  handler: ReturnType<typeof buildChatSendHandler>;
} {
  const dir = join(
    tmpdir(),
    `fusion-skilldeg-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const dbPath = join(dir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  seed(fusionDb.raw);
  const handler = buildChatSendHandler({
    db: fusionDb.raw,
    ns: fakeNs(),
    seqStore: new SeqStore(fusionDb.raw),
    worldId: WORLD_ID,
    rollServiceOptions: { rng: { next: () => natural - 1 } },
    ...(mapCounter !== undefined ? { mapCounter } : {}),
  });
  return { fusionDb, handler };
}

interface Check {
  natural: number;
  total: number;
  ctx?: HandlerContext;
  skill?: Record<string, unknown>;
  target?: Record<string, unknown> | null;
  mapCounter?: MapCounter;
}

type StrikeAck = Ack<{ message: ChatMessage }>;

/** Fires a skill check whose natural d20 is `natural` and whose total is `total`. */
function check(opts: Check): StrikeAck {
  const { handler } = makeHandler(opts.natural, opts.mapCounter);
  const mod = opts.total - opts.natural;
  const skill = opts.skill ?? { kind: "skill", targetTokenId: TOKEN_ID, against: "fortitude" };
  const target = opts.target === undefined ? { tokenId: TOKEN_ID } : opts.target;
  return handler(
    {
      content: `/r 1d20${mod >= 0 ? "+" : ""}${String(mod)} # Atletismo`,
      worldId: WORLD_ID,
      rollMode: "public",
      ...(target === null ? {} : { target }),
      flags: { checkContext: skill },
    },
    opts.ctx ?? GM_CTX,
  ) as StrikeAck;
}

function degreeOf(ack: StrikeAck): string | undefined {
  expect(ack.ok, JSON.stringify(ack)).toBe(true);
  return ack.result?.message.rolls?.[0]?.degreeOfSuccess;
}

function pf2eFlag(ack: StrikeAck, key: string): unknown {
  const flags = ack.result?.message.flags as Record<string, Record<string, unknown>> | undefined;
  return flags?.["pf2e"]?.[key];
}

describe("BHR-F6-01 — grau da perícia contra a CD lida do banco", () => {
  // natural 10 never shifts the degree, so these cases isolate the margin rule.
  it.each([
    [FORT_DC + 10, "criticalSuccess"],
    [FORT_DC + 9, "success"],
    [FORT_DC, "success"],
    [FORT_DC - 1, "failure"],
    [FORT_DC - 9, "failure"],
    [FORT_DC - 10, "criticalFailure"],
  ])("total %i contra Fortitude CD 22 (natural 10) -> %s", (total, expected) => {
    expect(degreeOf(check({ natural: 10, total }))).toBe(expected);
  });

  it("20 natural sobe um grau; 1 natural desce um grau", () => {
    expect(degreeOf(check({ natural: 20, total: FORT_DC - 5 }))).toBe("success");
    expect(degreeOf(check({ natural: 20, total: FORT_DC + 3 }))).toBe("criticalSuccess");
    expect(degreeOf(check({ natural: 1, total: FORT_DC + 5 }))).toBe("failure");
    expect(degreeOf(check({ natural: 1, total: FORT_DC + 12 }))).toBe("success");
  });

  it.each([
    ["fortitude", FORT_DC],
    ["reflex", REFLEX_DC],
    ["will", WILL_DC],
    ["perception", PERCEPTION_DC],
    ["ac", AC],
  ])("against %s usa a CD %i do alvo (sucesso exato, falha por 1)", (against, dc) => {
    const skill = { kind: "skill", targetTokenId: TOKEN_ID, against };
    expect(degreeOf(check({ natural: 10, total: dc, skill }))).toBe("success");
    expect(degreeOf(check({ natural: 10, total: dc - 1, skill }))).toBe("failure");
  });

  it("Derrubar (Reflexos CD 18): total 20 e sucesso; total 8 e falha critica", () => {
    const skill = { kind: "skill", targetTokenId: TOKEN_ID, against: "reflex", maneuver: "trip" };
    expect(degreeOf(check({ natural: 10, total: 20, skill }))).toBe("success");
    expect(degreeOf(check({ natural: 10, total: 8, skill }))).toBe("criticalFailure");
  });

  it("a CD forjada no payload e ignorada: o servidor usa a do banco", () => {
    // Total 15 vs the real Fortitude DC 22 is a failure; a forged DC 1 would be a crit.
    const ack = check({
      natural: 10,
      total: 15,
      skill: { kind: "skill", targetTokenId: TOKEN_ID, against: "fortitude", dc: 1, dcValue: 1 },
      target: { tokenId: TOKEN_ID, ac: 1, name: "Alvo Falso" },
    });
    expect(degreeOf(ack)).toBe("failure");
    expect(ack.result!.message.rolls?.[0]?.target?.name).toBe("Ogro Batedor");
  });

  it("o retrato do alvo nao carrega a CD de salvaguarda como se fosse CA", () => {
    const ack = check({ natural: 10, total: FORT_DC });
    expect(ack.result!.message.rolls?.[0]?.target).toEqual({ name: "Ogro Batedor" });
  });

  it("NPC de bestiario sem derivacao: CD = 10 + valor autorado", () => {
    const fort = { kind: "skill", targetTokenId: BESTIARY_TOKEN_ID, against: "fortitude" };
    const per = { kind: "skill", targetTokenId: BESTIARY_TOKEN_ID, against: "perception" };
    const base = { natural: 10, target: { tokenId: BESTIARY_TOKEN_ID } };
    expect(degreeOf(check({ ...base, total: 10 + AUTHORED_FORT_VALUE, skill: fort }))).toBe(
      "success",
    );
    expect(degreeOf(check({ ...base, total: 9 + AUTHORED_FORT_VALUE, skill: fort }))).toBe(
      "failure",
    );
    expect(degreeOf(check({ ...base, total: 10 + AUTHORED_PERCEPTION_MOD, skill: per }))).toBe(
      "success",
    );
  });

  it("alvo sem a defesa pedida: so o total, sem grau e sem contexto gravado", () => {
    const ack = check({
      natural: 10,
      total: 40,
      target: { tokenId: NO_DC_TOKEN_ID },
      skill: { kind: "skill", targetTokenId: NO_DC_TOKEN_ID, against: "reflex" },
    });
    expect(degreeOf(ack)).toBeUndefined();
    expect(ack.result!.message.rolls?.[0]?.target).toBeUndefined();
    expect(pf2eFlag(ack, "checkContext")).toBeUndefined();
  });

  it("sem payload.target, o targetTokenId do contexto resolve o alvo", () => {
    const ack = check({ natural: 10, total: FORT_DC, target: null });
    expect(degreeOf(ack)).toBe("success");
    expect(ack.result!.message.rolls?.[0]?.target?.name).toBe("Ogro Batedor");
  });

  it("REQ-ACH-071: alvo e contexto que discordam nao viram grau", () => {
    const ack = check({
      natural: 10,
      total: 40,
      target: { tokenId: TOKEN_ID },
      skill: { kind: "skill", targetTokenId: HIDDEN_TOKEN_ID, against: "fortitude" },
    });
    expect(degreeOf(ack)).toBeUndefined();
    expect(pf2eFlag(ack, "checkContext")).toBeUndefined();
  });

  it("REQ-ACH-071: token inexistente nao vira grau", () => {
    const ack = check({
      natural: 10,
      total: 40,
      target: { tokenId: "noSuchToken00001" },
      skill: { kind: "skill", targetTokenId: "noSuchToken00001", against: "fortitude" },
    });
    expect(degreeOf(ack)).toBeUndefined();
    expect(ack.result!.message.rolls?.[0]?.target).toBeUndefined();
  });

  it("alvo oculto para quem rolou nao resolve: sem grau, sem nome", () => {
    const ack = check({
      natural: 10,
      total: 40,
      ctx: PLAYER_CTX,
      target: { tokenId: HIDDEN_TOKEN_ID },
      skill: { kind: "skill", targetTokenId: HIDDEN_TOKEN_ID, against: "fortitude" },
    });
    expect(degreeOf(ack)).toBeUndefined();
    expect(JSON.stringify(ack.result!.message)).not.toContain("Espreitador");
  });

  it("o Mestre mira o token oculto normalmente", () => {
    const ack = check({
      natural: 10,
      total: FORT_DC,
      target: { tokenId: HIDDEN_TOKEN_ID },
      skill: { kind: "skill", targetTokenId: HIDDEN_TOKEN_ID, against: "fortitude" },
    });
    expect(degreeOf(ack)).toBe("success");
  });

  it("o jogador recebe o grau mas nunca a CD do alvo", () => {
    const ack = check({ natural: 10, total: FORT_DC, ctx: PLAYER_CTX });
    expect(degreeOf(ack)).toBe("success");
    const json = JSON.stringify(ack.result!.message);
    expect(json).not.toContain('"ac"');
    expect(json).not.toContain('"dc"');
  });

  it("grava so o que o card precisa (against, maneuver), sem alvo nem CD", () => {
    const ack = check({
      natural: 10,
      total: REFLEX_DC,
      skill: { kind: "skill", targetTokenId: TOKEN_ID, against: "reflex", maneuver: "trip" },
    });
    expect(pf2eFlag(ack, "checkContext")).toEqual({
      kind: "skill",
      against: "reflex",
      maneuver: "trip",
    });
  });

  it("contexto malformado (against desconhecido) rejeita o envio inteiro", () => {
    const ack = check({
      natural: 10,
      total: 20,
      skill: { kind: "skill", targetTokenId: TOKEN_ID, against: "charisma" },
    });
    expect(ack.ok).toBe(false);
  });

  function spyCounter(calls: unknown[]): MapCounter {
    return {
      noteAttackFromSpeaker: (...args: unknown[]) => {
        calls.push(args);
        return 1;
      },
    } as unknown as MapCounter;
  }

  it("manobra conta no MAP; Rememorar Conhecimento (sem manobra) nao conta", () => {
    const calls: unknown[] = [];
    const mapCounter = spyCounter(calls);
    const grapple = {
      kind: "skill",
      targetTokenId: TOKEN_ID,
      against: "fortitude",
      maneuver: "grapple",
    };
    degreeOf(check({ natural: 10, total: 25, skill: grapple, mapCounter }));
    expect(calls).toHaveLength(1);
    degreeOf(check({ natural: 10, total: 25, mapCounter }));
    expect(calls).toHaveLength(1);
  });

  it("sem alvo resolvivel, uma manobra nao conta no MAP", () => {
    const calls: unknown[] = [];
    check({
      natural: 10,
      total: 25,
      target: { tokenId: "noSuchToken00001" },
      skill: {
        kind: "skill",
        targetTokenId: "noSuchToken00001",
        against: "fortitude",
        maneuver: "trip",
      },
      mapCounter: spyCounter(calls),
    });
    expect(calls).toHaveLength(0);
  });

  it("o contexto de ataque continua graduando pela CA (sem regressao)", () => {
    const ack = check({
      natural: 10,
      total: AC,
      skill: { kind: "attack", targetTokenId: TOKEN_ID, mapIndex: 0 },
    });
    expect(degreeOf(ack)).toBe("success");
  });
});
