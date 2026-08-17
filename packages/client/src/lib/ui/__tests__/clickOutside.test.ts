/**
 * clickOutside.test.ts — task A021 (docs/design/gaveta-lateral/tasks-ajustes-r1.md).
 *
 * No jsdom in this project's Vitest (`environment: "node"`, `packages/client/vitest.config.ts`),
 * so there is no real DOM to dispatch a `pointerdown` against. This file proves the action's
 * behaviour two ways instead:
 *
 *   1. `isOutsideTarget` — the pure decision the action makes — against a minimal fake node
 *      that only implements `Node.contains`, plus the null/non-Node edge cases.
 *   2. the action itself (`clickOutside`) against a fake `document` double that records the
 *      registered `pointerdown` listener so the test can invoke it directly, proving: outside
 *      clicks fire the callback, inside clicks do not, `update()` swaps the live callback, and
 *      `destroy()` removes the exact listener that was added (capture phase, `true`).
 *
 * Closest requirement in spec 38: REQ-ACH-015 defines the "⋯" menu's contract (favourites
 * editor for every role, GM-only export/clear) but does not itself specify outside-click
 * behaviour — no REQ in specs/38-aba-chat.md names it. Cited for context, not as a literal
 * coverage claim; see openQuestions in the task report.
 */

import { describe, expect, it, vi } from "vitest";

import { clickOutside, isOutsideTarget } from "../clickOutside.js";

// ---- isOutsideTarget: the pure decision, against a fake Node ----

class FakeNode {
  private readonly descendants: Set<object>;

  constructor(descendants: object[] = []) {
    this.descendants = new Set(descendants);
  }

  contains(other: unknown): boolean {
    return other === this || (other !== null && this.descendants.has(other as object));
  }
}

describe("isOutsideTarget", () => {
  it("is true when the target is null (event fired against a detached node)", () => {
    const node = new FakeNode();
    expect(isOutsideTarget(node, null)).toBe(true);
  });

  it("is false when the target is the node itself (a click on the anchor)", () => {
    const node = new FakeNode();
    expect(isOutsideTarget(node, node as unknown as EventTarget)).toBe(false);
  });

  it("is false when the target is a descendant of the node (a click on a menu item)", () => {
    const menuItem = {};
    const node = new FakeNode([menuItem]);
    expect(isOutsideTarget(node, menuItem as unknown as EventTarget)).toBe(false);
  });

  it("is true when the target is unrelated to the node (a click elsewhere on the page)", () => {
    const node = new FakeNode();
    const elsewhere = {};
    expect(isOutsideTarget(node, elsewhere as unknown as EventTarget)).toBe(true);
  });
});

// ---- clickOutside action: fake `document` double ----

interface RegisteredListener {
  type: string;
  handler: EventListenerOrEventListenerObject;
  capture: boolean;
}

function fakeDocument(): {
  doc: Pick<Document, "addEventListener" | "removeEventListener">;
  listeners: RegisteredListener[];
} {
  const listeners: RegisteredListener[] = [];
  const doc = {
    addEventListener: (
      type: string,
      handler: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions,
    ): void => {
      listeners.push({ type, handler, capture: opts === true });
    },
    removeEventListener: (
      type: string,
      handler: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions,
    ): void => {
      const idx = listeners.findIndex(
        (l) => l.type === type && l.handler === handler && l.capture === (opts === true),
      );
      if (idx >= 0) listeners.splice(idx, 1);
    },
  };
  return { doc, listeners };
}

/** A fake HTMLElement stand-in with a real, checkable `contains()`. */
function fakeElement(): HTMLElement {
  const el = { contains: (other: unknown) => other === el } as unknown as HTMLElement;
  return el;
}

function fireHandler(listeners: RegisteredListener[], target: unknown): void {
  const listener = listeners.find((l) => l.type === "pointerdown");
  expect(listener).toBeDefined();
  const handler = listener!.handler as (event: { target: unknown }) => void;
  handler({ target });
}

describe("clickOutside action", () => {
  it("registers a single capture-phase pointerdown listener on document", () => {
    const { doc, listeners } = fakeDocument();
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    try {
      const node = fakeElement();
      const handle = clickOutside(node, () => undefined);
      expect(listeners).toHaveLength(1);
      expect(listeners[0]!.type).toBe("pointerdown");
      expect(listeners[0]!.capture).toBe(true);
      handle.destroy();
    } finally {
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("invokes the callback when the event target is outside the node", () => {
    const { doc, listeners } = fakeDocument();
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    try {
      const node = fakeElement();
      const outsideEl = fakeElement();
      const callback = vi.fn();
      const handle = clickOutside(node, callback);

      fireHandler(listeners, outsideEl);
      expect(callback).toHaveBeenCalledTimes(1);

      handle.destroy();
    } finally {
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("does NOT invoke the callback when the event target is inside the node (e.g. a menu item click)", () => {
    const { doc, listeners } = fakeDocument();
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    try {
      const node = fakeElement();
      const callback = vi.fn();
      const handle = clickOutside(node, callback);

      fireHandler(listeners, node); // the target IS the node itself
      expect(callback).not.toHaveBeenCalled();

      handle.destroy();
    } finally {
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("update() swaps the live callback without re-registering the listener", () => {
    const { doc, listeners } = fakeDocument();
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    try {
      const node = fakeElement();
      const outsideEl = fakeElement();
      const first = vi.fn();
      const second = vi.fn();
      const handle = clickOutside(node, first);

      handle.update(second);
      expect(listeners).toHaveLength(1); // no new listener added

      fireHandler(listeners, outsideEl);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);

      handle.destroy();
    } finally {
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("destroy() removes exactly the listener it added, leaving nothing registered", () => {
    const { doc, listeners } = fakeDocument();
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    try {
      const node = fakeElement();
      const handle = clickOutside(node, () => undefined);
      expect(listeners).toHaveLength(1);

      handle.destroy();
      expect(listeners).toHaveLength(0);
    } finally {
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });
});
