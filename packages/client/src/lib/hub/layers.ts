/**
 * layers.ts — the shell layer scale, mirrored from CSS for TypeScript callers.
 *
 * REQ-UIF-008 [MVP]: the shell z-index system must be unified and declared in a
 * single place. That place is the `--fusion-z-*` custom property block in
 * `src/styles/base.css`. This module mirrors those values so logic that needs a
 * numeric layer (tests, canvas overlays anchored in JS) reads the same scale
 * instead of re-inventing magic numbers.
 *
 * Keep this table and the CSS block in sync — `layers.test.ts` asserts the
 * ordering invariants that make the scale meaningful, so a renumbering that
 * breaks the intent fails the gates.
 */

/** Layer bands, ascending. Values match `--fusion-z-*` in `base.css`. */
export const Z_LAYERS = {
  canvas: 0,
  region: 100,
  windows: 200,
  hub: 300,
  menu: 400,
  modal: 500,
  notification: 600,
} as const;

export type LayerName = keyof typeof Z_LAYERS;

/**
 * The intended painting order, bottom to top. `layers.test.ts` walks this to
 * verify {@link Z_LAYERS} agrees, which is what stops a well-meaning bump of
 * one band from silently putting the Hub over the modals.
 */
export const LAYER_ORDER: readonly LayerName[] = [
  "canvas",
  "region",
  "windows",
  "hub",
  "menu",
  "modal",
  "notification",
] as const;

/** CSS custom property name for a layer, for use in inline `style` bindings. */
export function layerVar(name: LayerName): string {
  return `var(--fusion-z-${name})`;
}

// ---------------------------------------------------------------------------
// Hub overlay contract
// ---------------------------------------------------------------------------

/**
 * Class applied to the Hub layer host element.
 *
 * The host spans the whole viewport but is `pointer-events: none`, so a click
 * that lands on empty Hub space falls through to whatever is underneath —
 * canvas, tokens, windows. Only elements that opt in via
 * {@link HUB_SURFACE_CLASS} take pointer input.
 */
export const HUB_LAYER_CLASS = "fusion-hub-layer";

/**
 * Class that opts an element inside the Hub layer back into pointer events.
 *
 * Opt-in rather than opt-out is deliberate: the Hub is expected to hold
 * decorative, non-interactive chrome (vignettes, scanlines, ambient glow) that
 * covers large areas. If those captured clicks the map would become unusable,
 * and the bug would present as "the canvas randomly stops responding" — very
 * hard to trace back to a decorative div.
 */
export const HUB_SURFACE_CLASS = "hub-surface";
