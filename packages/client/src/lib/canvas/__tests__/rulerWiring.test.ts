/**
 * rulerWiring — guards that the ruler is REACHABLE from the table.
 *
 * Source-level on purpose (the client suite runs in the node environment, so it
 * cannot mount Svelte + PIXI): a fully tested ruler that nothing constructs is a
 * failure this repo has already had, so assert the call-sites exist.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const table = read("../../../components/TableScreen.svelte");
const button = read("../../../components/RulerToolButton.svelte");
const loader = read("../sceneLoader.ts");

describe("TableScreen wires the ruler", () => {
  it("attaches the ruler with the scene's grid strategy and the controls layer", () => {
    expect(table).toMatch(/attachRuler\(\{/);
    expect(table).toMatch(/canvas\.gridStrategy/);
    expect(table).toMatch(/canvas\.getLayer\("controls"\)/);
  });

  it("disposes the ruler on scene teardown", () => {
    expect(table).toMatch(/_disposeRuler\?\.\(\)/);
  });

  it("mounts the visible ruler button", () => {
    expect(table).toMatch(/<RulerToolButton/);
  });
});

describe("the ruler button", () => {
  it("toggles the shared tool store and carries the tooltip", () => {
    expect(button).toMatch(/toggleRulerTool/);
    expect(button).toMatch(/Régua \(segure R\)/);
    expect(button).toMatch(/aria-pressed=\{rulerTool\.active\}/);
  });
});

describe("sceneLoader hands the grid geometry to the canvas", () => {
  it("builds a GridStrategy and installs it", () => {
    expect(loader).toMatch(/createGridStrategy\(/);
    expect(loader).toMatch(/canvas\.setGridStrategy\(/);
  });
});
