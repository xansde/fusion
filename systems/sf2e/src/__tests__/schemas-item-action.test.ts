/**
 * @fusion/system-sf2e — ActionSystemSchema conformance vs. the importer's
 * REAL flattened output shape (r12 fix mirror).
 *
 * Mirrors the pf2e r12 correction (systems/pf2e/src/schemas/item-equipment.ts
 * ActionSystemSchema): the shared importer's transform.mjs routes
 * `type: "action"` docs through normalizeFeatSystem(), which flattens
 * `actionType`/`actions` from the vendor's `{value: ...}` wrapper to plain
 * scalars and emits an explicit `category: null` when the vendor doc omits
 * it. sf2e has no actions pack yet (REQ-SF2-013 pending), so unlike pf2e's
 * packs-validation suite this guard is fixture-based — it pins the schema to
 * the importer's output shape so it cannot silently drift back to the raw
 * Foundry shape.
 */

import { describe, it, expect } from "vitest";
import { ActionSystemSchema } from "../schemas/item-equipment.js";

describe("ActionSystemSchema — flattened importer output shape (sf2e)", () => {
  it("parses a full flattened action doc (actionType scalar, actions count, category string)", () => {
    const result = ActionSystemSchema.safeParse({
      systemVersion: "0.1.0",
      actionType: "action",
      actions: 2,
      category: "offensive",
      traits: { rarity: "common", value: [] },
      rules: [],
      description: "Strike twice.",
    });
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
    if (result.success) {
      expect(result.data.actionType).toBe("action");
      expect(result.data.actions).toBe(2);
      expect(result.data.category).toBe("offensive");
    }
  });

  it("rejects the raw Foundry wrapper shape ({value: ...}) for actionType", () => {
    const result = ActionSystemSchema.safeParse({
      actionType: { value: "action" },
      actions: { value: 2 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts an explicit category: null (normalizeFeatSystem emits null when the vendor omits it)", () => {
    const result = ActionSystemSchema.safeParse({
      actionType: "reaction",
      actions: null,
      category: null,
    });
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
    if (result.success) {
      expect(result.data.category).toBeNull();
    }
  });

  it("accepts a missing category (plain optional path)", () => {
    const result = ActionSystemSchema.safeParse({
      actionType: "free",
      actions: null,
    });
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
  });

  it("accepts an optional fusionCategory string and leaves it absent by default", () => {
    const withCategory = ActionSystemSchema.safeParse({
      actionType: "action",
      actions: 1,
      fusionCategory: "basic",
    });
    expect(withCategory.success).toBe(true);
    if (withCategory.success) {
      expect(withCategory.data.fusionCategory).toBe("basic");
    }

    const withoutCategory = ActionSystemSchema.safeParse({
      actionType: "action",
      actions: 1,
    });
    expect(withoutCategory.success).toBe(true);
    if (withoutCategory.success) {
      expect(withoutCategory.data.fusionCategory).toBeUndefined();
    }
  });

  it("defaults actionType to 'passive' and actions to null on an empty doc", () => {
    const result = ActionSystemSchema.safeParse({});
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
    if (result.success) {
      expect(result.data.actionType).toBe("passive");
      expect(result.data.actions).toBeNull();
    }
  });

  it("rejects an out-of-range actions count (importer never emits > 3)", () => {
    const result = ActionSystemSchema.safeParse({
      actionType: "action",
      actions: 4,
    });
    expect(result.success).toBe(false);
  });
});
