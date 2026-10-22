/**
 * canvasType.ts — the type of the text PIXI draws on the map (ui-mesa-hud, 22/10/2026).
 *
 * The canvas cannot read CSS variables, so the faces and sizes of `styles/base.css` are
 * mirrored here, once: token names, ruler and note labels and pings use the app's reading
 * face (Atkinson Hyperlegible Next, self-hosted, already loaded by the page) instead of
 * whatever "sans-serif" the system had, and nothing is drawn under the 13 px floor.
 * Keep in step with `--fusion-font`, `--fusion-font-mono` and `--fusion-text-*`.
 */

/** `--fusion-font`. */
export const CANVAS_FONT = '"Atkinson Hyperlegible Next", system-ui, sans-serif';

/** `--fusion-font-mono`: numbers (elevation). */
export const CANVAS_FONT_MONO = '"Atkinson Hyperlegible Mono", ui-monospace, monospace';

/** `--fusion-text-xs | -sm | -base | -md`, in px. */
export const CANVAS_TEXT = {
  xs: 13,
  sm: 14,
  base: 15,
  md: 16,
} as const;
