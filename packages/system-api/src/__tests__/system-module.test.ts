import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineSystem } from "../system-module.js";

const VALID_MANIFEST = {
  id: "test-system",
  title: "Test System",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: {
    Actor: ["hero", "villain"],
  },
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

describe("defineSystem", () => {
  it("returns a SystemModule with the validated manifest", () => {
    const module = defineSystem({ ...VALID_MANIFEST }, () => {});
    expect(module.manifest.id).toBe("test-system");
    expect(module.manifest.title).toBe("Test System");
  });

  it("throws on invalid manifest (bad semver)", () => {
    expect(() =>
      defineSystem(
        {
          ...VALID_MANIFEST,
          version: "not-a-semver",
        },
        () => {},
      ),
    ).toThrow(/Invalid SystemManifest/);
  });

  it("throws on invalid manifest (bad engineCompat)", () => {
    expect(() =>
      defineSystem(
        {
          ...VALID_MANIFEST,
          engineCompat: "%%%",
        },
        () => {},
      ),
    ).toThrow(/Invalid SystemManifest/);
  });

  it("throws when id does not match kebab-lowercase pattern", () => {
    expect(() =>
      defineSystem(
        {
          ...VALID_MANIFEST,
          id: "My System",
        },
        () => {},
      ),
    ).toThrow(/Invalid SystemManifest/);
  });

  it("throws when documentTypes contains an unknown document type key", () => {
    expect(() =>
      defineSystem(
        {
          ...VALID_MANIFEST,
          documentTypes: { Actr: ["hero"] },
        },
        () => {},
      ),
    ).toThrow(/unknown document type "Actr"/);
  });

  it("registers models via defineModel", () => {
    const heroSchema = z.object({ hp: z.number() });
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.defineModel({
        documentType: "Actor",
        subtype: "hero",
        schema: heroSchema,
      });
      r.defineModel({
        documentType: "Actor",
        subtype: "villain",
        schema: z.object({ threat: z.number() }),
      });
    });
    expect(module.models.has("Actor:hero")).toBe(true);
    expect(module.models.has("Actor:villain")).toBe(true);
  });

  it("registered model schema validates its data", () => {
    const heroSchema = z.object({ hp: z.number().int().nonnegative() });
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: heroSchema });
      r.defineModel({
        documentType: "Actor",
        subtype: "villain",
        schema: z.object({}),
      });
    });
    const heroModel = module.models.get("Actor:hero");
    expect(heroModel).toBeDefined();

    const valid = heroModel!.schema.safeParse({ hp: 10 });
    expect(valid.success).toBe(true);

    const invalid = heroModel!.schema.safeParse({ hp: -1 });
    expect(invalid.success).toBe(false);
  });

  it("accumulates models from multiple defineModel calls", () => {
    const module = defineSystem({ ...VALID_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.defineModel({ documentType: "Actor", subtype: "villain", schema: z.object({}) });
    });
    expect(module.models.size).toBe(2);
  });
});
