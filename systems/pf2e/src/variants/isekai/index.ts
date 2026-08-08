/**
 * @fusion/system-pf2e — Isekai variant: public API.
 *
 * Everything the derivation steps and the client VMs need to read the layer:
 * the archetype data, the per-archetype tracker STATE shapes, and the pure
 * helpers that answer "what unlocks here", "what can I spend" and "how much
 * of my Focus pool is locked away".
 *
 * All helpers are total: an id the sheet carries but the data no longer knows
 * resolves to nothing rather than throwing. A document can outlive a content
 * edit, and a sheet that refuses to open is worse than a sheet missing a chip.
 */

export * from "./types.js";
export * from "./params.js";
export { ISEKAI_ARCHETYPES } from "./archetypes.js";

import type { IsekaiAction, IsekaiArchetype, IsekaiBlessing } from "./types.js";
import { ISEKAI_ARCHETYPES } from "./archetypes.js";
import { ISEKAI_FOCUS_FLOOR } from "./params.js";

// ---------------------------------------------------------------------------
// Tracker state shapes (what lives on `system.isekai.trackers`)
// ---------------------------------------------------------------------------

/** One companion in the Carismático's roster. */
export interface IsekaiCompanionState {
  id: string;
  name: string;
  tier: "active" | "retinue" | "base";
  /** ★ Dar um Nome — locks 1 point of the Focus maximum while it fights. */
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

/**
 * Persisted state of every tracker, keyed by archetype id then tracker id.
 *
 * Deliberately loose (`unknown` leaf): the shapes above are what the client
 * writes, but the derivation reads documents written by older clients and by
 * hand, so every consumer narrows defensively instead of trusting the type.
 */
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
 * "Exactly at" is the whole point: the Plan column shows a level card per
 * level, and a blessing belongs on the card of the level that grants it. The
 * character receives the blessings of BOTH archetypes — there is no slot
 * budget in this layer.
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
 * unlock level then by name — the order the Isekai tab lists them in.
 *
 * Sorted by LEVEL rather than by Focus cost on purpose: the player reads this
 * list to find an ability, and "the new one I just unlocked" is the thing
 * they are looking for most often.
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
    (a, b) => a.action.level - b.action.level || a.action.name.localeCompare(b.action.name, "pt-BR"),
  );
}

// ---------------------------------------------------------------------------
// Locked Focus
// ---------------------------------------------------------------------------

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function truthyFlagCount(value: unknown, flag: string): number {
  let count = 0;
  for (const entry of asArray(value)) {
    if (entry !== null && typeof entry === "object" && (entry as Record<string, unknown>)[flag]) {
      count++;
    }
  }
  return count;
}

/**
 * How many points of the Focus MAXIMUM are locked away by the layer.
 *
 * Two archetypes buy power with permanent pool: the Carismático's ★ Named
 * companions and the Especialista's ★ taught Signatures each lock 1 point,
 * which neither spends nor recharges. The result is subtracted from `max` to
 * get what the character can actually hold.
 *
 * Capped at `ISEKAI_FOCUS_FLOOR` so a character who names six companions
 * still has a pool to spend rather than a permanently empty one — locking
 * MORE than the pool holds is not a meaningful state, and letting it go
 * negative would silently zero the pips with no explanation on screen.
 */
export function isekaiLockedFocus(
  archetypeIds: readonly string[],
  trackers: IsekaiTrackerState | undefined,
): number {
  if (!trackers) return 0;
  let locked = 0;
  for (const archetype of resolveIsekaiArchetypes(archetypeIds)) {
    const tracker = archetype.tracker;
    if (!tracker) continue;
    // Read through `unknown`: the declared type says "record of records", but
    // the value came off a document, where it can be anything at all.
    const state: unknown = trackers[archetype.id];
    if (state === null || typeof state !== "object") continue;
    const value = (state as Record<string, unknown>)[tracker.id];
    if (tracker.kind === "roster" && tracker.namedLocksFocus) {
      locked += truthyFlagCount(value, "named");
    } else if (tracker.kind === "list" && tracker.flagLocksFocus) {
      locked += truthyFlagCount(value, "flag");
    }
  }
  return Math.min(locked, ISEKAI_FOCUS_FLOOR);
}
