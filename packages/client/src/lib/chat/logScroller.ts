/**
 * logScroller.ts — the one way to say "take the log to the end" (plan G033).
 *
 * REQ-ACH-034: sending clears the box AND takes the log to the end. The element that can
 * scroll lives in `ChatLog`, the send lives in the compose box, and neither is the other's
 * parent — the panel composes both siblings. Rather than thread a callback down twice, the
 * log registers its scroller here while it is mounted and the sender asks for the end.
 *
 * Deliberately a single slot, not a list: two logs on screen would mean the drawer kept
 * two chat panels alive, which the drawer does not do (REQ-GAV-017). A stale registration
 * is impossible for the same reason — the log clears the slot on unmount.
 */

type Scroller = () => void;

let _scroller: Scroller | null = null;

/** Called by the log on mount, and with `null` on unmount. */
export function registerLogScroller(fn: Scroller | null): void {
  _scroller = fn;
}

/** True while a log is on screen and able to scroll. */
export function hasLogScroller(): boolean {
  return _scroller !== null;
}

/**
 * Take the log to the end. A no-op when no log is mounted (the search results are on
 * screen, or the tab is closed) — sending from there must not throw.
 */
export function scrollLogToEnd(): void {
  _scroller?.();
}
