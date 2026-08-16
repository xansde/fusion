/**
 * condition-display-contract.test.ts — the display contract of a condition.
 *
 * REQ-SYS-043 (amended 2026-08-16, spec 15 §7 / DEC-SYS-10) added three OPTIONAL
 * fields to `ConditionDefinition`: `tone`, `help` and `critical`. They exist so a
 * client can paint a condition without knowing any condition (DEC-CTT-11), and they
 * are optional on purpose: an already-registered system that declares none of them
 * must keep registering exactly as before (REQ-CTT-035 — an incomplete declaration
 * degrades the display, it never invalidates or hides the condition).
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineSystem } from "../system-module.js";

const BASE_MANIFEST = {
  id: "test-system",
  title: "Test System",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: { Actor: ["hero"] },
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

describe("ConditionDefinition display contract (REQ-SYS-043)", () => {
  it("REQ-SYS-043: keeps tone, help and critical as declared by the system", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.condition({
        slug: "frightened",
        label: "Amedrontado",
        img: "",
        valued: true,
        tone: "harm",
        help: "Penalidade de condição em testes e CD.",
      });
      r.condition({
        slug: "dying",
        label: "Morrendo",
        img: "",
        valued: true,
        tone: "harm",
        critical: true,
      });
      r.condition({
        slug: "hasted",
        label: "Acelerado",
        img: "",
        tone: "benefit",
      });
    });

    const frightened = module.registries.conditions.get("frightened");
    expect(frightened?.tone).toBe("harm");
    expect(frightened?.help).toBe("Penalidade de condição em testes e CD.");
    expect(frightened?.critical).toBeUndefined();

    expect(module.registries.conditions.get("dying")?.critical).toBe(true);
    expect(module.registries.conditions.get("hasted")?.tone).toBe("benefit");
  });

  it("REQ-SYS-043: a condition declared without the display fields still registers", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      // Exactly the shape every already-registered system uses today.
      r.condition({ slug: "clumsy", label: "Desajeitado", img: "", valued: true });
    });

    const clumsy = module.registries.conditions.get("clumsy");
    expect(clumsy).toBeDefined();
    expect(clumsy?.tone).toBeUndefined();
    expect(clumsy?.help).toBeUndefined();
    expect(clumsy?.critical).toBeUndefined();
  });
});
