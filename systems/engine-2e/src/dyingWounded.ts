/**
 * Dying / Wounded / Doomed condition sequencing — PF2e Remaster.
 *
 * Clean-room implementation based on:
 *   docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §8 — Vida, Morte e Recuperação
 *   specs/17-sistema-pf2e.md REQ-PF2-070..074
 *   Archives of Nethys (ORC license).
 *
 * Key rules:
 *   - Reaching 0 HP → gain Dying 1 (or Dying 2 from crit).
 *   - While Wounded X, add X to initial Dying value when gaining Dying.
 *   - Doomed X reduces max Dying by X (default max Dying = 4).
 *   - Dying at max → death.
 *   - Recovery check: flat check DC = 10 + current Dying value.
 *     CritSuccess → Dying -2; Success → Dying -1; Failure → Dying +1; CritFail → Dying +2.
 *   - Losing Dying → gain Wounded 1 (or +1 if already Wounded).
 *   - Taking damage while Dying → Dying +1 (+2 if crit).
 */

import type { DegreeOfSuccess } from "./degreesOfSuccess.js";

/** The recoverable condition state. */
export interface ConditionState {
  readonly hp: number;
  readonly dying: number;
  readonly wounded: number;
  readonly doomed: number;
}

/** The result after applying an event to a ConditionState. */
export interface ConditionStateResult {
  readonly hp: number;
  readonly dying: number;
  readonly wounded: number;
  readonly doomed: number;
  /** False when dying reached maxDying (character is dead). */
  readonly alive: boolean;
  readonly causeOfDeath?: string;
}

/** Recovery check DC = 10 + current Dying value (§8.2). */
export function recoveryCheckDc(dying: number): number {
  return 10 + dying;
}

/** Maximum dying value given a doomed level (§7.6). Default max = 4. */
export function maxDying(doomed: number): number {
  return Math.max(4 - doomed, 0);
}

/**
 * Apply damage to a creature, handling the transition to Dying at 0 HP.
 *
 * §8.1:
 *   - Normal damage at 0 HP → Dying 1 (+ Wounded).
 *   - Critical damage at 0 HP → Dying 2 (+ Wounded).
 *   - Taking damage while already Dying → Dying +1 (+2 if crit), no HP floor.
 *
 * @param state       - Current condition state (hp must be >= 0).
 * @param damage      - Amount of damage (positive).
 * @param isCritical  - Whether this is a critical hit or critical failure effect.
 */
export function applyDamage(
  state: ConditionState,
  damage: number,
  isCritical: boolean,
): ConditionStateResult {
  const newHp = Math.max(state.hp - damage, 0);
  const maxDyingValue = maxDying(state.doomed);

  // Already dying: damage increases Dying further
  if (state.dying > 0) {
    const dyingIncrease = isCritical ? 2 : 1;
    const newDying = state.dying + dyingIncrease;
    const alive = newDying < maxDyingValue;
    if (!alive) {
      return {
        hp: newHp,
        dying: newDying,
        wounded: state.wounded,
        doomed: state.doomed,
        alive: false,
        causeOfDeath: `dying reached max (${String(maxDyingValue)}) due to damage while Dying`,
      };
    }
    return {
      hp: newHp,
      dying: newDying,
      wounded: state.wounded,
      doomed: state.doomed,
      alive: true,
    };
  }

  // Was alive (hp > 0) and now reaches 0
  if (state.hp > 0 && newHp === 0) {
    const baseDying = isCritical ? 2 : 1;
    const newDying = baseDying + state.wounded;
    const alive = newDying < maxDyingValue;
    if (!alive) {
      return {
        hp: 0,
        dying: newDying,
        wounded: state.wounded,
        doomed: state.doomed,
        alive: false,
        causeOfDeath: `dying reached max (${String(maxDyingValue)})`,
      };
    }
    return {
      hp: 0,
      dying: newDying,
      wounded: state.wounded,
      doomed: state.doomed,
      alive: true,
    };
  }

  // Normal damage (still above 0 HP)
  return {
    hp: newHp,
    dying: state.dying,
    wounded: state.wounded,
    doomed: state.doomed,
    alive: true,
  };
}

/**
 * Apply a recovery check result to a Dying creature.
 *
 * §8.2:
 *   - CriticalSuccess: Dying −2.
 *   - Success:         Dying −1.
 *   - Failure:         Dying +1.
 *   - CriticalFailure: Dying +2.
 *   When Dying drops to 0 or below, remove Dying and grant Wounded +1.
 *
 * @param state             - Current condition state (dying > 0 expected).
 * @param degreeOfSuccess   - Outcome of the recovery flat check.
 */
export function applyRecoveryCheck(
  state: ConditionState,
  degreeOfSuccess: DegreeOfSuccess,
): ConditionStateResult {
  const deltaMap: Record<DegreeOfSuccess, number> = {
    CriticalSuccess: -2,
    Success: -1,
    Failure: 1,
    CriticalFailure: 2,
  };
  const delta = deltaMap[degreeOfSuccess];
  const newDying = state.dying + delta;
  const maxDyingValue = maxDying(state.doomed);

  if (newDying >= maxDyingValue) {
    // Dead from worsening
    return {
      hp: state.hp,
      dying: newDying,
      wounded: state.wounded,
      doomed: state.doomed,
      alive: false,
      causeOfDeath: `dying reached maxDying (${String(maxDyingValue)}) due to ${degreeOfSuccess}`,
    };
  }

  if (newDying <= 0) {
    // Recovered! Lose Dying, gain Wounded +1 (§8.3).
    return {
      hp: state.hp,
      dying: 0,
      wounded: state.wounded + 1,
      doomed: state.doomed,
      alive: true,
    };
  }

  return {
    hp: state.hp,
    dying: newDying,
    wounded: state.wounded,
    doomed: state.doomed,
    alive: true,
  };
}

/**
 * Gain the Doomed condition at a given value.
 *
 * §7.6: Doomed X reduces maxDying by X. If Doomed reaches 4 (or if the
 * resulting maxDying <= current Dying), the creature dies immediately.
 */
export function gainDoomed(state: ConditionState, value: number): ConditionStateResult {
  const newDoomed = state.doomed + value;
  const maxDyingValue = maxDying(newDoomed);

  if (maxDyingValue <= 0 || newDoomed >= 4) {
    return {
      hp: state.hp,
      dying: state.dying,
      wounded: state.wounded,
      doomed: newDoomed,
      alive: false,
      causeOfDeath: `Doomed ${String(newDoomed)} = morte imediata`,
    };
  }

  // If current Dying >= new max, also dies
  if (state.dying > 0 && state.dying >= maxDyingValue) {
    return {
      hp: state.hp,
      dying: state.dying,
      wounded: state.wounded,
      doomed: newDoomed,
      alive: false,
      causeOfDeath: `dying reached maxDying (${String(maxDyingValue)}) due to Doomed ${String(newDoomed)}`,
    };
  }

  return {
    hp: state.hp,
    dying: state.dying,
    wounded: state.wounded,
    doomed: newDoomed,
    alive: true,
  };
}
