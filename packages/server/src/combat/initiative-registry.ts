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
 * Systems register formulas via registerSystemFormulas() (system-formula-adapter.ts),
 * which wraps each SystemModule.combat.initiativeFormulas entry.
 *
 * REQ-CBT-012: getFormulaForCombatType resolves the formula registered for a
 * CombatDocument's combatType, falling back to the world's active systemId
 * (systems currently register under their own systemId — see
 * system-formula-adapter.ts docstring) and finally to generic-1d20.
 */
export class InitiativeFormulaRegistry {
  private readonly formulas = new Map<string, InitiativeFormula>();
  /** Always-present built-in fallback; avoids non-null assertions on Map lookups. */
  private readonly genericFormula: InitiativeFormula;
  /** World's active systemId, used as a secondary resolution key (see getFormulaForCombatType). */
  private readonly systemId: string | undefined;

  constructor(rollService: RollService, worldId: string, systemId?: string) {
    // Register the built-in fallback
    this.genericFormula = buildGeneric1d20Formula(rollService, worldId);
    this.formulas.set(GENERIC_1D20_FORMULA_ID, this.genericFormula);
    this.systemId = systemId;
  }

  /**
   * Register or replace a formula. Called by system API wiring (system-formula-adapter.ts).
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
   * Resolution order:
   *   1. Exact combatType match (e.g. a system registered "starship" directly).
   *   2. The world's active systemId (pf2e/sf2e register their default
   *      formula under their own systemId — see system-formula-adapter.ts).
   *   3. generic-1d20 fallback (REQ-CBT-012).
   */
  getFormulaForCombatType(combatType: string): InitiativeFormula {
    const exact = this.formulas.get(combatType);
    if (exact) return exact;

    if (this.systemId !== undefined) {
      const bySystem = this.formulas.get(this.systemId);
      if (bySystem) return bySystem;
    }

    return this.genericFormula;
  }
}
