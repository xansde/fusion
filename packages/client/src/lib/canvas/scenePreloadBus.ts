/**
 * scenePreloadBus.ts — the seam between the socket layer and the canvas for "Pre-carregar para
 * todos". worldSync (plain TS, no PIXI) receives the server's `scene:preload` hint and drops it
 * here; whoever owns the canvas (TableScreen) registers the listener that actually warms the
 * texture. Keeping the hand-off in this tiny module is what lets worldSync stay PIXI-free.
 */

export interface ScenePreloadHint {
  readonly sceneId: string;
  readonly background: string;
}

let listener: ((hint: ScenePreloadHint) => void) | null = null;

/** Register (or clear, with `null`) the one listener for preload hints. */
export function setScenePreloadListener(cb: ((hint: ScenePreloadHint) => void) | null): void {
  listener = cb;
}

/** Called by worldSync when a `scene:preload` op arrives. No listener = the hint is dropped. */
export function dispatchScenePreload(payload: unknown): void {
  if (listener === null || typeof payload !== "object" || payload === null) return;
  const { sceneId, background } = payload as { sceneId?: unknown; background?: unknown };
  if (typeof sceneId !== "string" || typeof background !== "string") return;
  listener({ sceneId, background });
}
