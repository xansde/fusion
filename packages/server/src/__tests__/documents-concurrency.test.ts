/**
 * Concurrency regression tests for T012 (transaction around the DocumentStore
 * read-modify-write path).
 *
 * better-sqlite3 is synchronous and crashes under worker_threads (this
 * package's vitest config uses pool: forks for exactly that reason), and a
 * synchronous call blocks the WHOLE JS thread — so two connections can only
 * genuinely contend for the same SQLite lock from two REAL OS processes; two
 * connections living in this one test process could never reproduce the
 * race (whichever one blocks waiting for the lock would also block the only
 * thread that could ever run the other one's release). See
 * `fixtures/concurrency-worker.mjs` for "papel A" — spawned via
 * child_process.fork, importing the already-built dist (no ts-node/tsx in
 * this package). "Papel B" is the real DocumentStore public API, called
 * directly in this test process.
 *
 * Each test:
 *   1. Seeds a document through the real store.
 *   2. Starts the worker, which opens its own connection to the SAME
 *      world.db, takes a real `BEGIN IMMEDIATE` lock, and reports back over
 *      IPC the instant the lock is held.
 *   3. Waits ~50ms (the lock is held for ~200ms), then calls the public API
 *      under test — this call genuinely blocks on the OS-level SQLite lock
 *      until the worker commits.
 *   4. Asserts on the resulting DATA / error type, not on timing.
 *
 * Every case here was verified to fail against the pre-T012 code (read
 * outside the transaction, batches running DEFERRED) by temporarily
 * reverting store.ts and re-running — see the PR description / task report
 * for the failure output; left out of this file so the suite doesn't ship a
 * deliberately-broken code path.
 */

import { describe, it, expect, afterEach } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import {
  DocumentStore,
  DocumentNotFoundError,
  DocumentIdCollisionError,
} from "../documents/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = join(__dirname, "fixtures", "concurrency-worker.mjs");

// How long papel A holds the IMMEDIATE lock, and how long papel B waits
// after confirmed lock-acquisition before calling the real API. The 150ms
// margin between them is the safety net against CI jitter — the assertions
// are on data/error-type, never on elapsed time.
const HOLD_MS = 200;
const START_DELAY_MS = 50;

interface WorkerConfig {
  dbPath: string;
  table: string;
  docId: string;
  action: "update" | "insert" | "delete";
  holdMs: number;
  field?: string;
  value?: unknown;
  insertDoc?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-concurrency-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function openTestDb(dir: string): { db: FusionDatabase; path: string } {
  const path = join(dir, "world.db");
  const db = openDatabase({ path, skipIntegrityCheck: true });
  applyMigrations(db.raw, path);
  return { db, path };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const tempDirs: string[] = [];
const liveChildren: ChildProcess[] = [];

afterEach(async () => {
  for (const child of liveChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }
  }
  // Windows: a just-killed child can hold its file handle on world.db open
  // for a beat after the kill signal — a directory removal that races it
  // fails with EBUSY (reproduced during development of this test).
  await sleep(150);
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort — a leftover temp dir is harmless */
    }
  }
});

/** Starts papel A and resolves once its BEGIN IMMEDIATE has returned (lock genuinely held). */
function startWorkerAndWaitForLock(config: WorkerConfig): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER_SCRIPT, [JSON.stringify(config)]);
    liveChildren.push(child);

    const timeout = setTimeout(() => {
      reject(new Error("worker did not report txn-started within 5s"));
    }, 5000);

    child.stderr?.on("data", (chunk: Buffer) => {
      // Surfaced only for debugging a failing run — the worker is expected
      // to be silent on success.
      console.error(`[concurrency-worker stderr] ${chunk.toString()}`);
    });

    child.on("message", (msg: unknown) => {
      const m = msg as { type: string; message?: string };
      if (m.type === "txn-started") {
        clearTimeout(timeout);
        resolve(child);
      } else if (m.type === "error") {
        clearTimeout(timeout);
        reject(new Error(`worker reported error: ${String(m.message)}`));
      }
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("exit", (code) => resolve(code ?? -1));
    child.once("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DocumentStore concurrency (T012 — IMMEDIATE transaction around read-modify-write)", () => {
  it("update: a concurrent writer's change survives store.update() — no lost update", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { db, path } = openTestDb(dir);
    const store = new DocumentStore({ db: db.raw });

    const created = store.create("actors", { name: "Goblin", type: "npc" });
    const docId = created["_id"] as string;

    // Papel A: holds the lock, then sets `sort` (field X) after HOLD_MS.
    const worker = await startWorkerAndWaitForLock({
      dbPath: path,
      table: "actors",
      docId,
      action: "update",
      holdMs: HOLD_MS,
      field: "sort",
      value: 42,
    });

    await sleep(START_DELAY_MS);

    // Papel B: the real API, setting `img` (field Y) on the same document.
    // This call blocks on the OS-level SQLite lock until the worker commits.
    const updated = store.update("actors", docId, { img: "https://example.com/b.png" });

    const exitCode = await waitForExit(worker);
    expect(exitCode).toBe(0);

    // Primary assertion: BOTH changes present — A's write was not clobbered.
    expect(updated).not.toBeNull();
    expect(updated?.["img"]).toBe("https://example.com/b.png");
    expect(updated?.["sort"]).toBe(42);

    const final = store.get("actors", docId);
    expect(final["sort"]).toBe(42);
    expect(final["img"]).toBe("https://example.com/b.png");

    db.close();
  }, 15000);

  it("create: a concurrent insert of the same id surfaces DocumentIdCollisionError, not a raw SQLite error", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { db, path } = openTestDb(dir);
    const store = new DocumentStore({ db: db.raw });

    const docId = "concurTestId0001"; // exactly 16 [A-Za-z0-9] chars

    // Papel A: inserts a NEW row under this id directly (bypassing the
    // store), only after HOLD_MS — while holding the lock the whole time.
    const worker = await startWorkerAndWaitForLock({
      dbPath: path,
      table: "actors",
      docId,
      action: "insert",
      holdMs: HOLD_MS,
      insertDoc: { _id: docId, name: "GM-inserted-first", type: "npc", marker: "A" },
    });

    await sleep(START_DELAY_MS);

    // Papel B: store.create() with the SAME id. Pre-T012, the collision
    // check ran before any transaction, would see "not found" (A had not
    // inserted yet), and only the raw INSERT — blocked on A's lock — would
    // eventually hit a bare SQLite UNIQUE-constraint error once A committed.
    let caught: unknown;
    try {
      store.create("actors", { _id: docId, name: "Should-collide", type: "npc" });
    } catch (err) {
      caught = err;
    }

    const exitCode = await waitForExit(worker);
    expect(exitCode).toBe(0);

    expect(caught).toBeInstanceOf(DocumentIdCollisionError);

    // A's document must have survived untouched — B never got to write.
    const final = store.get("actors", docId);
    expect(final["name"]).toBe("GM-inserted-first");

    db.close();
  }, 15000);

  it("delete: a document already removed by a concurrent writer is reported as not found — never a false success", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { db, path } = openTestDb(dir);
    const store = new DocumentStore({ db: db.raw });

    const created = store.create("actors", { name: "Goblin", type: "npc" });
    const docId = created["_id"] as string;

    // Papel A: holds the lock, then actually deletes the row after HOLD_MS.
    const worker = await startWorkerAndWaitForLock({
      dbPath: path,
      table: "actors",
      docId,
      action: "delete",
      holdMs: HOLD_MS,
    });

    await sleep(START_DELAY_MS);

    // Papel B: store.delete() on the same id. Pre-T012, the existence
    // check ran unguarded before any transaction and — in WAL mode, reads
    // are never blocked by a writer's lock — would see the row as still
    // present (A had not deleted it yet), pass the check, then have its
    // own (now no-op) DELETE silently succeed once A's lock released:
    // a false-positive "deleted" for a document B never actually removed.
    let caught: unknown;
    try {
      store.delete("actors", docId);
    } catch (err) {
      caught = err;
    }

    const exitCode = await waitForExit(worker);
    expect(exitCode).toBe(0);

    expect(caught).toBeInstanceOf(DocumentNotFoundError);
    expect(() => store.get("actors", docId)).toThrow(DocumentNotFoundError);

    db.close();
  }, 15000);

  it("updateBatch: a concurrent writer's change survives a batch touching the same document — no BUSY_SNAPSHOT abort", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { db, path } = openTestDb(dir);
    const store = new DocumentStore({ db: db.raw });

    const created = store.create("actors", { name: "Goblin", type: "npc" });
    const docId = created["_id"] as string;

    // Papel A: holds the lock, then sets `sort` (field X) after HOLD_MS.
    const worker = await startWorkerAndWaitForLock({
      dbPath: path,
      table: "actors",
      docId,
      action: "update",
      holdMs: HOLD_MS,
      field: "sort",
      value: 99,
    });

    await sleep(START_DELAY_MS);

    // Papel B: a 1-item updateBatch setting `img` (field Y) on the same
    // document. Pre-T012, this ran DEFERRED: its read (inside
    // _updateInTxn) took a snapshot BEFORE A committed, then its write
    // blocked on A's lock and — once A committed, invalidating that
    // snapshot — failed with SQLITE_BUSY_SNAPSHOT, which busy_timeout does
    // not retry: the whole batch aborted instantly instead of waiting.
    const results = store.updateBatch("actors", [
      { _id: docId, img: "https://example.com/batch.png" },
    ]);

    const exitCode = await waitForExit(worker);
    expect(exitCode).toBe(0);

    expect(results).toHaveLength(1);
    expect(results[0]).not.toBeNull();
    expect(results[0]?.["img"]).toBe("https://example.com/batch.png");
    expect(results[0]?.["sort"]).toBe(99);

    const final = store.get("actors", docId);
    expect(final["sort"]).toBe(99);
    expect(final["img"]).toBe("https://example.com/batch.png");

    db.close();
  }, 15000);
});
