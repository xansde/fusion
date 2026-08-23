/**
 * Combat — core types (interfaces and enums).
 *
 * Defines the in-memory shape of Combat and Combatant documents,
 * the InitiativeFormula contract, and the CombatLifecycleEvent union.
 *
 * These types are consumed by both server (handler logic) and client (UI).
 *
 * Spec: 10-combate-e-iniciativa.md
 * Spec: 02-modelo-de-dados.md §CombatDocument / CombatantData
 * Spec: 15-api-de-sistemas.md (InitiativeFormula contract, REQ-SYS-042)
 *
 * REQ-ARQ-002: shared must NOT import from server, client, system-api, or systems/*.
 */

import type { Flags } from "../document.js";

// ---------------------------------------------------------------------------
// CombatantDocument — embedded in CombatDocument
// ---------------------------------------------------------------------------

/**
 * A participant in a combat encounter.
 *
 * Embedded in CombatDocument.combatants. Ownership delegates to the
 * referenced token / actor (REQ-DOC-025).
 *
 * Spec: 10-combate-e-iniciativa.md §Modelo de Dados
 * Spec: 02-modelo-de-dados.md §CombatantData
 */
export interface CombatantDocument {
  /** 16-char nanoid, unique within the parent CombatDocument. */
  _id: string;

  /**
   * Soft reference to the Token in the scene.
   * May be null if the combatant has no associated token (unusual but valid).
   */
  tokenId: string | null;

  /**
   * Soft reference to the Actor base document.
   * Nullable — combatants without actors (anonymous) are allowed.
   */
  actorId: string | null;

  /**
   * Display name snapshot for the tracker.
   * Taken from the token/actor at creation time; may diverge if the
   * actor is renamed after the combatant was added.
   */
  name: string;

  /**
   * Token image snapshot (thumbnail for the tracker).
   * May be null if the token has no image.
   */
  img: string | null;

  /**
   * Initiative value determining position in the turn order.
   * null = not yet rolled / not yet set manually.
   *
   * REQ-CBT-010: individual roll; REQ-CBT-014: manual set.
   */
  initiative: number | null;

  /**
   * Identifier of the statistic used as initiative (e.g. "perception", "stealth").
   * Stored to support systems like PF2e that allow skill-based initiative.
   *
   * REQ-CBT-018: PF2e sets this when the player selects a skill.
   */
  initiativeStatistic: string | null;

  /**
   * Whether this combatant is hidden from players in the tracker.
   *
   * REQ-CBT-031: hidden combatants are invisible to players.
   * REQ-CBT-032: GM always sees all combatants (with a hidden indicator).
   *
   * IMPORTANT: hidden combatants must NEVER leak their position, initiative
   * value, name, or existence to players through any network path
   * (snapshot, broadcast, ack). The redaction layer enforces this — see
   * packages/server/src/net/redaction.ts.
   */
  hidden: boolean;

  /**
   * Whether this combatant has been defeated.
   *
   * REQ-CBT-024: GM can mark defeated; REQ-CBT-025: GM can unmark.
   * REQ-CBT-023: with skipDefeated, defeated combatants are skipped by nextTurn.
   */
  defeated: boolean;

  /**
   * Whether this combatant's actor is owned by at least one player.
   * Cached at creation time to avoid round-trips to the actor on every
   * tracker render. The server refreshes this cache when ownership changes.
   *
   * Used to distinguish PC combatants from NPC combatants for redaction
   * and initiative UI (REQ-CBT-034: players roll their own initiative).
   */
  hasPlayerOwner: boolean;

  /**
   * Namespaced arbitrary data for system extensions.
   * Structure: { [namespace]: { [key]: value } }
   * REQ-DOC-009.
   */
  flags: Flags;
}

// ---------------------------------------------------------------------------
// CombatDocument — primary document
// ---------------------------------------------------------------------------

/**
 * Primary document representing a combat encounter.
 *
 * Persisted in world.db (combats table). The combatants array is stored as
 * embedded JSON within the document row (DEC-PER-02, REQ-DOC-018).
 *
 * Spec: 10-combate-e-iniciativa.md §DEC-CBT-01, §DEC-CBT-06
 * Spec: 02-modelo-de-dados.md §CombatDocument
 * REQ-CBT-001: persisted in world.db.
 * REQ-CBT-005: round, turn, started persisted after every transition.
 */
export interface CombatDocument {
  /** 16-char nanoid. REQ-DOC-001. */
  _id: string;

  /**
   * Soft reference to the Scene this encounter belongs to.
   * REQ-CBT-001: encounter is associated to the active scene.
   * REQ-CBT-006 (DEC-CBT-06): one active combat per scene in MVP.
   */
  sceneId: string;

  /**
   * Current round number. Starts at 1 when the encounter begins.
   * REQ-CBT-020: round = 1 at startCombat.
   */
  round: number;

  /**
   * Index of the active combatant in the ordered turns array.
   * 0 = first combatant; incremented by nextTurn / decremented by previousTurn.
   *
   * Canonical field name per spec 10 §Modelo de Dados (CombatDocument.turnIndex).
   * REQ-CBT-020: turnIndex = 0 at startCombat.
   * REQ-CBT-021: nextTurn advances; wraps to 0 and increments round.
   * REQ-CBT-022: previousTurn recedes; wraps to last and decrements round.
   *
   * IMPORTANT: turnIndex is positional against the GM's FULL combatants array.
   * Players receive a redacted array (hidden combatants stripped), so indexing
   * into a player's array with turnIndex points at the WRONG combatant. Players
   * MUST resolve the active combatant via `activeCombatantId` (by `_id`).
   */
  turnIndex: number;

  /**
   * _id of the active combatant, or null when the combat has not started or has
   * no eligible combatant.
   *
   * Authoritative, redaction-stable pointer to whose turn it is. The server
   * maintains it on every transition. For non-GM viewers the server masks it to
   * null when the active combatant is hidden (REQ-CBT-031), so a player never
   * learns the id/existence of a hidden active combatant.
   *
   * The client derives the active-turn highlight (REQ-CBT-042) and the canvas
   * turn marker (REQ-CBT-050/052) from this id, NOT from turnIndex.
   */
  activeCombatantId: string | null;

  /**
   * Whether the encounter has been started (beginCombat was called).
   * REQ-CBT-020: false until beginCombat.
   */
  started: boolean;

  /**
   * Whether the encounter has ended (endCombat was called).
   * REQ-CBT-006: set to true after endCombat; document is retained for history.
   */
  ended: boolean;

  /**
   * When true (default), nextTurn automatically skips combatants with defeated=true.
   * REQ-CBT-023 (DEC-CBT-07).
   */
  skipDefeated: boolean;

  /**
   * When true, the canvas auto-pans to the active token on each turn change.
   * REQ-CBT-045.
   */
  autoPan: boolean;

  /**
   * Discriminator for the type of encounter.
   * "standard" covers PF2e normal combats.
   * "starship" is reserved for SF2e cinematic starship scenes [V2].
   * Systems may register custom combat types via the system API.
   * REQ-CBT-012: fórmula de iniciativa é delegada pela system API por combatType.
   */
  combatType: string;

  /**
   * Actor attribute path to show as a secondary resource in the tracker.
   * Example: "attributes.hp" (displayed alongside initiative value).
   * null = no secondary resource displayed.
   * REQ-CBT-047.
   */
  trackedResource: string | null;

  /**
   * Ordered list of participants.
   * The server maintains this array sorted by the active InitiativeFormula's
   * comparator. Combatants with initiative=null are appended after sorted ones.
   *
   * REQ-CBT-016: order is computed by the comparator.
   * REQ-CBT-017: manual reorder (drag) updates initiative values to preserve order.
   */
  combatants: CombatantDocument[];

  /**
   * Namespaced arbitrary data for system extensions.
   * REQ-DOC-009.
   */
  flags: Flags;

  /**
   * Sort order within a list of combats (rarely used; one combat per scene in MVP).
   */
  sort: number;
}

// ---------------------------------------------------------------------------
// Turn snapshot — immutable state before/after a turn transition
// ---------------------------------------------------------------------------

/**
 * Immutable snapshot of the combat state at a specific turn/round.
 * Carried in lifecycle events to allow before/after comparisons.
 *
 * Spec: 10-combate-e-iniciativa.md §CombatTurnSnapshot
 */
export interface CombatTurnSnapshot {
  readonly round: number;
  readonly turnIndex: number;
  /** _id of the active combatant, or null if combat has not started. */
  readonly combatantId: string | null;
  /** tokenId of the active combatant, or null. */
  readonly tokenId: string | null;
}

// ---------------------------------------------------------------------------
// Combat lifecycle event names
// ---------------------------------------------------------------------------

/**
 * Union type of all combat lifecycle event names emitted by the server's
 * internal EventBus.
 *
 * These names correspond exactly to the hooks that the system API can register
 * handlers for (spec 15-api-de-sistemas.md §CombatSystemHooks).
 *
 * DEC-CBT-05: events are emitted on the server EventBus (Node.js EventEmitter),
 * NOT forwarded directly to clients as socket events. Clients receive the
 * updated CombatDocument state via the normal broadcast pipeline.
 *
 * REQ-CBT-026: turnEnd before advancing state.
 * REQ-CBT-027: turnStart after updating state.
 * REQ-CBT-028: roundEnd then roundStart when wrapping to a new round.
 */
export type CombatLifecycleEventName =
  | "combatStart"
  | "roundStart"
  | "turnStart"
  | "turnEnd"
  | "roundEnd"
  | "combatEnd";

// ---------------------------------------------------------------------------
// CombatLifecycleEvent — discriminated union for EventBus
// ---------------------------------------------------------------------------

/**
 * Discriminated union of all lifecycle events emitted on the server EventBus.
 *
 * The server emits these in order during turn/round transitions.
 * System API handlers listen to these events to process automations
 * (e.g., decrement conditions on turnEnd, recovery checks on roundEnd).
 *
 * Spec: 10-combate-e-iniciativa.md §DEC-CBT-05, §REQ-CBT-026..029
 * Spec: 15-api-de-sistemas.md §CombatSystemHooks
 */
export type CombatLifecycleEvent =
  | {
      readonly type: "combatStart";
      readonly combat: CombatDocument;
    }
  | {
      readonly type: "turnStart";
      readonly combat: CombatDocument;
      readonly combatant: CombatantDocument;
      /** State immediately before the turn started. */
      readonly previous: CombatTurnSnapshot;
    }
  | {
      readonly type: "turnEnd";
      readonly combat: CombatDocument;
      readonly combatant: CombatantDocument;
    }
  | {
      readonly type: "roundStart";
      readonly combat: CombatDocument;
      readonly round: number;
    }
  | {
      readonly type: "roundEnd";
      readonly combat: CombatDocument;
      readonly round: number;
    }
  | {
      readonly type: "combatEnd";
      readonly combat: CombatDocument;
    };

// ---------------------------------------------------------------------------
// InitiativeFormula — pluggable initiative contract
// ---------------------------------------------------------------------------

/**
 * Context object passed to InitiativeFormula.roll().
 *
 * The server assembles this context from its document store before calling
 * the formula. The formula must not mutate the context.
 *
 * REQ-CBT-012: formula is registered by the system API.
 * DEC-CBT-03: rolling always happens on the server (anti-cheat).
 */
export interface InitiativeRollContext {
  /** The combatant whose initiative is being rolled. */
  readonly combatant: CombatantDocument;

  /**
   * The full actor document (or null if the combatant has no actorId or the
   * actor has been deleted — formula must handle null gracefully).
   */
  readonly actor: Record<string, unknown> | null;

  /** The parent combat document (read-only; do not mutate). */
  readonly combat: CombatDocument;

  /**
   * Extra options forwarded from the roll request
   * (e.g., { advantage: true } in some systems).
   */
  readonly options: Record<string, unknown>;
}

/**
 * Value returned by InitiativeFormula.roll().
 *
 * The server uses `total` as the combatant's initiative value.
 * `tiebreaker` is optional — when provided, the comparator uses it to
 * resolve equal totals before falling back to insertion order (REQ-CBT-013).
 *
 * DEC-CBT-04: tiebreaker is a separate numeric value (not a decimal fraction)
 * to avoid precision loss and to accommodate non-monotonic tiebreaking via
 * the formula's compare() function.
 */
export interface InitiativeRollResult {
  /**
   * The final initiative value to store in combatant.initiative.
   * Must be a finite number.
   */
  readonly total: number;

  /**
   * Optional secondary tiebreaker.
   * When two combatants have the same `total`, the comparator sorts by
   * `tiebreaker` descending (higher = earlier in turn order).
   * Omit or pass undefined when the system does not use a numeric tiebreaker.
   *
   * REQ-CBT-013: tiebreaker is applied before insertion-order fallback.
   */
  readonly tiebreaker?: number;

  /**
   * Human-readable label of the statistic used (e.g. "Perception", "Stealth").
   * Stored as combatant.initiativeStatistic when provided.
   */
  readonly statistic?: string;
}

/**
 * An entry in the sorted initiative order.
 * Passed to InitiativeFormula.compare() for non-monotonic tiebreaking.
 *
 * DEC-CBT-04: compare(a, b) is preferred over tiebreaker for desempates
 * that cannot be expressed as a single number (e.g. a rule where every
 * player character outranks every NPC, regardless of total initiative
 * value).
 */
export interface InitiativeEntry {
  readonly combatant: CombatantDocument;
  /** Final rolled initiative value, or `null` when the combatant has not rolled yet. */
  readonly total: number | null;
  readonly tiebreaker?: number;
}

/**
 * Result of a system-API initiative formula function (spec 10 §Modelo de Dados).
 *
 * This is the spec-literal contract that the system API's InitiativeFormulaFn
 * returns. The engine resolves `formula` through the roll engine (replacing
 * `@attr` via roll data), stores `total` (the resolved roll) as
 * combatant.initiative, `statistic` as combatant.initiativeStatistic, and uses
 * `tiebreaker` for the default comparator.
 *
 * Non-monotonic tiebreaking (e.g. "players beat NPCs") is supplied as a
 * `compare(a, b)` on the registered InitiativeFormula, NOT here (see
 * 15-api-de-sistemas.md REQ-SYS-042).
 *
 * Spec: 10-combate-e-iniciativa.md §Modelo de Dados (InitiativeFormulaResult).
 */
export interface InitiativeFormulaResult {
  /** Dice formula string, e.g. "1d20+@perception" — resolved by the roll engine. */
  readonly formula: string;
  /** Optional secondary numeric tiebreaker (e.g. PF2e Perception modifier). */
  readonly tiebreaker?: number;
  /** Human-readable statistic label for display (e.g. "Perception"). */
  readonly statistic: string;
}

/**
 * System-API initiative formula function (spec 10 §Modelo de Dados).
 *
 * Registered via CombatSystemHooks.registerInitiativeFormula(combatType, fn) in
 * @fusion/system-api. The server invokes it on the authoritative side
 * (DEC-CBT-03) to obtain the dice formula + tiebreaker + statistic for a
 * combatant, then rolls the formula through RollService.
 *
 * `actor` is the actor document (or null when the combatant has no actorId or
 * the actor was deleted — the function must handle null gracefully).
 *
 * Spec: 10-combate-e-iniciativa.md §Modelo de Dados (InitiativeFormulaFn).
 * Spec: 15-api-de-sistemas.md §REQ-SYS-042.
 */
export type InitiativeFormulaFn = (
  combatant: CombatantDocument,
  actor: Record<string, unknown> | null,
  options?: Record<string, unknown>,
) => InitiativeFormulaResult | Promise<InitiativeFormulaResult>;

/**
 * Pluggable initiative formula registered by the system API.
 *
 * Systems register formulas via the system API's registerInitiativeFormula().
 * The engine stores the registry keyed by formula id and invokes the active
 * formula when rolling initiative for a combat of the matching combatType.
 *
 * Contract:
 *   - roll() is ALWAYS invoked on the server (DEC-CBT-03).
 *   - roll() may be async (e.g., to query additional actor data from the DB).
 *   - compare() is a pure synchronous total order (must handle all inputs).
 *   - compare() has precedence over tiebreaker when both are provided.
 *
 * Spec: 10-combate-e-iniciativa.md §DEC-CBT-02, §DEC-CBT-04
 * Spec: 15-api-de-sistemas.md §REQ-SYS-042
 */
export interface InitiativeFormula {
  /**
   * Unique identifier for this formula (e.g. "generic-1d20", "pf2e-perception").
   * Used as a key in the formula registry.
   */
  readonly id: string;

  /**
   * Human-readable label shown in the UI (e.g. "Generic d20", "Perception (PF2e)").
   */
  readonly label: string;

  /**
   * Roll the initiative for a single combatant.
   *
   * The implementation MUST use RollService (server-side RNG) to produce dice
   * results. It must NOT use Math.random() or any client-side randomness.
   *
   * @param context - combatant, actor, combat, and roll options.
   * @returns The initiative result (total + optional tiebreaker + statistic label).
   *
   * REQ-CBT-010: individual roll.
   * DEC-CBT-03: RNG on the server.
   */
  roll(context: InitiativeRollContext): Promise<InitiativeRollResult> | InitiativeRollResult;

  /**
   * Compare two initiative entries for sorting.
   *
   * Returns a negative number if `a` should come BEFORE `b` (i.e., a has
   * higher priority in the turn order), zero if equal, positive if `a` should
   * come AFTER `b`.
   *
   * When this function is provided, the engine uses it as the sole comparator
   * (overriding tiebreaker). When omitted, the engine applies the default
   * comparator (see defaultInitiativeComparator).
   *
   * REQ-CBT-013: compare has precedence over tiebreaker.
   * DEC-CBT-04: supports non-monotonic rules (e.g. "players beat NPCs").
   */
  compare?: (a: InitiativeEntry, b: InitiativeEntry) => number;
}
