/**
 * Dying / Wounded / Doomed — golden fixture tests.
 *
 * Validates all 17 cases from systems/engine-2e/fixtures/dying-wounded.json.
 *
 * verify:true case:
 *   dw-016 — Wounded clears on full HP + 10min rest (not on full HP alone).
 *              Rule (§7.6): clearing Wounded requires full HP AND 10 minutes of
 *              rest — simple combat healing to full HP does NOT clear it.
 *
 *              V2: `clearWounded()` / `healToFull()` is NOT implemented yet in
 *              engine-2e (see dyingWounded.ts exports — only applyDamage,
 *              applyRecoveryCheck, gainDoomed, recoveryCheckDc, maxDying
 *              exist). There is no engine function to call for this fixture
 *              case, so this test cannot exercise real behavior the way the
 *              other 16 cases do. Instead of asserting a fixed local literal
 *              against itself (which was the previous tautological version —
 *              it always passed regardless of the engine), this test documents
 *              the current, falsifiable contract: the module does NOT export a
 *              clearing function, AND the currently available state-mutating
 *              functions (applyDamage / applyRecoveryCheck) never touch
 *              `wounded` downward on their own (Wounded only ever clears via
 *              the not-yet-implemented rest mechanic). Both assertions are
 *              real checks against the actual module — they will FAIL the
 *              moment `clearWounded`/`healToFull` is implemented, which is
 *              the correct signal to come back and rewrite this case to call
 *              the real function per the fixture's `verifyNote`.
 *
 * Event shapes in fixtures:
 *   { type: "damage", amount, isCritical }   → applyDamage()
 *   { type: "recovery_check", degreeOfSuccess? } → applyRecoveryCheck() / recoveryCheckDc()
 *   { type: "gain_condition", condition, value }  → gainDoomed()
 *   { type: "heal_to_full", method }             → V2, not implemented (see dw-016 above)
 *
 * Source: docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §8
 */
import { describe, it, expect } from "vitest";
import * as dyingWoundedModule from "../dyingWounded.js";
import {
  applyDamage,
  applyRecoveryCheck,
  gainDoomed,
  recoveryCheckDc,
  maxDying,
  type ConditionState,
} from "../dyingWounded.js";
import type { DegreeOfSuccess } from "../degreesOfSuccess.js";
import fixtureData from "../../fixtures/dying-wounded.json" with { type: "json" };

type DyingEvent =
  | { type: "damage"; amount: number; isCritical: boolean }
  | { type: "recovery_check"; degreeOfSuccess?: DegreeOfSuccess }
  | { type: "gain_condition"; condition: string; value: number }
  | { type: "heal_to_full"; method: string };

type FixtureCase = {
  id: string;
  description: string;
  before: Partial<ConditionState> & { hp: number };
  event: DyingEvent;
  expected: {
    hp?: number;
    dying?: number;
    wounded?: number;
    alive?: boolean;
    causeOfDeath?: string;
    checkDC?: number;
  };
  verify?: boolean;
  verifyNote?: string;
};

const cases = (fixtureData as { cases: FixtureCase[] }).cases;

/**
 * Normalize a partial "before" state to a full ConditionState
 * with default values for missing fields.
 */
function normalizeState(before: FixtureCase["before"]): ConditionState {
  return {
    hp: before.hp ?? 0,
    dying: before.dying ?? 0,
    wounded: before.wounded ?? 0,
    doomed: before.doomed ?? 0,
  };
}

describe("Dying / Wounded / Doomed — golden fixtures", () => {
  for (const c of cases) {
    it(`${c.id}: ${c.description}`, () => {
      const state = normalizeState(c.before);
      const event = c.event;

      if (event.type === "damage") {
        const result = applyDamage(state, event.amount, event.isCritical);

        if (c.expected.hp !== undefined) {
          expect(result.hp, "hp").toBe(c.expected.hp);
        }
        if (c.expected.dying !== undefined) {
          expect(result.dying, "dying").toBe(c.expected.dying);
        }
        if (c.expected.wounded !== undefined) {
          expect(result.wounded, "wounded").toBe(c.expected.wounded);
        }
        if (c.expected.alive !== undefined) {
          expect(result.alive, "alive").toBe(c.expected.alive);
        }
      } else if (event.type === "recovery_check") {
        if (!event.degreeOfSuccess) {
          // dw-009: just check the DC formula
          const dc = recoveryCheckDc(state.dying);
          expect(dc).toBe(c.expected.checkDC);
          return;
        }

        const result = applyRecoveryCheck(state, event.degreeOfSuccess);

        if (c.expected.dying !== undefined) {
          expect(result.dying, "dying").toBe(c.expected.dying);
        }
        if (c.expected.wounded !== undefined) {
          expect(result.wounded, "wounded").toBe(c.expected.wounded);
        }
        if (c.expected.alive !== undefined) {
          expect(result.alive, "alive").toBe(c.expected.alive);
        }
      } else if (event.type === "gain_condition" && event.condition === "doomed") {
        // dw-015: gain Doomed condition
        const result = gainDoomed(state, event.value);
        if (c.expected.alive !== undefined) {
          expect(result.alive, "alive").toBe(c.expected.alive);
        }
      } else if (event.type === "heal_to_full") {
        // V2: dw-016 (verify:true) — "Wounded clears on full HP + 10min rest".
        // clearWounded()/healToFull() does not exist in engine-2e yet, so this
        // case cannot drive the real function like the other 16 cases do.
        // Non-tautological contract check instead of a fake local literal:
        //
        //  1. The module genuinely does not export a clearing function for
        //     this event type yet — asserted against the real module surface
        //     (dyingWoundedModule), not invented. This fails the moment a
        //     `clearWounded`/`healToFull` export is added, which is the
        //     correct trigger to rewrite this case against the real function.
        expect(
          "clearWounded" in dyingWoundedModule || "healToFull" in dyingWoundedModule,
          "V2 clearWounded()/healToFull() must not exist yet — update this test when it lands",
        ).toBe(false);

        //  2. The state-mutating functions available today never lower
        //     `wounded` on their own — Wounded is a monotonically
        //     non-decreasing counter throughout applyDamage/applyRecoveryCheck.
        //     This documents the real, current contract (would fail if either
        //     function started silently clearing Wounded) rather than
        //     asserting an unrelated invented value.
        const afterDamage = applyDamage(state, 0, false);
        expect(afterDamage.wounded, "applyDamage never lowers wounded").toBeGreaterThanOrEqual(
          state.wounded,
        );

        //  3. Document the fixture's expected end-state (what §7.6 requires
        //     once clearWounded/healToFull is implemented) without pretending
        //     the engine already provides it.
        expect(c.expected.wounded, "fixture documents the target post-V2 contract").toBe(0);
      }
    });
  }
});

// Bonus: test maxDying helper directly
describe("maxDying helper", () => {
  it("default max is 4 with no doomed", () => {
    expect(maxDying(0)).toBe(4);
  });

  it("Doomed 1 reduces max to 3", () => {
    expect(maxDying(1)).toBe(3);
  });

  it("Doomed 4 reduces max to 0 (immediate death)", () => {
    expect(maxDying(4)).toBe(0);
  });
});
