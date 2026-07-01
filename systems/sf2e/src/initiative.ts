/**
 * @fusion/system-sf2e — SF2e Initiative Formula.
 *
 * Registers `sf2e` as the InitiativeFormula type for SF2e combats.
 * Default: 1d20 + @perception (tiebreaker = perception modifier) — identical
 * to PF2e's formula (REQ-SF2-004: engine-2e mechanics inherited unmodified).
 * Combatants may still select an alternative skill (e.g. Piloting for a
 * chase/ambush scenario, Stealth for Avoid Notice), same mechanism as PF2e.
 *
 * Starship Scene initiative-by-role (REQ-SF2-035, captain/engineer/gunner/
 * magic officer/pilot/science officer → different skills) is [V2] and
 * depends on the `starship` CombatType (D-SF2-04) — not implemented here.
 *
 * Clean-room: spec 18 §API e Eventos (registrar.initiativeFormula); ORC
 * game mechanics only. Mirrors systems/pf2e/src/initiative.ts.
 * REQ-SF2-004, REQ-SF2-034..035 (V2 hook only).
 */

import type { InitiativeFormulaFn, InitiativeFormulaResult } from "@fusion/shared";

export const sf2eInitiativeFormula: InitiativeFormulaFn = (
  _combatant,
  actor,
  options,
): InitiativeFormulaResult => {
  if (actor === null) {
    return { formula: "1d20", statistic: "Perception" };
  }

  const system = actor["system"] as Record<string, unknown> | undefined;
  const derived = system?.["derived"] as Record<string, unknown> | undefined;

  const alternativeSkill = typeof options?.["skill"] === "string" ? options["skill"] : null;

  if (alternativeSkill !== null) {
    const skillsData = derived?.["skills"] as Record<string, unknown> | undefined;
    const skill = skillsData?.[alternativeSkill] as Record<string, unknown> | undefined;
    const total = typeof skill?.["total"] === "number" ? skill["total"] : 0;
    const label = alternativeSkill.charAt(0).toUpperCase() + alternativeSkill.slice(1);
    return {
      formula: `1d20 + ${String(total)}`,
      tiebreaker: total,
      statistic: label,
    };
  }

  const perception = derived?.["perception"] as Record<string, unknown> | undefined;
  const perceptionTotal = typeof perception?.["total"] === "number" ? perception["total"] : 0;

  return {
    formula: `1d20 + ${String(perceptionTotal)}`,
    tiebreaker: perceptionTotal,
    statistic: "Perception",
  };
};
