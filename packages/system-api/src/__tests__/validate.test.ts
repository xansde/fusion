import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineSystem } from "../system-module.js";
import { validateSystemModule } from "../validate.js";

const BASE_MANIFEST = {
  id: "my-system",
  title: "My System",
  version: "1.0.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Author" }],
  documentTypes: {
    Actor: ["warrior", "mage"],
  },
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

describe("validateSystemModule", () => {
  it("passes a fully valid module", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "warrior", schema: z.object({}) });
      r.defineModel({ documentType: "Actor", subtype: "mage", schema: z.object({}) });
    });
    const report = validateSystemModule(module);
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it("fails when a declared subtype has no registered model", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      // Only register warrior; mage is missing
      r.defineModel({ documentType: "Actor", subtype: "warrior", schema: z.object({}) });
    });
    const report = validateSystemModule(module);
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.message.includes("mage"))).toBe(true);
  });

  it("fails when a registered model has no matching declaration", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "warrior", schema: z.object({}) });
      r.defineModel({ documentType: "Actor", subtype: "mage", schema: z.object({}) });
      // Extra model not declared in manifest
      r.defineModel({ documentType: "Item", subtype: "weapon", schema: z.object({}) });
    });
    const report = validateSystemModule(module);
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.message.includes("Item:weapon"))).toBe(true);
  });

  it("reports multiple violations at once", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, () => {
      // Register nothing — both declared subtypes are missing
    });
    const report = validateSystemModule(module);
    expect(report.ok).toBe(false);
    expect(report.violations.length).toBeGreaterThanOrEqual(2);
  });
});
