/**
 * canvasWiring — guards that the canvas interactions are actually REACHABLE.
 *
 * This is a source-level assertion on purpose, and it is worth the ugliness.
 *
 * Three times now a canvas feature has shipped fully implemented, fully unit
 * tested and completely unusable, because nothing constructed it:
 *
 *   1. the target marker — full chain end to end, no gesture on the map;
 *   2. deleteAsset — exported, no button ever called it;
 *   3. TokenInteractionManager and RulerStateMachine — both with green test
 *      files, neither ever constructed in production. Tokens rendered with
 *      eventMode="static" and could not be dragged by anyone; the ruler could
 *      not be started, so the remote-ruler receive path never ran either.
 *      Found by playing the world on 2026-08-07, not by the suite.
 *
 * Every unit test in this repo asks "does this piece work?". None asked "can a
 * person reach it?". A test that mounts Svelte + PIXI + a socket would answer
 * that properly but needs a browser environment the client suite does not have
 * (environment: "node"). Until it does, this asserts the cheap half: the
 * wiring call-sites exist in the component that owns the canvas.
 *
 * If you renamed something and this failed: do not delete the assertion —
 * point it at the new call-site. A green suite with an unreachable feature is
 * exactly the failure this file exists to make loud.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TABLE_SCREEN = fileURLToPath(
  new URL("../../../components/TableScreen.svelte", import.meta.url),
);

const source = readFileSync(TABLE_SCREEN, "utf8");

describe("TableScreen wires the canvas interactions", () => {
  it("constructs the TokenInteractionManager — otherwise no token can be dragged", () => {
    expect(source).toMatch(/new TokenInteractionManager\(/);
  });

  it("destroys the TokenInteractionManager — its window keydown listener leaks otherwise", () => {
    expect(source).toMatch(/tokenInteraction\?\.destroy\(\)/);
  });

  it("attaches the ruler — otherwise no measurement can be started", () => {
    expect(source).toMatch(/attachRuler\(/);
  });

  it("disposes the ruler on scene switch", () => {
    expect(source).toMatch(/disposeRuler\?\.\(\)/);
  });

  it("feeds token interaction the scene's grid strategy, not a hardcoded size", () => {
    expect(source).toMatch(/canvas\.gridStrategy/);
  });
});
