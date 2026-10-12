/**
 * dismissableLayer.ts — how a popover or a context menu goes away, and where the focus goes
 * when it does (BAR-F1-03; spec 53 REQ-BAR-043, spec 23 REQ-A11-005/-007).
 *
 * The rules, in one place so the popover and the menu cannot drift apart:
 *
 *  - **Escape closes the topmost layer only**, and consumes the key. It is caught on
 *    `document` in the capture phase because the app has two other listeners that would
 *    otherwise act on the same key: `Window.svelte` closes the whole window on any Escape
 *    that reaches it, and the token manager drops the selection (it respects
 *    `defaultPrevented`, the window does not). Consuming it first means one Escape closes one
 *    thing — the thing on top.
 *  - **A click outside closes it** (reusing `clickOutside.ts`, the helper the chat menu's
 *    "doesn't close on outside click" bug produced). "Outside" is wider than "outside the
 *    node": the trigger may be exempt (a popover's own button toggles it), and a click inside
 *    another floating layer — one opened from this one — is not outside.
 *  - **Focus returns to the trigger** after Escape, Tab and a chosen item — or, if a re-render
 *    removed the trigger meanwhile, to whatever had the focus before the layer opened — but NOT
 *    after a click elsewhere: that click already put the focus where the user pointed.
 *  - **Tab never traps.** A menu closes on Tab; a popover lets Tab walk its content and
 *    closes when Tab would step out of it. Layers are portaled to the end of `<body>`, so a
 *    Tab that left them would land in the browser's own chrome instead of back in the app.
 *  - **An open layer owns the keyboard** (`layerOwnsKey`): no key but Tab goes on to the rest
 *    of the app, whose canvas would otherwise move, delete or duplicate the selected token on
 *    the arrow keys, Delete and D.
 *
 * Everything that is a *decision* is an exported pure function over plain objects, tested
 * without a DOM (docs/design/barra-de-acoes/tasks.md §2.10). The action at the bottom only
 * wires those decisions to `document`.
 */

import { clickOutside } from "./clickOutside.js";

/** Why a layer is being closed. `select` is raised by the menu itself, never by the action. */
export type DismissReason = "escape" | "outside" | "tab" | "select";

/** Marks the root of a floating layer so a layer can recognise a click inside another one. */
export const FLOATING_LAYER_ATTR = "data-fusion-layer";

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

/** Escape — except while an IME is composing, where Escape cancels the composition instead. */
export function isEscapeKey(event: {
  key?: string | undefined;
  isComposing?: boolean | undefined;
}): boolean {
  return event.key === "Escape" && event.isComposing !== true;
}

/** Whether the focus goes back to the trigger. It does not after a click elsewhere. */
export function shouldRestoreFocus(reason: DismissReason): boolean {
  return reason !== "outside";
}

/** True when `target` lives inside some floating layer (any popover or menu). */
export function isInsideFloatingLayer(target: unknown): boolean {
  if (target === null || typeof target !== "object") return false;
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== "function") return false;
  return (
    (closest as (selector: string) => unknown).call(target, `[${FLOATING_LAYER_ATTR}]`) != null
  );
}

/**
 * Given a pointer-down that already landed outside the layer's own box (that part is
 * `clickOutside`'s job), does it dismiss the layer? Not if it hit the trigger and the
 * trigger is exempt, and not if it hit another floating layer.
 */
export function pointerDownDismisses(input: {
  target: unknown;
  anchor: { contains(other: Node | null): boolean } | null | undefined;
  exemptAnchor: boolean;
}): boolean {
  if (input.target === null) return true;
  if (input.exemptAnchor && input.anchor != null && input.anchor.contains(input.target as Node)) {
    return false;
  }
  if (isInsideFloatingLayer(input.target)) return false;
  return true;
}

/**
 * Whether a Tab keypress would step out of a popover. `index` is the position of the focused
 * element among the layer's tabbable elements, or -1 when the focus is on the container
 * itself; `count` is how many tabbable elements there are.
 */
export function tabExitsLayer(input: { shiftKey: boolean; index: number; count: number }): boolean {
  if (input.count === 0) return true;
  if (input.shiftKey) return input.index <= 0;
  return input.index === input.count - 1;
}

/**
 * Adds or removes one id in an `aria-describedby`/`aria-controls` style token list without
 * disturbing the others — the trigger may already be described by something else. Returns
 * null when no token is left, so the caller removes the attribute.
 */
export function mergeDescribedBy(
  existing: string | null | undefined,
  id: string,
  present: boolean,
): string | null {
  const tokens = (existing ?? "").split(/\s+/).filter((token) => token !== "");
  const has = tokens.includes(id);
  if (present && !has) tokens.push(id);
  if (!present && has) tokens.splice(tokens.indexOf(id), 1);
  return tokens.length === 0 ? null : tokens.join(" ");
}

interface FocusableLike {
  focus(options?: FocusOptions): void;
  isConnected?: boolean | undefined;
}

/** Whether `target` is where the focus is now. With no document to ask, the request is trusted. */
function holdsFocus(target: unknown): boolean {
  const doc = (globalThis as { document?: { activeElement?: unknown } }).document;
  return doc === undefined || doc.activeElement === target;
}

/**
 * Puts the focus back on `target` without scrolling; false if it did not land there. `focus()`
 * is only a request — an element that is hidden or disabled ignores it and the focus stays where
 * it was — so what counts is where the focus really is afterwards, and the caller can then offer
 * it to the next place instead of leaving it on `<body>`.
 */
export function returnFocus(target: FocusableLike | null | undefined): boolean {
  if (target == null || target.isConnected === false) return false;
  target.focus({ preventScroll: true });
  return holdsFocus(target);
}

/**
 * Puts the focus on the first candidate that can take it. The trigger first, then whatever
 * had the focus before the layer opened: a re-render may have replaced the trigger while the
 * layer was open, and the focus must not be dropped on `<body>` for that.
 */
export function returnFocusTo(
  ...candidates: ReadonlyArray<FocusableLike | null | undefined>
): boolean {
  return candidates.some((candidate) => returnFocus(candidate));
}

/**
 * An open layer owns the keyboard: no key but Tab goes on to the rest of the app. The canvas
 * listens on `window` and moves the selected token on the arrow keys, deletes it on Delete and
 * duplicates it on D; none of that may react to a key pressed inside a popover or a menu. Tab is
 * let through so the browser can carry the focus on from the trigger once the layer closes; a
 * key pressed during IME composition belongs to the IME.
 */
export function layerOwnsKey(event: { key: string; isComposing?: boolean | undefined }): boolean {
  return event.key !== "Tab" && event.isComposing !== true;
}

/**
 * The keydown handler of a popover's root element: keeps the layer's keys from the rest of the
 * app (`layerOwnsKey` has the rule). Kept as a function, not written inline in the template, so
 * its polarity — stop the keys that are the layer's, not the ones that are not — is proven by a
 * test and not by a search for its name.
 */
export function keepLayerKeysFromApp(event: {
  key: string;
  isComposing?: boolean | undefined;
  stopPropagation(): void;
}): void {
  if (layerOwnsKey(event)) event.stopPropagation();
}

/**
 * What a popover or menu does when its layer says "close me": it closes, then says why. The
 * listener is asked for at the moment it is needed, so a callback changed after mount is the
 * one that runs.
 */
export function createDismissHandler(owner: {
  setOpen(open: boolean): void;
  onclose(): ((reason: DismissReason) => void) | undefined;
}): (reason: DismissReason) => void {
  return (reason) => {
    owner.setOpen(false);
    owner.onclose()?.(reason);
  };
}

let nextId = 0;

/** A fresh element id for `aria-describedby`/`aria-controls`/`aria-labelledby`. */
export function nextLayerId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${String(nextId)}`;
}

// ---------------------------------------------------------------------------
// The stack of open layers
// ---------------------------------------------------------------------------

export interface LayerToken {
  readonly order: number;
}

const stack: LayerToken[] = [];
let nextOrder = 0;

/** Registers a newly opened layer; it is on top until another one opens. */
export function pushLayer(): LayerToken {
  nextOrder += 1;
  const token: LayerToken = { order: nextOrder };
  stack.push(token);
  return token;
}

/** Takes a layer off the stack. Safe to call twice, and in any order. */
export function releaseLayer(token: LayerToken): void {
  const index = stack.indexOf(token);
  if (index >= 0) stack.splice(index, 1);
}

export function isTopLayer(token: LayerToken): boolean {
  return stack[stack.length - 1] === token;
}

/** Whether any popover or menu is open — a tooltip leaves Escape to them. */
export function isAnyLayerOpen(): boolean {
  return stack.length > 0;
}

// ---------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------

export interface DismissableLayerOptions {
  /** Called when the layer should close. The owner flips its own `open` state. */
  onDismiss: (reason: DismissReason) => void;
  /** The trigger. Focus returns here; with `exemptAnchor`, clicks on it never dismiss. */
  anchor?: HTMLElement | null | undefined;
  /** A popover's trigger toggles the popover, so a click on it must not also dismiss it. */
  exemptAnchor?: boolean | undefined;
  /** Hand the focus back on Escape/Tab. Default true; a caller that routes focus itself says false. */
  restoreFocus?: boolean | undefined;
  /** Where the focus goes on open: the first tabbable element, the container, or nowhere. */
  initialFocus?: "first" | "container" | "none" | undefined;
  /** Tab inside: always close (a menu) or close only when it would leave (a popover). */
  tab?: "close" | "close-at-edges" | undefined;
}

export interface DismissableLayerAction {
  update(options: DismissableLayerOptions): void;
  destroy(): void;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
].join(",");

/**
 * The elements Tab can land on, in order. "Focusable" is not "tabbable": a `<button
 * tabindex="-1">` — the inactive items of a menu — can take focus from a script but Tab
 * walks past it, and the DOM already knows (`tabIndex` is -1). Asking it is more reliable than
 * encoding the rule in a selector, which is what a first version did and got wrong.
 */
function tabbablesOf(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const tabIndex = (element as { tabIndex?: number }).tabIndex;
    return tabIndex === undefined || tabIndex >= 0;
  });
}

/**
 * Svelte action: `use:dismissableLayer={{ onDismiss, anchor }}` on the root element of a
 * popover or menu. The element must carry `tabindex="-1"` for `initialFocus: "container"`.
 */
export function dismissableLayer(
  node: HTMLElement,
  initial: DismissableLayerOptions,
): DismissableLayerAction {
  let options = initial;
  let destroyed = false;
  const token = pushLayer();
  // Where the focus was before the layer opened: the fallback target when there is no trigger.
  const previouslyFocused = document.activeElement as FocusableLike | null;

  function dismiss(reason: DismissReason): void {
    if (options.restoreFocus !== false && shouldRestoreFocus(reason)) {
      returnFocusTo(options.anchor, previouslyFocused);
    }
    options.onDismiss(reason);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (destroyed || !isTopLayer(token)) return;

    if (isEscapeKey(event)) {
      // Consumed, so the window under the layer does not also close and the canvas does not
      // also drop the token selection.
      event.preventDefault();
      event.stopPropagation();
      dismiss("escape");
      return;
    }

    if (event.key === "Tab" && node.contains(event.target as Node | null)) {
      if ((options.tab ?? "close-at-edges") === "close") {
        dismiss("tab");
        return;
      }
      const tabbables = tabbablesOf(node);
      const index = tabbables.indexOf(event.target as HTMLElement);
      if (tabExitsLayer({ shiftKey: event.shiftKey, index, count: tabbables.length })) {
        dismiss("tab");
      }
    }
  }

  document.addEventListener("keydown", onKeyDown, true);

  const outside = clickOutside(node, (event) => {
    if (destroyed) return;
    if (
      pointerDownDismisses({
        target: event.target,
        anchor: options.anchor,
        exemptAnchor: options.exemptAnchor === true,
      })
    ) {
      dismiss("outside");
    }
  });

  // After the current task: the layer's own portal action has to have moved the node first,
  // because moving a focused element in the DOM drops its focus.
  queueMicrotask(() => {
    if (destroyed) return;
    const mode = options.initialFocus ?? "container";
    if (mode === "none") return;
    if (mode === "first") {
      const first = tabbablesOf(node)[0];
      if (first !== undefined) {
        returnFocus(first);
        return;
      }
    }
    returnFocus(node);
  });

  return {
    update(next: DismissableLayerOptions): void {
      options = next;
    },
    destroy(): void {
      destroyed = true;
      releaseLayer(token);
      document.removeEventListener("keydown", onKeyDown, true);
      outside.destroy();
    },
  };
}

// ---------------------------------------------------------------------------
// What each kind of layer asks of the action
// ---------------------------------------------------------------------------

export interface LayerPresetInput {
  /** Called when the layer should close. */
  onDismiss: (reason: DismissReason) => void;
  /** The trigger; null until there is one. */
  anchor: HTMLElement | null | undefined;
  /** Hand the focus back to the trigger. Pass the component's own prop through. */
  restoreFocus: boolean | undefined;
}

/**
 * A popover: its trigger toggles it, so a click on the trigger is not "outside"; the focus
 * goes to the first thing inside; Tab walks the content and closes it only at the edges.
 */
export function popoverLayerOptions(input: LayerPresetInput): DismissableLayerOptions {
  return {
    onDismiss: input.onDismiss,
    anchor: input.anchor,
    exemptAnchor: true,
    restoreFocus: input.restoreFocus,
    initialFocus: "first",
    tab: "close-at-edges",
  };
}

/**
 * A menu: a click on its trigger closes it (a right-click then opens a fresh one); the focus
 * goes to its one tab stop — the active item — or to the menu itself when none is active; and
 * any Tab closes it, since a menu never traps focus.
 */
export function menuLayerOptions(input: LayerPresetInput): DismissableLayerOptions {
  return {
    onDismiss: input.onDismiss,
    anchor: input.anchor,
    exemptAnchor: false,
    restoreFocus: input.restoreFocus,
    initialFocus: "first",
    tab: "close",
  };
}
