/**
 * Whether the on-screen ruler tool (the toolbar button) is switched on.
 *
 * Shared state between the button (RulerToolButton.svelte) and the DOM adapter
 * (attachRuler.ts), which are built in different places. The hold-R gesture
 * does not touch this: it works with the tool off.
 */

export const rulerTool = $state({ active: false });

export function toggleRulerTool(): void {
  rulerTool.active = !rulerTool.active;
}

export function setRulerTool(active: boolean): void {
  rulerTool.active = active;
}
