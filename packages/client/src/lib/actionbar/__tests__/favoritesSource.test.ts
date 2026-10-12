/**
 * favoritesSource.test.ts — the pure side of the twelve favourite slots (BAR-F3-01; spec 53
 * REQ-BAR-061..066, DEC-BAR-06/07/08; tasks.md §2.5, §2.8).
 *
 * `favoritesSource.ts` is the contract (`FavoritesSource`) and the row arithmetic every source shares:
 * reading the row off an actor document, deciding whether the first-opening seed is still due, and
 * the three edits (pin, unpin, move). It runs no effect and holds no state, so it is tested on plain
 * values. The persisted source that writes it to the actor, with the version lock, is
 * `favoritesStore.svelte.ts` (its own test); the in-memory source of the first delivery
 * (BAR-F1-04's scaffolding) is gone.
 */

import { ACTION_BAR_SLOT_COUNT } from "@fusion/shared";
import { describe, expect, it } from "vitest";

import {
  FAVORITE_SLOT_COUNT,
  SEED_CAPS,
  emptyRow,
  isSeeded,
  moveWithin,
  needsSeed,
  pinInto,
  rowFromIds,
  sameRow,
  seedFromEntries,
  storedRowOf,
  unpinFrom,
} from "../favoritesSource.js";
import type { ActionBarEntry } from "../types.js";
import { makeEntry } from "./stubProvider.js";

/** A row of 12 with the given ids from the first slot on. */
function row(...ids: Array<string | null>): Array<string | null> {
  return Array.from({ length: FAVORITE_SLOT_COUNT }, (_, index) => ids[index] ?? null);
}

/** An actor document that carries `flags.fusion.actionBar`. */
function docWith(actionBar: unknown): Record<string, unknown> {
  return { _id: "actor-1", flags: { fusion: { actionBar } } };
}

describe("the shape of the row", () => {
  it("are twelve positions, the same number the server's schema counts", () => {
    expect(FAVORITE_SLOT_COUNT).toBe(12);
    expect(FAVORITE_SLOT_COUNT).toBe(ACTION_BAR_SLOT_COUNT);
  });

  it("an empty row is twelve nulls, and a fresh array every time", () => {
    const first = emptyRow();
    expect(first).toEqual(new Array<null>(12).fill(null));

    first[0] = "strike:a";

    expect(emptyRow()[0]).toBeNull();
  });
});

describe("rowFromIds — ids in slot order, padded to twelve", () => {
  it("keeps the order and pads with nulls", () => {
    expect(rowFromIds(["strike:a", "spell:m:b"])).toEqual(row("strike:a", "spell:m:b"));
  });

  it("never more than twelve, whatever comes in", () => {
    const ids = Array.from({ length: 20 }, (_, index) => `action:n${String(index)}`);

    const result = rowFromIds(ids);

    expect(result).toHaveLength(12);
    expect(result[11]).toBe("action:n11");
  });

  it("drops what the server would refuse (a malformed id) and a repeated id, instead of failing the whole write", () => {
    const result = rowFromIds(["strike:a", "isto não é um id", "strike:a", "macro:x", "spell:m:b"]);

    expect(result).toEqual(row("strike:a", "spell:m:b"));
  });

  it("nothing in, twelve empty positions out", () => {
    expect(rowFromIds([])).toEqual(emptyRow());
  });
});

describe("storedRowOf — the row as the actor document keeps it", () => {
  it("returns the twelve positions in the order stored, as a copy", () => {
    const stored = row("strike:a", null, "spell:m:b");
    const doc = docWith({ favorites: stored, seeded: true });

    const result = storedRowOf(doc);
    expect(result).toEqual(stored);
    expect(result).not.toBe(stored);
  });

  it("is null when the document has no bar, no favourites, or something that is not a list", () => {
    for (const doc of [
      undefined,
      null,
      "actor",
      {},
      { flags: {} },
      docWith(undefined),
      docWith({ seeded: true }),
      docWith({ favorites: "strike:a" }),
      docWith({ favorites: { "0": "strike:a" } }),
      docWith("tudo"),
    ]) {
      expect(storedRowOf(doc), JSON.stringify(doc)).toBeNull();
    }
  });

  it("tolerates a row that predates the schema: a short one is padded, a long one cut at twelve", () => {
    expect(storedRowOf(docWith({ favorites: ["strike:a", "strike:b"] }))).toEqual(
      row("strike:a", "strike:b"),
    );
    const long = Array.from({ length: 15 }, (_, index) => `action:n${String(index)}`);
    expect(storedRowOf(docWith({ favorites: long }))).toEqual(long.slice(0, 12));
  });

  it("reads anything that is not a valid id as an empty position, so a bad value cannot reach a button", () => {
    const stored = [7, "isto não é um id", null, "strike:ok", { id: "x" }, ["strike:a"]];

    expect(storedRowOf(docWith({ favorites: stored }))).toEqual(row(null, null, null, "strike:ok"));
  });
});

describe("isSeeded / needsSeed — is the first-opening seed still due? (REQ-BAR-064, D-BA08)", () => {
  it("only a literal `true` counts as seeded", () => {
    expect(isSeeded(docWith({ seeded: true }))).toBe(true);
    for (const doc of [
      undefined,
      {},
      docWith({}),
      docWith({ seeded: false }),
      docWith({ seeded: "true" }),
      docWith({ seeded: 1 }),
    ]) {
      expect(isSeeded(doc), JSON.stringify(doc)).toBe(false);
    }
  });

  it("an actor with no bar at all is due the seed", () => {
    expect(needsSeed({ _id: "actor-1" })).toBe(true);
    expect(needsSeed(docWith({}))).toBe(true);
    expect(needsSeed(docWith({ seeded: false }))).toBe(true);
    expect(needsSeed(undefined)).toBe(true);
  });

  it("an actor that was seeded is never due it again — even with an empty row (the player cleared it)", () => {
    expect(needsSeed(docWith({ seeded: true }))).toBe(false);
    expect(needsSeed(docWith({ seeded: true, favorites: row() }))).toBe(false);
    expect(needsSeed(docWith({ seeded: true, favorites: row("strike:a") }))).toBe(false);
  });

  it("a row that already has an entry is the player's, whatever the flag says: nothing is seeded over it", () => {
    expect(needsSeed(docWith({ favorites: row(null, "strike:a") }))).toBe(false);
  });

  it("an unseeded row of twelve empty positions is still due the seed", () => {
    expect(needsSeed(docWith({ favorites: row() }))).toBe(true);
  });

  it("icons alone say nothing about the favourites: still due", () => {
    expect(
      needsSeed(docWith({ icons: { "strike:a": "/assets/actionbar-icons/x-1a2b3c4d.png" } })),
    ).toBe(true);
  });
});

describe("pinInto — the first empty slot", () => {
  it("pins into the first empty slot", () => {
    const result = pinInto(row("strike:a", "strike:b"), "item:potion");

    expect(result.outcome).toBe("pinned");
    expect(result.row).toEqual(row("strike:a", "strike:b", "item:potion"));
  });

  it("fills a hole left by an unpin before it appends", () => {
    const result = pinInto(row("strike:a", null, "strike:c"), "item:potion");

    expect(result.row).toEqual(row("strike:a", "item:potion", "strike:c"));
  });

  it("pinning what is already pinned changes nothing and does not move it", () => {
    const before = row("strike:a", "strike:b");

    const result = pinInto(before, "strike:b");

    expect(result.outcome).toBe("already");
    expect(result.row).toEqual(before);
  });

  it("12 of 12: it does not fit, and the row is untouched", () => {
    const full = Array.from({ length: 12 }, (_, index) => `action:n${String(index)}`);

    const result = pinInto(full, "action:extra");

    expect(result.outcome).toBe("full");
    expect(result.row).toEqual(full);
  });

  it("does not edit the row it was given", () => {
    const before = row("strike:a");
    const copy = [...before];

    pinInto(before, "strike:b");

    expect(before).toEqual(copy);
  });
});

describe("unpinFrom — empties the slot, the others stay where they are", () => {
  it("leaves the hole in place, without pulling the others", () => {
    expect(unpinFrom(row("strike:a", "strike:b", "strike:c"), "strike:b")).toEqual(
      row("strike:a", null, "strike:c"),
    );
  });

  it("an entry that is not pinned: the row stays as it was", () => {
    const before = row("strike:a");

    expect(unpinFrom(before, "strike:zzz")).toEqual(before);
  });

  it("clears every position the id is in (a stored row can repeat one)", () => {
    expect(unpinFrom(row("strike:a", "strike:b", "strike:a"), "strike:a")).toEqual(
      row(null, "strike:b"),
    );
  });

  it("does not edit the row it was given", () => {
    const before = row("strike:a", "strike:b");
    const copy = [...before];

    unpinFrom(before, "strike:a");

    expect(before).toEqual(copy);
  });
});

describe("moveWithin — dropping on an occupied slot swaps the two", () => {
  it("moves to an empty slot", () => {
    expect(moveWithin(row("strike:a", "strike:b"), 0, 5)).toEqual(
      row(null, "strike:b", null, null, null, "strike:a"),
    );
  });

  it("swaps with an occupied slot", () => {
    expect(moveWithin(row("strike:a", "strike:b"), 0, 1)).toEqual(row("strike:b", "strike:a"));
  });

  it("moving an empty slot onto an occupied one empties the occupied one's old place: it is a swap too", () => {
    expect(moveWithin(row("strike:a", null, "strike:c"), 1, 2)).toEqual(
      row("strike:a", "strike:c", null),
    );
  });

  it("an index outside the row, a fractional one, or the same slot do nothing", () => {
    const before = row("strike:a", "strike:b");
    for (const [from, to] of [
      [-1, 3],
      [0, 12],
      [12, 0],
      [1, 1],
      [0.5, 2],
      [0, Number.NaN],
    ] as const) {
      expect(moveWithin(before, from, to), `${String(from)}→${String(to)}`).toEqual(before);
    }
  });

  it("does not edit the row it was given", () => {
    const before = row("strike:a", "strike:b");
    const copy = [...before];

    moveWithin(before, 0, 1);

    expect(before).toEqual(copy);
  });
});

describe("sameRow", () => {
  it("compares position by position", () => {
    expect(sameRow(row("strike:a"), row("strike:a"))).toBe(true);
    expect(sameRow(row("strike:a"), row(null, "strike:a"))).toBe(false);
    expect(sameRow(row("strike:a"), row("strike:b"))).toBe(false);
    expect(sameRow(row(), [])).toBe(false);
  });
});

describe("seedFromEntries — the shell's seed for a system that gives none (Q-BAR-02)", () => {
  const strikes = ["a", "b", "c", "d", "e"].map((n) => makeEntry(`strike:${n}`));
  const spells = ["a", "b"].map((n) => makeEntry(`spell:m:${n}`));
  const actions = ["a", "b", "c", "d", "e", "f"].map((n) => makeEntry(`action:${n}`));
  const toggles = [makeEntry("toggle:guard")];
  const items = [makeEntry("item:potion")];
  const checks = [makeEntry("check:perception")];
  const reactions = [makeEntry("reaction:reactive-strike")];

  it("the caps are four strikes, four spells and four actions", () => {
    expect(SEED_CAPS).toEqual({ strike: 4, spell: 4, action: 4 });
  });

  it("strikes first, then spells and cantrips, then actions, up to four of each", () => {
    const ids = seedFromEntries([...actions, ...spells, ...strikes]);

    expect(ids).toEqual([
      "strike:a",
      "strike:b",
      "strike:c",
      "strike:d",
      "spell:m:a",
      "spell:m:b",
      "action:a",
      "action:b",
      "action:c",
      "action:d",
    ]);
  });

  it("D-BA08: items, checks and reactions never enter by themselves", () => {
    expect(seedFromEntries([...items, ...checks, ...reactions])).toEqual([]);
  });

  it("goes by KIND, not by tab: the switches that live in the Actions tab are not actions", () => {
    // A toggle shares `tab: "actions"` with the actions and, in the PF2e provider, comes BEFORE
    // them. Seeding "the first four of the tab" would put the switches in the row.
    const ids = seedFromEntries([...toggles, ...actions]);

    expect(ids).toEqual(["action:a", "action:b", "action:c", "action:d"]);
  });

  it("keeps the order the provider gave inside each kind", () => {
    const ids = seedFromEntries([strikes[3]!, strikes[0]!, strikes[2]!]);

    expect(ids).toEqual(["strike:d", "strike:a", "strike:c"]);
  });

  it("is a function of the entries alone: same entries, same seed, however many times", () => {
    const entries = [...strikes, ...spells, ...actions];

    expect(seedFromEntries(entries)).toEqual(seedFromEntries([...entries]));
    expect(seedFromEntries(entries)).toEqual(seedFromEntries(entries));
  });

  it("a new strike behind the first four does not move the seed", () => {
    const before = seedFromEntries([...strikes.slice(0, 4), ...spells]);
    const after = seedFromEntries([...strikes.slice(0, 4), makeEntry("strike:novo"), ...spells]);

    expect(after).toEqual(before);
  });

  it("never more than twelve ids, and each one valid and different", () => {
    const many: ActionBarEntry[] = [
      ...strikes,
      ...spells,
      ...actions,
      makeEntry("strike:a"),
      makeEntry("spell:m:a", { id: "spell:m:a" }),
    ];

    const ids = seedFromEntries(many);

    expect(ids.length).toBeLessThanOrEqual(12);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips an entry whose id the server would refuse, instead of poisoning the whole write", () => {
    const broken = makeEntry("strike:ok", { id: "strike: com espaço" });

    expect(seedFromEntries([broken, ...strikes.slice(0, 2)])).toEqual(["strike:a", "strike:b"]);
  });

  it("no entries, no seed", () => {
    expect(seedFromEntries([])).toEqual([]);
  });
});
