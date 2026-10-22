/**
 * cornerPanel.svelte.ts — which map-corner tool panel is open.
 *
 * The ruler picker, the "show to players" form and the fog bar share the top-left
 * corner of the canvas. One state, one open panel: opening one closes the others, so
 * they never stack on top of each other.
 */

import { closeFogBar } from "../canvas/fog/fogToolState.svelte.js";

export type CornerPanelId = "ruler" | "show" | "fog" | "calibrate";

export const cornerPanel: { open: CornerPanelId | null } = $state({ open: null });

/** Open `id`, closing whichever other panel was open. */
export function openCornerPanel(id: CornerPanelId): void {
  if (cornerPanel.open === "fog" && id !== "fog") closeFogBar();
  cornerPanel.open = id;
}

/** Close `id` if it is the open one (no-op for a panel that is not showing). */
export function closeCornerPanel(id: CornerPanelId): void {
  if (cornerPanel.open !== id) return;
  if (id === "fog") closeFogBar();
  cornerPanel.open = null;
}

/** Toggle `id`: opens it (closing the others) or closes it. */
export function toggleCornerPanel(id: CornerPanelId): void {
  if (cornerPanel.open === id) closeCornerPanel(id);
  else openCornerPanel(id);
}

/** Close whichever panel is open (arming the pin tool does this). */
export function closeAllCornerPanels(): void {
  if (cornerPanel.open !== null) closeCornerPanel(cornerPanel.open);
}
