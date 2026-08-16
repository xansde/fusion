/**
 * npcAttitude.ts — the attitude control of the NPC row (spec 42 §5.5).
 *
 * Deliberately shaped after `lib/contacts/knowledgeGrid.ts`: everything here is
 * pure, and its whole job is to turn ONE activation of the row's control into
 * the edit that asks the SERVER to change the value. Nothing here writes,
 * nothing here re-implements the model — the vocabulary and the cycle order live
 * in `@fusion/shared/attitude.ts` and are the same ones the server applies
 * (REQ-NPC-038), and the refusal for a non-privileged socket is the server's
 * (REQ-NPC-080/082), never this module's.
 *
 * The contrast with the grid is the point of REQ-NPC-039: a knowledge
 * activation is about a PAIR (contact × character) and therefore writes an
 * exception for one character; an attitude activation is about the ACTOR and
 * writes one scalar for the whole party. There is no character id anywhere in
 * this file — not as an argument, not in the op — because there is no
 * per-character attitude to express (DEC-CTT-03 is what attitude is NOT).
 *
 * REQ-NPC-037 is enforced here as a refusal to even ask: a hazard carries no
 * attitude, so an activation on a hazard produces no op at all instead of a
 * round trip that the server would reject.
 */

import {
  ATTITUDE_FLAG_PATH,
  cycleAttitude,
  readActorAttitude,
  type ActorAttitude,
} from "@fusion/shared";

// ---------------------------------------------------------------------------
// Which subtypes carry one (REQ-NPC-037, CA-NPC-010)
// ---------------------------------------------------------------------------

/**
 * The Actor subtypes that may carry an attitude (REQ-NPC-037).
 *
 * The client's half of the server's `ATTITUDE_CAPABLE_SUBTYPES`: a hazard is
 * outside it (CA-NPC-010), and so is everything this tab does not author.
 */
export const ATTITUDE_CAPABLE_SUBTYPES = ["npc"] as const;

/**
 * True for a subtype that may carry an attitude (REQ-NPC-037, CA-NPC-010).
 *
 * A hazard has none, and there is no way to give it one — the server refuses the
 * write, and this predicate keeps the client from asking for a refusal.
 */
export function subtypeAcceptsAttitude(subtype: string | null | undefined): boolean {
  return (
    typeof subtype === "string" &&
    (ATTITUDE_CAPABLE_SUBTYPES as readonly string[]).includes(subtype)
  );
}

// ---------------------------------------------------------------------------
// How it is drawn
// ---------------------------------------------------------------------------

/**
 * i18n keys of the three attitudes — the row's word and the control's label read
 * these (REQ-NPC-094: the attitude is a word first, the colour only seconds it).
 */
export const ATTITUDE_LABEL_KEYS: Readonly<Record<ActorAttitude, string>> = {
  enemy: "FUSION.Npcs.Attitude.enemy",
  neutral: "FUSION.Npcs.Attitude.neutral",
  ally: "FUSION.Npcs.Attitude.ally",
};

/** The i18n key of one attitude. */
export function attitudeLabelKey(attitude: ActorAttitude): string {
  return ATTITUDE_LABEL_KEYS[attitude];
}

/**
 * What the row displays as the attitude, or `null` when it displays nothing.
 *
 * REQ-NPC-037: "não-jogável sem atitude aplicável NÃO DEVE exibir indicação
 * alguma" — a hazard reads `null` even if a stray flag survived on its document,
 * so a corrupted write cannot become an indication on screen.
 */
export function displayedAttitude(target: AttitudeTarget): ActorAttitude | null {
  if (!subtypeAcceptsAttitude(target.subtype)) return null;
  return target.attitude ?? null;
}

/** The same reading, straight from an Actor document. */
export function attitudeOfActor(doc: unknown): ActorAttitude | null {
  const subtype =
    typeof doc === "object" && doc !== null ? (doc as { type?: unknown }).type : undefined;
  return displayedAttitude({
    id: "",
    subtype: typeof subtype === "string" ? subtype : null,
    attitude: readActorAttitude(doc) ?? null,
  });
}

// ---------------------------------------------------------------------------
// The one activation (REQ-NPC-038)
// ---------------------------------------------------------------------------

/** The only op this control can produce. Nothing else is reachable from it. */
export const ATTITUDE_OP_TYPE = "doc:update";

/** What the control needs to know about the row it sits on. */
export interface AttitudeTarget {
  readonly id: string;
  readonly subtype: string | null | undefined;
  readonly attitude: ActorAttitude | null | undefined;
}

/** One attitude write: a single scalar on a single actor (REQ-NPC-039). */
export interface AttitudeCycleOp {
  readonly type: typeof ATTITUDE_OP_TYPE;
  readonly payload: {
    readonly documentType: "Actor";
    readonly updates: readonly { readonly _id: string; readonly diff: Record<string, unknown> }[];
  };
}

/**
 * The attitude one activation moves to (REQ-NPC-038).
 *
 * Delegates to the shared cycle so the order (`ally → neutral → enemy`,
 * CA-NPC-009) exists once: a second order invented here would make the row and
 * the server disagree about what "next" means.
 */
export function nextAttitude(current: ActorAttitude | null | undefined): ActorAttitude {
  return cycleAttitude(current);
}

/**
 * Turn one activation of the row's control into the edit it asks for
 * (REQ-NPC-038), or `null` when there is nothing to ask.
 *
 * `null` — and therefore nothing on the wire — for a row with no id and for a
 * subtype that carries no attitude (REQ-NPC-037): the hazard's row has no
 * control at all, and this is the second lock behind it.
 */
export function attitudeCycleOp(target: AttitudeTarget): AttitudeCycleOp | null {
  if (target.id.length === 0) return null;
  if (!subtypeAcceptsAttitude(target.subtype)) return null;
  return {
    type: ATTITUDE_OP_TYPE,
    payload: {
      documentType: "Actor",
      updates: [{ _id: target.id, diff: { [ATTITUDE_FLAG_PATH]: nextAttitude(target.attitude) } }],
    },
  };
}
