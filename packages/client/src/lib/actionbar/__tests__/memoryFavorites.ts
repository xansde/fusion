/**
 * memoryFavorites.ts — a test double for `FavoritesSource` (BAR-F3-01).
 *
 * NOT a test file (Vitest only runs `*.test.ts`). The persisted source (`favoritesStore.svelte.ts`)
 * needs a server to talk to; the tests of the things that merely USE a source — the controller, the
 * slot menu — need only a row that behaves like one. This is that row: the three edits are the same
 * pure functions the real source uses, kept in memory, and every call is recorded so a test can say
 * what the code under test asked for.
 */

import {
  FAVORITE_SLOT_COUNT,
  moveWithin,
  pinInto,
  rowFromIds,
  sameRow,
  unpinFrom,
  type FavoritesSource,
} from "../favoritesSource.js";

export interface MemoryFavorites extends FavoritesSource {
  readonly calls: {
    readonly pin: string[];
    readonly unpin: string[];
    readonly move: Array<[number, number]>;
  };
}

/** A source over `initial` (padded or cut to twelve), seeded with whatever the test wants pinned. */
export function memoryFavorites(initial: ReadonlyArray<string | null> = []): MemoryFavorites {
  let row: ReadonlyArray<string | null> = Array.from(
    { length: FAVORITE_SLOT_COUNT },
    (_, index) => initial[index] ?? null,
  );
  const calls: MemoryFavorites["calls"] = { pin: [], unpin: [], move: [] };
  return {
    calls,
    slots: () => [...row],
    isPinned: (entryId) => row.includes(entryId),
    pin(entryId) {
      calls.pin.push(entryId);
      const result = pinInto(row, entryId);
      row = result.row;
      return result.outcome !== "full";
    },
    unpin(entryId) {
      calls.unpin.push(entryId);
      row = unpinFrom(row, entryId);
    },
    move(from, to) {
      calls.move.push([from, to]);
      const next = moveWithin(row, from, to);
      if (!sameRow(next, row)) row = next;
    },
  };
}

/** A source pinned with these ids, from the first slot on (what the seed would give). */
export function memoryFavoritesOfIds(ids: readonly string[]): MemoryFavorites {
  return memoryFavorites(rowFromIds(ids));
}
