/**
 * gridCalibrationState.svelte.ts — which scene the grid calibration tool is aimed at.
 *
 * The tool has two doors: the corner button (aims at the scene on the canvas) and the
 * Cenas tab (aims at any scene, preparing it first so it is the one on the canvas).
 * Both land here; `TableScreen` mounts the panel while the corner panel "calibrate" is
 * open AND the canvas shows `sceneId`. The `.svelte.ts` extension is required for `$state`.
 */
import { openCornerPanel, closeCornerPanel } from "../ui/cornerPanel.svelte.js";
import { setRulerTool } from "../presence/rulerToolStore.svelte.js";

export const gridCalibrationState: { sceneId: string | null } = $state({ sceneId: null });

/** Aim the tool at `sceneId` and open its panel (closing any other corner panel). */
export function startGridCalibration(sceneId: string): void {
  // The ruler and the calibration box would fight over the same drag.
  setRulerTool(null);
  gridCalibrationState.sceneId = sceneId;
  openCornerPanel("calibrate");
}

/** Leave the tool without writing anything. */
export function stopGridCalibration(): void {
  gridCalibrationState.sceneId = null;
  closeCornerPanel("calibrate");
}
