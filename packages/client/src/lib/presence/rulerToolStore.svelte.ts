/**
 * State of the on-screen measuring tool (the toolbar button and its picker).
 *
 * Shared between the button (RulerToolButton.svelte) and the DOM adapter
 * (attachRuler.ts), which are built in different places. The hold-R gesture does
 * not touch this: it works with the tool off.
 */

import {
  DEFAULT_AREA_STYLE,
  normalizeAreaSize,
  normalizeAreaStyle,
  type AreaKind,
  type AreaStyle,
} from "@fusion/shared";
import type { ToolMode } from "./templateTool.js";

/**
 * What an area is for: "measure" (the ruler button: draws, Shift pins) or "target" (the targets button: the area is
 * only a selector, on release it marks the tokens inside as the user's aim and is never pinned or shared).
 */
export type ToolPurpose = "measure" | "target";

export const rulerTool: {
  mode: ToolMode | null;
  purpose: ToolPurpose;
  sizeFt: number;
  style: AreaStyle;
} = $state({
  mode: null,
  purpose: "measure",
  sizeFt: 15,
  style: { ...DEFAULT_AREA_STYLE },
});

/** Change the style the NEXT placed area gets (colour, border, fill). */
export function setAreaStyle(patch: Partial<AreaStyle>): void {
  rulerTool.style = normalizeAreaStyle({ ...rulerTool.style, ...patch });
}

/**
 * The right-click menu of a pinned template: which one, and where on screen.
 * Null when closed.
 */
export const templateMenu: { open: { id: string; x: number; y: number } | null } = $state({
  open: null,
});

export function openTemplateMenu(id: string, x: number, y: number): void {
  templateMenu.open = { id, x, y };
}

export function closeTemplateMenu(): void {
  templateMenu.open = null;
}

/** Switch to `mode`; choosing the active mode again switches the tool off. */
export function selectRulerMode(mode: ToolMode): void {
  const same = rulerTool.mode === mode && rulerTool.purpose === "measure";
  rulerTool.purpose = "measure";
  rulerTool.mode = same ? null : mode;
}

/** Switch the area selector of the targets button to `mode`; choosing the active one again switches it off. */
export function selectTargetArea(mode: AreaKind): void {
  const same = rulerTool.mode === mode && rulerTool.purpose === "target";
  rulerTool.purpose = "target";
  rulerTool.mode = same ? null : mode;
}

export function setRulerTool(mode: ToolMode | null): void {
  rulerTool.mode = mode;
  rulerTool.purpose = "measure";
}

/** Set the area size in feet (rounded to steps of 5, clamped to 5..500). */
export function setAreaSize(ft: number): void {
  rulerTool.sizeFt = normalizeAreaSize(ft);
}

/** Step the area size by `steps` times 5 ft (the mouse wheel). */
export function stepAreaSize(steps: number): void {
  setAreaSize(rulerTool.sizeFt + steps * 5);
}
