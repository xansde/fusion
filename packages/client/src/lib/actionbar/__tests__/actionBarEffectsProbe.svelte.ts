/**
 * actionBarEffectsProbe.svelte.ts — fixture for `favoritesStoreReactivity.test.ts` (BAR-F3-01). Not a
 * test file: Vitest does not collect it.
 *
 * `ActionBar.svelte` has three pieces around the favourites store, and their ORDER is what makes the
 * first-opening seed wait for the sheet after a change of actor:
 *
 *  1. `favorites = $derived(createFavoritesStore(...))` — a store per actor;
 *  2. an `$effect` that, on a change of actor, resets `sheetSettled` and arms a timer to set it;
 *  3. an `$effect` that asks the store for the seed, but only when `sheetSettled` is true.
 *
 * If (3) ran before (2) had reset the flag, the new actor's store would be asked with the flag still
 * `true` from the previous actor — from a partial list, which is the very thing the wait is for. That
 * cannot be seen under the server compile Vitest uses (`$effect` never runs there), so this fixture
 * runs the same three pieces — written as the component writes them, in the same order, with the same
 * reads — in the client runtime, the way `vite build` ships it. The wiring test in `ActionBar.test.ts`
 * pins the component to this shape; this proves the shape behaves.
 */

import { flushSync, untrack } from "svelte";

import { createFavoritesShared, createFavoritesStore } from "../favoritesStore.svelte.js";

type Json = Record<string, unknown>;

export interface EffectsProbe {
  /** Each time the seed effect reached `ensureSeeded`: the store's actor, and whether the sheet had settled. */
  readonly asks: ReadonlyArray<{ actor: string; settled: boolean }>;
  /** How many stores were built (one per actor on screen, not one per redraw). */
  storesCreated(): number;
  /** The bar now shows another actor. */
  switchActor(id: string): void;
  /** The provider's list changed (a late pack arrived). */
  touchEntries(): void;
  /** Runs what is pending (the timers are the test's: it advances them, then flushes). */
  flush(): void;
  stop(): void;
}

export function createEffectsProbe(settleMs: number): EffectsProbe {
  let actorId = $state("A");
  let entries = $state.raw<readonly string[]>([]);
  let sheetSettled = $state(false);
  let created = 0;
  const asks: Array<{ actor: string; settled: boolean }> = [];

  const docOf = (id: string): Json => ({
    _id: id,
    type: "character",
    flags: {},
    _stats: { version: 1 },
  });

  const favorites = $derived.by(() => {
    const mine = actorId;
    created += 1;
    const store = createFavoritesStore({
      actorId: mine,
      readActor: (id) => docOf(id),
      write: () => Promise.reject(new Error("this fixture never writes")),
      seedIds: () => [], // nothing to seed yet: the store answers without writing
      notify: () => undefined,
      delay: () => Promise.resolve(),
      shared: createFavoritesShared(),
    });
    const ask = store.ensureSeeded.bind(store);
    store.ensureSeeded = () => {
      asks.push({ actor: mine, settled: sheetSettled });
      ask();
    };
    return store;
  });

  const stop = $effect.root(() => {
    // (2) the sheet is taken for loaded a moment after the active actor changes.
    $effect(() => {
      void actorId;
      sheetSettled = false;
      const timer = setTimeout(() => {
        sheetSettled = true;
      }, settleMs);
      return () => {
        clearTimeout(timer);
      };
    });

    // (3) the seed is asked once the sheet has settled, and again whenever the list changes.
    $effect(() => {
      const store = favorites;
      if (!sheetSettled) return;
      void entries;
      untrack(() => {
        store.ensureSeeded();
      });
    });
  });
  flushSync();

  return {
    asks,
    storesCreated: () => created,
    switchActor(id) {
      actorId = id;
      flushSync();
    },
    touchEntries() {
      entries = [...entries, `entry-${String(entries.length)}`];
      flushSync();
    },
    flush: () => {
      flushSync();
    },
    stop,
  };
}
