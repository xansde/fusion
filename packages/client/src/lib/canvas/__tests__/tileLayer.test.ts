/**
 * TileLayer — reconciling the images a scene is composed from.
 *
 * The interesting behavior is not "draws a picture", it is what happens on the
 * updates: showing one tile must not re-download the others, replacing an
 * image must not leave the old one on screen, and a texture that arrives after
 * the scene was torn down must not write into a destroyed sprite.
 *
 * PIXI is stubbed at the module boundary — this asserts the reconciliation,
 * not the GPU.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- PIXI stub -------------------------------------------------------------

class FakeSprite {
  label = "";
  eventMode = "none";
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  rotation = 0;
  alpha = 1;
  zIndex = 0;
  destroyed = false;
  texture: unknown;
  anchor = { set: vi.fn() };
  constructor(texture: unknown) {
    this.texture = texture;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

class FakeContainer {
  label = "";
  eventMode = "none";
  sortableChildren = false;
  children: FakeSprite[] = [];
  destroyed = false;
  addChild(child: FakeSprite | FakeContainer): void {
    this.children.push(child as FakeSprite);
  }
  sortChildren(): void {
    this.children.sort((a, b) => a.zIndex - b.zIndex);
  }
  destroy(): void {
    this.destroyed = true;
  }
}

const loadMock = vi.fn(async (url: string) => `texture:${url}`);

vi.mock("pixi.js", () => ({
  Container: FakeContainer,
  Sprite: FakeSprite,
  Texture: { EMPTY: "EMPTY" },
  Assets: {
    load: (url: string) => loadMock(url),
  },
}));

const { TileLayer } = await import("../TileLayer.js");
type TileLayerType = InstanceType<typeof TileLayer>;

// --- helpers ---------------------------------------------------------------

let idCounter = 0;
function tile(over: Partial<Record<string, unknown>> = {}): never {
  const id = String(over["_id"] ?? `tile${String(++idCounter).padStart(12, "0")}`);
  return {
    _id: id,
    name: "",
    texture: "/assets/map.webp",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    alpha: 1,
    hidden: false,
    sort: 0,
    ...over,
  } as never;
}

const resolve = async (path: string): Promise<string> => `signed${path}`;

function makeLayer(): { layer: TileLayerType; sprites: () => FakeSprite[] } {
  const parent = new FakeContainer();
  const layer = new TileLayer(parent as never, resolve);
  // The layer adds its own root container to the parent; the sprites live in
  // that root, not directly under the parent.
  const root = parent.children[0] as unknown as FakeContainer;
  return { layer, sprites: () => root.children };
}

beforeEach(() => {
  loadMock.mockClear();
  idCounter = 0;
});

// --- tests -----------------------------------------------------------------

describe("drawing tiles", () => {
  it("creates one sprite per tile", () => {
    const { layer } = makeLayer();
    layer.sync([tile(), tile(), tile()]);
    expect(layer.count).toBe(3);
  });

  it("loads each texture through the resolver, not the raw path", async () => {
    const { layer } = makeLayer();
    layer.sync([tile({ texture: "/assets/porao.webp" })]);
    await Promise.resolve();
    await Promise.resolve();
    expect(loadMock).toHaveBeenCalledWith("signed/assets/porao.webp");
  });

  it("draws a tile with no texture without trying to load one", () => {
    const { layer } = makeLayer();
    layer.sync([tile({ texture: null })]);
    expect(layer.count).toBe(1);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("places by center so rotation turns about the middle", () => {
    const { layer, sprites } = makeLayer();
    layer.sync([tile({ x: 200, y: 100, width: 400, height: 200 })]);
    const sprite = sprites()[0];
    expect(sprite?.x).toBe(400);
    expect(sprite?.y).toBe(200);
  });

  it("converts rotation from degrees to radians", () => {
    const { layer, sprites } = makeLayer();
    layer.sync([tile({ rotation: 90 })]);
    expect(sprites()[0]?.rotation).toBeCloseTo(Math.PI / 2, 6);
  });

  it("orders by sort, so a higher tile draws on top", () => {
    const { layer, sprites } = makeLayer();
    layer.sync([
      tile({ _id: "tileTop00000000a", sort: 5 }),
      tile({ _id: "tileBot00000000b", sort: 1 }),
    ]);
    expect(sprites().map((c) => c.label)).toEqual([
      "tile:tileBot00000000b",
      "tile:tileTop00000000a",
    ]);
  });
});

describe("updating tiles", () => {
  it("moves a tile in place instead of rebuilding it", async () => {
    const { layer } = makeLayer();
    const first = tile({ _id: "tileMove000000a1" });
    layer.sync([first]);
    await Promise.resolve();
    loadMock.mockClear();

    layer.sync([tile({ _id: "tileMove000000a1", x: 500 })]);
    await Promise.resolve();

    // The whole point: toggling or nudging a tile must not re-download it.
    expect(loadMock).not.toHaveBeenCalled();
    expect(layer.count).toBe(1);
  });

  it("rebuilds when the image itself changes", async () => {
    const { layer } = makeLayer();
    layer.sync([tile({ _id: "tileSwap000000b1", texture: "/assets/before.webp" })]);
    await Promise.resolve();
    loadMock.mockClear();

    layer.sync([tile({ _id: "tileSwap000000b1", texture: "/assets/after.webp" })]);
    await Promise.resolve();
    await Promise.resolve();

    expect(loadMock).toHaveBeenCalledWith("signed/assets/after.webp");
    expect(layer.count).toBe(1);
  });

  it("removes a tile that left the scene", () => {
    const { layer } = makeLayer();
    const keep = tile({ _id: "tileKeep000000c1" });
    layer.sync([keep, tile({ _id: "tileGone000000c2" })]);
    expect(layer.count).toBe(2);

    layer.sync([keep]);
    expect(layer.count).toBe(1);
  });

  it("destroys the sprite of a removed tile rather than orphaning it", () => {
    const { layer, sprites } = makeLayer();
    layer.sync([tile({ _id: "tileGone000000d1" })]);
    const sprite = sprites()[0];
    layer.sync([]);
    expect(sprite?.destroyed).toBe(true);
  });

  it("handles a tile appearing — which is what showing a hidden one looks like", () => {
    // Players never receive hidden tiles, so a reveal arrives as a new tile.
    const { layer } = makeLayer();
    layer.sync([]);
    expect(layer.count).toBe(0);
    layer.sync([tile({ _id: "tileReveal0000e1" })]);
    expect(layer.count).toBe(1);
  });
});

describe("teardown", () => {
  it("drops a texture that arrives after destroy instead of writing to a dead sprite", async () => {
    const { layer, sprites } = makeLayer();
    layer.sync([tile({ _id: "tileLate000000f1" })]);
    const sprite = sprites()[0];
    const before = sprite?.texture;

    layer.destroy();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sprite?.texture).toBe(before);
  });

  it("is safe to sync after destroy", () => {
    const { layer } = makeLayer();
    layer.destroy();
    expect(() => {
      layer.sync([tile()]);
    }).not.toThrow();
  });

  it("is safe to destroy twice", () => {
    const { layer } = makeLayer();
    layer.destroy();
    expect(() => {
      layer.destroy();
    }).not.toThrow();
  });
});

describe("a texture that fails to load", () => {
  it("logs instead of failing silently — an invisible tile looks like a hidden one", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    loadMock.mockRejectedValueOnce(new Error("404"));

    const { layer } = makeLayer();
    layer.sync([tile({ texture: "/assets/missing.webp" })]);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
