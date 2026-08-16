/**
 * Contact knowledge — the general rule plus per-character exceptions.
 *
 * Spec 39 (`39-contatos.md`) §5.8 and §7, echoed by spec 42 §7: knowledge is
 * stored "no próprio contato/ator, no `world.db`". It is therefore a FIELD OF
 * THE ACTOR DOCUMENT — `flags.fusion.knowledge` — not a table of its own, and
 * it needs no migration: a document is JSON in the store, and a general rule
 * plus a small exception map fits inside it.
 *
 * Model (REQ-CTT-070 / REQ-CTT-072):
 *   - three ordered states per contact × character: hidden (0), glimpsed (1),
 *     known (2);
 *   - each contact carries ONE general rule and a set of exceptions keyed by
 *     the character Actor's `_id`;
 *   - an exception wins over the general rule, and writing an exception EQUAL
 *     to the general rule removes it instead of duplicating it
 *     (`normalizeKnowledge`).
 *
 * Two consequences fall straight out of the shape and are not extra code:
 *   - REQ-CTT-073: a character created later has no exception, so
 *     `resolveKnowledge` returns the general rule in force — the GM does
 *     nothing;
 *   - REQ-CTT-076: deleting a character only has to drop the exceptions that
 *     name it (`dropCharacterFromKnowledge`); no general rule is touched.
 *
 * REQ-CTT-074: knowledge is NOT ownership. It only restricts what a user is
 * shown; it never grants access that the document's `ownership` denies. These
 * helpers are therefore pure readers of the map — they never consult, produce
 * or widen an ownership level.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/**
 * The three ordered knowledge states (REQ-CTT-070).
 *
 * Ordered on purpose: `Math.max` over a user's characters is the user's
 * effective state (REQ-CTT-071), and the cycle in the "Quem conhece quem"
 * window walks the same order.
 */
export const KnowledgeState = {
  /** The contact is not delivered to the user at all (REQ-CTT-082). */
  Hidden: 0,
  /** Seen but not identified: no name, title, portrait or system data (REQ-CTT-081). */
  Glimpsed: 1,
  /** Fully identified. */
  Known: 2,
} as const;

export type KnowledgeState = (typeof KnowledgeState)[keyof typeof KnowledgeState];

/** Every state, in ascending order — also the cycle order (REQ-CTT-062). */
export const KNOWLEDGE_STATES: readonly KnowledgeState[] = [
  KnowledgeState.Hidden,
  KnowledgeState.Glimpsed,
  KnowledgeState.Known,
];

/** The state a contact has for a character no rule mentions. */
export const DEFAULT_KNOWLEDGE_STATE: KnowledgeState = KnowledgeState.Hidden;

export const KnowledgeStateSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

/** True for a value that is one of the three states. */
export function isKnowledgeState(value: unknown): value is KnowledgeState {
  return value === 0 || value === 1 || value === 2;
}

// ---------------------------------------------------------------------------
// The map, and where it lives on the document
// ---------------------------------------------------------------------------

export const KnowledgeMapSchema = z.object({
  /** The rule that applies to every character without an exception. */
  general: KnowledgeStateSchema,
  /** Per-character overrides, keyed by the character Actor's `_id`. */
  exceptions: z.record(z.string(), KnowledgeStateSchema),
});

export type KnowledgeMap = z.infer<typeof KnowledgeMapSchema>;

/** Flag namespace holding the map (REQ-DOC-009: `flags.<namespace>.<key>`). */
export const KNOWLEDGE_FLAG_NAMESPACE = "fusion";
/** Flag key holding the map. */
export const KNOWLEDGE_FLAG_KEY = "knowledge";
/** Dotted path of the map on an Actor document — the one place it is stored. */
export const KNOWLEDGE_FLAG_PATH = `flags.${KNOWLEDGE_FLAG_NAMESPACE}.${KNOWLEDGE_FLAG_KEY}`;

/** A fresh map: nobody knows anything, and there is no exception to carry. */
export function emptyKnowledgeMap(): KnowledgeMap {
  return { general: DEFAULT_KNOWLEDGE_STATE, exceptions: {} };
}

/**
 * Read the knowledge map off an Actor document (or off a bare map).
 *
 * Deliberately tolerant: a document written before this field existed, or one
 * whose flag was corrupted by hand, must read as "nobody knows anything"
 * rather than throw — the field gates delivery of the contact, and a throw in
 * the emission path would take down the whole broadcast.
 */
export function readKnowledgeMap(source: unknown): KnowledgeMap {
  if (!isPlainObject(source)) return emptyKnowledgeMap();

  const direct = source as Partial<KnowledgeMap>;
  const raw =
    isPlainObject(direct.exceptions) || isKnowledgeState(direct.general)
      ? source
      : readFlagValue(source);

  if (!isPlainObject(raw)) return emptyKnowledgeMap();

  const general = isKnowledgeState(raw["general"]) ? raw["general"] : DEFAULT_KNOWLEDGE_STATE;
  const exceptions: Record<string, KnowledgeState> = {};
  const rawExceptions = raw["exceptions"];
  if (isPlainObject(rawExceptions)) {
    for (const [characterId, state] of Object.entries(rawExceptions)) {
      if (characterId.length > 0 && isKnowledgeState(state)) {
        exceptions[characterId] = state;
      }
    }
  }
  return { general, exceptions };
}

function readFlagValue(doc: Record<string, unknown>): unknown {
  const flags = doc["flags"];
  if (!isPlainObject(flags)) return undefined;
  const namespace = flags[KNOWLEDGE_FLAG_NAMESPACE];
  if (!isPlainObject(namespace)) return undefined;
  return namespace[KNOWLEDGE_FLAG_KEY];
}

/** Wrap a map in the nested flag shape a document patch expects. */
export function knowledgeFlagPatch(map: KnowledgeMap): Record<string, unknown> {
  return {
    flags: { [KNOWLEDGE_FLAG_NAMESPACE]: { [KNOWLEDGE_FLAG_KEY]: map } },
  };
}

/** True when the patch/document touches the knowledge flag at all. */
export function touchesKnowledgeFlag(expanded: unknown): boolean {
  if (!isPlainObject(expanded)) return false;
  const flags = expanded["flags"];
  if (!isPlainObject(flags)) return false;
  const namespace = flags[KNOWLEDGE_FLAG_NAMESPACE];
  if (!isPlainObject(namespace)) return false;
  return KNOWLEDGE_FLAG_KEY in namespace;
}

// ---------------------------------------------------------------------------
// Normalization and resolution
// ---------------------------------------------------------------------------

/**
 * Canonical form of a map (REQ-CTT-072).
 *
 * An exception that repeats the general rule is not an exception — it is a
 * duplicate that goes stale the moment the general rule moves, and the window
 * would draw it as an override that overrides nothing. Normalization drops it.
 * Values that are not states are dropped as well, so a forged payload cannot
 * smuggle a fourth state into the document.
 */
export function normalizeKnowledge(map: KnowledgeMap): KnowledgeMap {
  const general = isKnowledgeState(map.general) ? map.general : DEFAULT_KNOWLEDGE_STATE;
  const exceptions: Record<string, KnowledgeState> = {};
  for (const [characterId, state] of Object.entries(map.exceptions)) {
    if (!isKnowledgeState(state)) continue;
    if (state === general) continue;
    exceptions[characterId] = state;
  }
  return { general, exceptions };
}

/**
 * The state of a contact for ONE character (REQ-CTT-070/072/073).
 *
 * `actor` is the contact's Actor document (or its bare knowledge map).
 * A character with no exception gets the general rule — which is exactly why a
 * character created after the fact needs no operation from the GM.
 */
export function resolveKnowledge(actor: unknown, characterId: string): KnowledgeState {
  return resolveKnowledgeFromMap(readKnowledgeMap(actor), characterId);
}

/** Same as {@link resolveKnowledge}, for a map already read off the document. */
export function resolveKnowledgeFromMap(map: KnowledgeMap, characterId: string): KnowledgeState {
  const exception = map.exceptions[characterId];
  return isKnowledgeState(exception) ? exception : map.general;
}

/**
 * The state of a contact for a USER: the highest state among the characters
 * the user owns (REQ-CTT-071).
 *
 * A user with NO character is at `hidden`, not at the general rule: the maximum
 * over an empty set is the bottom of the order, and the general rule is what
 * the world says about a CHARACTER's knowledge — a user who has none has nobody
 * to know anything on their behalf. The funnel therefore fails closed: a player
 * still waiting for a character in session zero, or one whose character was
 * deleted, receives no contact at all (REQ-CTT-082) instead of the whole
 * "Conhecidos" section the general rule would hand over.
 */
export function resolveUserKnowledge(
  actor: unknown,
  characterIds: readonly string[],
): KnowledgeState {
  const map = readKnowledgeMap(actor);
  let best: KnowledgeState = DEFAULT_KNOWLEDGE_STATE;
  for (const characterId of characterIds) {
    const state = resolveKnowledgeFromMap(map, characterId);
    if (state > best) best = state;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Edits (pure — they return a new map, they never write)
// ---------------------------------------------------------------------------

/** Set the general rule, keeping (and re-normalizing) the exceptions. */
export function withGeneralKnowledge(map: KnowledgeMap, state: KnowledgeState): KnowledgeMap {
  return normalizeKnowledge({ general: state, exceptions: { ...map.exceptions } });
}

/**
 * Set one character's exception. Writing the general rule's own value removes
 * the exception instead of duplicating it (REQ-CTT-072).
 */
export function withKnowledgeException(
  map: KnowledgeMap,
  characterId: string,
  state: KnowledgeState,
): KnowledgeMap {
  return normalizeKnowledge({
    general: map.general,
    exceptions: { ...map.exceptions, [characterId]: state },
  });
}

/**
 * Remove every exception naming `characterId`, leaving the general rule alone
 * (REQ-CTT-076) — what deleting a character must do to every contact.
 */
export function dropCharacterFromKnowledge(map: KnowledgeMap, characterId: string): KnowledgeMap {
  const exceptions: Record<string, KnowledgeState> = {};
  for (const [id, state] of Object.entries(map.exceptions)) {
    if (id !== characterId) exceptions[id] = state;
  }
  return { general: map.general, exceptions };
}

/** Drop every exception, aligning the whole row on the general rule (REQ-CTT-063). */
export function clearKnowledgeExceptions(map: KnowledgeMap): KnowledgeMap {
  return { general: map.general, exceptions: {} };
}

/** Next state in the cycle hidden → glimpsed → known → hidden (REQ-CTT-062). */
export function cycleKnowledgeState(state: KnowledgeState): KnowledgeState {
  const index = KNOWLEDGE_STATES.indexOf(state);
  const next = KNOWLEDGE_STATES[(index + 1) % KNOWLEDGE_STATES.length];
  return next ?? DEFAULT_KNOWLEDGE_STATE;
}

/** Structural equality of two maps — used to skip no-op writes. */
export function knowledgeMapsEqual(a: KnowledgeMap, b: KnowledgeMap): boolean {
  if (a.general !== b.general) return false;
  const aKeys = Object.keys(a.exceptions);
  const bKeys = Object.keys(b.exceptions);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a.exceptions[key] !== b.exceptions[key]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Wire payload — `actor:setKnowledge`
// ---------------------------------------------------------------------------

/**
 * One contact's edit. `exceptions` values accept `null` to mean "remove this
 * exception"; `clearExceptions` drops them all so the row lines up on the
 * general rule (REQ-CTT-063).
 *
 * A batch of entries is what the window's column cycle sends (REQ-CTT-064):
 * one character's state across every contact, in a single operation, so the
 * clients receive one delta instead of N.
 */
export const ActorKnowledgeEditSchema = z.object({
  actorId: z.string().min(1),
  general: KnowledgeStateSchema.optional(),
  exceptions: z.record(z.string().min(1), KnowledgeStateSchema.nullable()).optional(),
  clearExceptions: z.boolean().optional(),
});

export type ActorKnowledgeEdit = z.infer<typeof ActorKnowledgeEditSchema>;

export const ActorSetKnowledgePayloadSchema = z.object({
  updates: z.array(ActorKnowledgeEditSchema).min(1),
});

export type ActorSetKnowledgePayload = z.infer<typeof ActorSetKnowledgePayloadSchema>;

/**
 * Apply one edit to a map and return the canonical result.
 *
 * Order matters: the general rule moves first, then `clearExceptions`, then
 * the explicit exceptions — so a single edit can raise the general rule AND
 * pin one character below it. Normalization runs last, which is what makes
 * "write an exception equal to the general rule" a removal (REQ-CTT-072).
 */
export function applyKnowledgeEdit(map: KnowledgeMap, edit: ActorKnowledgeEdit): KnowledgeMap {
  let next: KnowledgeMap = { general: map.general, exceptions: { ...map.exceptions } };
  if (edit.general !== undefined) {
    next = { general: edit.general, exceptions: next.exceptions };
  }
  if (edit.clearExceptions === true) {
    next = clearKnowledgeExceptions(next);
  }
  for (const [characterId, state] of Object.entries(edit.exceptions ?? {})) {
    next =
      state === null
        ? dropCharacterFromKnowledge(next, characterId)
        : { general: next.general, exceptions: { ...next.exceptions, [characterId]: state } };
  }
  return normalizeKnowledge(next);
}

// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
