/**
 * chat-attack-degree.test.ts — the SERVER decides the degree of a strike
 * (BHR-F3-03, importing GUE-F1-03 / D-G02; REQ-BHR-083, REQ-ACH-070/071).
 *
 * A roll that carries `flags.checkContext = { kind: "attack", ... }` is graded
 * against the AC the server reads from the database. The PF2e rule is written
 * in each test: total >= AC + 10 is a critical success, total >= AC a success,
 * total <= AC - 10 a critical failure, anything else a failure; a natural 20
 * moves the degree one step up and a natural 1 one step down.
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
import { buildChatSendHandler, readNaturalD20 } from "../chat/chat-handler.js";
import type { HandlerContext } from "../net/handler-registry.js";
import type { Ack, ChatMessage } from "@fusion/shared";

const WORLD_ID = "attack-degree-world";
const GM_ID = "user000000000001";
const PLAYER_ID = "user000000000002";

const TARGET_AC = 21;
const ACTOR_ID = "ogreBrute000001a";
const TOKEN_ID = "ogreToken00000a1";
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
  for (const [id, name] of [
    [ACTOR_ID, "Ogro"],
    [HIDDEN_ACTOR_ID, "Assassino"],
  ] as const) {
    insertActor.run(
      id,
      JSON.stringify({
        _id: id,
        name,
        type: "npc",
        system: { derived: { ac: { total: TARGET_AC } } },
      }),
      name,
      now,
      now,
    );
  }
  const scene = {
    _id: SCENE_ID,
    name: "Clareira",
    active: true,
    tokens: [
      { _id: TOKEN_ID, name: "Ogro Batedor", actorId: ACTOR_ID, hidden: false },
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
function makeHandler(natural: number): {
  fusionDb: FusionDatabase;
  handler: ReturnType<typeof buildChatSendHandler>;
} {
  const dir = join(
    tmpdir(),
    `fusion-attackdeg-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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
  });
  return { fusionDb, handler };
}

interface Strike {
  natural: number;
  total: number;
  ctx?: HandlerContext;
  attack?: Record<string, unknown>;
  target?: Record<string, unknown> | null;
}

type StrikeAck = Ack<{ message: ChatMessage }>;

/** Fires a strike whose natural d20 is `natural` and whose total is `total`. */
function strike(opts: Strike): StrikeAck {
  const { handler } = makeHandler(opts.natural);
  const mod = opts.total - opts.natural;
  const attack = opts.attack ?? { kind: "attack", targetTokenId: TOKEN_ID, mapIndex: 0 };
  const target = opts.target === undefined ? { tokenId: TOKEN_ID } : opts.target;
  return handler(
    {
      content: `/r 1d20${mod >= 0 ? "+" : ""}${String(mod)} # Golpe`,
      worldId: WORLD_ID,
      rollMode: "public",
      ...(target === null ? {} : { target }),
      flags: { checkContext: attack },
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

describe("BHR-F3-03 — grau do golpe contra a CA lida do banco", () => {
  // natural 10 never shifts the degree, so these cases isolate the margin rule.
  it.each([
    [TARGET_AC + 10, "criticalSuccess"],
    [TARGET_AC + 9, "success"],
    [TARGET_AC, "success"],
    [TARGET_AC - 1, "failure"],
    [TARGET_AC - 9, "failure"],
    [TARGET_AC - 10, "criticalFailure"],
  ])("total %i contra CA 21 (natural 10) -> %s", (total, expected) => {
    expect(degreeOf(strike({ natural: 10, total }))).toBe(expected);
  });

  it("20 natural sobe um grau: falha por 5 vira sucesso; sucesso vira critico", () => {
    expect(degreeOf(strike({ natural: 20, total: TARGET_AC - 5 }))).toBe("success");
    expect(degreeOf(strike({ natural: 20, total: TARGET_AC + 3 }))).toBe("criticalSuccess");
  });

  it("1 natural desce um grau: sucesso vira falha; critico vira sucesso", () => {
    expect(degreeOf(strike({ natural: 1, total: TARGET_AC + 5 }))).toBe("failure");
    expect(degreeOf(strike({ natural: 1, total: TARGET_AC + 12 }))).toBe("success");
  });

  it("sanidade: o rng fixa mesmo o d20", () => {
    const ack = strike({ natural: 14, total: 20 });
    expect(readNaturalD20(ack.result!.message.rolls![0]!.terms)).toBe(14);
  });

  it("a CA forjada no payload e ignorada: o servidor usa a do banco", () => {
    // Total 15 vs the real AC 21 is a failure; the forged AC 1 would make it a crit.
    const ack = strike({
      natural: 10,
      total: 15,
      target: { tokenId: TOKEN_ID, ac: 1, name: "Alvo Falso" },
    });
    expect(degreeOf(ack)).toBe("failure");
    const msg = ack.result!.message;
    expect(msg.rolls?.[0]?.target?.ac).toBe(TARGET_AC);
    expect(msg.rolls?.[0]?.target?.name).toBe("Ogro Batedor");
  });

  it("grava o contexto do golpe na mensagem (sem alvo, sem CA) para o card escolher o botao", () => {
    const ack = strike({
      natural: 10,
      total: TARGET_AC + 10,
      attack: { kind: "attack", targetTokenId: TOKEN_ID, mapIndex: 1, agile: true },
    });
    expect(degreeOf(ack)).toBe("criticalSuccess");
    expect(pf2eFlag(ack, "checkContext")).toEqual({ kind: "attack", mapIndex: 1, agile: true });
  });

  it("sem payload.target, o targetTokenId do contexto resolve o alvo", () => {
    const ack = strike({ natural: 10, total: TARGET_AC, target: null });
    expect(degreeOf(ack)).toBe("success");
    expect(ack.result!.message.rolls?.[0]?.target?.name).toBe("Ogro Batedor");
  });

  it("REQ-ACH-071: alvo e contexto que discordam nao viram grau", () => {
    const ack = strike({
      natural: 10,
      total: 40,
      target: { tokenId: TOKEN_ID },
      attack: { kind: "attack", targetTokenId: HIDDEN_TOKEN_ID, mapIndex: 0 },
    });
    expect(degreeOf(ack)).toBeUndefined();
    expect(pf2eFlag(ack, "checkContext")).toBeUndefined();
  });

  it("REQ-ACH-071: token inexistente nao vira grau nem grava o contexto", () => {
    const ack = strike({
      natural: 10,
      total: 40,
      target: { tokenId: "noSuchToken00001" },
      attack: { kind: "attack", targetTokenId: "noSuchToken00001", mapIndex: 0 },
    });
    expect(degreeOf(ack)).toBeUndefined();
    expect(ack.result!.message.rolls?.[0]?.target).toBeUndefined();
    expect(pf2eFlag(ack, "checkContext")).toBeUndefined();
  });

  it("alvo oculto para quem rolou nao resolve: sem grau, sem nome", () => {
    const ack = strike({
      natural: 10,
      total: 40,
      ctx: PLAYER_CTX,
      target: { tokenId: HIDDEN_TOKEN_ID },
      attack: { kind: "attack", targetTokenId: HIDDEN_TOKEN_ID, mapIndex: 0 },
    });
    expect(degreeOf(ack)).toBeUndefined();
    expect(JSON.stringify(ack.result!.message)).not.toContain("Espreitador");
  });

  it("o Mestre mira o token oculto normalmente", () => {
    const ack = strike({
      natural: 10,
      total: TARGET_AC,
      target: { tokenId: HIDDEN_TOKEN_ID },
      attack: { kind: "attack", targetTokenId: HIDDEN_TOKEN_ID, mapIndex: 0 },
    });
    expect(degreeOf(ack)).toBe("success");
  });

  it("o jogador nao recebe a CA do alvo no ack, so o grau", () => {
    const ack = strike({ natural: 10, total: TARGET_AC, ctx: PLAYER_CTX });
    expect(degreeOf(ack)).toBe("success");
    expect(JSON.stringify(ack.result!.message)).not.toContain('"ac"');
  });

  it("contexto malformado (mapIndex 3) rejeita o envio inteiro", () => {
    const ack = strike({
      natural: 10,
      total: 20,
      attack: { kind: "attack", targetTokenId: TOKEN_ID, mapIndex: 3 },
    });
    expect(ack.ok).toBe(false);
  });

  it("sem checkContext, o comportamento por payload.target segue como antes", () => {
    const { handler } = makeHandler(10);
    const ack = handler(
      {
        content: "/r 1d20+11",
        worldId: WORLD_ID,
        rollMode: "public",
        target: { tokenId: TOKEN_ID },
      },
      GM_CTX,
    ) as StrikeAck;
    expect(degreeOf(ack)).toBe("success");
    expect(pf2eFlag(ack, "checkContext")).toBeUndefined();
  });
});
