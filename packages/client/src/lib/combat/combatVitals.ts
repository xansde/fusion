/**
 * combatVitals.ts — health by role and conditions by contract, for the combat tab.
 *
 * Two things a participant carries, and they answer to opposite rules:
 *
 *  - **Health is accounting.** A privileged role reads bar and number of everyone
 *    (REQ-CBA-040); a player reads the health of PLAYER CHARACTERS and of nobody else —
 *    no number, no fraction, no bar, no qualitative step (REQ-CBA-041). When the value
 *    cannot be resolved, the panel omits it instead of drawing a full or empty bar
 *    (REQ-CBA-043).
 *  - **A condition is fiction.** It keeps being drawn for a participant whose health this
 *    viewer may not read (REQ-CBA-053, DEC-CTT-11): the table watches a creature stagger
 *    without being told how many hit points that costs.
 *
 * Q-CBA-02 — the honest scope of the health rule. Creature health already reaches the
 * player's client by another path: a token may draw its own resource bars (REQ-CNV-090),
 * so what `resolveHpView` does for a player is a rule of THIS SCREEN, not a seal on the
 * data. REQ-CBA-083 requires that distinction be written where the rule lives, and spec 40
 * §13 keeps the question open for whoever owns Token. Anyone tightening this later fixes it
 * at the server's single redaction module, not by adding another filter here.
 *
 * Pure module: no runes, no components, no socket.
 */

import type { TurnHeadHealth } from "./turnHead.svelte.js";
import type { ViewerRole } from "./combatVisibility.js";
import { readActorConditions } from "../conditions/conditionChip.js";
import type { ConditionChipModel, ConditionContractLookup } from "../conditions/conditionChip.js";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The little `resolveHpView` needs from a participant.
 *
 * `hasPlayerOwner` is the server's cached answer to "is this a player character?" — it is
 * what separates the two halves of REQ-CBA-041, and it is maintained server-side when
 * ownership changes, so the panel never re-derives it from an ownership map it may not have.
 */
export interface CombatantVitalsSubject {
  readonly actorId: string | null;
  readonly hasPlayerOwner: boolean;
}

/** Health and conditions of one participant, resolved for one viewer. */
export interface CombatantVitals {
  /** `null` means "draw nothing" — unresolvable, or not this viewer's to read. */
  readonly health: TurnHeadHealth | null;
  /** Ordered by the condition contract (REQ-CBA-051); independent of `health`. */
  readonly conditions: readonly ConditionChipModel[];
}

// ---------------------------------------------------------------------------
// Reading health off an actor
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The health pair an actor document declares, or `null` when it declares none.
 *
 * Read in the same order the sheets read it: the derived block first (what the system
 * computed), then the stored attributes. Both must produce two finite numbers with a
 * positive maximum — a `max` of zero is not "a dead participant", it is an actor whose
 * health this client cannot resolve, and REQ-CBA-043 says omit it.
 *
 * The combatant's `flags.combat.trackedResource` snapshot is deliberately NOT a source
 * here: the server writes `trackedResource: null` on every combat it creates and no handler
 * ever fills the flag, and the tracked resource is a SECOND resource beside health
 * (REQ-CBT-047), which this panel only draws in [V2] (REQ-CBA-044). Reading it as health
 * would mean showing a focus pool where a bar of hit points is promised.
 */
export function readActorHealth(
  actor: Record<string, unknown> | null | undefined,
): TurnHeadHealth | null {
  if (!actor) return null;
  const system = asRecord(actor["system"]);
  if (!system) return null;

  const derived = asRecord(asRecord(system["derived"])?.["hp"]);
  const stored = asRecord(asRecord(system["attributes"])?.["hp"]);

  for (const source of [derived, stored]) {
    if (!source) continue;
    const current = finite(source["value"]);
    const max = finite(source["max"]);
    if (current === null || max === null || max <= 0) continue;
    return { current, max };
  }

  return null;
}

// ---------------------------------------------------------------------------
// The rule (REQ-CBA-040..043)
// ---------------------------------------------------------------------------

/**
 * Decide what health this viewer may read from this participant.
 *
 * - privileged role: whatever the actor resolves to, for every participant (REQ-CBA-040);
 * - player, player character: whatever the actor resolves to (REQ-CBA-041, first half);
 * - player, creature: `null`, always — and `null` is the same answer the head and the queue
 *   get for an unresolvable value, so a player cannot tell "hidden from you" from "unknown"
 *   by the shape of the panel (REQ-CBA-041, second half);
 * - anything unresolvable: `null`, never a full or zeroed bar (REQ-CBA-043).
 *
 * Q-CBA-02 / REQ-CBA-083: the player branch is a rule of this screen. The same numbers may
 * be on the player's machine already, drawn by the token's own resource bars (REQ-CNV-090).
 */
export function resolveHpView(
  role: ViewerRole,
  combatant: CombatantVitalsSubject,
  actor: Record<string, unknown> | null | undefined,
): TurnHeadHealth | null {
  if (role !== "gm" && !combatant.hasPlayerOwner) return null;
  return readActorHealth(actor);
}

/**
 * Health and conditions of one participant, for one viewer.
 *
 * The two are resolved side by side on purpose: the conditions do not consult the health
 * rule, which is exactly REQ-CBA-053 — a creature whose hit points the player may not read
 * still shows "Amedrontado 2" to the whole table.
 */
export function resolveCombatantVitals(
  role: ViewerRole,
  combatant: CombatantVitalsSubject,
  actor: Record<string, unknown> | null | undefined,
  lookup?: ConditionContractLookup,
): CombatantVitals {
  return {
    health: resolveHpView(role, combatant, actor),
    conditions: readActorConditions(actor, lookup),
  };
}

/**
 * Resolve every participant at once, keyed by combatant id — what the panel hands to the
 * turn head and to the queue.
 *
 * A participant whose actor is missing from `actorsById` (a creature absent from a player's
 * mirror, an actor deleted mid-encounter) resolves to no health and no conditions, which is
 * what both surfaces already omit.
 */
export function buildCombatVitals(
  role: ViewerRole,
  combatants: readonly (CombatantVitalsSubject & { readonly _id: string })[],
  actorsById: ReadonlyMap<string, Record<string, unknown>>,
  lookup?: ConditionContractLookup,
): Map<string, CombatantVitals> {
  const out = new Map<string, CombatantVitals>();
  for (const combatant of combatants) {
    const actor = combatant.actorId === null ? null : (actorsById.get(combatant.actorId) ?? null);
    out.set(combatant._id, resolveCombatantVitals(role, combatant, actor, lookup));
  }
  return out;
}
