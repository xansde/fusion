/**
 * registryReactivityProbe.svelte.ts — fixture for the "registry is reactive" test in
 * `actionBarRegistry.test.ts` (BAR-F1-02). Not a test file: Vitest does not collect it.
 *
 * Why a fixture bundled by `vite build`: Vitest compiles `.svelte.ts` modules for the SERVER,
 * where `$effect` never runs, and loads `svelte` through Node's server build, so a plain test
 * cannot observe an effect. The test bundles this module (client compile, client runtime) and
 * runs the bundle, which is also how the registry runs in the browser.
 *
 * What it models: `registerPf2eSheets` is async and runs in `TableScreen`'s `onMount`, i.e. AFTER
 * the first render. A shell effect that resolved a provider before it existed must see it as soon
 * as it registers — the property `SvelteMap` gives the registry and a plain `Map` would not.
 */

import { flushSync } from "svelte";
import { ActionBarRegistryImpl } from "../actionBarRegistry.js";
import type { ActionBarProvider } from "../types.js";

export interface RegistryReaderObservations {
  /** One item per run of an effect that reads `resolve("Actor", "character")`. */
  exact: Array<ActionBarProvider | null>;
  /** One item per run of an effect that reads `resolve("Actor", "npc")`, with the "*" provider registered late. */
  wildcard: Array<ActionBarProvider | null>;
}

export function observeRegistryReaders(provider: ActionBarProvider): RegistryReaderObservations {
  const exact: Array<ActionBarProvider | null> = [];
  const exactRegistry = new ActionBarRegistryImpl();
  const stopExact = $effect.root(() => {
    $effect(() => {
      exact.push(exactRegistry.resolve("Actor", "character"));
    });
  });
  flushSync(); // first run: nothing registered yet
  exactRegistry.register("Actor", "character", provider);
  flushSync(); // second run: the provider arrived after the first read
  exactRegistry.reset();
  flushSync(); // third run: gone again
  stopExact();

  const wildcard: Array<ActionBarProvider | null> = [];
  const wildcardRegistry = new ActionBarRegistryImpl();
  const stopWildcard = $effect.root(() => {
    $effect(() => {
      wildcard.push(wildcardRegistry.resolve("Actor", "npc"));
    });
  });
  flushSync();
  wildcardRegistry.register("Actor", "*", provider);
  flushSync();
  stopWildcard();

  return { exact, wildcard };
}
