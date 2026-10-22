/**
 * scenePreload.ts — get the NEXT scene's texture into PIXI's cache before the current scene is
 * taken down, so the swap has no empty canvas in between.
 *
 * Two small, independent pieces (all Svelte/DOM free, so they unit-test without a canvas):
 *
 *   - `preloadSceneTexture`  resolves the background grant with a LIVE token and warms
 *                            `Assets` — `loadSceneDocument` then finds it already cached.
 *   - `trackSlowLoad`        shows a "loading" indicator only if the wait passes a threshold,
 *                            so a fast switch never flashes it.
 *
 * A preload NEVER throws and never blocks a scene: a failed warm-up just means the regular
 * load (which has its own fallback) pays the cost it always paid.
 */

import { Assets, type Texture } from "pixi.js";
import { fusionApi } from "../api.js";
import { session } from "../session.svelte.js";
import { resolveAssetUrl } from "../assets/assetApi.js";

/** What a preload needs from a scene: the document that carries the art, and the art. */
export interface PreloadableScene {
  readonly _id: string;
  readonly background?: string | null | undefined;
}

/** Loads of the same scene art that are still running — a second request joins the first. */
const inflight = new Map<string, Promise<boolean>>();

/**
 * Warm PIXI's texture cache with a scene's background.
 *
 * @returns `true` once the texture is cached, `false` when there was nothing to load or the
 *   load failed (never rejects).
 */
export function preloadSceneTexture(scene: PreloadableScene): Promise<boolean> {
  const background = scene.background;
  if (!background) return Promise.resolve(false);

  const key = `${scene._id}|${background}`;
  const running = inflight.get(key);
  if (running) return running;

  const job = (async (): Promise<boolean> => {
    try {
      const accessToken = await fusionApi.getFreshToken();
      const userId = session.user?.id;
      const url =
        accessToken && userId
          ? await resolveAssetUrl(background, accessToken, userId, {
              table: "scenes",
              id: scene._id,
            })
          : background;
      await Assets.load<Texture>(url);
      return true;
    } catch (err) {
      console.warn("[scenePreload] could not preload scene art:", background, err);
      return false;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

/** Wait this long before a loading indicator is worth showing (a fast load must not flash it). */
export const SCENE_LOADING_DELAY_MS = 300;

/**
 * Await `work`, calling `show()` only if it is still pending after `delayMs`, and `hide()` when
 * it settles (only if `show()` ran). Resolves/rejects exactly like `work`.
 */
export async function trackSlowLoad<T>(
  work: Promise<T>,
  hooks: { show: () => void; hide: () => void; delayMs?: number },
): Promise<T> {
  // An object (not a bare `let`): the timer callback flips it, which the flow analysis cannot see on a local.
  const state = { shown: false };
  const timer = setTimeout(() => {
    state.shown = true;
    hooks.show();
  }, hooks.delayMs ?? SCENE_LOADING_DELAY_MS);
  try {
    return await work;
  } finally {
    clearTimeout(timer);
    if (state.shown) hooks.hide();
  }
}
