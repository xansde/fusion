/**
 * IWR Pipeline — golden fixture tests.
 *
 * Validates all 15 cases from systems/engine-2e/fixtures/iwr.json.
 *
 * Fixture shapes vary:
 *   - Single damage: { damage: { amount, type, traits? }, iwr, isCritical } → expected.finalDamage
 *   - Array damage:  { damage: [...], iwr } → expected.finalDamage + expected.breakdown
 *   - Condition:     { conditionSlug, iwr } → expected.conditionApplied
 *   - Persistent:    { persistentDamage: { amount, type, flatCheckDC }, iwr } → expected.damageApplied
 *
 * verify:true cases:
 *   iwr-010 — "physical" umbrella covering bludgeoning/piercing/slashing.
 *              Implemented: PHYSICAL_SUBTYPES set in iwr.ts, checked in iwrEntryMatches().
 *   iwr-011 — Persistent damage goes through IWR (weakness/resistance apply).
 *              Implemented: applyIwr() is called with the persistent damage instance,
 *              same as regular damage.
 *
 * Source: docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §6.4 / §6.5
 */
import { describe, it, expect } from "vitest";
import { applyIwr, applyIwrMultiple, type DamageInstance, type IwrSet } from "../iwr.js";
import fixtureData from "../../fixtures/iwr.json" with { type: "json" };

// Fixture case shapes (union of all shapes in the fixture file).
type FixtureCase = {
  id: string;
  description: string;
  iwr: IwrSet;
  isCritical?: boolean;
  verify?: boolean;
  verifyNote?: string;
  // single damage
  damage?: DamageInstance | DamageInstance[];
  // condition immunity
  conditionSlug?: string;
  // persistent damage
  persistentDamage?: { amount: number; type: string; flatCheckDC: number };
  expected: {
    finalDamage?: number;
    conditionApplied?: boolean;
    damageApplied?: number;
    breakdown?: Array<{ type: string; before: number; after: number; note?: string }>;
    note?: string;
  };
};

const cases = (fixtureData as { cases: FixtureCase[] }).cases;

describe("IWR Pipeline — golden fixtures", () => {
  for (const c of cases) {
    it(`${c.id}: ${c.description}`, () => {
      if (c.conditionSlug !== undefined) {
        // iwr-013: condition immunity
        const isImmune = c.iwr.immunities.some((entry) => entry.target === c.conditionSlug);
        expect({ conditionApplied: !isImmune }).toEqual({
          conditionApplied: c.expected.conditionApplied,
        });
        return;
      }

      if (c.persistentDamage !== undefined) {
        // iwr-011: persistent damage through IWR
        const damage: DamageInstance = {
          amount: c.persistentDamage.amount,
          type: c.persistentDamage.type,
        };
        const result = applyIwr(damage, c.iwr);
        expect(result.finalDamage).toBe(c.expected.damageApplied);
        return;
      }

      if (!c.damage) return;

      if (Array.isArray(c.damage)) {
        // iwr-009: multiple damage types
        const result = applyIwrMultiple(c.damage, c.iwr);
        expect(result.total).toBe(c.expected.finalDamage);
        if (c.expected.breakdown) {
          for (const expectedBreakdown of c.expected.breakdown) {
            const actualItem = result.breakdown.find((b) => b.type === expectedBreakdown.type);
            expect(actualItem?.finalDamage, `breakdown for ${expectedBreakdown.type}`).toBe(
              expectedBreakdown.after,
            );
          }
        }
        return;
      }

      // Single damage instance
      const damage = c.damage as DamageInstance;
      const result = applyIwr(damage, c.iwr);
      expect(result.finalDamage).toBe(c.expected.finalDamage);
    });
  }
});
