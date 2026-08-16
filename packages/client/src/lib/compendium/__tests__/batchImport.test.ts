/**
 * Batch import: progress, cancellation, and the warning (G095).
 *
 * Spec 43 §5.7 — REQ-CPD-065: a batch import shows progress and can be
 * cancelled, and the cancellation must NOT leave the world in a partial state
 * *without warning*. What is asserted here is exactly that pair: the run
 * reports how far it got at every step, and a run stopped after something was
 * already created comes back flagged `partial` with the list of what landed —
 * so the panel cannot quietly pretend nothing happened.
 *
 * Also REQ-CPD-064: nothing here de-duplicates. The same uuid twice is two
 * imports, because that is what the server does with it.
 */

import { describe, it, expect, vi } from "vitest";
import {
  runBatchImport,
  batchOutcomeMessage,
  BATCH_IMPORT_CHUNK_SIZE,
  BATCH_CANCELLED_KEY,
  BATCH_DONE_KEY,
  BATCH_PARTIAL_KEY,
  type BatchImportChunkResult,
  type BatchImportProgress,
} from "../batchImport.js";

function uuids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Compendium.pf2e.conditions.Item.doc${String(i)}`);
}

/** A server that succeeds, answering one created id per uuid. */
function okChunk(uuidList: readonly string[]): Promise<BatchImportChunkResult> {
  return Promise.resolve({
    created: uuidList.map((u) => `world-${u.split(".").pop() ?? ""}`),
    failed: [],
  });
}

describe("batch import progress (REQ-CPD-065)", () => {
  it("REQ-CPD-065: reports progress against a total that never moves", async () => {
    const seen: BatchImportProgress[] = [];

    const run = runBatchImport({
      uuids: uuids(6),
      chunkSize: 2,
      importChunk: okChunk,
      onProgress: (p) => seen.push(p),
    });
    const outcome = await run.promise;

    expect(seen.every((p) => p.total === 6)).toBe(true);
    expect(seen.map((p) => p.done)).toEqual([0, 2, 4, 6, 6]);
    expect(outcome.created).toHaveLength(6);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.partial).toBe(false);
  });

  it("REQ-CPD-065: a chunk that rejects becomes failures — the run keeps going", async () => {
    let call = 0;
    const outcome = await runBatchImport({
      uuids: uuids(4),
      chunkSize: 2,
      importChunk: (batch) => {
        call++;
        if (call === 1) return Promise.reject(new Error("server said no"));
        return okChunk(batch);
      },
    }).promise;

    expect(outcome.created).toHaveLength(2);
    expect(outcome.failed).toHaveLength(2);
    expect(outcome.failed[0]?.reason).toBe("server said no");
    expect(outcome.cancelled).toBe(false);
  });

  it("REQ-CPD-065: uuids the server did not account for are counted as failed, not lost", async () => {
    const outcome = await runBatchImport({
      uuids: uuids(3),
      chunkSize: 3,
      // Answers for one of the three — the other two must not vanish.
      importChunk: () => Promise.resolve({ created: ["world-a"], failed: [] }),
    }).promise;

    expect(outcome.created).toHaveLength(1);
    expect(outcome.failed).toHaveLength(2);
  });

  it("REQ-CPD-064: the same uuid twice is imported twice — nothing is de-duplicated", async () => {
    const one = "Compendium.pf2e.conditions.Item.frightened";
    const sent: string[][] = [];

    const outcome = await runBatchImport({
      uuids: [one, one],
      chunkSize: 1,
      importChunk: (batch) => {
        sent.push([...batch]);
        return Promise.resolve({ created: [`world-${String(sent.length)}`], failed: [] });
      },
    }).promise;

    expect(sent).toEqual([[one], [one]]);
    expect(outcome.created).toEqual(["world-1", "world-2"]);
  });
});

describe("cancelling a batch import (REQ-CPD-065)", () => {
  it("REQ-CPD-065: cancelling stops before the next chunk and never mid-chunk", async () => {
    const sent: string[][] = [];
    let release: (() => void) | null = null;

    const run = runBatchImport({
      uuids: uuids(6),
      chunkSize: 2,
      importChunk: async (batch) => {
        sent.push([...batch]);
        // Hold the first chunk open so cancel() lands while it is in flight.
        if (sent.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return okChunk(batch);
      },
    });

    await vi.waitFor(() => {
      expect(release).not.toBeNull();
    });
    run.cancel();
    release!();
    const outcome = await run.promise;

    // The chunk in flight finished and was counted; nothing after it was sent.
    expect(sent).toEqual([uuids(6).slice(0, 2)]);
    expect(outcome.created).toHaveLength(2);
    expect(outcome.cancelled).toBe(true);
    expect(outcome.notAttempted).toHaveLength(4);
  });

  it("REQ-CPD-065: a cancelled run that already created something comes back PARTIAL", async () => {
    let sent = 0;
    const run = runBatchImport({
      uuids: uuids(4),
      chunkSize: 2,
      importChunk: (batch) => {
        sent++;
        if (sent === 1) run.cancel();
        return okChunk(batch);
      },
    });

    const outcome = await run.promise;

    expect(outcome.partial).toBe(true);
    expect(outcome.created).toHaveLength(2);
    expect(outcome.notAttempted).toHaveLength(2);
  });

  it("REQ-CPD-065: cancelling before anything landed is NOT a partial world", async () => {
    const run = runBatchImport({
      uuids: uuids(4),
      chunkSize: 2,
      importChunk: okChunk,
    });
    run.cancel();

    const outcome = await run.promise;

    expect(outcome.created).toEqual([]);
    expect(outcome.cancelled).toBe(true);
    expect(outcome.partial).toBe(false);
    expect(outcome.notAttempted).toHaveLength(4);
  });

  it("REQ-CPD-065: cancelling after the last chunk is not a cancellation at all", async () => {
    const run = runBatchImport({ uuids: uuids(2), chunkSize: 2, importChunk: okChunk });
    const outcome = await run.promise;
    run.cancel();

    expect(outcome.cancelled).toBe(false);
    expect(outcome.partial).toBe(false);
    expect(outcome.notAttempted).toEqual([]);
  });

  it("REQ-CPD-065: the cancelling flag reaches the progress callback while it waits", async () => {
    const seen: BatchImportProgress[] = [];
    let release: (() => void) | null = null;

    const run = runBatchImport({
      uuids: uuids(4),
      chunkSize: 2,
      importChunk: async (batch) => {
        if (!release) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return okChunk(batch);
      },
      onProgress: (p) => seen.push(p),
    });

    await vi.waitFor(() => {
      expect(release).not.toBeNull();
    });
    run.cancel();
    expect(seen.some((p) => p.cancelling)).toBe(true);

    release!();
    await run.promise;
  });

  it("the default chunk size is one constant, not a number spread through the panel", () => {
    expect(BATCH_IMPORT_CHUNK_SIZE).toBeGreaterThan(0);
  });
});

describe("what the user is told when the run ends (REQ-CPD-065)", () => {
  it("REQ-CPD-065: a partial world is announced WITH the count that landed", async () => {
    let sent = 0;
    const run = runBatchImport({
      uuids: uuids(4),
      chunkSize: 2,
      importChunk: (batch) => {
        sent++;
        if (sent === 1) run.cancel();
        return okChunk(batch);
      },
    });
    const message = batchOutcomeMessage(await run.promise);

    expect(message.key).toBe(BATCH_PARTIAL_KEY);
    expect(message.vars).toEqual({ created: 2, total: 4 });
  });

  it("REQ-CPD-065: a cancellation that brought nothing is not dressed as a partial world", async () => {
    const run = runBatchImport({ uuids: uuids(4), chunkSize: 2, importChunk: okChunk });
    run.cancel();

    expect(batchOutcomeMessage(await run.promise).key).toBe(BATCH_CANCELLED_KEY);
  });

  it("REQ-CPD-065: a finished run reports how many entries it brought", async () => {
    const run = runBatchImport({ uuids: uuids(3), chunkSize: 3, importChunk: okChunk });

    const message = batchOutcomeMessage(await run.promise);

    expect(message.key).toBe(BATCH_DONE_KEY);
    expect(message.vars["count"]).toBe(3);
  });
});
