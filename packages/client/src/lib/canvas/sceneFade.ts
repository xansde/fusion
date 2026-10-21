/**
 * sceneFade.ts — the short fade (~250 ms) that follows a scene swap. Pure: it only moves an
 * `alpha` through a ticker the caller hands in, so it needs neither PIXI nor the DOM to test.
 */

/** Duration of the fade that follows a scene swap. */
export const SCENE_FADE_MS = 250;

/**
 * Fade `target.alpha` from 0 to 1 over `durationMs`, driven by the caller's ticker.
 * Returns a canceller that snaps the target to fully visible and stops the animation.
 */
export function fadeIn(
  target: { alpha: number },
  addTicker: (cb: (ticker: { deltaMS: number }) => void) => () => void,
  durationMs: number = SCENE_FADE_MS,
): () => void {
  let elapsed = 0;
  let stop: (() => void) | null = null;
  const finish = (): void => {
    target.alpha = 1;
    stop?.();
    stop = null;
  };
  target.alpha = 0;
  stop = addTicker((ticker) => {
    elapsed += ticker.deltaMS;
    if (elapsed >= durationMs) finish();
    else target.alpha = elapsed / durationMs;
  });
  return finish;
}
