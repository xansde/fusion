/**
 * favoritesStoreReactivityProbe.svelte.ts — fixture for the "the favourites row is reactive" test in
 * `favoritesStoreReactivity.test.ts` (BAR-F3-01). Not a test file: Vitest does not collect it.
 *
 * Why a fixture bundled by `vite build`: Vitest compiles `.svelte.ts` modules for the SERVER, where
 * `$effect` never runs, so a plain test cannot observe an effect. The test bundles this module (client
 * compile, client runtime) and runs the bundle, which is how the store runs in the browser.
 *
 * What it models: the bar draws `store.slots()` inside a `$derived` and a template, i.e. inside a
 * reactive context. The row must CHANGE THERE — with no one calling anything — when:
 *  - the player pins (the edit shows at once, before the server answers);
 *  - the server answers (the row stays: the ack's document is used while the mirror is behind);
 *  - another device's write reaches the mirror (the document is reactive, `readActorDoc` in the app);
 *  - a write fails (the optimistic edit goes away).
 * A pending list kept in a plain array would still pass every logic test and leave the UI frozen.
 */

import { flushSync } from "svelte";

import { createFavoritesShared, createFavoritesStore } from "../favoritesStore.svelte.js";

type Json = Record<string, unknown>;

export interface StoreObservations {
  /** What an effect that reads `store.slots()` saw, one entry per run: the first three positions. */
  all: string[];
  initial: string;
  /** Right after `pin()`, before the server answered. */
  optimistic: string;
  /** The server answered; the mirror has not caught up. */
  acked: string;
  /** Another device pinned and the mirror received it. */
  broadcast: string;
  /** Right after an `unpin()` whose write is going to fail. */
  unpinning: string;
  /** After that write failed. */
  afterFailure: string;
  notices: string[];
}

const show = (slots: ReadonlyArray<string | null>): string =>
  slots
    .slice(0, 3)
    .map((id) => id ?? "·")
    .join(",");

export async function observeStore(): Promise<StoreObservations> {
  let version = 3;
  let serverRow: Array<string | null> = new Array<string | null>(12).fill(null);
  const docAt = (): Json => ({
    _id: "actor-1",
    type: "character",
    flags: { fusion: { actionBar: { favorites: [...serverRow], seeded: true } } },
    _stats: { version },
  });

  // The mirror's copy: reactive, and replaced (not edited) when a broadcast arrives.
  let mirror = $state.raw<Json>(docAt());
  let failNext = false;
  let release: (() => void) | null = null;
  const notices: string[] = [];

  const store = createFavoritesStore({
    actorId: "actor-1",
    readActor: () => mirror,
    write: async (payload) => {
      // Hold the write until the test lets it go, so "before the answer" can be looked at.
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (failNext) throw new Error("sem conexão");
      const diff = (payload as { updates: Array<{ diff: Json }> }).updates[0]?.diff ?? {};
      serverRow = [...(diff["flags.fusion.actionBar.favorites"] as Array<string | null>)];
      version += 1;
      return { documentType: "Actor", documents: [docAt()] };
    },
    seedIds: () => [],
    notify: (message) => {
      notices.push(message);
    },
    delay: () => Promise.resolve(),
    shared: createFavoritesShared(),
  });

  const all: string[] = [];
  const stop = $effect.root(() => {
    $effect(() => {
      all.push(show(store.slots()));
    });
  });
  flushSync();
  const initial = all[all.length - 1] ?? "";

  const answer = async (): Promise<void> => {
    // The write reaches `write()` a few microtasks after the edit; let it, then answer.
    while (release === null) await Promise.resolve();
    const go = release as () => void;
    release = null;
    go();
    await store.settled();
    flushSync();
  };

  store.pin("strike:a");
  flushSync();
  const optimistic = all[all.length - 1] ?? "";

  await answer();
  const acked = all[all.length - 1] ?? "";

  // Another device pins B; the broadcast reaches this client's mirror.
  serverRow = ["strike:a", "strike:b", ...new Array<null>(10).fill(null)];
  version += 1;
  mirror = docAt();
  flushSync();
  const broadcast = all[all.length - 1] ?? "";

  failNext = true;
  store.unpin("strike:a");
  flushSync();
  const unpinning = all[all.length - 1] ?? "";
  await answer();
  const afterFailure = all[all.length - 1] ?? "";

  stop();
  return { all, initial, optimistic, acked, broadcast, unpinning, afterFailure, notices };
}
