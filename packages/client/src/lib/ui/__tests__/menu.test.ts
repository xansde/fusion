/**
 * menu.test.ts — BAR-F1-03: the context menu's model and its keyboard, without a DOM.
 *
 * The client's Vitest has no DOM (docs/design/barra-de-acoes/tasks.md §2.10), so what a
 * menu *does* with the keyboard is a set of pure functions fed minimal events. The
 * expectations below come from the WAI-ARIA menu pattern and from the card ("setas
 * movem o item ativo e pulam o `disabled`", Home/End), written out here rather than
 * read back from the implementation.
 */

import { describe, expect, it } from "vitest";

import {
  describeItem,
  flattenMenu,
  initialActiveIndex,
  layoutMenu,
  menuKeyHandling,
  nextEnabledIndex,
  type MenuEntry,
  type MenuItem,
} from "../menu.js";

function item(id: string, extra: Partial<MenuItem> = {}): MenuItem {
  return { id, label: id.toUpperCase(), ...extra };
}

const ENTRIES: MenuEntry[] = [
  {
    kind: "group",
    label: "Variantes",
    items: [
      item("map0"),
      item("map1", { hint: "depois deste: MAP −10" }),
      item("map2", { disabled: true, reason: "Sem o ataque anterior" }),
    ],
  },
  { kind: "separator" },
  item("pin", { disabled: true, reason: "12 de 12 slots em uso" }),
  item("details", { detail: "Alt" }),
  item("sheet"),
];

describe("flattenMenu — the items a keyboard can walk, in the order they are drawn", () => {
  it("lists group members and loose items in document order, dropping separators and group titles", () => {
    expect(flattenMenu(ENTRIES).map((i) => i.id)).toEqual([
      "map0",
      "map1",
      "map2",
      "pin",
      "details",
      "sheet",
    ]);
  });

  it("an empty menu, or one of only separators, has nothing to walk", () => {
    expect(flattenMenu([])).toEqual([]);
    expect(flattenMenu([{ kind: "separator" }, { kind: "separator" }])).toEqual([]);
  });
});

describe("layoutMenu — what gets drawn, with each item's place in the keyboard order", () => {
  it("numbers items by their position in the flat walk, across groups", () => {
    const rows = layoutMenu(ENTRIES);

    expect(rows.map((r) => r.kind)).toEqual(["group", "separator", "item", "item", "item"]);

    const group = rows[0];
    expect(group?.kind === "group" && group.items.map((i) => [i.item.id, i.index])).toEqual([
      ["map0", 0],
      ["map1", 1],
      ["map2", 2],
    ]);
    const loose = rows
      .filter((r) => r.kind === "item")
      .map((r) => r.kind === "item" && [r.item.id, r.index]);
    expect(loose).toEqual([
      ["pin", 3],
      ["details", 4],
      ["sheet", 5],
    ]);
  });

  it("keeps the group's title, and gives an untitled group none", () => {
    const rows = layoutMenu([
      { kind: "group", label: "Variantes", items: [item("a")] },
      { kind: "group", items: [item("b")] },
    ]);
    expect(rows[0]?.kind === "group" && rows[0].label).toBe("Variantes");
    expect(rows[1]?.kind === "group" && rows[1].label).toBeUndefined();
  });
});

describe("describeItem — the line under the label", () => {
  it("is the hint on an item that works", () => {
    expect(describeItem(item("a", { hint: "depois deste: MAP −10" }))).toBe(
      "depois deste: MAP −10",
    );
  });

  it("is the reason on a disabled item, taking the place of its hint", () => {
    expect(describeItem(item("a", { disabled: true, reason: "Acabou", hint: "ignorado" }))).toBe(
      "Acabou",
    );
  });

  it("falls back to the hint when a disabled item has no reason, and to nothing when it has neither", () => {
    expect(describeItem(item("a", { disabled: true, hint: "só a dica" }))).toBe("só a dica");
    expect(describeItem(item("a"))).toBeUndefined();
    expect(describeItem(item("a", { disabled: true }))).toBeUndefined();
  });

  it("ignores a reason on an item that is not disabled", () => {
    expect(describeItem(item("a", { reason: "não vale aqui" }))).toBeUndefined();
  });
});

describe("nextEnabledIndex — arrows, Home and End skip what is disabled", () => {
  // index:  0 on, 1 OFF, 2 on, 3 OFF, 4 on
  const items = [{}, { disabled: true }, {}, { disabled: true }, {}];

  it("ArrowDown goes to the next enabled item, jumping over disabled ones", () => {
    expect(nextEnabledIndex(items, 0, "ArrowDown")).toBe(2);
    expect(nextEnabledIndex(items, 2, "ArrowDown")).toBe(4);
  });

  it("ArrowUp goes to the previous enabled item, jumping over disabled ones", () => {
    expect(nextEnabledIndex(items, 4, "ArrowUp")).toBe(2);
    expect(nextEnabledIndex(items, 2, "ArrowUp")).toBe(0);
  });

  it("wraps around: ArrowDown on the last enabled item lands on the first, and ArrowUp the reverse", () => {
    expect(nextEnabledIndex(items, 4, "ArrowDown")).toBe(0);
    expect(nextEnabledIndex(items, 0, "ArrowUp")).toBe(4);
  });

  it("Home and End go to the first and last enabled items even when the edges are disabled", () => {
    const edges = [{ disabled: true }, {}, {}, {}, { disabled: true }];
    expect(nextEnabledIndex(edges, 2, "Home")).toBe(1);
    expect(nextEnabledIndex(edges, 2, "End")).toBe(3);
  });

  it("with nothing active yet, ArrowDown starts at the first enabled item and ArrowUp at the last", () => {
    expect(nextEnabledIndex(items, null, "ArrowDown")).toBe(0);
    expect(nextEnabledIndex(items, null, "ArrowUp")).toBe(4);
    const lateStart = [{ disabled: true }, {}, {}];
    expect(nextEnabledIndex(lateStart, null, "ArrowDown")).toBe(1);
  });

  it("moves on correctly even when the current index points at a disabled item", () => {
    expect(nextEnabledIndex(items, 1, "ArrowDown")).toBe(2);
    expect(nextEnabledIndex(items, 3, "ArrowUp")).toBe(2);
  });

  it("is null when no item can be reached", () => {
    expect(nextEnabledIndex([], null, "ArrowDown")).toBeNull();
    expect(nextEnabledIndex([{ disabled: true }, { disabled: true }], 0, "Home")).toBeNull();
  });

  it("a single enabled item is its own neighbour", () => {
    const one = [{ disabled: true }, {}, { disabled: true }];
    expect(nextEnabledIndex(one, 1, "ArrowDown")).toBe(1);
    expect(nextEnabledIndex(one, 1, "ArrowUp")).toBe(1);
  });
});

describe("initialActiveIndex — where the highlight starts", () => {
  const items = [{ disabled: true }, {}, {}];

  it("opened from the keyboard, the first enabled item is already active", () => {
    expect(initialActiveIndex(items, "keyboard")).toBe(1);
  });

  it("opened by the pointer, nothing is active until the user moves", () => {
    expect(initialActiveIndex(items, "pointer")).toBeNull();
  });

  it("a menu with nothing enabled has no active item either way", () => {
    expect(initialActiveIndex([{ disabled: true }], "keyboard")).toBeNull();
  });
});

describe("menuKeyHandling — what a key does inside an open menu", () => {
  const items = [{}, { disabled: true }, {}];
  const state = { items, active: 0 as number | null };

  it("arrows, Home and End move the highlight to where nextEnabledIndex says, and stop the page from scrolling", () => {
    expect(menuKeyHandling({ key: "ArrowDown" }, state)).toEqual({
      move: 2,
      preventDefault: true,
      stopPropagation: true,
    });
    expect(menuKeyHandling({ key: "ArrowUp" }, state).move).toBe(2);
    expect(menuKeyHandling({ key: "End" }, state).move).toBe(2);
    expect(menuKeyHandling({ key: "Home" }, { items, active: 2 }).move).toBe(0);
  });

  it("an open menu owns the keyboard: no key but Tab reaches the rest of the app", () => {
    // The canvas listens on window: arrows move the selected token, KeyD duplicates it.
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowDown", "Home", "Enter", " ", "d", "F9"]) {
      expect(menuKeyHandling({ key }, state).stopPropagation).toBe(true);
    }
  });

  it("Tab is let through, so the layer can close the menu and the browser carry on from the trigger", () => {
    expect(menuKeyHandling({ key: "Tab" }, state)).toEqual({
      move: null,
      preventDefault: false,
      stopPropagation: false,
    });
    expect(menuKeyHandling({ key: "Tab", shiftKey: true }, state).stopPropagation).toBe(false);
  });

  it("Enter and Space are not handled: the item's own button turns them into one click", () => {
    for (const key of ["Enter", " "]) {
      const handling = menuKeyHandling({ key }, state);
      expect(handling.move).toBeNull();
      expect(handling.preventDefault).toBe(false);
    }
  });

  it("Escape is not decided here either: closing is the dismissable layer's, for menu and popover alike", () => {
    expect(menuKeyHandling({ key: "Escape" }, state).move).toBeNull();
  });

  it("an arrow with nothing enabled moves nothing, but still keeps the page from scrolling", () => {
    const handling = menuKeyHandling(
      { key: "ArrowDown" },
      { items: [{ disabled: true }], active: null },
    );
    expect(handling.move).toBeNull();
    expect(handling.preventDefault).toBe(true);
  });

  it("leaves browser shortcuts alone: Alt+ArrowLeft, Ctrl+Home and the like are not navigation", () => {
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      const handling = menuKeyHandling({ key: "ArrowDown", [modifier]: true }, state);
      expect(handling.move).toBeNull();
      expect(handling.preventDefault).toBe(false);
      // Still not for the canvas, though: a held Ctrl does not make Arrow move a token.
      expect(handling.stopPropagation).toBe(true);
    }
  });

  it("leaves keys pressed during IME composition to the IME", () => {
    expect(menuKeyHandling({ key: "ArrowDown", isComposing: true }, state)).toEqual({
      move: null,
      preventDefault: false,
      stopPropagation: false,
    });
  });
});
