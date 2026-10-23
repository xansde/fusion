/**
 * sceneLoadGuard.ts — pure generation-counter helper for TableScreen's
 * scene-reload `$effect` (see TableScreen.svelte, right below the
 * `canLoadScene` gate from canvasReadyGate.ts).
 *
 * BUG FIX (#81): the `$effect` used to clean up the PREVIOUS scene's content
 * synchronously at the START of its own execution (`cleanupScene?.()`), but
 * only learned the NEW scene's cleanup function AFTER an `await`. If the
 * effect re-ran while a load was still in flight — two scene switches close
 * together — the second run's start-of-execution cleanup found
 * `cleanupScene` still `null` (the first load hadn't resolved yet) and
 * cleaned up nothing. Whichever load then resolved LAST won unconditionally,
 * silently overwriting whatever the other load had assigned: the loser's
 * content/listeners leaked, or a still-live SceneOrchestrator was left
 * orphaned on the ticker.
 *
 * The fix: a generation counter, bumped by `begin()` every time the
 * `$effect` starts a new load — synchronously, before its first `await`.
 * Once a load resolves, it calls `isCurrent(generation)`: if a NEWER
 * generation has begun in the meantime, this load's own result is stale —
 * the caller is responsible for disposing of whatever it just obtained
 * immediately (it is the only one holding a reference to it) and must NOT
 * install it as the active scene's state. If the generation is still
 * current, the caller may safely install the result.
 *
 * This module only decides "is this result still wanted?" — it does not own
 * cleanup storage or invocation, so it stays a pure counter with no
 * dependency on window/PIXI/Svelte and is trivially unit-testable.
 */

export interface SceneLoadGuard {
  /**
   * Call synchronously whenever a new scene load starts, before the first
   * `await`. Returns the generation id for this load.
   */
  begin(): number;
  /**
   * True when `generation` is still the most recently begun load — i.e. no
   * newer load has started since. Call after every `await` in the load
   * chain to decide whether the just-obtained result is still wanted.
   */
  isCurrent(generation: number): boolean;
}

export function createSceneLoadGuard(): SceneLoadGuard {
  let generation = 0;

  return {
    begin(): number {
      generation += 1;
      return generation;
    },
    isCurrent(loadGeneration: number): boolean {
      return loadGeneration === generation;
    },
  };
}
