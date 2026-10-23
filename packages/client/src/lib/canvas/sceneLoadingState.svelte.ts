/**
 * sceneLoadingState.svelte.ts — whether a scene swap is waiting on its art long enough
 * (> 300 ms, see `trackSlowLoad`) to deserve the discreet "Carregando cena…" notice.
 *
 * A counter, not a boolean: two swaps can overlap when the GM switches twice quickly, and the
 * first one finishing must not hide the notice the second still needs.
 */

export const sceneLoadingState: { pending: number } = $state({ pending: 0 });

export function beginSceneLoadingNotice(): void {
  sceneLoadingState.pending += 1;
}

export function endSceneLoadingNotice(): void {
  sceneLoadingState.pending = Math.max(0, sceneLoadingState.pending - 1);
}
