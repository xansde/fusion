/**
 * actionBarShortcuts.ts — the keys of the action bar (BAR-F1-05; spec 53 REQ-BAR-048..051).
 *
 * STUB, as the BAR-F1-04 card asks (tasks.md §2.8: "stub: BAR-F1-04; corpo: BAR-F1-05"): the
 * signature is the final one and the body registers nothing. BAR-F1-05 fills it in with the twelve
 * favourite keys and Esc, through the central shortcut registry and its guard.
 */

import type { ActionBarController } from "./actionBarController.svelte.js";

/** Registers the keys of the bar. Returns the function that takes them out again. */
export function registerActionBarShortcuts(controller: ActionBarController): () => void {
  void controller;
  return () => undefined;
}
