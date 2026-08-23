/**
 * manifest.test.ts — `SystemManifestSchema.sizeToFootprint` (REQ-SYS-009).
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-009 (emenda por 41-token.md DEC-TOK-03).
 * The manifest is the point of extension the engine consumes to derive a
 * token's footprint from its effective actor's size category — this only
 * proves the schema accepts/validates the declaration; TK041's consumption
 * lives in systems/pf2e, systems/sf2e and packages/client.
 */
import { describe, it, expect } from "vitest";
import { SystemManifestSchema } from "../manifest.js";

const BASE_MANIFEST = {
  id: "my-system",
  title: "My System",
  version: "1.0.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Author" }],
  documentTypes: {
    Actor: ["warrior"],
  },
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

describe("SystemManifestSchema.sizeToFootprint (REQ-SYS-009)", () => {
  it("is optional — a manifest with no declaration still parses", () => {
    const parsed = SystemManifestSchema.parse({ ...BASE_MANIFEST });
    expect(parsed.sizeToFootprint).toBeUndefined();
  });

  it("accepts a size category → footprint map", () => {
    const parsed = SystemManifestSchema.parse({
      ...BASE_MANIFEST,
      sizeToFootprint: {
        med: { width: 1, height: 1 },
        lg: { width: 2, height: 2 },
      },
    });
    expect(parsed.sizeToFootprint).toEqual({
      med: { width: 1, height: 1 },
      lg: { width: 2, height: 2 },
    });
  });

  it("rejects a non-positive footprint dimension", () => {
    const result = SystemManifestSchema.safeParse({
      ...BASE_MANIFEST,
      sizeToFootprint: { tiny: { width: 0, height: 1 } },
    });
    expect(result.success).toBe(false);
  });
});
