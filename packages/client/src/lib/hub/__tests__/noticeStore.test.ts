/**
 * noticeStore.test.ts — the reactive bridge over the notice reducer.
 *
 * The reducer itself is covered by `systemNotice.test.ts`. What is left to get
 * wrong here is the wiring: a store that forgets to write the reduced queue
 * back, or that reassigns the exported object (which would sever every
 * component already reading it). Both are silent — the UI simply stops
 * updating — so they get tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  noticeState,
  notify,
  dismissSystemNotice,
  tickSystemNotices,
  resetSystemNotices,
} from "../noticeStore.svelte.js";
import { DEFAULT_NOTICE_TTL_MS, MAX_VISIBLE_NOTICES } from "../systemNotice.js";

const T0 = 1_000;

beforeEach(() => {
  resetSystemNotices();
});

describe("noticeState", () => {
  it("starts empty", () => {
    expect(noticeState.queue.visible).toEqual([]);
    expect(noticeState.queue.pending).toEqual([]);
  });

  it("keeps the same exported object across every mutation", () => {
    // Components hold a reference to `noticeState`. Reassigning the export
    // would leave them reading a detached object — the classic "my store
    // updates but the screen doesn't" bug.
    const identity = noticeState;
    notify({ title: "…" }, T0);
    tickSystemNotices(T0 + 1);
    dismissSystemNotice(noticeState.queue.visible[0]!.id, T0 + 2);
    expect(noticeState).toBe(identity);
  });
});

describe("notify", () => {
  it("puts the notice on screen", () => {
    notify({ title: "Local revelado", tone: "rumour" }, T0);
    expect(noticeState.queue.visible).toHaveLength(1);
    expect(noticeState.queue.visible[0]!.title).toBe("Local revelado");
    expect(noticeState.queue.visible[0]!.tone).toBe("rumour");
  });

  it("returns the id it assigned, so a caller can dismiss its own notice", () => {
    const id = notify({ title: "…" }, T0);
    expect(noticeState.queue.visible[0]!.id).toBe(id);
  });

  it("holds the overflow rather than dropping it", () => {
    for (let i = 0; i <= MAX_VISIBLE_NOTICES; i += 1) notify({ title: `n${i}` }, T0);
    expect(noticeState.queue.visible).toHaveLength(MAX_VISIBLE_NOTICES);
    expect(noticeState.queue.pending).toHaveLength(1);
  });
});

describe("tickSystemNotices", () => {
  it("writes the reduced queue back to the store", () => {
    notify({ title: "…", ttlMs: 100 }, T0);
    tickSystemNotices(T0 + 100);
    expect(noticeState.queue.visible).toEqual([]);
  });

  it("leaves a live notice alone", () => {
    notify({ title: "…", ttlMs: 100 }, T0);
    tickSystemNotices(T0 + 50);
    expect(noticeState.queue.visible).toHaveLength(1);
  });
});

describe("dismissSystemNotice", () => {
  it("removes the notice and promotes what waited", () => {
    for (let i = 0; i <= MAX_VISIBLE_NOTICES; i += 1) notify({ title: `n${i}` }, T0);
    const doomed = noticeState.queue.visible[0]!.id;
    dismissSystemNotice(doomed, T0 + 5);
    expect(noticeState.queue.visible.map((n) => n.title)).toEqual([
      "n1",
      "n2",
      `n${MAX_VISIBLE_NOTICES}`,
    ]);
    expect(noticeState.queue.visible.at(-1)!.expiresAt).toBe(T0 + 5 + DEFAULT_NOTICE_TTL_MS);
  });
});

describe("resetSystemNotices", () => {
  it("empties both lanes", () => {
    for (let i = 0; i <= MAX_VISIBLE_NOTICES; i += 1) notify({ title: `n${i}` }, T0);
    resetSystemNotices();
    expect(noticeState.queue.visible).toEqual([]);
    expect(noticeState.queue.pending).toEqual([]);
  });

  it("does not reuse ids from before the reset", () => {
    // Ids leaking across a reset would make a stale dismiss hit a fresh
    // notice — rare, but the kind of thing that is impossible to reproduce.
    const before = notify({ title: "…" }, T0);
    resetSystemNotices();
    const after = notify({ title: "…" }, T0);
    expect(after).not.toBe(before);
  });
});
