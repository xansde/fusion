/**
 * combatBadge.svelte.ts — what the Combate tab tells the rail (spec 40 §5.1).
 *
 * DEC-CBA-07: the tab hands the rail ONE state dot (REQ-CBA-002), lit while there is
 * a live encounter on the active scene — **montagem included**, because that is where
 * a player has something to do (REQ-CBA-003) — and drawn amber when the participant of
 * the turn belongs to this user (REQ-CBA-004). Nothing here reacts to the drawer: the
 * rail may open, switch or collapse and no function in this module is even called with
 * that information (REQ-GAV-022). Nothing here blinks or makes a sound either — there
 * is no timer, no Audio and no animation in the file (REQ-CBA-005, REQ-GAV-024).
 *
 * Why the rule lives here and not in `lib/sidebar/badges`: the rail carries no business
 * rule of any badge (REQ-GAV-023). "Is there an encounter" and "is it your turn" are
 * spec 10's and spec 40's facts, so they are decided next to the combat store and are
 * merely *read* through `registerCoreTabs`.
 *
 * Two halves, split so the decision is testable without a mounted table:
 *  - pure functions (`encounterDotIsLit`, `ownedActorIdsOf`, `activeCombatantIsOwnedBy`,
 *    `combatBadgeToneFor`) that take everything they need as arguments;
 *  - a thin reactive layer that keeps the set of actors this user owns up to date from
 *    the world mirror, so the getters `combatBadgeLit()` / `combatBadgeTone()` are cheap
 *    reads a Svelte template can track.
 *
 * `.svelte.ts` is required, not decorative: `$state` is a compiler rune.
 */

import { getUserLevel, OwnershipLevel } from "@fusion/shared";
import type { CombatDocument, Ownership } from "@fusion/shared";

import { worldMirror } from "../docs/worldSync.js";
import { combatStore } from "./combatStore.svelte.js";

/**
 * The two intensities of the dot (DEC-CBA-07). Structurally the same union as the
 * rail's `SidebarBadgeTone`; declared here rather than imported so `lib/combat` never
 * points back at `lib/sidebar`, which points at it.
 */
export type CombatBadgeTone = "default" | "amber";

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

/**
 * Whether the dot is lit at all (REQ-CBA-003).
 *
 * `combatStore.combat` is already the encounter of the ACTIVE SCENE and already
 * excludes ended ones (`resolveActiveCombat`), so "there is one" is the whole rule —
 * `started` is deliberately not consulted, which is what keeps the dot on during
 * montagem. The `ended` guard is kept anyway so that an encounter closed in place
 * (DEC-CBA-09) puts the dot out even before the store re-resolves.
 */
export function encounterDotIsLit(combat: CombatDocument | null): boolean {
  return combat !== null && !combat.ended;
}

/**
 * Ids of the Actors this user owns, read off mirrored Actor documents.
 *
 * Ownership is resolved by `getUserLevel`, the shared reader that honours an explicit
 * entry, `default` and INHERIT — the same reasoning the server applies through
 * `testOwnership` when it decides whether a player may end the turn (REQ-CBA-080). It
 * is role-blind on purpose: a privileged seat owns every document *by role*, and an
 * amber dot on every single turn would say nothing. Amber means "this one is yours",
 * so only an ownership entry counts, for GM and player alike.
 */
export function ownedActorIdsOf(
  actors: readonly Record<string, unknown>[],
  userId: string | null,
): Set<string> {
  const owned = new Set<string>();
  if (userId === null || userId === "") return owned;

  for (const actor of actors) {
    const id = actor["_id"];
    if (typeof id !== "string") continue;
    const ownership = actor["ownership"];
    if (ownership === null || typeof ownership !== "object" || Array.isArray(ownership)) continue;
    if (getUserLevel(ownership as Ownership, userId) >= OwnershipLevel.OWNER) owned.add(id);
  }

  return owned;
}

/**
 * Whether the participant of the turn belongs to this user (REQ-CBA-004).
 *
 * Resolved by `activeCombatantId`, never by `turnIndex`: a player's combatants array
 * is redacted, so indexing into it points at the wrong participant. When the active
 * participant is hidden the server masks the id to null for a non-privileged viewer
 * (REQ-CBA-082), and this answers `false` — a hidden turn cannot be yours as far as
 * your client is concerned, and the dot simply stays at its common emphasis.
 */
export function activeCombatantIsOwnedBy(
  combat: CombatDocument | null,
  ownedActorIds: ReadonlySet<string>,
): boolean {
  if (!encounterDotIsLit(combat) || combat === null) return false;
  if (!combat.started) return false;

  const activeId = combat.activeCombatantId;
  if (activeId === null) return false;

  const active = combat.combatants.find((combatant) => combatant._id === activeId);
  if (active === undefined || active.actorId === null) return false;

  return ownedActorIds.has(active.actorId);
}

/** The emphasis the dot is drawn with (REQ-CBA-004). */
export function combatBadgeToneFor(
  combat: CombatDocument | null,
  ownedActorIds: ReadonlySet<string>,
): CombatBadgeTone {
  return activeCombatantIsOwnedBy(combat, ownedActorIds) ? "amber" : "default";
}

// ---------------------------------------------------------------------------
// Reactive layer
// ---------------------------------------------------------------------------

/**
 * Who is looking. It is the session's fact, not a combat one, so it is handed in by
 * the table shell instead of being imported — that keeps `lib/session` (and the socket
 * it constructs on import) out of the rail's module graph.
 */
const viewer: { userId: string | null } = $state({ userId: null });

/** Actors this viewer owns; recomputed whenever the mirror or the viewer moves. */
const owned: { ids: ReadonlySet<string> } = $state({ ids: new Set<string>() });

/** Latest Actor list from the mirror. Plain, not reactive — `owned` is the signal. */
let latestActors: Record<string, unknown>[] = [];

function recomputeOwned(): void {
  owned.ids = ownedActorIdsOf(latestActors, viewer.userId);
}

worldMirror.subscribe<Record<string, unknown>>("Actor", (actors) => {
  latestActors = actors;
  recomputeOwned();
});

latestActors = worldMirror.getByType<Record<string, unknown>>("Actor");
recomputeOwned();

/**
 * Tell the badge whose seat this is (REQ-CBA-004). Called by the table shell with the
 * logged-in user's id, and with `null` when there is none. Idempotent.
 */
export function setCombatBadgeViewer(userId: string | null): void {
  if (viewer.userId === userId) return;
  viewer.userId = userId;
  latestActors = worldMirror.getByType<Record<string, unknown>>("Actor");
  recomputeOwned();
}

/** Whether the tab's state dot is lit right now (REQ-CBA-003). */
export function combatBadgeLit(): boolean {
  return encounterDotIsLit(combatStore.combat);
}

/** Emphasis of the tab's state dot right now (REQ-CBA-004). */
export function combatBadgeTone(): CombatBadgeTone {
  return combatBadgeToneFor(combatStore.combat, owned.ids);
}
