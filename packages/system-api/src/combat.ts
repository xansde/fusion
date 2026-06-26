/**
 * Combat system-API contract.
 *
 * Defines the combat hooks a game system may register via defineSystem:
 *   - an initiative formula per combatType (registerInitiativeFormula)
 *   - lifecycle hooks (turnStart, turnEnd, roundStart)
 *   - a tracked-resource resolver (getTrackedResource)
 *
 * These are TYPE-LEVEL contracts only. The server (M2-C phase 2) owns the
 * EventBus that invokes the hooks and the registry that stores the formulas;
 * this package only carries the shapes and the registrar surface so systems can
 * declare them at defineSystem() time.
 *
 * Spec: 10-combate-e-iniciativa.md §system API (CombatSystemHooks).
 * Spec: 15-api-de-sistemas.md §REQ-SYS-042 (initiative formula + tiebreaker/compare).
 *
 * REQ-CBT-012: initiative formula delegated to the system API.
 * REQ-CBT-029: turnStart/turnEnd handlers for automations.
 *
 * REQ-ARQ-005: system-api may import from shared; must NOT import server/client.
 */
import type { CombatDocument, CombatantDocument, InitiativeFormulaFn } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Tracked resource
// ---------------------------------------------------------------------------

/**
 * Value returned by getTrackedResource for the tracker's secondary resource
 * column (REQ-CBT-047). E.g. current/max HP plus a display label.
 */
export interface TrackedResourceValue {
  readonly value: number;
  readonly max: number;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// CombatSystemHooks
// ---------------------------------------------------------------------------

/**
 * Combat-related hooks a system may implement.
 *
 * All members are optional: a system that does not customise combat simply
 * omits the entire `combat` block. When omitted, the engine falls back to the
 * generic 1d20 initiative formula (GENERIC_1D20_FORMULA_ID) and no-op lifecycle
 * handlers.
 *
 * Lifecycle handlers run on the SERVER only (DEC-CBT-05): clients receive the
 * resulting document state through the normal broadcast pipeline, not the hooks.
 *
 * Spec: 10-combate-e-iniciativa.md §system API (CombatSystemHooks).
 */
export interface CombatSystemHooks {
  /**
   * Resolve the tracked resource (e.g. HP) shown next to initiative in the
   * tracker for a combatant. Return null when the system has nothing to show.
   *
   * REQ-CBT-047.
   */
  getTrackedResource?(
    combatant: CombatantDocument,
    actor: Record<string, unknown> | null,
    key: string,
  ): TrackedResourceValue | null;

  /**
   * Hook invoked on the server at the START of a combatant's turn.
   * Use for automations such as start-of-turn effects.
   *
   * REQ-CBT-027, REQ-CBT-029.
   */
  turnStart?(combatant: CombatantDocument, combat: CombatDocument): Promise<void> | void;

  /**
   * Hook invoked on the server at the END of a combatant's turn.
   * Use for automations such as decrementing Frightened/Stunned or processing
   * Persistent Damage.
   *
   * REQ-CBT-026, REQ-CBT-029.
   */
  turnEnd?(combatant: CombatantDocument, combat: CombatDocument): Promise<void> | void;

  /**
   * Hook invoked on the server at the START of each new round.
   * Use for per-round condition expiry.
   *
   * REQ-CBT-028.
   */
  roundStart?(combat: CombatDocument): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Registrar surface
// ---------------------------------------------------------------------------

/**
 * The combat-registration surface added to SystemRegistrar.
 *
 * A system calls these inside its defineSystem(build) callback to declare its
 * initiative formulas and lifecycle hooks. The accumulated registrations are
 * exposed on the resulting SystemModule.combat.
 *
 * Spec: 10-combate-e-iniciativa.md §system API.
 */
export interface CombatRegistrar {
  /**
   * Register the initiative formula for a given combatType.
   *
   * At most one formula per combatType: registering the same combatType twice
   * is a programming error and MUST throw (the engine surfaces a clear message).
   *
   * REQ-CBT-012, REQ-CBT-018, REQ-CBT-019.
   */
  registerInitiativeFormula(combatType: string, fn: InitiativeFormulaFn): void;

  /**
   * Register the combat lifecycle hooks for this system.
   *
   * Calling this more than once is a programming error and MUST throw.
   *
   * REQ-CBT-026..029, REQ-CBT-047.
   */
  registerCombatHooks(hooks: CombatSystemHooks): void;
}

// ---------------------------------------------------------------------------
// Module-side shape
// ---------------------------------------------------------------------------

/**
 * The combat registrations carried on a built SystemModule.
 *
 * `initiativeFormulas` maps combatType → formula fn.
 * `hooks` is the single (optional) CombatSystemHooks for the system.
 */
export interface SystemCombatConfig {
  /** combatType → InitiativeFormulaFn. One formula per combatType. */
  readonly initiativeFormulas: ReadonlyMap<string, InitiativeFormulaFn>;
  /** Lifecycle hooks, or null when the system registered none. */
  readonly hooks: CombatSystemHooks | null;
}
