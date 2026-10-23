/**
 * sceneSwap.ts — the ORDER of a scene change: the new art arrives first, the old scene comes
 * down second.
 *
 * TableScreen used to tear the current scene down synchronously and only then start loading the
 * next one, so the table stared at an empty canvas for as long as the texture took. Here the
 * current scene stays on screen while the next one's texture is fetched; only when it is ready
 * (or has failed — the regular load has its own fallback) does the swap happen, in one step.
 *
 * Kept free of PIXI and Svelte so the ordering is testable on its own.
 */

import { trackSlowLoad } from "./scenePreload.js";

export interface SceneSwapSteps {
  /** False once a newer scene change has begun — a superseded swap must do nothing more. */
  isCurrent: () => boolean;
  /** Warm the next scene's assets. May reject or resolve `false`; neither stops the swap. */
  preload: () => Promise<unknown>;
  /** Indicator hooks, shown only when the preload outlasts the threshold. */
  showLoading: () => void;
  hideLoading: () => void;
  /** Take the CURRENT scene down. Called only after the preload, and only if still current. */
  teardown: () => void;
  /** Bring the NEXT scene up. Called right after `teardown`, in the same tick. */
  load: () => Promise<void>;
}

/** @returns `true` when the swap ran, `false` when it was superseded while preloading. */
export async function swapScene(steps: SceneSwapSteps): Promise<boolean> {
  try {
    await trackSlowLoad(steps.preload(), {
      show: steps.showLoading,
      hide: steps.hideLoading,
    });
  } catch {
    // A failed warm-up is not a failed scene: the regular load below retries and falls back.
  }
  if (!steps.isCurrent()) return false;

  steps.teardown();
  await steps.load();
  return true;
}
