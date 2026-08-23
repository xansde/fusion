/**
 * token-visuals.ts — Pure, PIXI-free token visual logic.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-025..033, §D7, §D8, §D11
 *
 * Everything here is deterministic and testable under Vitest (node env, no DOM).
 * The PIXI shell (TokenSprite.ts) consumes these helpers.
 *
 * Responsibilities:
 *   - Pixel-size and position from footprint × gridSize.
 *   - Placeholder color from token name initials (no texture / 404 fallback).
 *   - Disposition → ring color.
 *   - LOD decision: nameplate/bar visibility at current zoom.
 *   - Animation interpolation: lerp position over time (for remote updates).
 */

import type { TokenDocument } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Disposition color map (REQ-CNV-027)
// ---------------------------------------------------------------------------

/** Disposition values as used by TokenDocument (spec 02). */
export type DispositionValue = -1 | 0 | 1;

/** PIXI-friendly number colors keyed by disposition. */
export const DISPOSITION_COLORS: Record<DispositionValue, number> = {
  "-1": 0xe52222, // hostile  — red
  "0": 0xf0f060, // neutral  — yellow
  "1": 0x33bc4e, // friendly — green
};

/** Secret / no-actor disposition ring color. */
export const SECRET_RING_COLOR = 0x555555;

/**
 * Return the ring border color for a token.
 * When `showRing` is false, callers should skip rendering the ring entirely.
 *
 * Disposition -1 = hostile, 0 = neutral, 1 = friendly.
 * Any other value → secret gray.
 */
export function dispositionColor(disposition: number): number {
  if (disposition === -1) return DISPOSITION_COLORS[-1];
  if (disposition === 0) return DISPOSITION_COLORS[0];
  if (disposition === 1) return DISPOSITION_COLORS[1];
  return SECRET_RING_COLOR;
}

// ---------------------------------------------------------------------------
// Placeholder color (REQ-CNV-025 — no texture / 404 fallback)
// ---------------------------------------------------------------------------

/** Palette used for placeholder tokens. */
const PLACEHOLDER_PALETTE: number[] = [
  0x4a90d9, 0xe67e22, 0x9b59b6, 0x1abc9c, 0xe74c3c, 0x2ecc71, 0xf39c12, 0x3498db,
];

/**
 * Derive a stable placeholder background color from the token name.
 * Uses a simple hash over the first two initials of the name.
 */
export function placeholderColor(name: string): number {
  const chars = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? "");
  const initials = chars.slice(0, 2).join("").toUpperCase() || "?";
  let hash = 0;
  for (let i = 0; i < initials.length; i++) {
    hash = (hash * 31 + (initials.codePointAt(i) ?? 0)) >>> 0;
  }
  return PLACEHOLDER_PALETTE[hash % PLACEHOLDER_PALETTE.length] as number;
}

/**
 * Extract up to two initials from a token name for display in the placeholder.
 * Falls back to "?" when name is empty.
 */
export function placeholderInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

// ---------------------------------------------------------------------------
// Pixel size / position (REQ-CNV-025, REQ-CNV-026)
// ---------------------------------------------------------------------------

/**
 * Compute the pixel size of a token (width × height) given its footprint in
 * cells and the scene's grid size in pixels.
 *
 * footW × gridSize  = pixel width of the bounding box
 * footH × gridSize  = pixel height of the bounding box
 *
 * This is the bounding box used for positioning; the art scale (`scaleMultiplier`)
 * is applied on top and is independent of the footprint.
 */
export function tokenPixelSize(
  footW: number,
  footH: number,
  gridSize: number,
): { pixelW: number; pixelH: number } {
  return {
    pixelW: footW * gridSize,
    pixelH: footH * gridSize,
  };
}

/**
 * Compute the center position (in scene pixels) of a token given its top-left
 * corner (x, y from TokenDocument) and its footprint pixel size.
 */
export function tokenCenter(
  tokenX: number,
  tokenY: number,
  pixelW: number,
  pixelH: number,
): { cx: number; cy: number } {
  return { cx: tokenX + pixelW / 2, cy: tokenY + pixelH / 2 };
}

// ---------------------------------------------------------------------------
// LOD (Level of Detail) (REQ-CNV-078, D11)
// ---------------------------------------------------------------------------

/** Zoom thresholds for progressive LOD. */
export const LOD_THRESHOLDS = {
  /** Below this zoom, nameplates are hidden. */
  NAMEPLATE_MIN: 0.4,
  /** Below this zoom, resource bars are simplified (thin line). */
  BAR_MIN: 0.3,
  /** Below this zoom, bar values are hidden entirely. */
  BAR_DETAIL_MIN: 0.5,
} as const;

/** LOD state at a given zoom level. */
export interface LodState {
  showNameplate: boolean;
  showBars: boolean;
  showBarDetail: boolean;
}

/**
 * Compute the LOD state for a given camera zoom scale.
 * Zoom 1.0 = 100%; 0.1 = zoomed far out; 3.0 = zoomed far in.
 */
export function computeLod(zoom: number): LodState {
  return {
    showNameplate: zoom >= LOD_THRESHOLDS.NAMEPLATE_MIN,
    showBars: zoom >= LOD_THRESHOLDS.BAR_MIN,
    showBarDetail: zoom >= LOD_THRESHOLDS.BAR_DETAIL_MIN,
  };
}

// ---------------------------------------------------------------------------
// Animation interpolation (REQ-CNV-037, D5)
// ---------------------------------------------------------------------------

/** Maximum animation duration in milliseconds for token movement. */
export const MAX_ANIM_DURATION_MS = 300;

/** Pixels-per-millisecond speed: used to scale duration by distance. */
export const ANIM_SPEED_PX_PER_MS = 6; // ~6 px/ms → 100px takes ~17ms, 600px takes ~100ms

/**
 * Compute how long a token movement animation should last.
 *
 * Duration is proportional to distance, capped at MAX_ANIM_DURATION_MS.
 * Very short moves (< 1px) snap instantly (duration 0).
 */
export function animDuration(fromX: number, fromY: number, toX: number, toY: number): number {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return 0;
  return Math.min(dist / ANIM_SPEED_PX_PER_MS, MAX_ANIM_DURATION_MS);
}

/**
 * Cubic ease-in-out (t ∈ [0, 1]).
 * Matches the camera easing used in camera-math.ts.
 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Linearly interpolate between two positions.
 * `t` should be the eased progress (0–1).
 */
export function lerpPosition(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  t: number,
): { x: number; y: number } {
  return {
    x: fromX + (toX - fromX) * t,
    y: fromY + (toY - fromY) * t,
  };
}

// ---------------------------------------------------------------------------
// Resource bar layout (REQ-CNV-028, D8)
// ---------------------------------------------------------------------------

/** Bar layout constants (relative to token pixel size). */
export const BAR_HEIGHT_PX = 6;
export const BAR_GAP_PX = 2;
export const BAR_ALPHA = 0.9;

/** Colors for resource bar backgrounds (depleted/filled). */
export const BAR_BG_COLOR = 0x000000;
export const BAR_FILL_COLORS = {
  bar1: 0x22d922, // HP — green
  bar2: 0x2288ff, // secondary — blue
} as const;

/** Fraction of bar fill (0–1), clamped to [0, 1]. */
export function barFraction(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/** The `{ value, max }` shape a resource bar reads off the effective actor's `system`. */
export interface BarAttributeValue {
  readonly value: number;
  readonly max: number;
}

/**
 * Resolve a dot-path bar attribute (e.g. `"attributes.hp"`) against the
 * effective actor's `system` object, reading it as `{ value, max }`
 * (REQ-CNV-090).
 *
 * Returns `undefined` when `system` is missing, `path` is null/empty, the
 * path does not resolve to an object, or that object lacks numeric
 * `value`/`max` — every one of these is the "caminho não resolve" case
 * REQ-CNV-090 says must leave the bar **absent**, never drawn full as a
 * placeholder.
 */
export function resolveBarAttribute(
  system: Record<string, unknown> | undefined,
  path: string | null | undefined,
): BarAttributeValue | undefined {
  if (!system || !path) return undefined;
  let cur: unknown = system;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (cur == null || typeof cur !== "object") return undefined;
  const { value, max } = cur as Record<string, unknown>;
  if (typeof value !== "number" || typeof max !== "number") return undefined;
  return { value, max };
}

/** Structural equality for `BarAttributeValue | undefined` — used to detect a bar-worthy change. */
export function barAttributeEquals(
  a: BarAttributeValue | undefined,
  b: BarAttributeValue | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.value === b.value && a.max === b.max;
}

/**
 * Compute bar Y position relative to the bottom of the token bounding box.
 * bar1 is at the bottom, bar2 just above it.
 */
export function barYOffset(barIndex: 0 | 1, pixelH: number): number {
  // bar index 0 = bar1 (bottom), bar index 1 = bar2 (above bar1)
  return pixelH - (barIndex + 1) * (BAR_HEIGHT_PX + BAR_GAP_PX);
}

// ---------------------------------------------------------------------------
// Elevation badge (REQ-CNV-032)
// ---------------------------------------------------------------------------

/**
 * Format an elevation value for display (with unit from scene grid).
 * Returns null when elevation is 0 (badge should be hidden).
 */
export function formatElevation(elevation: number, units = "ft"): string | null {
  if (elevation === 0) return null;
  const sign = elevation > 0 ? "+" : "";
  return `${sign}${elevation.toString()}${units}`;
}

// ---------------------------------------------------------------------------
// Hidden / semi-transparent (REQ-CNV — hidden tokens)
// ---------------------------------------------------------------------------

/** Alpha for hidden tokens visible to GM (spec: semi-transparent). */
export const HIDDEN_ALPHA = 0.4;

/** Resolve the alpha to apply to the token sprite. */
export function tokenAlpha(hidden: boolean, isGm: boolean, baseAlpha: number): number {
  if (hidden) {
    if (isGm) return HIDDEN_ALPHA * baseAlpha;
    // Players never receive hidden tokens (server filters), but if somehow
    // rendered, treat as invisible.
    return 0;
  }
  return baseAlpha;
}

// ---------------------------------------------------------------------------
// Viewport culling (REQ-CNV-075)
// ---------------------------------------------------------------------------

/**
 * Return true if a token bounding box is at least partially visible in
 * the current viewport.
 *
 * All coordinates in scene pixels.
 */
export function isInViewport(
  tokenX: number,
  tokenY: number,
  pixelW: number,
  pixelH: number,
  vpLeft: number,
  vpTop: number,
  vpRight: number,
  vpBottom: number,
): boolean {
  return (
    tokenX < vpRight && tokenY < vpBottom && tokenX + pixelW > vpLeft && tokenY + pixelH > vpTop
  );
}

// ---------------------------------------------------------------------------
// Animation state (internal — used by TokenSprite)
// ---------------------------------------------------------------------------

/** State for an in-progress position animation. */
export interface AnimState {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  durationMs: number;
  elapsed: number;
}

/**
 * Advance an animation state by `deltaMs` milliseconds.
 * Returns the interpolated position and whether the animation is complete.
 */
export function stepAnimation(
  anim: AnimState,
  deltaMs: number,
): { x: number; y: number; done: boolean } {
  const elapsed = anim.elapsed + deltaMs;
  const t = anim.durationMs > 0 ? Math.min(1, elapsed / anim.durationMs) : 1;
  const eased = easeInOut(t);
  const pos = lerpPosition(anim.fromX, anim.fromY, anim.toX, anim.toY, eased);
  return { ...pos, done: t >= 1 };
}

// ---------------------------------------------------------------------------
// Type re-exports (convenience for consumers)
// ---------------------------------------------------------------------------

export type { TokenDocument };
