/**
 * chat-spellcast-flag.test.ts — server validation of the spellCast card flag
 * (r17-P2).
 *
 * The interactive spell-cast card rides on chat:send as
 * `flags.pf2e.spellCast`. The server MUST:
 *   - attach a well-formed card to the resulting ChatMessage;
 *   - reject a forged card whose casterActorId != the speaker actor;
 *   - drop a DC that matches no derived spellcasting DC of the caster (never
 *     trust the client for the DC).
 *
 * Tested against the real buildChatSendHandler with a real temp SQLite DB and
 * a fake namespace (empty sockets → broadcast is a no-op that still returns a
 * seq). This keeps the test fast without a full socket E2E.
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

const WORLD_ID = "spellcast-world";
const CASTER_ID = "caster0000000001";
const USER_ID = "user000000000001";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-spellcast-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function seedCaster(db: Db, derivedDc: number): void {
  const now = Date.now();
  const doc = {
    _id: CASTER_ID,
    name: "Tobias",
    type: "character",
    system: { derived: { spellcasting: { "entry-arcane": { dc: derivedDc, attack: 9 } } } },
  };
  db.prepare(
    `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(CASTER_ID, JSON.stringify(doc), "Tobias", "character", now, now);
  db.prepare(
    `INSERT INTO users (id, data, name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(USER_ID, JSON.stringify({ _id: USER_ID, name: "GM", role: 4 }), "GM", 4, now, now);
}

/** Fake socket.io Namespace: broadcast only iterates `ns.sockets`. */
function fakeNs(): Namespace {
  return { sockets: new Map() } as unknown as Namespace;
}

interface Harness {
  fusionDb: FusionDatabase;
  handler: ReturnType<typeof buildChatSendHandler>;
}

function makeHarness(derivedDc = 19): Harness {
  const dir = makeTempDir();
  const dbPath = join(dir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  seedCaster(fusionDb.raw, derivedDc);

  const seqStore = new SeqStore(fusionDb.raw);
  const handler = buildChatSendHandler({
    db: fusionDb.raw,
    ns: fakeNs(),
    seqStore,
    worldId: WORLD_ID,
  });
  return { fusionDb, handler };
}

const CTX: HandlerContext = { userId: USER_ID, role: 4, worldId: WORLD_ID };

function sendCast(
  handler: Harness["handler"],
  spellCast: Record<string, unknown>,
  speakerActorId: string = CASTER_ID,
): ChatMessage | null {
  const ack = handler(
    {
      content: "lança Arco Elétrico",
      worldId: WORLD_ID,
      rollMode: "public",
      speakerActorId,
      flags: { pf2e: { spellCast } },
    },
    CTX,
  ) as Ack<{ message: ChatMessage }>;
  if (!ack.ok) return null;
  return ack.result?.message ?? null;
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

describe("chat:send spellCast flag (r17-P2)", () => {
  it("attaches a well-formed card to the message flags", () => {
    const { handler } = makeHarness(19);
    const msg = sendCast(handler, {
      casterActorId: CASTER_ID,
      spellName: "Arco Elétrico",
      rank: 2,
      actionCost: "◆◆",
      dcValue: 19,
      saveType: "reflex",
      basicSave: true,
      damageFormula: "3d4",
      damageType: "electricity",
    });
    expect(msg).not.toBeNull();
    const card = (msg!.flags as Record<string, Record<string, unknown>>)["pf2e"]?.["spellCast"] as
      | Record<string, unknown>
      | undefined;
    expect(card).toBeDefined();
    expect(card!["dcValue"]).toBe(19);
    expect(card!["saveType"]).toBe("reflex");
    expect(card!["damageFormula"]).toBe("3d4");
  });

  it("rejects a forged card whose caster != speaker (clears the flag)", () => {
    const { handler } = makeHarness(19);
    // The card claims a DIFFERENT actor as caster than the message speaker.
    const msg = sendCast(
      handler,
      {
        casterActorId: "someoneelse00001",
        spellName: "Bola de Fogo",
        rank: 3,
        damageFormula: "6d6",
      },
      CASTER_ID,
    );
    expect(msg).not.toBeNull();
    const pf2e = (msg!.flags as Record<string, Record<string, unknown>>)["pf2e"];
    expect(pf2e?.["spellCast"]).toBeUndefined();
  });

  it("drops an incoherent DC (client cannot forge the DC)", () => {
    const { handler } = makeHarness(19);
    // Caster's real derived DC is 19; the client sends 30.
    const msg = sendCast(handler, {
      casterActorId: CASTER_ID,
      spellName: "Arco Elétrico",
      rank: 2,
      dcValue: 30,
      saveType: "reflex",
      basicSave: true,
    });
    expect(msg).not.toBeNull();
    const card = (msg!.flags as Record<string, Record<string, unknown>>)["pf2e"]?.["spellCast"] as
      | Record<string, unknown>
      | undefined;
    expect(card).toBeDefined();
    // DC dropped; save button falls back to display-only, but saveType stays.
    expect(card!["dcValue"]).toBeUndefined();
    expect(card!["saveType"]).toBe("reflex");
  });

  it("keeps a coherent DC that matches the caster's derived spell DC", () => {
    const { handler } = makeHarness(22);
    const msg = sendCast(handler, {
      casterActorId: CASTER_ID,
      spellName: "Arco Elétrico",
      rank: 2,
      dcValue: 22,
      saveType: "will",
    });
    const card = (msg!.flags as Record<string, Record<string, unknown>>)["pf2e"]?.["spellCast"] as
      | Record<string, unknown>
      | undefined;
    expect(card!["dcValue"]).toBe(22);
  });

  it("rejects the whole chat:send when the card shape is malformed (Zod)", () => {
    const { handler } = makeHarness(19);
    const ack = handler(
      {
        content: "lança Arco Elétrico",
        worldId: WORLD_ID,
        speakerActorId: CASTER_ID,
        flags: { pf2e: { spellCast: { casterActorId: "" } } },
      },
      CTX,
    ) as Ack<unknown>;
    expect(ack.ok).toBe(false);
  });
});
