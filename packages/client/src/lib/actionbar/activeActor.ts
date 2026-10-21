/**
 * activeActor.ts — whose action bar this is, and the ownership gate (BAR-F1-01).
 *
 * Contract: `docs/design/barra-de-acoes/tasks.md` §2.4. Spec 53 REQ-BAR-001..005 and
 * REQ-BAR-007..010; spec 41 REQ-TOK-032/034 for the ownership predicate.
 *
 * D-BA01 (Alexandre, 11/10/2026): "não será aceitável que um player veja a barra de ações de um
 * NPC ao selecionar ele". Any click selects any token — an NPC's included — so the bar cannot
 * simply follow the selection: for a player it would show the creature's strikes, AC, hit points
 * and spells. The gate lives HERE, before any provider: the store publishes only what
 * `resolveActiveActor` returns, the shell builds an `ActionBarContext` only from a
 * `kind: "actor"` result, and a provider is therefore never called with an actor the viewer does
 * not own.
 *
 * PURE on purpose (I5): no Svelte, no mirror, no documents — only ids, plus the `hasProvider`
 * callback, which this function never calls with an actor that failed the gate. That is what
 * makes the gate testable as a table of literal cases (`__tests__/activeActor.test.ts`).
 *
 * D-15 holds here too: nothing in this module counts, limits or blocks actions.
 */

/**
 * What the bar shows. The shell draws a bar only for `kind: "actor"`; `none` hides it.
 *
 * `group` is RESERVED for the Mestre's multi-selection (rule 4, BAR-F4-03): this task never
 * produces it, and a player never receives it (I2).
 */
export type ActiveActorResult =
  | { kind: "actor"; actorId: string; tokenId: string | null; via: "selection" | "own-character" }
  | { kind: "group"; tokenIds: readonly string[]; actorIds: readonly string[] }
  | { kind: "none"; reason: "gm-no-selection" | "no-character" };

export interface ActiveActorInput {
  /** `isGm` = the privileged role (`isRolePrivileged`, role ≥ ASSISTANT), REQ-BAR-001. */
  viewer: { userId: string; isGm: boolean };
  /**
   * The selection published by the `TokenInteractionManager`, by ACTOR (the token only points
   * at it). Empty = nothing selected. `tokenId` is the actor's token in the scene the canvas
   * draws, or `null` when that scene has none (the selection survives a scene change).
   */
  selection: ReadonlyArray<{ tokenId: string | null; actorId: string }>;
  /** `ownedActorIdsOf(actors, userId)`: live and role-blind — only an `ownership` entry counts. */
  ownedActorIds: ReadonlySet<string>;
  /**
   * The characters (`type: "character"`) the user is OWNER of, in mirror order, each with its
   * last use (Q-BAR-01). `tokenId` — an additive field over the first draft of §2.4 — is the
   * character's token in the scene the canvas draws, `null` (or absent) when there is none.
   */
  ownedCharacters: ReadonlyArray<{
    actorId: string;
    lastUsedAt: number | null;
    tokenId?: string | null;
  }>;
  /**
   * Whether the actor has a provider (`actionBarRegistry.resolve("Actor", type)`, wired by
   * BAR-F1-04). An actor without one never becomes the active actor (REQ-BAR-009/012, I6).
   * Called ONLY for actors that already passed the ownership gate.
   */
  hasProvider(actorId: string): boolean;
}

const GM_NO_SELECTION: ActiveActorResult = { kind: "none", reason: "gm-no-selection" };
const NO_CHARACTER: ActiveActorResult = { kind: "none", reason: "no-character" };

/**
 * The active actor, by the rules of §2.4 (plano §4.2), in order:
 *
 * 1. Exactly one selected token whose actor is the user's (`ownedActorIds`), or a Mestre, AND
 *    that has a provider → that actor, `via: "selection"`.
 * 2. Otherwise a player with a character → the character, `via: "own-character"`; with more
 *    than one, the greatest `lastUsedAt` (tie, or never used: mirror order). A selection of
 *    someone else's token, or of an actor without a provider, lands here: the bar does not move.
 * 3. A Mestre without such a selection → `none/gm-no-selection` (D-BA10: no bar). A player
 *    without a character → `none/no-character`.
 * 4. Multi-selection (Mestre only) → `group` — BAR-F4-03. Until then it is not "exactly one",
 *    so it falls through rules 2 and 3 like any other refused selection.
 *
 * Invariants (each one a test): I1 `actor` ⇒ Mestre or owned; I2 `group` ⇒ Mestre; I3 for a
 * player, a selection with an actor not in `ownedActorIds` yields EXACTLY the empty-selection
 * result and that actor is never handed to `hasProvider`; I4 Mestre + empty selection ⇒ `none`;
 * I5 pure; I6 an actor without a provider is never the active one.
 */
export function resolveActiveActor(input: ActiveActorInput): ActiveActorResult {
  const { viewer, selection, ownedActorIds, ownedCharacters } = input;

  // Rule 1. The ownership gate is evaluated FIRST and short-circuits: an actor that fails it is
  // never shown to `hasProvider` (I3, I5) — nothing about it travels any further.
  const [only] = selection;
  if (selection.length === 1 && only !== undefined) {
    const passesGate = viewer.isGm || ownedActorIds.has(only.actorId);
    if (passesGate && input.hasProvider(only.actorId)) {
      return { kind: "actor", actorId: only.actorId, tokenId: only.tokenId, via: "selection" };
    }
  }

  // Rule 3, Mestre half. D-BA10 outranks rule 2: even a Mestre who owns a character gets no bar
  // without a selection ("mostrar a barra do último NPC usado" was rejected, DEC-BAR-10).
  if (viewer.isGm) return GM_NO_SELECTION;

  // Rule 2. `ownedActorIds` is re-checked here so I1 holds for any input, not only for one a
  // well-behaved caller assembled.
  let chosen: ActiveActorInput["ownedCharacters"][number] | null = null;
  for (const character of ownedCharacters) {
    if (!ownedActorIds.has(character.actorId)) continue;
    if (!input.hasProvider(character.actorId)) continue;
    if (chosen === null || usedAt(character) > usedAt(chosen)) chosen = character;
  }
  if (chosen === null) return NO_CHARACTER;

  return {
    kind: "actor",
    actorId: chosen.actorId,
    tokenId: chosen.tokenId ?? null,
    via: "own-character",
  };
}

/** Never used sorts below any use; a strict `>` above keeps the mirror order on a tie. */
function usedAt(character: { lastUsedAt: number | null }): number {
  return character.lastUsedAt ?? Number.NEGATIVE_INFINITY;
}
