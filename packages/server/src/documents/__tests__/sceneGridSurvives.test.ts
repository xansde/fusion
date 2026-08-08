/**
 * The scene's grid must survive server-side validation.
 *
 * SceneSchema is built with `.extend()` and no `.passthrough()`, so Zod strips
 * every key it does not declare. The grid is the scene's most-edited setting
 * and the one the GM calibrates against the map image — if it is dropped on
 * the way through validateDocument(), every save silently reverts it and the
 * bug looks like "the grid setting doesn't stick", far from its cause.
 *
 * This is the same failure the `items` field of ActorSchema already hit (see
 * the comment there), which is why it is worth a test of its own.
 */

import { describe, it, expect } from "vitest";
import { SceneSchema } from "../types.js";

const BASE_SCENE = {
  _id: "scene0000000001x",
  name: "Cripta",
  width: 4000,
  height: 3000,
  _stats: {
    createdTime: 1,
    modifiedTime: 1,
    version: 1,
    lastModifiedBy: null,
    createdBy: null,
    coreVersion: "0.1.0",
    systemId: null,
    systemVersion: null,
    engineSchemaVersion: 0,
    systemSchemaVersion: null,
  },
};

describe("grid round-trip through SceneSchema", () => {
  it("keeps the whole grid config", () => {
    const parsed = SceneSchema.parse({
      ...BASE_SCENE,
      grid: {
        type: "square",
        size: 140,
        distance: 5,
        units: "ft",
        color: "#ff0000",
        alpha: 0.35,
        diagonalRule: "alternating_1",
      },
    }) as Record<string, unknown>;

    expect(parsed["grid"]).toEqual({
      type: "square",
      size: 140,
      distance: 5,
      units: "ft",
      color: "#ff0000",
      alpha: 0.35,
      diagonalRule: "alternating_1",
    });
  });

  it("keeps the calibrated grid origin", () => {
    const parsed = SceneSchema.parse({
      ...BASE_SCENE,
      gridOffsetX: 37,
      gridOffsetY: 12.5,
    }) as Record<string, unknown>;

    expect(parsed["gridOffsetX"]).toBe(37);
    expect(parsed["gridOffsetY"]).toBe(12.5);
  });

  it("defaults the origin to null (align to padding) when absent", () => {
    const parsed = SceneSchema.parse(BASE_SCENE) as Record<string, unknown>;
    expect(parsed["gridOffsetX"]).toBeNull();
    expect(parsed["gridOffsetY"]).toBeNull();
  });

  it("rejects a cell smaller than the 50px floor (REQ-CNV-017)", () => {
    const result = SceneSchema.safeParse({
      ...BASE_SCENE,
      grid: { type: "square", size: 10, distance: 5, units: "ft" },
    });
    expect(result.success).toBe(false);
  });
});
