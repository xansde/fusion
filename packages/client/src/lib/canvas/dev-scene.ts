/**
 * dev-scene.ts — development scene setup.
 *
 * Mounts a static background image (dev-map.png) and a configurable square
 * grid onto an initialized FusionCanvas. Used by TableScreen during M1-A
 * to show a real canvas without a connected Scene Document.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-024, §REQ-CNV-064..068
 *
 * The SceneConfig below matches the generated dev-map.png dimensions.
 */

import { Sprite, Assets, Graphics, type Texture } from "pixi.js";
import type { SceneConfig } from "@fusion/shared";
import { GridRenderer } from "./GridRenderer.js";
import type { FusionCanvas } from "./FusionCanvas.js";

// ---------------------------------------------------------------------------
// Default dev scene config
// ---------------------------------------------------------------------------

/**
 * Development scene config matching the generated dev-map.png (2800×2100 px).
 * Grid: 100 px cells = 5 ft (PF2e default), alternating_1 diagonal rule.
 *
 * REQ-CNV-064: scene dimensions 2800×2100
 * REQ-CNV-065: background image path
 * REQ-CNV-067: grid configuration
 * REQ-CNV-068: initial view centered on the map
 */
export const DEV_SCENE_CONFIG: SceneConfig = {
  width: 2800,
  height: 2100,
  padding: 0.1, // 10% border on each side
  backgroundPath: "/dev-map.png",
  backgroundColor: "#1a1a2e",
  foregroundPath: null,
  gridOffsetX: 0,
  gridOffsetY: 0,
  grid: {
    type: "square",
    size: 100,
    distance: 5,
    units: "ft",
    color: "#4a4a80",
    alpha: 0.5,
    diagonalRule: "alternating_1",
  },
  initialView: {
    x: 1400, // center of map
    y: 1050,
    scale: 0.8,
  },
};

// ---------------------------------------------------------------------------
// Dev scene loader
// ---------------------------------------------------------------------------

/**
 * Load the dev scene onto the given FusionCanvas.
 *
 * 1. Computes total canvas size including padding.
 * 2. Loads background image as a PIXI Sprite on the "background" layer.
 * 3. Configures the GridRenderer on the "controls" layer.
 * 4. Centers the initial view per SceneConfig.initialView.
 *
 * Returns a cleanup function that removes added objects.
 */
export async function loadDevScene(
  canvas: FusionCanvas,
  config: SceneConfig = DEV_SCENE_CONFIG,
): Promise<() => void> {
  const padX = Math.round(config.width * config.padding);
  const padY = Math.round(config.height * config.padding);
  const totalWidth = config.width + padX * 2;
  const totalHeight = config.height + padY * 2;

  const cleanupFns: Array<() => void> = [];

  // ---- Background image ----
  if (config.backgroundPath) {
    try {
      const texture = await Assets.load<Texture>(config.backgroundPath);
      const sprite = new Sprite(texture);
      sprite.x = padX;
      sprite.y = padY;
      sprite.width = config.width;
      sprite.height = config.height;
      sprite.label = "dev:background";
      sprite.eventMode = "none";

      canvas.getLayer("background").addChild(sprite);

      cleanupFns.push(() => {
        sprite.destroy();
      });
    } catch (err) {
      console.warn("[dev-scene] Could not load background:", config.backgroundPath, err);

      // Fallback: colored rectangle via Graphics
      const fallback = new Graphics();
      const bgColor = parseInt(config.backgroundColor.replace("#", ""), 16);
      fallback.rect(padX, padY, config.width, config.height).fill({ color: bgColor });
      fallback.label = "dev:background-fallback";
      canvas.getLayer("background").addChild(fallback);
      cleanupFns.push(() => {
        fallback.destroy();
      });
    }
  }

  // ---- Grid ----
  const gridCfg = GridRenderer.fromGridConfig(
    config.grid,
    totalWidth,
    totalHeight,
    config.gridOffsetX + padX,
    config.gridOffsetY + padY,
  );
  canvas.setGrid(gridCfg);
  cleanupFns.push(() => {
    canvas.setGrid(null);
  });

  // ---- Initial camera view ----
  if (config.initialView) {
    canvas.panTo(
      config.initialView.x + padX,
      config.initialView.y + padY,
      config.initialView.scale,
    );
  } else {
    canvas.fitToScene(totalWidth, totalHeight, 0);
  }

  // Return cleanup
  return () => {
    for (const fn of cleanupFns) fn();
  };
}
