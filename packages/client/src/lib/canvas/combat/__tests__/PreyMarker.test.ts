/**
 * PreyMarker.test.ts — the Prey seal on the controls layer (BHR-F3-07).
 * PIXI display objects construct fine in node; only rendering needs a browser.
 */

import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { PreyMarkerLayer, computeSealDiamond } from "../PreyMarker.js";

const sealsOf = (parent: Container) =>
  parent.children.filter((c) => (c.label ?? "").startsWith("preySeal:")).map((c) => c.label);

describe("computeSealDiamond", () => {
  it("sits inside the token's top-right corner", () => {
    const d = computeSealDiamond(100, 200, 100, 0.3);
    const xs = [d[0]!, d[2]!, d[4]!, d[6]!];
    const ys = [d[1]!, d[3]!, d[5]!, d[7]!];
    expect(Math.max(...xs)).toBeLessThanOrEqual(200);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(100 + 100 * 0.7 - 1e-9);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(200);
    expect(Math.max(...ys)).toBeLessThanOrEqual(200 + 100 * 0.3 + 1e-9);
  });
});

describe("PreyMarkerLayer", () => {
  const pos = (tokenId: string, label = "Presa de Bhrotto") => ({
    tokenId,
    x: 0,
    y: 0,
    gridSize: 100,
    label,
  });

  it("draws one seal per marked token and removes it when the mark leaves", () => {
    const parent = new Container();
    const layer = new PreyMarkerLayer(parent);
    layer.sync([pos("t1"), pos("t2")]);
    expect(sealsOf(parent)).toEqual(["preySeal:t1", "preySeal:t2"]);
    layer.sync([pos("t2")]);
    expect(sealsOf(parent)).toEqual(["preySeal:t2"]);
    layer.sync([]);
    expect(sealsOf(parent)).toEqual([]);
  });

  it("exposes the tooltip text given by the caller and refreshes it", () => {
    const parent = new Container();
    const layer = new PreyMarkerLayer(parent);
    layer.sync([pos("t1", "Presa de Bhrotto")]);
    expect(layer.tooltipOf("t1")).toBe("Presa de Bhrotto");
    layer.sync([pos("t1", "Presa de Outro")]);
    expect(layer.tooltipOf("t1")).toBe("Presa de Outro");
    expect(layer.tooltipOf("nope")).toBeNull();
  });

  it("follows the token when it moves", () => {
    const parent = new Container();
    const layer = new PreyMarkerLayer(parent);
    layer.sync([pos("t1")]);
    layer.sync([{ ...pos("t1"), x: 300, y: 400 }]);
    const seal = parent.children[0]!;
    expect(seal.x).toBe(300);
    expect(seal.y).toBe(400);
  });

  it("destroy removes everything and is idempotent", () => {
    const parent = new Container();
    const layer = new PreyMarkerLayer(parent);
    layer.sync([pos("t1")]);
    layer.destroy();
    layer.destroy();
    expect(sealsOf(parent)).toEqual([]);
  });
});
