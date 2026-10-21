/**
 * favoritesStoreReactivity.test.ts — what only a real Vite build shows about the favourites store
 * (BAR-F3-01; spec 53 REQ-BAR-063, RNF-BAR-03).
 *
 * `favoritesStore.test.ts` proves the LOGIC under Vitest, which compiles `.svelte.ts` for the server,
 * where `$state` is a plain variable and `$effect` never runs. Whether the row the bar DRAWS changes
 * on its own — a pin shows before the server answers, a write by another device shows when the mirror
 * gets it, a failed write goes away — is a property of the client runtime. So the fixture is bundled
 * the way `vite build` does (client compile, client runtime) and run, as `actionBarRegistry.test.ts`
 * does for the registry.
 *
 * The second block does the same for the effects around the store in `ActionBar.svelte`: that the seed
 * waits for the sheet after a change of actor is a matter of the ORDER the effects run in.
 */

import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { build } from "vite";
import type { Rollup } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { createEffectsProbe } from "./actionBarEffectsProbe.svelte.js";
import type { observeStore } from "./favoritesStoreReactivityProbe.svelte.js";

const CLIENT_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PROBE = fileURLToPath(new URL("./favoritesStoreReactivityProbe.svelte.ts", import.meta.url));
const EFFECTS_PROBE = fileURLToPath(new URL("./actionBarEffectsProbe.svelte.ts", import.meta.url));

async function bundle(entry: string): Promise<string> {
  const result = (await build({
    configFile: false,
    logLevel: "silent",
    root: CLIENT_ROOT,
    mode: "production",
    plugins: [svelte()],
    build: {
      write: false,
      minify: "esbuild",
      lib: { entry, formats: ["cjs"], fileName: "bundle" },
      rollupOptions: { external: [] },
    },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  const first = (Array.isArray(result) ? result[0] : result)?.output[0];
  if (first?.type !== "chunk") throw new Error("vite build produced no chunk");
  return first.code;
}

function evaluate<T>(code: string): T {
  const module = { exports: {} };
  new Function("module", "exports", "require", code)(module, module.exports, (id: string) => {
    throw new Error(`unexpected require("${id}")`);
  });
  return module.exports as T;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("built by Vite — the favourites row is reactive", () => {
  it("a pin shows before the answer, survives it, follows another device, and goes away when the write fails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = await bundle(PROBE);
    const probe = evaluate<{ observeStore: typeof observeStore }>(code);

    const seen = await probe.observeStore();

    // Nothing pinned, then the pin — shown at once, before the server answered…
    expect(seen.initial).toBe("·,·,·");
    expect(seen.optimistic).toBe("strike:a,·,·");
    // …it stays after the answer even though the mirror is still on the old document…
    expect(seen.acked).toBe("strike:a,·,·");
    // …another device's pin reaches the row with nobody calling anything…
    expect(seen.broadcast).toBe("strike:a,strike:b,·");
    // …an unpin shows at once, and when its write fails the row goes back to the document.
    expect(seen.unpinning).toBe("·,strike:b,·");
    expect(seen.afterFailure).toBe("strike:a,strike:b,·");
    // (The probe bundles the store without the dictionaries, so the message is its key.)
    expect(seen.notices).toEqual(["FUSION.ActionBar.Favorites.SaveFailed"]);
    // The effect really re-ran for each of them (the first run is the initial draw).
    expect(seen.all.length).toBeGreaterThanOrEqual(6);
  }, 90_000);
});

describe("built by Vite — the effects around the store keep the seed waiting for the sheet", () => {
  it("after a change of actor the seed is asked only once the new sheet has settled; a quick pass through other actors settles nothing early; a late list asks again without rebuilding the store", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const code = await bundle(EFFECTS_PROBE);
    const { createEffectsProbe: make } = evaluate<{
      createEffectsProbe: typeof createEffectsProbe;
    }>(code);
    const actorsAsked = (probe: { asks: ReadonlyArray<{ actor: string }> }): string[] =>
      probe.asks.map((ask) => ask.actor);

    vi.useFakeTimers(); // after the build, which needs the real ones
    const probe = make(1500);
    try {
      // Opening: the sheet has not settled, so the store is not asked yet…
      expect(probe.asks).toEqual([]);
      vi.advanceTimersByTime(1499);
      probe.flush();
      expect(probe.asks).toEqual([]);
      // …and is asked, once, the moment it has.
      vi.advanceTimersByTime(1);
      probe.flush();
      expect(probe.asks).toEqual([{ actor: "A", settled: true }]);

      // Another actor on screen: the flag goes back to false BEFORE the new store could be asked
      // (the order of the two effects), so the previous actor's `true` is never read for it.
      probe.switchActor("B");
      expect(probe.storesCreated()).toBe(2);
      expect(actorsAsked(probe)).toEqual(["A"]);
      vi.advanceTimersByTime(1500);
      probe.flush();
      expect(actorsAsked(probe)).toEqual(["A", "B"]);

      // A quick pass through C and then D: C's timer is cleared when D takes over, so it cannot
      // settle D early; only D's own full wait does.
      probe.switchActor("C");
      vi.advanceTimersByTime(1000);
      probe.switchActor("D");
      vi.advanceTimersByTime(1000);
      probe.flush();
      expect(actorsAsked(probe)).toEqual(["A", "B"]);
      vi.advanceTimersByTime(500);
      probe.flush();
      expect(actorsAsked(probe)).toEqual(["A", "B", "D"]);

      // A late pack changes the list: the shell asks again (the store decides whether there is
      // anything to write) and the store is the same one.
      const built = probe.storesCreated();
      probe.touchEntries();
      probe.touchEntries();
      expect(actorsAsked(probe)).toEqual(["A", "B", "D", "D", "D"]);
      expect(probe.storesCreated()).toBe(built);
      // Never once before the sheet had settled.
      expect(probe.asks.every((ask) => ask.settled)).toBe(true);
    } finally {
      probe.stop();
    }
  }, 90_000);
});
