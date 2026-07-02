/**
 * derive-runner.ts unit tests — M5-A E4 (effects materializer delegation).
 *
 * Exercises `runActorDerivation` directly (no socket/DB harness needed —
 * DeriveStep.run() is required to be synchronous and I/O-pure, REQ-SYS-024).
 *
 * Coverage:
 *   1. A SystemModule that registers `registrar.effectsMaterializer(...)`
 *      has its materializer used INSTEAD OF the 2e-family
 *      `collectEffects`/`actorConditionsToEffectSources` fallback (proven by
 *      a case where the two paths would disagree: the fake materializer
 *      injects a flatModifier the 2e-family condition-scan would never see,
 *      since the doc carries no embedded `condition` Items at all).
 *   2. A SystemModule that does NOT register a materializer falls back to
 *      the pre-M5-A behaviour, asserted against a REAL pf2e case
 *      (Frightened condition reduces AC via the engine-2e path) — proves
 *      retrocompat byte-for-byte.
 *
 * Spec: docs/design/m5-etmos-compositor.md §2.6 (E4).
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineSystem, type SystemModule } from "@fusion/system-api";
import { pf2eSystem } from "@fusion/system-pf2e";
import { runActorDerivation } from "../derive-runner.js";

// ---------------------------------------------------------------------------
// 1. Registered materializer is preferred over the 2e-family fallback
// ---------------------------------------------------------------------------

describe("runActorDerivation — effects materializer delegation (M5-A E4)", () => {
  function buildFakeSystemWithMaterializer(): SystemModule {
    return defineSystem(
      {
        id: "fake-materializer-system",
        title: "Fake Materializer System",
        version: "0.1.0",
        engineCompat: ">=0.1.0 <2.0.0",
        authors: [{ name: "Test" }],
        documentTypes: { Actor: ["hero"] },
        languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
      },
      (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });

        r.derive({
          id: "fake.base-score",
          documentType: "Actor",
          subtypes: ["hero"],
          phase: "base",
          reads: [],
          writes: ["system.score"],
          run: (doc) => {
            (doc as { system: { score: number } }).system.score = 10;
          },
        });

        r.derive({
          id: "fake.derived-total",
          documentType: "Actor",
          subtypes: ["hero"],
          phase: "derived",
          reads: ["system.score"],
          writes: ["system.derived.total"],
          run: (doc, ctx) => {
            const d = doc as {
              system: { score: number; derived?: { total?: number } };
            };
            const bonus = ctx.synthetics.modifiers["score"]?.length ?? 0;
            d.system.derived ??= {};
            d.system.derived.total = d.system.score + bonus * 100;
          },
        });

        // Registered materializer: always injects ONE flatModifier on
        // selector "score", regardless of the doc's embedded items (the doc
        // in this test has NO items[] at all — the 2e-family fallback would
        // therefore materialize ZERO EffectSources, proving the registered
        // materializer path — not the fallback — actually ran).
        r.effectsMaterializer({
          documentType: "Actor",
          subtypes: ["hero"],
          build() {
            return [
              {
                sourceId: "fake:always-on",
                label: "Always On",
                rules: [{ type: "flatModifier", selector: "score", value: 5 }],
              },
            ];
          },
        });
      },
    );
  }

  it("uses the registered materializer instead of the 2e-family fallback", () => {
    const systemModule = buildFakeSystemWithMaterializer();
    const doc: Record<string, unknown> = { type: "hero", system: {} };

    const ran = runActorDerivation(doc, systemModule);
    expect(ran).toBe(true);

    const sys = doc["system"] as { score: number; derived: { total: number } };
    expect(sys.score).toBe(10);
    // If the fallback had run instead (doc has no items[] → 0 EffectSources
    // → 0 modifiers), total would be 10. The registered materializer's
    // flatModifier bumps it by 1 * 100 = 100 → 110, proving delegation.
    expect(sys.derived.total).toBe(110);
  });

  it("falls back to zero EffectSources (2e-family path, no items[]) when no materializer is registered", () => {
    const systemModuleNoMaterializer = defineSystem(
      {
        id: "fake-no-materializer-system",
        title: "Fake No-Materializer System",
        version: "0.1.0",
        engineCompat: ">=0.1.0 <2.0.0",
        authors: [{ name: "Test" }],
        documentTypes: { Actor: ["hero"] },
        languages: [{ lang: "en", name: "English", path: "lang/en.json" }],
      },
      (r) => {
        r.defineModel({ documentType: "Actor", subtype: "hero", schema: z.object({}) });
        r.derive({
          id: "fake.base-score",
          documentType: "Actor",
          subtypes: ["hero"],
          phase: "base",
          reads: [],
          writes: ["system.score"],
          run: (doc) => {
            (doc as { system: { score: number } }).system.score = 10;
          },
        });
        r.derive({
          id: "fake.derived-total",
          documentType: "Actor",
          subtypes: ["hero"],
          phase: "derived",
          reads: ["system.score"],
          writes: ["system.derived.total"],
          run: (doc, ctx) => {
            const d = doc as {
              system: { score: number; derived?: { total?: number } };
            };
            const bonus = ctx.synthetics.modifiers["score"]?.length ?? 0;
            d.system.derived ??= {};
            d.system.derived.total = d.system.score + bonus * 100;
          },
        });
        // No r.effectsMaterializer(...) call — this is the retrocompat case.
      },
    );

    const doc: Record<string, unknown> = { type: "hero", system: {} };
    runActorDerivation(doc, systemModuleNoMaterializer);
    const sys = doc["system"] as { score: number; derived: { total: number } };
    // No materializer, no embedded condition items → 0 EffectSources → no bonus.
    expect(sys.derived.total).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 2. Retrocompat — real pf2e case: Frightened condition still reduces AC via
//    the unchanged 2e-family fallback path (pf2e registers NO materializer).
// ---------------------------------------------------------------------------

describe("runActorDerivation — pf2e retrocompat (no materializer registered, M5-A E4)", () => {
  function makeUnarmoredFighterDoc(): Record<string, unknown> {
    return {
      type: "character",
      system: {
        systemVersion: "0.1.0",
        level: { value: 5 },
        abilities: {
          str: { value: 18, mod: 0 },
          dex: { value: 16, mod: 0 },
          con: { value: 14, mod: 0 },
          int: { value: 10, mod: 0 },
          wis: { value: 12, mod: 0 },
          cha: { value: 8, mod: 0 },
        },
        attributes: {
          hp: { value: 75, max: 75, temp: 0 },
          ac: { value: 10 },
          speed: { value: 25, otherSpeeds: [] },
          dying: { value: 0, max: 4 },
          wounded: { value: 0 },
          doomed: { value: 0 },
          iwr: { immunities: [], weaknesses: [], resistances: [] },
        },
        saves: {
          fortitude: { rank: 2 },
          reflex: { rank: 1 },
          will: { rank: 2 },
        },
        perception: { rank: 2, senses: [] },
        skills: {
          athletics: { rank: 2 },
          acrobatics: { rank: 1 },
          stealth: { rank: 0 },
        },
        proficiencies: {
          classDC: { rank: 2 },
          weapons: { unarmed: 1, simple: 1, martial: 2, advanced: 0 },
          armor: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
        },
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
        details: { keyAbility: "str", level: 5 },
        traits: { rarity: "common", value: [], size: "med" },
      },
      items: [
        {
          type: "condition",
          system: { slug: "frightened", value: 2 },
        },
      ],
    };
  }

  it("has no registered effectsMaterializer (pf2e is unmigrated by design)", () => {
    expect(pf2eSystem.registries.effectsMaterializers).toHaveLength(0);
  });

  it("Frightened condition still reduces AC via the unchanged 2e-family fallback", () => {
    const doc = makeUnarmoredFighterDoc();
    const ran = runActorDerivation(doc, pf2eSystem);
    expect(ran).toBe(true);

    const sys = doc["system"] as Record<string, unknown>;
    const derived = sys["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number };
    // Unarmored baseline 20 (10 + dexMod3 + profBonus7), Frightened 2 → -2 status → 18.
    expect(ac.total).toBe(18);
  });
});
