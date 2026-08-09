/**
 * tabVM.ts — pure view-model for the sheet's "Isekai" tab.
 *
 * Answers, from the raw actor document alone: which archetypes the character
 * carries, how much Focus is spendable right now (and how much is locked away
 * by ★ choices), what they can spend it ON at their level, and what state each
 * tracker widget is holding.
 *
 * No Svelte, no browser APIs, no socket — the component renders this and sends
 * the ops `planVM.setIsekaiTracker` builds.
 */

import type { RollResultData } from "@fusion/shared";
import type { IsekaiArchetype, IsekaiTrackerDef } from "./types.js";
import {
  ISEKAI_FOCUS_FLOOR,
  isekaiActionsUpToLevel,
  resolveIsekaiArchetypes,
  type IsekaiActionRow,
} from "./index.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

export interface IsekaiFocusModel {
  /** Points available to spend right now. */
  value: number;
  /** The pool's real size — what the pips render, locks included. */
  max: number;
  /** Points held hostage by ★ Named companions / ★ taught Signatures. */
  locked: number;
  /** `max - locked` — the highest `value` can go. */
  spendable: number;
}

/**
 * Read the Focus pool as the tab shows it.
 *
 * `locked` comes from `system.derived.isekaiFocusLocked`, which the server's
 * `stepCharIsekaiFocus` publishes. It is NOT recomputed here from the trackers:
 * the server is the authority on the pool, and a client that recounted would
 * flicker to its own answer for one frame every time a ★ is toggled, before
 * the broadcast lands. Absent (an older document, or the variant just turned
 * on) reads as zero locks — never as an error.
 */
export function isekaiFocusModel(doc: Record<string, unknown>): IsekaiFocusModel {
  const sys = asRecord(doc["system"]);
  const focus = asRecord(asRecord(sys["resources"])["focusPoints"]);
  const max = Math.min(ISEKAI_FOCUS_FLOOR, asNumber(focus["max"]));
  const locked = Math.max(
    0,
    Math.min(max, asNumber(asRecord(sys["derived"])["isekaiFocusLocked"])),
  );
  const spendable = Math.max(0, max - locked);
  return {
    value: Math.max(0, Math.min(asNumber(focus["value"]), spendable)),
    max,
    locked,
    spendable,
  };
}

// ---------------------------------------------------------------------------
// Trackers
// ---------------------------------------------------------------------------

export interface IsekaiTrackerModel {
  archetype: IsekaiArchetype;
  def: IsekaiTrackerDef;
  /** Whatever the document holds for this tracker — narrowed by the widget. */
  state: unknown;
}

/**
 * One entry per tracker the character's archetypes bring, in archetype order.
 *
 * The Queridinho contributes none, so a Queridinho/Fodão character gets a
 * single widget rather than an empty box with a title.
 */
export function isekaiTrackerModels(
  doc: Record<string, unknown>,
  archetypeIds: readonly string[],
): IsekaiTrackerModel[] {
  const sys = asRecord(doc["system"]);
  const trackers = asRecord(asRecord(sys["isekai"])["trackers"]);
  const models: IsekaiTrackerModel[] = [];
  for (const archetype of resolveIsekaiArchetypes(archetypeIds)) {
    const def = archetype.tracker;
    if (!def) continue;
    models.push({ archetype, def, state: asRecord(trackers[archetype.id])[def.id] });
  }
  return models;
}

// ---------------------------------------------------------------------------
// The whole tab
// ---------------------------------------------------------------------------

export interface IsekaiTabModel {
  /** Resolved archetypes, in pick order, minus any id the content dropped. */
  archetypes: IsekaiArchetype[];
  /** Ids as the document holds them — including ones we could not resolve. */
  archetypeIds: string[];
  level: number;
  focus: IsekaiFocusModel;
  actions: IsekaiActionRow[];
  trackers: IsekaiTrackerModel[];
}

/**
 * Build everything the Isekai tab renders.
 *
 * `archetypeIds` is passed in rather than re-read here so the caller keeps one
 * reader (`planVM.getIsekaiArchetypes`) for the whole sheet — two readers of
 * the same field is how they drift.
 */
export function buildIsekaiTabModel(
  doc: Record<string, unknown>,
  archetypeIds: readonly string[],
): IsekaiTabModel {
  const sys = asRecord(doc["system"]);
  const level = Math.max(1, asNumber(asRecord(sys["level"])["value"], 1));
  return {
    archetypes: resolveIsekaiArchetypes(archetypeIds),
    archetypeIds: [...archetypeIds],
    level,
    focus: isekaiFocusModel(doc),
    actions: isekaiActionsUpToLevel(archetypeIds, level),
    trackers: isekaiTrackerModels(doc, archetypeIds),
  };
}

// ---------------------------------------------------------------------------
// Reading dice off a server roll
// ---------------------------------------------------------------------------

/**
 * Extract the individual d20 faces from a roll the SERVER resolved.
 *
 * The Sortudo's Dados do Destino are real d20s that get banked and spent
 * later, so they cannot be rolled in the browser — every roll in Fusion
 * happens server-side (anti-cheat). The widget sends `/r Nd20`, waits for the
 * ack, and reads the faces back through here.
 *
 * Discarded dice (a `kh`/`kl` modifier would mark them) are skipped: a die the
 * formula threw away is not a die the character banked. Non-d20 terms are
 * ignored, so a formula that grows a modifier later does not start banking the
 * modifier as a die.
 */
export function d20ResultsFrom(roll: RollResultData | undefined): number[] {
  if (!roll) return [];
  const faces: number[] = [];
  for (const term of roll.terms) {
    if (term.type !== "dice" || term.faces !== 20 || !term.results) continue;
    for (const die of term.results) {
      if (die.discarded === true) continue;
      faces.push(die.result);
    }
  }
  return faces;
}
