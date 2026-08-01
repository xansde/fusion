/**
 * chat-abilitycard-flag.test.ts — server validation of the generalized ability
 * card flag (r20-X1).
 *
 * The interactive ability card rides on chat:send as `flags.pf2e.abilityCard`.
 * The server MUST:
 *   - attach a well-formed card (spell / impulse / strike) to the message;
 *   - reject a forged card whose casterActorId != the speaker actor;
 *   - drop a spell DC that matches no derived SPELLCASTING DC;
 *   - drop an impulse DC that matches no derived CLASS DC;
 *   - keep a coherent DC of the right kind, and never require a DC on strikes.
 *
 * Tested against the real buildChatSendHandler with a real temp SQLite DB and a
 * fake namespace (empty sockets → broadcast is a no-op that still returns seq).
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

const WORLD_ID = "ability-world";
const CASTER_ID = "caster0000000001";
const USER_ID = "user000000000001";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-ability-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function seedCaster(db: Db, spellDc: number, classDc: number): void {
  const now = Date.now();
  const doc = {
    _id: CASTER_ID,
    name: "Finn",
    type: "character",
    system: {
      derived: {
        spellcasting: { "entry-arcane": { dc: spellDc, attack: 9 } },
        classDC: { dc: classDc },
      },
    },
  };
  db.prepare(
    `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(CASTER_ID, JSON.stringify(doc), "Finn", "character", now, now);
  db.prepare(
    `INSERT INTO users (id, data, name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(USER_ID, JSON.stringify({ _id: USER_ID, name: "GM", role: 4 }), "GM", 4, now, now);
}

function fakeNs(): Namespace {
  return { sockets: new Map() } as unknown as Namespace;
}

interface Harness {
  handler: ReturnType<typeof buildChatSendHandler>;
}

function makeHarness(spellDc = 19, classDc = 21): Harness {
  const dir = makeTempDir();
  const dbPath = join(dir, "world.db");
  const fusionDb: FusionDatabase = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  seedCaster(fusionDb.raw, spellDc, classDc);
  const seqStore = new SeqStore(fusionDb.raw);
  const handler = buildChatSendHandler({
    db: fusionDb.raw,
    ns: fakeNs(),
    seqStore,
    worldId: WORLD_ID,
  });
  return { handler };
}

const CTX: HandlerContext = { userId: USER_ID, role: 4, worldId: WORLD_ID };

function send(
  handler: Harness["handler"],
  abilityCard: Record<string, unknown>,
  speakerActorId: string = CASTER_ID,
): ChatMessage | null {
  const ack = handler(
    {
      content: "usa habilidade",
      worldId: WORLD_ID,
      rollMode: "public",
      speakerActorId,
      flags: { pf2e: { abilityCard } },
    },
    CTX,
  ) as Ack<{ message: ChatMessage }>;
  if (!ack.ok) return null;
  return ack.result?.message ?? null;
}

function readCard(msg: ChatMessage | null): Record<string, unknown> | undefined {
  return (msg?.flags as Record<string, Record<string, unknown>>)["pf2e"]?.["abilityCard"] as
    | Record<string, unknown>
    | undefined;
}

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

describe("chat:send abilityCard flag (r20-X1)", () => {
  it("attaches a well-formed spell card", () => {
    const { handler } = makeHarness(19, 21);
    const card = readCard(
      send(handler, {
        kind: "spell",
        casterActorId: CASTER_ID,
        name: "Arco Elétrico",
        rank: 2,
        dcValue: 19,
        saveType: "reflex",
        basicSave: true,
        damageFormula: "3d4",
        damageType: "electricity",
      }),
    );
    expect(card).toBeDefined();
    expect(card!["kind"]).toBe("spell");
    expect(card!["dcValue"]).toBe(19);
    expect(card!["damageFormula"]).toBe("3d4");
  });

  it("attaches a well-formed impulse card (class DC)", () => {
    const { handler } = makeHarness(19, 21);
    const card = readCard(
      send(handler, {
        kind: "impulse",
        casterActorId: CASTER_ID,
        name: "Quatro Ventos",
        dcValue: 21,
        saveType: "reflex",
        basicSave: true,
      }),
    );
    expect(card).toBeDefined();
    expect(card!["kind"]).toBe("impulse");
    expect(card!["dcValue"]).toBe(21);
  });

  it("attaches a strike card unchanged (no DC required)", () => {
    const { handler } = makeHarness();
    const card = readCard(
      send(handler, {
        kind: "strike",
        casterActorId: CASTER_ID,
        name: "Funda",
        damageFormula: "1d6+2",
        critDamageFormula: "(1d6+2)*2",
        damageType: "bludgeoning",
      }),
    );
    expect(card).toBeDefined();
    expect(card!["kind"]).toBe("strike");
    expect(card!["critDamageFormula"]).toBe("(1d6+2)*2");
    expect(card!["dcValue"]).toBeUndefined();
  });

  it("rejects a forged card whose caster != speaker (clears the flag)", () => {
    const { handler } = makeHarness();
    const msg = send(handler, {
      kind: "strike",
      casterActorId: "someoneelse00001",
      name: "Funda",
      damageFormula: "1d6",
    });
    expect(msg).not.toBeNull();
    expect(readCard(msg)).toBeUndefined();
  });

  it("drops an incoherent SPELL DC (must match a derived spellcasting DC)", () => {
    const { handler } = makeHarness(19, 21);
    // Client sends 30; real spell DC is 19.
    const card = readCard(
      send(handler, {
        kind: "spell",
        casterActorId: CASTER_ID,
        name: "Arco Elétrico",
        rank: 2,
        dcValue: 30,
        saveType: "reflex",
      }),
    );
    expect(card).toBeDefined();
    expect(card!["dcValue"]).toBeUndefined();
    expect(card!["saveType"]).toBe("reflex");
  });

  it("drops an incoherent IMPULSE DC (must match a derived class DC)", () => {
    const { handler } = makeHarness(19, 21);
    // Client sends the SPELL DC (19), but an impulse must match the CLASS DC (21).
    const card = readCard(
      send(handler, {
        kind: "impulse",
        casterActorId: CASTER_ID,
        name: "Quatro Ventos",
        dcValue: 19,
        saveType: "reflex",
      }),
    );
    expect(card).toBeDefined();
    expect(card!["dcValue"]).toBeUndefined();
    expect(card!["saveType"]).toBe("reflex");
  });

  it("keeps a coherent impulse DC that matches the derived class DC", () => {
    const { handler } = makeHarness(19, 24);
    const card = readCard(
      send(handler, {
        kind: "impulse",
        casterActorId: CASTER_ID,
        name: "Quatro Ventos",
        dcValue: 24,
        saveType: "reflex",
      }),
    );
    expect(card!["dcValue"]).toBe(24);
  });

  it("rejects the whole chat:send when the card shape is malformed (Zod)", () => {
    const { handler } = makeHarness();
    const ack = handler(
      {
        content: "x",
        worldId: WORLD_ID,
        speakerActorId: CASTER_ID,
        flags: { pf2e: { abilityCard: { kind: "strike" } } },
      },
      CTX,
    ) as Ack<unknown>;
    expect(ack.ok).toBe(false);
  });
});
