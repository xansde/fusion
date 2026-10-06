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
 * - `mapGroupOf(combatantId)` (BHR-F5-05, D-B03): while mounted
 *   (`flags.fusion.mount` on the two scene tokens), rider and mount share ONE counter; otherwise
 *   it is the identity. Every attack is stored under the attacker's OWN key and a group's count is
 *   the sum of its members' keys (mounting mid-turn joins them). The multiple attack penalty never goes
 *   DOWN inside a turn (RAW, I-4): when a pair splits, each member keeps the count the group had at that
 *   moment (`settleSplits`, on the very next read) and new attacks add apart from there.
 * - `noteAttackFromSpeaker` is what chat-handler calls: it resolves the
 *   speaker to a combatant of the live combat and ignores anyone who is not
 *   acting (an attack out of turn changes nobody's count).
 * - An animal companion acts on its owner's turn and has a MAP of its own, apart from the owner's
 *   (PF2e remaster: the multiple attack penalty is per creature, and a minion's turn is the master's —
 *   wave 7 review I-3). Its attacks are counted per companion actor inside the active owner's turn,
 *   whether or not the companion is a combatant itself, and reset when the owner's turn starts.
 *
 * In-memory only, like the targeting store: a restart starts a fresh turn.
 */

import { calculateMapPenalty } from "@fusion/engine-2e";
import type { CombatLifecycleEvent } from "@fusion/shared";
import type { DocumentStore } from "../documents/store.js";
import { isRolePrivileged, testOwnership, OwnershipLevel } from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";
import type { CombatEventBus } from "./combat-event-bus.js";
import { createMountGrouping } from "./mount-map-group.js";
import type { MountGrouping, MountPeers } from "./mount-map-group.js";

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
  /** Attacks already made this turn by each companion acting on the active combatant's turn (by actor id). */
  byActor?: Record<string, number>;
}) => void;

/** Separates the group key from a companion's actor id in the counts map. */
const MINION_SEPARATOR = "|actor:";

export class MapCounter {
  /**
   * combatId → attacker key → attacks already made this turn. The key is a combatant id, or
   * `<active combatant id>|actor:<actor id>` for a companion that is not a combatant itself.
   */
  private readonly counts = new Map<string, Map<string, number>>();
  /** combatId → groupKey → the pair as last read: what `settleSplits` needs once the flags are gone. */
  private readonly seenGroups = new Map<string, Map<string, MountPeers>>();
  private grouping: MountGrouping | null = null;
  private store: DocumentStore | null = null;
  private publisher: AttackCountPublisher | null = null;

  /** Where counted attacks are announced to the clients (wired by SocketManager). */
  setPublisher(publisher: AttackCountPublisher | null): void {
    this.publisher = publisher;
  }

  /** Where the mount link (`flags.fusion.mount`) is read from (wired by SocketManager). */
  setStore(store: DocumentStore | null): void {
    this.store = store;
    this.grouping = store ? createMountGrouping(store) : null;
  }

  /**
   * The mount state of a scene changed: re-publish the mark of every live combat of that scene that
   * already has counted attacks, so the sheets stop showing the group count of a pair that just
   * split (or the separate counts of a pair that just joined).
   */
  republishScene(sceneId: string): void {
    if (!this.store || !this.publisher) return;
    let combats: Record<string, unknown>[];
    try {
      combats = this.store.getAll("combats");
    } catch {
      return;
    }
    for (const combat of combats) {
      if (combat["sceneId"] !== sceneId || combat["started"] !== true || combat["ended"] === true) {
        continue;
      }
      const active = combat["activeCombatantId"];
      const combatId = String(combat["_id"]);
      if (typeof active !== "string" || !this.counts.get(combatId)?.size) continue;
      const round = combat["round"];
      this.publisher({
        combatId,
        combatantId: active,
        round: typeof round === "number" ? round : 0,
        ...this.markFor(combatId, active),
      });
    }
  }

  /** Which counter a combatant feeds: one key per mounted pair, the combatant itself otherwise. */
  mapGroupOf(combatantId: string, combatId?: string): string {
    return this.peersOf(combatantId, combatId)?.groupKey ?? combatantId;
  }

  private peersOf(combatantId: string, combatId?: string): MountPeers | null {
    return this.grouping?.peersOf(combatantId, combatId) ?? null;
  }

  /** Attacks already counted for the combatant's group in the current turn. */
  getAttackCount(combatId: string, combatantId: string): number {
    this.settleSplits(combatId);
    const byKey = this.counts.get(combatId);
    if (!byKey) return 0;
    const peers = this.peersOf(combatantId, combatId);
    if (!peers) return byKey.get(combatantId) ?? 0;
    let seen = this.seenGroups.get(combatId);
    if (!seen) {
      seen = new Map();
      this.seenGroups.set(combatId, seen);
    }
    seen.set(peers.groupKey, peers);
    return this.groupTotal(byKey, peers);
  }

  private groupTotal(byKey: Map<string, number>, peers: MountPeers): number {
    let total = 0;
    for (const id of peers.combatantIds) {
      total += byKey.get(id) ?? 0;
      for (const actorId of peers.actorIds) {
        total += byKey.get(`${id}${MINION_SEPARATOR}${actorId}`) ?? 0;
      }
    }
    return total;
  }

  /**
   * A pair that was mounted when last read and is not anymore (dismount, by the op or by the Mestre moving the
   * rider) splits: every member keeps the count the group had, so the penalty does not drop mid-turn (RAW, I-4).
   * Counts of a member are its combatant key and, for the partner that is not a combatant, the key under the
   * combatant that is acting.
   */
  private settleSplits(combatId: string): void {
    const seen = this.seenGroups.get(combatId);
    const byKey = this.counts.get(combatId);
    if (!seen || seen.size === 0) return;
    for (const [groupKey, peers] of [...seen]) {
      const first = peers.combatantIds[0];
      if (first === undefined || this.peersOf(first, combatId)?.groupKey === groupKey) continue;
      seen.delete(groupKey);
      if (!byKey) continue;
      const total = this.groupTotal(byKey, peers);
      if (total === 0) continue;
      const actorOf = this.combatantActors(combatId);
      for (const id of peers.combatantIds) {
        byKey.set(id, total);
        for (const actorId of peers.actorIds) {
          if (actorId !== actorOf.get(id)) byKey.set(`${id}${MINION_SEPARATOR}${actorId}`, total);
        }
      }
    }
  }

  private combatantActors(combatId: string): Map<string, string> {
    const out = new Map<string, string>();
    try {
      const combatants = this.store?.get("combats", combatId)["combatants"];
      if (!Array.isArray(combatants)) return out;
      for (const c of combatants as Record<string, unknown>[]) {
        if (typeof c["_id"] === "string" && typeof c["actorId"] === "string") {
          out.set(c["_id"], c["actorId"]);
        }
      }
    } catch {
      /* the combat is gone: nothing to settle against */
    }
    return out;
  }

  /** MAP the NEXT attack of this combatant takes (0, -5, -10; agile 0, -4, -8). */
  getMapPenalty(combatId: string, combatantId: string, agile: boolean): number {
    return calculateMapPenalty(this.getAttackCount(combatId, combatantId) + 1, agile);
  }

  /** Counts one attack; returns the count of the combatant's group after the call. */
  noteAttack(combatId: string, combatantId: string, opts: NoteAttackOptions = {}): number {
    if (opts.countsForMap !== false) this.bump(combatId, combatantId);
    return this.getAttackCount(combatId, combatantId);
  }

  private bump(combatId: string, key: string): void {
    this.settleSplits(combatId);
    let byKey = this.counts.get(combatId);
    if (!byKey) {
      byKey = new Map();
      this.counts.set(combatId, byKey);
    }
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }

  /**
   * Attacks a companion made during the turn of `activeCombatantId`. While mounted, the rider and
   * the mount have no counter of their own: they read the shared group count.
   */
  getMinionAttackCount(combatId: string, activeCombatantId: string, actorId: string): number {
    this.settleSplits(combatId);
    const peers = this.peersOf(activeCombatantId, combatId);
    if (peers?.actorIds.includes(actorId)) return this.getAttackCount(combatId, activeCombatantId);
    return this.counts.get(combatId)?.get(`${activeCombatantId}${MINION_SEPARATOR}${actorId}`) ?? 0;
  }

  /**
   * What the clients read on the combat (`attackCount`): the count of the ACTIVE combatant's group
   * and, by actor, the count of each companion acting on its turn. A mounted pair shows ONE number
   * on both sheets (REQ-BHR-180): the partner actor reads the group count through `byActor`.
   */
  private markFor(
    combatId: string,
    activeId: string,
  ): { count: number; byActor?: Record<string, number> } {
    const count = this.getAttackCount(combatId, activeId);
    const byActor: Record<string, number> = {};
    const prefix = `${activeId}${MINION_SEPARATOR}`;
    for (const [key, n] of this.counts.get(combatId) ?? []) {
      if (key.startsWith(prefix)) byActor[key.slice(prefix.length)] = n;
    }
    const peers = this.peersOf(activeId, combatId);
    // The active combatant's own actor reads `count`; the partner's reads the group count.
    if (peers?.partnerActorId !== undefined) byActor[peers.partnerActorId] = count;
    return { count, ...(Object.keys(byActor).length > 0 ? { byActor } : {}) };
  }

  /** Zeroes the group of a combatant (rider and mount) and its companions (turnStart). */
  resetCombatant(combatId: string, combatantId: string): void {
    const byKey = this.counts.get(combatId);
    if (!byKey) return;
    const ids = this.peersOf(combatantId, combatId)?.combatantIds ?? [combatantId];
    for (const key of [...byKey.keys()]) {
      if (ids.some((id) => key === id || key.startsWith(`${id}${MINION_SEPARATOR}`))) {
        byKey.delete(key);
      }
    }
  }

  /** Drops everything for a combat (combatEnd). */
  resetCombat(combatId: string): void {
    this.counts.delete(combatId);
    this.seenGroups.delete(combatId);
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
      // Only the one acting changes a count (its MAP group counts as acting).
      // Not acting HERE does not end the search: another live combat may have it.
      if (
        me &&
        typeof me["_id"] === "string" &&
        this.mapGroupOf(me["_id"], String(combat["_id"])) ===
          this.mapGroupOf(active, String(combat["_id"]))
      ) {
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
            ...this.markFor(combatId, active),
          });
        }
        return count;
      }
      // A companion of the combatant acting now: its attacks count apart, inside this turn.
      const minionCount = this.noteMinionAttack(store, combat, combatants, active, speaker, opts);
      if (minionCount !== undefined) return minionCount;
    }
    return null;
  }

  /**
   * An attack by an animal companion during its owner's turn: counted under the companion's own key inside
   * the active group, published with the owner's count unchanged. `undefined` when the speaker is not a
   * companion of the combatant acting now (or the author may not speak for it).
   */
  private noteMinionAttack(
    store: DocumentStore,
    combat: Record<string, unknown>,
    combatants: Record<string, unknown>[],
    activeId: string,
    speaker: AttackSpeaker,
    opts: NoteAttackOptions,
  ): number | undefined {
    const actorId = speaker.actorId;
    if (!actorId) return undefined;
    let actor: Record<string, unknown>;
    try {
      actor = store.get("actors", actorId);
    } catch {
      return undefined;
    }
    const system = actor["system"];
    if (!system || typeof system !== "object" || Array.isArray(system)) return undefined;
    const sys = system as Record<string, unknown>;
    if (sys["companionKind"] !== "animalCompanion") return undefined;
    const masterId = sys["masterActorId"];
    if (typeof masterId !== "string" || masterId === "") return undefined;
    const activeCombatant = combatants.find((c) => c["_id"] === activeId);
    if (activeCombatant?.["actorId"] !== masterId) return undefined;
    if (!isRolePrivileged(speaker.role) && !ownsActor(store, speaker, actorId)) return undefined;

    const combatId = String(combat["_id"]);
    if (opts.countsForMap === false) return this.getMinionAttackCount(combatId, activeId, actorId);
    this.bump(combatId, `${activeId}${MINION_SEPARATOR}${actorId}`);
    const round = combat["round"];
    this.publisher?.({
      combatId,
      combatantId: activeId,
      round: typeof round === "number" ? round : 0,
      ...this.markFor(combatId, activeId),
    });
    return this.getMinionAttackCount(combatId, activeId, actorId);
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
  return typeof actorId === "string" && ownsActor(store, speaker, actorId);
}

function ownsActor(store: DocumentStore, speaker: AttackSpeaker, actorId: string): boolean {
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
