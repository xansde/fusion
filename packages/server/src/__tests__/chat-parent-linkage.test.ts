/**
 * chat-parent-linkage.test.ts — server validation of the nested-roll parent
 * linkage flag (r18-N1).
 *
 * A spell-cast card groups its attack / damage / save rolls under one card by
 * having each roll carry `flags.parentMessageId` = the announcement's id. The
 * server MUST:
 *   - persist the flag as `flags.fusion.parentMessageId` on the broadcast doc
 *     when the parent actually exists in the chat_messages store;
 *   - DROP the flag (never fail the send) when the parent id is dangling, so the
 *     roll is still delivered as a normal top-level message;
 *   - keep the flag coexisting with the graded save `checkContext` on the same
 *     roll (a save roll carries both).
 *
 * Tested against the real buildChatSendHandler with a real temp SQLite DB and a
 * fake namespace (empty sockets → broadcast is a no-op that still returns seq),
 * mirroring chat-spellcast-flag.test.ts.
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
import type { Ack, ChatMessage, ChatSendFlags } from "@fusion/shared";

const WORLD_ID = "parent-world";
const CASTER_ID = "caster0000000001";
const USER_ID = "user000000000001";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-parent-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function seedCaster(db: Db): void {
  const now = Date.now();
  const doc = {
    _id: CASTER_ID,
    name: "Tobias",
    type: "character",
    system: { derived: { spellcasting: { "entry-arcane": { dc: 19, attack: 9 } } } },
  };
  db.prepare(
    `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(CASTER_ID, JSON.stringify(doc), "Tobias", "character", now, now);
  db.prepare(
    `INSERT INTO users (id, data, name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(USER_ID, JSON.stringify({ _id: USER_ID, name: "GM", role: 4 }), "GM", 4, now, now);
}

function fakeNs(): Namespace {
  return { sockets: new Map() } as unknown as Namespace;
}

interface Harness {
  fusionDb: FusionDatabase;
  handler: ReturnType<typeof buildChatSendHandler>;
}

function makeHarness(): Harness {
  const dir = makeTempDir();
  const dbPath = join(dir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);
  seedCaster(fusionDb.raw);

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

/** Send an announcement (text) that will become the PARENT; returns its id. */
function sendAnnouncement(handler: Harness["handler"]): string {
  const ack = handler(
    { content: "lança Arco Elétrico", worldId: WORLD_ID, speakerActorId: CASTER_ID },
    CTX,
  ) as Ack<{ message: ChatMessage }>;
  expect(ack.ok).toBe(true);
  const id = ack.result?.message._id;
  expect(typeof id).toBe("string");
  return id!;
}

/** Send a /r roll with the given flags; returns the broadcast ChatMessage. */
function sendRoll(
  handler: Harness["handler"],
  content: string,
  flags: ChatSendFlags,
): ChatMessage | null {
  const ack = handler(
    { content, worldId: WORLD_ID, rollMode: "public", speakerActorId: CASTER_ID, flags },
    CTX,
  ) as Ack<{ message: ChatMessage }>;
  if (!ack.ok) return null;
  return ack.result?.message ?? null;
}

function readParentId(msg: ChatMessage): unknown {
  const fusion = (msg.flags as Record<string, Record<string, unknown>> | undefined)?.["fusion"];
  return fusion?.["parentMessageId"];
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

describe("chat:send parentMessageId linkage (r18-N1)", () => {
  it("ack returns the canonical message id (used to chain the child)", () => {
    const { handler } = makeHarness();
    const id = sendAnnouncement(handler);
    expect(id.length).toBeGreaterThan(0);
  });

  it("persists flags.fusion.parentMessageId when the parent exists", () => {
    const { handler } = makeHarness();
    const parentId = sendAnnouncement(handler);
    const child = sendRoll(handler, "/r 1d20+9 # Ataque", { parentMessageId: parentId });
    expect(child).not.toBeNull();
    expect(readParentId(child!)).toBe(parentId);
  });

  it("drops the flag (still delivers) when the parent is dangling", () => {
    const { handler } = makeHarness();
    const child = sendRoll(handler, "/r 2d6 # Dano", {
      parentMessageId: "does-not-exist-00001",
    });
    // Delivered normally as a top-level roll — just without the nesting flag.
    expect(child).not.toBeNull();
    expect(child!.type).toBe("roll");
    expect(readParentId(child!)).toBeUndefined();
  });

  it("keeps parentMessageId alongside a graded save checkContext", () => {
    const { handler } = makeHarness();
    const parentId = sendAnnouncement(handler);
    const child = sendRoll(handler, "/r 1d20+5 # Salvaguarda de Reflexos (CD 19)", {
      parentMessageId: parentId,
      checkContext: { kind: "save", dcValue: 19, saveType: "reflex", basicSave: true },
    });
    expect(child).not.toBeNull();
    // Parent linkage persisted…
    expect(readParentId(child!)).toBe(parentId);
    // …and the save was still graded server-side (degreeOfSuccess set).
    expect(child!.rolls?.[0]?.degreeOfSuccess).toBeDefined();
    // …and the graded save context (basicSave) rides on flags.pf2e.checkContext.
    const pf2e = (child!.flags as Record<string, Record<string, unknown>> | undefined)?.["pf2e"];
    const cc = pf2e?.["checkContext"] as Record<string, unknown> | undefined;
    expect(cc?.["basicSave"]).toBe(true);
  });

  it("a roll without the flag stays flag-free (compat)", () => {
    const { handler } = makeHarness();
    const child = sendRoll(handler, "/r 1d20+3 # Perícia", {});
    expect(child).not.toBeNull();
    expect(readParentId(child!)).toBeUndefined();
  });

  it("the announcement itself (parent) carries no parentMessageId", () => {
    const { handler } = makeHarness();
    const ack = handler(
      { content: "lança Escudo", worldId: WORLD_ID, speakerActorId: CASTER_ID },
      CTX,
    ) as Ack<{ message: ChatMessage }>;
    expect(ack.ok).toBe(true);
    expect(readParentId(ack.result!.message)).toBeUndefined();
  });
});
