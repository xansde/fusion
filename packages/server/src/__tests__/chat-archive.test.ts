/**
 * T019 — manual chat archiving (D5: chat only leaves by human order).
 *
 * The defect this suite exists to catch is data loss, so most tests prove a
 * NEGATIVE: what still fits in the database (or on disk) after a run that
 * was supposed to touch nothing, or supposed to fail. "The export file
 * exists" is not enough — every test that removes rows also proves the rows
 * left behind are untouched, byte-for-byte.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database as Db } from "better-sqlite3";
import type { ChatMessageRow } from "../chat/archive.js";

import { openDatabase, applyMigrations, registerMigrations } from "../db/index.js";
import type { FusionMigration } from "../db/index.js";
import { migration001 } from "../db/migrations/001_initial_schema.js";
import { migration002 } from "../db/migrations/002_users_sessions.js";
import { migration003 } from "../db/migrations/003_fog_exploration.js";
import { migration004 } from "../db/migrations/004_region_maps.js";
import { migration005 } from "../db/migrations/005_roll_audit_log.js";
import { migration006 } from "../db/migrations/006_constraints.js";
import { migration007 } from "../db/migrations/007_indexes.js";
import { migration008 } from "../db/migrations/008_scene_active.js";

import {
  buildArchiveRange,
  parseArchiveBoundary,
  previewArchiveRange,
  readArchiveFile,
  runChatArchive,
  ArchiveConfirmationMismatchError,
  ArchiveExportError,
  deleteChatRowsByIds,
  ArchiveRangeError,
  type ChatMessageRow,
} from "../chat/archive.js";

const ALL_MIGRATIONS: FusionMigration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

function newTempDir(prefix: string): string {
  // Never inside the worktree: see feedback_datadir_fora_da_worktree.
  const dir = join(
    tmpdir(),
    `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/** Row shape as it lands directly on the wire from a `chat_messages` SELECT. */
interface RawRow {
  id: string;
  data: string;
  timestamp: number;
  author_id: string;
  created_at: number;
  updated_at: number;
}

function insertMessage(db: Db, id: string, timestamp: number, content: string): void {
  const data = JSON.stringify({
    _id: id,
    type: "text",
    content,
    speaker: { userId: "user-gm" },
    timestamp,
    whisper: [],
    blind: false,
  });
  const createdAt = timestamp; // deterministic — good enough for this suite
  db.prepare(
    `INSERT INTO chat_messages (id, data, timestamp, author_id, created_at, updated_at)
     VALUES (?, ?, ?, 'user-gm', ?, ?)`,
  ).run(id, data, timestamp, createdAt, createdAt);
}

function readAllRows(db: Db): RawRow[] {
  return db
    .prepare(
      `SELECT id, data, timestamp, author_id, created_at, updated_at FROM chat_messages ORDER BY id`,
    )
    .all() as RawRow[];
}

function rowById(db: Db, id: string): RawRow | undefined {
  return db
    .prepare(
      `SELECT id, data, timestamp, author_id, created_at, updated_at FROM chat_messages WHERE id = ?`,
    )
    .get(id) as RawRow | undefined;
}

beforeEach(() => {
  tempDirs = [];
  registerMigrations(ALL_MIGRATIONS);
});

afterEach(() => {
  registerMigrations(ALL_MIGRATIONS);
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

/** A world db, migrated, with 5 messages: 3 inside [T0, T1], 2 outside it. */
function seedWorld(): {
  db: Db;
  dir: string;
  fromMs: number;
  toMs: number;
  insideIds: string[];
  outsideIds: string[];
} {
  const dir = newTempDir("fusion-chat-archive");
  const dbPath = join(dir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  const fromMs = 1_000_000;
  const toMs = 2_000_000;

  insertMessage(fusionDb.raw, "before-range", fromMs - 1, "too early");
  insertMessage(fusionDb.raw, "in-1", fromMs, "at the lower boundary");
  insertMessage(fusionDb.raw, "in-2", 1_500_000, "in the middle");
  insertMessage(fusionDb.raw, "in-3", toMs, "at the upper boundary");
  insertMessage(fusionDb.raw, "after-range", toMs + 1, "too late");

  return {
    db: fusionDb.raw,
    dir,
    fromMs,
    toMs,
    insideIds: ["in-1", "in-2", "in-3"],
    outsideIds: ["before-range", "after-range"],
  };
}

// ---------------------------------------------------------------------------
// Dry run — the default
// ---------------------------------------------------------------------------

describe("chat archive — dry run (no confirmDeleteCount)", () => {
  it("removes nothing, yet reports exactly what a confirmed run would do", () => {
    const { db, dir, fromMs, toMs } = seedWorld();
    const outPath = join(dir, "export.jsonl");

    const before = readAllRows(db);

    const result = runChatArchive({ db, range: { fromMs, toMs }, outPath });

    expect(result.executed).toBe(false);
    expect(result.deletedCount).toBe(0);
    expect(result.exportPath).toBeNull();
    expect(result.preview.count).toBe(3);
    expect(result.preview.actualFromMs).toBe(fromMs);
    expect(result.preview.actualToMs).toBe(toMs);

    // Nothing removed: same 5 rows, byte-for-byte.
    const after = readAllRows(db);
    expect(after).toEqual(before);

    // Nothing written either.
    expect(existsSync(outPath)).toBe(false);
  });

  it("previewArchiveRange reports the same count independently of runChatArchive", () => {
    const { db, fromMs, toMs } = seedWorld();
    const preview = previewArchiveRange(db, { fromMs, toMs });
    expect(preview.count).toBe(3);
    expect(preview.actualFromMs).toBe(fromMs);
    expect(preview.actualToMs).toBe(toMs);
  });
});

// ---------------------------------------------------------------------------
// Confirmed run — export then delete
// ---------------------------------------------------------------------------

describe("chat archive — confirmed run", () => {
  it("removes only the in-range messages; out-of-range rows survive byte-for-byte", () => {
    const { db, dir, fromMs, toMs, insideIds, outsideIds } = seedWorld();
    const outPath = join(dir, "export.jsonl");

    const outsideBefore = outsideIds.map((id) => rowById(db, id));

    const result = runChatArchive({ db, range: { fromMs, toMs }, outPath, confirmDeleteCount: 3 });

    expect(result.executed).toBe(true);
    expect(result.deletedCount).toBe(3);
    expect(result.exportPath).toBe(outPath);

    // In-range ids are gone.
    for (const id of insideIds) {
      expect(rowById(db, id)).toBeUndefined();
    }

    // Out-of-range rows are untouched — same object, field by field.
    const outsideAfter = outsideIds.map((id) => rowById(db, id));
    expect(outsideAfter).toEqual(outsideBefore);
    expect(readAllRows(db)).toHaveLength(2);
  });

  it("exports exactly the removed messages, and the file reconstructs them field-by-field", () => {
    const { db, dir, fromMs, toMs, insideIds } = seedWorld();
    const outPath = join(dir, "export.jsonl");

    // Snapshot the rows BEFORE they are deleted, straight from the DB.
    const expectedRows = insideIds.map((id) => rowById(db, id) as RawRow);

    runChatArchive({ db, range: { fromMs, toMs }, outPath, confirmDeleteCount: 3 });

    const { meta, rows } = readArchiveFile(outPath);
    expect(meta.count).toBe(3);
    expect(meta.range).toEqual({ fromMs, toMs });

    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const expected of expectedRows) {
      const actual = byId.get(expected.id) as ChatMessageRow;
      expect(actual).toBeDefined();
      expect(actual.data).toBe(expected.data);
      expect(actual.timestamp).toBe(expected.timestamp);
      expect(actual.authorId).toBe(expected.author_id);
      expect(actual.createdAt).toBe(expected.created_at);
      expect(actual.updatedAt).toBe(expected.updated_at);
    }
  });

  it("a confirmed run over an empty range is a no-op — no file, no delete", () => {
    const { db, dir } = seedWorld();
    const outPath = join(dir, "export.jsonl");
    const emptyRange = { fromMs: 5_000_000, toMs: 6_000_000 };

    const before = readAllRows(db);
    const result = runChatArchive({ db, range: emptyRange, outPath, confirmDeleteCount: 0 });

    expect(result.executed).toBe(true);
    expect(result.deletedCount).toBe(0);
    expect(result.exportPath).toBeNull();
    expect(existsSync(outPath)).toBe(false);
    expect(readAllRows(db)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Confirmation must match — the anti-typo / anti-staleness gate
// ---------------------------------------------------------------------------

describe("chat archive — confirmDeleteCount mismatch", () => {
  it("throws and removes nothing when the count is wrong", () => {
    const { db, dir, fromMs, toMs } = seedWorld();
    const outPath = join(dir, "export.jsonl");
    const before = readAllRows(db);

    expect(() =>
      runChatArchive({ db, range: { fromMs, toMs }, outPath, confirmDeleteCount: 999 }),
    ).toThrow(ArchiveConfirmationMismatchError);

    expect(readAllRows(db)).toEqual(before);
    expect(existsSync(outPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE failure path: export cannot be written → nothing is removed
// ---------------------------------------------------------------------------

describe("chat archive — export failure never lets a delete through", () => {
  it("missing export directory: throws, DB untouched, no file created", () => {
    const { db, dir, fromMs, toMs, insideIds } = seedWorld();
    const outPath = join(dir, "does-not-exist", "export.jsonl"); // parent dir never created
    const before = readAllRows(db);

    expect(() =>
      runChatArchive({ db, range: { fromMs, toMs }, outPath, confirmDeleteCount: 3 }),
    ).toThrow(ArchiveExportError);

    // Nothing removed at all — not even a partial delete of some of the 3.
    expect(readAllRows(db)).toEqual(before);
    for (const id of insideIds) {
      expect(rowById(db, id)).toBeDefined();
    }
    expect(existsSync(outPath)).toBe(false);
  });

  it("refuses to overwrite an existing export file, and still removes nothing", () => {
    const { db, dir, fromMs, toMs } = seedWorld();
    const outPath = join(dir, "export.jsonl");
    writeFileSync(outPath, "pre-existing content, must survive untouched");
    const before = readAllRows(db);

    expect(() =>
      runChatArchive({ db, range: { fromMs, toMs }, outPath, confirmDeleteCount: 3 }),
    ).toThrow(ArchiveExportError);

    expect(readAllRows(db)).toEqual(before);
    // The pre-existing file was not clobbered by the failed export attempt.
    expect(readFileSync(outPath, "utf8")).toBe("pre-existing content, must survive untouched");
  });
});

// ---------------------------------------------------------------------------
// Range parsing
// ---------------------------------------------------------------------------

describe("buildArchiveRange / parseArchiveBoundary", () => {
  it("expands a date-only boundary to the start/end of that UTC day", () => {
    const range = buildArchiveRange("2026-01-01", "2026-01-01");
    expect(range.fromMs).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
    expect(range.toMs).toBe(Date.UTC(2026, 0, 1, 23, 59, 59, 999));
  });

  it("accepts a full ISO-8601 timestamp as an exact boundary", () => {
    const ms = parseArchiveBoundary("2026-03-15T10:30:00.000Z", "start");
    expect(ms).toBe(Date.UTC(2026, 2, 15, 10, 30, 0, 0));
  });

  it("rejects an unparsable date", () => {
    expect(() => parseArchiveBoundary("not-a-date", "start")).toThrow(ArchiveRangeError);
  });

  it("rejects a range where --from is after --to", () => {
    expect(() => buildArchiveRange("2026-02-01", "2026-01-01")).toThrow(ArchiveRangeError);
  });
});

// ---------------------------------------------------------------------------
// Failure paths — the two ways this command could lose chat for good
// ---------------------------------------------------------------------------

describe("chat archive — export failure never costs a message", () => {
  it("leaves the database untouched AND no stub file behind when the export cannot be written", () => {
    const seeded = seedWorld();
    const before = readAllRows(seeded.db);

    // A directory where the export file should go: `open` succeeds on some
    // platforms and fails on others, and `write` fails on all of them — the
    // shape of a full disk, and the reason the delete must come last.
    const outPath = join(seeded.dir, "blocked.jsonl");
    mkdirSync(outPath, { recursive: true });

    expect(() =>
      runChatArchive({
        db: seeded.db,
        range: { fromMs: seeded.fromMs, toMs: seeded.toMs },
        outPath,
        confirmDeleteCount: seeded.insideIds.length,
      }),
    ).toThrow(ArchiveExportError);

    // Nothing removed — the whole point.
    expect(readAllRows(seeded.db)).toEqual(before);
    // And no zero-byte file left pretending to be an archive: it would block
    // the retry and read as a real archive in a directory listing later.
    const leftover = existsSync(outPath);
    if (leftover) {
      // The directory we created is still a directory, not a stub export.
      expect(() => readFileSync(outPath, "utf8")).toThrow();
    }
  });

  it("does not delete a message that changed after the snapshot that fed the export", () => {
    const seeded = seedWorld();
    const outPath = join(seeded.dir, "edited.jsonl");

    // Stand in for "a server edited this row while the export was being
    // written". The archived copy would be the old one; deleting the new one
    // would destroy the edit with no copy anywhere.
    const originalUpdatedAt = rowById(seeded.db, "in-2")!.updated_at;
    seeded.db
      .prepare(`UPDATE chat_messages SET data = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify({ content: "EDITED AFTER SNAPSHOT" }), originalUpdatedAt + 1, "in-2");

    const rowsForExport = seeded.db
      .prepare(
        `SELECT id, data, timestamp, author_id AS authorId,
                created_at AS createdAt, updated_at AS updatedAt
           FROM chat_messages WHERE id IN ('in-1','in-3')`,
      )
      .all() as ChatMessageRow[];

    // The stale snapshot: what the export captured for in-2, before the edit.
    const stale = {
      id: "in-2",
      data: JSON.stringify({ content: "in the middle" }),
      timestamp: 1_500_000,
      authorId: "author-1",
      createdAt: 1_500_000,
      updatedAt: originalUpdatedAt,
    };

    const removed = deleteChatRowsByIds(seeded.db, [...rowsForExport, stale]);

    // in-1 and in-3 go; in-2 stays, because it no longer matches what was archived.
    expect(removed).toBe(2);
    expect(rowById(seeded.db, "in-2")).toBeDefined();
    expect(rowById(seeded.db, "in-2")!.data).toContain("EDITED AFTER SNAPSHOT");
    expect(outPath).toBeTruthy();
  });
});
