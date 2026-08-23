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
import type {
  CombatDocument,
  CombatantDocument,
  InitiativeEntry,
  InitiativeFormulaFn,
} from "@fusion/shared";

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
// Initiative formula registration — roll fn + optional compare (M5-A / E3)
// ---------------------------------------------------------------------------

/**
 * Non-monotonic initiative comparator type — mirrors
 * `InitiativeFormula.compare` from `@fusion/shared`.
 *
 * REQ-ETM-022 needs "players beat NPCs", which cannot be expressed as a
 * single numeric tiebreaker (`InitiativeFormulaResult.tiebreaker`) — it is a
 * relation between two combatants, not a per-combatant score. This mirrors
 * `InitiativeFormula.compare` (already supported end-to-end by
 * `sortCombatants`); this is simply the missing REGISTRATION path that lets
 * a system supply one alongside its roll function.
 *
 * Spec: 15-api-de-sistemas.md §REQ-SYS-042.
 */
export type InitiativeCompareFn = (a: InitiativeEntry, b: InitiativeEntry) => number;

/**
 * Full initiative-formula registration: the roll function plus an optional
 * non-monotonic comparator. Object form of `registerInitiativeFormula`'s
 * second argument (M5-A E3).
 */
export interface InitiativeFormulaRegistration {
  /** The roll function — same contract as the bare-function registration form. */
  readonly roll: InitiativeFormulaFn;
  /**
   * Optional non-monotonic comparator, forwarded verbatim to the adapted
   * `InitiativeFormula.compare` used by `sortCombatants`.
   *
   * When omitted, the engine applies the default numeric-tiebreaker
   * comparator (unchanged behaviour).
   */
  readonly compare?: InitiativeCompareFn;
}

/**
 * Accepted shapes for `registerInitiativeFormula`'s second argument:
 * a bare roll function (legacy/simple form, unchanged) OR an object carrying
 * `{ roll, compare? }` (M5-A E3, needed for non-monotonic tiebreaking).
 */
export type InitiativeFormulaRegistrationInput =
  | InitiativeFormulaFn
  | InitiativeFormulaRegistration;

/**
 * Type guard distinguishing the object registration form from the bare
 * function form. A bare function has `typeof === "function"`; the object
 * form is a plain object with a `roll` property.
 */
export function isInitiativeFormulaRegistrationObject(
  input: InitiativeFormulaRegistrationInput,
): input is InitiativeFormulaRegistration {
  return typeof input !== "function";
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
   * Accepts EITHER:
   *   - a bare `InitiativeFormulaFn` (legacy/simple form — unchanged; PF2e
   *     and SF2e both call it this way and require NO changes), OR
   *   - an `{ roll, compare? }` object (M5-A E3), letting a system supply a
   *     non-monotonic `compare()` alongside the roll function (e.g. "players
   *     beat NPCs" regardless of total initiative value).
   *
   * At most one formula per combatType: registering the same combatType twice
   * is a programming error and MUST throw (the engine surfaces a clear message).
   *
   * REQ-CBT-012, REQ-CBT-018, REQ-CBT-019, REQ-SYS-042.
   */
  registerInitiativeFormula(combatType: string, fn: InitiativeFormulaRegistrationInput): void;

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
 * `initiativeFormulas` maps combatType → roll fn — UNCHANGED shape/type from
 * before M5-A, so every existing consumer that reads
 * `SystemModule.combat.initiativeFormulas.get(id)` and calls it as a plain
 * `InitiativeFormulaFn` (e.g. `systems/pf2e/src/__tests__/*`,
 * `system-formula-adapter.ts`) keeps working with ZERO changes.
 *
 * `initiativeCompares` is a NEW, parallel, sparse map (M5-A E3): only
 * combatTypes registered via the `{ roll, compare }` object form get an
 * entry here. Consumers that want the optional comparator look it up by the
 * same `combatType` key; combatTypes registered via the bare-function form
 * (PF2e/SF2e) simply have no entry, which is the correct "no custom
 * compare" signal (falls back to `defaultInitiativeComparator`).
 *
 * `hooks` is the single (optional) CombatSystemHooks for the system.
 */
export interface SystemCombatConfig {
  /** combatType → InitiativeFormulaFn. One formula per combatType. Unchanged since before M5-A. */
  readonly initiativeFormulas: ReadonlyMap<string, InitiativeFormulaFn>;
  /**
   * combatType → optional non-monotonic comparator (M5-A E3). Sparse: only
   * present for combatTypes registered via the `{ roll, compare }` form.
   */
  readonly initiativeCompares: ReadonlyMap<string, InitiativeCompareFn>;
  /** Lifecycle hooks, or null when the system registered none. */
  readonly hooks: CombatSystemHooks | null;
}
