/**
 * derive-runner.ts unit tests — ALQ-F2-08 (effect-item EffectSources reach
 * the engine through a registered materializer).
 *
 * Generic/system-agnostic: proves the CORE wiring (a registered
 * `effectsMaterializer` that converts embedded `effect` items into
 * EffectSources, feeding `collectEffects` → `Synthetics` → a "derived" phase
 * step resolving them via `resolveModifiersForSelector` + `resolveStacking`)
 * produces correct PF2e-remaster stacking numbers. Does NOT import
 * `@fusion/system-pf2e` — that package's OWN materializer is unit-tested in
 * `systems/pf2e/src/__tests__/effectSources.test.ts` (satellite); this file
 * only proves the derive-runner's generic plumbing is sound, using a small
 * fake system (same pattern as `derive-runner.test.ts`'s
 * `buildFakeSystemWithMaterializer`).
 *
 * REQ-PF2-217 (embedded effect copy), REQ-PF2-218 (effect participates in
 * derivation).
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineSystem, type SystemModule } from "@fusion/system-api";
import { resolveModifiersForSelector, resolveStacking } from "@fusion/engine-2e";
import type { GenericEffectSource } from "@fusion/system-api";
import { runActorDerivation } from "../derive-runner.js";

/** One embedded "effect"-type item's minimal shape for this test's fake materializer. */
interface FakeEffectItem {
  readonly type?: unknown;
  readonly _id?: unknown;
  readonly system?: {
    readonly rules?: ReadonlyArray<{
      readonly selector?: unknown;
      readonly value?: unknown;
      readonly modifierType?: unknown;
    }>;
  };
}

/** Converts embedded `type:"effect"` items into EffectSources (fake, MVP-shaped). */
function fakeMaterializeEffectItems(doc: Record<string, unknown>): GenericEffectSource[] {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return [];
  const sources: GenericEffectSource[] = [];
  for (const raw of rawItems as FakeEffectItem[]) {
    if (raw.type !== "effect") continue;
    const rules = raw.system?.rules ?? [];
    sources.push({
      sourceId: `effect:${String(raw._id ?? "?")}`,
      label: String(raw._id ?? "effect"),
      active: true,
      rules: rules.map((r) => ({
        type: "flatModifier",
        selector: r.selector as string,
        value: r.value as number,
        modifierType: r.modifierType as string | undefined,
      })),
    });
  }
  return sources;
}

function buildFakeSystemWithSavesDerivation(): SystemModule {
  return defineSystem(
    {
      id: "fake-effects-system",
      title: "Fake Effects System",
      version: "0.1.0",
      engineCompat: ">=0.1.0 <2.0.0",
      authors: [{ name: "Test" }],
      documentTypes: { Actor: ["hero"] },
      languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
    },
    (r) => {
      r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });

      r.derive({
        id: "fake.derived-saves",
        documentType: "Actor",
        subtypes: ["hero"],
        phase: "derived",
        reads: [],
        writes: ["system.derived.saves"],
        run: (doc, ctx) => {
          const d = doc as { system: { derived?: { saves?: Record<string, number> } } };
          const saves: Record<string, number> = {};
          for (const save of ["fortitude", "reflex", "will"] as const) {
            const resolved = resolveModifiersForSelector(save, ctx.synthetics, ctx.rollOptions);
            const broad = resolveModifiersForSelector(
              "saving-throw",
              ctx.synthetics,
              ctx.rollOptions,
            );
            saves[save] = resolveStacking([...resolved, ...broad]);
          }
          d.system.derived ??= {};
          d.system.derived.saves = saves;
        },
      });

      r.effectsMaterializer({
        documentType: "Actor",
        subtypes: ["hero"],
        build: fakeMaterializeEffectItems,
      });
    },
  );
}

describe("runActorDerivation — effect-item EffectSources reach the engine (ALQ-F2-08)", () => {
  it("a single item-type FlatModifier{selector:saving-throw, value:1} raises each save by 1", () => {
    const systemModule = buildFakeSystemWithSavesDerivation();
    const doc: Record<string, unknown> = {
      type: "hero",
      system: {},
      items: [
        {
          _id: "eff-1",
          type: "effect",
          system: { rules: [{ selector: "saving-throw", value: 1, modifierType: "item" }] },
        },
      ],
    };

    const ran = runActorDerivation(doc, systemModule);
    expect(ran).toBe(true);

    const saves = (doc["system"] as { derived: { saves: Record<string, number> } }).derived.saves;
    expect(saves).toEqual({ fortitude: 1, reflex: 1, will: 1 });
  });

  it("two item-type FlatModifiers (+1 and +2) on the same selector do NOT stack — highest wins (+2, not +3)", () => {
    const systemModule = buildFakeSystemWithSavesDerivation();
    const doc: Record<string, unknown> = {
      type: "hero",
      system: {},
      items: [
        {
          _id: "eff-1",
          type: "effect",
          system: { rules: [{ selector: "saving-throw", value: 1, modifierType: "item" }] },
        },
        {
          _id: "eff-2",
          type: "effect",
          system: { rules: [{ selector: "saving-throw", value: 2, modifierType: "item" }] },
        },
      ],
    };

    runActorDerivation(doc, systemModule);

    const saves = (doc["system"] as { derived: { saves: Record<string, number> } }).derived.saves;
    expect(saves).toEqual({ fortitude: 2, reflex: 2, will: 2 });
  });

  it("removing the effect item removes its contribution (no orphaned bonus)", () => {
    const systemModule = buildFakeSystemWithSavesDerivation();
    const withEffect: Record<string, unknown> = {
      type: "hero",
      system: {},
      items: [
        {
          _id: "eff-1",
          type: "effect",
          system: { rules: [{ selector: "saving-throw", value: 1, modifierType: "item" }] },
        },
      ],
    };
    const withoutEffect: Record<string, unknown> = { type: "hero", system: {}, items: [] };

    runActorDerivation(withEffect, systemModule);
    runActorDerivation(withoutEffect, systemModule);

    expect(
      (withEffect["system"] as { derived: { saves: Record<string, number> } }).derived.saves
        .fortitude,
    ).toBe(1);
    expect(
      (withoutEffect["system"] as { derived: { saves: Record<string, number> } }).derived.saves
        .fortitude,
    ).toBe(0);
  });
});
