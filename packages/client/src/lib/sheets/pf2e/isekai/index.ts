/**
 * isekai/index.ts — the Isekai layer's content API for the PF2e sheet.
 *
 * 100% pure TypeScript: no Svelte, no browser APIs, and no import from
 * `@fusion/system-pf2e` (same arch boundary `planVM.ts` declares). The layer's
 * SERVER side — the Focus-lock arithmetic the derivation runs — lives in
 * `systems/pf2e/src/variants/isekai/focusLocks.ts`; the content the sheet
 * renders lives here. The two constants that must agree across that line
 * (`MAX_ISEKAI_ARCHETYPES`, the blessing ladder) are mirrored below with a
 * pointer, exactly like `characterSheetVM.ts` mirrors `SKILL_ABILITY`, and
 * `__tests__/isekai-data.test.ts` asserts the mirror still matches.
 *
 * Every lookup is total: an archetype id the sheet carries but the data no
 * longer knows resolves to nothing rather than throwing. A document can
 * outlive a content edit, and a sheet that refuses to open is worse than a
 * sheet missing a chip.
 */

import type { IsekaiAction, IsekaiArchetype, IsekaiBlessing } from "./types.js";
import { ISEKAI_ARCHETYPES } from "./archetypes.js";

export * from "./types.js";
export { ISEKAI_ARCHETYPES } from "./archetypes.js";

// ---------------------------------------------------------------------------
// Mirrored parameters
// Source of truth: systems/pf2e/src/variants/isekai/params.ts
// ---------------------------------------------------------------------------

/** How many archetypes a character may carry. Mirrors the variant's param. */
export const MAX_ISEKAI_ARCHETYPES = 2;

/** Levels at which Minor Blessings unlock. Mirrors the variant's param. */
export const ISEKAI_BLESSING_LEVELS: readonly number[] = [1, 3, 4, 5, 6, 8, 12];

/**
 * Focus pool the layer guarantees. Mirrors the variant's param — used here only
 * to render "x/3" honestly while the server's derived value is in flight.
 */
export const ISEKAI_FOCUS_FLOOR = 3;

// ---------------------------------------------------------------------------
// Tracker state shapes (what lives on `system.isekai.trackers`)
// ---------------------------------------------------------------------------

/** One companion in the Carismático's roster. */
export interface IsekaiCompanionState {
  id: string;
  name: string;
  tier: "active" | "retinue" | "base";
  /** ★ Dar um Nome — locks 1 point of the Focus maximum. */
  named: boolean;
}

/** One entry in the Especialista's Signature list. */
export interface IsekaiSignatureState {
  id: string;
  name: string;
  /** ★ taught to an ally — locks 1 point of the Focus maximum. */
  flag: boolean;
}

/** One entry in the Evolutivo's catalogue. */
export interface IsekaiCatalogEntryState {
  id: string;
  name: string;
  type: "passive" | "active";
  prepared: boolean;
}

/** The Evolutivo's catalogue, with its per-day prepared limit. */
export interface IsekaiCatalogState {
  entries: IsekaiCatalogEntryState[];
  /** Prepared limit for the day — Constitution + level, edited on the sheet. */
  limit: number;
}

/** The Crafter's essence stock: level (as a string key) → how many held. */
export type IsekaiStockState = Record<string, number>;

/** Persisted tracker state: archetype id → tracker id → that tracker's state. */
export type IsekaiTrackerState = Record<string, Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const BY_ID = new Map<string, IsekaiArchetype>(ISEKAI_ARCHETYPES.map((a) => [a.id, a]));

/** Resolve an archetype by id; `undefined` when the id is unknown. */
export function getIsekaiArchetype(id: string): IsekaiArchetype | undefined {
  return BY_ID.get(id);
}

/** Resolve a list of ids to archetypes, dropping the ones we don't know. */
export function resolveIsekaiArchetypes(ids: readonly string[]): IsekaiArchetype[] {
  return ids.map((id) => BY_ID.get(id)).filter((a): a is IsekaiArchetype => a !== undefined);
}

// ---------------------------------------------------------------------------
// Blessings and actions
// ---------------------------------------------------------------------------

/** An archetype's blessing, carrying its source for colour and attribution. */
export interface IsekaiBlessingRow {
  archetype: IsekaiArchetype;
  blessing: IsekaiBlessing;
}

/**
 * Minor Blessings that unlock EXACTLY at `level`, across the picked
 * archetypes, in archetype order then declaration order.
 *
 * "Exactly at" is the point: the Plan column renders one card per level, and a
 * blessing belongs on the card of the level that grants it. The character
 * receives the blessings of BOTH archetypes — this layer has no slot budget,
 * so nothing here competes for a pick.
 */
export function isekaiBlessingsAtLevel(
  archetypeIds: readonly string[],
  level: number,
): IsekaiBlessingRow[] {
  const rows: IsekaiBlessingRow[] = [];
  for (const archetype of resolveIsekaiArchetypes(archetypeIds)) {
    for (const blessing of archetype.minorBlessings) {
      if (blessing.level === level) rows.push({ archetype, blessing });
    }
  }
  return rows;
}

/** An archetype's action, carrying its source. */
export interface IsekaiActionRow {
  archetype: IsekaiArchetype;
  action: IsekaiAction;
}

/**
 * Everything spendable the character has access to at `level`, sorted by
 * unlock level then name — the order the Isekai tab lists them in.
 *
 * Sorted by LEVEL rather than by Focus cost on purpose: the player scans this
 * list to find an ability, and "the one I just unlocked" is what they look for
 * most often.
 */
export function isekaiActionsUpToLevel(
  archetypeIds: readonly string[],
  level: number,
): IsekaiActionRow[] {
  const rows: IsekaiActionRow[] = [];
  for (const archetype of resolveIsekaiArchetypes(archetypeIds)) {
    for (const action of archetype.actions) {
      if (action.level <= level) rows.push({ archetype, action });
    }
  }
  return rows.sort(
    (a, b) =>
      a.action.level - b.action.level || a.action.name.localeCompare(b.action.name, "pt-BR"),
  );
}

// ---------------------------------------------------------------------------
// Tracker helpers — level-dependent numbers the widgets need
// ---------------------------------------------------------------------------

/**
 * How many Dados do Destino the Sortudo rolls at the start of a day, and which
 * fixed values come with them (A Casa Sempre Vence, level 12: a 20 and a 1).
 */
export function isekaiDestinyDicePlan(
  archetype: IsekaiArchetype,
  level: number,
): { count: number; fixed: readonly number[] } {
  const tracker = archetype.tracker;
  if (tracker?.kind !== "dice-pool") return { count: 0, fixed: [] };
  const bonus = tracker.levelBonus && level >= tracker.levelBonus.level ? tracker.levelBonus.extra : 0;
  const fixed = tracker.fixedFrom && level >= tracker.fixedFrom.level ? tracker.fixedFrom.values : [];
  return { count: tracker.perDay + bonus, fixed };
}

/**
 * The Especialista's Signature cap at `level` — the highest entry of the
 * staircase at or below it. `null` when the archetype has no cap staircase.
 */
export function isekaiListCapAtLevel(archetype: IsekaiArchetype, level: number): number | null {
  const tracker = archetype.tracker;
  if (tracker?.kind !== "list") return null;
  let cap = 0;
  for (const step of tracker.capByLevel) {
    if (level >= step.level) cap = step.cap;
  }
  return cap;
}

/** Limited uses available at `level` — the Fodão's list grows as he does. */
export function isekaiUsesAtLevel(
  archetype: IsekaiArchetype,
  level: number,
): readonly { id: string; name: string; scope: string; level: number }[] {
  const tracker = archetype.tracker;
  if (tracker?.kind !== "uses") return [];
  return tracker.uses.filter((use) => level >= use.level);
}
