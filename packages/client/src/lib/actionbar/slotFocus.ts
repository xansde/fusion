/**
 * slotFocus.ts — where the focus goes after a click on a control of the action bar (BAR-F1-04;
 * spec 53 Q-BAR-07, REQ-BAR-049).
 *
 * A mouse click on a `<button>` leaves the focus on it. The shortcut guard of BAR-F1-05 suspends
 * the number keys while a button holds the focus (REQ-BAR-049), so, left alone, the keys 1–0, −
 * and = stop working at the first click and stay dead until the user clicks somewhere else — and
 * whoever plays with mouse and keyboard together sees nothing happen. `releaseFocusAfterPointer`
 * is the other half of that rule: after a click the focus leaves the button and goes back to the
 * canvas, where the keys are live.
 *
 * A keyboard activation (Enter or Space on a focused control) is left alone, on purpose: that
 * user is walking the bar with Tab and the shortcuts stay suspended for them (REQ-BAR-049). The
 * two are told apart by `event.detail`, which is the click count for a pointer click (1, 2, 3…)
 * and 0 for a click the browser synthesises from the keyboard.
 *
 * Pure and structurally typed (tasks.md §2.10): the event and the document are minimal objects, as
 * `isEscapeForSomethingElse` takes them in `token-interaction.ts`, so it is tested without a DOM.
 */

/** The canvas the table draws on (`TableScreen`'s `.canvas-host`). */
const CANVAS_SELECTOR = ".canvas-host canvas";

/** The part of a click event this module reads. */
export interface PointerActivationEvent {
  /** Click count of a pointer click; 0 when the browser synthesised the click from the keyboard. */
  readonly detail: number;
  /** The control that was clicked. */
  readonly currentTarget: unknown;
}

/** The part of `document` this module reads. */
export interface FocusDocument {
  querySelector(selector: string): unknown;
}

interface Focusable {
  blur?: () => void;
  focus?: (options?: { preventScroll?: boolean }) => void;
}

/**
 * After a POINTER click: take the focus off the control and give it back to the canvas. After a
 * keyboard activation: do nothing.
 */
export function releaseFocusAfterPointer(event: PointerActivationEvent, doc?: FocusDocument): void {
  if (!(event.detail > 0)) return;

  (event.currentTarget as Focusable | null)?.blur?.();
  // A canvas that cannot take the focus ignores this, and the page body — where the keys are live
  // all the same — keeps it; one that can (`tabindex`) gets it back.
  (doc?.querySelector(CANVAS_SELECTOR) as Focusable | null | undefined)?.focus?.({
    preventScroll: true,
  });
}
