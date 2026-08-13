/**
 * noticeDemo.test.ts — the review scaffolding, kept honest.
 *
 * Small surface, but two things here are worth a test: that the demo stays OFF
 * unless asked (it would otherwise fire notices into a live session), and that
 * its teardown actually cancels — an unmount mid-sequence must not leave a
 * timer that emits into a component that no longer exists.
 */

import { describe, it, expect, vi } from "vitest";
import {
  isNoticeDemoRequested,
  runNoticeDemo,
  DEMO_NOTICES,
  NOTICE_DEMO_HOOK,
  type DemoHost,
} from "../noticeDemo.js";
import type { NoticeInput } from "../systemNotice.js";

/** A `window` stand-in whose timers fire only when told. */
function fakeHost() {
  const queue = new Map<number, () => void>();
  let seq = 0;

  const host: DemoHost & Record<string, unknown> = {
    setTimeout: (handler: () => void) => {
      seq += 1;
      queue.set(seq, handler);
      return seq;
    },
    clearTimeout: (handle: number) => {
      queue.delete(handle);
    },
  };

  return {
    host,
    /** Fire everything still queued. */
    flush: () => {
      for (const handler of [...queue.values()]) handler();
      queue.clear();
    },
    pending: () => queue.size,
  };
}

describe("isNoticeDemoRequested", () => {
  it("is off for an ordinary session", () => {
    expect(isNoticeDemoRequested("")).toBe(false);
    expect(isNoticeDemoRequested("?world=isekai")).toBe(false);
  });

  it("turns on for the explicit flag", () => {
    expect(isNoticeDemoRequested("?hud-demo=1")).toBe(true);
    // Bare flag, no value — the usual way someone types it by hand.
    expect(isNoticeDemoRequested("?hud-demo")).toBe(true);
  });

  it("is not fooled by a parameter that merely contains the name", () => {
    expect(isNoticeDemoRequested("?not-hud-demo=1")).toBe(false);
  });
});

describe("runNoticeDemo", () => {
  it("emits one notice per scripted entry, in order", () => {
    const emitted: NoticeInput[] = [];
    const { host, flush } = fakeHost();

    runNoticeDemo((input) => {
      emitted.push(input);
      return "id";
    }, host);
    flush();

    expect(emitted.map((n) => n.title)).toEqual(DEMO_NOTICES.map((n) => n.title));
  });

  it("covers every tone, which is the whole point of the demo", () => {
    const tones = new Set(DEMO_NOTICES.map((n) => n.tone));
    expect([...tones].sort()).toEqual(["bad", "good", "rumour", "system"]);
  });

  it("installs a replay hook that plays the sequence again", () => {
    const emit = vi.fn(() => "id");
    const { host, flush } = fakeHost();

    runNoticeDemo(emit, host);
    flush();
    expect(emit).toHaveBeenCalledTimes(DEMO_NOTICES.length);

    (host[NOTICE_DEMO_HOOK] as () => void)();
    flush();
    expect(emit).toHaveBeenCalledTimes(DEMO_NOTICES.length * 2);
  });

  it("cancels pending notices on teardown", () => {
    const emit = vi.fn(() => "id");
    const { host, flush, pending } = fakeHost();

    const stop = runNoticeDemo(emit, host);
    stop();
    flush();

    expect(pending()).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("removes the replay hook on teardown", () => {
    const { host } = fakeHost();
    const stop = runNoticeDemo(() => "id", host);
    expect(host[NOTICE_DEMO_HOOK]).toBeTypeOf("function");
    stop();
    expect(host[NOTICE_DEMO_HOOK]).toBeUndefined();
  });
});
