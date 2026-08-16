/**
 * importActivity.ts — the one place that knows a batch import is in flight.
 *
 * Spec 43 §5.1 (REQ-CPD-002..005): the Compendium tab carries a **state dot**,
 * never a counter, and it is lit exactly while a batch import STARTED BY THIS
 * USER is running. There is no "new content you have not seen" in a compendium —
 * the collection is stable and the user is the one who goes to it — so the only
 * thing worth the rail is work of his own that keeps running with the drawer
 * collapsed.
 *
 * "Of this user" is structural rather than checked: this store is only ever
 * moved by the client that started the run, so another seat's import cannot
 * light it. The server is not asked, and no import state is broadcast.
 *
 * The rule itself (begin / end / what the rail draws) lives in
 * `compendiumPrefs.ts` as pure data. This module is only the reactive singleton
 * the registration hands to `registerSidebarTab({ badge })` — `createDotBadge`
 * from `lib/sidebar/badges.svelte.js` holds the `$state`, which is why this file
 * needs no rune of its own and can stay a plain `.ts`.
 */

import { createDotBadge, type SidebarDotBadge } from "../sidebar/badges.svelte.js";
import {
  NO_BATCH_IMPORTS,
  batchImportBadgeValue,
  beginBatchImport,
  endBatchImport,
  type BatchImportActivity,
} from "./compendiumPrefs.js";

/** The dot the rail reads (REQ-CPD-002). Boolean by construction: never a count. */
export const compendiumImportBadge: SidebarDotBadge = createDotBadge(false);

let activity: BatchImportActivity = NO_BATCH_IMPORTS;

function sync(): void {
  compendiumImportBadge.set(batchImportBadgeValue(activity));
}

/**
 * A batch import of this user started (REQ-CPD-003). `runId` identifies the run
 * so two overlapping batches keep the dot lit until BOTH are done.
 */
export function startCompendiumBatchImport(runId: string): void {
  activity = beginBatchImport(activity, runId);
  sync();
}

/**
 * A batch import ended — finished, failed or cancelled, all the same exit
 * (REQ-CPD-003): the dot means "work in flight", not "it went well".
 */
export function finishCompendiumBatchImport(runId: string): void {
  activity = endBatchImport(activity, runId);
  sync();
}

/** Run ids currently in flight, for the panel's own progress reporting. */
export function runningCompendiumBatchImports(): readonly string[] {
  return activity.running;
}

/** Forget every run — for teardown and for tests; never a UI gesture. */
export function resetCompendiumImportActivity(): void {
  activity = NO_BATCH_IMPORTS;
  sync();
}
