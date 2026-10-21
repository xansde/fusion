/**
 * menuController.test.ts — BAR-F1-03: what the context menu DOES, apart from how it is drawn.
 *
 * `ContextMenu.svelte` is markup plus a handful of handlers that call this controller. Choosing
 * an item, walking the items with the keyboard, hovering, pressing a disabled item — all of it
 * is plain logic over a few callbacks, so it is checked here with minimal doubles instead of in
 * a component script that only a browser can run (docs/design/barra-de-acoes/tasks.md §2.10).
 * The expectations are the card's: setas movem o item ativo e pulam o `disabled`; o item
 * `disabled` não faz nada; Esc/clique fora/Tab devolvem o foco ao gatilho.
 */

import { describe, expect, it, vi } from "vitest";

import { MenuController, type MenuControllerDeps } from "../menuController.svelte.js";
import type { IndexedItem, MenuItem } from "../menu.js";

const ITEMS: MenuItem[] = [
  { id: "a", label: "A" },
  { id: "b", label: "B", disabled: true, reason: "Sem alvo" },
  { id: "c", label: "C" },
];

function entry(index: number): IndexedItem {
  return { item: ITEMS[index] as MenuItem, index };
}

function setup(overrides: Partial<MenuControllerDeps> = {}) {
  const log: string[] = [];
  const trigger = { focus: vi.fn(() => log.push("focus")), isConnected: true };
  const controller = new MenuController({
    items: () => ITEMS,
    openedBy: () => "pointer",
    focusTargets: () => [trigger],
    restoreFocus: () => true,
    setOpen: (open) => log.push(`open=${String(open)}`),
    onselect: () => (id) => log.push(`select:${id}`),
    onclose: () => (reason) => log.push(`close:${reason}`),
    ...overrides,
  });
  return { controller, log, trigger };
}

/** A keyboard event the controller can act on, with spies on what it does to the event. */
function keyEvent(key: string, extra: Record<string, unknown> = {}) {
  return {
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
}

/** A menu layer whose items can be found by `data-item-index`, as the real one's can. */
function fakeLayer() {
  const focused: Array<{ index: number; options: unknown }> = [];
  const layer = {
    focused,
    querySelector: (selector: string) => {
      const index = Number(/data-item-index="(\d+)"/.exec(selector)?.[1]);
      return { focus: (options?: unknown) => focused.push({ index, options }) };
    },
  };
  return layer;
}

describe("reset — where the highlight starts each time the menu opens", () => {
  it("opened by the pointer, nothing is highlighted until the user moves", () => {
    const { controller } = setup({ openedBy: () => "pointer" });
    controller.active = 2;

    controller.reset();

    expect(controller.active).toBeNull();
  });

  it("opened by the keyboard, the first enabled item is", () => {
    const { controller } = setup({ openedBy: () => "keyboard" });

    controller.reset();

    expect(controller.active).toBe(0);
  });

  it("skips a disabled first item", () => {
    const items: MenuItem[] = [
      { id: "off", label: "Off", disabled: true },
      { id: "on", label: "On" },
    ];
    const { controller } = setup({ items: () => items, openedBy: () => "keyboard" });

    controller.reset();

    expect(controller.active).toBe(1);
  });
});

describe("opened — every time the menu opens", () => {
  it("starts from the top: nothing highlighted for the pointer, the first enabled item for the keyboard", () => {
    const pointer = setup({ openedBy: () => "pointer" });
    pointer.controller.active = 2;
    pointer.controller.opened(null);
    expect(pointer.controller.active).toBeNull();

    const keyboard = setup({ openedBy: () => "keyboard" });
    keyboard.controller.opened(null);
    expect(keyboard.controller.active).toBe(0);
  });

  it("remembers what had the focus, and gives the focus to it when the trigger is gone", () => {
    const before = { focus: vi.fn(), isConnected: true };
    const { controller } = setup({ focusTargets: () => [null] }); // the trigger was removed
    controller.opened(before);

    controller.select(ITEMS[0] as MenuItem);

    expect(before.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("the trigger still comes first: what had the focus before is only the fallback", () => {
    const before = { focus: vi.fn(), isConnected: true };
    const { controller, trigger } = setup();
    controller.opened(before);

    controller.select(ITEMS[0] as MenuItem);

    expect(trigger.focus).toHaveBeenCalled();
    expect(before.focus).not.toHaveBeenCalled();
  });

  it("forgets the previous open: each time it opens, the element remembered is the new one", () => {
    const first = { focus: vi.fn(), isConnected: true };
    const second = { focus: vi.fn(), isConnected: true };
    const { controller } = setup({ focusTargets: () => [null] });
    controller.opened(first);
    controller.opened(second);

    controller.select(ITEMS[0] as MenuItem);

    expect(first.focus).not.toHaveBeenCalled();
    expect(second.focus).toHaveBeenCalled();
  });

  it("copes with nothing to remember", () => {
    const { controller, log } = setup({ focusTargets: () => [null] });
    controller.opened(null);

    controller.select(ITEMS[0] as MenuItem);

    expect(log).toEqual(["select:a", "open=false", "close:select"]);
  });
});

describe("select — choosing an item", () => {
  it("gives the focus back first, then tells the owner what was chosen, then closes", () => {
    // In that order: what `onselect` does with the focus (open a sheet, say) must win over
    // the menu's own tidying-up.
    const { controller, log } = setup();

    controller.select(ITEMS[0] as MenuItem);

    expect(log).toEqual(["focus", "select:a", "open=false", "close:select"]);
  });

  it("does nothing at all for a disabled item: no choice, no close, no focus moved", () => {
    const { controller, log, trigger } = setup();

    controller.select(ITEMS[1] as MenuItem);

    expect(log).toEqual([]);
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("leaves the focus alone when the owner routes it itself, but still chooses and closes", () => {
    const { controller, log } = setup({ restoreFocus: () => false });

    controller.select(ITEMS[2] as MenuItem);

    expect(log).toEqual(["select:c", "open=false", "close:select"]);
  });

  it("falls back to the next place that can take the focus when the trigger was removed", () => {
    const gone = { focus: vi.fn(), isConnected: false };
    const before = { focus: vi.fn(), isConnected: true };
    const { controller } = setup({ focusTargets: () => [gone, before] });

    controller.select(ITEMS[0] as MenuItem);

    expect(gone.focus).not.toHaveBeenCalled();
    expect(before.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("works without anybody listening for the choice", () => {
    const { controller, log } = setup({ onselect: () => undefined });

    controller.select(ITEMS[0] as MenuItem);

    expect(log).toEqual(["focus", "open=false", "close:select"]);
  });
});

describe("dismiss — the layer says Escape, a click outside or Tab", () => {
  it.each(["escape", "outside", "tab"] as const)("%s closes the menu and says why", (reason) => {
    const { controller, log } = setup();

    controller.dismiss(reason);

    expect(log).toEqual(["open=false", `close:${reason}`]);
  });
});

describe("keydown — walking the items", () => {
  it("ArrowDown from nothing lands on the first enabled item and puts the focus on its button", () => {
    const { controller } = setup();
    const layer = fakeLayer();
    const down = keyEvent("ArrowDown");

    controller.keydown(down, layer as unknown as HTMLElement);

    expect(controller.active).toBe(0);
    expect(layer.focused.map((f) => f.index)).toEqual([0]);
    expect(down.preventDefault).toHaveBeenCalled();
  });

  it("jumps over a disabled item, in both directions", () => {
    const { controller } = setup();
    const layer = fakeLayer();
    controller.active = 0;

    controller.keydown(keyEvent("ArrowDown"), layer as unknown as HTMLElement);
    expect(controller.active).toBe(2);

    controller.keydown(keyEvent("ArrowUp"), layer as unknown as HTMLElement);
    expect(controller.active).toBe(0);
    expect(layer.focused.map((f) => f.index)).toEqual([2, 0]);
  });

  it("Home and End go to the ends", () => {
    const { controller } = setup();
    const layer = fakeLayer();

    controller.keydown(keyEvent("End"), layer as unknown as HTMLElement);
    expect(controller.active).toBe(2);

    controller.keydown(keyEvent("Home"), layer as unknown as HTMLElement);
    expect(controller.active).toBe(0);
  });

  it("moves the focus WITHOUT forbidding the scroll, so an item below the fold of a short menu comes into view", () => {
    // Found in Edge: with `preventScroll` the End key focused an item outside the visible part
    // of a menu that had to scroll.
    const { controller } = setup();
    const layer = fakeLayer();

    controller.keydown(keyEvent("End"), layer as unknown as HTMLElement);

    const [moved] = layer.focused;
    expect(moved?.options).toBeUndefined();
  });

  it("keeps every key but Tab from the rest of the app: the canvas would move the selected token", () => {
    const { controller } = setup();
    const layer = fakeLayer();

    for (const key of ["ArrowLeft", "ArrowRight", "d", "Delete", "Enter", " "]) {
      const event = keyEvent(key);
      controller.keydown(event, layer as unknown as HTMLElement);
      expect(event.stopPropagation, key).toHaveBeenCalled();
    }
  });

  it("lets Tab through, so the browser carries the focus on from the trigger", () => {
    const { controller } = setup();
    const tab = keyEvent("Tab");

    controller.keydown(tab, fakeLayer() as unknown as HTMLElement);

    expect(tab.stopPropagation).not.toHaveBeenCalled();
    expect(controller.active).toBeNull();
  });

  it("does not hijack Enter or Space: the item's own button turns them into one click", () => {
    const { controller } = setup();
    const enter = keyEvent("Enter");

    controller.keydown(enter, fakeLayer() as unknown as HTMLElement);

    expect(enter.preventDefault).not.toHaveBeenCalled();
  });

  it("an arrow with nothing enabled moves nothing and leaves the highlight where it was", () => {
    const items: MenuItem[] = [{ id: "off", label: "Off", disabled: true }];
    const { controller } = setup({ items: () => items });
    const layer = fakeLayer();
    const down = keyEvent("ArrowDown");

    controller.keydown(down, layer as unknown as HTMLElement);

    expect(controller.active).toBeNull();
    expect(layer.focused).toEqual([]);
    expect(down.preventDefault).toHaveBeenCalled(); // the page still must not scroll
  });

  it("ignores a shortcut (Alt+ArrowDown): not navigation", () => {
    const { controller } = setup();
    const layer = fakeLayer();
    const shortcut = keyEvent("ArrowDown", { altKey: true });

    controller.keydown(shortcut, layer as unknown as HTMLElement);

    expect(controller.active).toBeNull();
    expect(shortcut.preventDefault).not.toHaveBeenCalled();
  });
});

describe("pointerEnter — hovering highlights, and the focus follows, as in a native menu", () => {
  it("an enabled item becomes the active one and takes the focus (without scrolling the menu under the pointer)", () => {
    const { controller } = setup();
    const button = { focus: vi.fn() };

    controller.pointerEnter({ currentTarget: button }, entry(2));

    expect(controller.active).toBe(2);
    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("a disabled item is passed over: nothing is highlighted, nothing takes the focus", () => {
    const { controller } = setup();
    controller.active = 0;
    const button = { focus: vi.fn() };

    controller.pointerEnter({ currentTarget: button }, entry(1));

    expect(controller.active).toBe(0);
    expect(button.focus).not.toHaveBeenCalled();
  });
});

describe("pointerDown — pressing an item", () => {
  it("on a disabled item the press keeps the focus where it was, so the keyboard carries on from the highlighted item", () => {
    // Found in Edge: clicking a disabled item focused its button while `active` stayed put, so
    // the next ArrowDown continued from the wrong place.
    const { controller } = setup();
    const press = { preventDefault: vi.fn() };

    controller.pointerDown(press, entry(1));

    expect(press.preventDefault).toHaveBeenCalled();
  });

  it("on an enabled item the press is left alone, so the click that follows can choose it", () => {
    const { controller } = setup();
    const press = { preventDefault: vi.fn() };

    controller.pointerDown(press, entry(0));

    expect(press.preventDefault).not.toHaveBeenCalled();
  });
});

describe("contextMenu — a right-click inside the menu", () => {
  it("does not open the browser's own menu on top of ours", () => {
    const { controller } = setup();
    const click = { preventDefault: vi.fn() };

    controller.contextMenu(click);

    expect(click.preventDefault).toHaveBeenCalled();
  });
});
