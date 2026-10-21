/**
 * barContext.ts — builds the `ActionBarContext` a provider receives (BAR-F1-04; spec 53 §7.1,
 * REQ-BAR-003, REQ-BAR-040/042; tasks.md §2.3).
 *
 * The context is built ONLY from an actor the ownership gate already let through (§2.4,
 * `resolveActiveActor` / `getActiveActor`): the builder receives that actor's document and has no
 * way to look another one up — so a provider can never be handed a NPC a player does not own
 * (D-BA01). What it adds to the document is display data: the derived values the sheet reads, where
 * the actor's token is, and the combat facts the strip shows.
 *
 * Pure (§2.10): every reactive read — the mirror, the combat store, the targets — happens in the
 * caller, so this stays a function of its input.
 */

import type { CombatDocument } from "@fusion/shared";

import { activeCombatantIsOwnedBy } from "../combat/combatBadge.svelte.js";
import { inEncounter } from "./turn.js";
import type { ActionBarContext } from "./types.js";

export interface BuildContextInput {
  /** The actor `getActiveActor()` released, and the token it stands on in the canvas scene. */
  active: { actorId: string; tokenId: string | null };
  /** That actor's document in the mirror. */
  actor: Record<string, unknown>;
  viewer: { userId: string; isGm: boolean };
  /** The encounter of the scene on air, or null. */
  combat: CombatDocument | null;
  /** The actors the viewer owns by an ownership entry (`ownedActorIdsOf`) — "your turn" is decided by it. */
  ownedActorIds: ReadonlySet<string>;
  /** The viewer's own marked targets (`getMyTargets()`), names as the token already shows them. */
  targets: ReadonlyArray<{ tokenId: string; actorId: string | null; name: string }>;
}

/** `actor.system.derived`, which the server recalculates and persists; `{}` when it is not there. */
function derivedOf(actor: Record<string, unknown>): Record<string, unknown> {
  const system = actor["system"];
  if (system === null || typeof system !== "object") return {};
  const derived = (system as Record<string, unknown>)["derived"];
  if (derived === null || typeof derived !== "object" || Array.isArray(derived)) return {};
  return derived as Record<string, unknown>;
}

export function buildActionBarContext(input: BuildContextInput): ActionBarContext {
  const running = inEncounter(input.combat);
  return {
    actorId: input.active.actorId,
    actor: input.actor,
    derived: derivedOf(input.actor),
    tokenId: input.active.tokenId,
    viewer: { userId: input.viewer.userId, isGm: input.viewer.isGm },
    combat: {
      inCombat: running,
      round: running && input.combat !== null ? input.combat.round : null,
      isMyTurn: running && activeCombatantIsOwnedBy(input.combat, input.ownedActorIds),
      targets: input.targets.map((target) => ({
        tokenId: target.tokenId,
        actorId: target.actorId ?? "",
        name: target.name,
      })),
    },
  };
}
