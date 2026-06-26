/**
 * @fusion/system-pf2e — PF2e Initiative Formula.
 *
 * Registers `pf2e` as the InitiativeFormula type for PF2e combats.
 * Default: 1d20 + @perception (tiebreaker = perception modifier).
 * Optional: combatant can use a skill instead (e.g. Stealth for Avoid Notice).
 *
 * Clean-room: spec 17 DEC-PF2-10, REQ-PF2-090..091.
 * ORC/OGL game mechanics.
 */

import type { InitiativeFormulaFn, InitiativeFormulaResult } from "@fusion/shared";

/**
 * PF2e default initiative formula: Perception check.
 *
 * The returned `formula` is a roll expression consumed by the roll engine.
 * The `tiebreaker` is the perception modifier for ordering ties.
 *
 * REQ-PF2-090: default formula = 1d20 + @perception.
 * REQ-PF2-091: alternative skill selectable per combatant via options.skill.
 *
 * @param _combatant - The combatant document.
 * @param actor      - The actor document (with derived system data), or null.
 * @param options    - Optional combatant-level overrides (e.g. { skill: "stealth" }).
 */
export const pf2eInitiativeFormula: InitiativeFormulaFn = (
  _combatant,
  actor,
  options,
): InitiativeFormulaResult => {
  if (actor === null) {
    // No actor linked: roll pure d20, no tiebreaker.
    return { formula: "1d20", statistic: "Perception" };
  }

  const system = actor["system"] as Record<string, unknown> | undefined;
  const derived = system?.["derived"] as Record<string, unknown> | undefined;

  // Allow combatant to use an alternative skill for initiative (REQ-PF2-091).
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

  // Default: Perception modifier.
  const perception = derived?.["perception"] as Record<string, unknown> | undefined;
  const perceptionTotal = typeof perception?.["total"] === "number" ? perception["total"] : 0;

  return {
    formula: `1d20 + ${String(perceptionTotal)}`,
    tiebreaker: perceptionTotal,
    statistic: "Perception",
  };
};
