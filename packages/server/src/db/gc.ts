/**
 * GC — retention-driven cleanup of implementation leftovers (T017, D5).
 *
 * D5 draws a hard line: chat is the table's memory and never disappears on
 * its own; `sessions` and `roll_audit_log` are implementation leftovers that
 * outlive their usefulness and MAY be swept automatically. This module is the
 * one place that line is enforced in code — it never references
 * `chat_messages`, and if a future target needs collecting it must be added
 * here explicitly, never inferred from "every table".
 *
 * Two targets, one report, one transaction:
 *   - `sessions`      — rows whose `expires_at` is more than
 *                        `sessionRetentionDays` days in the past.
 *   - `roll_audit_log` — rows whose `created_at` is more than
 *                        `auditRetentionMonths` calendar months in the past.
 *
 * Boundary rule (both targets): "more than N days/months" is STRICT. A row
 * exactly at the boundary (age == N) is kept — only rows strictly older than
 * the window are removed. See `sessionCutoff`/`monthsAgoMs`.
 *
 * Disabling a target: `sessionRetentionDays`/`auditRetentionMonths` of `0`,
 * a negative number, `null`, or `undefined` means "do not collect this
 * target" — never "collect everything". A misconfigured 0 must not become a
 * silent full wipe (the classic bug in this family of features).
 */

import type { Database as Db } from "better-sqlite3";
import { runOptimize } from "./maintenance.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GcOptions {
  /**
   * Days after a session's `expires_at` before it becomes eligible for
   * removal. A session is evaluated on its natural TTL boundary
   * (`expires_at`), not on `created_at` or `revoked_at`: a session revoked
   * early but not yet past `expires_at` is NOT "expired" under D5's wording
   * and is deliberately kept — revocation and expiry are different events,
   * and only expiry is what this GC acts on.
   *
   * `0`, a negative number, `null` or `undefined` disables session
   * collection entirely.
   */
  sessionRetentionDays?: number | null;
  /**
   * Calendar months after a roll's `created_at` before it becomes eligible
   * for removal.
   *
   * `0`, a negative number, `null` or `undefined` disables audit-log
   * collection entirely.
   */
  auditRetentionMonths?: number | null;
  /** Injectable clock for deterministic tests. Defaults to `Date.now()`. */
  now?: number;
}

export interface GcTargetResult {
  /** Table this result covers. */
  table: "sessions" | "roll_audit_log";
  /** Rows deleted in this run. */
  deleted: number;
  /** True when the target was disabled (retention <= 0 or null/undefined) — `deleted` is always 0 in that case. */
  skipped: boolean;
}

export interface GcReport {
  sessions: GcTargetResult;
  rollAuditLog: GcTargetResult;
}

// ---------------------------------------------------------------------------
// Cutoff computation
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A retention value that should disable collection: absent, non-positive.
 * Centralised so both targets apply the exact same "disabled" rule.
 */
/**
 * A retention of zero, negative or absent means "do not collect" — never
 * "collect everything". The predicate is a plain boolean on purpose: it also
 * answers true for 0, so narrowing the argument to `null | undefined` would be
 * a lie in code whose job is to delete rows.
 */
function isDisabled(retention: number | null | undefined): boolean {
  return (
    retention === null || retention === undefined || !Number.isFinite(retention) || retention <= 0
  );
}

/**
 * Epoch ms strictly before which a session counts as "expired more than
 * `days` days ago". A session whose `expires_at` equals this cutoff is
 * exactly `days` days expired — not MORE than `days` — and is kept.
 */
function sessionCutoff(nowMs: number, days: number): number {
  return nowMs - days * MS_PER_DAY;
}

/**
 * Epoch ms `months` calendar months before `nowMs`, computed via UTC
 * calendar-field subtraction (not a fixed 30-day multiplier) so a 12-month
 * retention window means what a human means by "a year ago today", not an
 * approximation that drifts across months of different lengths. UTC is used
 * throughout (never the host's local timezone) because every timestamp
 * stored in this database is a UTC epoch-ms value — a local-time subtraction
 * would shift the cutoff by the host's UTC offset for no reason tied to the
 * data itself.
 *
 * Known JS `Date` quirk, accepted as-is: subtracting months from a
 * day-of-month that does not exist in the target month (e.g. Mar 31 minus 1
 * month) rolls forward into the following month rather than clamping to the
 * target month's last day. Immaterial at a 12-month default granularity.
 */
function monthsAgoMs(nowMs: number, months: number): number {
  const d = new Date(nowMs);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() - months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

// ---------------------------------------------------------------------------
// runGc
// ---------------------------------------------------------------------------

/**
 * Collect expired sessions and stale roll-audit-log rows.
 *
 * Runs both deletes inside a single `db.transaction(fn).immediate()` (the
 * pattern this repo standardised on in `documents/store.ts`): either the
 * whole GC pass commits, or none of it does — a process crash mid-run cannot
 * leave the database with one target swept and the other half-done.
 *
 * `chat_messages` is never referenced by this function, by design (D5).
 */
export function runGc(db: Db, options: GcOptions = {}): GcReport {
  const now = options.now ?? Date.now();

  const run = db.transaction((): GcReport => {
    const sessions = collectSessions(db, options.sessionRetentionDays, now);
    const rollAuditLog = collectRollAuditLog(db, options.auditRetentionMonths, now);
    return { sessions, rollAuditLog };
  });

  const report = run.immediate();

  // Refresh planner statistics after a pass that actually removed rows, and
  // only then: SQLite's own heuristic for re-analysing a table is "row count
  // moved by roughly 10x", which is exactly what clearing out months of
  // sessions or audit rows does. Outside the transaction, because ANALYZE
  // writes to sqlite_stat1 and has no business extending the delete's lock.
  if (report.sessions.deleted > 0 || report.rollAuditLog.deleted > 0) {
    runOptimize(db);
  }

  return report;
}

function collectSessions(
  db: Db,
  retentionDays: number | null | undefined,
  now: number,
): GcTargetResult {
  if (retentionDays == null || isDisabled(retentionDays)) {
    return { table: "sessions", deleted: 0, skipped: true };
  }

  const cutoff = sessionCutoff(now, retentionDays);
  const result = db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(cutoff);
  return { table: "sessions", deleted: result.changes, skipped: false };
}

function collectRollAuditLog(
  db: Db,
  retentionMonths: number | null | undefined,
  now: number,
): GcTargetResult {
  if (retentionMonths == null || isDisabled(retentionMonths)) {
    return { table: "roll_audit_log", deleted: 0, skipped: true };
  }

  const cutoff = monthsAgoMs(now, retentionMonths);
  const result = db.prepare(`DELETE FROM roll_audit_log WHERE created_at < ?`).run(cutoff);
  return { table: "roll_audit_log", deleted: result.changes, skipped: false };
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

/**
 * Format a `GcReport` into a single human-readable line, or `null` when
 * nothing was removed. Callers (e.g. `WorldManager.open()`) use this to
 * avoid writing a boot-log line on the common case where GC had nothing to
 * do — only a run that actually changed the database is worth a line.
 */
export function formatGcReport(report: GcReport): string | null {
  const parts: string[] = [];
  if (report.sessions.deleted > 0) {
    parts.push(`${String(report.sessions.deleted)} expired session(s)`);
  }
  if (report.rollAuditLog.deleted > 0) {
    parts.push(`${String(report.rollAuditLog.deleted)} stale roll-audit-log row(s)`);
  }
  if (parts.length === 0) return null;
  return `[fusion:gc] removed ${parts.join(", ")}`;
}
