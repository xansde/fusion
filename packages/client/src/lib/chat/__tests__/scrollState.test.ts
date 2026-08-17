/**
 * Tests for ScrollStateManager.
 */

import { describe, it, expect } from "vitest";
import { ScrollStateManager, lastMessageStamp, type ScrollStateCallbacks } from "../scrollState.js";

function makeCallbacks(): {
  callbacks: ScrollStateCallbacks;
  state: { scrollCalls: number };
  indicatorCalls: boolean[];
} {
  const state = { scrollCalls: 0 };
  const indicatorCalls: boolean[] = [];
  const callbacks: ScrollStateCallbacks = {
    scrollToBottom: () => {
      state.scrollCalls++;
    },
    setIndicatorVisible: (v) => {
      indicatorCalls.push(v);
    },
  };
  return { callbacks, state, indicatorCalls };
}

describe("ScrollStateManager", () => {
  it("starts pinned", () => {
    const { callbacks } = makeCallbacks();
    const sm = new ScrollStateManager(callbacks);
    expect(sm.pinned).toBe(true);
  });

  it("scrolls to bottom on new message when pinned", () => {
    const result = makeCallbacks();
    const sm = new ScrollStateManager(result.callbacks);
    sm.onNewMessage();
    expect(result.state.scrollCalls).toBe(1);
  });

  it("shows indicator on new message when not pinned", () => {
    const result = makeCallbacks();
    const sm = new ScrollStateManager(result.callbacks);
    // Unpin by scrolling up
    sm.onScroll(0, 1000, 300);
    expect(sm.pinned).toBe(false);
    sm.onNewMessage();
    expect(result.indicatorCalls).toContain(true);
  });

  it("re-pins when scrolled back to bottom", () => {
    const result = makeCallbacks();
    const sm = new ScrollStateManager(result.callbacks, 40);
    // Scroll up to unpin
    sm.onScroll(0, 1000, 300);
    expect(sm.pinned).toBe(false);
    // Trigger a new message so the indicator is shown
    sm.onNewMessage();
    expect(result.indicatorCalls).toContain(true);
    // Scroll back to bottom (distanceFromBottom = 1000 - 300 - 660 = 40)
    sm.onScroll(660, 1000, 300);
    expect(sm.pinned).toBe(true);
    expect(result.indicatorCalls[result.indicatorCalls.length - 1]).toBe(false);
  });

  it("jumpToBottom calls scrollToBottom and hides indicator", () => {
    const result = makeCallbacks();
    const sm = new ScrollStateManager(result.callbacks);
    // Unpin
    sm.onScroll(0, 1000, 300);
    sm.onNewMessage();
    const scrollBefore = result.state.scrollCalls;
    sm.jumpToBottom();
    expect(result.state.scrollCalls).toBeGreaterThan(scrollBefore);
    expect(sm.pinned).toBe(true);
    expect(result.indicatorCalls[result.indicatorCalls.length - 1]).toBe(false);
  });

  it("pendingCount accumulates while not pinned", () => {
    const { callbacks } = makeCallbacks();
    const sm = new ScrollStateManager(callbacks);
    sm.onScroll(0, 1000, 300);
    sm.onNewMessage();
    sm.onNewMessage();
    sm.onNewMessage();
    expect(sm.pendingCount).toBe(3);
  });

  it("pendingCount resets after jumpToBottom", () => {
    const { callbacks } = makeCallbacks();
    const sm = new ScrollStateManager(callbacks);
    sm.onScroll(0, 1000, 300);
    sm.onNewMessage();
    sm.jumpToBottom();
    expect(sm.pendingCount).toBe(0);
  });

  it("forceScrollToBottom always scrolls and re-pins", () => {
    const result = makeCallbacks();
    const sm = new ScrollStateManager(result.callbacks);
    sm.onScroll(0, 1000, 300); // unpin
    sm.forceScrollToBottom();
    expect(sm.pinned).toBe(true);
    expect(result.state.scrollCalls).toBeGreaterThan(0);
  });

  // REQ-ACH-081: an invalidated message stays in the log at the same
  // position, with a distinct presentation — it does not re-append, so the
  // log's length never changes. A pinned reader must still see the true end
  // once that row grows a line (see also `lastMessageStamp` below).
  describe("onLastMessageResized", () => {
    it("re-scrolls to bottom when pinned, without touching the pending count", () => {
      const result = makeCallbacks();
      const sm = new ScrollStateManager(result.callbacks);
      expect(sm.pinned).toBe(true);
      sm.onLastMessageResized();
      expect(result.state.scrollCalls).toBe(1);
      expect(sm.pendingCount).toBe(0);
      // No indicator flip either — an in-place edit is not a "new message".
      expect(result.indicatorCalls).toEqual([]);
    });

    it("does nothing when not pinned (REQ-ACH-006 governs arrivals, not edits)", () => {
      const result = makeCallbacks();
      const sm = new ScrollStateManager(result.callbacks);
      sm.onScroll(0, 1000, 300); // unpin
      const scrollBefore = result.state.scrollCalls;
      sm.onLastMessageResized();
      expect(result.state.scrollCalls).toBe(scrollBefore);
      expect(sm.pendingCount).toBe(0);
    });
  });
});

describe("lastMessageStamp", () => {
  it("returns null for an empty log", () => {
    expect(lastMessageStamp([])).toBeNull();
  });

  it("changes when the last message's invalid flag toggles, id staying the same", () => {
    const before = lastMessageStamp([{ _id: "m1", invalid: false }]);
    const after = lastMessageStamp([{ _id: "m1", invalid: true }]);
    expect(before).not.toBe(after);
  });

  it("is stable across renders when nothing about the last message changed", () => {
    const a = lastMessageStamp([
      { _id: "m1", invalid: false },
      { _id: "m2", invalid: false },
    ]);
    const b = lastMessageStamp([
      { _id: "m1", invalid: false },
      { _id: "m2", invalid: false },
    ]);
    expect(a).toBe(b);
  });

  it("treats an absent invalid flag the same as false (never-invalidated messages)", () => {
    const withoutFlag = lastMessageStamp([{ _id: "m1" }]);
    const withFalseFlag = lastMessageStamp([{ _id: "m1", invalid: false }]);
    expect(withoutFlag).toBe(withFalseFlag);
  });
});
