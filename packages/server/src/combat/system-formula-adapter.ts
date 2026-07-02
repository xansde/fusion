/**
 * System-formula adapter — bridges the system API's InitiativeFormulaFn
 * (spec-literal, "what to roll") to the server's InitiativeFormula contract
 * (engine-facing, "how to roll it", REQ-CBT-012, DEC-CBT-03).
 *
 * A system module (SystemModule.combat.initiativeFormulas) declares, per
 * combatType, a pure function that computes a dice-formula string + optional
 * tiebreaker + statistic label from (combatant, actor, options). This adapter
 * wraps that function into an InitiativeFormula whose `roll()` actually
 * executes the formula through RollService — the ONLY place dice are rolled
 * (anti-cheat, DEC-CBT-03).
 *
 * M5-A (E3): InitiativeFormula already supports an optional `compare(a, b)`
 * for non-monotonic tiebreaking (REQ-SYS-042, DEC-CBT-04). Since M5-A, a
 * system can register that comparator alongside its roll function via
 * `registrar.registerInitiativeFormula(combatType, { roll, compare })`
 * (system-api `combat.ts`), which the system module exposes in the sparse,
 * parallel `SystemModule.combat.initiativeCompares` map (keyed by the same
 * `combatType`). `registerSystemFormulas` looks up that map and, when an
 * entry exists, forwards it to `adaptSystemInitiativeFormula` so the
 * resulting `InitiativeFormula.compare` is wired for real — the engine's
 * `sortCombatants` picks it up automatically (it already reads
 * `formula.compare` unconditionally). Systems that register via the bare-fn
 * form (PF2e/SF2e) have no entry in `initiativeCompares`, so `compare` stays
 * `undefined` and the engine falls back to `defaultInitiativeComparator` —
 * IDENTICAL behaviour to before M5-A.
 */

import type {
  InitiativeEntry,
  InitiativeFormula,
  InitiativeFormulaFn,
  InitiativeRollContext,
  InitiativeRollResult,
} from "@fusion/shared";
import type { RollService, RollRequest } from "../chat/roll-service.js";

/**
 * Wrap a system-API InitiativeFormulaFn into a server-side InitiativeFormula.
 *
 * @param id         Formula id used as the registry key (by convention the
 *                    system's combatType/systemId — see registerSystemFormulas).
 * @param label      Human-readable label for the UI.
 * @param fn         The system-registered formula function.
 * @param rollService Server-authoritative dice roller (DEC-CBT-03).
 * @param worldId    World namespace, forwarded to RollRequest for audit log.
 * @param compare    Optional non-monotonic comparator (M5-A E3). When
 *                    provided, set verbatim on the returned InitiativeFormula
 *                    so `sortCombatants` uses it instead of the default
 *                    numeric-tiebreaker comparator. Omit (or pass undefined)
 *                    to preserve the pre-M5-A behaviour exactly.
 */
export function adaptSystemInitiativeFormula(
  id: string,
  label: string,
  fn: InitiativeFormulaFn,
  rollService: RollService,
  worldId: string,
  compare?: (a: InitiativeEntry, b: InitiativeEntry) => number,
): InitiativeFormula {
  const formula: InitiativeFormula = {
    id,
    label,

    async roll(ctx: InitiativeRollContext): Promise<InitiativeRollResult> {
      const formulaResult = await fn(ctx.combatant, ctx.actor, ctx.options);

      const rollReq: RollRequest = {
        formula: formulaResult.formula,
        mode: "public",
        worldId,
        userId: ctx.combatant.actorId ?? ctx.combatant._id,
      };
      if (ctx.combatant.actorId) {
        rollReq.actorId = ctx.combatant.actorId;
      }

      const result = rollService.roll(rollReq);

      const rollResult: {
        total: number;
        tiebreaker?: number;
        statistic?: string;
      } = { total: result.total, statistic: formulaResult.statistic };
      if (formulaResult.tiebreaker !== undefined) {
        rollResult.tiebreaker = formulaResult.tiebreaker;
      }
      return rollResult;
    },
  };

  if (compare !== undefined) {
    return { ...formula, compare };
  }
  // compare omitted — engine uses defaultInitiativeComparator.
  return formula;
}

/**
 * Register every InitiativeFormulaFn declared by a SystemModule's combat
 * config onto an InitiativeFormulaRegistry, adapting each one via
 * adaptSystemInitiativeFormula.
 *
 * The system-API key space (SystemModule.combat.initiativeFormulas) is
 * currently populated by systems using their own systemId as the map key
 * (e.g. pf2e/sf2e both call registerInitiativeFormula(systemId, fn) — see
 * systems/pf2e/src/index.ts, systems/sf2e/src/index.ts), while
 * CombatDocument.combatType defaults to "standard" (spec 10 §Modelo de
 * Dados). This function registers ONLY under the declared key (`combatType`,
 * which in practice equals the system's own id — see above). Resolution for
 * the "standard" default combatType still works because
 * InitiativeFormulaRegistry.getFormulaForCombatType() falls back to the
 * registry's own `systemId` (its second resolution step — see
 * initiative-registry.ts) when no exact combatType match exists — no
 * duplicate registration under a second key is needed or performed here.
 *
 * M5-A (E3): `initiativeCompares` is the SystemModule's sparse map of
 * per-combatType comparators (populated only for systems using the
 * `{ roll, compare }` registration form). Passing it here is what makes the
 * compare propagate end-to-end (system registration → SystemModule →
 * adapter → InitiativeFormula → sortCombatants). Omitting the parameter
 * (or passing an empty map) reproduces the exact pre-M5-A behaviour.
 */
export function registerSystemFormulas(
  registry: { registerFormula(formula: InitiativeFormula): void },
  systemId: string,
  initiativeFormulas: ReadonlyMap<string, InitiativeFormulaFn>,
  rollService: RollService,
  worldId: string,
  initiativeCompares?: ReadonlyMap<string, (a: InitiativeEntry, b: InitiativeEntry) => number>,
): void {
  for (const [combatType, fn] of initiativeFormulas) {
    const label = `${systemId} (${combatType})`;
    const compare = initiativeCompares?.get(combatType);
    const adapted = adaptSystemInitiativeFormula(
      combatType,
      label,
      fn,
      rollService,
      worldId,
      compare,
    );
    registry.registerFormula(adapted);
  }
}
