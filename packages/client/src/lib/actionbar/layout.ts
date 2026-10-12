/**
 * layout.ts — where the action bar sits, and when it folds itself (BAR-F1-04; spec 53
 * REQ-BAR-022, REQ-BAR-025, DEC-BAR-09; tasks.md §2.7).
 *
 * Pure: the viewport width and the drawer's open state go in, the geometry comes out, so the
 * placement is testable without a browser (§2.10). The bar belongs to the centre-bottom of the
 * table and is centred in the FREE area — the strip between the left edge and the side drawer
 * (44 px of rail when the drawer is closed, 344 px when it is open) — not in the viewport, or an
 * open drawer would sit on top of it. When that strip is narrower than ~1000 px there is no room
 * for twelve readable slots, and the bar folds itself to the status strip.
 *
 * The numbers are the prototype's (`.abar` in `prototipo-barra-fiel.html`): 780 px at most, 12 px
 * of air on each side, 14 px from the bottom edge.
 */

import { drawerWidth } from "../sidebar/drawerLayout.svelte.js";

/** The widest the bar gets (prototype `.abar`: `width: min(780px, …)`). */
export const ACTION_BAR_MAX_WIDTH = 780;

/** Air kept on each side of the bar inside the free area (prototype: `calc(100% - drawer - 24px)`). */
export const ACTION_BAR_EDGE_GAP = 12;

/** Distance from the bottom edge of the table (prototype `.abar { bottom: 14px }`). */
export const ACTION_BAR_BOTTOM_OFFSET = 14;

/** Free area (px) under which the bar folds itself to the status strip (REQ-BAR-025). */
export const ACTION_BAR_COLLAPSE_BELOW = 1000;

export interface BarLayoutInput {
  /** `window.innerWidth`: the table fills the viewport. */
  viewportWidth: number;
  /** Whether the side drawer is open (`isDrawerOpen()`). */
  drawerOpen: boolean;
}

export interface BarLayout {
  /** Width the drawer covers: 44 closed, 344 open, the whole viewport when narrow and open. */
  drawerWidth: number;
  /** The strip the drawer leaves free, in px. */
  freeWidth: number;
  /** x of the middle of the free area, from the left edge of the table. */
  centerX: number;
  /** Width of the bar: 780 px, or the free area less the side air when that is smaller. */
  width: number;
  /** True when the free area is under {@link ACTION_BAR_COLLAPSE_BELOW}: the bar folds itself. */
  narrow: boolean;
}

export function computeBarLayout(input: BarLayoutInput): BarLayout {
  const covered = drawerWidth(input.drawerOpen, input.viewportWidth);
  const freeWidth = Math.max(0, input.viewportWidth - covered);
  return {
    drawerWidth: covered,
    freeWidth,
    centerX: freeWidth / 2,
    width: Math.max(0, Math.min(ACTION_BAR_MAX_WIDTH, freeWidth - ACTION_BAR_EDGE_GAP * 2)),
    narrow: freeWidth < ACTION_BAR_COLLAPSE_BELOW,
  };
}

/** Air kept between the bar and whatever stacks above it (the prepare notice). */
export const ACTION_BAR_STACK_GAP = 8;

/** Gap between the top edge of the bar and the tooltip or menu that opens above it (prototype T1). */
export const ACTION_BAR_FLOAT_GAP = 6;

/**
 * The gap a slot's tooltip needs to clear the WHOLE bar, not just the slot: the distance from the slot
 * up to the top edge of the bar, plus the usual gap. The prototype puts tooltips above the bar, and
 * the status strip — which repeats "depois deste: MAP −10" while a strike is hovered — must stay
 * readable; a tooltip beside the slot would sit right on it.
 */
export function tooltipOffsetAboveBar(slotTop: number, barTop: number): number {
  return Math.max(ACTION_BAR_FLOAT_GAP, Math.round(slotTop - barTop) + ACTION_BAR_FLOAT_GAP);
}

/** The y a slot menu opens upward from: just above the top edge of the bar (prototype T1). */
export function menuOriginAboveBar(barTop: number): number {
  return barTop - ACTION_BAR_FLOAT_GAP;
}

/**
 * How far from the bottom edge the centre-bottom notices must sit to stay clear of the bar
 * (`ScenePrepareNotice`, REQ-BAR-022): the bar's own height, its distance from the edge and a gap —
 * or nothing, when no bar is drawn (`barHeight` 0), so the notice keeps its own place.
 */
export function clearanceAboveBar(barHeight: number): number {
  if (!(barHeight > 0)) return 0;
  return Math.ceil(barHeight) + ACTION_BAR_BOTTOM_OFFSET + ACTION_BAR_STACK_GAP;
}
