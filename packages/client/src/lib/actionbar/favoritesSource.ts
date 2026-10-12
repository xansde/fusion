/**
 * favoritesSource.ts — the contract of the twelve favourite slots, and the row arithmetic every
 * source of them shares (BAR-F1-04 interface, BAR-F3-01 body; spec 53 REQ-BAR-061..066,
 * DEC-BAR-06/07/08; tasks.md §2.5, §2.8).
 *
 * `FavoritesSource` is what the bar knows: twelve positions, in the order of the keys. Its one real
 * implementation is `favoritesStore.svelte.ts`, which keeps the row in the ACTOR
 * (`flags.fusion.actionBar.favorites`), so it follows the character to any device and the Mestre
 * sees it (DEC-BAR-06). The in-memory source this file used to hold — BAR-F1-04's scaffolding, which
 * persisted nothing — is gone.
 *
 * What stays here is the part with no state and no effect, so it is tested on plain values:
 *
 *  - reading the row off an actor document, tolerantly (`storedRowOf`);
 *  - deciding whether the first-opening seed is still due (`needsSeed`, REQ-BAR-064);
 *  - the three edits, each returning a NEW row: `pinInto`, `unpinFrom`, `moveWithin`;
 *  - the shell's own seed, for a system whose provider gives none (`seedFromEntries`, Q-BAR-02).
 *
 * A row is `(string | null)[]` of exactly twelve: the id of an `ActionBarEntry` or `null` for an
 * empty position. Positions never shift on their own — unpinning leaves a hole — because the position
 * IS the key (1–9, 0, − and =).
 */

import { ACTION_BAR_SLOT_COUNT, ActionBarEntryIdSchema, readActionBarFlags } from "@fusion/shared";

import type {
  ActionBarContext,
  ActionBarEntry,
  ActionBarEntryKind,
  ActionBarProvider,
} from "./types.js";

/** The row has twelve positions, the keys 1–9, 0, − and = (DEC-BAR-07). */
export const FAVORITE_SLOT_COUNT = ACTION_BAR_SLOT_COUNT;

export interface FavoritesSource {
  /** Twelve positions, in the order of the keys; ids of `ActionBarEntry`, `null` for empty. Reactive. */
  slots(): ReadonlyArray<string | null>;
  isPinned(entryId: string): boolean;
  /** Pins into the first empty slot; `false` when the row is full (12/12). Pinning twice is a no-op. */
  pin(entryId: string): boolean;
  /** Empties the slot of the entry; the others stay where they are. */
  unpin(entryId: string): void;
  /** Moves the slot `from` to `to`; dropping on an occupied slot swaps the two. */
  move(from: number, to: number): void;
}

export type FavoriteRow = ReadonlyArray<string | null>;

// ---------------------------------------------------------------------------
// Reading the row
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is an id the server's schema would take (`<kind>:<origin>`, §2.2). */
function isEntryId(value: unknown): value is string {
  return typeof value === "string" && ActionBarEntryIdSchema.safeParse(value).success;
}

/** Twelve empty positions. A fresh array on every call. */
export function emptyRow(): (string | null)[] {
  return new Array<string | null>(FAVORITE_SLOT_COUNT).fill(null);
}

/**
 * Ids in slot order, padded to twelve. What the server would refuse (a malformed id) and a repeated
 * id are dropped, so one bad value cannot fail the whole write; anything past twelve is cut.
 */
export function rowFromIds(ids: readonly string[]): (string | null)[] {
  const row = emptyRow();
  const seen = new Set<string>();
  let next = 0;
  for (const id of ids) {
    if (next >= FAVORITE_SLOT_COUNT) break;
    if (!isEntryId(id) || seen.has(id)) continue;
    seen.add(id);
    row[next] = id;
    next += 1;
  }
  return row;
}

/**
 * The row an actor document keeps, or `null` when it keeps none (no bar, no `favorites`, or
 * something that is not a list). It reads what is there, not what the schema would accept: a row
 * that predates the schema is padded or cut to twelve, and a value that is not a valid id is an
 * empty position — a stored string never reaches a button unchecked.
 */
export function storedRowOf(doc: unknown): (string | null)[] | null {
  const bar = readActionBarFlags(doc);
  if (!isPlainObject(bar)) return null;
  const favorites = bar["favorites"];
  if (!Array.isArray(favorites)) return null;
  const row = emptyRow();
  for (let index = 0; index < FAVORITE_SLOT_COUNT; index += 1) {
    const value: unknown = favorites[index];
    row[index] = isEntryId(value) ? value : null;
  }
  return row;
}

/** Whether the first-opening seed was already applied: only a literal `true` counts (REQ-BAR-064). */
export function isSeeded(doc: unknown): boolean {
  const bar = readActionBarFlags(doc);
  return isPlainObject(bar) && bar["seeded"] === true;
}

/**
 * Whether the seed is still due. It is not once it was applied — even when the player has since
 * emptied the row, nothing enters by itself (REQ-BAR-065, D-BA08) — and it is not over a row that
 * already has an entry, whatever the flag says: that row is somebody's.
 */
export function needsSeed(doc: unknown): boolean {
  if (isSeeded(doc)) return false;
  const stored = storedRowOf(doc);
  return stored === null || stored.every((id) => id === null);
}

export function sameRow(a: FavoriteRow, b: FavoriteRow): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// ---------------------------------------------------------------------------
// The three edits — pure: each returns a new row and never touches the one it was given
// ---------------------------------------------------------------------------

export type PinOutcome = "pinned" | "already" | "full";

/** Pins into the first empty slot. A hole left by an unpin is filled before anything is appended. */
export function pinInto(
  row: FavoriteRow,
  entryId: string,
): { row: (string | null)[]; outcome: PinOutcome } {
  const next = [...row];
  if (next.includes(entryId)) return { row: next, outcome: "already" };
  const free = next.indexOf(null);
  if (free === -1) return { row: next, outcome: "full" };
  next[free] = entryId;
  return { row: next, outcome: "pinned" };
}

/** Empties every position of the entry; the others stay where they are. */
export function unpinFrom(row: FavoriteRow, entryId: string): (string | null)[] {
  return row.map((id) => (id === entryId ? null : id));
}

function isSlotIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < FAVORITE_SLOT_COUNT;
}

/** Moves the slot `from` to `to`; dropping on an occupied slot swaps the two. Nonsense does nothing. */
export function moveWithin(row: FavoriteRow, from: number, to: number): (string | null)[] {
  const next = [...row];
  if (!isSlotIndex(from) || !isSlotIndex(to) || from === to) return next;
  const moved = next[from] ?? null;
  next[from] = next[to] ?? null;
  next[to] = moved;
  return next;
}

// ---------------------------------------------------------------------------
// The shell's seed (Q-BAR-02)
// ---------------------------------------------------------------------------

/** How many of each kind the seed takes, and in what order of kinds: strikes, spells, actions. */
export const SEED_CAPS = { strike: 4, spell: 4, action: 4 } as const;

const SEED_KINDS: readonly (keyof typeof SEED_CAPS & ActionBarEntryKind)[] = [
  "strike",
  "spell",
  "action",
];

/**
 * The seed of a system whose provider declares none (`provider.seed`): the first four strikes, then
 * the first four spells and cantrips, then the first four actions, each in the order the provider
 * gave them. Items, checks and reactions never enter by themselves (DEC-BAR-08).
 *
 * It goes by `kind`, not by tab: a switch (`kind: "toggle"`) lives in the Actions tab, and in the
 * PF2e provider it comes BEFORE the actions, so "the first four of the tab" would be Panache and
 * friends. A pure function of the entries: no clock, no randomness, no history of use (there is none).
 * Ids the server's schema would refuse, and repeated ones, are skipped.
 */
export function seedFromEntries(entries: readonly ActionBarEntry[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const kind of SEED_KINDS) {
    let taken = 0;
    for (const entry of entries) {
      if (taken >= SEED_CAPS[kind]) break;
      if (entry.kind !== kind || !isEntryId(entry.id) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      ids.push(entry.id);
      taken += 1;
    }
  }
  return ids;
}

/**
 * The ids the first-opening seed would pin RIGHT NOW (REQ-BAR-064): the system's own when its
 * provider declares one, else the shell's (`seedFromEntries`).
 *
 * The provider's answer is taken as it is, EMPTY INCLUDED: `[]` is its word for "nothing to seed
 * (yet)" — the provider has not loaded — or "already seeded", and the shell must not fill that
 * silence with a pick of its own. Only a provider with no `seed`, or one that throws (the bar must
 * still open), gets the shell's.
 */
export function resolveSeedIds(
  provider: Pick<ActionBarProvider, "seed">,
  ctx: ActionBarContext,
  entries: readonly ActionBarEntry[],
  onError: (error: unknown) => void,
): readonly string[] {
  if (provider.seed === undefined) return seedFromEntries(entries);
  try {
    return provider.seed(ctx);
  } catch (error) {
    onError(error);
    return seedFromEntries(entries);
  }
}
