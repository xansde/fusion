/**
 * floatingLayer.test.ts — BAR-F1-03: the thin DOM glue around `computePosition`.
 *
 * The geometry itself is proven in `floating.test.ts`. What is left for this file is what the
 * glue adds: the layer is moved out of the component tree (so it can sit above the window
 * host, which is its own stacking context), measured, placed from the anchor or the pointer,
 * and kept in place when the viewport or its own size changes. A fake `document`, `window` and
 * `ResizeObserver` stand in for the browser, as in `clickOutside.test.ts`; what only a real
 * browser can show (that it really lands above a window) is covered by the lane's visual check.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { floatingLayer } from "../floatingLayer.js";

interface Listener {
  type: string;
  handler: () => void;
  capture: boolean;
}

function captureOf(options: unknown): boolean {
  if (typeof options === "object" && options !== null) {
    return (options as { capture?: boolean }).capture === true;
  }
  return options === true;
}

function installBrowser(viewport = { width: 1000, height: 800 }) {
  const windowListeners: Listener[] = [];
  const win = {
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    addEventListener: (type: string, handler: () => void, options?: unknown) => {
      windowListeners.push({ type, handler, capture: captureOf(options) });
    },
    // As in a real browser, a listener added with capture is only removed by a call that says
    // capture too. A double that forgets the flag lets a leaked listener pass unnoticed.
    removeEventListener: (type: string, handler: () => void, options?: unknown) => {
      const i = windowListeners.findIndex(
        (l) => l.type === type && l.handler === handler && l.capture === captureOf(options),
      );
      if (i >= 0) windowListeners.splice(i, 1);
    },
  };
  const appended: unknown[] = [];
  const body = { appendChild: (child: unknown) => appended.push(child) };
  const doc = { body, defaultView: win, activeElement: null };
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });

  const observers: Array<{ callback: () => void; observed: unknown[]; disconnected: boolean }> = [];
  class FakeResizeObserver {
    private readonly record: { callback: () => void; observed: unknown[]; disconnected: boolean };
    constructor(callback: () => void) {
      this.record = { callback, observed: [], disconnected: false };
      observers.push(this.record);
    }
    observe(target: unknown) {
      this.record.observed.push(target);
    }
    disconnect() {
      this.record.disconnected = true;
    }
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);

  return { windowListeners, appended, body, observers, win };
}

const realDocument = globalThis.document;
const realWindow = globalThis.window;
afterEach(() => {
  Object.defineProperty(globalThis, "document", { value: realDocument, configurable: true });
  Object.defineProperty(globalThis, "window", { value: realWindow, configurable: true });
  vi.unstubAllGlobals();
});

/**
 * A layer as the browser would report it. Where a fixed element *lands* is its left/top plus
 * the origin of whatever is its containing block — the viewport (offset 0) unless an ancestor
 * has a transform, which is what `containingBlock` stands in for.
 */
function fakeLayer(
  size = { width: 200, height: 100 },
  closest: (selector: string) => unknown = () => null,
  containingBlock = { x: 0, y: 0 },
) {
  const style = {} as Record<string, string>;
  const px = (value: string | undefined): number => (value === undefined ? 0 : parseFloat(value));
  const layer = {
    style,
    dataset: {} as Record<string, string>,
    getBoundingClientRect: () => ({
      x: px(style["left"]) + containingBlock.x,
      y: px(style["top"]) + containingBlock.y,
      ...size,
    }),
    closest,
    remove: vi.fn(),
  };
  return layer;
}

function fakeAnchor(
  rect: { x: number; y: number; width: number; height: number },
  isConnected = true,
  closest: (selector: string) => unknown = () => null,
) {
  return { getBoundingClientRect: () => rect, isConnected, closest } as unknown as HTMLElement;
}

/** A <dialog> that a layer can be appended to, modal (top layer) or not. */
function fakeDialog(modal: boolean | "unsupported") {
  const appended: unknown[] = [];
  return {
    appended,
    appendChild: (child: unknown) => appended.push(child),
    matches: (selector: string) => {
      if (selector !== ":modal") return false;
      if (modal === "unsupported") throw new SyntaxError("':modal' is not a valid selector");
      return modal;
    },
  };
}

const ANCHOR = { x: 400, y: 300, width: 100, height: 30 };

describe("floatingLayer — leaving the component tree", () => {
  it("moves the layer to the end of <body>, out from under whatever stacking context it was in", () => {
    const browser = installBrowser();
    const layer = fakeLayer();

    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor: fakeAnchor(ANCHOR) });

    expect(browser.appended).toEqual([layer]);
    handle.destroy();
  });

  it("stays inside a MODAL <dialog> around the anchor: the top layer hides anything outside it", () => {
    const browser = installBrowser();
    const dialog = fakeDialog(true);
    const anchor = fakeAnchor(ANCHOR, true, (s) => (s === "dialog" ? dialog : null));
    const layer = fakeLayer();

    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor });

    expect(dialog.appended).toEqual([layer]);
    expect(browser.appended).toEqual([]);
    handle.destroy();
  });

  it("goes to <body> from a NON-modal <dialog open>: those are in the page, and a transform on them would skew a fixed child", () => {
    // The app's own dialogs (token add/config, file picker) are <dialog open> centred with
    // `transform: translate(-50%, -50%)`: a containing block for position:fixed descendants.
    const browser = installBrowser();
    const dialog = fakeDialog(false);
    const anchor = fakeAnchor(ANCHOR, true, (s) => (s === "dialog" ? dialog : null));
    const layer = fakeLayer();

    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor });

    expect(browser.appended).toEqual([layer]);
    expect(dialog.appended).toEqual([]);
    handle.destroy();
  });

  it("decides by where the TRIGGER is, not where the component happens to be written", () => {
    // A <Tooltip> declared outside a modal dialog, whose trigger is inside it, still has to
    // render inside that dialog or the top layer hides it.
    const browser = installBrowser();
    const dialog = fakeDialog(true);
    const anchor = fakeAnchor(ANCHOR, true, (s) => (s === "dialog" ? dialog : null));
    const layer = fakeLayer({ width: 200, height: 100 }, () => null); // the layer's own tree: no dialog

    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor });

    expect(dialog.appended).toEqual([layer]);
    expect(browser.appended).toEqual([]);
    handle.destroy();
  });

  it("and the other way: a layer written inside a modal dialog whose trigger is outside it goes to <body>", () => {
    const browser = installBrowser();
    const dialog = fakeDialog(true);
    const layer = fakeLayer({ width: 200, height: 100 }, (s) => (s === "dialog" ? dialog : null));

    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor: fakeAnchor(ANCHOR) });

    expect(browser.appended).toEqual([layer]);
    expect(dialog.appended).toEqual([]);
    handle.destroy();
  });

  it("with no trigger (a menu opened at the pointer) it falls back to where the layer itself sits", () => {
    const browser = installBrowser();
    const dialog = fakeDialog(true);
    const layer = fakeLayer({ width: 214, height: 180 }, (s) => (s === "dialog" ? dialog : null));

    const handle = floatingLayer(layer as unknown as HTMLElement, { point: { x: 300, y: 200 } });

    expect(dialog.appended).toEqual([layer]);
    expect(browser.appended).toEqual([]);
    handle.destroy();
  });

  it("a browser without ':modal' keeps the layer inside the dialog, as a modal needs", () => {
    const browser = installBrowser();
    const dialog = fakeDialog("unsupported");
    const anchor = fakeAnchor(ANCHOR, true, (s) => (s === "dialog" ? dialog : null));
    const layer = fakeLayer();

    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor });

    expect(dialog.appended).toEqual([layer]);
    expect(browser.appended).toEqual([]);
    handle.destroy();
  });
});

describe("floatingLayer — inside a dialog that is a containing block for fixed children", () => {
  // A modal <dialog> restyled with a transform (or filter, or contain) makes `left`/`top`
  // relative to the dialog's own box instead of the viewport. The layer measures where it
  // really landed and compensates, so the placement is right whatever the host does.
  const SHIFT = { x: 100, y: 60 };

  function insideShiftedDialog(shift = SHIFT) {
    const browser = installBrowser({ width: 1000, height: 700 });
    const dialog = fakeDialog(true);
    const anchor = fakeAnchor(ANCHOR, true, (s) => (s === "dialog" ? dialog : null));
    const layer = fakeLayer({ width: 200, height: 100 }, () => null, shift);
    return { browser, dialog, anchor, layer };
  }

  it("compensates when only the vertical origin is offset (a dialog shifted down, not across)", () => {
    // Found by the verifier's mutation: a check that skipped the correction unless BOTH axes
    // were off passed every test that shifted both.
    const { anchor, layer } = insideShiftedDialog({ x: 0, y: 60 });

    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor, placement: "bottom" });

    expect(layer.style["left"]).toBe("350px");
    expect(layer.style["top"]).toBe("276px");
    handle.destroy();
  });

  it("compensates when only the horizontal origin is offset (a dialog shifted across, not down)", () => {
    const { anchor, layer } = insideShiftedDialog({ x: 100, y: 0 });

    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor, placement: "bottom" });

    expect(layer.style["left"]).toBe("250px");
    expect(layer.style["top"]).toBe("336px");
    handle.destroy();
  });

  it("leaves a sub-pixel difference alone: no needless nudging", () => {
    const { anchor, layer } = insideShiftedDialog({ x: 0.4, y: 0.4 });

    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor, placement: "bottom" });

    expect(layer.style["left"]).toBe("350px");
    expect(layer.style["top"]).toBe("336px");
    handle.destroy();
  });

  it("lands on the computed position, not offset by the dialog's origin", () => {
    const { anchor, layer } = insideShiftedDialog();

    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor, placement: "bottom" });

    // Wanted on screen: x = 400 + (100 − 200) / 2 = 350, y = 300 + 30 + 6 = 336. With the
    // dialog's origin at (100, 60) that is left/top = (250, 276).
    expect(layer.style["left"]).toBe("250px");
    expect(layer.style["top"]).toBe("276px");
    const landed = layer.getBoundingClientRect();
    expect([landed.x, landed.y]).toEqual([350, 336]);
    handle.destroy();
  });

  it("keeps compensating when it is placed again", () => {
    const { anchor, layer } = insideShiftedDialog();
    const handle = floatingLayer(layer as unknown as HTMLElement, { anchor, placement: "bottom" });

    handle.update({
      anchor: fakeAnchor(
        { x: 200, y: 200, width: 100, height: 30 },
        true,
        anchor.closest.bind(anchor),
      ),
      placement: "bottom",
    });

    // x = 200 + (100 − 200) / 2 = 150, y = 200 + 30 + 6 = 236 → left/top = (50, 176)
    expect(layer.style["left"]).toBe("50px");
    expect(layer.style["top"]).toBe("176px");
    handle.destroy();
  });

  it("does not touch the position when the layer is in <body>, where nothing can skew it", () => {
    // Same fake offset, but the layer is portaled to <body>: no correction is applied.
    installBrowser({ width: 1000, height: 700 });
    const layer = fakeLayer({ width: 200, height: 100 }, () => null, SHIFT);

    const handle = floatingLayer(layer as unknown as HTMLElement, {
      anchor: fakeAnchor(ANCHOR),
      placement: "bottom",
    });

    expect(layer.style["left"]).toBe("350px");
    expect(layer.style["top"]).toBe("336px");
    handle.destroy();
  });
});

describe("floatingLayer — placing it", () => {
  it("places the layer under the anchor, measured against the real viewport, and reveals it", () => {
    installBrowser({ width: 1000, height: 800 });
    const layer = fakeLayer({ width: 200, height: 100 });

    const handle = floatingLayer(layer as unknown as HTMLElement, {
      anchor: fakeAnchor({ x: 400, y: 300, width: 100, height: 30 }),
      placement: "bottom",
    });

    // x = 400 + (100 − 200) / 2 = 350 ; y = 300 + 30 + 6 (the default gap) = 336
    expect(layer.style["left"]).toBe("350px");
    expect(layer.style["top"]).toBe("336px");
    expect(layer.dataset["placement"]).toBe("bottom");
    expect(layer.style["visibility"]).toBe("visible");
    handle.destroy();
  });

  it("flips against the edge of the actual viewport it was given", () => {
    installBrowser({ width: 1000, height: 800 });
    const layer = fakeLayer({ width: 200, height: 100 });

    const handle = floatingLayer(layer as unknown as HTMLElement, {
      anchor: fakeAnchor({ x: 400, y: 740, width: 100, height: 30 }),
      placement: "bottom",
    });

    // No room below (22 px), so it goes above: y = 740 − 100 − 6 = 634
    expect(layer.style["top"]).toBe("634px");
    expect(layer.dataset["placement"]).toBe("top");
    handle.destroy();
  });

  it("opens at the pointer when a point is given, and the point wins over the anchor", () => {
    installBrowser({ width: 1000, height: 800 });
    const layer = fakeLayer({ width: 214, height: 180 });

    const handle = floatingLayer(layer as unknown as HTMLElement, {
      anchor: fakeAnchor({ x: 10, y: 10, width: 50, height: 50 }),
      point: { x: 300, y: 200 },
      placement: "bottom-start",
      offset: 0,
    });

    expect(layer.style["left"]).toBe("300px");
    expect(layer.style["top"]).toBe("200px");
    handle.destroy();
  });

  it("a pointer menu near the bottom-right corner opens facing inward", () => {
    installBrowser({ width: 1000, height: 800 });
    const layer = fakeLayer({ width: 214, height: 180 });

    const handle = floatingLayer(layer as unknown as HTMLElement, {
      point: { x: 990, y: 790 },
      placement: "bottom-start",
      offset: 0,
    });

    expect(layer.style["left"]).toBe("776px");
    expect(layer.style["top"]).toBe("610px");
    handle.destroy();
  });

  it("with no anchor and no point it still shows the layer, rather than leaving it invisible and unfocusable", () => {
    installBrowser();
    const layer = fakeLayer();

    const handle = floatingLayer(layer as unknown as HTMLElement, {});

    expect(layer.style["visibility"]).toBe("visible");
    handle.destroy();
  });

  it("update() re-places it for a new anchor", () => {
    installBrowser();
    const layer = fakeLayer({ width: 200, height: 100 });
    const handle = floatingLayer(layer as unknown as HTMLElement, {
      anchor: fakeAnchor({ x: 400, y: 300, width: 100, height: 30 }),
      placement: "bottom",
    });

    handle.update({
      anchor: fakeAnchor({ x: 100, y: 100, width: 100, height: 30 }),
      placement: "bottom",
    });

    // x = 100 + (100 − 200) / 2 = 50 ; y = 100 + 30 + 6 = 136
    expect(layer.style["left"]).toBe("50px");
    expect(layer.style["top"]).toBe("136px");
    handle.destroy();
  });
});

describe("floatingLayer — staying in place", () => {
  it("re-places the layer when the window is resized", () => {
    const browser = installBrowser({ width: 1000, height: 800 });
    const layer = fakeLayer({ width: 214, height: 180 });
    const handle = floatingLayer(layer as unknown as HTMLElement, {
      point: { x: 700, y: 200 },
      placement: "bottom-start",
      offset: 0,
    });
    expect(layer.style["left"]).toBe("700px");

    // The window shrinks: 700 + 214 no longer fits in 800 − 8, so the menu turns around.
    browser.win.innerWidth = 800;
    for (const l of browser.windowListeners.filter((x) => x.type === "resize")) l.handler();

    expect(layer.style["left"]).toBe("486px"); // 700 − 214
    handle.destroy();
  });

  it("re-places the layer when its own size changes (a longer tooltip, an expanded one)", () => {
    const browser = installBrowser({ width: 1000, height: 800 });
    let size = { width: 200, height: 100 };
    const layer = {
      ...fakeLayer(),
      getBoundingClientRect: () => ({ x: 0, y: 0, ...size }),
    };
    const handle = floatingLayer(layer as unknown as HTMLElement, {
      anchor: fakeAnchor({ x: 400, y: 300, width: 100, height: 30 }),
      placement: "bottom",
    });
    expect(layer.style["left"]).toBe("350px");

    size = { width: 400, height: 100 };
    browser.observers[0]?.callback();

    // x = 400 + (100 − 400) / 2 = 250
    expect(layer.style["left"]).toBe("250px");
    expect(browser.observers[0]?.observed).toEqual([layer]);
    handle.destroy();
  });

  it("listens for scrolling in the capture phase, so a scrolled ancestor of the anchor is noticed", () => {
    const browser = installBrowser();
    const handle = floatingLayer(fakeLayer() as unknown as HTMLElement, {
      anchor: fakeAnchor({ x: 400, y: 300, width: 100, height: 30 }),
    });

    const scroll = browser.windowListeners.find((l) => l.type === "scroll");
    expect(scroll?.capture).toBe(true);
    handle.destroy();
  });

  it("destroy stops observing, stops listening, and takes the layer out of the page", () => {
    const browser = installBrowser();
    const layer = fakeLayer();
    const handle = floatingLayer(layer as unknown as HTMLElement, {
      anchor: fakeAnchor({ x: 400, y: 300, width: 100, height: 30 }),
    });
    expect(browser.windowListeners.length).toBeGreaterThan(0);

    handle.destroy();

    expect(browser.windowListeners).toHaveLength(0);
    expect(browser.observers[0]?.disconnected).toBe(true);
    expect(layer.remove).toHaveBeenCalled();
  });
});
