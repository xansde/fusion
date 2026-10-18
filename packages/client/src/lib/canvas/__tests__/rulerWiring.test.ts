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
    expect(table).toMatch(/_ruler\?\.dispose\(\)/);
  });

  it("mounts the visible ruler button", () => {
    expect(table).toMatch(/<RulerToolButton/);
  });
});

describe("the ruler button", () => {
  it("drives the shared tool store and carries the tooltip", () => {
    expect(button).toMatch(/rulerTool\.mode/);
    expect(button).toMatch(/Régua \(segure R\)/);
    expect(button).toMatch(/aria-pressed=\{rulerTool\.mode !== null\}/);
  });

  it("offers every area next to the ruler", () => {
    const tool = read("../../presence/templateTool.ts");
    for (const label of ["Régua", "Explosão", "Cone", "Linha", "Emanação"]) {
      expect(tool).toContain(label);
    }
  });
});

describe("the movement ruler hangs on the token drag", () => {
  it("TableScreen feeds the drag to the ruler with the actor speed", () => {
    expect(table).toMatch(/onDrag: \(info\)/);
    expect(table).toMatch(/_ruler\?\.showDrag\(/);
    expect(table).toMatch(/actorSpeedFt\(/);
  });

  it("the interaction manager reports drag moves and the end of the drag", () => {
    const tim = read("../tokens/TokenInteractionManager.ts");
    expect(tim).toMatch(/this\._opts\.onDrag\?\.\(\{/);
    expect(tim).toMatch(/this\._opts\.onDrag\?\.\(null\)/);
  });
});

describe("sceneLoader hands the grid geometry to the canvas", () => {
  it("builds a GridStrategy and installs it", () => {
    expect(loader).toMatch(/createGridStrategy\(/);
    expect(loader).toMatch(/canvas\.setGridStrategy\(/);
  });
});

describe("TableScreen wires the map ping", () => {
  it("attaches the ping on the controls layer, yielding to the ruler tools", () => {
    expect(table).toMatch(/attachPing\(\{/);
    expect(table).toMatch(/isBusy: \(\) => _ruler\?\.isBusy\(\)/);
    expect(table).toMatch(/_disposePing\?\.\(\)/);
  });
});
