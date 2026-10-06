/**
 * chat-maneuver-size.test.ts — the SERVER refuses an Athletics maneuver against a target that is too large
 * (BHR-F6-04 review M-1; the server is authoritative, as the defence of the maneuver is, I-4 of wave 6).
 *
 * PF2e remaster, written here (Player Core, Athletics): Disarm, Grapple, Reposition, Shove and Trip "can't be more
 * than one size larger than you". Titan Wrestler: two sizes larger, three when legendary in Athletics. The sizes
 * are read from the database: the actor of the roller (`speakerActorId`, which the user must own) and the actor of
 * the target token, with the override of an unlinked token applied.
 *
 * The d20 is pinned through the RollService `rng`; the sizes and the limit feat are seeded by hand.
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

const WORLD_ID = "maneuver-size-world";
const GM_ID = "user000000000001";
const PLAYER_ID = "user000000000002";
const STRANGER_ID = "user000000000003";
const SCENE_ID = "sizeScene0000001";

const GM_CTX: HandlerContext = { userId: GM_ID, role: 4, worldId: WORLD_ID };
const PLAYER_CTX: HandlerContext = { userId: PLAYER_ID, role: 1, worldId: WORLD_ID };
const STRANGER_CTX: HandlerContext = { userId: STRANGER_ID, role: 1, worldId: WORLD_ID };

const TITAN_ITEM = {
  _id: "titanItem0000001",
  type: "feat",
  name: "Titan Wrestler",
  system: {
    rules: [
      {
        kind: "fusion-maneuver-size-limit",
        maneuvers: ["disarm", "grapple", "reposition", "shove", "trip"],
        maxSizeDelta: 2,
        legendaryMaxSizeDelta: 3,
      },
    ],
  },
};

/** A Small Leshy: `traits.size` sits at the schema default (med), the real size is `derived.size`. */
const pc = (id: string, over: { items?: unknown[]; athletics?: number; size?: string } = {}) => ({
  _id: id,
  name: id,
  type: "character",
  ownership: { default: 0, [PLAYER_ID]: 3 },
  items: over.items ?? [],
  system: {
    traits: { size: "med" },
    derived: {
      size: over.size ?? "sm",
      skills: { athletics: { rank: over.athletics ?? 1 } },
    },
  },
});

const npc = (id: string, size: string) => ({
  _id: id,
  name: id,
  type: "npc",
  system: { traits: { size: { value: size } } },
});

const PLAIN = "plainSmall00001";
const TITAN = "titanSmall00001";
const LEGEND = "legendSmall0001";
const TARGETS: Record<string, string> = {
  med: "medTarget0000001",
  lg: "lgTarget00000001",
  huge: "hugeTarget000001",
  grg: "grgTarget0000001",
};

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
  for (const [id, role] of [
    [GM_ID, 4],
    [PLAYER_ID, 1],
    [STRANGER_ID, 1],
  ] as const) {
    insertUser.run(id, JSON.stringify({ _id: id, name: id, role }), id, role, now, now);
  }
  const insertActor = db.prepare(
    `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
  );
  const actors = [
    pc(PLAIN),
    pc(TITAN, { items: [TITAN_ITEM] }),
    pc(LEGEND, { items: [TITAN_ITEM], athletics: 4 }),
    ...Object.entries(TARGETS).map(([size, id]) => npc(id, size)),
  ];
  for (const a of actors) {
    insertActor.run(a._id, JSON.stringify(a), a.name, a.type, now, now);
  }
  const tokens = [
    ...Object.entries(TARGETS).map(([size, id]) => ({
      _id: `tok-${size}`,
      name: `Alvo ${size}`,
      actorId: id,
      hidden: false,
    })),
    // The Medium NPC, but this UNLINKED token grew to Huge.
    {
      _id: "tok-grown",
      name: "Alvo crescido",
      actorId: TARGETS["med"],
      actorLink: false,
      actorDelta: { system: { traits: { size: { value: "huge" } } } },
      hidden: false,
    },
  ];
  db.prepare(
    `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)`,
  ).run(
    SCENE_ID,
    JSON.stringify({ _id: SCENE_ID, name: "Clareira", active: true, tokens }),
    "Clareira",
    now,
    now,
  );
}

type Sent = Ack<{ message: ChatMessage }>;

function roll(opts: {
  speaker?: string | undefined;
  target: string;
  maneuver: string;
  ctx?: HandlerContext;
}): Sent {
  const dir = join(
    tmpdir(),
    `fusion-mansize-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const dbPath = join(dir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  seed(fusionDb.raw);
  const handler = buildChatSendHandler({
    db: fusionDb.raw,
    ns: { sockets: new Map() } as unknown as Namespace,
    seqStore: new SeqStore(fusionDb.raw),
    worldId: WORLD_ID,
    rollServiceOptions: { rng: { next: () => 9 } },
  });
  const against =
    (
      { trip: "reflex", disarm: "reflex", feint: "perception", demoralize: "will" } as Record<
        string,
        string
      >
    )[opts.maneuver] ?? "fortitude";
  return handler(
    {
      content: "/r 1d20+5 # Atletismo",
      worldId: WORLD_ID,
      rollMode: "public",
      target: { tokenId: opts.target },
      ...(opts.speaker !== undefined ? { speakerActorId: opts.speaker } : {}),
      flags: {
        checkContext: {
          kind: "skill",
          targetTokenId: opts.target,
          against,
          maneuver: opts.maneuver,
        },
      },
    },
    opts.ctx ?? PLAYER_CTX,
  ) as Sent;
}

describe("M-1: o servidor recusa a manobra contra alvo grande demais (tamanhos lidos do banco)", () => {
  it("Pequeno sem o talento: Médio passa, Grande é recusado, nas cinco manobras limitadas", () => {
    for (const maneuver of ["disarm", "grapple", "reposition", "shove", "trip"]) {
      expect(roll({ speaker: PLAIN, target: "tok-med", maneuver }).ok).toBe(true);
      expect(roll({ speaker: PLAIN, target: "tok-lg", maneuver })).toMatchObject({
        ok: false,
        code: "VALIDATION_FAILED",
      });
    }
  });

  it("Pequeno com o Lutador de Titãs: Grande passa, Enorme é recusado (só o lendário ganha o terceiro tamanho)", () => {
    expect(roll({ speaker: TITAN, target: "tok-lg", maneuver: "trip" }).ok).toBe(true);
    expect(roll({ speaker: TITAN, target: "tok-huge", maneuver: "trip" }).ok).toBe(false);
  });

  it("lendário em Atletismo com o talento: Enorme passa, Imenso é recusado", () => {
    expect(roll({ speaker: LEGEND, target: "tok-huge", maneuver: "grapple" }).ok).toBe(true);
    expect(roll({ speaker: LEGEND, target: "tok-grg", maneuver: "grapple" }).ok).toBe(false);
  });

  it("o tamanho do alvo é o do token: um token solto que cresceu para Enorme é recusado, o ator base seria Médio", () => {
    expect(roll({ speaker: PLAIN, target: "tok-grown", maneuver: "shove" }).ok).toBe(false);
    expect(roll({ speaker: PLAIN, target: "tok-med", maneuver: "shove" }).ok).toBe(true);
  });

  it("manobra fora da regra (Aparar o olhar / Desmoralizar) não tem limite de tamanho", () => {
    expect(roll({ speaker: PLAIN, target: "tok-grg", maneuver: "feint" }).ok).toBe(true);
    expect(roll({ speaker: PLAIN, target: "tok-grg", maneuver: "demoralize" }).ok).toBe(true);
  });

  it("o Mestre rolando por um ator também é julgado pelo tamanho desse ator", () => {
    expect(roll({ speaker: PLAIN, target: "tok-lg", maneuver: "trip", ctx: GM_CTX }).ok).toBe(
      false,
    );
  });

  it("um jogador que nomeia como orador um ator que não é dele é recusado (não escolhe o tamanho que o favorece)", () => {
    expect(
      roll({ speaker: PLAIN, target: "tok-med", maneuver: "trip", ctx: STRANGER_CTX }),
    ).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });

  it("sem orador nomeado, o tamanho de quem rola é desconhecido e a regra não opina", () => {
    expect(roll({ target: "tok-lg", maneuver: "trip" }).ok).toBe(true);
  });
});
