import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("pixi.js", () => ({ Assets: { load: vi.fn() } }));
vi.mock("../../api.js", () => ({ fusionApi: { getFreshToken: vi.fn() } }));
vi.mock("../../session.svelte.js", () => ({ session: { user: null } }));
vi.mock("../../assets/assetApi.js", () => ({ resolveAssetUrl: vi.fn() }));

import { swapScene } from "../sceneSwap.js";

function steps(over: Partial<Parameters<typeof swapScene>[0]> = {}) {
  const calls: string[] = [];
  return {
    calls,
    steps: {
      isCurrent: () => true,
      preload: () => {
        calls.push("preload");
        return Promise.resolve(true);
      },
      showLoading: () => calls.push("show"),
      hideLoading: () => calls.push("hide"),
      teardown: () => calls.push("teardown"),
      load: () => {
        calls.push("load");
        return Promise.resolve();
      },
      ...over,
    },
  };
}

describe("swapScene", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the old scene up until the new art is ready", async () => {
    let ready!: () => void;
    const { calls, steps: s } = steps({
      preload: () => {
        calls.push("preload");
        return new Promise((r) => (ready = () => r(true)));
      },
    });
    const done = swapScene(s);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual(["preload"]); // nothing torn down while the texture is in flight
    ready();
    expect(await done).toBe(true);
    expect(calls).toEqual(["preload", "teardown", "load"]);
  });

  it("shows 'Carregando cena...' only after 300 ms, and hides it before the swap", async () => {
    let ready!: () => void;
    const { calls, steps: s } = steps({
      preload: () => {
        calls.push("preload");
        return new Promise((r) => (ready = () => r(true)));
      },
    });
    const done = swapScene(s);
    await vi.advanceTimersByTimeAsync(299);
    expect(calls).not.toContain("show");
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toEqual(["preload", "show"]);
    ready();
    await done;
    expect(calls).toEqual(["preload", "show", "hide", "teardown", "load"]);
  });

  it("a fast preload never flashes the indicator", async () => {
    const { calls, steps: s } = steps();
    await swapScene(s);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(["preload", "teardown", "load"]);
  });

  it("does nothing more when a newer scene change superseded it while preloading", async () => {
    let current = true;
    const { calls, steps: s } = steps({
      isCurrent: () => current,
      preload: () => {
        calls.push("preload");
        current = false; // the GM switched again meanwhile
        return Promise.resolve(true);
      },
    });
    expect(await swapScene(s)).toBe(false);
    expect(calls).toEqual(["preload"]);
  });

  it("a rejected preload still swaps (the regular load has its own fallback)", async () => {
    const { calls, steps: s } = steps({
      preload: () => Promise.reject(new Error("net down")),
    });
    expect(await swapScene(s)).toBe(true);
    expect(calls).toEqual(["teardown", "load"]);
  });
});
