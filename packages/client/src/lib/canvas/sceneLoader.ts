/**
 * sceneLoader.ts — load a SceneDocument onto a FusionCanvas.
 *
 * Spec: 06-canvas-e-renderizacao.md §scene activation
 * M1-B: renders background (path/URL string) + grid from SceneDocument.
 * Tokens are NOT rendered here (M1-C).
 *
 * Returns a cleanup function that removes all added PIXI objects.
 */

import { Sprite, Assets, Graphics, type Texture } from "pixi.js";
import type { SceneDocument, GridConfig } from "@fusion/shared";
import { GridRenderer } from "./GridRenderer.js";
import type { FusionCanvas } from "./FusionCanvas.js";
import { resolveAssetUrl } from "../assets/assetApi.js";
import { fusionApi } from "../api.js";
import { session } from "../session.svelte.js";
import { sceneContentOffset } from "./sceneCoords.js";

/**
 * Load a SceneDocument onto the canvas.
 * Clears any previous background/grid state first.
 *
 * BUG A FIX: scene.background is persisted as a clean `/assets/<name>` path
 * (no query token — see resolveAssetUrl()'s doc comment). We mint a fresh
 * credential right before PIXI Assets.load() instead of loading the raw path,
 * otherwise the server's static route 401s on every scene load.
 *
 * T025: that credential is a grant for THIS scene document.
 *
 * TK023 (REQ-CNV-091): a token no longer carries its own `texture` — its art is
 * the effective actor's `img`, so each `TokenSprite` mints its OWN grant against
 * the `actors` table (`{ table: "actors", id: actorId }`), not this scene's. The
 * "one mint pays for background and every token" claim this comment used to make
 * no longer holds; see `TokenSprite._loadArt`.
 *
 * @returns Cleanup function — call before loading a new scene.
 */
export async function loadSceneDocument(
  canvas: FusionCanvas,
  scene: SceneDocument,
): Promise<() => void> {
  const { padX, padY } = sceneContentOffset(scene);
  const totalWidth = scene.width + padX * 2;
  const totalHeight = scene.height + padY * 2;

  const cleanupFns: Array<() => void> = [];

  // ---- Background ----
  if (scene.background) {
    try {
      const accessToken = fusionApi.getToken();
      const userId = session.user?.id;
      const loadUrl =
        accessToken && userId
          ? await resolveAssetUrl(scene.background, accessToken, userId, {
              table: "scenes",
              id: scene._id,
            })
          : scene.background;
      const texture = await Assets.load<Texture>(loadUrl);
      const sprite = new Sprite(texture);
      sprite.x = padX;
      sprite.y = padY;
      sprite.width = scene.width;
      sprite.height = scene.height;
      sprite.label = "scene:background";
      sprite.eventMode = "none";
      canvas.getLayer("background").addChild(sprite);
      cleanupFns.push(() => {
        sprite.destroy();
      });
    } catch (err) {
      // BUG #5b instrumentation: log the real cause instead of silently
      // falling back — resolveAssetUrl()/Assets.load() failures were
      // invisible before this, masking why a valid background didn't render.
      console.error("[sceneLoader] background load failed:", scene.background, err);
      // Fallback: solid color rectangle
      const g = new Graphics();
      const bgColor = parseInt(scene.backgroundColor.replace("#", ""), 16);
      g.rect(padX, padY, scene.width, scene.height).fill({ color: bgColor });
      g.label = "scene:background-fallback";
      canvas.getLayer("background").addChild(g);
      cleanupFns.push(() => {
        g.destroy();
      });
    }
  } else {
    // Solid color background
    const g = new Graphics();
    const bgColor = parseInt(scene.backgroundColor.replace("#", ""), 16);
    g.rect(padX, padY, scene.width, scene.height).fill({ color: bgColor });
    g.label = "scene:background-solid";
    canvas.getLayer("background").addChild(g);
    cleanupFns.push(() => {
      g.destroy();
    });
  }

  // ---- Grid ----
  // Cast needed: scene.grid is inferred from Zod with `| undefined` on optional
  // fields, which is incompatible with GridConfig under exactOptionalPropertyTypes.
  const gridCfg = GridRenderer.fromGridConfig(
    // scene.grid can be undefined at runtime (scenes persisted without a grid,
    // see r7.1) despite the type saying otherwise; `?? null` normalizes it for
    // fromGridConfig's null guard, so this conditional is intentional.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    (scene.grid ?? null) as unknown as GridConfig | null,
    totalWidth,
    totalHeight,
    padX,
    padY,
  );
  canvas.setGrid(gridCfg);
  cleanupFns.push(() => {
    canvas.setGrid(null);
  });

  // ---- Camera ----
  if (scene.initialView) {
    canvas.panTo(scene.initialView.x + padX, scene.initialView.y + padY, scene.initialView.scale);
  } else {
    canvas.fitToScene(totalWidth, totalHeight, 0);
  }

  return () => {
    for (const fn of cleanupFns) fn();
  };
}
