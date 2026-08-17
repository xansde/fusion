/**
 * Token invocation contract (spec 41 §7.2): obligatory, overridable-with-
 * inheritance, derived-and-refused, and explicitly-refused fields.
 *
 * A Token document is a placement of an EXISTING Actor on a Scene — it is not
 * a free-standing piece with its own name/art (spec 41 §3). `actorId` is
 * therefore the one field a Token document cannot do without: null, absent,
 * or pointing at an Actor the world does not have are all the same failure
 * — "there is no piece to draw" — and DEC-TOK-05 requires the server to
 * REFUSE that write with an explicit, specific error rather than accept it
 * silently or bury it inside Zod's generic type-mismatch message.
 *
 * `validateTokenActorId` is called from both embedded Token paths in
 * `net/handlers/doc-handlers.ts`:
 *   - `handleEmbeddedCreate` — a brand-new Token (`doc:create` with
 *     `parent: { type: "Scene" }`).
 *   - `handleEmbeddedUpdate` — an existing Token whose diff was just applied
 *     (a GM/ASSISTANT is the only role that can reach this point with
 *     `actorId` in the diff at all — see the privilege gate right above the
 *     call site — but a privileged caller sending `actorId: null` or an id
 *     that resolves to nothing was, before this module existed, accepted and
 *     persisted with zero validation: T-5, reproduced in
 *     `__tests__/token-actor-validation.test.ts`).
 *
 * TK025 extends the same module with the rest of §7.2 rather than
 * re-deriving the actorId rule:
 *   - `validateTokenCreateContract` — the OBLIGATORY (x, y — actorId is
 *     `validateTokenActorId`'s job) and REFUSED/DERIVED checks
 *     (`actorDelta`, footprint, art, possession — REQ-TOK-022, DEC-TOK-05).
 *     Called only on `doc:create`; a full-replace diff never reaches this
 *     path (the schema removed `width`/`height`/`texture` in TK023, and
 *     nothing in §7.2 asks the UPDATE path to re-police them).
 *   - `applyTokenCreateDefaults` — the OVERRIDABLE fields whose "inherit
 *     when absent" default needs more than a Zod literal: `actorLink`
 *     (REQ-DOC-061, by the base Actor's subtype) and `bar1`/`bar2`
 *     (REQ-SYS-004, by the active system's manifest). Everything else in
 *     the overridable row (`hidden`, `seenBy`, `disposition`, `name`,
 *     `rotation`, `elevation`, `vision`, `light`) already inherits correctly
 *     from `TokenDocumentSchema`'s own Zod defaults — `disposition`/`name`
 *     inherit as `null` (resolved against the effective actor at READ time
 *     by `resolveEffectiveActor`, DEC-TOK-09/REQ-TOK-060/080, not frozen at
 *     creation), and the Actor document has no `vision`/`light` fields of
 *     its own yet (out of scope this phase — REGRA 18/Q-TOK-04), so "herda
 *     do ator" for those two is, today, indistinguishable from "default do
 *     schema": there is nothing on the Actor to read.
 *   - `validateTokenUpdateActorDelta` — the REQ-DOC-034 half of the
 *     `actorDelta` rule: refused on creation unconditionally (checked by
 *     `validateTokenCreateContract`), accepted on update ONLY when the
 *     patched token is unlinked (`actorLink === false`).
 */

import { DocumentNotFoundError } from "../documents/store.js";
import type { DocumentStore } from "../documents/store.js";
import type { SystemModule } from "@fusion/system-api";

export interface TokenValidationError {
  readonly code: "VALIDATION_FAILED";
  readonly message: string;
}

const TOKEN_ACTOR_ID_ERROR =
  "Token.actorId is required and must resolve to an existing Actor (REQ-TOK-002)";

/**
 * Validates a Token's `actorId` against the world's DocumentStore.
 *
 * `actorId` is read as `unknown` on purpose — it is inspected straight off a
 * raw (pre- or post-diff) document, not off the parsed `TokenDocument` type,
 * so this same check can run BEFORE `TokenDocumentSchema.safeParse` on the
 * create path (to produce our own message instead of Zod's generic
 * "Expected string, received null") and on the update path, where no schema
 * re-parse happens at all today.
 *
 * Returns `null` when `actorId` is a non-empty string that resolves to an
 * Actor document; otherwise returns a `VALIDATION_FAILED` error naming the
 * requirement explicitly (never "não existe" alone — DEC-TOK-05).
 */
export function validateTokenActorId(
  store: DocumentStore,
  actorId: unknown,
): TokenValidationError | null {
  if (typeof actorId !== "string" || actorId.length === 0) {
    return { code: "VALIDATION_FAILED", message: TOKEN_ACTOR_ID_ERROR };
  }
  try {
    store.get("actors", actorId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return { code: "VALIDATION_FAILED", message: TOKEN_ACTOR_ID_ERROR };
    }
    throw err;
  }
  return null;
}

// ---------------------------------------------------------------------------
// §7.2 — the rest of the invocation contract
// ---------------------------------------------------------------------------

/**
 * Fields §7.2 marks DERIVED — "the server computes them, and does NOT accept
 * them from the requester" — mapped to the human-readable reason quoted in
 * the refusal message. `width`/`height` are footprint (DEC-TOK-03);
 * `texture`/`img` are art (the Token document has no art field at all —
 * REQ-TOK-010); `ownership`/`userId` are possession (the Token document has
 * no ownership field at all — REQ-TOK-013).
 */
const DERIVED_FIELD_REASON: Readonly<Record<string, string>> = {
  width: "footprint, derived from the actor and the system's size mapping (DEC-TOK-03)",
  height: "footprint, derived from the actor and the system's size mapping (DEC-TOK-03)",
  texture: "art, derived from the effective actor — the Token document has no art field",
  img: "art, derived from the effective actor — the Token document has no art field",
  ownership: "possession, which is not a Token field — it derives from the actor",
  userId: "possession, which is not a Token field — it derives from the actor",
};

const TOKEN_ACTOR_DELTA_CREATE_ERROR =
  "Token.actorDelta cannot be set at creation — it only enters through the TokenActor " +
  "mutation route on an existing unlinked token (REQ-DOC-034, REQ-TOK-022, DEC-TOK-05)";

/**
 * Validates a Token creation payload against §7.2's OBLIGATORY (`x`, `y` —
 * `actorId` is `validateTokenActorId`'s job, and "the scene comes from the
 * embedding, not the payload" is structural: `handleEmbeddedCreate` never
 * reads a scene id out of `raw`), DERIVED (footprint/art/possession) and
 * REFUSED (`actorDelta`) rows.
 *
 * `raw` is the pre-defaults, pre-parse payload straight from the wire — the
 * same object `validateTokenActorId` inspects — so a derived field is caught
 * before `TokenDocumentSchema`'s `.strip()` behavior could quietly discard
 * it (REQ-TOK-022/DEC-TOK-05: refuse, never silently drop).
 *
 * Returns `null` when the payload is clean; otherwise a `VALIDATION_FAILED`
 * error whose message names the offending field explicitly.
 */
export function validateTokenCreateContract(
  raw: Record<string, unknown>,
): TokenValidationError | null {
  for (const [field, reason] of Object.entries(DERIVED_FIELD_REASON)) {
    if (field in raw) {
      return {
        code: "VALIDATION_FAILED",
        message: `Token.${field} is ${reason}, and cannot be set at creation (REQ-TOK-022)`,
      };
    }
  }
  if ("actorDelta" in raw) {
    return { code: "VALIDATION_FAILED", message: TOKEN_ACTOR_DELTA_CREATE_ERROR };
  }
  if (typeof raw["x"] !== "number") {
    return {
      code: "VALIDATION_FAILED",
      message: "Token creation requires x (REQ-TOK-020)",
    };
  }
  if (typeof raw["y"] !== "number") {
    return {
      code: "VALIDATION_FAILED",
      message: "Token creation requires y (REQ-TOK-020)",
    };
  }
  return null;
}

/**
 * Resolves `actorLink`'s creation default by the base Actor's subtype
 * (REQ-DOC-061, REQ-TOK-023): an Actor whose `type` is exactly `"npc"`
 * defaults a new Token to unlinked (`false`); every other subtype — and a
 * token whose actor cannot be read at all — defaults to linked (`true`).
 *
 * Only the literal `"npc"` subtype is special-cased, on purpose: REQ-DOC-061
 * names `npc` specifically (mirrored by DEC-DOC-12's "seis esqueletos"
 * example), not "any non-playable subtype" — `hazard`/`antagonista`/`loot`
 * are deliberately left at the `true` (linked) default this function falls
 * back to. This is a narrower rule than `documents/knowledge.ts`'s
 * `NON_PLAYABLE_SUBTYPES`, which answers a different question (who
 * `entrevisto` knowledge applies to) and must not be reused here.
 *
 * `actorId` has already been validated to resolve by the time this runs
 * (`validateTokenActorId` is checked first in both call sites) — the
 * not-found branch exists only as defense in depth, not a path any test can
 * currently reach through the socket handler.
 */
export function resolveActorLinkCreateDefault(store: DocumentStore, actorId: unknown): boolean {
  if (typeof actorId !== "string" || actorId.length === 0) return true;
  try {
    const actor = store.get("actors", actorId);
    return actor["type"] !== "npc";
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return true;
    throw err;
  }
}

/**
 * Fills in the two OVERRIDABLE §7.2 fields whose "inherit when absent"
 * default cannot be expressed as a Zod literal — `actorLink` (by actor
 * subtype, REQ-DOC-061) and `bar1`/`bar2` (by the active system's manifest,
 * REQ-SYS-004). Returns a NEW object; `raw` is never mutated.
 *
 * A field already present in `raw` (even `null`, even a partial
 * `{ attribute: ... }`) is left exactly as the caller sent it — "presente →
 * respeitado" is the other half of every overridable row, and this
 * function's only job is the "ausente → herdado" half.
 *
 * `system` is `undefined` when no `SystemModule` is wired for the world
 * (some test harnesses don't); `bar1`/`bar2` then fall through to
 * `TokenDocumentSchema`'s own `{ attribute: null }` default, same as when a
 * real system simply doesn't declare `primaryBarAttribute`/
 * `secondaryBarAttribute` — no system in this monorepo does yet (REQ-SYS-004
 * makes them optional), so today this branch is always exercised in
 * production; registered here rather than left as a silent assumption.
 */
export function applyTokenCreateDefaults(
  store: DocumentStore,
  system: SystemModule | undefined,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const withDefaults = { ...raw };
  if (!("actorLink" in withDefaults)) {
    withDefaults["actorLink"] = resolveActorLinkCreateDefault(store, raw["actorId"]);
  }
  if (!("bar1" in withDefaults)) {
    withDefaults["bar1"] = { attribute: system?.manifest.primaryBarAttribute ?? null };
  }
  if (!("bar2" in withDefaults)) {
    withDefaults["bar2"] = { attribute: system?.manifest.secondaryBarAttribute ?? null };
  }
  return withDefaults;
}

/**
 * The REQ-DOC-034 half of the `actorDelta` rule that
 * `validateTokenCreateContract` does not cover: on an UPDATE, `actorDelta`
 * is accepted only when the patched token is unlinked. A linked token's
 * effective actor IS the base Actor (`resolveEffectiveActor`,
 * `actorLink === true` short-circuits to the base actor) — a delta on a
 * linked token has nothing to apply to and would silently do nothing at
 * read time, so it is refused at write time instead (DEC-TOK-05: refuse,
 * don't ignore).
 *
 * `patchedActorLink` is the diff-applied token's `actorLink` (mirrors how
 * `validateTokenActorId` reads `patchedToken["actorId"]` in
 * `handleEmbeddedUpdate` — post-diff, not pre-diff, so a single update that
 * both flips `actorLink` to `false` and sets `actorDelta` in the same
 * payload is evaluated against the NEW link state, not the old one).
 */
export function validateTokenUpdateActorDelta(
  patchedActorLink: unknown,
  diffHasActorDelta: boolean,
): TokenValidationError | null {
  if (!diffHasActorDelta) return null;
  if (patchedActorLink === false) return null;
  return {
    code: "VALIDATION_FAILED",
    message:
      "Token.actorDelta only applies to an unlinked token (actorLink: false) — this token " +
      "is linked, so its effective actor IS the base Actor and there is nothing to patch " +
      "(REQ-DOC-034, REQ-DOC-032)",
  };
}
