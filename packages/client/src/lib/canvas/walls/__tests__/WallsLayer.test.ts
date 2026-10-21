/**
 * WallsLayer — the wall tool talks to the server in the ops the server really has
 * (#83: `walls: {$push}` was not an operator, so a drawn wall was never saved), Delete
 * removes the selected wall outside drawing mode too (#122: the key listener only
 * existed while drawing), and the snap follows the calibrated grid (`gridOffsetX/Y`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Wall } from "@fusion/shared";

const pixiStubs = vi.hoisted(() => {
  class StubContainer {
    label = "";
    eventMode = "auto";
    cursor = "";
    x = 0;
    y = 0;
    children: unknown[] = [];
    addChild(child: unknown): unknown {
      this.children.push(child);
      return child;
    }
    removeChildren(): void {
      this.children = [];
    }
    on(): this {
      return this;
    }
    destroy(): void {
      this.children = [];
    }
  }
  class StubGraphics extends StubContainer {
    moveTo(): this {
      return this;
    }
    lineTo(): this {
      return this;
    }
    circle(): this {
      return this;
    }
    fill(): this {
      return this;
    }
    stroke(): this {
      return this;
    }
  }
  class StubText extends StubContainer {
    anchor = { set: (): void => undefined };
  }
  class StubTextStyle {}
  return { StubContainer, StubGraphics, StubText, StubTextStyle };
});

vi.mock("pixi.js", () => ({
  Container: pixiStubs.StubContainer,
  Graphics: pixiStubs.StubGraphics,
  Text: pixiStubs.StubText,
  TextStyle: pixiStubs.StubTextStyle,
}));

const sent: Array<{ type: string; payload: unknown }> = [];
vi.mock("../../../docs/sendOp.js", () => ({
  sendOp: (_socket: unknown, envelope: { type: string; payload: unknown }): Promise<unknown> => {
    sent.push({ type: envelope.type, payload: envelope.payload });
    return Promise.resolve({});
  },
}));

const { WallsLayer } = await import("../WallsLayer.js");
const { buildWallCreateOp, buildWallDeleteOp, buildDoorStateOp } = await import("../wallOps.js");

const SCENE = "scene00000000001";

type Handler = (e: unknown) => void;

function fakeTarget(): {
  addEventListener: (t: string, h: Handler) => void;
  removeEventListener: (t: string, h: Handler) => void;
  dispatch: (t: string, e: unknown) => void;
  count: (t: string) => number;
} {
  const listeners = new Map<string, Handler[]>();
  return {
    addEventListener: (t, h) => {
      listeners.set(t, [...(listeners.get(t) ?? []), h]);
    },
    removeEventListener: (t, h) => {
      listeners.set(
        t,
        (listeners.get(t) ?? []).filter((x) => x !== h),
      );
    },
    dispatch: (t, e) => {
      for (const h of listeners.get(t) ?? []) h(e);
    },
    count: (t) => (listeners.get(t) ?? []).length,
  };
}

function makeWall(id: string): Wall {
  return {
    _id: id,
    a: { x: 0, y: 0 },
    b: { x: 100, y: 0 },
    move: "normal",
    sight: "normal",
    light: "normal",
    sound: "normal",
    dir: "both",
    doorType: "none",
    doorState: "closed",
  } as Wall;
}

const pointer = (x: number, y: number): unknown => ({
  button: 0,
  clientX: x,
  clientY: y,
  stopPropagation: (): void => undefined,
});

let win: ReturnType<typeof fakeTarget>;
let el: ReturnType<typeof fakeTarget> & {
  style: { cursor: string };
  getBoundingClientRect: () => { left: number; top: number };
};

function newLayer(isGm = true): InstanceType<typeof WallsLayer> {
  const layer = new WallsLayer(new pixiStubs.StubContainer() as never, SCENE, {} as never, isGm);
  layer.attachToElement(el as never);
  return layer;
}

beforeEach(() => {
  sent.length = 0;
  win = fakeTarget();
  vi.stubGlobal("window", win);
  el = {
    ...fakeTarget(),
    style: { cursor: "" },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("op shapes (what the server really implements)", () => {
  it("wall:create carries the wall under data and the scene under parent", () => {
    const op = buildWallCreateOp(SCENE, { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    expect(op.type).toBe("wall:create");
    expect(op.payload).toEqual({
      documentType: "Wall",
      data: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }],
      parent: { type: "Scene", id: SCENE },
    });
  });

  it("wall:delete carries the ids and the parent scene", () => {
    expect(buildWallDeleteOp(SCENE, ["w1", "w2"])).toEqual({
      type: "wall:delete",
      payload: { documentType: "Wall", ids: ["w1", "w2"], parent: { type: "Scene", id: SCENE } },
    });
  });

  it("a door change goes through scene:doorState", () => {
    expect(buildDoorStateOp(SCENE, "w1", "open")).toEqual({
      type: "scene:doorState",
      payload: { sceneId: SCENE, wallId: "w1", state: "open" },
    });
  });
});

describe("drawing a wall", () => {
  it("saves the wall with wall:create, never with a $push diff", async () => {
    const layer = newLayer();
    layer.setGrid(100, 0, 0);
    layer.startDrawing("normal");
    el.dispatch("pointerdown", pointer(100, 100));
    el.dispatch("pointerup", pointer(300, 100));
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("wall:create");
    const payload = sent[0]?.payload as { data: Array<Record<string, unknown>> };
    expect(payload.data[0]).toMatchObject({
      a: { x: 100, y: 100 },
      b: { x: 300, y: 100 },
      move: "normal",
    });
    expect(JSON.stringify(sent)).not.toContain("$push");
  });

  it("snaps to the calibrated grid, offset included", async () => {
    const layer = newLayer();
    // 100 px cells, padding 200, grid shifted 30/40 px into the map.
    layer.setGrid(100, 200, 200, 30, 40);
    layer.startDrawing("normal");
    el.dispatch("pointerdown", pointer(331, 241)); // nearest vertex: (330, 240)
    el.dispatch("pointerup", pointer(531, 441)); // nearest vertex: (530, 440)
    await Promise.resolve();
    const payload = sent[0]?.payload as { data: Array<{ a: unknown; b: unknown }> };
    expect(payload.data[0]?.a).toEqual({ x: 330, y: 240 });
    expect(payload.data[0]?.b).toEqual({ x: 530, y: 440 });
  });

  it("without an offset the lattice is the padding corner, as before", async () => {
    const layer = newLayer();
    layer.setGrid(100, 200, 200);
    layer.startDrawing("normal");
    el.dispatch("pointerdown", pointer(231, 249));
    el.dispatch("pointerup", pointer(431, 249));
    await Promise.resolve();
    const payload = sent[0]?.payload as { data: Array<{ a: unknown; b: unknown }> };
    expect(payload.data[0]?.a).toEqual({ x: 200, y: 200 });
    expect(payload.data[0]?.b).toEqual({ x: 400, y: 200 });
  });
});

describe("deleting the selected wall", () => {
  it("Delete works with a wall selected OUTSIDE drawing mode", async () => {
    const layer = newLayer();
    layer.setWalls([makeWall("wall000000000001")]);
    layer.toggleSelectWall("wall000000000001");
    expect(layer.isDrawing).toBe(false);

    win.dispatch("keydown", { key: "Delete", target: {} });
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "wall:delete",
      payload: {
        documentType: "Wall",
        ids: ["wall000000000001"],
        parent: { type: "Scene", id: SCENE },
      },
    });
  });

  it("does not fire while the user is typing in a field", async () => {
    const layer = newLayer();
    layer.setWalls([makeWall("wall000000000001")]);
    layer.toggleSelectWall("wall000000000001");
    win.dispatch("keydown", { key: "Backspace", target: { tagName: "INPUT" } });
    win.dispatch("keydown", { key: "Delete", target: { tagName: "TEXTAREA" } });
    win.dispatch("keydown", { key: "Delete", target: { isContentEditable: true } });
    await Promise.resolve();
    expect(sent).toHaveLength(0);
  });

  it("does nothing with no wall selected, and nothing for a player", async () => {
    const gm = newLayer();
    gm.setWalls([makeWall("wall000000000001")]);
    win.dispatch("keydown", { key: "Delete", target: {} });
    await Promise.resolve();
    expect(sent).toHaveLength(0);

    const player = newLayer(false);
    player.setWalls([makeWall("wall000000000001")]);
    player.toggleSelectWall("wall000000000001");
    win.dispatch("keydown", { key: "Delete", target: {} });
    await Promise.resolve();
    expect(sent).toHaveLength(0);
  });

  it("Escape still ends the drawing mode", () => {
    const layer = newLayer();
    layer.startDrawing("normal");
    win.dispatch("keydown", { key: "Escape", target: {} });
    expect(layer.isDrawing).toBe(false);
  });

  it("destroy() removes the key listener", () => {
    const layer = newLayer();
    expect(win.count("keydown")).toBe(1);
    layer.destroy();
    expect(win.count("keydown")).toBe(0);
  });

  it("starting and stopping the drawing does not stack key listeners", () => {
    const layer = newLayer();
    layer.startDrawing("normal");
    layer.stopDrawing();
    layer.startDrawing("normal");
    expect(win.count("keydown")).toBe(1);
  });
});
