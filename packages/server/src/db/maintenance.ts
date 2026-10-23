/**
 * File maintenance for world databases (T018, docs/design/banco-de-dados/tasks.md).
 *
 * The task's original wording lists three mechanisms — `PRAGMA optimize` on
 * close, a periodic `ANALYZE`, and an incremental vacuum after a large GC.
 * Investigating each against SQLite's own documentation and against the real
 * `teste_xande` world database left only ONE of the three standing:
 *
 *  1. **`PRAGMA optimize` — implemented, as `runOptimize` below.**
 *     SQLite's own guidance (sqlite.org/pragma.html#pragma_optimize) is to run
 *     it once when a short-lived connection closes, which is exactly Fusion's
 *     connection lifetime: `openDatabase`/`FusionDatabase.close()` bracket one
 *     world session, not a long-running daemon connection. Measured cost
 *     (see `db-maintenance.test.ts`): ~4ms on the real `teste_xande` copy
 *     (70 pages) the FIRST time it ever runs (building `sqlite_stat1` from
 *     scratch), ~40ms on a synthetic 500k-row/78MB `chat_messages` table — far
 *     larger than any real Fusion world today — also only on the very first
 *     call. Every call after that, including across a fresh connection that
 *     simulates a server reboot, measured under 0.3ms because SQLite's
 *     heuristic skips tables whose row count has not moved by roughly 10x
 *     since the stats were last written. None of this is perceptible in the
 *     GM's shutdown path.
 *
 *  2. **Periodic `ANALYZE` — NOT implemented. Redundant with (1).**
 *     `PRAGMA optimize` exists specifically so applications stop needing a
 *     separately scheduled `ANALYZE`: SQLite's docs describe it as the
 *     "recommended way of running ANALYZE" since 3.46.0. (It picks which tables
 *     to refresh; how much of each is bounded by `analysis_limit`, which
 *     `runOptimize` sets — see the note there.) Running both would mean running the
 *     same underlying statistics refresh twice for no additional benefit.
 *     Adding a second, independently-scheduled trigger (a boot counter, a
 *     write counter) would only add a class of bug — two schedules to keep in
 *     sync — for zero behavioural gain over calling `runOptimize` on close
 *     (below) and after `gc.ts`'s deletes (see the note on that function).
 *
 *  3. **Incremental vacuum after a large GC — NOT implemented. Confirmed no-op.**
 *     `PRAGMA incremental_vacuum` only does anything when the database's
 *     `auto_vacuum` mode is `INCREMENTAL`. Verified by executing against a
 *     `VACUUM INTO` copy of the real `~/.fusion/worlds/teste_xande/world.db`
 *     AND against a brand-new database produced by this build's migrations:
 *     both report `PRAGMA auto_vacuum` = `0` (NONE, SQLite's default) — none
 *     of the eight migrations ever sets it. Calling `incremental_vacuum`
 *     against either would be a documented no-op.
 *     Turning it on is not a small addition: SQLite only lets `auto_vacuum`
 *     be set on a database with *no tables yet*, so enabling it for existing
 *     worlds (`teste_xande` included) requires a full `VACUUM` — a blocking,
 *     whole-file rewrite, not an incremental one — while enabling it only for
 *     *new* worlds would leave every existing world's file un-reclaimed after
 *     GC forever. Either choice is a real product decision (pay a one-time
 *     full-file rewrite now, on every existing world, for a long-run
 *     reduction in commit size vs. leave file growth as one of the costs of
 *     "chat is never deleted automatically", D5) that this task was not
 *     authorized to make silently — flagged in the batch report instead of
 *     guessed at here.
 */

import type { Database as Db } from "better-sqlite3";

/**
 * Ask SQLite to refresh query-planner statistics if — and only if — its own
 * heuristics judge it worthwhile (see the module docstring, item 1).
 *
 * Safe to call unconditionally:
 *  - On a `readonly`-opened connection it completes without writing anything
 *    and without throwing (verified empirically — PRAGMA optimize swallows
 *    the write failure internally rather than propagating it).
 *  - On a database with nothing to analyze (no tables yet, or no drift since
 *    the last run) it is a fast no-op.
 * Wrapped in try/catch regardless, so a truly unexpected failure (e.g. a
 * locked or corrupted file slipping through) can never abort the caller's
 * critical path — matching the existing best-effort `wal_checkpoint` in
 * `connection.ts`'s `close()`.
 *
 * Call sites:
 *  - `connection.ts`'s `close()` calls this once per world session, right
 *    before the final WAL checkpoint (so any `sqlite_stat1` write this makes
 *    rides along in that same checkpoint instead of triggering a second one).
 *  - `gc.ts` (T017) should call this once after a GC pass that deleted a
 *    meaningful number of rows — SQLite's own heuristic for whether to
 *    re-ANALYZE a table is exactly "row count changed by ~10x since last
 *    analysis", which is precisely what a large session/audit-log GC does to
 *    `sessions` / `roll_audit_log`.
 */
export function runOptimize(db: Db): void {
  try {
    // `analysis_limit` caps how many index rows ANALYZE samples per index.
    // It defaults to 0, which means NO limit — `PRAGMA optimize` is only
    // "self-limiting" in choosing *which* tables to analyse, not how much of
    // each. Measured on a 1M-row chat_messages table with a cold cache, the
    // unbounded form took ~2.8s; with the limit, ~120ms. That difference lands
    // squarely on the GM closing the app, and `chat_messages` is the table D5
    // guarantees will grow forever. 400 is the value SQLite's own docs pair
    // with `optimize`, and sampling is enough: the planner needs the shape of
    // the distribution, not an exact census.
    db.pragma("analysis_limit=400");
    db.pragma("optimize");
  } catch {
    // Best-effort — see docstring. A stats refresh must never block a close
    // or a GC pass.
  }
}
