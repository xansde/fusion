/**
 * floating.ts — where a floating box goes: pure geometry, no DOM (BAR-F1-03).
 *
 * Tooltip, popover and context menu all answer the same question: given the trigger's
 * rectangle (or the pointer, which is a rectangle with no size), the size of the box to
 * show and the size of the viewport, where does the box's top-left corner go so that it
 * sits beside the trigger on the preferred side and still fits on screen?
 *
 * The answer is a "flip, then shift":
 *
 *  1. **Flip.** If the preferred side has no room for the box plus the gap, use the
 *     opposite side — when that one fits, or at least has more room than the preferred
 *     one. This is what makes a menu opened near the bottom edge open upward.
 *  2. **Align.** Along the other axis the box is centered, or lined up with the trigger's
 *     start or end edge. A start/end alignment that runs off the screen turns to the other
 *     edge when that overflows less — so a menu opened at the right edge opens to the
 *     left of the pointer.
 *  3. **Shift.** Whatever is left over is pushed back inside the padded viewport. A box
 *     bigger than the viewport is pinned to the top-left padding instead of being pushed
 *     off-screen.
 *
 * Kept free of `window`/`document` on purpose: the client's Vitest has no DOM, and a
 * positioning rule that can only be checked in a browser is a rule nobody re-checks.
 * `floatingLayer.ts` is the thin DOM glue that measures real elements and calls this.
 */

export type Side = "top" | "bottom" | "left" | "right";
export type Alignment = "start" | "center" | "end";
/** A side, optionally followed by an alignment: `"bottom"`, `"top-start"`, `"left-end"`. */
export type Placement = Side | `${Side}-start` | `${Side}-end`;

/** A rectangle in viewport coordinates (`getBoundingClientRect()`). Zero size = a point. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface FloatingInput {
  /** The trigger. Pass `{ x, y, width: 0, height: 0 }` for the pointer. */
  anchor: Rect;
  /** The box to place, already measured. */
  floating: Size;
  viewport: Size;
  /** Preferred placement. Defaults to `"bottom"`. */
  placement?: Placement | undefined;
  /** Gap between the trigger and the box, on the main axis. Defaults to 6. */
  offset?: number | undefined;
  /** Smallest distance kept to the viewport edge. Defaults to 8. */
  padding?: number | undefined;
}

export interface FloatingPosition {
  /** Left/top of the box, in whole viewport pixels. */
  x: number;
  y: number;
  /** The placement actually used, after any flip. */
  placement: Placement;
}

const DEFAULT_OFFSET = 6;
const DEFAULT_PADDING = 8;

const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

export function parsePlacement(placement: Placement): { side: Side; align: Alignment } {
  const [side, align] = placement.split("-") as [Side, Alignment | undefined];
  return { side, align: align ?? "center" };
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function zeroIfNotFinite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Distance by which `[pos, pos + size]` sticks out of `[padding, limit - padding]`. */
function overflow(pos: number, size: number, limit: number, padding: number): number {
  return Math.max(0, padding - pos) + Math.max(0, pos + size - (limit - padding));
}

/** Pulls `pos` back inside `[padding, limit - size - padding]`; the low end wins if it cannot fit. */
function clamp(pos: number, size: number, limit: number, padding: number): number {
  return Math.max(padding, Math.min(pos, limit - size - padding));
}

/** Start of the box along an axis for a given alignment against the anchor's span. */
function alignedStart(
  align: Alignment,
  anchorStart: number,
  anchorSize: number,
  floatingSize: number,
): number {
  if (align === "start") return anchorStart;
  if (align === "end") return anchorStart + anchorSize - floatingSize;
  return anchorStart + (anchorSize - floatingSize) / 2;
}

export function computePosition(input: FloatingInput): FloatingPosition {
  const offset = finite(input.offset, DEFAULT_OFFSET);
  const padding = finite(input.padding, DEFAULT_PADDING);

  const anchor: Rect = {
    x: zeroIfNotFinite(input.anchor.x),
    y: zeroIfNotFinite(input.anchor.y),
    width: zeroIfNotFinite(input.anchor.width),
    height: zeroIfNotFinite(input.anchor.height),
  };
  const box: Size = {
    width: zeroIfNotFinite(input.floating.width),
    height: zeroIfNotFinite(input.floating.height),
  };
  const view: Size = {
    width: zeroIfNotFinite(input.viewport.width),
    height: zeroIfNotFinite(input.viewport.height),
  };

  const preferred = parsePlacement(input.placement ?? "bottom");

  // --- 1. Flip -------------------------------------------------------------
  const room: Record<Side, number> = {
    top: anchor.y - padding,
    bottom: view.height - (anchor.y + anchor.height) - padding,
    left: anchor.x - padding,
    right: view.width - (anchor.x + anchor.width) - padding,
  };
  const needs = (side: Side): number =>
    (side === "top" || side === "bottom" ? box.height : box.width) + offset;

  let side = preferred.side;
  if (room[side] < needs(side)) {
    const opposite = OPPOSITE[side];
    if (room[opposite] >= needs(opposite) || room[opposite] > room[side]) side = opposite;
  }

  const vertical = side === "top" || side === "bottom";

  // --- 2. Align along the other axis --------------------------------------
  const crossAnchorStart = vertical ? anchor.x : anchor.y;
  const crossAnchorSize = vertical ? anchor.width : anchor.height;
  const crossBox = vertical ? box.width : box.height;
  const crossView = vertical ? view.width : view.height;

  let align = preferred.align;
  let cross = alignedStart(align, crossAnchorStart, crossAnchorSize, crossBox);
  if (align !== "center") {
    const otherAlign: Alignment = align === "start" ? "end" : "start";
    const other = alignedStart(otherAlign, crossAnchorStart, crossAnchorSize, crossBox);
    if (
      overflow(other, crossBox, crossView, padding) < overflow(cross, crossBox, crossView, padding)
    ) {
      align = otherAlign;
      cross = other;
    }
  }

  // --- Main axis position, from the (possibly flipped) side ---------------
  let main: number;
  if (side === "top") main = anchor.y - box.height - offset;
  else if (side === "bottom") main = anchor.y + anchor.height + offset;
  else if (side === "left") main = anchor.x - box.width - offset;
  else main = anchor.x + anchor.width + offset;

  // --- 3. Shift back inside the viewport ----------------------------------
  const mainBox = vertical ? box.height : box.width;
  const mainView = vertical ? view.height : view.width;
  main = clamp(main, mainBox, mainView, padding);
  cross = clamp(cross, crossBox, crossView, padding);

  const x = vertical ? cross : main;
  const y = vertical ? main : cross;
  const placement: Placement =
    preferred.align === "center" ? side : `${side}-${align as "start" | "end"}`;

  return { x: Math.round(x), y: Math.round(y), placement };
}
