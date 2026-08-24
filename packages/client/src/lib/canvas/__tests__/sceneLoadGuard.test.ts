/**
 * sceneLoadGuard.test.ts — unit tests for the generation-counter guard used
 * by TableScreen's scene-reload `$effect` (BUG FIX #81: overlapping scene
 * loads used to overwrite each other because a load's cleanup was only
 * paired with it AFTER its `await`, with no way to tell a stale result from
 * the current one — see sceneLoadGuard.ts doc comment for full context).
 *
 * These are pure-function tests: no window/PIXI/Svelte involved. The
 * `makeHarness` helper below mirrors — line for line — the pattern
 * TableScreen.svelte's `$effect` follows around `createSceneLoadGuard()`, so
 * these tests exercise the exact contract the component relies on.
 */

import { describe, it, expect, vi } from "vitest";
import { createSceneLoadGuard } from "../sceneLoadGuard.js";

/**
 * Mirrors the pattern the `$effect` in TableScreen.svelte follows for each
 * scene switch: tear down whatever is currently installed, begin() a new
 * generation, await the load, then install the result only if isCurrent()
 * still holds — otherwise dispose of it immediately without installing.
 */
function makeHarness() {
  const guard = createSceneLoadGuard();
  let active: (() => void) | null = null;

  return {
    // Exposed so a test can mirror onDestroy's unpaired begin() call — the
    // rest of the harness only ever calls begin() paired with a load.
    guard,
    async run(load: Promise<() => void>): Promise<void> {
      active?.();
      active = null;
      const generation = guard.begin();
      const cleanup = await load;
      if (!guard.isCurrent(generation)) {
        cleanup();
        return;
      }
      active = cleanup;
    },
    getActive(): (() => void) | null {
      return active;
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createSceneLoadGuard", () => {
  it("isCurrent reflects begin() order directly, independent of resolution order", () => {
    const guard = createSceneLoadGuard();
    const genA = guard.begin();
    const genB = guard.begin();

    expect(guard.isCurrent(genA)).toBe(false);
    expect(guard.isCurrent(genB)).toBe(true);
  });

  it("a single load installs cleanly", async () => {
    const harness = makeHarness();
    const cleanup = vi.fn();

    await harness.run(Promise.resolve(cleanup));

    expect(harness.getActive()).toBe(cleanup);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("discards the first load and calls its cleanup when it resolves after the second started", async () => {
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();
    const defA = deferred<() => void>();
    const defB = deferred<() => void>();
    const harness = makeHarness();

    // A starts, then B starts before A resolves (two rapid scene switches).
    const runA = harness.run(defA.promise);
    const runB = harness.run(defB.promise);

    // B resolves first and wins.
    defB.resolve(cleanupB);
    await runB;
    expect(harness.getActive()).toBe(cleanupB);
    expect(cleanupB).not.toHaveBeenCalled();

    // A resolves after B: its result is stale — discarded, cleanup run immediately.
    defA.resolve(cleanupA);
    await runA;

    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).not.toHaveBeenCalled(); // still installed, untouched
    expect(harness.getActive()).toBe(cleanupB);
  });

  it("keeps only the last of three cascading loads, regardless of resolution order", async () => {
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();
    const cleanupC = vi.fn();
    const defA = deferred<() => void>();
    const defB = deferred<() => void>();
    const defC = deferred<() => void>();
    const harness = makeHarness();

    // All three "scene switches" fire before any of them resolves.
    const runA = harness.run(defA.promise);
    const runB = harness.run(defB.promise);
    const runC = harness.run(defC.promise);

    // Resolve out of begin() order — must not matter.
    defB.resolve(cleanupB);
    defA.resolve(cleanupA);
    defC.resolve(cleanupC);
    await Promise.all([runA, runB, runC]);

    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).toHaveBeenCalledTimes(1);
    expect(cleanupC).not.toHaveBeenCalled();
    expect(harness.getActive()).toBe(cleanupC);
  });

  it("begin() with no paired load (e.g. component unmount) invalidates everything still in flight", async () => {
    // Mirrors TableScreen.svelte's onDestroy: it calls sceneLoadGuard.begin()
    // with no load of its own, purely to bump the generation so any load
    // still in flight discards itself when it resolves instead of installing
    // (BUG FIX #81 follow-up — see onDestroy's comment in TableScreen.svelte).
    const cleanupA = vi.fn();
    const defA = deferred<() => void>();
    const harness = makeHarness();

    const runA = harness.run(defA.promise);

    // Unmount happens while A is still in flight: bump the generation with
    // no load of its own.
    harness.guard.begin();

    defA.resolve(cleanupA);
    await runA;

    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(harness.getActive()).toBeNull();
  });

  it("never calls the same generation's cleanup twice across further supersessions", async () => {
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();
    const cleanupC = vi.fn();
    const harness = makeHarness();

    await harness.run(Promise.resolve(cleanupA));
    await harness.run(Promise.resolve(cleanupB)); // supersedes A: A torn down once
    await harness.run(Promise.resolve(cleanupC)); // supersedes B: B torn down once, A untouched

    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).toHaveBeenCalledTimes(1);
    expect(cleanupC).not.toHaveBeenCalled();
  });
});
