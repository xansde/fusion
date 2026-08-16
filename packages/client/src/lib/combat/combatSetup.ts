/**
 * combatSetup.ts — assembling the encounter inside the drawer (spec 40 §5.7, task G053).
 *
 * Pure functions only: no runes, no socket, no DOM. What lives here is the part of
 * "montagem" that is a decision rather than a widget — which of the three panel states we
 * are in, what the header counts, who the candidates are, which participants a "roll the
 * creatures" gesture covers, and, above all, **what an initiative cell is allowed to say**.
 *
 * The last one is the reason this module exists at all. Three requirements meet on the same
 * little number and pull in different directions:
 *
 *  - REQ-CBA-064: during montagem every participant shows its initiative, or an explicit
 *    mark that it has not rolled yet — an empty cell would read as "zero".
 *  - REQ-CBA-067: a player never sees a creature's initiative, montagem included.
 *  - REQ-CBA-070: once the encounter is running the number is gone for **everyone**
 *    (DEC-CBA-04) — the order is said by the position in the list, not by a figure.
 *
 * Deciding that in the markup would mean three nested conditionals in a template nobody can
 * test; `initiativeCellFor()` answers it once, in a function a test can interrogate.
 *
 * On the concealment of a creature's initiative from a player (REQ-CBA-067): what this module
 * draws is the SCREEN half of the rule, and the screen half alone does not satisfy it. Unlike
 * REQ-CBA-083, which downgrades the creature's health to an explicit display rule while the
 * value keeps arriving by another route (DEC-CBA-11, Q-CBA-02), REQ-CBA-067 has no such
 * carve-out written anywhere in spec 40 — so it is a secrecy requirement, and secrecy is the
 * server's job (REQ-CBA-080, REQ-CBA-082).
 *
 * **Registered gap (openQuestion for the server lane).** Today the server strips participants
 * marked `hidden` and nothing else: `packages/server/src/net/redaction.ts` never mentions
 * `initiative`, so the figure reaches the player's socket by all three paths (snapshot,
 * broadcast and ack). Closing it belongs to that single redaction module — never to a second
 * filter drawn here — and it is NOT the one-liner it looks like: `buildTrackerRows()` and
 * `combatStore`'s ordered view both re-sort the roster with `sortCombatants()`, which sinks
 * every `initiative === null` entry to the bottom. Blanking the creatures' value server-side
 * without first making the client honour the order the server already persisted would hand the
 * player a queue in the wrong order, and the order is the whole point once the encounter runs
 * (REQ-CBA-030, REQ-CBA-070).
 */

import type { CombatDocument, CombatantDocument, TokenDocument } from "@fusion/shared";
import type { ViewerRole } from "./combatVisibility.js";
import { addableTokens } from "./combatTracker.js";
import { skillNamePt } from "../sheets/pf2e/skillNames.js";

// ---------------------------------------------------------------------------
// The three states of the panel (REQ-CBA-010)
// ---------------------------------------------------------------------------

/**
 * The panel has exactly three states, and they are not interchangeable (REQ-CBA-010):
 *
 *  - `"empty"`: no encounter at all;
 *  - `"assembly"`: an encounter exists and has not begun (`started: false`) — montagem;
 *  - `"running"`: the encounter is under way (`started: true`).
 *
 * An ended encounter is `"empty"`: DEC-CBA-09 says the panel returns to the empty state the
 * moment the encounter ends, for both roles, with no intermediate acknowledgement.
 */
export type CombatPhase = "empty" | "assembly" | "running";

export function combatPhase(combat: CombatDocument | null): CombatPhase {
  if (combat === null || combat.ended) return "empty";
  return combat.started ? "running" : "assembly";
}

// ---------------------------------------------------------------------------
// What the header counts during montagem (REQ-CBA-011)
// ---------------------------------------------------------------------------

/** The two numbers the header shows while assembling (REQ-CBA-011). */
export interface AssemblySummary {
  /** How many participants the encounter has. */
  readonly total: number;
  /** How many of them still have no initiative — what is missing before starting. */
  readonly withoutInitiative: number;
}

/**
 * Count the encounter for the montagem header (REQ-CBA-011).
 *
 * Counted over the combatants the caller was given, which for a non-privileged viewer is
 * already the redacted array: the header must not tell a player that a participant they
 * cannot see exists.
 */
export function assemblySummary(combatants: readonly CombatantDocument[]): AssemblySummary {
  let withoutInitiative = 0;
  for (const combatant of combatants) {
    if (combatant.initiative === null) withoutInitiative += 1;
  }
  return { total: combatants.length, withoutInitiative };
}

// ---------------------------------------------------------------------------
// Candidates the active scene offers (REQ-CBA-060, DEC-CBA-06)
// ---------------------------------------------------------------------------

/**
 * One candidate to enter the encounter.
 *
 * DEC-CBA-06: this spec has no word for what the active scene offers, because there is no
 * spec that owns the concept — it is split between `02`, `04` and `06` and none of them
 * defines it as a document with an owner. So the aba calls them **candidates**, the
 * interface never says "token" (REQ-CBA-062), and the source is defined for now as "what
 * the active scene offers". The reserved spec `41` is what will one day say what that is;
 * when it does, the gesture below does not change — only where the list comes from.
 */
export interface EncounterCandidate {
  readonly id: string;
  readonly name: string;
  readonly img: string | null;
  readonly actorId: string | null;
}

/**
 * The candidates the active scene offers that are not participants yet (REQ-CBA-060).
 *
 * Delegates to `addableTokens()` rather than re-deriving the filter: that function is the
 * one already wired to the scene's embedded collection and already tested. This wrapper
 * exists to give the provenance a name the aba can use (DEC-CBA-06) and to be the single
 * place to change when spec `41` lands.
 */
export function encounterCandidates(
  sceneTokens: readonly TokenDocument[],
  combat: CombatDocument | null,
): EncounterCandidate[] {
  return addableTokens([...sceneTokens], combat);
}

// ---------------------------------------------------------------------------
// Rolling in bulk (REQ-CBA-063)
// ---------------------------------------------------------------------------

/**
 * Ids of the **creatures** whose initiative a bulk roll would set (REQ-CBA-063).
 *
 * "Creature" here is the same line the health rule draws (REQ-CBA-041): a participant with
 * no player owner. The point of the gesture is that the GM rolls for the opposition without
 * rolling over the players who are about to roll their own (REQ-CBA-065).
 *
 * Only participants still without initiative are included, which makes "roll the creatures"
 * a subset of "roll everyone" — the server's own reading of a bulk roll (`combatantIds`
 * absent rolls exactly those whose initiative is `null`). A gesture that silently re-rolled
 * a value the GM had typed in by hand (REQ-CBA-064) would be a different, destructive
 * gesture wearing the same label.
 */
export function creatureCombatantIds(combatants: readonly CombatantDocument[]): string[] {
  return combatants
    .filter((combatant) => !combatant.hasPlayerOwner && combatant.initiative === null)
    .map((combatant) => combatant._id);
}

// ---------------------------------------------------------------------------
// The initiative cell (REQ-CBA-064, REQ-CBA-067, REQ-CBA-070)
// ---------------------------------------------------------------------------

/**
 * What an initiative cell is allowed to say.
 *
 *  - `"value"`: the participant rolled, and this viewer may read the figure.
 *  - `"unrolled"`: the participant has not rolled — said explicitly (REQ-CBA-064), never as
 *    a blank cell, which reads as zero.
 *  - `"concealed"`: this viewer may not read this participant's initiative (REQ-CBA-067).
 *  - `"hidden-phase"`: nobody reads initiative in this phase (REQ-CBA-070).
 *
 * The last two both draw nothing, and they are still two kinds: one is about **who** is
 * looking and the other about **when**. Collapsing them would make it impossible to tell,
 * from a test or from the code, which requirement emptied the cell.
 */
export type InitiativeCellKind = "value" | "unrolled" | "concealed" | "hidden-phase";

/** The initiative cell of one participant, decided for one viewer. */
export interface InitiativeCellView {
  readonly kind: InitiativeCellKind;
  /** The raw value, present only when `kind === "value"`. */
  readonly value: number | null;
  /** Whether this viewer may type a value in (REQ-CBA-064). */
  readonly editable: boolean;
}

/** What `initiativeCellFor` needs to know about the participant and the viewer. */
export interface InitiativeCellInput {
  readonly phase: CombatPhase;
  readonly role: ViewerRole;
  /** Whether the participant is linked to a player-owned actor. */
  readonly hasPlayerOwner: boolean;
  readonly initiative: number | null;
}

const CONCEALED: InitiativeCellView = { kind: "concealed", value: null, editable: false };
const HIDDEN_PHASE: InitiativeCellView = { kind: "hidden-phase", value: null, editable: false };

/**
 * Decide one participant's initiative cell (REQ-CBA-064, REQ-CBA-067, REQ-CBA-070).
 *
 * Order matters, and it is the order of the requirements' reach:
 *
 *  1. Outside montagem nobody reads a number (REQ-CBA-070) — this is checked first because
 *     it is the only rule with no exception, not even for a privileged role (DEC-CBA-04:
 *     the GM is the one who needs it least, since the GM is the one who built the list).
 *  2. A player never reads a creature's initiative (REQ-CBA-067), montagem included.
 *  3. Whatever is left shows the figure or says, in words, that it has not rolled
 *     (REQ-CBA-064) — and a privileged role may type one in.
 */
export function initiativeCellFor(input: InitiativeCellInput): InitiativeCellView {
  if (input.phase !== "assembly") return HIDDEN_PHASE;
  if (input.role !== "gm" && !input.hasPlayerOwner) return CONCEALED;

  if (input.initiative === null) {
    return { kind: "unrolled", value: null, editable: input.role === "gm" };
  }
  return { kind: "value", value: input.initiative, editable: input.role === "gm" };
}

/**
 * Build the initiative cells of a whole encounter, keyed by participant id.
 *
 * Same shape as `buildCombatVitals()`: the panel resolves the map once and the queue draws
 * what it is handed, so no component decides on its own who may read what.
 */
export function buildInitiativeCells(
  phase: CombatPhase,
  role: ViewerRole,
  combatants: readonly CombatantDocument[],
): Map<string, InitiativeCellView> {
  const cells = new Map<string, InitiativeCellView>();
  for (const combatant of combatants) {
    cells.set(
      combatant._id,
      initiativeCellFor({
        phase,
        role,
        hasPlayerOwner: combatant.hasPlayerOwner,
        initiative: combatant.initiative,
      }),
    );
  }
  return cells;
}

// ---------------------------------------------------------------------------
// The choice of initiative statistic (REQ-CBA-066, Q-CBA-03)
// ---------------------------------------------------------------------------

/**
 * One statistic the participant could roll initiative with (REQ-CBA-066).
 *
 * `id` is the slug the system's initiative formula understands — it travels untouched in the
 * `options` bag of `combat:rollInitiative`. `label` is what the panel WRITES ON SCREEN, and
 * therefore is not the slug: the slugs of `system.derived.skills` are the canonical English
 * ones, and a drawer in pt-BR that offers "Thievery" is a drawer that leaked an identifier
 * into the interface. The default option — roll with whatever the system picks on its own —
 * is NOT in this list: it is the absence of a choice, and the panel offers it as such.
 */
export interface InitiativeStatisticOption {
  readonly id: string;
  readonly label: string;
}

/**
 * Read the statistics an actor could roll initiative with (REQ-CBA-066, Q-CBA-03).
 *
 * **Q-CBA-03 is open**: the spec asks whether the choice belongs on the roll button, on the
 * participant, or on the character sheet, and records that the prototype never drew it. The
 * path taken here is the first one, because REQ-CBA-066 says "no mesmo gesto de rolar", and
 * because it needs no new server operation: the chosen slug travels in the existing
 * `options` bag of `combat:rollInitiative`, the system's formula reads it (`options.skill`),
 * and the server writes the resulting statistic onto the participant — which is exactly the
 * "registrar a escolha no participante" half of the requirement. Should Q-CBA-03 close the
 * other way, what moves is where this list is rendered, not how the choice is carried.
 *
 * The source is the actor's own derived skills, read the way the sheets read them — and named
 * the way the sheets name them: `skillNamePt()` is the table the character sheet already uses
 * for exactly these slugs, so the drawer and the sheet call a skill by the same word, Lore
 * included ("Saber (…)"), and an unknown slug degrades to itself instead of disappearing.
 * The ordering follows the label, not the slug: what the reader scans is the label, and in
 * pt-BR the two orders are not the same list.
 *
 * When the actor is not in the mirror, or has no derived skills, the answer is an empty list
 * and the panel offers no menu at all — degradação aberta: a missing declaration costs the
 * choice, never the roll.
 */
export function initiativeStatisticOptions(
  actor: Record<string, unknown> | null | undefined,
): InitiativeStatisticOption[] {
  if (!actor) return [];
  const system = actor["system"];
  if (typeof system !== "object" || system === null) return [];
  const derived = (system as Record<string, unknown>)["derived"];
  if (typeof derived !== "object" || derived === null) return [];
  const skills = (derived as Record<string, unknown>)["skills"];
  if (typeof skills !== "object" || skills === null || Array.isArray(skills)) return [];

  return Object.keys(skills as Record<string, unknown>)
    .filter((slug) => slug.length > 0)
    .map((slug) => ({ id: slug, label: skillNamePt(slug) }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

/**
 * Build the `options` bag for `combat:rollInitiative` from a chosen statistic.
 *
 * Returns `undefined` for "no choice", so the payload carries no `options` at all and the
 * system's default formula applies — the roll never depends on the menu having been used.
 */
export function initiativeRollOptions(
  statistic: string | null | undefined,
): Record<string, unknown> | undefined {
  if (statistic === null || statistic === undefined || statistic === "") return undefined;
  return { skill: statistic };
}
