/**
 * gridRenderer-nullsafe.test.ts — regression: a scene without a `grid` block
 * must NOT crash the scene loader. GridRenderer.fromGridConfig previously read
 * `grid.size` unconditionally, throwing "Cannot read properties of undefined
 * (reading 'size')" when the loader passed an undefined grid — breaking scene
 * activation for any gridless/minimal scene (validacao manual r7).
 */

import { describe, it, expect } from "vitest";
import { GridRenderer } from "../GridRenderer.js";

describe("GridRenderer.fromGridConfig — null safety", () => {
  it("returns null for undefined grid (hides grid, no crash)", () => {
    expect(GridRenderer.fromGridConfig(undefined, 2800, 2800, 0, 0)).toBeNull();
  });

  it("returns null for null grid", () => {
    expect(GridRenderer.fromGridConfig(null, 2800, 2800, 0, 0)).toBeNull();
  });

  it("builds a config for a valid grid", () => {
    const cfg = GridRenderer.fromGridConfig(
      { type: "square", size: 100, color: "#000000", alpha: 0.2 } as never,
      2800,
      2800,
      10,
      20,
    );
    expect(cfg).not.toBeNull();
    expect(cfg?.size).toBe(100);
    expect(cfg?.offsetX).toBe(10);
    expect(cfg?.offsetY).toBe(20);
  });
});
