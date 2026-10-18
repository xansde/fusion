/**
 * State of the on-screen measuring tool (the toolbar button and its picker).
 *
 * Shared between the button (RulerToolButton.svelte) and the DOM adapter
 * (attachRuler.ts), which are built in different places. The hold-R gesture does
 * not touch this: it works with the tool off.
 */

import { normalizeAreaSize } from "@fusion/shared";
import type { ToolMode } from "./templateTool.js";

export const rulerTool: { mode: ToolMode | null; sizeFt: number } = $state({
  mode: null,
  sizeFt: 15,
});

/** Switch to `mode`; choosing the active mode again switches the tool off. */
export function selectRulerMode(mode: ToolMode): void {
  rulerTool.mode = rulerTool.mode === mode ? null : mode;
}

export function setRulerTool(mode: ToolMode | null): void {
  rulerTool.mode = mode;
}

/** Set the area size in feet (rounded to steps of 5, clamped to 5..500). */
export function setAreaSize(ft: number): void {
  rulerTool.sizeFt = normalizeAreaSize(ft);
}

/** Step the area size by `steps` times 5 ft (the mouse wheel). */
export function stepAreaSize(steps: number): void {
  setAreaSize(rulerTool.sizeFt + steps * 5);
}
