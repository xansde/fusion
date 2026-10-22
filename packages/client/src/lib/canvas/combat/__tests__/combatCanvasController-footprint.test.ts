/**
 * The turn marker and the targeting reticle wrap the token's whole footprint (fechamento 22/10/2026).
 *
 * Live: a Large (2x2) creature on its turn wore a one-cell ring on its top-left cell, and the reticle of a
 * targeted 2x2 token bracketed that same cell. Both are sized by the sprite's footprint now, not by the grid cell.
 * Fakes: TokenLayer (getSprite with the sprite's pixelSize), FusionCanvas (zoomTo only) and an empty mirror.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";
import { CombatCanvasController, type PreyMirrorLike } from "../combatCanvasController.js";
import { combatStore, getTargetingState } from "../../../combat/combatStore.svelte.js";
import { applyTargeted } from "../../../combat/targeting.js";

const GRID = 100;
const mirror: PreyMirrorLike = { getByType: <T>() => [] as T[] };

function setup() {
  const controls = new Container();
  const tokenLayer = {
    getSprite: (id: string) =>
      id === "tok-large"
        ? { container: { x: 200, y: 300 }, pixelSize: { w: 2 * GRID, h: 2 * GRID } }
        : id === "tok-medium"
          ? { container: { x: 600, y: 300 }, pixelSize: { w: GRID, h: GRID } }
          : undefined,
  };
  const canvas = { zoomTo: vi.fn(), camera: { scale: 1 } };
  const ctrl = new CombatCanvasController(
    canvas as never,
    tokenLayer as never,
    controls,
    GRID,
    true,
    "user-gm",
    mirror,
  );
  return { ctrl };
}

function runningOn(tokenId: string) {
  return {
    _id: "cb-1",
    started: true,
    ended: false,
    autoPan: false,
    activeCombatantId: "c-1",
    combatants: [{ _id: "c-1", tokenId }],
  } as never;
}

afterEach(() => {
  combatStore.combat = null;
  getTargetingState().byUser.clear();
});

describe("CombatCanvasController — markers follow the footprint", () => {
  it("the turn marker of a 2x2 token is drawn over its whole footprint", () => {
    const { ctrl } = setup();
    const marker = (
      ctrl as unknown as { _marker: { setActiveToken: (x: number, y: number, s: number) => void } }
    )._marker;
    const spy = vi.spyOn(marker, "setActiveToken");
    combatStore.combat = runningOn("tok-large");
    ctrl.tick(16);
    expect(spy).toHaveBeenLastCalledWith(200, 300, 2 * GRID);
  });

  it("a 1x1 token keeps the one-cell marker", () => {
    const { ctrl } = setup();
    const marker = (
      ctrl as unknown as { _marker: { setActiveToken: (x: number, y: number, s: number) => void } }
    )._marker;
    const spy = vi.spyOn(marker, "setActiveToken");
    combatStore.combat = runningOn("tok-medium");
    ctrl.tick(16);
    expect(spy).toHaveBeenLastCalledWith(600, 300, GRID);
  });

  it("the targeting reticle of a 2x2 token brackets its whole footprint", () => {
    const { ctrl } = setup();
    const targeting = (
      ctrl as unknown as { _targeting: { sync: (p: Array<{ gridSize: number }>) => void } }
    )._targeting;
    const spy = vi.spyOn(targeting, "sync");
    applyTargeted(getTargetingState(), "tok-large", true, "user-gm");
    ctrl.tick(16);
    const positions = spy.mock.lastCall?.[0] ?? [];
    expect(positions.map((p) => p.gridSize)).toEqual([2 * GRID]);
  });
});
