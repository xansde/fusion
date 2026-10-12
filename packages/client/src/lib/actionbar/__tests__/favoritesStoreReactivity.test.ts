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
 */

import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { build } from "vite";
import type { Rollup } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { observeStore } from "./favoritesStoreReactivityProbe.svelte.js";

const CLIENT_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PROBE = fileURLToPath(new URL("./favoritesStoreReactivityProbe.svelte.ts", import.meta.url));

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
