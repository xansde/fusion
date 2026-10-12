/**
 * favoritesSource.ts — where the twelve favourite slots come from (BAR-F1-04; spec 53 REQ-BAR-061..066,
 * DEC-BAR-06/07/08; tasks.md §2.8).
 *
 * The interface is final. The body below is SCAFFOLDING: until BAR-F3-01 keeps the favourites in
 * the actor (`flags.fusion.actionBar.favorites`, so they follow the character to any device and the
 * Mestre sees them), the default tab of the bar still has to be playable. So this source is in
 * memory — it persists nothing, a reload recalculates it — and seeds itself the way Q-BAR-02 asks
 * for the persisted one: strikes first, then spells and cantrips, then actions, up to four of each,
 * in the order the provider gave them. Nothing else ever enters by itself (DEC-BAR-08): items and
 * checks are pinned by the user or not at all.
 *
 * BAR-F3-01 replaces `createFavoritesSource` and nothing else: the bar only knows `FavoritesSource`.
 * The second parameter is a convenience of the scaffold (the persisted source reads the seed from
 * `provider.seed(ctx)` and has no use for it).
 *
 * Reactivity: the one piece of state lives in a `SvelteMap` (a runtime primitive, so this stays a
 * plain `.ts`), which makes `slots()` and `isPinned()` track like any `$state` read.
 */

import { SvelteMap } from "svelte/reactivity";
import type { ActionBarEntry, ActionBarTab } from "./types.js";

/** The row has twelve positions, the keys 1–9, 0, − and = (DEC-BAR-07). */
export const FAVORITE_SLOT_COUNT = 12;

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

/** Tabs the seed draws from, in order, and how many of each (Q-BAR-02). */
const SEED_ORDER: readonly ActionBarTab[] = ["strikes", "spells", "actions"];
const SEED_PER_TAB = 4;

function seedFrom(entries: readonly ActionBarEntry[]): (string | null)[] {
  const ids: string[] = [];
  for (const tab of SEED_ORDER) {
    ids.push(
      ...entries
        .filter((entry) => entry.tab === tab)
        .slice(0, SEED_PER_TAB)
        .map((entry) => entry.id),
    );
  }
  const row: (string | null)[] = new Array<string | null>(FAVORITE_SLOT_COUNT).fill(null);
  ids.slice(0, FAVORITE_SLOT_COUNT).forEach((id, index) => {
    row[index] = id;
  });
  return row;
}

function isSlotIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < FAVORITE_SLOT_COUNT;
}

/**
 * SCAFFOLDING (BAR-F1-04, replaced by BAR-F3-01): an in-memory source for one actor.
 *
 * @param actorId  The actor the row belongs to (the persisted source reads its flags by it).
 * @param entries  The provider's entries right now, read on every call: the sheet may load after
 *                 the bar, and the seed follows it until the user changes the row.
 */
export function createFavoritesSource(
  actorId: string,
  entries: () => readonly ActionBarEntry[] = () => [],
): FavoritesSource {
  void actorId;
  // `undefined` = the user has not touched the row yet: it is still the live seed.
  const state = new SvelteMap<"row", readonly (string | null)[]>();

  const current = (): readonly (string | null)[] => state.get("row") ?? seedFrom(entries());
  const write = (row: readonly (string | null)[]): void => {
    state.set("row", row);
  };

  return {
    slots: () => [...current()],
    isPinned: (entryId) => current().includes(entryId),
    pin(entryId) {
      const row = [...current()];
      if (row.includes(entryId)) return true;
      const free = row.indexOf(null);
      if (free === -1) return false;
      row[free] = entryId;
      write(row);
      return true;
    },
    unpin(entryId) {
      const row = [...current()];
      const index = row.indexOf(entryId);
      if (index === -1) return;
      row[index] = null;
      write(row);
    },
    move(from, to) {
      if (!isSlotIndex(from) || !isSlotIndex(to) || from === to) return;
      const row = [...current()];
      const moved = row[from] ?? null;
      row[from] = row[to] ?? null;
      row[to] = moved;
      write(row);
    },
  };
}
