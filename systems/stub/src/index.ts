/**
 * @fusion/system-stub — minimal test system.
 *
 * Registers a single Actor subtype "dummy" with a minimal Zod schema.
 * Used as a CI fixture for validating the system API contract.
 *
 * REQ-SYS-111: every system in the monorepo must pass validateSystemModule.
 */
import { z } from "zod";
import { defineSystem } from "@fusion/system-api";

/** Zod schema for the "dummy" actor's `system` field. */
export const DummyActorSchema = z.object({
  /** A simple numeric attribute to validate schema usage. */
  dummyValue: z.number().int().nonnegative().default(0),
  /** Optional label for testing string fields. */
  label: z.string().optional(),
});

export type DummyActorSystem = z.infer<typeof DummyActorSchema>;

/** The stub system module — exported for registry and contract tests. */
export const stubSystem = defineSystem(
  {
    id: "stub",
    title: "Stub System (test fixture)",
    version: "0.1.0",
    engineCompat: ">=0.1.0",
    authors: [{ name: "Fusion Engine Team" }],
    documentTypes: {
      Actor: ["dummy"],
    },
    languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
  },
  (registrar) => {
    registrar.defineModel({
      documentType: "Actor",
      subtype: "dummy",
      schema: DummyActorSchema,
      defaults: { dummyValue: 0 },
    });
  },
);
