/**
 * noticeStore.svelte.ts — reactive bridge over the notice reducer.
 *
 * `systemNotice.ts` holds the rules and stays pure. This module is the one
 * place that owns *the* queue, so anything in the client can make the Sistema
 * speak with a single call:
 *
 *   notify({ title: "Local revelado", tone: "rumour" });
 *
 * `$state` is a compiler rune, hence the `.svelte.ts` extension — same pattern
 * as `windows/dialogs.svelte.ts`.
 *
 * The exported object is never reassigned; only `queue` inside it is. That is
 * deliberate: a component that imported `noticeState` keeps a reference to the
 * object, and swapping the export would leave it reading a detached copy while
 * the screen quietly stops updating.
 */

import {
  emptyNoticeQueue,
  pushNotice,
  tickNotices,
  dismissNotice,
  noticeIdFor,
  type NoticeInput,
  type NoticeQueue,
} from "./systemNotice.js";

/** The live queue. Read `noticeState.queue.visible` to render. */
export const noticeState: { queue: NoticeQueue } = $state({ queue: emptyNoticeQueue() });

/**
 * Make the Sistema speak. Returns the id, so a caller that owns a long-lived
 * notice can dismiss its own without hunting for it.
 *
 * `now` is injectable for tests; production callers never pass it.
 */
export function notify(input: NoticeInput, now: number = Date.now()): string {
  // Read the id before pushing: the sequence the queue is *about* to spend is
  // the one this notice gets, whether it lands on screen or in line.
  const id = noticeIdFor(noticeState.queue.nextSeq);
  noticeState.queue = pushNotice(noticeState.queue, input, now);
  return id;
}

/** Retire expired notices and promote whatever was waiting. */
export function tickSystemNotices(now: number = Date.now()): void {
  noticeState.queue = tickNotices(noticeState.queue, now);
}

/** Drop one notice — the player clicked it, or its cause went away. */
export function dismissSystemNotice(id: string, now: number = Date.now()): void {
  noticeState.queue = dismissNotice(noticeState.queue, id, now);
}

/**
 * Clear everything, e.g. on world change or between tests.
 *
 * The id sequence deliberately survives: reusing ids across a reset would let
 * a dismiss issued before the reset land on an unrelated notice after it.
 */
export function resetSystemNotices(): void {
  noticeState.queue = { ...emptyNoticeQueue(), nextSeq: noticeState.queue.nextSeq };
}
