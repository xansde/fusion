/**
 * Server-side InitiativeFormula registry.
 *
 * Holds the set of registered InitiativeFormulas keyed by id.
 * The generic-1d20 formula is registered by default.
 *
 * Systems (M3-A) plug additional formulas via registerFormula().
 *
 * DEC-CBT-02: formula is provided by the system API via registerInitiativeFormula.
 * DEC-CBT-03: rolling always runs on the server (RollService).
 * REQ-CBT-012: nucleus defines "generic-1d20" as fallback.
 */

import type {
  InitiativeFormula,
  InitiativeRollContext,
  InitiativeRollResult,
} from "@fusion/shared";
import { GENERIC_1D20_FORMULA_ID } from "@fusion/shared";
import type { RollService, RollRequest } from "../chat/roll-service.js";

// ---------------------------------------------------------------------------
// Generic 1d20 formula (default / fallback)
// ---------------------------------------------------------------------------

/**
 * Build the generic-1d20 formula bound to a RollService instance.
 *
 * This is the built-in fallback formula:
 *   - rolls 1d20 via RollService (CSPRNG, audit-logged)
 *   - no tiebreaker
 *   - no custom comparator (engine uses defaultInitiativeComparator)
 *
 * REQ-CBT-012: nucleus defines this as the default formula.
 * DEC-CBT-03: RollService is the authoritative RNG — Math.random() is forbidden.
 */
function buildGeneric1d20Formula(rollService: RollService, worldId: string): InitiativeFormula {
  return {
    id: GENERIC_1D20_FORMULA_ID,
    label: "Generic d20",

    roll(ctx: InitiativeRollContext): InitiativeRollResult {
      const rollReq: RollRequest = {
        formula: "1d20",
        mode: "public",
        worldId,
        // Use the combatant's actorId if available, else the combatantId as userId
        userId: ctx.combatant.actorId ?? ctx.combatant._id,
      };
      if (ctx.combatant.actorId) {
        rollReq.actorId = ctx.combatant.actorId;
      }
      const result = rollService.roll(rollReq);
      return { total: result.total };
    },

    // compare omitted — engine uses defaultInitiativeComparator
  };
}

// ---------------------------------------------------------------------------
// Registry class
// ---------------------------------------------------------------------------

/**
 * InitiativeFormulaRegistry — maps formula id → InitiativeFormula.
 *
 * One instance lives per world namespace (created in socket-manager).
 * Systems register additional formulas in M3-A.
 *
 * The registry is NOT keyed by combatType: in M2-C all combatTypes use the
 * generic formula. M3-A systems override by combatType resolution in CombatService.
 */
export class InitiativeFormulaRegistry {
  private readonly formulas = new Map<string, InitiativeFormula>();
  /** Always-present built-in fallback; avoids non-null assertions on Map lookups. */
  private readonly genericFormula: InitiativeFormula;

  constructor(rollService: RollService, worldId: string) {
    // Register the built-in fallback
    this.genericFormula = buildGeneric1d20Formula(rollService, worldId);
    this.formulas.set(GENERIC_1D20_FORMULA_ID, this.genericFormula);
  }

  /**
   * Register or replace a formula. Called by system API in M3-A.
   */
  registerFormula(formula: InitiativeFormula): void {
    this.formulas.set(formula.id, formula);
  }

  /**
   * Get a formula by id. Returns the generic-1d20 fallback when the id is
   * not found (graceful degradation until system formulas are installed).
   */
  getFormula(id: string): InitiativeFormula {
    return this.formulas.get(id) ?? this.genericFormula;
  }

  /**
   * Get the formula appropriate for a combatType.
   *
   * M2-C: all combatTypes resolve to the generic-1d20.
   * M3-A: systems register per-combatType overrides here.
   */
  getFormulaForCombatType(_combatType: string): InitiativeFormula {
    // M2-C default — all types use generic-1d20
    return this.genericFormula;
  }
}
