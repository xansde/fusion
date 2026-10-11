/**
 * triggerWiring.test.ts — BAR-F1-03: how a trigger element is wired to a tooltip or a popover.
 *
 * `Tooltip.svelte` and `Popover.svelte` only call these. What they do — which DOM events reach
 * the tooltip's timing machine, when Escape is consumed and when it is left alone, what the
 * trigger's aria says — is decided here, over minimal doubles, because the client's Vitest has
 * no DOM (docs/design/barra-de-acoes/tasks.md §2.10). The doubles honour the details a real
 * browser enforces: a listener added with `capture` is only removed by a call that says capture.
 */

import { describe, expect, it, vi } from "vitest";

import { pushLayer, releaseLayer } from "../dismissableLayer.js";
import {
  bindTooltipEscape,
  bindTooltipTrigger,
  describeTrigger,
  isKeyboardFocus,
  markPopoverTrigger,
  tooltipEscape,
} from "../triggerWiring.js";

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

interface Registered {
  type: string;
  handler: (event: unknown) => void;
  capture: boolean;
}

function captureOf(options: unknown): boolean {
  if (typeof options === "object" && options !== null) {
    return (options as { capture?: boolean }).capture === true;
  }
  return options === true;
}

/** Something that takes listeners, like an element or the document. */
function fakeSource() {
  const listeners: Registered[] = [];
  return {
    listeners,
    addEventListener: (type: string, handler: (event: unknown) => void, options?: unknown) => {
      listeners.push({ type, handler, capture: captureOf(options) });
    },
    removeEventListener: (type: string, handler: (event: unknown) => void, options?: unknown) => {
      const i = listeners.findIndex(
        (l) => l.type === type && l.handler === handler && l.capture === captureOf(options),
      );
      if (i >= 0) listeners.splice(i, 1);
    },
    /** Deliver an event to every listener of this type, as the browser would. */
    fire(type: string, event: Record<string, unknown> = {}) {
      for (const l of [...listeners]) if (l.type === type) l.handler(event);
    },
  };
}

/** The timing machine, reduced to a log of what was asked of it. */
function fakeIntent() {
  const calls: string[] = [];
  const note = (name: string) => () => {
    calls.push(name);
  };
  return {
    calls,
    hoverIn: note("hoverIn"),
    hoverOut: note("hoverOut"),
    focusIn: note("focusIn"),
    focusOut: note("focusOut"),
    press: note("press"),
    escape: note("escape"),
    reset: note("reset"),
  };
}

/** An element's attributes, and nothing else. */
function fakeAttributes(initial: Record<string, string> = {}) {
  const attributes = new Map(Object.entries(initial));
  return {
    attributes,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
    },
  };
}

function keyEvent(extra: Record<string, unknown> = {}) {
  return {
    key: "Escape",
    target: null as unknown,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// isKeyboardFocus
// ---------------------------------------------------------------------------

describe("isKeyboardFocus — keyboard focus opens a tooltip, the focus a mouse click leaves does not", () => {
  it("asks the element whether it matches :focus-visible, and believes it", () => {
    const matches = vi.fn((selector: string) => selector === ":focus-visible");

    expect(isKeyboardFocus({ matches })).toBe(true);
    expect(matches).toHaveBeenCalledWith(":focus-visible");
    expect(isKeyboardFocus({ matches: () => false })).toBe(false);
  });

  it("opens when it cannot tell: no matches(), a browser that throws for the selector, no target", () => {
    expect(isKeyboardFocus({})).toBe(true);
    expect(isKeyboardFocus(null)).toBe(true);
    expect(
      isKeyboardFocus({
        matches: () => {
          throw new SyntaxError("not a valid selector");
        },
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bindTooltipTrigger
// ---------------------------------------------------------------------------

describe("bindTooltipTrigger — which events reach the tooltip's timing", () => {
  function bound(focusVisible?: (target: unknown) => boolean) {
    const trigger = fakeSource();
    const intent = fakeIntent();
    const unbind = bindTooltipTrigger(trigger as unknown as HTMLElement, intent, focusVisible);
    return { trigger, intent, unbind };
  }

  it("listens for hover, focus and press on the trigger", () => {
    const { trigger } = bound();

    expect(trigger.listeners.map((l) => l.type).sort()).toEqual([
      "focusin",
      "focusout",
      "pointerdown",
      "pointerenter",
      "pointerleave",
    ]);
  });

  it("a mouse or pen entering is a hover; leaving ends it", () => {
    const { trigger, intent } = bound();

    trigger.fire("pointerenter", { pointerType: "mouse" });
    trigger.fire("pointerenter", { pointerType: "pen" });
    trigger.fire("pointerleave");

    expect(intent.calls).toEqual(["hoverIn", "hoverIn", "hoverOut"]);
  });

  it("a touch is not a hover: there is no hovering on a touch screen", () => {
    const { trigger, intent } = bound();

    trigger.fire("pointerenter", { pointerType: "touch" });

    expect(intent.calls).toEqual([]);
  });

  it("keyboard focus is a focus; losing it ends it", () => {
    const { trigger, intent } = bound(() => true);

    trigger.fire("focusin", { target: {} });
    trigger.fire("focusout");

    expect(intent.calls).toEqual(["focusIn", "focusOut"]);
  });

  it("the focus a mouse click leaves on a button does not open the tooltip", () => {
    const { trigger, intent } = bound(() => false);

    trigger.fire("focusin", { target: {} });

    expect(intent.calls).toEqual([]);
  });

  it("decides keyboard-versus-mouse focus on the element that took it, with :focus-visible by default", () => {
    const { trigger, intent } = bound();

    trigger.fire("focusin", { target: { matches: () => false } }); // a click
    trigger.fire("focusin", { target: { matches: () => true } }); // a Tab

    expect(intent.calls).toEqual(["focusIn"]);
  });

  it("a press of the trigger is reported, so the tooltip gets out of the way of the click", () => {
    const { trigger, intent } = bound();

    trigger.fire("pointerdown");

    expect(intent.calls).toEqual(["press"]);
  });

  it("unbinding takes every listener off and resets the timing machine", () => {
    const { trigger, intent, unbind } = bound();

    unbind();

    expect(trigger.listeners).toHaveLength(0);
    expect(intent.calls).toEqual(["reset"]);
  });
});

// ---------------------------------------------------------------------------
// tooltipEscape — whose Escape is it?
// ---------------------------------------------------------------------------

describe("tooltipEscape — a tooltip takes the Escape aimed at its trigger and leaves the rest", () => {
  const anchor = { contains: (other: unknown) => other === "the-trigger" || other === "inside-it" };

  it("an Escape pressed with the focus on the trigger is the tooltip's: it closes and the key stops there", () => {
    // Otherwise the same Escape would also close the window the trigger sits in.
    expect(tooltipEscape({ target: "the-trigger", anchor, anotherLayerOpen: false })).toBe(
      "dismiss-and-consume",
    );
    expect(tooltipEscape({ target: "inside-it", anchor, anotherLayerOpen: false })).toBe(
      "dismiss-and-consume",
    );
  });

  it("an Escape aimed elsewhere closes the tooltip quietly and goes on to whoever it was for", () => {
    // A search field to clear, a token to deselect: a tooltip that is merely under the mouse
    // must not eat the key.
    expect(tooltipEscape({ target: "a-search-field", anchor, anotherLayerOpen: false })).toBe(
      "dismiss",
    );
    expect(tooltipEscape({ target: null, anchor, anotherLayerOpen: false })).toBe("dismiss");
    expect(tooltipEscape({ target: "the-trigger", anchor: null, anotherLayerOpen: false })).toBe(
      "dismiss",
    );
  });

  it("with a menu or popover open, the Escape is theirs: the tooltip does nothing, even on its own trigger", () => {
    expect(tooltipEscape({ target: "the-trigger", anchor, anotherLayerOpen: true })).toBe("ignore");
    expect(tooltipEscape({ target: "a-search-field", anchor, anotherLayerOpen: true })).toBe(
      "ignore",
    );
  });
});

// ---------------------------------------------------------------------------
// bindTooltipEscape
// ---------------------------------------------------------------------------

describe("bindTooltipEscape — Escape dismisses a showing tooltip", () => {
  const trigger = { contains: (other: unknown) => other === trigger };

  function bound(anchor: typeof trigger | null = trigger) {
    const doc = fakeSource();
    const intent = fakeIntent();
    const unbind = bindTooltipEscape(doc as unknown as Document, intent, () => anchor);
    return { doc, intent, unbind };
  }

  it("listens on the document in the capture phase, so it runs before the window's own handlers", () => {
    const { doc } = bound();

    expect(doc.listeners).toHaveLength(1);
    expect(doc.listeners[0]).toMatchObject({ type: "keydown", capture: true });
  });

  it("Escape on the trigger dismisses the tooltip and is consumed", () => {
    const { doc, intent } = bound();
    const escape = keyEvent({ target: trigger });

    doc.fire("keydown", escape);

    expect(intent.calls).toEqual(["escape"]);
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(escape.stopPropagation).toHaveBeenCalled();
  });

  it("Escape somewhere else dismisses it but is NOT consumed", () => {
    const { doc, intent } = bound();
    const escape = keyEvent({ target: { somewhere: "else" } });

    doc.fire("keydown", escape);

    expect(intent.calls).toEqual(["escape"]);
    expect(escape.preventDefault).not.toHaveBeenCalled();
    expect(escape.stopPropagation).not.toHaveBeenCalled();
  });

  it("with another layer open it does nothing at all: one Escape closes one thing", () => {
    const { doc, intent } = bound();
    const layer = pushLayer();
    const escape = keyEvent({ target: trigger });

    doc.fire("keydown", escape);

    expect(intent.calls).toEqual([]);
    expect(escape.stopPropagation).not.toHaveBeenCalled();
    releaseLayer(layer);
  });

  it("ignores every other key, and an Escape that is cancelling an IME composition", () => {
    const { doc, intent } = bound();

    doc.fire("keydown", keyEvent({ key: "Enter", target: trigger }));
    doc.fire("keydown", keyEvent({ isComposing: true, target: trigger }));

    expect(intent.calls).toEqual([]);
  });

  it("looks the trigger up when the key arrives, so a trigger that changed is the one that counts", () => {
    const doc = fakeSource();
    const intent = fakeIntent();
    let current: typeof trigger | null = null;
    bindTooltipEscape(doc as unknown as Document, intent, () => current);
    const escape = keyEvent({ target: trigger });

    doc.fire("keydown", escape); // no trigger yet: not consumed
    expect(escape.stopPropagation).not.toHaveBeenCalled();

    current = trigger;
    doc.fire("keydown", escape); // now it is the trigger's Escape
    expect(escape.stopPropagation).toHaveBeenCalled();
  });

  it("unbinding takes the capture listener off (a plain removal would leave it behind)", () => {
    const { doc, unbind } = bound();

    unbind();

    expect(doc.listeners).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// describeTrigger
// ---------------------------------------------------------------------------

describe("describeTrigger — while the tooltip shows, it describes its trigger", () => {
  it("sets aria-describedby to the tooltip's id", () => {
    const trigger = fakeAttributes();

    describeTrigger(trigger as unknown as HTMLElement, "tip-1");

    expect(trigger.getAttribute("aria-describedby")).toBe("tip-1");
  });

  it("adds to what the trigger already says about itself, and puts it back when done", () => {
    const trigger = fakeAttributes({ "aria-describedby": "help-text" });

    const undo = describeTrigger(trigger as unknown as HTMLElement, "tip-1");
    expect(trigger.getAttribute("aria-describedby")).toBe("help-text tip-1");

    undo();
    expect(trigger.getAttribute("aria-describedby")).toBe("help-text");
  });

  it("leaves no attribute behind when it was the only description", () => {
    const trigger = fakeAttributes();

    const undo = describeTrigger(trigger as unknown as HTMLElement, "tip-1");
    undo();

    expect(trigger.attributes.has("aria-describedby")).toBe(false);
  });

  it("removes only its own id, even if something else added one in the meantime", () => {
    const trigger = fakeAttributes();
    const undo = describeTrigger(trigger as unknown as HTMLElement, "tip-1");
    trigger.setAttribute("aria-describedby", "tip-1 added-later");

    undo();

    expect(trigger.getAttribute("aria-describedby")).toBe("added-later");
  });
});

// ---------------------------------------------------------------------------
// markPopoverTrigger
// ---------------------------------------------------------------------------

describe("markPopoverTrigger — what the popover's trigger tells assistive technology", () => {
  it("open: it has a popup (a dialog), it is expanded, and it controls the popover", () => {
    const trigger = fakeAttributes();

    markPopoverTrigger(trigger as unknown as HTMLElement, { open: true, controls: "pop-1" });

    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe("pop-1");
  });

  it("closed: still has a popup, is not expanded, and controls nothing (there is nothing to point at)", () => {
    const trigger = fakeAttributes();

    markPopoverTrigger(trigger as unknown as HTMLElement, { open: false, controls: "pop-1" });

    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.attributes.has("aria-controls")).toBe(false);
  });

  it("undoing it leaves the trigger as it was", () => {
    const trigger = fakeAttributes();

    const undo = markPopoverTrigger(trigger as unknown as HTMLElement, {
      open: true,
      controls: "pop-1",
    });
    undo();

    expect(trigger.attributes.size).toBe(0);
  });
});
