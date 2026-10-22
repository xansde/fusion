/**
 * sceneLoader asks for a LIVE access token (not the in-memory snapshot) before it
 * mints the background grant. Otherwise a player whose 15-min JWT lapsed while he
 * only listened to the socket gets a refused mint on the GM's scene change, the
 * background silently falls back to the empty fill, and only F5 repairs it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SceneDocument } from "@fusion/shared";

const getToken = vi.fn<() => string | null>();
const getFreshToken = vi.fn<() => Promise<string | null>>();
const resolveAssetUrl = vi.fn<(...args: unknown[]) => Promise<string>>();
const assetsLoad = vi.fn<(url: string) => Promise<unknown>>();

vi.mock("pixi.js", () => {
  class Sprite {
    x = 0;
    y = 0;
    width = 0;
    height = 0;
    label = "";
    eventMode = "";
    destroy = vi.fn();
  }
  class Graphics {
    label = "";
    rect() {
      return this;
    }
    fill() {
      return this;
    }
    destroy = vi.fn();
  }
  return { Sprite, Graphics, Assets: { load: (url: string) => assetsLoad(url) } };
});
vi.mock("../../api.js", () => ({
  fusionApi: {
    getToken: () => getToken(),
    getFreshToken: () => getFreshToken(),
  },
}));
vi.mock("../../session.svelte.js", () => ({ session: { user: { id: "u1" } } }));
vi.mock("../../assets/assetApi.js", () => ({
  resolveAssetUrl: (...args: unknown[]) => resolveAssetUrl(...args),
}));
vi.mock("../GridRenderer.js", () => ({
  GridRenderer: { fromGridConfig: () => ({ id: "grid" }) },
}));

import { loadSceneDocument } from "../sceneLoader.js";

const scene = {
  _id: "scene-1",
  name: "Convés",
  width: 2048,
  height: 632,
  background: "/assets/deck.webp",
  backgroundColor: "#101018",
  grid: { type: 1, size: 84 },
} as unknown as SceneDocument;

function fakeCanvas() {
  const layer = { addChild: vi.fn() };
  return {
    layer,
    canvas: {
      getLayer: () => layer,
      setGrid: vi.fn(),
      clearGridIf: vi.fn(),
      setGridStrategy: vi.fn(),
      panTo: vi.fn(),
      fitToScene: vi.fn(),
    } as never,
  };
}

describe("loadSceneDocument — access token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The snapshot is DEAD; only the refreshed one is accepted.
    getToken.mockReturnValue("stale-jwt");
    getFreshToken.mockResolvedValue("fresh-jwt");
    resolveAssetUrl.mockImplementation((_path, token) =>
      token === "fresh-jwt"
        ? Promise.resolve("/assets/deck.webp?token=ok")
        : Promise.reject(new Error("Failed to get asset token (HTTP 401)")),
    );
    assetsLoad.mockResolvedValue({ texture: true });
  });

  it("mints the background grant with the refreshed token, never the stale snapshot", async () => {
    const { canvas, layer } = fakeCanvas();

    await loadSceneDocument(canvas, scene);

    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);
    expect(resolveAssetUrl.mock.calls[0]?.[1]).toBe("fresh-jwt");
    expect(assetsLoad).toHaveBeenCalledWith("/assets/deck.webp?token=ok");
    // The painted child is the background sprite, not the empty-fill fallback.
    const child = layer.addChild.mock.calls[0]?.[0] as { label: string };
    expect(child.label).toBe("scene:background");
  });
});

describe("loadSceneDocument — scene persisted without a grid block", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFreshToken.mockResolvedValue("fresh-jwt");
    resolveAssetUrl.mockResolvedValue("/assets/deck.webp?token=ok");
    assetsLoad.mockResolvedValue({ texture: true });
  });

  // Three of the five A Queda scenes have no `grid` block: the ruler and the area
  // templates silently vanished there because no measuring strategy was installed.
  it("still installs the fallback measuring grid so the ruler and areas work", async () => {
    const { canvas } = fakeCanvas();
    const noGrid = { ...scene, grid: undefined } as unknown as SceneDocument;

    await loadSceneDocument(canvas, noGrid);

    const setGridStrategy = (canvas as unknown as { setGridStrategy: ReturnType<typeof vi.fn> })
      .setGridStrategy;
    const strategy = setGridStrategy.mock.calls[0]?.[0] as { size?: number } | null;
    expect(strategy).not.toBeNull();
  });
});
