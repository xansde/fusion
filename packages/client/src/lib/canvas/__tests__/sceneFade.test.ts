import { describe, it, expect, vi } from "vitest";
import { fadeIn } from "../sceneFade.js";

describe("fadeIn", () => {
  function fakeTicker() {
    let cb: ((t: { deltaMS: number }) => void) | null = null;
    const remove = vi.fn(() => {
      cb = null;
    });
    return {
      add: (fn: (t: { deltaMS: number }) => void) => {
        cb = fn;
        return remove;
      },
      tick: (ms: number) => cb?.({ deltaMS: ms }),
      remove,
    };
  }

  it("goes 0 -> 1 over the duration, then detaches from the ticker", () => {
    const t = fakeTicker();
    const target = { alpha: 1 };
    fadeIn(target, t.add, 250);
    expect(target.alpha).toBe(0);
    t.tick(125);
    expect(target.alpha).toBeCloseTo(0.5);
    t.tick(200);
    expect(target.alpha).toBe(1);
    expect(t.remove).toHaveBeenCalledTimes(1);
  });

  it("the canceller snaps to fully visible", () => {
    const t = fakeTicker();
    const target = { alpha: 0 };
    const cancel = fadeIn(target, t.add, 250);
    t.tick(50);
    cancel();
    expect(target.alpha).toBe(1);
    expect(t.remove).toHaveBeenCalledTimes(1);
  });
});
