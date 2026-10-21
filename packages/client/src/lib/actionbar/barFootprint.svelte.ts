/**
 * barFootprint.svelte.ts — how tall the action bar is right now, for whoever shares the
 * centre-bottom of the table with it (BAR-F1-04; spec 53 REQ-BAR-022).
 *
 * The bar's height is not fixed: it grows when a tab has two rows of slots, shrinks to the status
 * strip when folded, and is zero when no bar is drawn (a Mestre with nothing selected). The prepare
 * notice (`ScenePrepareNotice`, REQ-CEN-052) lives at the same spot and carries the only two ways
 * out of a prepare, so it must stack ABOVE the bar, whatever the bar's height. The bar publishes
 * its measured height here; the table shell turns it into the notice's offset
 * (`clearanceAboveBar`, `layout.ts`).
 *
 * `.svelte.ts` is required, not decorative: `$state` is a compiler rune.
 */

const footprint: { height: number } = $state({ height: 0 });

/** Called by the bar with its measured height (0 when it is not drawn). */
export function publishBarHeight(height: number): void {
  footprint.height = height;
}

/** The bar's height in px; 0 when no bar is drawn. Reactive. */
export function barHeight(): number {
  return footprint.height;
}
