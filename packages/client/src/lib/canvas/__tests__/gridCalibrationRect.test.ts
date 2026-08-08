/**
 * gridCalibrationRect — grabbing and dragging the calibration box.
 *
 * The whole point of the tool is fine alignment: the GM drags a corner a few
 * pixels at a time until the box sits on the cell printed in the map image.
 * That makes "which handle did I grab" and "where does this drag put it" the
 * two operations that decide whether the tool feels precise or fights back.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeRect,
  cornerPoint,
  hitTestHandle,
  applyHandleDrag,
  defaultRect,
} from "../gridCalibrationRect.js";

const RECT = { x: 100, y: 100, width: 200, height: 200 };
const TOL = 10;

describe("normalizeRect", () => {
  it("leaves a well-formed rectangle alone", () => {
    expect(normalizeRect(RECT)).toEqual(RECT);
  });

  it("flips a rectangle dragged up and to the left", () => {
    expect(normalizeRect({ x: 300, y: 300, width: -200, height: -200 })).toEqual(RECT);
  });

  it("flips a single inverted axis", () => {
    expect(normalizeRect({ x: 300, y: 100, width: -200, height: 200 })).toEqual(RECT);
  });
});

describe("cornerPoint", () => {
  it("names the four corners", () => {
    expect(cornerPoint(RECT, "nw")).toEqual({ x: 100, y: 100 });
    expect(cornerPoint(RECT, "ne")).toEqual({ x: 300, y: 100 });
    expect(cornerPoint(RECT, "sw")).toEqual({ x: 100, y: 300 });
    expect(cornerPoint(RECT, "se")).toEqual({ x: 300, y: 300 });
  });

  it("names them the same way on an inverted rectangle", () => {
    const inverted = { x: 300, y: 300, width: -200, height: -200 };
    expect(cornerPoint(inverted, "nw")).toEqual({ x: 100, y: 100 });
    expect(cornerPoint(inverted, "se")).toEqual({ x: 300, y: 300 });
  });
});

describe("hitTestHandle", () => {
  it("grabs a corner when the press is on it", () => {
    expect(hitTestHandle(RECT, { x: 100, y: 100 }, TOL)).toBe("nw");
    expect(hitTestHandle(RECT, { x: 300, y: 300 }, TOL)).toBe("se");
  });

  it("grabs a corner from just inside the tolerance", () => {
    expect(hitTestHandle(RECT, { x: 106, y: 106 }, TOL)).toBe("nw");
  });

  it("prefers the corner over the body when the press could be either", () => {
    // Inside the rectangle AND within tolerance of nw: resizing is what the
    // GM meant; moving would throw away the alignment they already had.
    expect(hitTestHandle(RECT, { x: 103, y: 103 }, TOL)).toBe("nw");
  });

  it("prefers the NEAREST corner when two are within tolerance", () => {
    const tiny = { x: 0, y: 0, width: 12, height: 12 };
    expect(hitTestHandle(tiny, { x: 1, y: 1 }, 20)).toBe("nw");
    expect(hitTestHandle(tiny, { x: 11, y: 11 }, 20)).toBe("se");
  });

  it("grabs the body from the middle", () => {
    expect(hitTestHandle(RECT, { x: 200, y: 200 }, TOL)).toBe("move");
  });

  it("grabs nothing outside", () => {
    expect(hitTestHandle(RECT, { x: 400, y: 400 }, TOL)).toBeNull();
    expect(hitTestHandle(RECT, { x: 200, y: 320 }, TOL)).toBeNull();
  });

  it("respects the tolerance it is given — the caller scales it by zoom", () => {
    // At 4x zoom the caller passes a quarter of the screen radius, so a press
    // that would grab at 1x must miss here.
    expect(hitTestHandle(RECT, { x: 108, y: 100 }, TOL)).toBe("nw");
    expect(hitTestHandle(RECT, { x: 108, y: 100 }, TOL / 4)).toBe("move");
  });
});

describe("applyHandleDrag", () => {
  it("moves the whole box without resizing it", () => {
    const moved = applyHandleDrag(RECT, "move", { x: 50, y: -30 });
    expect(moved).toEqual({ x: 150, y: 70, width: 200, height: 200 });
  });

  it("drags the NW corner and pins SE", () => {
    const resized = applyHandleDrag(RECT, "nw", { x: 20, y: 20 });
    expect(resized).toEqual({ x: 120, y: 120, width: 180, height: 180 });
    expect(cornerPoint(resized, "se")).toEqual({ x: 300, y: 300 });
  });

  it("drags the SE corner and pins NW", () => {
    const resized = applyHandleDrag(RECT, "se", { x: 20, y: 20 });
    expect(resized).toEqual({ x: 100, y: 100, width: 220, height: 220 });
    expect(cornerPoint(resized, "nw")).toEqual({ x: 100, y: 100 });
  });

  it("drags NE: right edge and top edge move, the other two hold", () => {
    const resized = applyHandleDrag(RECT, "ne", { x: 20, y: -20 });
    expect(resized).toEqual({ x: 100, y: 80, width: 220, height: 220 });
    expect(cornerPoint(resized, "sw")).toEqual({ x: 100, y: 300 });
  });

  it("drags SW: left edge and bottom edge move, the other two hold", () => {
    const resized = applyHandleDrag(RECT, "sw", { x: -20, y: 20 });
    expect(resized).toEqual({ x: 80, y: 100, width: 220, height: 220 });
    expect(cornerPoint(resized, "ne")).toEqual({ x: 300, y: 100 });
  });

  it("survives a corner dragged past its opposite", () => {
    const flipped = applyHandleDrag(RECT, "nw", { x: 300, y: 300 });
    expect(flipped.width).toBeGreaterThan(0);
    expect(flipped.height).toBeGreaterThan(0);
    expect(flipped).toEqual({ x: 300, y: 300, width: 100, height: 100 });
  });

  it("measures from the drag start, so repeating a delta does not accumulate", () => {
    // Both calls pass the ORIGINAL rect, as the adapter does every frame.
    const once = applyHandleDrag(RECT, "move", { x: 10, y: 10 });
    const again = applyHandleDrag(RECT, "move", { x: 10, y: 10 });
    expect(again).toEqual(once);
  });

  it("is a no-op for a zero drag", () => {
    for (const handle of ["nw", "ne", "sw", "se", "move"] as const) {
      expect(applyHandleDrag(RECT, handle, { x: 0, y: 0 })).toEqual(RECT);
    }
  });
});

describe("defaultRect", () => {
  it("is a square centered where it was asked for", () => {
    const rect = defaultRect({ x: 500, y: 400 }, 100);
    expect(rect).toEqual({ x: 450, y: 350, width: 100, height: 100 });
    expect(rect.width).toBe(rect.height);
  });
});
