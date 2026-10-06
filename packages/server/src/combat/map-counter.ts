/**
 * MapCounter — who counts the multiple attack penalty (BHR-F3-04 / GUE-F1-04,
 * D-G03, REQ-CBT-069).
 *
 * The server keeps, per combat, how many attacks each MAP group already made
 * in the current turn. The penalty itself is NOT computed here: it is
 * `calculateMapPenalty` from engine-2e (pure, already tested).
 *
 * - `noteAttack` increments the group's counter (unless `countsForMap: false`,
 *   the Reactive Strike case).
 * - `onLifecycle("turnStart")` zeroes the counter of the combatant starting.
 * - `mapGroupOf(combatantId)` is the extension point BHR-F5-05 fills in: while
 *   mounted, rider and mount share one counter. Today it is the identity.
 * - `noteAttackFromSpeaker` is what chat-handler calls: it resolves the
 *   speaker to a combatant of the live combat and ignores anyone who is not
 *   acting (an attack out of turn changes nobody's count).
 *
 * In-memory only, like the targeting store: a restart starts a fresh turn.
 */

import { calculateMapPenalty } from "@fusion/engine-2e";
import type { CombatLifecycleEvent } from "@fusion/shared";
import type { DocumentStore } from "../documents/store.js";
import { isRolePrivileged, testOwnership, OwnershipLevel } from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";
import type { CombatEventBus } from "./combat-event-bus.js";

export interface NoteAttackOptions {
  /** false for an attack that is outside the count (Reactive Strike). Default true. */
  countsForMap?: boolean;
}

/** Who made the attack, as the chat handler knows it. */
export interface AttackSpeaker {
  userId: string;
  role: number;
  actorId?: string | undefined;
  tokenId?: string | undefined;
}

export type MapGroupResolver = (combatantId: string) => string;

/**
 * Called after a counted attack so the count reaches the clients (D-G03, onda-6
 * review I-7): the combat document carries it as `attackCount`, valid for the
 * active combatant in this round. Nothing is published at turnStart: the new
 * turn is another `combatantId`/`round`, so the old mark is simply stale.
 */
export type AttackCountPublisher = (mark: {
  combatId: string;
  combatantId: string;
  round: number;
  count: number;
}) => void;

export class MapCounter {
  /** combatId → map group → attacks already made this turn. */
  private readonly counts = new Map<string, Map<string, number>>();
  private resolver: MapGroupResolver = (combatantId) => combatantId;
  private publisher: AttackCountPublisher | null = null;

  /** Where counted attacks are announced to the clients (wired by SocketManager). */
  setPublisher(publisher: AttackCountPublisher | null): void {
    this.publisher = publisher;
  }

  /** Which counter a combatant feeds. Identity until BHR-F5-05 (mount). */
  mapGroupOf(combatantId: string): string {
    return this.resolver(combatantId);
  }

  /** Extension point for BHR-F5-05: replaces the identity grouping. */
  setMapGroupResolver(resolver: MapGroupResolver): void {
    this.resolver = resolver;
  }

  /** Attacks already counted for the combatant's group in the current turn. */
  getAttackCount(combatId: string, combatantId: string): number {
    return this.counts.get(combatId)?.get(this.mapGroupOf(combatantId)) ?? 0;
  }

  /** MAP the NEXT attack of this combatant takes (0, -5, -10; agile 0, -4, -8). */
  getMapPenalty(combatId: string, combatantId: string, agile: boolean): number {
    return calculateMapPenalty(this.getAttackCount(combatId, combatantId) + 1, agile);
  }

  /** Counts one attack; returns the count after the call. */
  noteAttack(combatId: string, combatantId: string, opts: NoteAttackOptions = {}): number {
    const current = this.getAttackCount(combatId, combatantId);
    if (opts.countsForMap === false) return current;
    let byGroup = this.counts.get(combatId);
    if (!byGroup) {
      byGroup = new Map();
      this.counts.set(combatId, byGroup);
    }
    byGroup.set(this.mapGroupOf(combatantId), current + 1);
    return current + 1;
  }

  /** Zeroes the group of a combatant (turnStart). */
  resetCombatant(combatId: string, combatantId: string): void {
    this.counts.get(combatId)?.delete(this.mapGroupOf(combatantId));
  }

  /** Drops everything for a combat (combatEnd). */
  resetCombat(combatId: string): void {
    this.counts.delete(combatId);
  }

  /**
   * Called by chat-handler when an attack roll was graded. Resolves the speaker
   * to a combatant of a live combat and counts the attack only when that
   * combatant (or its MAP group) is the one acting. Returns the new count, or
   * null when the attack was not attributed to anybody.
   */
  noteAttackFromSpeaker(
    store: DocumentStore | undefined,
    speaker: AttackSpeaker,
    opts: NoteAttackOptions = {},
  ): number | null {
    if (!store || (!speaker.tokenId && !speaker.actorId)) return null;
    let combats: Record<string, unknown>[];
    try {
      combats = store.getAll("combats");
    } catch {
      return null;
    }
    for (const combat of combats) {
      if (combat["started"] !== true || combat["ended"] === true) continue;
      const active = combat["activeCombatantId"];
      if (typeof active !== "string" || !Array.isArray(combat["combatants"])) continue;
      const combatants = combat["combatants"] as Record<string, unknown>[];
      const me = pickSpeakerCombatant(combatants, speaker, active);
      if (!me || typeof me["_id"] !== "string") continue;
      // Only the one acting changes a count (its MAP group counts as acting).
      // Not acting HERE does not end the search: another live combat may have it.
      if (this.mapGroupOf(me["_id"]) !== this.mapGroupOf(active)) continue;
      if (!isRolePrivileged(speaker.role) && !ownsCombatant(store, speaker, me)) return null;
      const combatId = String(combat["_id"]);
      const count = this.noteAttack(combatId, me["_id"], opts);
      if (opts.countsForMap !== false) {
        const round = combat["round"];
        this.publisher?.({
          combatId,
          // The mark names the ACTIVE combatant, which the client matches against
          // `activeCombatantId` (a mounted rider shares the mount's group).
          combatantId: active,
          round: typeof round === "number" ? round : 0,
          count,
        });
      }
      return count;
    }
    return null;
  }
}

/**
 * The combatant a speaker stands for. By token when the speaker names one.
 * By actor otherwise: a single combatant of that actor is it; with several
 * (unlinked NPCs sharing one actor) the ACTIVE one if it is of that actor, and
 * otherwise nobody — an ambiguous attack is never attributed to the wrong one.
 */
function pickSpeakerCombatant(
  combatants: Record<string, unknown>[],
  speaker: AttackSpeaker,
  activeId: string,
): Record<string, unknown> | undefined {
  if (speaker.tokenId) return combatants.find((c) => c["tokenId"] === speaker.tokenId);
  const ofActor = combatants.filter((c) => c["actorId"] === speaker.actorId);
  if (ofActor.length <= 1) return ofActor[0];
  return ofActor.find((c) => c["_id"] === activeId);
}

/** A non-privileged author may only count attacks of an actor he owns. */
function ownsCombatant(
  store: DocumentStore,
  speaker: AttackSpeaker,
  combatant: Record<string, unknown>,
): boolean {
  const actorId = combatant["actorId"];
  if (typeof actorId !== "string") return false;
  try {
    const actor = store.get("actors", actorId);
    const ownership = actor["ownership"];
    if (!ownership || typeof ownership !== "object" || Array.isArray(ownership)) return false;
    return testOwnership(
      ownership as Ownership,
      speaker.userId,
      speaker.role,
      OwnershipLevel.OWNER,
    );
  } catch {
    return false;
  }
}

/** Zeroes the count when a turn starts (and drops the combat when it ends). */
export function registerMapCounterReset(counter: MapCounter, eventBus: CombatEventBus): void {
  eventBus.onLifecycle("turnStart", (event: CombatLifecycleEvent) => {
    if (event.type !== "turnStart") return;
    counter.resetCombatant(event.combat._id, event.combatant._id);
  });
  eventBus.onLifecycle("combatEnd", (event: CombatLifecycleEvent) => {
    if (event.type !== "combatEnd") return;
    counter.resetCombat(event.combat._id);
  });
}
