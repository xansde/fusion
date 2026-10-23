/**
 * batchImport.ts — bringing many entries over, with progress and a way out.
 *
 * Spec 43 §5.7 (REQ-CPD-065): a batch import SHOWS progress and CAN be
 * cancelled, and the cancellation must not leave the world in a partial state
 * *without warning*. Read that literally: the requirement does not ask for a
 * rollback — an import creates real documents and undoing them would be a
 * second, riskier write — it asks that the user never be lied to about what
 * already landed.
 *
 * So this runner is built around two guarantees:
 *
 *  1. **Cancellation lands between chunks, never inside one.** A chunk already
 *     sent to the server runs to completion and its result is counted. There is
 *     no window where a document exists and this run does not know about it.
 *  2. **The outcome always names what was created.** `partial` is true exactly
 *     when a cancelled run had already brought something over — that flag is
 *     the warning REQ-CPD-065 demands, and the caller has to draw it.
 *
 * The runner is transport-free on purpose: it takes an `importChunk` function.
 * That is what lets the same machine serve both doors of §5.7 — the world
 * (`compendium:import`) and a sheet (`compendium:importToActor`) — and be
 * tested without a socket.
 */

/** One uuid that could not be brought, with the server's reason. */
export interface BatchImportFailure {
  readonly uuid: string;
  readonly reason: string;
}

/** What one chunk answered. Both doors of §5.7 answer in this shape. */
export interface BatchImportChunkResult {
  readonly created: readonly string[];
  readonly failed: readonly BatchImportFailure[];
}

/** The live state a progress bar draws (REQ-CPD-065). */
export interface BatchImportProgress {
  /** How many uuids the run was asked for. Fixed for the whole run. */
  readonly total: number;
  /** How many have been answered for — created or failed. */
  readonly done: number;
  readonly created: number;
  readonly failed: number;
  /** Cancel was pressed and the current chunk is still finishing. */
  readonly cancelling: boolean;
}

/** What the run leaves behind. */
export interface BatchImportOutcome {
  readonly total: number;
  readonly created: readonly string[];
  readonly failed: readonly BatchImportFailure[];
  /** Cancel was pressed before every uuid had been attempted. */
  readonly cancelled: boolean;
  /** Uuids never sent to the server — nothing exists for them. */
  readonly notAttempted: readonly string[];
  /**
   * The warning of REQ-CPD-065: the run stopped early AND had already brought
   * something over, so the world holds part of what was asked for. Drawing this
   * is not optional for the caller.
   */
  readonly partial: boolean;
}

/** A run in flight: awaitable, and interruptible. */
export interface BatchImportRun {
  readonly promise: Promise<BatchImportOutcome>;
  /** Ask the run to stop after the chunk currently in flight. */
  cancel: () => void;
}

/**
 * How many uuids go in one round trip.
 *
 * Small enough that a cancel is felt (the user waits for at most this many
 * documents), large enough that a hundred spells are not a hundred round trips.
 * One constant, one place — the panel never passes a number of its own unless a
 * test needs to.
 */
export const BATCH_IMPORT_CHUNK_SIZE = 5;

export interface BatchImportOptions {
  readonly uuids: readonly string[];
  /** Sends one chunk. Rejecting fails that chunk; it does not kill the run. */
  readonly importChunk: (uuids: readonly string[]) => Promise<BatchImportChunkResult>;
  readonly chunkSize?: number;
  readonly onProgress?: (progress: BatchImportProgress) => void;
}

// ---------------------------------------------------------------------------
// What the user is told when it is over (REQ-CPD-065)
// ---------------------------------------------------------------------------

/** i18n key + interpolation for the end-of-run message. */
export interface BatchOutcomeMessage {
  readonly key: string;
  readonly vars: Record<string, number>;
}

export const BATCH_PARTIAL_KEY = "FUSION.Compendium.Import.BatchPartial";
export const BATCH_CANCELLED_KEY = "FUSION.Compendium.Import.BatchCancelled";
export const BATCH_DONE_KEY = "FUSION.Compendium.Import.BatchDone";

/**
 * Turn an outcome into the message the panel shows. This is a function, not a
 * ternary inside the component, because the choice IS the requirement: a
 * cancelled run that already brought documents over must say so with the count
 * (REQ-CPD-065), and that is the one branch worth pinning down in a test.
 */
export function batchOutcomeMessage(outcome: BatchImportOutcome): BatchOutcomeMessage {
  if (outcome.partial) {
    return {
      key: BATCH_PARTIAL_KEY,
      vars: { created: outcome.created.length, total: outcome.total },
    };
  }
  if (outcome.cancelled) return { key: BATCH_CANCELLED_KEY, vars: { count: 0 } };
  return { key: BATCH_DONE_KEY, vars: { count: outcome.created.length } };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  const step = size > 0 ? size : 1;
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

/**
 * Start a batch import.
 *
 * Returns immediately with the run; `promise` settles when the last chunk has
 * been answered for (or when a cancellation takes effect). The promise never
 * rejects — a failing chunk becomes failures inside the outcome, because a run
 * that throws away what it already created is exactly the silent partial state
 * REQ-CPD-065 forbids.
 */
export function runBatchImport(options: BatchImportOptions): BatchImportRun {
  const total = options.uuids.length;
  const chunks = chunk(options.uuids, options.chunkSize ?? BATCH_IMPORT_CHUNK_SIZE);

  // Held in an object rather than a bare `let`: the flag is written by `cancel`
  // and read across an `await`, and a plain boolean would be narrowed to its
  // initial value by control-flow analysis (and by the lint rule that follows
  // it), which is exactly the read that must NOT be optimized away.
  const run = { cancelled: false };
  const created: string[] = [];
  const failed: BatchImportFailure[] = [];
  let attempted = 0;

  const report = (cancelling: boolean): void => {
    options.onProgress?.({
      total,
      done: created.length + failed.length,
      created: created.length,
      failed: failed.length,
      cancelling,
    });
  };

  const promise = (async (): Promise<BatchImportOutcome> => {
    report(false);
    // Yield before the first chunk leaves. Two things depend on it: the caller
    // holds the run handle (and so can cancel from its own progress callback)
    // before anything is sent, and a cancel pressed in the same tick as the
    // start really does send nothing — "I changed my mind immediately" must not
    // still create five documents.
    await Promise.resolve();

    for (const batch of chunks) {
      // The check is HERE, before sending: a chunk already in flight always
      // finishes and is always counted (guarantee 1).
      if (run.cancelled) break;

      attempted += batch.length;
      try {
        const result = await options.importChunk(batch);
        created.push(...result.created);
        for (const failure of result.failed) failed.push(failure);
        // The server may answer for fewer uuids than were sent (a handler that
        // refuses the whole call). Whatever it did not account for is counted
        // as failed here, so `done` never lies about how far the run got.
        const accounted = result.created.length + result.failed.length;
        for (let i = accounted; i < batch.length; i++) {
          failed.push({ uuid: batch[i] as string, reason: "" });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        for (const uuid of batch) failed.push({ uuid, reason });
      }
      report(run.cancelled);
    }

    const notAttempted = options.uuids.slice(attempted);
    report(false);

    return {
      total,
      created,
      failed,
      cancelled: run.cancelled && notAttempted.length > 0,
      notAttempted,
      // The warning: stopped early with documents already in the world.
      partial: run.cancelled && notAttempted.length > 0 && created.length > 0,
    };
  })();

  return {
    promise,
    cancel: (): void => {
      if (run.cancelled) return;
      run.cancelled = true;
      report(true);
    },
  };
}
