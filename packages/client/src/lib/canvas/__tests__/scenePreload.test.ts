import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getFreshToken = vi.fn<() => Promise<string | null>>();
const resolveAssetUrl = vi.fn<(...a: unknown[]) => Promise<string>>();
const assetsLoad = vi.fn<(url: string) => Promise<unknown>>();

vi.mock("pixi.js", () => ({ Assets: { load: (u: string) => assetsLoad(u) } }));
vi.mock("../../api.js", () => ({ fusionApi: { getFreshToken: () => getFreshToken() } }));
vi.mock("../../session.svelte.js", () => ({ session: { user: { id: "u1" } } }));
vi.mock("../../assets/assetApi.js", () => ({
  resolveAssetUrl: (...a: unknown[]) => resolveAssetUrl(...a),
}));

import { preloadSceneTexture, trackSlowLoad } from "../scenePreload.js";

describe("preloadSceneTexture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFreshToken.mockResolvedValue("fresh");
    resolveAssetUrl.mockResolvedValue("/assets/map.png?t=1");
    assetsLoad.mockResolvedValue({});
  });

  it("warms Assets with the grant minted by a LIVE token, for the scene's own document", async () => {
    expect(await preloadSceneTexture({ _id: "s1", background: "/assets/map.png" })).toBe(true);
    expect(resolveAssetUrl).toHaveBeenCalledWith("/assets/map.png", "fresh", "u1", {
      table: "scenes",
      id: "s1",
    });
    expect(assetsLoad).toHaveBeenCalledWith("/assets/map.png?t=1");
  });

  it("does nothing for a scene without art", async () => {
    expect(await preloadSceneTexture({ _id: "s1", background: "" })).toBe(false);
    expect(assetsLoad).not.toHaveBeenCalled();
  });

  it("joins a load already running for the same scene art", async () => {
    let release!: () => void;
    assetsLoad.mockReturnValueOnce(new Promise((r) => (release = () => r({}))));
    const a = preloadSceneTexture({ _id: "s1", background: "/assets/map.png" });
    const b = preloadSceneTexture({ _id: "s1", background: "/assets/map.png" });
    await vi.waitFor(() => expect(assetsLoad).toHaveBeenCalledTimes(1));
    release();
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(assetsLoad).toHaveBeenCalledTimes(1);
  });

  it("never rejects: a failed warm-up is just false", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    assetsLoad.mockRejectedValueOnce(new Error("boom"));
    expect(await preloadSceneTexture({ _id: "s2", background: "/assets/x.png" })).toBe(false);
  });
});

describe("trackSlowLoad", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never shows the indicator for a fast load", async () => {
    const show = vi.fn();
    const hide = vi.fn();
    const p = trackSlowLoad(Promise.resolve("ok"), { show, hide });
    expect(await p).toBe("ok");
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it("shows after 300 ms and hides when the load settles", async () => {
    const show = vi.fn();
    const hide = vi.fn();
    let done!: (v: string) => void;
    const p = trackSlowLoad(new Promise<string>((r) => (done = r)), { show, hide });
    await vi.advanceTimersByTimeAsync(299);
    expect(show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(show).toHaveBeenCalledTimes(1);
    done("x");
    expect(await p).toBe("x");
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("hides even when the load rejects", async () => {
    const show = vi.fn();
    const hide = vi.fn();
    let fail!: (e: Error) => void;
    const p = trackSlowLoad(new Promise<string>((_, r) => (fail = r)), { show, hide });
    const settled = expect(p).rejects.toThrow("nope");
    await vi.advanceTimersByTimeAsync(400);
    fail(new Error("nope"));
    await settled;
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
