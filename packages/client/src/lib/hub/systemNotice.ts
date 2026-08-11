/**
 * systemNotice.ts — the queue behind the Sistema's notifications.
 *
 * A notice is the System Window speaking without being asked: a location
 * revealed, a mission advanced. Design source is the `.nt` block of
 * `docs/design/prototipo-log-missoes.html` — centred panel, bracket corners,
 * uppercase kicker, a life bar counting the notice down.
 *
 * The prototype stacks notices without limit, which is fine on a page that is
 * nothing but the Hub. Over a live map it is not: a GM revealing six places in
 * a row would paper over the thing everyone is looking at. So this queue caps
 * what is on screen and holds the rest, which introduces the one rule worth
 * stating twice — a notice's clock starts when it becomes *visible*, never
 * when it was enqueued. Otherwise a notice that waited out its TTL in line
 * would be promoted already dead and flash out on the same frame.
 *
 * Pure reducers over an immutable queue, with `now` passed in. The client runs
 * Vitest with `environment: "node"`; a module that read `Date.now()` internally
 * could not be stepped through a burst deterministically.
 */

/** Colour register of a notice, mirroring `SystemWindowTone`. */
export type NoticeTone = "system" | "rumour" | "good" | "bad";

/** How many notices may share the screen before the rest wait their turn. */
export const MAX_VISIBLE_NOTICES = 3;

/** Long enough to read two lines, short enough not to camp on the map. */
export const DEFAULT_NOTICE_TTL_MS = 6_000;

/** What a caller provides. */
export interface NoticeInput {
  readonly title: string;
  readonly body?: string;
  readonly tone?: NoticeTone;
  readonly ttlMs?: number;
}

/** A notice inside the queue. */
export interface SystemNoticeItem {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly tone: NoticeTone;
  readonly ttlMs: number;
  /** When it leaves the screen — `null` while it is still waiting in line. */
  readonly expiresAt: number | null;
}

export interface NoticeQueue {
  /** On screen, in arrival order. Never longer than {@link MAX_VISIBLE_NOTICES}. */
  readonly visible: readonly SystemNoticeItem[];
  /** Waiting for a slot, in arrival order. */
  readonly pending: readonly SystemNoticeItem[];
  /** Source of ids. Kept in the state so the reducers stay deterministic. */
  readonly nextSeq: number;
}

export function emptyNoticeQueue(): NoticeQueue {
  return { visible: [], pending: [], nextSeq: 1 };
}

/**
 * The id a notice enqueued at sequence `seq` will carry.
 *
 * Exported so `noticeStore` can hand the id back to the caller without either
 * side re-deriving the format — two copies of a string template is exactly how
 * a dismiss silently stops matching.
 */
export function noticeIdFor(seq: number): string {
  return `notice-${String(seq)}`;
}

/**
 * Move waiting notices into free slots, stamping each one's expiry as it goes.
 *
 * The stamping is the whole point of doing this in one place: promotion happens
 * from three directions (a tick, a dismissal, a push into a queue with room),
 * and a clock started at the wrong moment in any of them is a notice that
 * appears to flicker.
 */
function promote(
  visible: readonly SystemNoticeItem[],
  pending: readonly SystemNoticeItem[],
  now: number,
): { visible: SystemNoticeItem[]; pending: SystemNoticeItem[] } {
  const nextVisible = [...visible];
  let promotedCount = 0;

  while (nextVisible.length < MAX_VISIBLE_NOTICES && promotedCount < pending.length) {
    const promoted = pending[promotedCount];
    if (promoted === undefined) break;
    nextVisible.push({ ...promoted, expiresAt: now + promoted.ttlMs });
    promotedCount += 1;
  }

  return { visible: nextVisible, pending: pending.slice(promotedCount) };
}

/** Enqueue a notice, showing it at once if there is room. */
export function pushNotice(queue: NoticeQueue, input: NoticeInput, now: number): NoticeQueue {
  const item: SystemNoticeItem = {
    id: noticeIdFor(queue.nextSeq),
    title: input.title,
    body: input.body ?? null,
    tone: input.tone ?? "system",
    ttlMs: input.ttlMs ?? DEFAULT_NOTICE_TTL_MS,
    expiresAt: null,
  };

  const { visible, pending } = promote(queue.visible, [...queue.pending, item], now);
  return { visible, pending, nextSeq: queue.nextSeq + 1 };
}

/** Retire whatever has expired and fill the slots it freed. */
export function tickNotices(queue: NoticeQueue, now: number): NoticeQueue {
  const surviving = queue.visible.filter(
    // `expiresAt === null` cannot happen for a visible notice, but treating it
    // as "no clock" is the safe reading: a stuck notice is better than one that
    // disappears the moment it is shown.
    (notice) => notice.expiresAt === null || notice.expiresAt > now,
  );

  const { visible, pending } = promote(surviving, queue.pending, now);
  return { visible, pending, nextSeq: queue.nextSeq };
}

/** Drop a notice by id, whether it is on screen or still waiting. */
export function dismissNotice(queue: NoticeQueue, id: string, now: number): NoticeQueue {
  const { visible, pending } = promote(
    queue.visible.filter((notice) => notice.id !== id),
    queue.pending.filter((notice) => notice.id !== id),
    now,
  );

  return { visible, pending, nextSeq: queue.nextSeq };
}
