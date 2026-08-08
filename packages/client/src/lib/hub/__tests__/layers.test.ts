/**
 * layers.test.ts — invariants of the shell layer scale (REQ-UIF-008).
 *
 * These are ordering invariants, not snapshots: they encode *why* each band
 * sits where it does, so renumbering is allowed as long as the intent holds.
 *
 * Note on coverage: the Hub layer's click-through behaviour is a DOM property
 * (`pointer-events`) and this package runs Vitest with `environment: "node"`,
 * so it cannot be asserted here. It belongs in an E2E script alongside
 * `e2e-dod-m1.mjs` / `e2e-m1c-tokens.mjs`, which drive a real browser.
 */

import { describe, it, expect } from "vitest";
import {
  Z_LAYERS,
  LAYER_ORDER,
  layerVar,
  HUB_LAYER_CLASS,
  HUB_SURFACE_CLASS,
  type LayerName,
} from "../layers.js";

describe("Z_LAYERS", () => {
  it("covers exactly the layers named in LAYER_ORDER", () => {
    expect([...LAYER_ORDER].sort()).toEqual(Object.keys(Z_LAYERS).sort());
  });

  it("is strictly ascending in the declared painting order", () => {
    const values = LAYER_ORDER.map((name) => Z_LAYERS[name]);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i], `${LAYER_ORDER[i]} must sit above ${LAYER_ORDER[i - 1]}`).toBeGreaterThan(
        values[i - 1]!,
      );
    }
  });

  it("assigns every layer a distinct value", () => {
    const values = Object.values(Z_LAYERS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("leaves at least 100 of headroom between bands", () => {
    // The window host grows its children's z-index unboundedly as windows are
    // focused. Those children are scoped by the host's own stacking context,
    // but the headroom keeps any future un-scoped overlay from leaking across
    // a band boundary.
    const values = LAYER_ORDER.map((name) => Z_LAYERS[name]);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]! - values[i - 1]!).toBeGreaterThanOrEqual(100);
    }
  });
});

describe("the Hub band", () => {
  it("paints above the canvas, fixed regions and floating windows", () => {
    expect(Z_LAYERS.hub).toBeGreaterThan(Z_LAYERS.canvas);
    expect(Z_LAYERS.hub).toBeGreaterThan(Z_LAYERS.region);
    expect(Z_LAYERS.hub).toBeGreaterThan(Z_LAYERS.windows);
  });

  it("paints below menus, modals and notifications", () => {
    // A modal that the Hub could cover would be unclosable, and a notification
    // hidden behind the Hub defeats its purpose. "Always on top" means on top
    // of the table, not on top of the things that interrupt the table.
    expect(Z_LAYERS.hub).toBeLessThan(Z_LAYERS.menu);
    expect(Z_LAYERS.hub).toBeLessThan(Z_LAYERS.modal);
    expect(Z_LAYERS.hub).toBeLessThan(Z_LAYERS.notification);
  });
});

describe("layerVar", () => {
  it("builds the custom property reference declared in base.css", () => {
    expect(layerVar("hub")).toBe("var(--fusion-z-hub)");
    expect(layerVar("canvas")).toBe("var(--fusion-z-canvas)");
  });

  it("builds a reference for every layer in the scale", () => {
    for (const name of LAYER_ORDER) {
      expect(layerVar(name)).toBe(`var(--fusion-z-${name})`);
    }
  });
});

describe("Hub overlay contract", () => {
  it("exposes distinct host and surface class names", () => {
    expect(HUB_LAYER_CLASS).toBe("fusion-hub-layer");
    expect(HUB_SURFACE_CLASS).toBe("hub-surface");
    expect(HUB_LAYER_CLASS).not.toBe(HUB_SURFACE_CLASS);
  });

  it("keeps the surface class free of the host class as a substring", () => {
    // The stylesheet targets them independently; if one contained the other a
    // selector like [class*=...] added later would match both by accident.
    expect(HUB_LAYER_CLASS.includes(HUB_SURFACE_CLASS)).toBe(false);
    expect(HUB_SURFACE_CLASS.includes(HUB_LAYER_CLASS)).toBe(false);
  });
});

describe("type surface", () => {
  it("accepts every LAYER_ORDER entry as a LayerName", () => {
    const names: LayerName[] = [...LAYER_ORDER];
    expect(names).toHaveLength(LAYER_ORDER.length);
  });
});
