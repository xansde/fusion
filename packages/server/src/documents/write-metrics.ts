/**
 * WriteMetricsCollector — in-memory accounting of DocumentStore row writes
 * (T016).
 *
 * WHY THIS EXISTS
 * ---------------
 * The "hot state" decision (token in the scene row vs. a table of its own, HP
 * in the sheet vs. elsewhere) is deliberately deferred until there are real
 * numbers from a real session. This collector produces those numbers:
 *
 *   - how OFTEN the store writes (per minute, per table), which — because
 *     every store write runs in an IMMEDIATE transaction (T012) — is also how
 *     much of the minute the database-wide write lock is held;
 *   - how MANY BYTES each write rewrites (`rowBytes`) next to how many bytes
 *     of it were actually NEW (`deltaBytes`), i.e. write amplification
 *     measured instead of estimated;
 *   - how LONG the SQL write took (p50/p95), the per-event cost the GM feels
 *     as lag and every concurrent writer waits behind;
 *   - WHICH embedded collection the write is attributable to (`byPatchKey`),
 *     so "pressure from tokens" can be told apart from "pressure from walls/
 *     lights/door state", which all live in the very same `scenes` row.
 *
 * WHY `deltaBytes` IS NOT "THE PATCH THE HANDLER SENT"
 * ---------------------------------------------------
 * Every embedded-collection writer in this server resends the WHOLE array:
 * `token:move` calls `store.update(scenes, id, { tokens: <all tokens> })`, and
 * `scene:doorState` does the same with `{ walls: <all walls> }`. Measuring the
 * patch's own byte length would therefore make the denominator grow in step
 * with the numerator — a 30-token scene would report an amplification near
 * 1.0 precisely when the real amplification is at its worst, and whoever read
 * the log would conclude "no amplification here, keep tokens embedded": the
 * wrong decision, taken with the number this module exists to produce.
 *
 * So `deltaBytes` is the SEMANTIC delta (see `semanticDeltaBytes`): the
 * minimal diff the store already computed, with array values narrowed to the
 * elements that actually changed. Moving one token in a 30-token scene counts
 * that one token, not thirty.
 *
 * KNOWN ATTRIBUTION LIMIT
 * -----------------------
 * `byPatchKey` cannot show a `doorState` bucket: `scene:doorState` persists
 * through `{ walls: [...] }`, so opening a door is counted as `walls`, the
 * same as editing wall geometry. The split that matters for the deferred
 * decision — token vs. everything else in the same row — is unaffected.
 *
 * WHY IT ACCUMULATES INSTEAD OF LOGGING EACH WRITE
 * ------------------------------------------------
 * The file destination is `sync: true` (logger.ts): one log line per write
 * would put a synchronous `fs.writeSync` on the hot path and bury the day's
 * log under hundreds of lines per session. Instead this accumulates in memory
 * and emits ONE structured line per flush — periodically (every 5 min) and
 * once more when the world closes.
 *
 * The collector is deliberately unaware of who called the store: it is fed
 * from inside `_updateInTxn`/`_createInTxn`, the two private funnels every
 * writer converges on (see store.ts).
 *
 * WHAT IS AND IS NOT IN THE NUMBERS
 * ---------------------------------
 * See `WRITE_METRICS_SCOPE`, which is stamped on every log line: this counts
 * DocumentStore row writes and nothing else. Deletes, and the raw-SQL writers
 * of `settings`/`chat_messages`/`users`, take the same IMMEDIATE lock without
 * appearing here — `SeqStore.next()` alone writes `settings` once per
 * broadcast, so the true number of write transactions in a minute is strictly
 * higher than `writesPerMinute`. Read it as a floor, not a total.
 */

import type { DocumentTable } from "@fusion/shared";
import type { Logger } from "../logger.js";
import { deepEqual } from "./merge.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** One persisted row write, as reported from inside the store's transaction. */
export interface WriteMetricsEvent {
  /** Which store operation produced the write. */
  op: "create" | "update";
  /** Table the row lives in. */
  table: DocumentTable;
  /**
   * Keys the write is attributable to, for `byPatchKey`. For an update these
   * are the patch's top-level keys; for a create, the embedded collections the
   * new document arrives with (see `embeddedCollectionKeys`).
   */
  patchKeys: readonly string[];
  /** Bytes of the FULL row body written to the `data` column. */
  rowBytes: number;
  /**
   * Bytes of what actually CHANGED — not of the patch the caller sent. See
   * `semanticDeltaBytes` and the header note; on a create it equals
   * `rowBytes`, because a create's payload is the whole row.
   */
  deltaBytes: number;
  /** Duration of the SQL statement itself, from `process.hrtime.bigint()`. */
  latencyNs: bigint;
}

/** Per-table slice of a flush report. */
export interface WriteMetricsTableReport {
  count: number;
  /**
   * Split of `count` by operation. Not in the original report sketch, and
   * present for one concrete reason: a create's whole row IS its payload, so
   * its amplification is 1 by construction. Without this split, a window that
   * happens to contain many creates shows a deflated `amplificationRatio` and
   * nothing in the line says why.
   */
  byOp: { create: number; update: number };
  rowBytesTotal: number;
  rowBytesAvg: number;
  deltaBytesAvg: number;
  /** `rowBytesAvg / deltaBytesAvg`, or null when no delta bytes were seen. */
  amplificationRatio: number | null;
  latencyMsP50: number;
  latencyMsP95: number;
  /** How many writes of this table carried each attributable key. */
  byPatchKey: Record<string, number>;
}

/** One flush window, exactly as it is logged. */
export interface WriteMetricsReport {
  /** Real length of the window — a final flush is a partial window. */
  windowMinutes: number;
  writesPerMinute: { avg: number; peakMinute: number };
  byTable: Record<string, WriteMetricsTableReport>;
}

export interface WriteMetricsCollectorOptions {
  logger: Logger;
  /** World the metrics belong to; echoed on every log line. */
  worldId: string;
  /**
   * Periodic flush interval. Pass 0 to disable the timer entirely (the world
   * close still flushes) — used by tests that must not have a flush landing in
   * the middle of a measurement.
   */
  flushIntervalMs?: number;
  /** Defensive ceiling on retained latency samples, per table. */
  maxLatencySamplesPerTable?: number;
  /** Defensive ceiling on distinct `byPatchKey` buckets, per table. */
  maxPatchKeysPerTable?: number;
}

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Flush cadence: one report line every 5 minutes of session. */
export const DEFAULT_FLUSH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Latency samples kept per table per window.
 *
 * Percentiles need the raw samples, and an unbounded array is a slow leak in a
 * process that stays up for a whole evening (and longer, if a flush ever
 * fails). 4096 was chosen because a window would have to sustain ~13.6
 * writes/second for five minutes straight to reach it — two orders of
 * magnitude above the ~3 writes/MINUTE the T016 probe measured for real play —
 * so in practice the cap never binds and p50/p95 are exact. It costs 32 KB per
 * table in the worst case (4096 doubles), which is nothing, while still
 * refusing to grow without limit under a pathological writer (a bulk import
 * driven through the store, say).
 *
 * Beyond the cap, samples are kept by reservoir sampling (Algorithm R) rather
 * than "keep the first 4096": the latter would describe only the beginning of
 * the window, which is exactly the wrong half when the interesting event is a
 * slowdown that builds up.
 */
export const DEFAULT_MAX_LATENCY_SAMPLES = 4096;

/**
 * Distinct `byPatchKey` buckets kept per table per window. Patch keys are
 * client-influenced (they are the patch's own top-level keys, read before the
 * document is validated), so the map is capped and everything past the cap is
 * counted under `OTHER_PATCH_KEY`. Real documents have well under 64 top-level
 * fields, so the cap is invisible in normal operation.
 */
export const DEFAULT_MAX_PATCH_KEYS = 64;

/** Bucket that absorbs patch keys past `maxPatchKeysPerTable`. */
export const OTHER_PATCH_KEY = "(other)";

/**
 * Embedded collections a write can be attributed to on the CREATE path.
 *
 * On update the attribution is simply the patch's top-level keys, which
 * already names `tokens`/`walls`/`lights`/`doorState`/… naturally. A create
 * carries every field of the document, so listing them all would drown the
 * report; only the embedded collections matter for the question T016 exists to
 * answer — "a `doc:create` of a Scene with tokens embedded is token pressure
 * too", which is the path a whole-scene create takes.
 */
export const EMBEDDED_COLLECTION_KEYS: readonly string[] = [
  "tokens",
  "items",
  "combatants",
  "walls",
  "lights",
];

/**
 * The embedded collections a freshly created document arrives with, as
 * `patchKeys` for a create event. Empty collections are left out: a scene
 * created with `tokens: []` is not token pressure.
 */
export function embeddedCollectionKeys(document: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const key of EMBEDDED_COLLECTION_KEYS) {
    const value = document[key];
    if (Array.isArray(value) && value.length > 0) keys.push(key);
  }
  return keys;
}

/**
 * Stamped on every log line so the numbers cannot be read as "all database
 * writes". They are not: they are DocumentStore create/update writes only.
 */
export const WRITE_METRICS_SCOPE = {
  includes: ["document-store create", "document-store update"],
  excludes: [
    "document-store delete",
    "raw-sql: settings (SeqStore.next, once per broadcast)",
    "raw-sql: chat_messages",
    "raw-sql: users",
  ],
} as const;

// ---------------------------------------------------------------------------
// Semantic delta
// ---------------------------------------------------------------------------

/**
 * The elements of `next` that are absent from or different in `previous`.
 *
 * Embedded documents carry a stable `_id`, so elements are matched by id and
 * a reorder is not mistaken for a change; elements without one fall back to
 * their position. An element that DISAPPEARED contributes nothing: a removal
 * carries no new bytes, only the fact of the removal.
 */
function changedElements(previous: readonly unknown[], next: readonly unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  for (const element of previous) {
    const id = embeddedElementId(element);
    if (id !== null) byId.set(id, element);
  }

  const changed: unknown[] = [];
  for (let i = 0; i < next.length; i += 1) {
    const element = next[i];
    const id = embeddedElementId(element);
    const before = id !== null ? byId.get(id) : previous[i];
    if (!deepEqual(before, element)) changed.push(element);
  }
  return changed;
}

function embeddedElementId(element: unknown): string | null {
  if (element === null || typeof element !== "object" || Array.isArray(element)) return null;
  const id = (element as Record<string, unknown>)["_id"];
  return typeof id === "string" ? id : null;
}

/**
 * Bytes of what a write actually changed.
 *
 * `diff` is the store's own minimal diff (`computeDiff`), which is already
 * key-by-key minimal for nested objects but replaces arrays wholesale — and
 * arrays are exactly where every embedded collection lives. So array values
 * are narrowed to `changedElements` before measuring; everything else is
 * taken as the diff gives it. Keys that vanished (`undefined` in the diff)
 * carry no payload and are left out.
 *
 * Called AFTER the transaction commits (see DocumentStore.drainMetrics), so
 * neither the comparison nor the serialisation is inside the write lock.
 */
export function semanticDeltaBytes(
  existing: Record<string, unknown>,
  diff: Record<string, unknown>,
): number {
  const delta: Record<string, unknown> = {};
  for (const key of Object.keys(diff)) {
    const next = diff[key];
    if (next === undefined) continue;
    const previous = existing[key];
    delta[key] =
      Array.isArray(next) && Array.isArray(previous) ? changedElements(previous, next) : next;
  }
  return Buffer.byteLength(JSON.stringify(delta), "utf8");
}

// ---------------------------------------------------------------------------
// Internal accumulator
// ---------------------------------------------------------------------------

interface TableAccumulator {
  count: number;
  creates: number;
  updates: number;
  rowBytesTotal: number;
  deltaBytesTotal: number;
  latencySamplesMs: number[];
  /** Total latencies OFFERED (not retained) — the reservoir's denominator. */
  latenciesSeen: number;
  byPatchKey: Map<string, number>;
}

function newAccumulator(): TableAccumulator {
  return {
    count: 0,
    creates: 0,
    updates: 0,
    rowBytesTotal: 0,
    deltaBytesTotal: 0,
    latencySamplesMs: [],
    latenciesSeen: 0,
    byPatchKey: new Map<string, number>(),
  };
}

/** Nearest-rank percentile over an ASCENDING array. Returns 0 when empty. */
function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedAsc.length - 1);
  return sortedAsc[index] ?? 0;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export class WriteMetricsCollector {
  private readonly logger: Logger;
  private readonly worldId: string;
  private readonly maxLatencySamples: number;
  private readonly maxPatchKeys: number;
  private readonly timer: NodeJS.Timeout | undefined;

  private byTable = new Map<DocumentTable, TableAccumulator>();
  private windowStartMs = Date.now();
  private totalWrites = 0;

  // Peak-per-wall-clock-minute, tracked in O(1) memory: only the minute
  // currently being filled and the best minute so far are kept.
  private currentMinuteIndex = -1;
  private currentMinuteCount = 0;
  private peakMinuteCount = 0;

  private stopped = false;

  constructor(options: WriteMetricsCollectorOptions) {
    this.logger = options.logger;
    this.worldId = options.worldId;
    this.maxLatencySamples = options.maxLatencySamplesPerTable ?? DEFAULT_MAX_LATENCY_SAMPLES;
    this.maxPatchKeys = options.maxPatchKeysPerTable ?? DEFAULT_MAX_PATCH_KEYS;

    const intervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    if (intervalMs > 0) {
      const timer = setInterval(() => {
        // A throw inside a timer callback has NO frame that could catch it —
        // it becomes an uncaughtException and (there is no
        // `process.on("uncaughtException")` anywhere in this server) kills the
        // process, dropping every connected player mid-session. `flush()`
        // already swallows a failing logger; this is the outer belt, so that
        // a diagnostic can never be the reason the table goes down.
        try {
          this.flush();
        } catch {
          // Deliberately silent: the only thing left that could report it is
          // the logger that just failed.
        }
      }, intervalMs);
      // CRITICAL: without unref() this interval alone keeps the Node event
      // loop alive — the server would refuse to exit after shutdown and every
      // vitest file that registers a world namespace would hang until the
      // pool killed it. The report is a diagnostic; it must never be the
      // reason the process stays up.
      timer.unref();
      this.timer = timer;
    } else {
      this.timer = undefined;
    }
  }

  /**
   * Account for one persisted row write. Called from inside the store's
   * transaction, on the hot path — everything here is O(1) arithmetic plus at
   * most one array write.
   */
  record(event: WriteMetricsEvent): void {
    const acc = this.accumulatorFor(event.table);

    acc.count += 1;
    if (event.op === "create") acc.creates += 1;
    else acc.updates += 1;
    acc.rowBytesTotal += event.rowBytes;
    acc.deltaBytesTotal += event.deltaBytes;

    this.sampleLatency(acc, Number(event.latencyNs) / 1e6);

    for (const key of event.patchKeys) {
      const bucket = this.patchKeyBucket(acc, key);
      acc.byPatchKey.set(bucket, (acc.byPatchKey.get(bucket) ?? 0) + 1);
    }

    this.totalWrites += 1;
    this.countMinute();
  }

  /**
   * The current window as it would be logged, WITHOUT resetting anything.
   * Returns null when the window has seen no write at all.
   */
  snapshot(): WriteMetricsReport | null {
    if (this.totalWrites === 0) return null;

    const elapsedMs = Math.max(Date.now() - this.windowStartMs, 1);
    const elapsedMinutes = elapsedMs / 60_000;

    const byTable: Record<string, WriteMetricsTableReport> = {};
    for (const [table, acc] of this.byTable) {
      if (acc.count === 0) continue;
      byTable[table] = this.buildTableReport(acc);
    }

    return {
      windowMinutes: round(elapsedMinutes, 3),
      writesPerMinute: {
        avg: round(this.totalWrites / elapsedMinutes, 2),
        peakMinute: Math.max(this.peakMinuteCount, this.currentMinuteCount),
      },
      byTable,
    };
  }

  /**
   * Emit the window as one structured log line and start a fresh window.
   * A window with no writes logs nothing (a silent server would otherwise
   * write an empty report every five minutes, forever).
   */
  flush(): void {
    const report = this.snapshot();
    this.reset();
    if (report === null) return;
    // The log destination is a real file opened with `sync: true`: a full
    // disk, or a data dir on a drive that went away, makes `logger.info`
    // THROW synchronously into this frame. Losing the window is acceptable;
    // taking the session down over it is not — and `flush()` is reached both
    // from a timer and from world shutdown, where a throw would abort the
    // rest of the teardown.
    try {
      this.logger.info(
        { worldId: this.worldId, scope: WRITE_METRICS_SCOPE, ...report },
        "doc-store write metrics",
      );
    } catch {
      // Nothing to report it with — the reporter is what failed.
    }
  }

  /**
   * Stop the periodic flush. Idempotent. Does NOT flush — the caller decides
   * whether the tail of the window is worth a line (world close does; see
   * SocketManager.removeWorldNamespace).
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private accumulatorFor(table: DocumentTable): TableAccumulator {
    let acc = this.byTable.get(table);
    if (acc === undefined) {
      acc = newAccumulator();
      this.byTable.set(table, acc);
    }
    return acc;
  }

  /**
   * Which `byPatchKey` bucket a key is counted under. A key already being
   * tracked always keeps its own bucket; a NEW key past the cap is folded into
   * `OTHER_PATCH_KEY` so the map cannot grow with client-chosen names.
   */
  private patchKeyBucket(acc: TableAccumulator, key: string): string {
    if (acc.byPatchKey.has(key)) return key;
    if (acc.byPatchKey.size < this.maxPatchKeys) return key;
    return OTHER_PATCH_KEY;
  }

  /** Reservoir sampling (Algorithm R) — see DEFAULT_MAX_LATENCY_SAMPLES. */
  private sampleLatency(acc: TableAccumulator, latencyMs: number): void {
    acc.latenciesSeen += 1;
    if (acc.latencySamplesMs.length < this.maxLatencySamples) {
      acc.latencySamplesMs.push(latencyMs);
      return;
    }
    const candidate = Math.floor(Math.random() * acc.latenciesSeen);
    if (candidate < this.maxLatencySamples) acc.latencySamplesMs[candidate] = latencyMs;
  }

  private countMinute(): void {
    const minuteIndex = Math.floor(Date.now() / 60_000);
    if (minuteIndex !== this.currentMinuteIndex) {
      this.peakMinuteCount = Math.max(this.peakMinuteCount, this.currentMinuteCount);
      this.currentMinuteIndex = minuteIndex;
      this.currentMinuteCount = 0;
    }
    this.currentMinuteCount += 1;
  }

  private buildTableReport(acc: TableAccumulator): WriteMetricsTableReport {
    const rowBytesAvg = acc.rowBytesTotal / acc.count;
    const deltaBytesAvg = acc.deltaBytesTotal / acc.count;
    const sorted = [...acc.latencySamplesMs].sort((a, b) => a - b);

    return {
      count: acc.count,
      byOp: { create: acc.creates, update: acc.updates },
      rowBytesTotal: acc.rowBytesTotal,
      rowBytesAvg: Math.round(rowBytesAvg),
      deltaBytesAvg: Math.round(deltaBytesAvg),
      // Guard against a window whose deltas carried no bytes at all: the
      // ratio would be Infinity, which serialises to null in JSON anyway and
      // reads as a number in code. Say "unknown" explicitly instead.
      amplificationRatio: deltaBytesAvg > 0 ? round(rowBytesAvg / deltaBytesAvg, 1) : null,
      latencyMsP50: round(percentile(sorted, 50), 3),
      latencyMsP95: round(percentile(sorted, 95), 3),
      byPatchKey: Object.fromEntries(acc.byPatchKey),
    };
  }

  private reset(): void {
    this.byTable = new Map<DocumentTable, TableAccumulator>();
    this.windowStartMs = Date.now();
    this.totalWrites = 0;
    this.currentMinuteIndex = -1;
    this.currentMinuteCount = 0;
    this.peakMinuteCount = 0;
  }
}
