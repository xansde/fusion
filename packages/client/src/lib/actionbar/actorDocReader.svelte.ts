/**
 * actorDocReader.svelte.ts — a reactive read of an actor document (BAR-F1-04; spec 53 RNF-BAR-03).
 *
 * The world mirror is a plain store: `getDoc` is not reactive, and a Svelte `$derived` that calls it
 * would never hear that the sheet changed. The bar must redraw when the active actor's document is
 * updated (hit points, a spell slot spent, a condition gained), so this reader touches one counter
 * the mirror's own subscription bumps on every Actor change.
 *
 * The counter is shared by all actors on purpose — it is a signal, not a cache, and the mirror
 * hands its listener the whole list of Actors, not the id that changed. So a reader re-runs when
 * ANY actor of the world is updated, somebody else's included: the bar rebuilds its context and
 * asks the provider again. That is cheap on purpose (entries and status are pure functions of the
 * document, and the DOM only changes where a value did), and it is what keeps the bar right when
 * the change that matters arrives from elsewhere (an ownership grant, a condition set by the Mestre).
 *
 * `.svelte.ts` is required, not decorative: `$state` is a compiler rune.
 */

import { untrack } from "svelte";

import { worldMirror } from "../docs/worldSync.js";

const signal: { version: number } = $state({ version: 0 });

// The writer runs inside `untrack`: an update may land while a table effect is running, and that
// effect must not start depending on this counter by accident.
worldMirror.subscribe<Record<string, unknown>>("Actor", () => {
  untrack(() => {
    signal.version += 1;
  });
});

/** The actor's document in the mirror, or `undefined`. Reactive inside a template, `$derived` or `$effect`. */
export function readActorDoc(actorId: string): Record<string, unknown> | undefined {
  void signal.version;
  return worldMirror.getDoc<Record<string, unknown>>("Actor", actorId);
}
