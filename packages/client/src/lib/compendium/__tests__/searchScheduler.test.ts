/**
 * searchScheduler.test.ts — RNF-CPD-02, both halves.
 *
 * Spec 43 §6: "Digitar na busca NÃO DEVE disparar uma requisição por tecla: as
 * chamadas DEVEM ser agrupadas, e uma resposta atrasada NÃO DEVE sobrescrever um
 * resultado mais novo."
 *
 * Behaviour, not implementation: the tests count how many times the RUN function
 * was called and which answer reached the panel, never how the scheduler keeps
 * its token.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SEARCH_GROUPING_MS, createSearchScheduler } from "../searchScheduler.js";

/** A run function whose answers are resolved by hand, in any order. */
function deferredRuns(): {
  run: (query: string) => Promise<string>;
  calls: string[];
  settle: (query: string, answer: string) => void;
  fail: (query: string, error: Error) => void;
} {
  const calls: string[] = [];
  const pending = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>();
  return {
    calls,
    run: (query) => {
      calls.push(query);
      return new Promise<string>((resolve, reject) => {
        pending.set(query, { resolve, reject });
      });
    },
    settle: (query, answer) => {
      pending.get(query)?.resolve(answer);
    },
    fail: (query, error) => {
      pending.get(query)?.reject(error);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RNF-CPD-02 — typing is grouped into one request", () => {
  it("RNF-CPD-02: eight keystrokes inside the window are ONE call, for the last text", async () => {
    const runs = deferredRuns();
    const results: string[] = [];
    const scheduler = createSearchScheduler<string, string>({
      run: runs.run,
      onResult: (result) => results.push(result),
      onError: () => results.push("error"),
    });

    for (const typed of ["f", "fi", "fir", "fire", "fireb", "fireba", "firebal", "fireball"]) {
      scheduler.schedule(typed);
      // A keystroke every 20 ms — a fast but ordinary typist.
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(SEARCH_GROUPING_MS);

    expect(runs.calls).toEqual(["fireball"]);

    runs.settle("fireball", "the fireball answer");
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toEqual(["the fireball answer"]);
  });

  it("RNF-CPD-02: pausing between words asks twice — grouping is a window, not a mute", async () => {
    const runs = deferredRuns();
    const scheduler = createSearchScheduler<string, string>({
      run: runs.run,
      onResult: () => undefined,
      onError: () => undefined,
    });

    scheduler.schedule("goblin");
    await vi.advanceTimersByTimeAsync(SEARCH_GROUPING_MS + 10);
    scheduler.schedule("goblin warrior");
    await vi.advanceTimersByTimeAsync(SEARCH_GROUPING_MS + 10);

    expect(runs.calls).toEqual(["goblin", "goblin warrior"]);
  });

  it("RNF-CPD-02: nothing leaves before the window closes", async () => {
    const runs = deferredRuns();
    const scheduler = createSearchScheduler<string, string>({
      run: runs.run,
      onResult: () => undefined,
      onError: () => undefined,
    });

    scheduler.schedule("bola");
    await vi.advanceTimersByTimeAsync(SEARCH_GROUPING_MS - 1);
    expect(runs.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(runs.calls).toEqual(["bola"]);
  });
});

describe("RNF-CPD-02 — a late answer never overwrites a newer one", () => {
  it("RNF-CPD-02: the answer to 'fire' landing AFTER the answer to 'fireball' is dropped", async () => {
    const runs = deferredRuns();
    const shown: string[] = [];
    const scheduler = createSearchScheduler<string, string>({
      run: runs.run,
      onResult: (result) => shown.push(result),
      onError: () => shown.push("error"),
    });

    scheduler.schedule("fire");
    await vi.advanceTimersByTimeAsync(SEARCH_GROUPING_MS);
    scheduler.schedule("fireball");
    await vi.advanceTimersByTimeAsync(SEARCH_GROUPING_MS);
    expect(runs.calls).toEqual(["fire", "fireball"]);

    // The NEWER question answers first, then the older one straggles in.
    runs.settle("fireball", "fireball result");
    await vi.advanceTimersByTimeAsync(0);
    runs.settle("fire", "fire result");
    await vi.advanceTimersByTimeAsync(0);

    expect(shown).toEqual(["fireball result"]);
  });

  it("RNF-CPD-02: a late FAILURE of an old question does not paint an error over a good result", async () => {
    const runs = deferredRuns();
    const shown: string[] = [];
    const scheduler = createSearchScheduler<string, string>({
      run: runs.run,
      onResult: (result) => shown.push(result),
      onError: () => shown.push("error"),
    });

    scheduler.schedule("fire");
    await vi.advanceTimersByTimeAsync(SEARCH_GROUPING_MS);
    scheduler.schedule("fireball");
    await vi.advanceTimersByTimeAsync(SEARCH_GROUPING_MS);

    runs.settle("fireball", "fireball result");
    await vi.advanceTimersByTimeAsync(0);
    runs.fail("fire", new Error("timed out"));
    await vi.advanceTimersByTimeAsync(0);

    expect(shown).toEqual(["fireball result"]);
  });

  it("RNF-CPD-02: cancel disowns what is in flight — leaving the body cannot be repainted", async () => {
    const runs = deferredRuns();
    const shown: string[] = [];
    const scheduler = createSearchScheduler<string, string>({
      run: runs.run,
      onResult: (result) => shown.push(result),
      onError: () => shown.push("error"),
    });

    scheduler.schedule("goblin");
    await vi.advanceTimersByTimeAsync(SEARCH_GROUPING_MS);
    scheduler.cancel();
    runs.settle("goblin", "goblin result");
    await vi.advanceTimersByTimeAsync(0);

    expect(shown).toEqual([]);
  });

  it("RNF-CPD-02: cancel also drops a request still inside the grouping window", async () => {
    const runs = deferredRuns();
    const scheduler = createSearchScheduler<string, string>({
      run: runs.run,
      onResult: () => undefined,
      onError: () => undefined,
    });

    scheduler.schedule("goblin");
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(SEARCH_GROUPING_MS * 3);

    expect(runs.calls).toEqual([]);
  });
});

describe("the new attempt REQ-CPD-091 asks for", () => {
  it("REQ-CPD-091: runNow skips the grouping window, because a retry is not typing", async () => {
    const runs = deferredRuns();
    const shown: string[] = [];
    const scheduler = createSearchScheduler<string, string>({
      run: runs.run,
      onResult: (result) => shown.push(result),
      onError: () => shown.push("error"),
    });

    scheduler.runNow("goblin");
    expect(runs.calls).toEqual(["goblin"]);

    runs.settle("goblin", "goblin result");
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual(["goblin result"]);
  });

  it("REQ-CPD-091: the failure reaches the panel, so it can show the message and the retry", async () => {
    const runs = deferredRuns();
    const errors: unknown[] = [];
    const scheduler = createSearchScheduler<string, string>({
      run: runs.run,
      onResult: () => undefined,
      onError: (error) => errors.push(error),
    });

    scheduler.runNow("goblin");
    runs.fail("goblin", new Error("server said no"));
    await vi.advanceTimersByTimeAsync(0);

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("server said no");
  });
});
