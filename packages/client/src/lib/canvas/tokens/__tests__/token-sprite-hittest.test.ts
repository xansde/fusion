/**
 * TokenSprite — can a click actually LAND on the token?
 *
 * Regression test for a bug found by playing, not by the suite (2026-08-07):
 * tokens rendered, `eventMode` was "static", the interaction manager was
 * constructed and wired — and no token could be selected or dragged by anyone.
 *
 * The cause is a PIXI rule that is easy to miss: an object is hit-tested only
 * if it owns a `hitArea` or implements `containsPoint` (Sprite, Graphics,
 * Mesh). `TokenSprite.container` is a plain Container, and every visual child
 * inside it is `eventMode: "none"` so the hit test never descends into them.
 * "static" declares the intent to receive events; it does not create a
 * clickable surface. Without a hitArea there is nothing to hit.
 *
 * What made it invisible: clicks then resolved to the token LAYER, which
 * TokenInteractionManager gives a catch-all hitArea, so `_getTokenIdFromTarget`
 * walked up from `layer:tokens`, found no `token:` label, and took every click
 * on a token for a click on empty canvas — deselect, no drag, no error.
 *
 * These tests run in the node environment: PIXI containers construct fine
 * without a renderer.
 */

import { describe, it, expect } from "vitest";
import { TokenSprite } from "../TokenSprite.js";
import { TokenDocumentSchema } from "@fusion/shared";
import type { TokenDocument } from "@fusion/shared";

const GRID = 100;

function makeToken(over: Partial<TokenDocument> = {}): TokenDocument {
  return TokenDocumentSchema.parse({
    _id: "tok0000000000001",
    name: "Tobias",
    x: 650,
    y: 650,
    width: 1,
    height: 1,
    ...over,
  });
}

describe("TokenSprite — clickable surface", () => {
  it("owns a hitArea — without one the sprite can never be a click target", () => {
    const sprite = new TokenSprite(makeToken(), GRID, true);
    expect(sprite.container.hitArea).not.toBeNull();
    expect(sprite.container.hitArea).toBeDefined();
  });

  it("declares eventMode static — intent to receive events", () => {
    const sprite = new TokenSprite(makeToken(), GRID, true);
    expect(sprite.container.eventMode).toBe("static");
  });

  it("covers the footprint of a 1x1 token, in local coordinates", () => {
    const sprite = new TokenSprite(makeToken(), GRID, true);
    const area = sprite.container.hitArea;
    // The container sits at the token's top-left, so local (0,0) is its corner.
    expect(area?.contains(GRID / 2, GRID / 2)).toBe(true); // center
    expect(area?.contains(1, 1)).toBe(true); // just inside the corner
    expect(area?.contains(GRID + 10, GRID / 2)).toBe(false); // past the right edge
    expect(area?.contains(-10, GRID / 2)).toBe(false); // left of the corner
  });

  it("covers the whole footprint of a 2x2 token, not just one cell", () => {
    const sprite = new TokenSprite(makeToken({ width: 2, height: 2 }), GRID, true);
    const area = sprite.container.hitArea;
    expect(area?.contains(GRID, GRID)).toBe(true); // center of a 2x2
    expect(area?.contains(GRID * 1.5, GRID * 1.5)).toBe(true); // far cell
    expect(area?.contains(GRID * 2 + 10, GRID)).toBe(false); // outside
  });

  it("follows the footprint when the token is resized", () => {
    const sprite = new TokenSprite(makeToken(), GRID, true);
    expect(sprite.container.hitArea?.contains(GRID * 1.5, GRID * 1.5)).toBe(false);

    sprite.update(makeToken({ width: 2, height: 2 }), GRID);

    // A stale hitArea would leave the grown token clickable at its old size.
    expect(sprite.container.hitArea?.contains(GRID * 1.5, GRID * 1.5)).toBe(true);
  });

  it("follows the grid size when the scene's cell size changes", () => {
    const sprite = new TokenSprite(makeToken(), GRID, true);
    sprite.update(makeToken(), 200);
    expect(sprite.container.hitArea?.contains(150, 150)).toBe(true);
  });

  it("keeps its children non-interactive — which is WHY the hitArea is required", () => {
    const sprite = new TokenSprite(makeToken(), GRID, true);
    // If this ever stops being true the hitArea may look redundant. It is not:
    // the assertion documents the reason it exists.
    for (const child of sprite.container.children) {
      expect(child.eventMode).toBe("none");
    }
  });
});
