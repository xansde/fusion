/**
 * hoverIntent.ts — when a tooltip appears and when it goes (BAR-F1-03).
 *
 * A tooltip is a small state machine over four facts: the pointer is on the trigger, the
 * keyboard focus is on the trigger, the pointer is on the tooltip itself, and the user has
 * dismissed it. It should be open exactly while one of the first three holds and the fourth
 * does not — but with delays, so a pointer crossing the screen does not strobe tooltips:
 *
 *  - **Open after a delay** (hover or keyboard focus alike).
 *  - **Close after a short delay**, so the pointer can cross the gap between trigger and
 *    tooltip and land on it: WCAG 1.4.13 asks that content shown on hover be *hoverable*.
 *  - **Dismiss at once** on Escape or on a press of the trigger, and stay dismissed for as
 *    long as the same hover or focus lasts: WCAG 1.4.13 asks that it be *dismissible*
 *    without moving the pointer or the focus.
 *
 * Plain TypeScript with injected callbacks rather than runes, so it is driven with fake
 * timers in a test that needs no DOM and no Svelte. `Tooltip.svelte` wires DOM events to it.
 */

export interface HoverIntentOptions {
  /** Milliseconds before a hover/focus opens the tooltip. Read each time it matters. */
  openDelay: () => number;
  /** Milliseconds before losing hover/focus closes it. Read each time it matters. */
  closeDelay: () => number;
  /** Called when the tooltip opens or closes through this machine (not through `sync`). */
  onChange: (open: boolean) => void;
}

export interface HoverIntent {
  readonly open: boolean;
  /** The pointer entered / left the trigger. */
  hoverIn(): void;
  hoverOut(): void;
  /** Keyboard focus entered / left the trigger. */
  focusIn(): void;
  focusOut(): void;
  /** The pointer entered / left the tooltip itself. */
  layerIn(): void;
  layerOut(): void;
  /** Escape: closes it now and keeps it closed until the hover or focus ends. */
  escape(): void;
  /** The trigger was pressed: same as Escape, and also cancels a tooltip still pending. */
  press(): void;
  /** Adopt an `open` value set by the owner, without calling `onChange` back. */
  sync(open: boolean): void;
  /** Forget everything: no pending timer, nothing hovered or focused, closed. */
  reset(): void;
}

export function createHoverIntent(options: HoverIntentOptions): HoverIntent {
  let hovering = false;
  let focused = false;
  let inLayer = false;
  let dismissed = false;
  let isOpen = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function clearOpenTimer(): void {
    if (openTimer !== undefined) clearTimeout(openTimer);
    openTimer = undefined;
  }

  function clearCloseTimer(): void {
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    closeTimer = undefined;
  }

  function setOpen(next: boolean): void {
    if (isOpen === next) return;
    isOpen = next;
    // The tooltip is gone, and so is whatever the pointer was on. A browser does not fire
    // `pointerleave` for an element removed under the pointer, so without this a stale "the
    // pointer is on the tooltip" would hold the NEXT hover open for good: a ghost tooltip.
    if (!next) inLayer = false;
    options.onChange(next);
  }

  /** Brings the open/closed state in line with the four facts, starting timers as needed. */
  function reconcile(): void {
    const wanted = (hovering || focused || inLayer) && !dismissed;

    if (wanted) {
      clearCloseTimer();
      if (isOpen || openTimer !== undefined) return;
      const delay = options.openDelay();
      if (delay <= 0) {
        setOpen(true);
        return;
      }
      openTimer = setTimeout(() => {
        openTimer = undefined;
        setOpen(true);
      }, delay);
      return;
    }

    clearOpenTimer();
    if (!isOpen || closeTimer !== undefined) return;
    const delay = options.closeDelay();
    if (delay <= 0) {
      setOpen(false);
      return;
    }
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      setOpen(false);
    }, delay);
  }

  /**
   * Closes now and refuses to reopen until the current hover or focus is over. If neither is
   * going on — the pointer had left the trigger for the tooltip, or a touch never hovered —
   * there is nothing to wait for, and the very next hover or focus is welcome. (Marking it
   * refused anyway would leave the mark standing until a hover-out that never comes, and the
   * first pass over the trigger after an Escape would show nothing.)
   */
  function dismiss(): void {
    dismissed = hovering || focused;
    clearOpenTimer();
    clearCloseTimer();
    setOpen(false);
  }

  return {
    get open() {
      return isOpen;
    },
    hoverIn() {
      hovering = true;
      reconcile();
    },
    hoverOut() {
      hovering = false;
      if (!focused) dismissed = false;
      reconcile();
    },
    focusIn() {
      focused = true;
      reconcile();
    },
    focusOut() {
      focused = false;
      if (!hovering) dismissed = false;
      reconcile();
    },
    layerIn() {
      inLayer = true;
      reconcile();
    },
    layerOut() {
      inLayer = false;
      reconcile();
    },
    escape() {
      // Nothing showing and nothing about to show: there is nothing to dismiss, and the next
      // hover must not be refused because of a key the user pressed for another reason.
      if (!isOpen && openTimer === undefined) return;
      dismiss();
    },
    press() {
      dismiss();
    },
    sync(open: boolean) {
      isOpen = open;
      // Same reason as in `setOpen`: a tooltip closed from outside takes the pointer with it.
      if (!open) inLayer = false;
    },
    reset() {
      hovering = false;
      focused = false;
      inLayer = false;
      dismissed = false;
      clearOpenTimer();
      clearCloseTimer();
      setOpen(false);
    },
  };
}
