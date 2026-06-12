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

/**
 * Load a SceneDocument onto the canvas.
 * Clears any previous background/grid state first.
 *
 * @returns Cleanup function — call before loading a new scene.
 */
export async function loadSceneDocument(
  canvas: FusionCanvas,
  scene: SceneDocument,
): Promise<() => void> {
  const padX = Math.round(scene.width * scene.padding);
  const padY = Math.round(scene.height * scene.padding);
  const totalWidth = scene.width + padX * 2;
  const totalHeight = scene.height + padY * 2;

  const cleanupFns: Array<() => void> = [];

  // ---- Background ----
  if (scene.background) {
    try {
      const texture = await Assets.load<Texture>(scene.background);
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
    } catch {
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
    scene.grid as unknown as GridConfig,
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
