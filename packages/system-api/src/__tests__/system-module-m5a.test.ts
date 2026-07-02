/**
 * Integration tests for the M5-A additions to defineSystem / SystemModule:
 *   - registrar.rollData()               (E1)
 *   - registrar.degreeOfSuccess()        (E2)
 *   - registrar.registerInitiativeFormula({ roll, compare }) (E3)
 *   - registrar.effectsMaterializer()    (E4)
 *
 * All four are aditive/retrocompatible — a separate retrocompat suite
 * (system-formula-adapter M5-A tests, derive-runner M5-A tests) proves the
 * PF2e/SF2e paths are unaffected when a system does NOT register these.
 *
 * Docs: docs/design/m5-etmos-compositor.md §2.6.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineSystem } from "../system-module.js";
import type { InitiativeEntry } from "@fusion/shared";

const BASE_MANIFEST = {
  id: "test-system",
  title: "Test System",
  version: "0.1.0",
  engineCompat: ">=0.1.0 <2.0.0",
  authors: [{ name: "Test Author" }],
  documentTypes: { Actor: ["hero"] },
  languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
} as const;

// ---------------------------------------------------------------------------
// E1 — rollData()
// ---------------------------------------------------------------------------

describe("SystemModule.registries.rollData (via registrar.rollData) — E1", () => {
  it("is empty when no rollData builder is declared", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
    });
    expect(module.registries.rollData).toHaveLength(0);
  });

  it("registers a rollData builder and exposes it in registries.rollData", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.rollData({
        documentType: "Actor",
        subtypes: ["hero"],
        build(doc) {
          const system = (doc as { system?: { score?: number } }).system;
          return { score: system?.score ?? 0 };
        },
      });
    });

    expect(module.registries.rollData).toHaveLength(1);
    const entry = module.registries.rollData[0]!;
    expect(entry.documentType).toBe("Actor");
    expect(entry.subtypes).toEqual(["hero"]);
    expect(entry.build({ system: { score: 14 } })).toEqual({ score: 14 });
  });

  it("throws when registering two builders for overlapping subtypes", () => {
    expect(() => {
      defineSystem({ ...BASE_MANIFEST }, (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.rollData({ documentType: "Actor", subtypes: ["hero"], build: () => ({}) });
        r.rollData({ documentType: "Actor", subtypes: ["hero"], build: () => ({}) });
      });
    }).toThrow(/overlapping rollData/);
  });

  it("allows two builders for disjoint subtypes on the same documentType", () => {
    const module = defineSystem(
      {
        ...BASE_MANIFEST,
        documentTypes: { Actor: ["hero", "villain"] },
      },
      (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.defineModel({ documentType: "Actor", subtype: "villain", schema: z.object({}) });
        r.rollData({ documentType: "Actor", subtypes: ["hero"], build: () => ({ side: "hero" }) });
        r.rollData({
          documentType: "Actor",
          subtypes: ["villain"],
          build: () => ({ side: "villain" }),
        });
      },
    );
    expect(module.registries.rollData).toHaveLength(2);
  });

  it("an empty subtypes array registers for all subtypes of the documentType", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.rollData({ documentType: "Actor", subtypes: [], build: () => ({ any: true }) });
    });
    expect(module.registries.rollData).toHaveLength(1);
    expect(module.registries.rollData[0]!.subtypes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// E2 — degreeOfSuccess()
// ---------------------------------------------------------------------------

describe("SystemModule.registries.degreeOfSuccess (via registrar.degreeOfSuccess) — E2", () => {
  it("is empty when no comparator is declared", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
    });
    expect(module.registries.degreeOfSuccess.size).toBe(0);
  });

  it("registers a binary success/failure comparator (Etmos-shaped, generic here)", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.degreeOfSuccess({
        id: "test.binary",
        compute(total, dc) {
          const margin = total - dc;
          return { degree: margin >= 0 ? "success" : "failure", meta: { margin } };
        },
      });
    });

    expect(module.registries.degreeOfSuccess.size).toBe(1);
    const def = module.registries.degreeOfSuccess.get("test.binary")!;
    expect(def.compute(10, 8)).toEqual({ degree: "success", meta: { margin: 2 } });
    expect(def.compute(5, 8)).toEqual({ degree: "failure", meta: { margin: -3 } });
  });

  it("throws on duplicate degreeOfSuccess id", () => {
    expect(() => {
      defineSystem({ ...BASE_MANIFEST }, (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.degreeOfSuccess({ id: "dup", compute: () => ({ degree: "success" }) });
        r.degreeOfSuccess({ id: "dup", compute: () => ({ degree: "failure" }) });
      });
    }).toThrow(/duplicate degreeOfSuccess/);
  });
});

// ---------------------------------------------------------------------------
// E3 — registerInitiativeFormula({ roll, compare }) object form
// ---------------------------------------------------------------------------

describe("registerInitiativeFormula — bare fn vs { roll, compare } object form — E3", () => {
  it("bare function form (legacy/PF2e-shaped) stores roll unchanged, no compare entry", () => {
    const fn = (): { formula: string; statistic: string } => ({
      formula: "1d20",
      statistic: "Perception",
    });
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.registerInitiativeFormula("hero-combat", fn);
    });

    expect(module.combat.initiativeFormulas.get("hero-combat")).toBe(fn);
    expect(module.combat.initiativeCompares.has("hero-combat")).toBe(false);
  });

  it("object form { roll, compare } stores roll in initiativeFormulas and compare in initiativeCompares", () => {
    const roll = (): { formula: string; statistic: string } => ({
      formula: "2d6",
      statistic: "Corpo",
    });
    const compare = (a: InitiativeEntry, b: InitiativeEntry): number =>
      (b.total ?? 0) - (a.total ?? 0);

    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.registerInitiativeFormula("etmos-combat", { roll, compare });
    });

    expect(module.combat.initiativeFormulas.get("etmos-combat")).toBe(roll);
    expect(module.combat.initiativeCompares.get("etmos-combat")).toBe(compare);
  });

  it("object form without compare stores roll only, no compare entry (compare optional)", () => {
    const roll = (): { formula: string; statistic: string } => ({
      formula: "2d6",
      statistic: "Corpo",
    });

    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.registerInitiativeFormula("etmos-combat", { roll });
    });

    expect(module.combat.initiativeFormulas.get("etmos-combat")).toBe(roll);
    expect(module.combat.initiativeCompares.has("etmos-combat")).toBe(false);
  });

  it("still throws when registering the same combatType twice, regardless of form", () => {
    expect(() => {
      defineSystem({ ...BASE_MANIFEST }, (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.registerInitiativeFormula("dup", () => ({ formula: "1d20", statistic: "x" }));
        r.registerInitiativeFormula("dup", { roll: () => ({ formula: "2d6", statistic: "y" }) });
      });
    }).toThrow(/two initiative formulas/);
  });

  it("a non-monotonic compare (players beat NPCs) sorts correctly via a plain array sort", () => {
    // Demonstrates the registered compare is a real, usable non-monotonic
    // comparator — full server-path propagation is covered in
    // packages/server/src/combat/__tests__.
    const compare = (a: InitiativeEntry, b: InitiativeEntry): number => {
      const aPlayer = a.combatant["hasPlayerOwner"] === true;
      const bPlayer = b.combatant["hasPlayerOwner"] === true;
      if (aPlayer !== bPlayer) return aPlayer ? -1 : 1; // players always first
      return (b.total ?? 0) - (a.total ?? 0);
    };

    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.registerInitiativeFormula("etmos-combat", {
        roll: () => ({ formula: "2d6", statistic: "Corpo" }),
        compare,
      });
    });

    const storedCompare = module.combat.initiativeCompares.get("etmos-combat")!;
    const npcHighRoll: InitiativeEntry = {
      combatant: { hasPlayerOwner: false } as never,
      total: 20,
    };
    const playerLowRoll: InitiativeEntry = {
      combatant: { hasPlayerOwner: true } as never,
      total: 3,
    };
    const entries = [npcHighRoll, playerLowRoll];
    entries.sort(storedCompare);
    // Player goes first despite the lower roll — non-monotonic rule applied.
    expect(entries[0]).toBe(playerLowRoll);
  });
});

// ---------------------------------------------------------------------------
// E4 — effectsMaterializer()
// ---------------------------------------------------------------------------

describe("SystemModule.registries.effectsMaterializers (via registrar.effectsMaterializer) — E4", () => {
  it("is empty when no materializer is declared", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
    });
    expect(module.registries.effectsMaterializers).toHaveLength(0);
  });

  it("registers a materializer and exposes it in registries.effectsMaterializers", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.effectsMaterializer({
        documentType: "Actor",
        subtypes: ["hero"],
        build() {
          return [{ sourceId: "test:source", label: "Test Source", rules: [] }];
        },
      });
    });

    expect(module.registries.effectsMaterializers).toHaveLength(1);
    const entry = module.registries.effectsMaterializers[0]!;
    expect(entry.documentType).toBe("Actor");
    expect(entry.subtypes).toEqual(["hero"]);
    expect(entry.build({})).toEqual([{ sourceId: "test:source", label: "Test Source", rules: [] }]);
  });

  it("throws when registering two materializers for overlapping subtypes", () => {
    expect(() => {
      defineSystem({ ...BASE_MANIFEST }, (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.effectsMaterializer({ documentType: "Actor", subtypes: ["hero"], build: () => [] });
        r.effectsMaterializer({ documentType: "Actor", subtypes: ["hero"], build: () => [] });
      });
    }).toThrow(/overlapping effectsMaterializer/);
  });

  it("an empty subtypes array registers for all subtypes of the documentType", () => {
    const module = defineSystem({ ...BASE_MANIFEST }, (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
      r.effectsMaterializer({ documentType: "Actor", subtypes: [], build: () => [] });
    });
    expect(module.registries.effectsMaterializers).toHaveLength(1);
    expect(module.registries.effectsMaterializers[0]!.subtypes).toEqual([]);
  });
});
