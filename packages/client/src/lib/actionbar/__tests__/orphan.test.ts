/**
 * orphan.test.ts — a favourite whose entry left the sheet (BAR-F3-01; spec 53 REQ-BAR-066,
 * CA-BAR-06, DEC-BAR-06).
 *
 * An item was sold, a spell was swapped: the id is still pinned, but no entry answers to it. The
 * row keeps it, drawn FADED as "não está mais na ficha", and the only thing that takes it out is
 * "Desafixar" — the bar never removes a favourite by itself (REQ-BAR-065). The slot is the ordinary
 * one, fed a stand-in entry, so what these tests pin is the stand-in: a VALID entry (the same
 * contract every provider's entries pass), faded WITH its reason, that cannot be mistaken for the
 * real thing.
 */

import { describe, expect, it } from "vitest";

import "../../i18n/index.js";
import { assertValidEntries } from "../actionBarRegistry.js";
import { ORPHAN_ARM_MS, favoriteCells, kindOfEntryId, orphanEntry, orphanIds } from "../orphan.js";
import { slotView } from "../slotModel.js";
import { makeEntry } from "./stubProvider.js";

describe("kindOfEntryId", () => {
  it("is the kind the id's prefix names", () => {
    expect(kindOfEntryId("strike:longsword")).toBe("strike");
    expect(kindOfEntryId("spell:main:heal")).toBe("spell");
    expect(kindOfEntryId("action:seek")).toBe("action");
    expect(kindOfEntryId("item:abc123")).toBe("item");
    expect(kindOfEntryId("reaction:shield-block")).toBe("reaction");
    expect(kindOfEntryId("toggle:rage")).toBe("toggle");
    expect(kindOfEntryId("check:skill-athletics")).toBe("check");
  });

  it("falls back to action for an id it does not know, rather than breaking the row", () => {
    expect(kindOfEntryId("macro:x")).toBe("action");
    expect(kindOfEntryId("")).toBe("action");
    expect(kindOfEntryId("sem-dois-pontos")).toBe("action");
  });
});

describe("orphanEntry — the stand-in the faded slot is drawn from", () => {
  it("keeps the id of the favourite, so the slot, the key and the menu all point at it", () => {
    expect(orphanEntry("item:vendido").id).toBe("item:vendido");
  });

  it("is a VALID entry — the contract the slot is written against (id prefix = kind, faded with a reason)", () => {
    for (const id of [
      "strike:a",
      "spell:m:b",
      "action:c",
      "item:d",
      "reaction:e",
      "toggle:f",
      "check:g",
    ]) {
      expect(() => assertValidEntries([orphanEntry(id)], { onInvalid: "throw" }), id).not.toThrow();
    }
  });

  it("is faded with the reason — and says it plainly: 'não está mais na ficha'", () => {
    const view = slotView(orphanEntry("item:vendido"), "pt-BR");

    expect(view.state).toBe("unavailable");
    expect(view.label).toBe("Não está mais na ficha");
    expect(view.reason).toBe("Item vendido ou magia trocada. Desafixe para liberar o lugar.");
    expect(view.ariaLabel).toContain("Não está mais na ficha");
    expect(view.ariaLabel).toContain("Desafixe");
  });

  it("draws a short name that fits under the icon, and never the raw id", () => {
    const view = slotView(orphanEntry("item:a1b2c3d4e5"), "pt-BR");

    expect(view.shortLabel).toBe("Ausente");
    expect(view.shortLabel.length).toBeLessThanOrEqual(10);
    expect(view.ariaLabel).not.toContain("a1b2c3d4e5");
  });

  it("carries nothing a click could run: no cost, no variants, no target", () => {
    const entry = orphanEntry("strike:a");

    expect(entry.cost).toBeUndefined();
    expect(entry.variants).toBeUndefined();
    expect(entry.target).toBeUndefined();
    expect(entry.badge).toBeUndefined();
  });

  it("uses the 'hidden eye' icon, so it does not pass for the real strike or spell", () => {
    expect(orphanEntry("strike:a").icon).toBe("eyeoff");
    expect(orphanEntry("spell:m:b").icon).toBe("eyeoff");
  });
});

describe("orphanIds — the favourites no entry answers to", () => {
  const entries = [makeEntry("strike:a"), makeEntry("spell:m:b")];

  it("lists the pinned ids that are not on the sheet, in slot order", () => {
    const row = ["strike:a", "item:vendido", null, "spell:m:b", "action:sumiu"];

    expect(orphanIds(row, entries)).toEqual(["item:vendido", "action:sumiu"]);
  });

  it("nothing is an orphan while every pinned id is on the sheet, and empty positions are not orphans", () => {
    expect(orphanIds(["strike:a", null, "spell:m:b"], entries)).toEqual([]);
    expect(orphanIds([null, null], entries)).toEqual([]);
  });

  it("an id pinned twice is listed once", () => {
    expect(orphanIds(["item:x", "item:x"], entries)).toEqual(["item:x"]);
  });

  it("while the sheet has not loaded (no entries), every pinned id would look like an orphan — the caller decides", () => {
    expect(orphanIds(["strike:a"], [])).toEqual(["strike:a"]);
  });
});

describe("favoriteCells — what each of the twelve positions draws", () => {
  const strike = makeEntry("strike:a");
  const spell = makeEntry("spell:m:b");
  const entries = [strike, spell];
  const row = (...ids: Array<string | null>): Array<string | null> =>
    Array.from({ length: 12 }, (_, index) => ids[index] ?? null);

  it("always twelve cells, one per key", () => {
    expect(favoriteCells(row(), entries, true)).toHaveLength(12);
    expect(favoriteCells(row("strike:a"), entries, true)).toHaveLength(12);
    expect(favoriteCells([], entries, true)).toHaveLength(12);
  });

  it("a pinned id the sheet answers to is its entry; an empty position is empty", () => {
    const cells = favoriteCells(row("strike:a", null, "spell:m:b"), entries, true);

    expect(cells[0]).toEqual({ kind: "entry", entry: strike });
    expect(cells[1]).toEqual({ kind: "empty" });
    expect(cells[2]).toEqual({ kind: "entry", entry: spell });
    expect(cells[3]).toEqual({ kind: "empty" });
  });

  it("a pinned id nothing answers to is an ORPHAN, in the position of its key (REQ-BAR-066)", () => {
    const cells = favoriteCells(row("strike:a", "item:vendido"), entries, true);

    expect(cells[1]).toEqual({ kind: "orphan", entry: orphanEntry("item:vendido") });
    expect(cells.filter((cell) => cell.kind === "orphan")).toHaveLength(1);
  });

  it("before the bar is armed a missing entry is still just an empty position — it may only be late", () => {
    const cells = favoriteCells(row("strike:a", "action:seek"), entries, false);

    expect(cells[0]).toEqual({ kind: "entry", entry: strike });
    expect(cells[1]).toEqual({ kind: "empty" });
  });

  it("an entry that has arrived is drawn even when the bar is not armed yet", () => {
    expect(favoriteCells(row("spell:m:b"), entries, false)[0]).toEqual({
      kind: "entry",
      entry: spell,
    });
  });

  it("when the provider gives NOTHING (it failed, or has not loaded) no favourite is an orphan: a list that is not there says nothing about the row", () => {
    const cells = favoriteCells(row("strike:a", "item:x"), [], true);

    expect(cells.every((cell) => cell.kind === "empty")).toBe(true);
  });

  it("the same id pinned twice shows twice (the row is the player's), both as orphans", () => {
    const cells = favoriteCells(row("item:x", "item:x"), entries, true);

    expect(cells.slice(0, 2).map((cell) => cell.kind)).toEqual(["orphan", "orphan"]);
  });

  it("ORPHAN_ARM_MS is a wait long enough for a pack to arrive and short enough to be noticed only once", () => {
    expect(ORPHAN_ARM_MS).toBeGreaterThanOrEqual(500);
    expect(ORPHAN_ARM_MS).toBeLessThanOrEqual(5000);
  });
});
