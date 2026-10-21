/**
 * hoverIntent.test.ts — BAR-F1-03: when a tooltip appears and when it goes.
 *
 * The tooltip opens on hover and on keyboard focus after a delay, stays while the pointer
 * moves onto it (WCAG 1.4.13 "hoverable"), and goes away at once on Escape or on a press of
 * the trigger (WCAG 1.4.13 "dismissible"). Timing is the whole behavior, so it is driven here
 * with fake timers and checked against those rules — not against the implementation's own
 * numbers: each case states the delay it assumes and moves the clock by exactly that.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHoverIntent } from "../hoverIntent.js";

const OPEN = 300;
const CLOSE = 100;

function make(delays: { open?: number; close?: number } = {}) {
  const changes: boolean[] = [];
  const intent = createHoverIntent({
    openDelay: () => delays.open ?? OPEN,
    closeDelay: () => delays.close ?? CLOSE,
    onChange: (open) => changes.push(open),
  });
  return { intent, changes };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("opening", () => {
  it("opens after the delay of a hover, not before", () => {
    const { intent, changes } = make();

    intent.hoverIn();
    vi.advanceTimersByTime(OPEN - 1);
    expect(intent.open).toBe(false);

    vi.advanceTimersByTime(1);
    expect(intent.open).toBe(true);
    expect(changes).toEqual([true]);
  });

  it("opens after the delay of keyboard focus, too", () => {
    const { intent } = make();

    intent.focusIn();
    vi.advanceTimersByTime(OPEN - 1);
    expect(intent.open).toBe(false);

    vi.advanceTimersByTime(1);
    expect(intent.open).toBe(true);
  });

  it("a pointer that leaves before the delay never opens it", () => {
    const { intent, changes } = make();

    intent.hoverIn();
    vi.advanceTimersByTime(OPEN - 50);
    intent.hoverOut();
    vi.advanceTimersByTime(OPEN * 2);

    expect(intent.open).toBe(false);
    expect(changes).toEqual([]);
  });

  it("a zero delay opens at once, with no timer", () => {
    const { intent } = make({ open: 0 });

    intent.hoverIn();

    expect(intent.open).toBe(true);
  });

  it("hover and focus together still open it once", () => {
    const { intent, changes } = make();

    intent.hoverIn();
    intent.focusIn();
    vi.advanceTimersByTime(OPEN * 3);

    expect(changes).toEqual([true]);
  });
});

describe("closing", () => {
  function opened() {
    const made = make();
    made.intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    made.changes.length = 0;
    return made;
  }

  it("closes after the close delay once the pointer has left", () => {
    const { intent, changes } = opened();

    intent.hoverOut();
    vi.advanceTimersByTime(CLOSE - 1);
    expect(intent.open).toBe(true);

    vi.advanceTimersByTime(1);
    expect(intent.open).toBe(false);
    expect(changes).toEqual([false]);
  });

  it("coming back within the close delay keeps it open, and nothing is announced", () => {
    const { intent, changes } = opened();

    intent.hoverOut();
    vi.advanceTimersByTime(CLOSE - 10);
    intent.hoverIn();
    vi.advanceTimersByTime(OPEN * 2);

    expect(intent.open).toBe(true);
    expect(changes).toEqual([]);
  });

  it("stays open while the keyboard focus is still on the trigger, even after the pointer left", () => {
    const made = make();
    made.intent.focusIn();
    made.intent.hoverIn();
    vi.advanceTimersByTime(OPEN);

    made.intent.hoverOut();
    vi.advanceTimersByTime(CLOSE * 5);
    expect(made.intent.open).toBe(true);

    made.intent.focusOut();
    vi.advanceTimersByTime(CLOSE);
    expect(made.intent.open).toBe(false);
  });

  it("blur closes the tooltip that keyboard focus opened", () => {
    const { intent } = make();
    intent.focusIn();
    vi.advanceTimersByTime(OPEN);
    expect(intent.open).toBe(true);

    intent.focusOut();
    vi.advanceTimersByTime(CLOSE);

    expect(intent.open).toBe(false);
  });

  it("a zero close delay closes at once", () => {
    const { intent } = make({ close: 0 });
    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);

    intent.hoverOut();

    expect(intent.open).toBe(false);
  });
});

describe("the tooltip itself is hoverable (WCAG 1.4.13)", () => {
  it("moving from the trigger onto the tooltip keeps it open", () => {
    const { intent } = make();
    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);

    intent.hoverOut();
    vi.advanceTimersByTime(CLOSE - 20);
    intent.layerIn();
    vi.advanceTimersByTime(CLOSE * 10);

    expect(intent.open).toBe(true);
  });

  it("leaving the tooltip for somewhere else closes it after the close delay", () => {
    const { intent } = make();
    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    intent.hoverOut();
    intent.layerIn();

    intent.layerOut();
    vi.advanceTimersByTime(CLOSE);

    expect(intent.open).toBe(false);
  });

  it("leaving the tooltip back onto the trigger keeps it open", () => {
    const { intent } = make();
    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    intent.hoverOut();
    intent.layerIn();

    intent.layerOut();
    intent.hoverIn();
    vi.advanceTimersByTime(CLOSE * 10);

    expect(intent.open).toBe(true);
  });
});

describe("dismissing (WCAG 1.4.13)", () => {
  function opened() {
    const made = make();
    made.intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    made.changes.length = 0;
    return made;
  }

  it("Escape closes it immediately, with no close delay", () => {
    const { intent, changes } = opened();

    intent.escape();

    expect(intent.open).toBe(false);
    expect(changes).toEqual([false]);
  });

  it("after Escape it stays closed while the pointer is still resting on the trigger", () => {
    const { intent } = opened();
    intent.escape();

    vi.advanceTimersByTime(OPEN * 5);

    expect(intent.open).toBe(false);
  });

  it("after Escape, another event from the same hover or focus does not bring it back", () => {
    // The pointer has not left, so whatever else arrives while it is still there — an enter
    // from a child of the trigger, the focus a later Tab gives it — is the same engagement.
    const { intent } = opened();
    intent.escape();

    intent.hoverIn();
    intent.focusIn();
    vi.advanceTimersByTime(OPEN * 5);

    expect(intent.open).toBe(false);
  });

  it("after Escape it comes back the next time the pointer enters the trigger", () => {
    const { intent } = opened();
    intent.escape();
    intent.hoverOut();
    vi.advanceTimersByTime(CLOSE);

    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);

    expect(intent.open).toBe(true);
  });

  it("after Escape on a focused trigger it stays closed until the focus leaves and returns", () => {
    const { intent } = make();
    intent.focusIn();
    vi.advanceTimersByTime(OPEN);
    intent.escape();
    vi.advanceTimersByTime(OPEN * 5);
    expect(intent.open).toBe(false);

    intent.focusOut();
    intent.focusIn();
    vi.advanceTimersByTime(OPEN);
    expect(intent.open).toBe(true);
  });

  it("pressing the trigger closes it at once, and a tooltip that was only pending never opens", () => {
    const { intent } = opened();
    intent.press();
    expect(intent.open).toBe(false);

    const pending = make();
    pending.intent.hoverIn();
    vi.advanceTimersByTime(OPEN - 10);
    pending.intent.press();
    vi.advanceTimersByTime(OPEN * 5);
    expect(pending.intent.open).toBe(false);
  });

  it("a press keeps it closed even when the click's own focus event follows", () => {
    // Pressing a button with the mouse focuses it right after the pointer-down.
    const { intent } = opened();
    intent.press();

    intent.focusIn();
    vi.advanceTimersByTime(OPEN * 5);

    expect(intent.open).toBe(false);
  });

  it("Escape with nothing open does nothing and announces nothing", () => {
    const { intent, changes } = make();

    intent.escape();

    expect(changes).toEqual([]);
  });
});

describe("the tooltip layer disappearing under the pointer (no ghost tooltip)", () => {
  // Found by the lane's verifier in Edge: when the tooltip is removed while the pointer is on
  // it, the browser never fires `pointerleave` for the removed element. A stale "the pointer
  // is on the tooltip" then holds the NEXT hover open for good, with nothing under the pointer.

  it("after Escape with the pointer on the tooltip, a later hover and leave closes it for good", () => {
    const { intent } = make();
    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    intent.hoverOut();
    intent.layerIn(); // the pointer crossed onto the tooltip
    intent.escape(); // the tooltip is gone, and no layerOut will ever come

    intent.hoverIn();
    intent.hoverOut();
    vi.advanceTimersByTime(5000);

    expect(intent.open).toBe(false);
  });

  it("the same when the owner closes it from outside (sync) with the pointer on it", () => {
    const { intent } = make();
    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    intent.hoverOut();
    intent.layerIn();
    intent.sync(false);

    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    intent.hoverOut();
    vi.advanceTimersByTime(5000);

    expect(intent.open).toBe(false);
  });

  it("the same after a press of the trigger", () => {
    const { intent } = make();
    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    intent.layerIn();
    intent.press();

    intent.hoverIn();
    intent.hoverOut();
    vi.advanceTimersByTime(5000);

    expect(intent.open).toBe(false);
  });

  it("after Escape with the pointer only on the tooltip, the FIRST pass over the trigger opens it again", () => {
    // Found by the verifier in Edge: Escape recorded "refuse to reopen" even though nothing was
    // engaged (the pointer had left the trigger for the tooltip), and that mark only fell on a
    // hover-out that never came. The next pass over the trigger was refused; only the one after
    // it worked.
    const { intent } = make();
    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    intent.hoverOut();
    intent.layerIn(); // onto the tooltip: the trigger is no longer hovered
    intent.escape();

    intent.hoverIn(); // the pointer passes over the trigger
    vi.advanceTimersByTime(OPEN);

    expect(intent.open).toBe(true);
  });

  it("a press with nothing engaged (a touch, which never hovers) does not refuse the next hover", () => {
    const { intent } = make();
    intent.press();

    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);

    expect(intent.open).toBe(true);
  });

  it("Escape still refuses while the trigger IS hovered or focused (the rule the ghost fix must not break)", () => {
    const hovered = make();
    hovered.intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    hovered.intent.escape();
    hovered.intent.hoverIn();
    vi.advanceTimersByTime(OPEN * 5);
    expect(hovered.intent.open).toBe(false);

    const focused = make();
    focused.intent.focusIn();
    vi.advanceTimersByTime(OPEN);
    focused.intent.escape();
    focused.intent.focusIn();
    vi.advanceTimersByTime(OPEN * 5);
    expect(focused.intent.open).toBe(false);
  });

  it("closing by its own timer still lets the pointer-on-tooltip state go, so it can open again", () => {
    const { intent } = make();
    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    intent.hoverOut();
    intent.layerIn();
    intent.layerOut();
    vi.advanceTimersByTime(CLOSE);
    expect(intent.open).toBe(false);

    intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    expect(intent.open).toBe(true);
  });
});

describe("keeping in step with its owner", () => {
  it("sync adopts an open state set from outside, without announcing it back", () => {
    const { intent, changes } = make();

    intent.sync(true);
    expect(intent.open).toBe(true);
    expect(changes).toEqual([]);

    intent.sync(false);
    expect(intent.open).toBe(false);
    expect(changes).toEqual([]);
  });

  it("reset forgets everything: a pending open never fires and an open tooltip closes", () => {
    const pending = make();
    pending.intent.hoverIn();
    pending.intent.reset();
    vi.advanceTimersByTime(OPEN * 5);
    expect(pending.intent.open).toBe(false);

    const open = make();
    open.intent.hoverIn();
    vi.advanceTimersByTime(OPEN);
    open.changes.length = 0;
    open.intent.reset();
    expect(open.intent.open).toBe(false);
    expect(open.changes).toEqual([false]);
  });

  it("reads the delays at the moment they matter, so a changed prop takes effect", () => {
    let delay = 300;
    const intent = createHoverIntent({
      openDelay: () => delay,
      closeDelay: () => 0,
      onChange: () => undefined,
    });

    delay = 50;
    intent.hoverIn();
    vi.advanceTimersByTime(50);

    expect(intent.open).toBe(true);
  });
});
