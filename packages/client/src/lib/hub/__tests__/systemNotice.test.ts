/**
 * systemNotice.test.ts — the Sistema's notification queue.
 *
 * A notice is how the System Window speaks unprompted: "missão revelada",
 * "condição aplicada". At a real table several can fire at once — the GM
 * reveals three locations in a row — and the prototype simply stacks them,
 * which is fine on a demo page and covers the map at an actual session.
 *
 * So the queue caps what is on screen and holds the rest. That cap is what
 * every test below is really about: a queue that drops notices, or shows one
 * that already expired while it waited, is worse than no queue.
 *
 * Time is a parameter, never `Date.now()` — this is a pure reducer, and the
 * tests need to step time by hand.
 */

import { describe, it, expect } from "vitest";
import {
  emptyNoticeQueue,
  pushNotice,
  tickNotices,
  dismissNotice,
  MAX_VISIBLE_NOTICES,
  DEFAULT_NOTICE_TTL_MS,
  type NoticeQueue,
} from "../systemNotice.js";

const T0 = 1_000;

/** Fill the visible slots, one notice per title. */
function seedFull(now = T0): NoticeQueue {
  let queue = emptyNoticeQueue();
  for (let i = 0; i < MAX_VISIBLE_NOTICES; i += 1) {
    queue = pushNotice(queue, { title: `n${i}` }, now);
  }
  return queue;
}

describe("emptyNoticeQueue", () => {
  it("starts with nothing shown and nothing waiting", () => {
    const queue = emptyNoticeQueue();
    expect(queue.visible).toEqual([]);
    expect(queue.pending).toEqual([]);
  });
});

describe("pushNotice", () => {
  it("shows a notice immediately while there is room", () => {
    const queue = pushNotice(emptyNoticeQueue(), { title: "Missão revelada" }, T0);
    expect(queue.visible).toHaveLength(1);
    expect(queue.visible[0]!.title).toBe("Missão revelada");
    expect(queue.pending).toEqual([]);
  });

  it("defaults the tone to the Sistema's own voice", () => {
    const queue = pushNotice(emptyNoticeQueue(), { title: "…" }, T0);
    expect(queue.visible[0]!.tone).toBe("system");
  });

  it("carries an explicit tone through", () => {
    const queue = pushNotice(emptyNoticeQueue(), { title: "…", tone: "rumour" }, T0);
    expect(queue.visible[0]!.tone).toBe("rumour");
  });

  it("stamps the expiry from the default TTL", () => {
    const queue = pushNotice(emptyNoticeQueue(), { title: "…" }, T0);
    expect(queue.visible[0]!.expiresAt).toBe(T0 + DEFAULT_NOTICE_TTL_MS);
  });

  it("honours a per-notice TTL", () => {
    const queue = pushNotice(emptyNoticeQueue(), { title: "…", ttlMs: 500 }, T0);
    expect(queue.visible[0]!.expiresAt).toBe(T0 + 500);
  });

  it("gives every notice a distinct id", () => {
    let queue = pushNotice(emptyNoticeQueue(), { title: "a" }, T0);
    queue = pushNotice(queue, { title: "b" }, T0);
    const [first, second] = queue.visible;
    expect(first!.id).not.toBe(second!.id);
  });

  it("holds the overflow instead of dropping it", () => {
    // The alternative — dropping the oldest — loses information the player was
    // never shown. A revealed location that nobody saw revealed is a bug that
    // surfaces as "the GM says he revealed it".
    const queue = pushNotice(seedFull(), { title: "overflow" }, T0);
    expect(queue.visible).toHaveLength(MAX_VISIBLE_NOTICES);
    expect(queue.pending.map((n) => n.title)).toEqual(["overflow"]);
  });

  it("does not stamp an expiry on a notice that is still waiting", () => {
    // Its clock has not started; `tickNotices` stamps it on promotion.
    const queue = pushNotice(seedFull(), { title: "overflow" }, T0);
    expect(queue.pending[0]!.expiresAt).toBeNull();
  });

  it("preserves arrival order among the visible", () => {
    const queue = seedFull();
    expect(queue.visible.map((n) => n.title)).toEqual(["n0", "n1", "n2"]);
  });

  it("leaves the previous queue untouched", () => {
    const before = emptyNoticeQueue();
    pushNotice(before, { title: "…" }, T0);
    expect(before.visible).toEqual([]);
  });
});

describe("tickNotices", () => {
  it("keeps a notice whose time has not come", () => {
    const queue = pushNotice(emptyNoticeQueue(), { title: "…", ttlMs: 100 }, T0);
    expect(tickNotices(queue, T0 + 99).visible).toHaveLength(1);
  });

  it("retires a notice the instant it expires", () => {
    const queue = pushNotice(emptyNoticeQueue(), { title: "…", ttlMs: 100 }, T0);
    expect(tickNotices(queue, T0 + 100).visible).toEqual([]);
  });

  it("promotes a waiting notice into the freed slot", () => {
    let queue = seedFull();
    queue = pushNotice(queue, { title: "overflow" }, T0);
    queue = tickNotices(queue, T0 + DEFAULT_NOTICE_TTL_MS);
    expect(queue.visible.map((n) => n.title)).toEqual(["overflow"]);
    expect(queue.pending).toEqual([]);
  });

  it("starts the promoted notice's clock at promotion, not at arrival", () => {
    // The bug this prevents: a notice that waited out its whole TTL in the
    // queue would be promoted already expired and vanish on the same frame —
    // a notification that flashes and is gone, blamed on "a rendering glitch".
    let queue = seedFull();
    queue = pushNotice(queue, { title: "overflow", ttlMs: 100 }, T0);
    const promotedAt = T0 + DEFAULT_NOTICE_TTL_MS;
    queue = tickNotices(queue, promotedAt);
    expect(queue.visible[0]!.expiresAt).toBe(promotedAt + 100);
  });

  it("promotes in arrival order", () => {
    let queue = seedFull();
    queue = pushNotice(queue, { title: "first-waiting" }, T0);
    queue = pushNotice(queue, { title: "second-waiting" }, T0);
    queue = tickNotices(queue, T0 + DEFAULT_NOTICE_TTL_MS);
    expect(queue.visible.map((n) => n.title)).toEqual(["first-waiting", "second-waiting"]);
  });

  it("never shows more than the cap, however many are waiting", () => {
    let queue = seedFull();
    for (let i = 0; i < 10; i += 1) queue = pushNotice(queue, { title: `w${i}` }, T0);
    queue = tickNotices(queue, T0 + DEFAULT_NOTICE_TTL_MS);
    expect(queue.visible).toHaveLength(MAX_VISIBLE_NOTICES);
    expect(queue.pending).toHaveLength(10 - MAX_VISIBLE_NOTICES);
  });

  it("is a no-op when nothing has expired and nothing waits", () => {
    const queue = seedFull();
    const ticked = tickNotices(queue, T0 + 1);
    expect(ticked.visible).toEqual(queue.visible);
    expect(ticked.pending).toEqual(queue.pending);
  });

  it("drains an empty queue without complaint", () => {
    expect(tickNotices(emptyNoticeQueue(), T0).visible).toEqual([]);
  });
});

describe("dismissNotice", () => {
  it("removes the notice the player clicked", () => {
    let queue = pushNotice(emptyNoticeQueue(), { title: "a" }, T0);
    queue = pushNotice(queue, { title: "b" }, T0);
    const id = queue.visible[0]!.id;
    queue = dismissNotice(queue, id, T0);
    expect(queue.visible.map((n) => n.title)).toEqual(["b"]);
  });

  it("promotes a waiting notice into the freed slot", () => {
    let queue = seedFull();
    queue = pushNotice(queue, { title: "overflow" }, T0);
    const dismissedAt = T0 + 10;
    queue = dismissNotice(queue, queue.visible[0]!.id, dismissedAt);
    expect(queue.visible.map((n) => n.title)).toEqual(["n1", "n2", "overflow"]);
    expect(queue.visible[2]!.expiresAt).toBe(dismissedAt + DEFAULT_NOTICE_TTL_MS);
  });

  it("can dismiss one that is still waiting", () => {
    let queue = seedFull();
    queue = pushNotice(queue, { title: "overflow" }, T0);
    queue = dismissNotice(queue, queue.pending[0]!.id, T0);
    expect(queue.pending).toEqual([]);
    expect(queue.visible).toHaveLength(MAX_VISIBLE_NOTICES);
  });

  it("ignores an id nobody holds", () => {
    const queue = seedFull();
    const after = dismissNotice(queue, "no-such-id", T0);
    expect(after.visible).toEqual(queue.visible);
  });
});

describe("a burst of reveals, end to end", () => {
  it("shows every notice exactly once, in order", () => {
    // Five reveals in the same instant, three slots. Nothing may be skipped.
    let queue = emptyNoticeQueue();
    for (let i = 0; i < 5; i += 1) queue = pushNotice(queue, { title: `r${i}`, ttlMs: 100 }, T0);

    const seen: string[] = [];
    let now = T0;
    for (const notice of queue.visible) seen.push(notice.title);

    // Two ticks, each retiring a full screen and promoting what waited.
    for (let step = 0; step < 3; step += 1) {
      now += 100;
      const before = new Set(queue.visible.map((n) => n.id));
      queue = tickNotices(queue, now);
      for (const notice of queue.visible) {
        if (!before.has(notice.id)) seen.push(notice.title);
      }
    }

    expect(seen).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    expect(queue.visible).toEqual([]);
    expect(queue.pending).toEqual([]);
  });
});
