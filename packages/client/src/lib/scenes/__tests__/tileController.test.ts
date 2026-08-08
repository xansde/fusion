/**
 * tileController — the ops the GM sends to compose a scene from several images.
 *
 * These assert the WIRE: which op, which payload, in which order. That is the
 * part that decides whether a click in the panel actually reaches the scene —
 * the repeated failure in this codebase has been a complete chain with nothing
 * connected to it, so "the function builds the right op" is the assertion that
 * matters here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TileDocument } from "@fusion/shared";

const sendOpMock = vi.fn(async (_socket: unknown, _envelope: unknown) => ({}));
vi.mock("../../docs/sendOp.js", () => ({
  sendOp: (socket: unknown, envelope: unknown) => sendOpMock(socket, envelope) as unknown,
  OpError: class extends Error {},
}));

const {
  addTile,
  setTileHidden,
  updateTile,
  deleteTile,
  reorderTile,
  sortTiles,
  tilesOf,
  nextTileSort,
  defaultTileRect,
  alignTileToMap,
} = await import("../tileController.js");

const SOCKET = {} as never;
const SCENE = "scene00000000001";

function tile(over: Partial<TileDocument> = {}): TileDocument {
  return {
    _id: "tile000000000001",
    name: "",
    texture: "/assets/a.webp",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    alpha: 1,
    hidden: false,
    sort: 0,
    ...over,
  } as TileDocument;
}

/** The envelope of the Nth sendOp call. */
function envelope(n = 0): { type: string; payload: Record<string, unknown> } {
  return sendOpMock.mock.calls[n]?.[1] as never;
}

beforeEach(() => {
  sendOpMock.mockClear();
});

describe("adding an image", () => {
  const form = {
    name: "Porão",
    texture: "/assets/porao.webp",
    x: 100,
    y: 200,
    width: 800,
    height: 600,
  };

  it("sends a doc:create parented to the scene", async () => {
    await addTile(SOCKET, SCENE, form, 3);
    expect(envelope().type).toBe("doc:create");
    expect(envelope().payload["documentType"]).toBe("Tile");
    expect(envelope().payload["parent"]).toEqual({ type: "Scene", id: SCENE });
  });

  it("carries the geometry the GM typed", async () => {
    await addTile(SOCKET, SCENE, form, 3);
    const [data] = envelope().payload["data"] as Array<Record<string, unknown>>;
    expect(data).toMatchObject({ x: 100, y: 200, width: 800, height: 600, sort: 3 });
  });

  it("starts the image HIDDEN — adding the reveal must not perform it", async () => {
    await addTile(SOCKET, SCENE, form, 0);
    const [data] = envelope().payload["data"] as Array<Record<string, unknown>>;
    expect(data?.["hidden"]).toBe(true);
  });

  it("sends no _id — embedded ids are the server's to mint", async () => {
    await addTile(SOCKET, SCENE, form, 0);
    const [data] = envelope().payload["data"] as Array<Record<string, unknown>>;
    expect(data).not.toHaveProperty("_id");
  });

  it("trims the name and turns an empty texture into null", async () => {
    await addTile(SOCKET, SCENE, { ...form, name: "  Térreo  ", texture: "   " }, 0);
    const [data] = envelope().payload["data"] as Array<Record<string, unknown>>;
    expect(data?.["name"]).toBe("Térreo");
    expect(data?.["texture"]).toBeNull();
  });
});

describe("showing and hiding", () => {
  it("reveals with a doc:update on the embedded tile", async () => {
    await setTileHidden(SOCKET, SCENE, "tile000000000001", false);
    expect(envelope().type).toBe("doc:update");
    const [update] = envelope().payload["updates"] as Array<Record<string, unknown>>;
    expect(update?.["_id"]).toBe("tile000000000001");
    expect(update?.["diff"]).toEqual({ hidden: false });
    expect(update?.["embedded"]).toEqual({ type: "Tile", id: SCENE });
  });

  it("hides again with the opposite value", async () => {
    await setTileHidden(SOCKET, SCENE, "tile000000000001", true);
    const [update] = envelope().payload["updates"] as Array<Record<string, unknown>>;
    expect(update?.["diff"]).toEqual({ hidden: true });
  });

  it("passes an arbitrary patch through untouched", async () => {
    await updateTile(SOCKET, SCENE, "tile000000000001", { alpha: 0.5, name: "Névoa" });
    const [update] = envelope().payload["updates"] as Array<Record<string, unknown>>;
    expect(update?.["diff"]).toEqual({ alpha: 0.5, name: "Névoa" });
  });
});

describe("removing an image", () => {
  it("sends a doc:delete parented to the scene", async () => {
    await deleteTile(SOCKET, SCENE, "tile000000000001");
    expect(envelope().type).toBe("doc:delete");
    expect(envelope().payload["ids"]).toEqual(["tile000000000001"]);
    expect(envelope().payload["parent"]).toEqual({ type: "Scene", id: SCENE });
  });
});

describe("reordering", () => {
  const bottom = tile({ _id: "tileBottom00000a", sort: 0 });
  const middle = tile({ _id: "tileMiddle00000b", sort: 1 });
  const top = tile({ _id: "tileTop00000000c", sort: 2 });
  const stack = [bottom, middle, top];

  it("swaps sort with the neighbour above", async () => {
    await reorderTile(SOCKET, SCENE, stack, middle._id, "up");
    expect(sendOpMock).toHaveBeenCalledTimes(2);

    const first = (envelope(0).payload["updates"] as Array<Record<string, unknown>>)[0];
    const second = (envelope(1).payload["updates"] as Array<Record<string, unknown>>)[0];
    expect(first).toMatchObject({ _id: middle._id, diff: { sort: 2 } });
    expect(second).toMatchObject({ _id: top._id, diff: { sort: 1 } });
  });

  it("swaps with the neighbour below", async () => {
    await reorderTile(SOCKET, SCENE, stack, middle._id, "down");
    const first = (envelope(0).payload["updates"] as Array<Record<string, unknown>>)[0];
    expect(first).toMatchObject({ _id: middle._id, diff: { sort: 0 } });
  });

  it("does nothing at the top of the stack", async () => {
    await reorderTile(SOCKET, SCENE, stack, top._id, "up");
    expect(sendOpMock).not.toHaveBeenCalled();
  });

  it("does nothing at the bottom", async () => {
    await reorderTile(SOCKET, SCENE, stack, bottom._id, "down");
    expect(sendOpMock).not.toHaveBeenCalled();
  });

  it("does nothing for a tile that is not in the scene", async () => {
    await reorderTile(SOCKET, SCENE, stack, "tileGhost000000z", "up");
    expect(sendOpMock).not.toHaveBeenCalled();
  });

  it("breaks a tie instead of swapping two equal sorts into a no-op", async () => {
    const tied = [
      tile({ _id: "tileA00000000001", sort: 4 }),
      tile({ _id: "tileB00000000002", sort: 4 }),
    ];
    await reorderTile(SOCKET, SCENE, tied, "tileA00000000001", "up");
    const first = (envelope(0).payload["updates"] as Array<Record<string, unknown>>)[0];
    expect((first?.["diff"] as { sort: number }).sort).toBeGreaterThan(4);
  });
});

describe("reading the stack", () => {
  it("orders bottom first, matching the canvas", () => {
    const out = sortTiles([
      tile({ _id: "tileC00000000003", sort: 9 }),
      tile({ _id: "tileD00000000004", sort: 2 }),
    ]);
    expect(out.map((t) => t.sort)).toEqual([2, 9]);
  });

  it("breaks ties by id so the list does not reshuffle between renders", () => {
    const a = tile({ _id: "tileA00000000001", sort: 1 });
    const b = tile({ _id: "tileB00000000002", sort: 1 });
    expect(sortTiles([b, a]).map((t) => t._id)).toEqual([a._id, b._id]);
    expect(sortTiles([a, b]).map((t) => t._id)).toEqual([a._id, b._id]);
  });

  it("reads tiles off a scene, and survives one persisted before tiles existed", () => {
    expect(tilesOf({ tiles: [tile()] } as never)).toHaveLength(1);
    expect(tilesOf({} as never)).toEqual([]);
    expect(tilesOf(null)).toEqual([]);
  });

  it("puts a new image on top of the stack", () => {
    expect(nextTileSort([])).toBe(0);
    expect(nextTileSort([tile({ sort: 0 }), tile({ sort: 7 })])).toBe(8);
  });
});

describe("where a new image lands", () => {
  // The bug this pins: scene coordinates do not start at (0,0). sceneLoader
  // draws the background at (padX, padY), so an image created at the origin is
  // off by exactly one padding — 250px on a 1000×1000 scene at the default
  // 0.25. It looked right in every unit test and wrong on the very first map.
  it("starts at the padding border, where the background actually is", () => {
    expect(defaultTileRect({ width: 1000, height: 1000, padding: 0.25 })).toEqual({
      x: 250,
      y: 250,
      width: 1000,
      height: 1000,
    });
  });

  it("covers the map exactly — same size as the scene", () => {
    const rect = defaultTileRect({ width: 4000, height: 3000, padding: 0.25 });
    expect(rect.width).toBe(4000);
    expect(rect.height).toBe(3000);
  });

  it("lands at the origin only when the scene has no padding", () => {
    expect(defaultTileRect({ width: 800, height: 600, padding: 0 })).toMatchObject({ x: 0, y: 0 });
  });

  it("treats a scene persisted without padding as having none", () => {
    expect(defaultTileRect({ width: 800, height: 600 })).toMatchObject({ x: 0, y: 0 });
  });

  it("rounds to whole pixels, like sceneLoader does", () => {
    expect(defaultTileRect({ width: 1001, height: 1001, padding: 0.25 })).toMatchObject({
      x: 250,
      y: 250,
    });
  });

  it("is what addTile is given, so a new image is aligned from the start", async () => {
    const scene = { _id: "scene00000000001", width: 1000, height: 1000, padding: 0.25 } as never;
    const rect = defaultTileRect({ width: 1000, height: 1000, padding: 0.25 });
    await addTile(SOCKET, "scene00000000001", { name: "x", texture: "/a.webp", ...rect }, 0);
    const [data] = envelope().payload["data"] as Array<Record<string, unknown>>;
    expect(data).toMatchObject(rect);
    expect(scene).toBeTruthy();
  });
});

describe("aligning an existing image back onto the map", () => {
  it("patches position and size to the background rectangle", async () => {
    const scene = {
      _id: "scene00000000001",
      width: 1000,
      height: 1000,
      padding: 0.25,
    } as never;

    await alignTileToMap(SOCKET, scene, "tile000000000001");

    expect(envelope().type).toBe("doc:update");
    const [update] = envelope().payload["updates"] as Array<Record<string, unknown>>;
    expect(update?.["_id"]).toBe("tile000000000001");
    expect(update?.["diff"]).toEqual({ x: 250, y: 250, width: 1000, height: 1000 });
    expect(update?.["embedded"]).toEqual({ type: "Tile", id: "scene00000000001" });
  });
});
