/**
 * rollBuilder.ts — composing WHAT gets rolled, and nothing about who sees it.
 *
 * Spec 38 (`specs/38-aba-chat.md`), DEC-ACH-06 and REQ-ACH-060..062: the roll builder puts
 * together quantity, faces, modifier, label, advantage/disadvantage, exploding and keep
 * highest, and shows the resulting formula before rolling. It has **no** roll mode: two
 * places deciding the audience is where every leak starts, so the window only reports what
 * the selector says (REQ-ACH-061) and this module never touches a `RollMode`.
 *
 * Notation note (divergence recorded, not invented here)
 * ------------------------------------------------------
 * REQ-ROL-006 writes exploding as `x`, but the roller actually shipped
 * (`@dice-roller/rpg-dice-roller`, the same parser `validateFormula` uses and the server
 * executes) accepts `!` and rejects `x`. Composing `3d6x` would produce a favourite the
 * engine refuses, so the builder emits `3d6!`. Registered as an open question for spec 08.
 *
 * Pure: same spec in, same string out — no storage, no socket, no DOM.
 */

import { normalizeFavorite } from "./favoriteDice.js";

import type { FavoriteDie } from "./favoriteDice.js";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** Advantage state of the build — one extra die, kept high or low. */
export type RollEdge = "none" | "advantage" | "disadvantage";

/** Everything the builder window can compose (REQ-ACH-060). */
export interface RollBuilderSpec {
  /** How many dice (REQ-ROL-001). */
  readonly count: number;
  /** How many faces (REQ-ROL-001). */
  readonly faces: number;
  /** Flat modifier; `0` is omitted from the formula. */
  readonly modifier: number;
  /** Roll note (REQ-ROL-013); blank means no note. */
  readonly label: string;
  /** Advantage / disadvantage — an extra die kept high or low. */
  readonly edge: RollEdge;
  /** Exploding dice (REQ-ROL-006). */
  readonly explode: boolean;
  /** Keep the highest N (REQ-ROL-004); `null` keeps them all. Ignored when `edge` is set. */
  readonly keepHighest: number | null;
}

/** Sensible starting point: the roll everybody makes first. */
export const DEFAULT_ROLL_BUILDER_SPEC: RollBuilderSpec = Object.freeze({
  count: 1,
  faces: 20,
  modifier: 0,
  label: "",
  edge: "none",
  explode: false,
  keepHighest: null,
});

/** Bounds that keep a composed formula inside what the engine parses and the server allows. */
export const MIN_DICE_COUNT = 1;
export const MAX_DICE_COUNT = 100;
export const MIN_DIE_FACES = 2;
export const MAX_DIE_FACES = 1000;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Coerce a spec into something composable: whole dice, real faces, and a keep that can
 * never exceed the pool it keeps from.
 *
 * The window binds `<input type="number">`s, which hand over empty strings, `NaN` and
 * whatever the user typed — clamping here means the preview is always a formula, never an
 * error state the user has to decode.
 */
export function normalizeSpec(spec: RollBuilderSpec): RollBuilderSpec {
  const count = clampInt(spec.count, MIN_DICE_COUNT, MAX_DICE_COUNT);
  const faces = clampInt(spec.faces, MIN_DIE_FACES, MAX_DIE_FACES);
  const modifier = Number.isFinite(spec.modifier) ? Math.trunc(spec.modifier) : 0;
  const keepHighest = spec.keepHighest === null ? null : clampInt(spec.keepHighest, 1, count);

  return {
    count,
    faces,
    modifier,
    label: spec.label.trim(),
    edge: spec.edge,
    explode: spec.explode,
    keepHighest,
  };
}

// ---------------------------------------------------------------------------
// Composition — REQ-ACH-060
// ---------------------------------------------------------------------------

/**
 * The formula this build produces, shown in the window before rolling (REQ-ACH-060).
 *
 * Order is the engine's: dice term, exploding, keep/drop, then the flat modifier, then the
 * note. Advantage owns the keep — a build cannot ask for advantage AND a contradictory
 * keep, because the second would silently win.
 */
export function buildRollFormula(input: RollBuilderSpec): string {
  const spec = normalizeSpec(input);

  const pool = spec.edge === "none" ? spec.count : spec.count + 1;
  let formula = `${String(pool)}d${String(spec.faces)}`;

  if (spec.explode) formula += "!";

  if (spec.edge === "advantage") {
    formula += `kh${String(spec.count)}`;
  } else if (spec.edge === "disadvantage") {
    formula += `kl${String(spec.count)}`;
  } else if (spec.keepHighest !== null && !(spec.count === 1 && spec.keepHighest === 1)) {
    // "keep 1 of 1" is not a choice, it is the only outcome — emitting it would add noise
    // to the preview without changing a single result.
    formula += `kh${String(spec.keepHighest)}`;
  }

  if (spec.modifier > 0) formula += `+${String(spec.modifier)}`;
  else if (spec.modifier < 0) formula += `-${String(Math.abs(spec.modifier))}`;

  if (spec.label.length > 0) formula += ` # ${spec.label}`;

  return formula;
}

// ---------------------------------------------------------------------------
// Save as favourite — REQ-ACH-062
// ---------------------------------------------------------------------------

/**
 * Turn the current build into a favourite (REQ-ACH-062).
 *
 * Always `mode: null` — "follows the selector". The window has no audience of its own to
 * bake in (DEC-ACH-06); locking a mode is a deliberate act in the favourites editor.
 */
export function favoriteFromSpec(spec: RollBuilderSpec): FavoriteDie {
  const formula = buildRollFormula(spec);
  return normalizeFavorite({ label: spec.label.trim(), formula, mode: null });
}
