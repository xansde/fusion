/**
 * The attitude of a non-playable actor towards the party (spec 42 §5.5).
 *
 * REQ-NPC-037: a non-playable MAY carry an attitude — `enemy`, `neutral` or
 * `ally` — stored on the actor ITSELF and valid for the WHOLE party. Spec 42 §7
 * puts it "no próprio ator, no `world.db`", so it is a field of the Actor
 * document — `flags.fusion.attitude` — with no table and no migration, exactly
 * like the knowledge map beside it (`flags.fusion.knowledge`).
 *
 * REQ-NPC-039 is the contrast that shapes the model: knowledge is a property of
 * the PAIR contact × character (DEC-CTT-03), because Tobias may know the smith
 * while Fofurinha only glimpsed him. Attitude has no such split — the smith is
 * hostile to the GROUP. Hence a single scalar here, and no exception map: there
 * is no per-character override to express, so none can be written by accident.
 *
 * REQ-NPC-082 lives elsewhere on purpose: suppressing the value for a
 * non-privileged socket is the server's single redaction module's job
 * (`net/redaction.ts`), not this file's. What lives here is the vocabulary both
 * sides read — the three values, where they are stored, and the cycle order —
 * so client and server cannot drift on any of the three.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// The three values
// ---------------------------------------------------------------------------

/** The three attitudes a non-playable may hold towards the party (REQ-NPC-037). */
export const ActorAttitude = {
  Enemy: "enemy",
  Neutral: "neutral",
  Ally: "ally",
} as const;

export type ActorAttitude = (typeof ActorAttitude)[keyof typeof ActorAttitude];

/**
 * The cycle a single activation walks (REQ-NPC-038, CA-NPC-009): ally →
 * neutral → enemy → ally. The order is the acceptance criterion's, spelled out
 * once here so the row control and any future consumer step the same way.
 */
export const ATTITUDE_CYCLE: readonly ActorAttitude[] = [
  ActorAttitude.Ally,
  ActorAttitude.Neutral,
  ActorAttitude.Enemy,
];

export const ActorAttitudeSchema = z.enum(["enemy", "neutral", "ally"]);

/** True for a value that is one of the three attitudes. */
export function isActorAttitude(value: unknown): value is ActorAttitude {
  return value === "enemy" || value === "neutral" || value === "ally";
}

/**
 * The next attitude after one activation (REQ-NPC-038).
 *
 * An actor with no attitude yet enters the cycle at its first element rather
 * than being skipped: the control exists precisely so the GM can give one.
 */
export function cycleAttitude(current: unknown): ActorAttitude {
  const index = isActorAttitude(current) ? ATTITUDE_CYCLE.indexOf(current) : -1;
  const next = ATTITUDE_CYCLE[(index + 1) % ATTITUDE_CYCLE.length];
  // `ATTITUDE_CYCLE` is a non-empty literal list, so the index is always in
  // range; the fallback only satisfies `noUncheckedIndexedAccess`.
  return next ?? ActorAttitude.Ally;
}

// ---------------------------------------------------------------------------
// Where it lives on the document
// ---------------------------------------------------------------------------

/** Flag namespace holding the attitude (REQ-DOC-009: `flags.<namespace>.<key>`). */
export const ATTITUDE_FLAG_NAMESPACE = "fusion";
/** Flag key holding the attitude. */
export const ATTITUDE_FLAG_KEY = "attitude";
/** Dotted path of the attitude on an Actor document — the one place it is stored. */
export const ATTITUDE_FLAG_PATH = `flags.${ATTITUDE_FLAG_NAMESPACE}.${ATTITUDE_FLAG_KEY}`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The raw flag value as stored, before any interpretation. */
export function readAttitudeFlagValue(doc: unknown): unknown {
  if (!isPlainObject(doc)) return undefined;
  const flags = doc["flags"];
  if (!isPlainObject(flags)) return undefined;
  const namespace = flags[ATTITUDE_FLAG_NAMESPACE];
  if (!isPlainObject(namespace)) return undefined;
  return namespace[ATTITUDE_FLAG_KEY];
}

/**
 * The attitude an Actor document carries, or `undefined` when it carries none.
 *
 * Deliberately tolerant, like `readKnowledgeMap`: a document written before the
 * field existed, or one whose flag was corrupted by hand, reads as "no
 * attitude" rather than throwing — this runs on the emission path, where a
 * throw would take the whole broadcast down.
 */
export function readActorAttitude(doc: unknown): ActorAttitude | undefined {
  const raw = readAttitudeFlagValue(doc);
  return isActorAttitude(raw) ? raw : undefined;
}

/** True when a document or an expanded patch touches the attitude flag at all. */
export function touchesAttitudeFlag(expanded: unknown): boolean {
  if (!isPlainObject(expanded)) return false;
  const flags = expanded["flags"];
  if (!isPlainObject(flags)) return false;
  const namespace = flags[ATTITUDE_FLAG_NAMESPACE];
  if (!isPlainObject(namespace)) return false;
  return ATTITUDE_FLAG_KEY in namespace;
}

/** Wrap an attitude in the nested flag shape a document patch expects. */
export function attitudeFlagPatch(attitude: ActorAttitude | null): Record<string, unknown> {
  return {
    flags: { [ATTITUDE_FLAG_NAMESPACE]: { [ATTITUDE_FLAG_KEY]: attitude } },
  };
}
