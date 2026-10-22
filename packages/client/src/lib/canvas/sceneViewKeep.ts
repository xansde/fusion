/**
 * sceneViewKeep.ts — keep the camera still across a reload of the SAME scene.
 *
 * Changing the grid (calibration, size, colour) reloads the scene so the
 * background, the grid and the snap all pick up the new numbers. A fresh load
 * fits the scene to the screen, which would throw the Master out of the spot
 * they had zoomed in on to check the alignment. The view is remembered in MAP
 * coordinates (relative to the map corner), because the scene padding is a
 * whole number of cells and moves when the cell size does.
 */
import { screenToWorld, type CameraState } from "./camera-math.js";

export interface KeptView {
  /** View centre, relative to the map's top-left corner. */
  readonly mapX: number;
  readonly mapY: number;
  readonly scale: number;
}

export interface MapCorner {
  readonly padX: number;
  readonly padY: number;
}

interface CaptureTarget {
  readonly camera: CameraState;
  readonly viewElement: { readonly clientWidth: number; readonly clientHeight: number };
}

export function captureView(canvas: CaptureTarget, corner: MapCorner): KeptView {
  const c = screenToWorld(
    canvas.viewElement.clientWidth / 2,
    canvas.viewElement.clientHeight / 2,
    canvas.camera,
  );
  return { mapX: c.x - corner.padX, mapY: c.y - corner.padY, scale: canvas.camera.scale };
}

export function restoreView(
  canvas: { panTo: (x: number, y: number, scale?: number) => void },
  kept: KeptView,
  corner: MapCorner,
): void {
  canvas.panTo(kept.mapX + corner.padX, kept.mapY + corner.padY, kept.scale);
}
