/**
 * Isekai variant — the Focus pool derivation step.
 *
 * The layer spends the SAME Focus Points as PF2e, so this step has exactly two
 * jobs: hand a pool to a character who has none (a non-caster picking Isekai),
 * and publish how much of that pool the ★ locks have taken away. It must never
 * widen the published 3-point cap, and it must be completely inert while the
 * variant is off.
 */

import { describe, it, expect } from "vitest";
import { stepCharIsekaiFocus } from "../derivations/isekai.js";
import { ISEKAI_FOCUS_FLOOR } from "../variants/isekai/index.js";

interface FocusBlock {
  value: number;
  max: number;
}

function actor(options: {
  variantOn?: boolean;
  archetypes?: string[];
  focus?: FocusBlock;
  trackers?: Record<string, Record<string, unknown>>;
}): Record<string, unknown> {
  const system: Record<string, unknown> = {
    resources: {
      heroPoints: { value: 1, max: 3 },
      focusPoints: options.focus ?? { value: 0, max: 0 },
    },
  };
  if (options.variantOn !== undefined) {
    system["build"] = { variantRules: { isekai: options.variantOn } };
  }
  if (options.archetypes || options.trackers) {
    system["isekai"] = {
      archetypes: options.archetypes ?? [],
      trackers: options.trackers ?? {},
    };
  }
  return { type: "character", system };
}

function focusOf(doc: Record<string, unknown>): FocusBlock {
  const sys = doc["system"] as Record<string, unknown>;
  const resources = sys["resources"] as Record<string, unknown>;
  return resources["focusPoints"] as FocusBlock;
}

function derivedOf(doc: Record<string, unknown>): Record<string, unknown> | undefined {
  const sys = doc["system"] as Record<string, unknown>;
  return sys["derived"] as Record<string, unknown> | undefined;
}

describe("stepCharIsekaiFocus — inert while the variant is off", () => {
  it("leaves a non-caster's empty pool empty when the variant is absent", () => {
    const doc = actor({});
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc)).toEqual({ value: 0, max: 0 });
    expect(derivedOf(doc)?.["isekaiFocusLocked"]).toBeUndefined();
  });

  it("leaves the pool alone when the variant is explicitly off", () => {
    const doc = actor({ variantOn: false, archetypes: ["fodao", "sortudo"] });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc)).toEqual({ value: 0, max: 0 });
  });

  it("does not grant a pool when the toggle is on but no archetype is picked", () => {
    // Flipping the switch is not the grant — the archetypes are. A sheet
    // mid-configuration must not sprout 3 Focus out of an empty selection.
    const doc = actor({ variantOn: true, archetypes: [] });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc)).toEqual({ value: 0, max: 0 });
  });
});

describe("stepCharIsekaiFocus — granting the pool", () => {
  it("floors an empty pool at 3 for a non-caster with an archetype", () => {
    const doc = actor({ variantOn: true, archetypes: ["fodao"] });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc).max).toBe(ISEKAI_FOCUS_FLOOR);
  });

  it("starts the granted pool full — nothing spent yet", () => {
    const doc = actor({ variantOn: true, archetypes: ["fodao"] });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc).value).toBe(ISEKAI_FOCUS_FLOOR);
  });

  it("leaves a caster who already has the full pool untouched", () => {
    const doc = actor({
      variantOn: true,
      archetypes: ["fodao"],
      focus: { value: 1, max: 3 },
    });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc)).toEqual({ value: 1, max: 3 });
  });

  it("raises a partial pool to the floor without touching what was spent", () => {
    const doc = actor({
      variantOn: true,
      archetypes: ["sortudo"],
      focus: { value: 1, max: 2 },
    });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc)).toEqual({ value: 1, max: 3 });
  });

  it("never widens the published cap, even if the document claims more", () => {
    const doc = actor({
      variantOn: true,
      archetypes: ["sortudo"],
      focus: { value: 9, max: 9 },
    });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc).max).toBe(3);
    expect(focusOf(doc).value).toBe(3);
  });
});

describe("stepCharIsekaiFocus — ★ locks", () => {
  it("publishes the locked count for the sheet to explain the missing pips", () => {
    const doc = actor({
      variantOn: true,
      archetypes: ["carismatico"],
      trackers: {
        carismatico: {
          retinue: [
            { id: "a", name: "Gobta", tier: "active", named: true },
            { id: "b", name: "Ranga", tier: "base", named: false },
          ],
        },
      },
    });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(derivedOf(doc)?.["isekaiFocusLocked"]).toBe(1);
  });

  it("clamps the spendable value to max minus the locks", () => {
    const doc = actor({
      variantOn: true,
      archetypes: ["carismatico"],
      focus: { value: 3, max: 3 },
      trackers: {
        carismatico: {
          retinue: [
            { id: "a", name: "Gobta", tier: "active", named: true },
            { id: "b", name: "Ranga", tier: "retinue", named: true },
          ],
        },
      },
    });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc)).toEqual({ value: 1, max: 3 });
  });

  it("keeps max at 3 — the locks reduce what is spendable, not the pool's size", () => {
    // The sheet renders "1/3 · 2 travado": the player must still see that the
    // pool IS three, and that two points are held hostage by their own choices.
    const doc = actor({
      variantOn: true,
      archetypes: ["especialista"],
      focus: { value: 3, max: 3 },
      trackers: {
        especialista: { signatures: [{ id: "a", name: "Lâmina", flag: true }] },
      },
    });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc).max).toBe(3);
    expect(focusOf(doc).value).toBe(2);
  });

  it("never drives the spendable value below zero", () => {
    const doc = actor({
      variantOn: true,
      archetypes: ["carismatico"],
      focus: { value: 3, max: 3 },
      trackers: {
        carismatico: {
          retinue: Array.from({ length: 5 }, (_, i) => ({
            id: `c${String(i)}`,
            name: `C${String(i)}`,
            tier: "retinue" as const,
            named: true,
          })),
        },
      },
    });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(focusOf(doc).value).toBe(0);
    expect(focusOf(doc).max).toBe(3);
  });

  it("reports zero locks when the trackers are empty", () => {
    const doc = actor({ variantOn: true, archetypes: ["carismatico"] });
    stepCharIsekaiFocus.run(doc, {} as never);
    expect(derivedOf(doc)?.["isekaiFocusLocked"]).toBe(0);
  });
});

describe("stepCharIsekaiFocus — robustness", () => {
  it("survives a document with no resources block at all", () => {
    const doc = { type: "character", system: { build: { variantRules: { isekai: true } }, isekai: { archetypes: ["fodao"] } } };
    expect(() => {
      stepCharIsekaiFocus.run(doc, {} as never);
    }).not.toThrow();
    expect(focusOf(doc).max).toBe(3);
  });

  it("survives garbage in the archetypes field", () => {
    const doc = {
      type: "character",
      system: {
        build: { variantRules: { isekai: true } },
        isekai: { archetypes: "fodao" },
        resources: { focusPoints: { value: 0, max: 0 } },
      },
    };
    expect(() => {
      stepCharIsekaiFocus.run(doc, {} as never);
    }).not.toThrow();
    expect(focusOf(doc)).toEqual({ value: 0, max: 0 });
  });

  it("declares itself a base-phase character step", () => {
    expect(stepCharIsekaiFocus.phase).toBe("base");
    expect(stepCharIsekaiFocus.documentType).toBe("Actor");
    expect(stepCharIsekaiFocus.subtypes).toContain("character");
  });
});
