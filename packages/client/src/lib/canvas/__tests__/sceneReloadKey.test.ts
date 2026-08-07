/**
 * sceneReloadKey — what must NOT trigger a scene reload.
 *
 * Regression test for a bug found by playing (2026-08-07): with token dragging
 * finally working, the map blinked out on every drag. Tokens are embedded in
 * the Scene document, so each position update produced a new SceneDocument,
 * which re-ran the reactive scene-load effect, which destroyed the background
 * and re-awaited Assets.load().
 *
 * The rule these tests lock in: only fields loadSceneDocument() actually reads
 * may force a reload. Everything embedded belongs to SceneOrchestrator.
 */

import { describe, it, expect } from "vitest";
import { sceneReloadKey } from "../sceneReloadKey.js";
import type { SceneDocument } from "@fusion/shared";

function makeScene(over: Record<string, unknown> = {}): SceneDocument {
  return {
    _id: "scene00000000001",
    name: "Cena",
    width: 1000,
    height: 1000,
    padding: 0.25,
    background: "/assets/map.jpg",
    backgroundColor: "#1a1a2e",
    initialView: null,
    tokens: [],
    walls: [],
    lights: [],
    sounds: [],
    tiles: [],
    drawings: [],
    templates: [],
    notes: [],
    ...over,
  } as unknown as SceneDocument;
}

const token = (x: number, y: number) => ({ _id: "tok0000000000001", name: "T", x, y });

describe("sceneReloadKey — things that must NOT reload the scene", () => {
  it("ignores a token moving — the whole point of this module", () => {
    const before = makeScene({ tokens: [token(650, 650)] });
    const after = makeScene({ tokens: [token(750, 750)] });
    expect(sceneReloadKey(after)).toBe(sceneReloadKey(before));
  });

  it("ignores a token being added or removed", () => {
    expect(sceneReloadKey(makeScene({ tokens: [token(0, 0)] }))).toBe(
      sceneReloadKey(makeScene({ tokens: [] })),
    );
  });

  it("ignores walls, lights and other embedded collections", () => {
    const busy = makeScene({
      walls: [{ _id: "w1" }],
      lights: [{ _id: "l1" }],
      drawings: [{ _id: "d1" }],
      templates: [{ _id: "t1" }],
    });
    expect(sceneReloadKey(busy)).toBe(sceneReloadKey(makeScene()));
  });

  it("returns the same key for a fresh object with identical render fields", () => {
    // The mirror hands out a NEW object on every update — identity must not matter.
    expect(sceneReloadKey(makeScene())).toBe(sceneReloadKey(makeScene()));
  });
});

describe("sceneReloadKey — things that MUST reload the scene", () => {
  it("reloads on a different scene", () => {
    expect(sceneReloadKey(makeScene({ _id: "scene00000000002" }))).not.toBe(
      sceneReloadKey(makeScene()),
    );
  });

  it("reloads when the background image changes", () => {
    expect(sceneReloadKey(makeScene({ background: "/assets/other.jpg" }))).not.toBe(
      sceneReloadKey(makeScene()),
    );
  });

  it("reloads when the background is removed", () => {
    expect(sceneReloadKey(makeScene({ background: null }))).not.toBe(sceneReloadKey(makeScene()));
  });

  it("reloads when the scene is resized", () => {
    expect(sceneReloadKey(makeScene({ width: 4000 }))).not.toBe(sceneReloadKey(makeScene()));
    expect(sceneReloadKey(makeScene({ height: 4000 }))).not.toBe(sceneReloadKey(makeScene()));
  });

  it("reloads when the padding changes — it shifts the grid origin", () => {
    expect(sceneReloadKey(makeScene({ padding: 0.5 }))).not.toBe(sceneReloadKey(makeScene()));
  });

  it("reloads when the grid config changes — this is the M1 proof", () => {
    const before = makeScene({ grid: { type: "square", size: 100 } });
    const after = makeScene({ grid: { type: "square", size: 70 } });
    expect(sceneReloadKey(after)).not.toBe(sceneReloadKey(before));
  });

  it("reloads when a scene gains a grid block it did not have", () => {
    expect(sceneReloadKey(makeScene({ grid: { type: "square", size: 100 } }))).not.toBe(
      sceneReloadKey(makeScene()),
    );
  });

  it("reloads when the background color changes", () => {
    expect(sceneReloadKey(makeScene({ backgroundColor: "#000000" }))).not.toBe(
      sceneReloadKey(makeScene()),
    );
  });
});

describe("sceneReloadKey — no scene", () => {
  it("returns null for null and undefined", () => {
    expect(sceneReloadKey(null)).toBeNull();
    expect(sceneReloadKey(undefined)).toBeNull();
  });

  it("distinguishes 'no scene' from any real scene", () => {
    expect(sceneReloadKey(makeScene())).not.toBeNull();
  });
});
