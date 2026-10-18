/**
 * fogToolState.svelte.ts — what the GM has armed in the fog mini-bar.
 *
 * A single reactive object shared by the toolbar (writes it) and the canvas
 * controller (reads it through `getOptions`). Per-viewer UI state: it is never
 * sent anywhere. The scene's actual fog lives on the Scene document.
 */

import type { FogMode } from "@fusion/shared";
import type { FogTool } from "./FogToolController.js";

export const DEFAULT_BRUSH_RADIUS = 80;
export const MIN_BRUSH_RADIUS = 10;
export const MAX_BRUSH_RADIUS = 400;

export const fogToolState: {
  tool: FogTool;
  mode: FogMode;
  radius: number;
  snap: boolean;
  /** One-line message under the bar (e.g. "fog too complex"); cleared on the next action. */
  notice: string | null;
} = $state({
  tool: "none",
  mode: "reveal",
  radius: DEFAULT_BRUSH_RADIUS,
  snap: true,
  notice: null,
});

/** Put the pointer back to normal canvas interaction. */
export function closeFogBar(): void {
  fogToolState.tool = "none";
  fogToolState.notice = null;
}
