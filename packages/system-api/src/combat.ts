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
  ActorApplyDamagePayload,
  ActorApplyConditionPayload,
  ApplyDamageAck,
  ApplyConditionAck,
  RollMode,
  RollResultData,
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
// Turn hooks — DEC-SYS-11 / DF-05: a registry with id + priority (NOT the
// single CombatSystemHooks slot above), aguardado em série pelo servidor,
// depois de persistir a transição de combate e antes do broadcast.
//
// `registerCombatHooks` (above) is NOT replaced: REQ-SYS-141 turns it into an
// ADAPTER whose `turnStart`/`turnEnd`/`roundStart` functions each become one
// entry here with id "legacy" and priority 0 (system-module.ts wires this).
//
// TYPE-LEVEL ONLY (ALQ-F1-02): the server that awaits/executes these hooks is
// ALQ-F1-05/F1-08, out of this task's scope.
//
// Spec: 15-api-de-sistemas.md REQ-SYS-138..141 (verbatim shapes, including
// `RoundHookFn`/`CombatEndHookFn` and `opts` on `onCombatEnd` — spec 15's own
// code block defines these; plan §2.2 references `RoundHookFn` by name
// without spelling it out and omits `opts` on its `onCombatEnd` line. Spec is
// a strict, compatible superset here, so this file follows it — see this
// task's report for the registered divergence against plan §2.2).
// ---------------------------------------------------------------------------

/**
 * Hook invoked when a combatant's turn starts or ends.
 *
 * `combatant.actorId` mirrors `CombatantDocument.actorId` — the intersection
 * is redundant today (the field is already `string | null` there) but kept
 * verbatim to match the spec/plan contract text exactly.
 */
export type TurnHookFn = (
  e: {
    combat: CombatDocument;
    combatant: CombatantDocument & { actorId: string | null };
    actor: Record<string, unknown> | null;
  },
  ctx: TurnHookContext,
) => void | Promise<void>;

/** Hook invoked when a round starts or ends. Spec 15 (not in plan §2.2's own snippet). */
export type RoundHookFn = (
  e: { combat: CombatDocument; round: number },
  ctx: TurnHookContext,
) => void | Promise<void>;

/** Hook invoked when a combat encounter ends. Spec 15's named form of plan §2.2's inline type. */
export type CombatEndHookFn = (
  e: { combat: CombatDocument; actorIds: string[] },
  ctx: TurnHookContext,
) => void | Promise<void>;

/**
 * Services available to a turn/round/combatEnd hook, acting on behalf of the
 * system (`actingAs: "system"` — DEC-SYS-12). Every write goes through the
 * SAME validation/persistence/broadcast path as a client op (REQ-SYS-140):
 * the context does not offer direct database access.
 */
export interface TurnHookContext {
  /** actingAs "system" — REQ-SYS-140. */
  applyDamage(p: ActorApplyDamagePayload): Promise<ApplyDamageAck>;
  applyCondition(p: ActorApplyConditionPayload): Promise<ApplyConditionAck>;
  roll(
    formula: string,
    opts: { flavor: string; speakerActorId?: string; rollMode?: RollMode },
  ): Promise<RollResultData>;
  chat(card: {
    content: string;
    flags?: Record<string, unknown>;
    speakerActorId?: string;
  }): Promise<void>;
  updateActor(actorId: string, diff: Record<string, unknown>): Promise<void>;
  createEmbedded(actorId: string, items: Record<string, unknown>[]): Promise<void>;
  deleteEmbedded(actorId: string, itemIds: string[]): Promise<void>;
  worldTime: { round: number; turn: number };
}

/**
 * One entry in a sorted, inspectable turn-hook registry (REQ-SYS-137:
 * "um SystemModule é um valor puro ... inspecionável em teste de unidade").
 */
export interface RegisteredTurnHook<Fn> {
  readonly id: string;
  readonly priority: number;
  readonly fn: Fn;
}

/**
 * The five turn-hook registries carried on a built SystemModule, each already
 * sorted per REQ-SYS-139 (priority descending, then registration order).
 *
 * Spec: 15-api-de-sistemas.md §"Hooks de turno aguardados e mecânica de ator".
 */
export interface TurnHookRegistrations {
  readonly onTurnStart: ReadonlyArray<RegisteredTurnHook<TurnHookFn>>;
  readonly onTurnEnd: ReadonlyArray<RegisteredTurnHook<TurnHookFn>>;
  readonly onRoundStart: ReadonlyArray<RegisteredTurnHook<RoundHookFn>>;
  readonly onRoundEnd: ReadonlyArray<RegisteredTurnHook<RoundHookFn>>;
  readonly onCombatEnd: ReadonlyArray<RegisteredTurnHook<CombatEndHookFn>>;
}

/**
 * The turn-hook registration surface added to SystemRegistrar (DEC-SYS-11).
 *
 * Every event accepts MULTIPLE callbacks (DF-05) — registering the same `id`
 * twice for the SAME event, in the same system, MUST throw (REQ-SYS-138);
 * the same `id` MAY be reused across DIFFERENT events (each event keeps its
 * own id namespace). `priority` defaults to 0; within an event, callbacks run
 * in priority-descending order, tie-broken by registration order
 * (REQ-SYS-139).
 */
export interface TurnHookRegistrar {
  onTurnStart(id: string, fn: TurnHookFn, opts?: { priority?: number }): void;
  onTurnEnd(id: string, fn: TurnHookFn, opts?: { priority?: number }): void;
  onRoundStart(id: string, fn: RoundHookFn, opts?: { priority?: number }): void;
  onRoundEnd(id: string, fn: RoundHookFn, opts?: { priority?: number }): void;
  onCombatEnd(id: string, fn: CombatEndHookFn, opts?: { priority?: number }): void;
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
 * Extends TurnHookRegistrar (DEC-SYS-11) so a system declares initiative
 * formulas, the legacy lifecycle-hook slot, AND the id+priority turn hooks
 * through the SAME registrar object.
 *
 * Spec: 10-combate-e-iniciativa.md §system API.
 */
export interface CombatRegistrar extends TurnHookRegistrar {
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
 *
 * `turnHooks` (DEC-SYS-11) is the id+priority registry described above —
 * ALWAYS present (each of its five arrays is empty when the system
 * registered nothing for that event), already merged with whatever
 * `registerCombatHooks` contributed as `id: "legacy"` entries (REQ-SYS-141).
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
  /** Sorted turn/round/combatEnd hook registrations (DEC-SYS-11, REQ-SYS-138..141). */
  readonly turnHooks: TurnHookRegistrations;
}
