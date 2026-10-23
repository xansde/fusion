/**
 * The effective actor of a token — ONE function, shared by server and client.
 *
 * RNF-TOK-01 (specs/41-token.md): resolving art, footprint, name and health from
 * a token's effective actor MUST go through a single shared function; a second
 * implementation on either side is a defect, not an optimization. REQ-CNV-091
 * (specs/06-canvas-e-renderizacao.md) already required this for the canvas bars
 * before this spec existed — this module is where both requirements land.
 *
 * DEC-DOC-08 (specs/02-modelo-de-dados.md ~L221) defines the simplified merge
 * patch: `name`, `img`, and `system` merge (system deep-merges over the base
 * actor's `system`); `items`/`effects` REPLACE the base actor's collection
 * entirely when present in the delta, never merge element-by-element (that is
 * the [V2] item-granular delta DEC-DOC-08 explicitly defers).
 *
 * This module is pure and has no I/O: it takes plain data in, returns plain
 * data out. It must never import from packages/server or packages/client
 * (REQ-ARQ-002) — that boundary is exactly what makes "one function used by
 * both" possible in the first place.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// ActorDeltaPatch — the simplified merge patch of DEC-DOC-08
// ---------------------------------------------------------------------------

/**
 * Merge patch schema for an unlinked token's actor delta (DEC-DOC-08,
 * specs/02-modelo-de-dados.md ~L851-857, TypeScript mirror at ~L833-834).
 *
 * `items`/`effects`, when present, REPLACE the base actor's collection
 * integrally — they are never merged item-by-item. `name`/`img`/`system` are
 * patch fields: `system` deep-merges over the base actor's `system`; `name`
 * and `img` replace outright when present.
 */
export const ActorDeltaPatchSchema = z.object({
  name: z.string().optional(),
  img: z.string().nullable().optional(),
  /** Deep-merged over the base actor's `system` (DEC-DOC-08). */
  system: z.record(z.string(), z.unknown()).optional(),
  /** REPLACES the base actor's `items` entirely when present (DEC-DOC-08). */
  items: z.array(z.record(z.string(), z.unknown())).optional(),
  /** REPLACES the base actor's `effects` entirely when present (DEC-DOC-08). */
  effects: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type ActorDeltaPatch = z.infer<typeof ActorDeltaPatchSchema>;

// ---------------------------------------------------------------------------
// Minimal input shapes
//
// packages/shared/src/scene.ts does not carry `actorLink`/`actorDelta` yet
// (that is TK020, landing separately in the same phase) — this module defines
// its own minimal token-input type instead of depending on TokenDocument, so
// TK020 can add the fields to the real schema afterwards without this module
// having to change. Once TK020 lands, callers pass a real TokenDocument (or a
// `Pick` of it) here; structural typing makes that a no-op for this file.
// ---------------------------------------------------------------------------

/** The only fields resolveEffectiveActor needs from a token document. */
export interface EffectiveActorTokenInput {
  actorLink: boolean;
  actorDelta: ActorDeltaPatch | null;
}

/**
 * The only fields resolveEffectiveActor needs from (and may patch on) a base
 * actor document.
 *
 * packages/shared cannot import the server's ActorDocument type (REQ-ARQ-002 —
 * shared must not depend on server), so this is a minimal structural shape
 * instead. The server's ActorDocument (packages/server/src/documents/types.ts)
 * and any future client-side actor type are both structurally assignable to
 * `T extends EffectiveActorBaseInput` without a cast at the call site.
 */
export interface EffectiveActorBaseInput {
  name: string;
  img?: string | null;
  system: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  effects?: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Deep merge for the `system` field
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep-merges `patch` over `target`: plain objects merge recursively, arrays
 * and every other value type replace outright (DEC-DOC-08's "campos escalares
 * e system" wording, CA-06's general merge rule of "merge profundo em
 * objetos, substitui arrays").
 *
 * Scoped to this module: this mirrors, but does not reuse, the server's
 * document-store `deepMerge` (packages/server/src/documents/merge.ts) — shared
 * cannot import server code (REQ-ARQ-002), so the same small rule is
 * reimplemented here for the one field (`system`) DEC-DOC-08 says merges. It
 * intentionally does NOT carry that store's null-deletes-a-key semantics
 * (REQ-DOC-037): that rule belongs to the general `Document.update` patch
 * pathway, not to reconstructing a token's effective actor, and TK021's scope
 * does not require it — see openQuestions in the task's structured report.
 */
function mergeSystem(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...target };
  for (const key of Object.keys(patch)) {
    const patchVal = patch[key];
    const targetVal = output[key];
    output[key] =
      isPlainObject(patchVal) && isPlainObject(targetVal)
        ? mergeSystem(targetVal, patchVal)
        : patchVal;
  }
  return output;
}

// ---------------------------------------------------------------------------
// resolveEffectiveActor — the one function (RNF-TOK-01)
// ---------------------------------------------------------------------------

/**
 * Resolves a token's effective actor.
 *
 * - `token.actorLink === true`, or `token.actorDelta === null`: the effective
 *   actor IS the base actor, unchanged (REQ-DOC-032).
 * - `token.actorLink === false` with a non-null delta: the effective actor is
 *   the base actor with the delta applied — a fresh "TokenActor" reconstructed
 *   in memory, never mutating `baseActor` (REQ-DOC-033, DEC-DOC-08).
 *
 * Pure: no I/O, no dependency on client or server code. This is the ONLY
 * function that may apply an `actorDelta` onto a base actor anywhere in the
 * codebase (RNF-TOK-01) — see the boundary test in
 * tools/boundary-test/src/__tests__/effectiveActorSingleImpl.test.ts, which
 * fails the build if a second implementation appears in packages/client/src
 * or packages/server/src.
 */
export function resolveEffectiveActor<T extends EffectiveActorBaseInput>(
  token: EffectiveActorTokenInput,
  baseActor: T,
): T {
  if (token.actorLink || token.actorDelta === null) {
    return baseActor;
  }

  const delta = token.actorDelta;
  const patched: EffectiveActorBaseInput = { ...baseActor };

  if (delta.name !== undefined) {
    patched.name = delta.name;
  }
  if (delta.img !== undefined) {
    patched.img = delta.img;
  }
  if (delta.system !== undefined) {
    patched.system = mergeSystem(baseActor.system, delta.system);
  }
  if (delta.items !== undefined) {
    patched.items = delta.items;
  }
  if (delta.effects !== undefined) {
    patched.effects = delta.effects;
  }

  // The spread above only ever assigns fields declared on EffectiveActorBaseInput,
  // so the result stays structurally a T — every other field baseActor carried
  // (ownership, _id, folder, ...) survives untouched via the initial spread.
  return patched as T;
}
