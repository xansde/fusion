/**
 * dismissableLayer.test.ts — BAR-F1-03: how a popover or a menu goes away, and where the
 * keyboard focus goes when it does.
 *
 * Two layers of proof, because the client's Vitest has no DOM
 * (docs/design/barra-de-acoes/tasks.md §2.10):
 *
 *   1. The *decisions* are pure functions fed minimal objects — does this key dismiss, does
 *      this pointer-down count as "outside", does this Tab leave the layer, where does the
 *      focus return. Each is checked against the rule written in the test.
 *   2. The *action* that wires those decisions to `document` is run against a fake document
 *      that records the listeners it is given — the same technique as `clickOutside.test.ts`
 *      — so "Esc closes it and hands the focus back to the trigger" is exercised end to end,
 *      without a browser.
 *
 * What only a real browser can show (the caret really landing on the trigger, a click that
 * really reaches the page) is left to the visual check of the lane.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDismissHandler,
  dismissableLayer,
  isAnyLayerOpen,
  isEscapeKey,
  isInsideFloatingLayer,
  isTopLayer,
  keepLayerKeysFromApp,
  layerOwnsKey,
  menuLayerOptions,
  mergeDescribedBy,
  nextLayerId,
  pointerDownDismisses,
  popoverLayerOptions,
  pushLayer,
  releaseLayer,
  returnFocus,
  returnFocusTo,
  shouldRestoreFocus,
  tabExitsLayer,
  type DismissReason,
} from "../dismissableLayer.js";

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

describe("isEscapeKey", () => {
  it("is true for Escape, false for other keys", () => {
    expect(isEscapeKey({ key: "Escape" })).toBe(true);
    expect(isEscapeKey({ key: "Enter" })).toBe(false);
    expect(isEscapeKey({ key: "e" })).toBe(false);
  });

  it("ignores an Escape that is cancelling an IME composition", () => {
    expect(isEscapeKey({ key: "Escape", isComposing: true })).toBe(false);
  });
});

describe("shouldRestoreFocus — the focus goes back to the trigger, except after a click elsewhere", () => {
  it.each<[DismissReason, boolean]>([
    ["escape", true],
    ["select", true],
    ["tab", true],
    ["outside", false],
  ])("%s → %s", (reason, expected) => {
    // A click outside already put the focus where the user pointed; taking it back would
    // yank it from the field they just chose.
    expect(shouldRestoreFocus(reason)).toBe(expected);
  });
});

describe("isInsideFloatingLayer", () => {
  it("is true for something that lives inside another floating layer", () => {
    const inner = {
      closest: (selector: string) => (selector === "[data-fusion-layer]" ? {} : null),
    };
    expect(isInsideFloatingLayer(inner)).toBe(true);
  });

  it("is false for the page, for null, and for things that cannot be asked", () => {
    expect(isInsideFloatingLayer({ closest: () => null })).toBe(false);
    expect(isInsideFloatingLayer(null)).toBe(false);
    expect(isInsideFloatingLayer({})).toBe(false);
  });
});

describe("pointerDownDismisses — given a pointer-down that landed outside the layer's own box", () => {
  const anchor = { contains: (other: unknown) => other === anchor || other === "inside-anchor" };

  it("dismisses for a click on the page", () => {
    expect(
      pointerDownDismisses({ target: { closest: () => null }, anchor: null, exemptAnchor: false }),
    ).toBe(true);
  });

  it("does not dismiss for a click on the trigger when the trigger is exempt (a popover toggles itself)", () => {
    expect(pointerDownDismisses({ target: "inside-anchor", anchor, exemptAnchor: true })).toBe(
      false,
    );
  });

  it("does dismiss for a click on the trigger when it is not exempt (a context menu closes, then reopens)", () => {
    expect(pointerDownDismisses({ target: "inside-anchor", anchor, exemptAnchor: false })).toBe(
      true,
    );
  });

  it("does not dismiss for a click inside a layer nested in this one", () => {
    const nested = { closest: () => ({}) };
    expect(pointerDownDismisses({ target: nested, anchor: null, exemptAnchor: false })).toBe(false);
  });

  it("dismisses when the target is null (an event from a detached node)", () => {
    expect(pointerDownDismisses({ target: null, anchor: null, exemptAnchor: false })).toBe(true);
  });
});

describe("tabExitsLayer — Tab inside a popover leaves it only at the edges", () => {
  it("forward Tab on the last tabbable element leaves", () => {
    expect(tabExitsLayer({ shiftKey: false, index: 2, count: 3 })).toBe(true);
  });

  it("forward Tab on any other element stays", () => {
    expect(tabExitsLayer({ shiftKey: false, index: 0, count: 3 })).toBe(false);
    expect(tabExitsLayer({ shiftKey: false, index: 1, count: 3 })).toBe(false);
  });

  it("Shift+Tab on the first tabbable element leaves", () => {
    expect(tabExitsLayer({ shiftKey: true, index: 0, count: 3 })).toBe(true);
  });

  it("Shift+Tab on the container itself (no element focused inside yet) leaves", () => {
    expect(tabExitsLayer({ shiftKey: true, index: -1, count: 3 })).toBe(true);
  });

  it("Shift+Tab on any later element stays", () => {
    expect(tabExitsLayer({ shiftKey: true, index: 1, count: 3 })).toBe(false);
  });

  it("forward Tab on the container itself stays (the browser walks into the first element)", () => {
    expect(tabExitsLayer({ shiftKey: false, index: -1, count: 3 })).toBe(false);
  });

  it("a layer with nothing to tab to is left by Tab in either direction", () => {
    expect(tabExitsLayer({ shiftKey: false, index: -1, count: 0 })).toBe(true);
    expect(tabExitsLayer({ shiftKey: true, index: -1, count: 0 })).toBe(true);
  });
});

describe("mergeDescribedBy — a trigger may already be described by something else", () => {
  it("adds the id to an empty attribute", () => {
    expect(mergeDescribedBy(null, "tip", true)).toBe("tip");
    expect(mergeDescribedBy("", "tip", true)).toBe("tip");
  });

  it("appends the id after what is already there, keeping it", () => {
    expect(mergeDescribedBy("hint-1 hint-2", "tip", true)).toBe("hint-1 hint-2 tip");
  });

  it("does not add the id twice", () => {
    expect(mergeDescribedBy("tip hint-1", "tip", true)).toBe("tip hint-1");
  });

  it("removes only its own id", () => {
    expect(mergeDescribedBy("hint-1 tip hint-2", "tip", false)).toBe("hint-1 hint-2");
  });

  it("returns null when nothing is left, so the caller drops the attribute", () => {
    expect(mergeDescribedBy("tip", "tip", false)).toBeNull();
    expect(mergeDescribedBy(null, "tip", false)).toBeNull();
  });

  it("leaves the value alone when asked to remove an id that is not there", () => {
    expect(mergeDescribedBy("hint-1", "tip", false)).toBe("hint-1");
  });
});

describe("returnFocus", () => {
  it("focuses the target without scrolling the page, and says so", () => {
    const focus = vi.fn();
    expect(returnFocus({ focus, isConnected: true })).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does nothing, and says so, for a target that left the document", () => {
    const focus = vi.fn();
    expect(returnFocus({ focus, isConnected: false })).toBe(false);
    expect(focus).not.toHaveBeenCalled();
  });

  it("does nothing for no target", () => {
    expect(returnFocus(null)).toBe(false);
    expect(returnFocus(undefined)).toBe(false);
  });
});

describe("nextLayerId", () => {
  it("hands out distinct ids that share the prefix, for aria-describedby/aria-controls", () => {
    const a = nextLayerId("fusion-menu");
    const b = nextLayerId("fusion-menu");
    expect(a).not.toBe(b);
    expect(a.startsWith("fusion-menu-")).toBe(true);
    expect(b.startsWith("fusion-menu-")).toBe(true);
  });
});

describe("the layer stack — Escape belongs to the topmost layer only", () => {
  it("the most recently opened layer is on top", () => {
    const a = pushLayer();
    const b = pushLayer();
    expect(isTopLayer(a)).toBe(false);
    expect(isTopLayer(b)).toBe(true);
    releaseLayer(b);
    expect(isTopLayer(a)).toBe(true);
    releaseLayer(a);
  });

  it("releasing out of order, or twice, leaves the others intact", () => {
    const a = pushLayer();
    const b = pushLayer();
    releaseLayer(a);
    releaseLayer(a);
    expect(isTopLayer(b)).toBe(true);
    releaseLayer(b);
  });
});

// ---------------------------------------------------------------------------
// The action, against a fake document
// ---------------------------------------------------------------------------

interface Registered {
  type: string;
  handler: (event: unknown) => void;
  capture: boolean;
}

interface FakeEl {
  contains(other: unknown): boolean;
  focus: ReturnType<typeof vi.fn>;
  isConnected: boolean;
  closest(selector: string): unknown;
  querySelectorAll?: (selector: string) => FakeEl[];
  /** What the DOM reports: 0 for a natively focusable element, -1 when Tab skips it. */
  tabIndex?: number;
  /** False for an element that ignores `focus()`, as a hidden or disabled one does. */
  focusable?: boolean;
}

/** The fake document currently installed, so a fake element's `focus()` can move its focus. */
let installedDocument: { activeElement: unknown } | null = null;

function fakeEl(overrides: Partial<FakeEl> = {}): FakeEl {
  const el: FakeEl = {
    contains: (other) => other === el,
    // As in a browser, `focus()` is a request: with a document installed it moves the focus
    // here unless the element ignores it. (Without one there is nothing to move.)
    focus: vi.fn(() => {
      if (installedDocument !== null && el.focusable !== false)
        installedDocument.activeElement = el;
    }),
    isConnected: true,
    closest: () => null,
    ...overrides,
  };
  return el;
}

/** Installs a fake `document` on globalThis and puts the real one back after the test. */
function installFakeDocument(activeElement: unknown = null) {
  const listeners: Registered[] = [];
  const doc = {
    activeElement,
    addEventListener: (type: string, handler: (event: unknown) => void, capture?: boolean) => {
      listeners.push({ type, handler, capture: capture === true });
    },
    removeEventListener: (type: string, handler: (event: unknown) => void, capture?: boolean) => {
      const i = listeners.findIndex(
        (l) => l.type === type && l.handler === handler && l.capture === (capture === true),
      );
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  installedDocument = doc;

  return {
    doc,
    listeners,
    /** Fire every listener of this type, as the browser would for one event. */
    fire(type: string, event: Record<string, unknown>) {
      for (const l of [...listeners]) if (l.type === type) l.handler(event);
    },
  };
}

const realDocument = globalThis.document;
afterEach(() => {
  Object.defineProperty(globalThis, "document", { value: realDocument, configurable: true });
  installedDocument = null;
});

function keyEvent(key: string, extra: Record<string, unknown> = {}) {
  return {
    key,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: null as unknown,
    ...extra,
  };
}

describe("dismissableLayer — Escape", () => {
  it("dismisses with 'escape', consumes the key, and hands the focus back to the trigger", () => {
    const page = installFakeDocument();
    const node = fakeEl();
    const anchor = fakeEl();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(node as unknown as HTMLElement, {
      onDismiss,
      anchor: anchor as unknown as HTMLElement,
    });

    const esc = keyEvent("Escape");
    page.fire("keydown", esc);

    expect(onDismiss).toHaveBeenCalledWith("escape");
    // Consumed: an open window must not also close, and the canvas must not drop the selection.
    expect(esc.preventDefault).toHaveBeenCalled();
    expect(esc.stopPropagation).toHaveBeenCalled();
    expect(anchor.focus).toHaveBeenCalledWith({ preventScroll: true });
    layer.destroy();
  });

  it("falls back to whatever had the focus before the layer opened when there is no trigger", () => {
    const before = fakeEl();
    const page = installFakeDocument(before);
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, { onDismiss: vi.fn() });

    page.fire("keydown", keyEvent("Escape"));

    expect(before.focus).toHaveBeenCalledWith({ preventScroll: true });
    layer.destroy();
  });

  it("does not touch the focus when told not to restore it, but still dismisses", () => {
    const page = installFakeDocument();
    const anchor = fakeEl();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, {
      onDismiss,
      anchor: anchor as unknown as HTMLElement,
      restoreFocus: false,
    });

    page.fire("keydown", keyEvent("Escape"));

    expect(onDismiss).toHaveBeenCalledWith("escape");
    expect(anchor.focus).not.toHaveBeenCalled();
    layer.destroy();
  });

  it("closes only the topmost of two stacked layers, then the next on the following Escape", () => {
    const page = installFakeDocument();
    const outerDismiss = vi.fn();
    const innerDismiss = vi.fn();
    const outer = dismissableLayer(fakeEl() as unknown as HTMLElement, { onDismiss: outerDismiss });
    const inner = dismissableLayer(fakeEl() as unknown as HTMLElement, { onDismiss: innerDismiss });

    page.fire("keydown", keyEvent("Escape"));
    expect(innerDismiss).toHaveBeenCalledTimes(1);
    expect(outerDismiss).not.toHaveBeenCalled();

    inner.destroy();
    page.fire("keydown", keyEvent("Escape"));
    expect(outerDismiss).toHaveBeenCalledTimes(1);
    outer.destroy();
  });

  it("ignores other keys and Escape during IME composition", () => {
    const page = installFakeDocument();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, { onDismiss });

    const enter = keyEvent("Enter");
    page.fire("keydown", enter);
    page.fire("keydown", keyEvent("Escape", { isComposing: true }));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(enter.stopPropagation).not.toHaveBeenCalled();
    layer.destroy();
  });
});

describe("dismissableLayer — a click outside", () => {
  function pointerEvent(target: unknown) {
    return { target };
  }

  it("dismisses with 'outside' and leaves the focus where the click put it", () => {
    const page = installFakeDocument();
    const anchor = fakeEl();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, {
      onDismiss,
      anchor: anchor as unknown as HTMLElement,
    });

    page.fire("pointerdown", pointerEvent(fakeEl()));

    expect(onDismiss).toHaveBeenCalledWith("outside");
    expect(anchor.focus).not.toHaveBeenCalled();
    layer.destroy();
  });

  it("does nothing for a click inside the layer", () => {
    const page = installFakeDocument();
    const node = fakeEl();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(node as unknown as HTMLElement, { onDismiss });

    page.fire("pointerdown", pointerEvent(node));

    expect(onDismiss).not.toHaveBeenCalled();
    layer.destroy();
  });

  it("does nothing for a click on an exempt trigger, so the trigger can toggle the layer itself", () => {
    const page = installFakeDocument();
    const anchor = fakeEl();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, {
      onDismiss,
      anchor: anchor as unknown as HTMLElement,
      exemptAnchor: true,
    });

    page.fire("pointerdown", pointerEvent(anchor));

    expect(onDismiss).not.toHaveBeenCalled();
    layer.destroy();
  });

  it("dismisses on a click on the trigger when the trigger is not exempt", () => {
    const page = installFakeDocument();
    const anchor = fakeEl();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, {
      onDismiss,
      anchor: anchor as unknown as HTMLElement,
    });

    page.fire("pointerdown", pointerEvent(anchor));

    expect(onDismiss).toHaveBeenCalledWith("outside");
    layer.destroy();
  });

  it("does nothing for a click inside a different floating layer (one opened from this one)", () => {
    const page = installFakeDocument();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, { onDismiss });

    page.fire("pointerdown", pointerEvent(fakeEl({ closest: () => ({}) })));

    expect(onDismiss).not.toHaveBeenCalled();
    layer.destroy();
  });
});

describe("dismissableLayer — Tab", () => {
  function tabbableNode(count: number) {
    const tabbables = Array.from({ length: count }, () => fakeEl());
    const node = fakeEl({
      contains: (other) => other === node || tabbables.includes(other as FakeEl),
      querySelectorAll: () => tabbables,
    });
    return { node, tabbables };
  }

  it("with the 'close' policy (a menu), Tab dismisses and the focus returns to the trigger", () => {
    const page = installFakeDocument();
    const { node, tabbables } = tabbableNode(2);
    const anchor = fakeEl();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(node as unknown as HTMLElement, {
      onDismiss,
      anchor: anchor as unknown as HTMLElement,
      tab: "close",
    });

    const tab = keyEvent("Tab", { target: tabbables[0] });
    page.fire("keydown", tab);

    expect(onDismiss).toHaveBeenCalledWith("tab");
    expect(anchor.focus).toHaveBeenCalled();
    // The browser's own Tab then carries on from the trigger.
    expect(tab.preventDefault).not.toHaveBeenCalled();
    layer.destroy();
  });

  it("with 'close-at-edges' (a popover), Tab inside walks normally and leaves at the last element", () => {
    const page = installFakeDocument();
    const { node, tabbables } = tabbableNode(3);
    const onDismiss = vi.fn();
    const layer = dismissableLayer(node as unknown as HTMLElement, {
      onDismiss,
      anchor: fakeEl() as unknown as HTMLElement,
      tab: "close-at-edges",
    });

    page.fire("keydown", keyEvent("Tab", { target: tabbables[1] }));
    expect(onDismiss).not.toHaveBeenCalled();

    page.fire("keydown", keyEvent("Tab", { target: tabbables[2] }));
    expect(onDismiss).toHaveBeenCalledWith("tab");
    layer.destroy();
  });

  it("with 'close-at-edges', an element Tab skips does not count as the last one", () => {
    const page = installFakeDocument();
    const walkable = [fakeEl({ tabIndex: 0 }), fakeEl({ tabIndex: 0 })];
    const skipped = fakeEl({ tabIndex: -1 });
    const everything = [...walkable, skipped];
    const node = fakeEl({
      contains: (other) => everything.includes(other as FakeEl),
      querySelectorAll: () => everything,
    });
    const onDismiss = vi.fn();
    const layer = dismissableLayer(node as unknown as HTMLElement, {
      onDismiss,
      tab: "close-at-edges",
    });

    // The second walkable element is the real last stop, though a skipped one follows it.
    page.fire("keydown", keyEvent("Tab", { target: walkable[1] }));

    expect(onDismiss).toHaveBeenCalledWith("tab");
    layer.destroy();
  });

  it("with 'close-at-edges', Shift+Tab on the first element leaves", () => {
    const page = installFakeDocument();
    const { node, tabbables } = tabbableNode(3);
    const onDismiss = vi.fn();
    const layer = dismissableLayer(node as unknown as HTMLElement, { onDismiss });

    page.fire("keydown", keyEvent("Tab", { shiftKey: true, target: tabbables[0] }));

    expect(onDismiss).toHaveBeenCalledWith("tab");
    layer.destroy();
  });

  it("a Tab that starts outside the layer is not its business", () => {
    const page = installFakeDocument();
    const { node } = tabbableNode(2);
    const onDismiss = vi.fn();
    const layer = dismissableLayer(node as unknown as HTMLElement, { onDismiss });

    page.fire("keydown", keyEvent("Tab", { target: fakeEl() }));

    expect(onDismiss).not.toHaveBeenCalled();
    layer.destroy();
  });
});

describe("dismissableLayer — focus on open", () => {
  it("'first' moves the focus to the first tabbable element inside", async () => {
    installFakeDocument();
    const first = fakeEl();
    const node = fakeEl({ querySelectorAll: () => [first, fakeEl()] });
    const layer = dismissableLayer(node as unknown as HTMLElement, {
      onDismiss: vi.fn(),
      initialFocus: "first",
    });

    await Promise.resolve();

    expect(first.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(node.focus).not.toHaveBeenCalled();
    layer.destroy();
  });

  it("'first' passes over elements the Tab key skips (tabIndex -1), as the inactive items of a menu are", async () => {
    // Found in a real browser: a <button tabindex="-1"> matches "button" but is not tabbable,
    // so a menu opened by the pointer (no active item) was handing its focus to the first item.
    installFakeDocument();
    const inactiveItem = fakeEl({ tabIndex: -1 });
    const activeItem = fakeEl({ tabIndex: 0 });
    const node = fakeEl({ querySelectorAll: () => [inactiveItem, activeItem] });
    const layer = dismissableLayer(node as unknown as HTMLElement, {
      onDismiss: vi.fn(),
      initialFocus: "first",
    });

    await Promise.resolve();

    expect(inactiveItem.focus).not.toHaveBeenCalled();
    expect(activeItem.focus).toHaveBeenCalledWith({ preventScroll: true });
    layer.destroy();
  });

  it("'first' falls back to the container when every element inside is skipped by Tab", async () => {
    installFakeDocument();
    const node = fakeEl({
      querySelectorAll: () => [fakeEl({ tabIndex: -1 }), fakeEl({ tabIndex: -1 })],
    });
    const layer = dismissableLayer(node as unknown as HTMLElement, {
      onDismiss: vi.fn(),
      initialFocus: "first",
    });

    await Promise.resolve();

    expect(node.focus).toHaveBeenCalledWith({ preventScroll: true });
    layer.destroy();
  });

  it("'first' falls back to the container when there is nothing to tab to", async () => {
    installFakeDocument();
    const node = fakeEl({ querySelectorAll: () => [] });
    const layer = dismissableLayer(node as unknown as HTMLElement, {
      onDismiss: vi.fn(),
      initialFocus: "first",
    });

    await Promise.resolve();

    expect(node.focus).toHaveBeenCalledWith({ preventScroll: true });
    layer.destroy();
  });

  it("'container' (the default) focuses the layer itself", async () => {
    installFakeDocument();
    const node = fakeEl({ querySelectorAll: () => [fakeEl()] });
    const layer = dismissableLayer(node as unknown as HTMLElement, { onDismiss: vi.fn() });

    await Promise.resolve();

    expect(node.focus).toHaveBeenCalledWith({ preventScroll: true });
    layer.destroy();
  });

  it("'none' leaves the focus alone", async () => {
    installFakeDocument();
    const node = fakeEl({ querySelectorAll: () => [fakeEl()] });
    const layer = dismissableLayer(node as unknown as HTMLElement, {
      onDismiss: vi.fn(),
      initialFocus: "none",
    });

    await Promise.resolve();

    expect(node.focus).not.toHaveBeenCalled();
    layer.destroy();
  });

  it("does not move the focus after the layer was already destroyed", async () => {
    installFakeDocument();
    const node = fakeEl();
    const layer = dismissableLayer(node as unknown as HTMLElement, { onDismiss: vi.fn() });
    layer.destroy();

    await Promise.resolve();

    expect(node.focus).not.toHaveBeenCalled();
  });
});

describe("dismissableLayer — lifecycle", () => {
  it("destroy removes every listener it added and takes the layer off the stack", () => {
    const page = installFakeDocument();
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, { onDismiss: vi.fn() });
    expect(page.listeners.length).toBeGreaterThan(0);

    layer.destroy();

    expect(page.listeners).toHaveLength(0);
  });

  it("update swaps the callback and the trigger without adding listeners", () => {
    const page = installFakeDocument();
    const first = vi.fn();
    const second = vi.fn();
    const oldAnchor = fakeEl();
    const newAnchor = fakeEl();
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, {
      onDismiss: first,
      anchor: oldAnchor as unknown as HTMLElement,
    });
    const before = page.listeners.length;

    layer.update({ onDismiss: second, anchor: newAnchor as unknown as HTMLElement });
    expect(page.listeners).toHaveLength(before);

    page.fire("keydown", keyEvent("Escape"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("escape");
    expect(newAnchor.focus).toHaveBeenCalled();
    expect(oldAnchor.focus).not.toHaveBeenCalled();
    layer.destroy();
  });

  it("is silent after destroy: a late Escape does nothing", () => {
    const page = installFakeDocument();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, { onDismiss });
    layer.destroy();

    page.fire("keydown", keyEvent("Escape"));

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Where the focus goes when the trigger is gone
// ---------------------------------------------------------------------------

describe("returnFocusTo — the first candidate that can take the focus", () => {
  it("uses the first one while it is in the document", () => {
    const trigger = fakeEl();
    const before = fakeEl();

    expect(returnFocusTo(trigger, before)).toBe(true);

    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(before.focus).not.toHaveBeenCalled();
  });

  it("falls back to the next when the trigger was removed while the layer was open", () => {
    // A re-render replaced the button the menu hung from; the focus must not be dropped on <body>.
    const trigger = fakeEl({ isConnected: false });
    const before = fakeEl();

    expect(returnFocusTo(trigger, before)).toBe(true);

    expect(trigger.focus).not.toHaveBeenCalled();
    expect(before.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("skips candidates that are missing", () => {
    const before = fakeEl();

    expect(returnFocusTo(null, undefined, before)).toBe(true);
    expect(before.focus).toHaveBeenCalled();
  });

  it("says so when nothing could take it", () => {
    expect(returnFocusTo(null, fakeEl({ isConnected: false }))).toBe(false);
    expect(returnFocusTo()).toBe(false);
  });
});

describe("returnFocus — says where the focus really is, not that it was asked to move", () => {
  // Found by the verifier in Edge: with the trigger still in the document but hidden or
  // disabled, `focus()` does nothing, yet was counted as success, so the focus was never offered
  // to the next place and ended up on <body>.
  it("is true when the focus lands on the target", () => {
    installFakeDocument();
    const target = fakeEl();

    expect(returnFocus(target)).toBe(true);
  });

  it("is false when the target takes the request and ignores it (hidden, disabled)", () => {
    installFakeDocument();
    const hidden = fakeEl({ focusable: false });

    expect(returnFocus(hidden)).toBe(false);
    expect(hidden.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("returnFocusTo then offers the focus to the next candidate", () => {
    const page = installFakeDocument();
    const hiddenTrigger = fakeEl({ focusable: false });
    const before = fakeEl();

    expect(returnFocusTo(hiddenTrigger, before)).toBe(true);

    expect(hiddenTrigger.focus).toHaveBeenCalled();
    expect(page.doc.activeElement).toBe(before);
  });

  it("trusts the request when there is no document to ask (a render on the server)", () => {
    const target = { focus: vi.fn(), isConnected: true };

    expect(returnFocus(target)).toBe(true);
  });
});

describe("dismissableLayer — a trigger that cannot take the focus", () => {
  it("Escape offers the focus to what had it before the layer opened", () => {
    const before = fakeEl();
    const page = installFakeDocument(before);
    const hiddenTrigger = fakeEl({ focusable: false });
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, {
      onDismiss: vi.fn(),
      anchor: hiddenTrigger as unknown as HTMLElement,
    });
    page.doc.activeElement = fakeEl(); // the focus moved into the layer when it opened

    page.fire("keydown", keyEvent("Escape"));

    expect(page.doc.activeElement).toBe(before);
    layer.destroy();
  });
});

describe("dismissableLayer — a removed trigger", () => {
  it("Escape falls back to what had the focus before the layer opened", () => {
    const before = fakeEl();
    const page = installFakeDocument(before);
    const removedTrigger = fakeEl({ isConnected: false });
    const layer = dismissableLayer(fakeEl() as unknown as HTMLElement, {
      onDismiss: vi.fn(),
      anchor: removedTrigger as unknown as HTMLElement,
    });

    page.fire("keydown", keyEvent("Escape"));

    expect(removedTrigger.focus).not.toHaveBeenCalled();
    expect(before.focus).toHaveBeenCalledWith({ preventScroll: true });
    layer.destroy();
  });
});

// ---------------------------------------------------------------------------
// The layer owns the keyboard
// ---------------------------------------------------------------------------

describe("layerOwnsKey — an open layer keeps its keys from the rest of the app", () => {
  it("every key but Tab is the layer's: the canvas moves the selected token on the arrows and deletes it on Delete", () => {
    for (const key of [
      "ArrowDown",
      "ArrowLeft",
      "Delete",
      "Backspace",
      "d",
      "Enter",
      " ",
      "F9",
      "Home",
    ]) {
      expect(layerOwnsKey({ key })).toBe(true);
    }
  });

  it("Tab is let through, so focus can leave the layer the way the browser would take it", () => {
    expect(layerOwnsKey({ key: "Tab" })).toBe(false);
    expect(layerOwnsKey({ key: "Tab", isComposing: false })).toBe(false);
  });

  it("keys pressed during IME composition belong to the IME", () => {
    expect(layerOwnsKey({ key: "a", isComposing: true })).toBe(false);
  });
});

describe("keepLayerKeysFromApp — the keydown handler of a layer's root element", () => {
  function press(key: string, extra: Record<string, unknown> = {}) {
    const event = { key, stopPropagation: vi.fn(), ...extra };
    keepLayerKeysFromApp(event as unknown as Parameters<typeof keepLayerKeysFromApp>[0]);
    return event;
  }

  it("stops a key from reaching the app: ArrowDown would otherwise move the selected token", () => {
    for (const key of ["ArrowDown", "ArrowLeft", "Delete", "d", "Home", "Enter", " "]) {
      expect(press(key).stopPropagation, key).toHaveBeenCalled();
    }
  });

  it("lets Tab through, so the browser can carry the focus on", () => {
    expect(press("Tab").stopPropagation).not.toHaveBeenCalled();
  });

  it("leaves a key pressed during IME composition to the IME", () => {
    expect(press("a", { isComposing: true }).stopPropagation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Closing, and the layer stack's public face
// ---------------------------------------------------------------------------

describe("isAnyLayerOpen", () => {
  it("is true from the moment a layer opens until the last one is released", () => {
    expect(isAnyLayerOpen()).toBe(false);
    const a = pushLayer();
    const b = pushLayer();
    expect(isAnyLayerOpen()).toBe(true);
    releaseLayer(a);
    expect(isAnyLayerOpen()).toBe(true);
    releaseLayer(b);
    expect(isAnyLayerOpen()).toBe(false);
  });
});

describe("createDismissHandler — what a popover or menu does when its layer says 'close me'", () => {
  it("closes it and then reports why", () => {
    const calls: string[] = [];
    const dismiss = createDismissHandler({
      setOpen: (open) => calls.push(`open=${String(open)}`),
      onclose: () => (reason) => calls.push(`closed:${reason}`),
    });

    dismiss("escape");

    expect(calls).toEqual(["open=false", "closed:escape"]);
  });

  it("closes it even when nobody listens for the reason", () => {
    const setOpen = vi.fn();
    const dismiss = createDismissHandler({ setOpen, onclose: () => undefined });

    dismiss("outside");

    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("asks for the listener each time, so a callback changed after mount is the one called", () => {
    const first = vi.fn();
    const second = vi.fn();
    let current: ((reason: DismissReason) => void) | undefined = first;
    const dismiss = createDismissHandler({ setOpen: vi.fn(), onclose: () => current });
    current = second;

    dismiss("tab");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("tab");
  });
});

// ---------------------------------------------------------------------------
// What a popover and a menu ask of the layer — proven by what the layer then does
// ---------------------------------------------------------------------------

describe("popoverLayerOptions — a popover's trigger toggles it, and Tab walks its content", () => {
  it("passes the callback, the trigger and the focus policy through", () => {
    const onDismiss = vi.fn();
    const anchor = fakeEl() as unknown as HTMLElement;

    const options = popoverLayerOptions({ onDismiss, anchor, restoreFocus: false });

    expect(options.onDismiss).toBe(onDismiss);
    expect(options.anchor).toBe(anchor);
    expect(options.restoreFocus).toBe(false);
  });

  it("a click on the trigger does not dismiss it (so the trigger can toggle it)", () => {
    const page = installFakeDocument();
    const anchor = fakeEl();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(
      fakeEl() as unknown as HTMLElement,
      popoverLayerOptions({
        onDismiss,
        anchor: anchor as unknown as HTMLElement,
        restoreFocus: true,
      }),
    );

    page.fire("pointerdown", { target: anchor });

    expect(onDismiss).not.toHaveBeenCalled();
    layer.destroy();
  });

  it("the focus goes to the first thing inside it on open", async () => {
    installFakeDocument();
    const first = fakeEl({ tabIndex: 0 });
    const node = fakeEl({ querySelectorAll: () => [first, fakeEl({ tabIndex: 0 })] });
    const layer = dismissableLayer(
      node as unknown as HTMLElement,
      popoverLayerOptions({ onDismiss: vi.fn(), anchor: null, restoreFocus: true }),
    );

    await Promise.resolve();

    expect(first.focus).toHaveBeenCalled();
    layer.destroy();
  });

  it("Tab in the middle of its content does not close it; Tab off its last element does", () => {
    const page = installFakeDocument();
    const stops = [fakeEl({ tabIndex: 0 }), fakeEl({ tabIndex: 0 }), fakeEl({ tabIndex: 0 })];
    const node = fakeEl({
      contains: (other) => stops.includes(other as FakeEl),
      querySelectorAll: () => stops,
    });
    const onDismiss = vi.fn();
    const layer = dismissableLayer(
      node as unknown as HTMLElement,
      popoverLayerOptions({ onDismiss, anchor: null, restoreFocus: true }),
    );

    page.fire("keydown", keyEvent("Tab", { target: stops[1] }));
    expect(onDismiss).not.toHaveBeenCalled();

    page.fire("keydown", keyEvent("Tab", { target: stops[2] }));
    expect(onDismiss).toHaveBeenCalledWith("tab");
    layer.destroy();
  });
});

describe("menuLayerOptions — a menu closes on a click on its trigger, and never traps Tab", () => {
  it("passes the callback, the trigger and the focus policy through", () => {
    const onDismiss = vi.fn();
    const anchor = fakeEl() as unknown as HTMLElement;

    const options = menuLayerOptions({ onDismiss, anchor, restoreFocus: false });

    expect(options.onDismiss).toBe(onDismiss);
    expect(options.anchor).toBe(anchor);
    expect(options.restoreFocus).toBe(false);
  });

  it("a click on the trigger dismisses it (a right-click on the trigger then opens a fresh menu)", () => {
    const page = installFakeDocument();
    const anchor = fakeEl();
    const onDismiss = vi.fn();
    const layer = dismissableLayer(
      fakeEl() as unknown as HTMLElement,
      menuLayerOptions({
        onDismiss,
        anchor: anchor as unknown as HTMLElement,
        restoreFocus: true,
      }),
    );

    page.fire("pointerdown", { target: anchor });

    expect(onDismiss).toHaveBeenCalledWith("outside");
    layer.destroy();
  });

  it("any Tab inside it closes it, and the focus returns to the trigger", () => {
    const page = installFakeDocument();
    const anchor = fakeEl();
    // Three tab stops, and the key is pressed on the MIDDLE one: a layer that only closed at
    // its edges would stay open here. (A real menu has one tab stop, where the two policies
    // happen to agree; the policy is still "any Tab".)
    const items = [fakeEl({ tabIndex: 0 }), fakeEl({ tabIndex: 0 }), fakeEl({ tabIndex: 0 })];
    const node = fakeEl({
      contains: (other) => items.includes(other as FakeEl),
      querySelectorAll: () => items,
    });
    const onDismiss = vi.fn();
    const layer = dismissableLayer(
      node as unknown as HTMLElement,
      menuLayerOptions({
        onDismiss,
        anchor: anchor as unknown as HTMLElement,
        restoreFocus: true,
      }),
    );

    // On the middle stop, nowhere near an "edge".
    page.fire("keydown", keyEvent("Tab", { target: items[1] }));

    expect(onDismiss).toHaveBeenCalledWith("tab");
    expect(anchor.focus).toHaveBeenCalled();
    layer.destroy();
  });

  it("the focus goes to the one item that is a tab stop, or to the menu itself when none is", async () => {
    installFakeDocument();
    const active = fakeEl({ tabIndex: 0 });
    const withActive = fakeEl({ querySelectorAll: () => [fakeEl({ tabIndex: -1 }), active] });
    const a = dismissableLayer(
      withActive as unknown as HTMLElement,
      menuLayerOptions({ onDismiss: vi.fn(), anchor: null, restoreFocus: true }),
    );
    await Promise.resolve();
    expect(active.focus).toHaveBeenCalled();
    expect(withActive.focus).not.toHaveBeenCalled();
    a.destroy();

    const noneActive = fakeEl({ querySelectorAll: () => [fakeEl({ tabIndex: -1 })] });
    const b = dismissableLayer(
      noneActive as unknown as HTMLElement,
      menuLayerOptions({ onDismiss: vi.fn(), anchor: null, restoreFocus: true }),
    );
    await Promise.resolve();
    expect(noneActive.focus).toHaveBeenCalled();
    b.destroy();
  });
});
