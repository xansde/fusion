/**
 * dragRuler.ts — the movement ruler shown while a token is dragged.
 *
 * Pure (no PIXI, no DOM). The colour answers one question: how many actions of
 * Stride does this path cost? Green is one action (up to the actor's Speed),
 * yellow is two actions, red is beyond that — the Drag Ruler convention.
 */

import type { GridStrategy } from "@fusion/shared";

export type MoveTier = "walk" | "double" | "far";

/** Speed assumed when the actor declares none (PF2e base land speed). */
export const DEFAULT_SPEED_FT = 25;

/** Packed 0xRRGGBB colours of each tier. */
export const TIER_COLORS: Readonly<Record<MoveTier, number>> = {
  walk: 0x44dd77,
  double: 0xffcc33,
  far: 0xff5555,
};

function asFeet(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function rec(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
}

/**
 * The actor's land Speed in feet, read from what the server derived
 * (`system.derived.speed.value`), then the authored value (`system.speed.value`,
 * a character) and `system.attributes.speed.value` (an NPC). Falls back to 25.
 */
export function actorSpeedFt(system: unknown): number {
  const sys = rec(system);
  if (!sys) return DEFAULT_SPEED_FT;
  const candidates: unknown[] = [
    rec(rec(sys["derived"])?.["speed"])?.["value"],
    rec(sys["speed"])?.["value"],
    rec(rec(sys["attributes"])?.["speed"])?.["value"],
    sys["speed"],
  ];
  for (const c of candidates) {
    const n = asFeet(c);
    if (n !== undefined) return n;
  }
  return DEFAULT_SPEED_FT;
}

/** Which tier a path of `distanceFt` falls in for an actor with `speedFt`. */
export function moveTier(distanceFt: number, speedFt: number): MoveTier {
  if (distanceFt <= speedFt) return "walk";
  if (distanceFt <= speedFt * 2) return "double";
  return "far";
}

/** Everything the layer needs to draw one drag. */
export interface DragRulerView {
  /** Path in scene pixels: start, committed waypoints, current position. */
  readonly path: ReadonlyArray<{ x: number; y: number }>;
  readonly distanceFt: number;
  readonly speedFt: number;
  readonly tier: MoveTier;
  readonly color: number;
}

/**
 * Measure a drag. `path` points are the token reference point (the centre of its
 * top-left square) at the start, at each committed waypoint and now.
 */
export function buildDragRuler(
  grid: GridStrategy,
  path: ReadonlyArray<{ x: number; y: number }>,
  speedFt: number,
): DragRulerView {
  const distanceFt = path.length >= 2 ? grid.measureDistance([...path]) : 0;
  const tier = moveTier(distanceFt, speedFt);
  return { path, distanceFt, speedFt, tier, color: TIER_COLORS[tier] };
}
