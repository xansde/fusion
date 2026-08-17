/**
 * Integration tests for DocumentStore.
 *
 * Uses real SQLite databases in OS temp directories (never in-memory).
 * Each test suite gets its own DB to avoid state leakage.
 *
 * Coverage:
 *   - create: generates _id, sets _stats, validates, rejects bad data
 *   - create: accepts valid supplied _id; rejects collision
 *   - create: client-supplied _stats is stripped (server writes it)
 *   - get: retrieves by id; throws on missing
 *   - getAll / query: filters by type, folder, nameLike
 *   - update: partial patch merges correctly; does not erase untouched fields
 *   - update: deep merge on nested objects; array replacement
 *   - update: strips _stats from patch (server controls stats)
 *   - update: no-op returns null (REQ-DOC-038)
 *   - delete: removes document; throws on missing
 *   - batch: createBatch, updateBatch, deleteBatch in single transaction
 *   - batch: rollback on failure
 *   - ownership: resolveOwnership — GM always OWNER, explicit userId, default, INHERIT
 *   - ownership: resolveOwnershipWithFolder — INHERIT walks folder chain
 *   - ownership: ownershipForCreator builds correct map for non-GM creator
 *   - merge: deepMerge — objects merged, arrays replaced, null deletes key
 *   - merge: computeDiff — detects changes, returns null for no-op
 *   - validation: Zod rejects malformed document
 *   - validation: valid documents for each registered table pass
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import type { Logger } from "../logger.js";

import {
  DocumentStore,
  DocumentNotFoundError,
  DocumentIdCollisionError,
  DocumentValidationError,
  UserRole,
  resolveOwnership,
  resolveOwnershipWithFolder,
  testOwnership,
  ownershipForCreator,
  OwnershipLevel,
  deepMerge,
  computeDiff,
} from "../documents/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-doc-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function openTestDb(dir: string): FusionDatabase {
  const path = join(dir, "world.db");
  const db = openDatabase({ path, skipIntegrityCheck: true });
  applyMigrations(db.raw, path);
  return db;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  tempDirs = [];
});

function createStore(): { store: DocumentStore; db: FusionDatabase; dir: string } {
  const dir = makeTempDir();
  tempDirs.push(dir);
  const db = openTestDb(dir);
  const store = new DocumentStore({
    db: db.raw,
    defaultAuthor: { userId: "serverUserId" },
    coreVersion: "0.1.0",
  });
  return { store, db, dir };
}

/** A minimal pino-shaped logger mock, wired the same way SocketManager wires the real one. */
function makeMockLogger(): Logger {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createStoreWithLogger(): {
  store: DocumentStore;
  db: FusionDatabase;
  dir: string;
  logger: Logger;
} {
  const dir = makeTempDir();
  tempDirs.push(dir);
  const db = openTestDb(dir);
  const logger = makeMockLogger();
  const store = new DocumentStore({
    db: db.raw,
    defaultAuthor: { userId: "serverUserId" },
    coreVersion: "0.1.0",
    logger,
  });
  return { store, db, dir, logger };
}

// ---------------------------------------------------------------------------
// Minimal valid document inputs (pre-validation defaults fill the rest)
// ---------------------------------------------------------------------------

const minimalActor = () => ({
  name: "Goblin",
  type: "npc",
});

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

describe("DocumentStore.create", () => {
  it("generates a valid 16-char _id when absent", () => {
    const { store } = createStore();
    const doc = store.create("actors", minimalActor());
    expect(doc["_id"]).toMatch(/^[A-Za-z0-9]{16}$/);
  });

  it("accepts a valid supplied _id", () => {
    const { store } = createStore();
    const id = "ABCDEF1234567890";
    const doc = store.create("actors", { ...minimalActor(), _id: id });
    expect(doc["_id"]).toBe(id);
  });

  it("throws DocumentIdCollisionError on duplicate _id", () => {
    const { store } = createStore();
    const id = "ABCDEF1234567890";
    store.create("actors", { ...minimalActor(), _id: id });
    expect(() => store.create("actors", { ...minimalActor(), _id: id })).toThrow(
      DocumentIdCollisionError,
    );
  });

  it("throws DocumentValidationError for invalid _id format", () => {
    const { store } = createStore();
    expect(() => store.create("actors", { ...minimalActor(), _id: "short" })).toThrow(
      DocumentValidationError,
    );
  });

  it("sets _stats server-side with createdBy from author context", () => {
    const { store } = createStore();
    const beforeCreate = Date.now();
    const doc = store.create("actors", minimalActor(), { userId: "user123" });
    const stats = doc["_stats"] as Record<string, unknown>;

    expect(stats["createdBy"]).toBe("user123");
    expect(stats["lastModifiedBy"]).toBe("user123");
    expect(typeof stats["createdTime"]).toBe("number");
    expect(stats["createdTime"] as number).toBeGreaterThanOrEqual(beforeCreate);
    expect(stats["coreVersion"]).toBe("0.1.0");
  });

  it("ignores client-supplied _stats (server always overwrites)", () => {
    const { store } = createStore();
    const fakeStats = {
      createdTime: 1,
      modifiedTime: 1,
      lastModifiedBy: "hacker",
      createdBy: "hacker",
      coreVersion: "9.9.9",
      systemId: null,
      systemVersion: null,
      engineSchemaVersion: 99,
      systemSchemaVersion: null,
    };
    const doc = store.create("actors", { ...minimalActor(), _stats: fakeStats });
    const stats = doc["_stats"] as Record<string, unknown>;

    // Server overwrites all stats
    expect(stats["createdBy"]).toBe("serverUserId");
    expect(stats["coreVersion"]).toBe("0.1.0");
    expect(stats["engineSchemaVersion"]).toBe(1);
    // createdTime is set to "now", not the fake value
    expect(stats["createdTime"] as number).toBeGreaterThan(1);
  });

  it("throws DocumentValidationError when required field is missing", () => {
    const { store } = createStore();
    // Actor requires name (min(1))
    expect(() => store.create("actors", { type: "npc" })).toThrow(DocumentValidationError);
  });

  it("creates documents for all 12 tables without throwing", () => {
    const { store } = createStore();

    const tables: [string, Record<string, unknown>][] = [
      ["actors", { name: "Actor", type: "base" }],
      ["items", { name: "Item", type: "base" }],
      ["scenes", { name: "Scene" }],
      ["journal_entries", { name: "JournalEntry" }],
      ["macros", { name: "Macro", type: "script" }],
      ["roll_tables", { name: "RollTable" }],
      ["playlists", { name: "Playlist" }],
      ["chat_messages", { author: "userXXXXXXXXXXXXX1", timestamp: Date.now() }],
      ["combats", { sceneId: "testsceneidXXXXX" }],
      ["users", { name: "User", role: 1 }],
      ["folders", { name: "Folder", type: "actors" }],
      ["settings", { key: "core.setting", value: true }],
    ];

    for (const [table, data] of tables) {
      expect(() => store.create(table as never, data)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe("DocumentStore.get", () => {
  it("retrieves a created document", () => {
    const { store } = createStore();
    const created = store.create("actors", { name: "Troll", type: "giant" });
    const fetched = store.get("actors", created["_id"] as string);
    expect(fetched["name"]).toBe("Troll");
    expect(fetched["_id"]).toBe(created["_id"]);
  });

  it("throws DocumentNotFoundError for missing id", () => {
    const { store } = createStore();
    expect(() => store.get("actors", "doesNotExist1234")).toThrow(DocumentNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// GETALL / QUERY
// ---------------------------------------------------------------------------

describe("DocumentStore.getAll / query", () => {
  it("returns all documents in a table", () => {
    const { store } = createStore();
    store.create("actors", { name: "A", type: "npc" });
    store.create("actors", { name: "B", type: "pc" });
    const all = store.getAll("actors");
    expect(all).toHaveLength(2);
  });

  it("filters by type", () => {
    const { store } = createStore();
    store.create("actors", { name: "Goblin", type: "npc" });
    store.create("actors", { name: "Hero", type: "pc" });

    const npcs = store.query("actors", { type: "npc" });
    expect(npcs).toHaveLength(1);
    expect(npcs[0]?.["name"]).toBe("Goblin");
  });

  it("filters by folderId", () => {
    const { store } = createStore();
    store.create("actors", { name: "In Folder", type: "npc", folder: "folderAABBCC123456" });
    store.create("actors", { name: "No Folder", type: "npc" });

    const inFolder = store.query("actors", { folderId: "folderAABBCC123456" });
    expect(inFolder).toHaveLength(1);
    expect(inFolder[0]?.["name"]).toBe("In Folder");

    const noFolder = store.query("actors", { folderId: null });
    expect(noFolder).toHaveLength(1);
    expect(noFolder[0]?.["name"]).toBe("No Folder");
  });

  it("filters by nameLike", () => {
    const { store } = createStore();
    store.create("actors", { name: "Goblin King", type: "npc" });
    store.create("actors", { name: "Hero", type: "pc" });

    const results = store.query("actors", { nameLike: "%Goblin%" });
    expect(results).toHaveLength(1);
    expect(results[0]?.["name"]).toBe("Goblin King");
  });

  it("returns empty array for table with no documents", () => {
    const { store } = createStore();
    expect(store.getAll("actors")).toHaveLength(0);
  });

  // T014: LIMIT is a bound parameter now, not interpolated. These cases pin the
  // parameter ORDER, which is what an interpolated-to-bound change can get
  // wrong silently: with a filter present, the limit has to arrive after the
  // filter's value, or the WHERE clause binds the number.
  it("honours limit on an unfiltered query", () => {
    const { store } = createStore();
    for (let i = 0; i < 5; i++) store.create("actors", { name: `A${String(i)}`, type: "npc" });

    expect(store.query("actors", { limit: 2 })).toHaveLength(2);
  });

  it("honours limit alongside a filter", () => {
    const { store } = createStore();
    for (let i = 0; i < 4; i++)
      store.create("actors", { name: `Goblin ${String(i)}`, type: "npc" });
    store.create("actors", { name: "Hero", type: "pc" });

    const results = store.query("actors", { nameLike: "%Goblin%", limit: 3 });
    expect(results).toHaveLength(3);
    for (const r of results) expect(String(r["name"])).toContain("Goblin");
  });
});

// ---------------------------------------------------------------------------
// LEGACY TOKEN READ POLICY (REQ-TOK-002)
//
// TokenDocumentSchema has required a resolvable `actorId` string since
// TK020 (no `.nullable()`/`.default()`) — a token without one is refused at
// WRITE time. A world whose Scene row predates that requirement (or was
// written through a path that never validated per-token, like the server's
// loosely-typed SceneSchema.tokens: z.array(z.record(...))) can still hold
// one on disk. This is exactly that case: the Scene document is written
// through the public store API (not raw SQL), because the server's own
// SceneSchema accepts an embedded token shape TokenDocumentSchema would now
// reject — proving the legacy row is reachable through ordinary writes, not
// a fabricated fixture. A cleanup at read time, not a migration: nothing in
// the database is rewritten, only what `get`/`getAll`/`query` return.
// ---------------------------------------------------------------------------

describe("DocumentStore — legacy token read policy (REQ-TOK-002)", () => {
  it("get() drops a legacy token with no actorId and the scene still loads", () => {
    const { store, logger } = createStoreWithLogger();
    const created = store.create("scenes", {
      name: "Legacy Scene",
      tokens: [
        { _id: "aaaaaaaaaaaaaaaa", name: "Ghost With No Actor", x: 1, y: 2 },
        { _id: "bbbbbbbbbbbbbbbb", name: "Fine Token", actorId: "someActorId1234" },
      ],
    });
    const sceneId = created["_id"] as string;

    const fetched = store.get("scenes", sceneId);

    // The scene loads — it does not throw or come back empty.
    expect(fetched["_id"]).toBe(sceneId);
    const tokens = fetched["tokens"] as Array<Record<string, unknown>>;
    // Only the token WITH a resolvable actorId survives.
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.["_id"]).toBe("bbbbbbbbbbbbbbbb");
    expect(tokens.some((t) => t["_id"] === "aaaaaaaaaaaaaaaa")).toBe(false);

    // The log warns about it, naming the scene.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sceneId, droppedCount: 1 }),
      expect.stringContaining("actorId"),
    );
  });

  it("warns exactly once per scene, not once per read", () => {
    const { store, logger } = createStoreWithLogger();
    const created = store.create("scenes", {
      name: "Legacy Scene Read Twice",
      tokens: [{ _id: "cccccccccccccccc", name: "Ghost", x: 0, y: 0 }],
    });
    const sceneId = created["_id"] as string;

    store.get("scenes", sceneId);
    store.get("scenes", sceneId);
    store.get("scenes", sceneId);

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("getAll()/query() apply the same filter as get()", () => {
    const { store, logger } = createStoreWithLogger();
    store.create("scenes", {
      name: "Legacy Scene In List",
      tokens: [{ _id: "dddddddddddddddd", name: "Ghost", x: 0, y: 0 }],
    });

    const all = store.getAll("scenes");
    expect(all).toHaveLength(1);
    const tokens = all[0]?.["tokens"] as Array<Record<string, unknown>>;
    expect(tokens).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("a scene with no legacy tokens is untouched and never warns", () => {
    const { store, logger } = createStoreWithLogger();
    const created = store.create("scenes", {
      name: "Clean Scene",
      tokens: [{ _id: "eeeeeeeeeeeeeeee", name: "Fine Token", actorId: "someActorId1234" }],
    });

    const fetched = store.get("scenes", created["_id"] as string);
    expect((fetched["tokens"] as unknown[]).length).toBe(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("works with no logger configured (sanitization still runs, just silent)", () => {
    const { store } = createStore();
    const created = store.create("scenes", {
      name: "Legacy Scene No Logger",
      tokens: [{ _id: "ffffffffffffffff", name: "Ghost", x: 0, y: 0 }],
    });

    const fetched = store.get("scenes", created["_id"] as string);
    expect((fetched["tokens"] as unknown[]).length).toBe(0);
  });

  // REQ-TOK-002 — `getRaw()` is the escape hatch a write site (doc-handlers.ts's
  // handleEmbeddedCreate/Update/Delete, vision-handlers.ts's token:move) uses
  // to reconstruct `tokens[]` for a full-array-replace `update()` WITHOUT the
  // legacy token silently vanishing from the row (REQ-DOC-037 replaces an
  // array in full; building the replacement from the FILTERED `get()` would
  // persist a `tokens[]` that never included it). `get()` on the very same
  // document, right after, still filters it — the write-side escape hatch
  // does not weaken the read-side policy for anyone else.
  it("getRaw() returns the legacy token that get() filters out, unmodified otherwise", () => {
    const { store, logger } = createStoreWithLogger();
    const created = store.create("scenes", {
      name: "Legacy Scene For getRaw",
      tokens: [
        { _id: "aaaaaaaaaaaaaaaa", name: "Ghost With No Actor", x: 1, y: 2 },
        { _id: "bbbbbbbbbbbbbbbb", name: "Fine Token", actorId: "someActorId1234" },
      ],
    });
    const sceneId = created["_id"] as string;

    const raw = store.getRaw("scenes", sceneId);
    const rawTokens = raw["tokens"] as Array<Record<string, unknown>>;
    expect(rawTokens.map((t) => t["_id"])).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
    // getRaw() never warns — it is not the READ policy, just its bypass for
    // internal write reconstruction.
    expect(logger.warn).not.toHaveBeenCalled();

    // The ordinary filtered read is completely unaffected by that getRaw()
    // call: the legacy token is still hidden, and the warn still fires once.
    const filtered = store.get("scenes", sceneId);
    const filteredTokens = filtered["tokens"] as Array<Record<string, unknown>>;
    expect(filteredTokens.map((t) => t["_id"])).toEqual(["bbbbbbbbbbbbbbbb"]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("getRaw() throws DocumentNotFoundError for a missing id, like get()", () => {
    const { store } = createStore();
    expect(() => store.getRaw("scenes", "nonexistentId0001")).toThrow(DocumentNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

describe("DocumentStore.update", () => {
  it("applies partial patch and preserves untouched fields", () => {
    const { store } = createStore();
    const original = store.create("actors", {
      name: "Goblin",
      type: "npc",
      system: { hp: 10, ac: 12 },
    });
    const id = original["_id"] as string;

    // Patch only name
    const updated = store.update("actors", id, { name: "Goblin Chief" });

    expect(updated).not.toBeNull();
    expect(updated!["name"]).toBe("Goblin Chief");
    // type and system must not be erased
    expect(updated!["type"]).toBe("npc");
    const sys = updated!["system"] as Record<string, unknown>;
    expect(sys["hp"]).toBe(10);
    expect(sys["ac"]).toBe(12);
  });

  it("deep merges nested objects (system field)", () => {
    const { store } = createStore();
    const original = store.create("actors", {
      name: "Goblin",
      type: "npc",
      system: { hp: 10, ac: 12, abilities: { str: 8, dex: 14 } },
    });
    const id = original["_id"] as string;

    const updated = store.update("actors", id, {
      system: { hp: 5, abilities: { str: 10 } },
    });

    expect(updated).not.toBeNull();
    const sys = updated!["system"] as Record<string, unknown>;
    expect(sys["hp"]).toBe(5); // replaced
    expect(sys["ac"]).toBe(12); // preserved
    const abilities = sys["abilities"] as Record<string, unknown>;
    expect(abilities["str"]).toBe(10); // merged
    expect(abilities["dex"]).toBe(14); // preserved
  });

  it("replaces arrays entirely (not merged)", () => {
    const { store } = createStore();
    const original = store.create("scenes", {
      name: "Battle Map",
      tokens: [{ _id: "tok1", name: "A" }],
    });
    const id = original["_id"] as string;

    const updated = store.update("scenes", id, {
      tokens: [{ _id: "tok2", name: "B" }],
    });

    expect(updated).not.toBeNull();
    const tokens = updated!["tokens"] as unknown[];
    expect(tokens).toHaveLength(1);
    expect((tokens[0] as Record<string, unknown>)["_id"]).toBe("tok2");
  });

  it("deletes a key when null is passed in a nested object", () => {
    const { store } = createStore();
    const original = store.create("actors", {
      name: "Goblin",
      type: "npc",
      system: { hp: 10, status: "alive" },
    });
    const id = original["_id"] as string;

    const updated = store.update("actors", id, {
      system: { status: null },
    });

    expect(updated).not.toBeNull();
    const sys = updated!["system"] as Record<string, unknown>;
    expect("status" in sys).toBe(false); // key deleted
    expect(sys["hp"]).toBe(10); // preserved
  });

  it("ignores _stats in patch (server controls stats)", () => {
    const { store } = createStore();
    const original = store.create("actors", minimalActor(), { userId: "user1" });
    const id = original["_id"] as string;
    const origStats = original["_stats"] as Record<string, unknown>;

    const updated = store.update(
      "actors",
      id,
      {
        name: "New Name",
        _stats: {
          createdBy: "hacker",
          lastModifiedBy: "hacker",
          coreVersion: "99.0.0",
          createdTime: 1,
          modifiedTime: 1,
          engineSchemaVersion: 99,
          systemId: null,
          systemVersion: null,
          systemSchemaVersion: null,
        },
      },
      { userId: "user2" },
    );

    expect(updated).not.toBeNull();
    const newStats = updated!["_stats"] as Record<string, unknown>;

    // createdBy must NOT be overwritten by patch
    expect(newStats["createdBy"]).toBe(origStats["createdBy"]);
    // lastModifiedBy comes from the author context, not the patch
    expect(newStats["lastModifiedBy"]).toBe("user2");
    // coreVersion stays at the engine value
    expect(newStats["coreVersion"]).toBe("0.1.0");
  });

  it("returns null when patch produces no real change (no-op)", () => {
    const { store } = createStore();
    const original = store.create("actors", { name: "Goblin", type: "npc" });
    const id = original["_id"] as string;

    // Patch with same values
    const result = store.update("actors", id, { name: "Goblin", type: "npc" });
    expect(result).toBeNull();
  });

  it("throws DocumentNotFoundError when document does not exist", () => {
    const { store } = createStore();
    expect(() => store.update("actors", "doesNotExist1234", { name: "X" })).toThrow(
      DocumentNotFoundError,
    );
  });

  it("throws DocumentValidationError when patch produces invalid document", () => {
    const { store } = createStore();
    const original = store.create("actors", minimalActor());
    const id = original["_id"] as string;

    // name must be min(1), empty string should fail
    expect(() => store.update("actors", id, { name: "" })).toThrow(DocumentValidationError);
  });

  it("persists update correctly (get after update reflects change)", () => {
    const { store } = createStore();
    const original = store.create("actors", { name: "Kobold", type: "npc" });
    const id = original["_id"] as string;

    store.update("actors", id, { name: "Kobold Chief" });

    const fetched = store.get("actors", id);
    expect(fetched["name"]).toBe("Kobold Chief");
  });

  it("updates _stats.modifiedTime after update", () => {
    const { store } = createStore();
    const original = store.create("actors", minimalActor());
    const id = original["_id"] as string;
    const origModified = (original["_stats"] as Record<string, unknown>)["modifiedTime"] as number;

    // Tiny delay to ensure timestamp differs
    const updated = store.update("actors", id, { name: "Renamed" });
    const newModified = (updated!["_stats"] as Record<string, unknown>)["modifiedTime"] as number;
    expect(newModified).toBeGreaterThanOrEqual(origModified);
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe("DocumentStore.delete", () => {
  it("deletes an existing document", () => {
    const { store } = createStore();
    const doc = store.create("actors", minimalActor());
    const id = doc["_id"] as string;

    const deletedId = store.delete("actors", id);
    expect(deletedId).toBe(id);
    expect(() => store.get("actors", id)).toThrow(DocumentNotFoundError);
  });

  it("throws DocumentNotFoundError when document does not exist", () => {
    const { store } = createStore();
    expect(() => store.delete("actors", "doesNotExist1234")).toThrow(DocumentNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// BATCH operations
// ---------------------------------------------------------------------------

describe("DocumentStore batch operations", () => {
  it("createBatch creates all documents in one transaction", () => {
    const { store } = createStore();
    const results = store.createBatch("actors", [
      { name: "A", type: "npc" },
      { name: "B", type: "pc" },
      { name: "C", type: "npc" },
    ]);
    expect(results).toHaveLength(3);
    expect(store.getAll("actors")).toHaveLength(3);
  });

  it("createBatch rolls back all on failure", () => {
    const { store } = createStore();
    const id = "COLLISION0001234";
    store.create("actors", { ...minimalActor(), _id: id });

    // Second batch tries to use the same id — whole batch must roll back
    expect(() =>
      store.createBatch("actors", [
        { name: "OK", type: "npc" },
        { ...minimalActor(), _id: id }, // collision
      ]),
    ).toThrow(DocumentIdCollisionError);

    // Only the pre-existing document should remain
    expect(store.getAll("actors")).toHaveLength(1);
  });

  it("updateBatch updates multiple documents atomically", () => {
    const { store } = createStore();
    const a = store.create("actors", { name: "A", type: "npc" });
    const b = store.create("actors", { name: "B", type: "npc" });

    store.updateBatch("actors", [
      { _id: a["_id"] as string, name: "A-updated" },
      { _id: b["_id"] as string, name: "B-updated" },
    ]);

    expect(store.get("actors", a["_id"] as string)["name"]).toBe("A-updated");
    expect(store.get("actors", b["_id"] as string)["name"]).toBe("B-updated");
  });

  it("updateBatch rolls back all on failure", () => {
    const { store } = createStore();
    const a = store.create("actors", { name: "A", type: "npc" });

    expect(() =>
      store.updateBatch("actors", [
        { _id: a["_id"] as string, name: "A-updated" },
        { _id: "doesNotExist1234", name: "x" }, // missing
      ]),
    ).toThrow(DocumentNotFoundError);

    // A must still have original name
    expect(store.get("actors", a["_id"] as string)["name"]).toBe("A");
  });

  it("deleteBatch deletes multiple documents", () => {
    const { store } = createStore();
    const a = store.create("actors", { name: "A", type: "npc" });
    const b = store.create("actors", { name: "B", type: "npc" });

    store.deleteBatch("actors", [a["_id"] as string, b["_id"] as string]);
    expect(store.getAll("actors")).toHaveLength(0);
  });

  it("deleteBatch rolls back all on missing document", () => {
    const { store } = createStore();
    const a = store.create("actors", { name: "A", type: "npc" });

    expect(() => store.deleteBatch("actors", [a["_id"] as string, "doesNotExist1234"])).toThrow(
      DocumentNotFoundError,
    );

    // A must still exist
    expect(store.getAll("actors")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// OWNERSHIP
// ---------------------------------------------------------------------------

describe("Ownership resolution", () => {
  const someOwnership = {
    default: OwnershipLevel.NONE,
    player1: OwnershipLevel.OWNER,
    player2: OwnershipLevel.LIMITED,
  };

  it("GM always gets OWNER regardless of ownership map", () => {
    expect(resolveOwnership(someOwnership, "player1", UserRole.GAMEMASTER)).toBe(
      OwnershipLevel.OWNER,
    );
    expect(resolveOwnership({ default: OwnershipLevel.NONE }, "nobody", UserRole.GAMEMASTER)).toBe(
      OwnershipLevel.OWNER,
    );
  });

  it("returns explicit userId entry", () => {
    expect(resolveOwnership(someOwnership, "player1", UserRole.PLAYER)).toBe(OwnershipLevel.OWNER);
    expect(resolveOwnership(someOwnership, "player2", UserRole.PLAYER)).toBe(
      OwnershipLevel.LIMITED,
    );
  });

  it("falls back to default when no explicit entry", () => {
    expect(resolveOwnership(someOwnership, "unknown", UserRole.PLAYER)).toBe(OwnershipLevel.NONE);
  });

  it("returns NONE for null userId (unauthenticated)", () => {
    expect(resolveOwnership(someOwnership, null, UserRole.PLAYER)).toBe(OwnershipLevel.NONE);
  });

  it("testOwnership returns true when level meets minimum", () => {
    expect(testOwnership(someOwnership, "player1", UserRole.PLAYER, OwnershipLevel.OWNER)).toBe(
      true,
    );
    expect(testOwnership(someOwnership, "player2", UserRole.PLAYER, OwnershipLevel.LIMITED)).toBe(
      true,
    );
    expect(testOwnership(someOwnership, "player2", UserRole.PLAYER, OwnershipLevel.OWNER)).toBe(
      false,
    );
  });

  it("ownershipForCreator gives OWNER to non-GM creator", () => {
    const o = ownershipForCreator("user123", UserRole.PLAYER);
    expect(o["default"]).toBe(OwnershipLevel.NONE);
    expect(o["user123"]).toBe(OwnershipLevel.OWNER);
  });

  it("ownershipForCreator does not add personal entry for GM", () => {
    const o = ownershipForCreator("gmuser", UserRole.GAMEMASTER);
    expect(o["default"]).toBe(OwnershipLevel.NONE);
    expect("gmuser" in o).toBe(false);
  });

  describe("resolveOwnershipWithFolder — INHERIT resolution", () => {
    const rootFolder = {
      _id: "rootFolderXXXXXXX",
      ownership: { default: OwnershipLevel.LIMITED },
    };

    const childFolder = {
      _id: "childFolderXXXXXX",
      ownership: { default: OwnershipLevel.INHERIT as OwnershipLevel },
      parentId: "rootFolderXXXXXXX",
    };

    const getFolder = (id: string) => {
      if (id === "rootFolderXXXXXXX") return rootFolder;
      if (id === "childFolderXXXXXX") return childFolder;
      return undefined;
    };

    it("resolves INHERIT by walking folder chain to root", () => {
      const docOwnership = { default: OwnershipLevel.INHERIT as OwnershipLevel };
      const level = resolveOwnershipWithFolder(
        docOwnership,
        "childFolderXXXXXX",
        "user1",
        UserRole.PLAYER,
        getFolder,
      );
      // child folder also INHERIT → walks to root folder → LIMITED
      expect(level).toBe(OwnershipLevel.LIMITED);
    });

    it("returns NONE when chain exhausted with INHERIT (no folder context)", () => {
      const docOwnership = { default: OwnershipLevel.INHERIT as OwnershipLevel };
      const level = resolveOwnershipWithFolder(
        docOwnership,
        null, // no folder
        "user1",
        UserRole.PLAYER,
        getFolder,
      );
      expect(level).toBe(OwnershipLevel.NONE);
    });

    it("GM always OWNER regardless of folder INHERIT", () => {
      const docOwnership = { default: OwnershipLevel.INHERIT as OwnershipLevel };
      const level = resolveOwnershipWithFolder(
        docOwnership,
        "childFolderXXXXXX",
        "gmUser",
        UserRole.GAMEMASTER,
        getFolder,
      );
      expect(level).toBe(OwnershipLevel.OWNER);
    });
  });
});

// ---------------------------------------------------------------------------
// DEEP MERGE
// ---------------------------------------------------------------------------

describe("deepMerge", () => {
  it("merges plain objects recursively", () => {
    const result = deepMerge({ a: { x: 1, y: 2 }, b: 3 }, { a: { x: 10 } });
    expect(result).toEqual({ a: { x: 10, y: 2 }, b: 3 });
  });

  it("replaces arrays entirely", () => {
    const result = deepMerge({ arr: [1, 2, 3] }, { arr: [4, 5] });
    expect(result["arr"]).toEqual([4, 5]);
  });

  it("adds new keys from patch", () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("does not mutate the original target", () => {
    const target = { a: { x: 1 } };
    deepMerge(target, { a: { x: 99 } });
    expect(target["a"]["x"]).toBe(1);
  });

  // REQ-DOC-037: null at top-level sets key to null (folder=null = "move to root")
  it("top-level null sets the key to null, not deletes it", () => {
    const result = deepMerge({ folder: "someFolder", name: "Actor" }, { folder: null });
    expect("folder" in result).toBe(true);
    expect(result["folder"]).toBeNull();
  });

  // REQ-DOC-037: null inside system sub-object deletes the key
  it("null inside system deletes the key (deleteKey semantics)", () => {
    const result = deepMerge({ system: { hp: 10, temp: 5 } }, { system: { temp: null } });
    expect(result["system"]).toEqual({ hp: 10 });
    expect("temp" in (result["system"] as Record<string, unknown>)).toBe(false);
  });

  // REQ-DOC-037: null inside flags sub-object deletes the key
  it("null inside flags deletes the key (deleteKey semantics)", () => {
    const result = deepMerge(
      { flags: { core: { hideNames: true, otherFlag: "x" } } },
      { flags: { core: { hideNames: null } } },
    );
    const core = (result["flags"] as Record<string, unknown>)["core"] as Record<string, unknown>;
    expect("hideNames" in core).toBe(false);
    expect(core["otherFlag"]).toBe("x");
  });

  // null outside flags/system (non-top-level generic object) sets to null
  it("null in generic nested objects sets to null (not delete)", () => {
    const result = deepMerge({ a: { x: 1, y: 2 } }, { a: { y: null } });
    expect("y" in (result["a"] as Record<string, unknown>)).toBe(true);
    expect((result["a"] as Record<string, unknown>)["y"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// COMPUTE DIFF
// ---------------------------------------------------------------------------

describe("computeDiff", () => {
  it("returns null when objects are equal", () => {
    expect(computeDiff({ a: 1, b: 2 }, { a: 1, b: 2 })).toBeNull();
  });

  it("returns only changed keys", () => {
    const diff = computeDiff({ a: 1, b: 2, c: { x: 1 } }, { a: 1, b: 99, c: { x: 1 } });
    expect(diff).toEqual({ b: 99 });
  });

  it("detects nested changes", () => {
    const diff = computeDiff({ sys: { hp: 10, ac: 12 } }, { sys: { hp: 5, ac: 12 } });
    expect(diff).toEqual({ sys: { hp: 5 } });
  });

  it("returns null for no-op with nested equal objects", () => {
    const diff = computeDiff({ a: { b: { c: 42 } } }, { a: { b: { c: 42 } } });
    expect(diff).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

describe("DocumentStore validation", () => {
  it("rejects Actor with empty name", () => {
    const { store } = createStore();
    expect(() => store.create("actors", { name: "", type: "npc" })).toThrow(
      DocumentValidationError,
    );
  });

  it("rejects Item with empty name", () => {
    const { store } = createStore();
    expect(() => store.create("items", { name: "", type: "weapon" })).toThrow(
      DocumentValidationError,
    );
  });

  it("rejects Setting with missing key", () => {
    const { store } = createStore();
    expect(() => store.create("settings", { value: 42 })).toThrow(DocumentValidationError);
  });

  it("accepts minimal valid documents for all tables", () => {
    const { store } = createStore();

    expect(() => store.create("actors", { name: "A", type: "base" })).not.toThrow();
    expect(() => store.create("items", { name: "I", type: "base" })).not.toThrow();
    expect(() => store.create("scenes", { name: "S" })).not.toThrow();
    expect(() => store.create("journal_entries", { name: "J" })).not.toThrow();
    expect(() => store.create("macros", { name: "M", type: "script" })).not.toThrow();
    expect(() => store.create("roll_tables", { name: "R" })).not.toThrow();
    expect(() => store.create("playlists", { name: "P" })).not.toThrow();
    expect(() =>
      store.create("chat_messages", { author: "userXXXXXXXXXXXXX1", timestamp: 0 }),
    ).not.toThrow();
    // CombatSchema (M2-C) requires sceneId; all other fields have defaults
    expect(() => store.create("combats", { sceneId: "testsceneidXXXXX" })).not.toThrow();
    expect(() => store.create("users", { name: "U", role: 1 })).not.toThrow();
    expect(() => store.create("folders", { name: "F", type: "actors" })).not.toThrow();
    expect(() => store.create("settings", { key: "ns.k", value: "v" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// _stats immutability — end-to-end
// ---------------------------------------------------------------------------

describe("_stats server-side authority (REQ-DOC-008, D9)", () => {
  it("client cannot forge _stats via create", () => {
    const { store } = createStore();
    const forgedStats = {
      createdTime: 0,
      modifiedTime: 0,
      createdBy: "forged",
      lastModifiedBy: "forged",
      coreVersion: "evil",
      systemId: null,
      systemVersion: null,
      engineSchemaVersion: 0,
      systemSchemaVersion: null,
    };
    const doc = store.create("actors", { ...minimalActor(), _stats: forgedStats });
    const stats = doc["_stats"] as Record<string, unknown>;
    expect(stats["createdBy"]).not.toBe("forged");
    expect(stats["coreVersion"]).not.toBe("evil");
  });

  it("client cannot forge _stats via update", () => {
    const { store } = createStore();
    const doc = store.create("actors", minimalActor(), { userId: "legit" });
    const id = doc["_id"] as string;

    const updated = store.update("actors", id, {
      name: "Changed",
      _stats: { createdBy: "forged", lastModifiedBy: "forged" },
    });

    expect(updated).not.toBeNull();
    const stats = updated!["_stats"] as Record<string, unknown>;
    expect(stats["createdBy"]).toBe("legit"); // server preserves original
    expect(stats["lastModifiedBy"]).toBe("serverUserId"); // server sets from context
  });
});
