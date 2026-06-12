/**
 * scene-schemas.test.ts — validation tests for AmbientLightDocumentSchema and TokenLightSchema.
 *
 * Spec: 07-visao-iluminacao-fog.md §REQ-VIS-040/041
 * Fix: dimRadius >= brightRadius invariant enforced via .refine().
 */

import { describe, it, expect } from "vitest";
import { AmbientLightDocumentSchema, TokenLightSchema } from "../vision/scene-schemas.js";

describe("AmbientLightDocumentSchema — dimRadius >= brightRadius invariant", () => {
  it("accepts valid document where dimRadius >= brightRadius", () => {
    const result = AmbientLightDocumentSchema.safeParse({
      _id: "A".repeat(16),
      x: 0,
      y: 0,
      brightRadius: 3,
      dimRadius: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts document where dimRadius === brightRadius (edge case)", () => {
    const result = AmbientLightDocumentSchema.safeParse({
      _id: "A".repeat(16),
      x: 0,
      y: 0,
      brightRadius: 5,
      dimRadius: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts document where brightRadius = 0 and dimRadius = 0 (defaults)", () => {
    const result = AmbientLightDocumentSchema.safeParse({
      _id: "A".repeat(16),
      x: 100,
      y: 200,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.brightRadius).toBe(0);
      expect(result.data.dimRadius).toBe(5); // default
    }
  });

  it("rejects document where dimRadius < brightRadius", () => {
    const result = AmbientLightDocumentSchema.safeParse({
      _id: "A".repeat(16),
      x: 0,
      y: 0,
      brightRadius: 10,
      dimRadius: 5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.errors.map((e) => e.message);
      expect(messages.some((m) => m.includes("dimRadius"))).toBe(true);
    }
  });
});

describe("TokenLightSchema — dimRadius >= brightRadius invariant", () => {
  it("accepts valid TokenLight where dimRadius >= brightRadius", () => {
    const result = TokenLightSchema.safeParse({
      brightRadius: 2,
      dimRadius: 4,
    });
    expect(result.success).toBe(true);
  });

  it("accepts TokenLight with equal radii", () => {
    const result = TokenLightSchema.safeParse({
      brightRadius: 3,
      dimRadius: 3,
    });
    expect(result.success).toBe(true);
  });

  it("rejects TokenLight where dimRadius < brightRadius", () => {
    const result = TokenLightSchema.safeParse({
      brightRadius: 8,
      dimRadius: 2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.errors.map((e) => e.message);
      expect(messages.some((m) => m.includes("dimRadius"))).toBe(true);
    }
  });
});
