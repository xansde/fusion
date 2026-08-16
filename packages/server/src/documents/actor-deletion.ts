/**
 * Deleting an actor, server side — what falls with it, and what refuses to fall.
 *
 * Spec 42 §5.7. Three rules live here, and they are three because the generic
 * `doc:delete` path knows none of them:
 *
 *   1. REQ-NPC-052 — the delete is REFUSED while the actor sits in an encounter
 *      that has not ended. Removing the actor under a live tracker leaves a
 *      combatant pointing at nothing: the turn order still contains it, the
 *      round still walks onto it, and there is no screen left that can take it
 *      out. The refusal names the encounter and the two ops that unblock it
 *      (REQ-CBT-003 / REQ-CBT-006), because a refusal that does not say how to
 *      proceed is just a wall.
 *
 *   2. REQ-NPC-053 — once it goes, every presence of it goes from every scene.
 *      A token is not a document of its own (`DEC-PER-02`): it lives inside the
 *      Scene's JSON, so nothing about deleting the Actor row would touch it, and
 *      the leftover would be a figure on the table that no sheet answers for.
 *
 *   3. REQ-NPC-054 — the knowledge recorded ABOUT the actor stops existing. That
 *      one needs no sweep and this module deliberately writes no code for it:
 *      spec 39 §7 and spec 42 §7 both store the general rule and the exceptions
 *      on the contact's OWN document (`flags.fusion.knowledge`), so the map is
 *      inside the row that `doc:delete` removes. The mirror case, REQ-CTT-076,
 *      DOES need a sweep — the exceptions are keyed by CHARACTER id and sit on
 *      other actors — and `sweepCharactersFromKnowledge` in knowledge.ts is it.
 *      A non-playable id is never an exception key, so there is nothing left
 *      behind pointing at the deleted actor; the test proves it by scanning
 *      every remaining document rather than by trusting this paragraph.
 *
 * Everything is read through `DocumentStore`, never through raw SQL: a token
 * lives in the Scene's JSON body and a combatant in the Combat's, and only the
 * store parses those.
 */

import {
  readKnowledgeMap,
  resolveKnowledgeFromMap,
  KnowledgeState,
  type KnowledgeMap,
  type ActorDeleteBlockingCombat,
  type ActorDeleteKnowledgeSummary,
  type ActorDeletePresence,
  type ActorDeletePreviewResult,
} from "@fusion/shared";
import type { DocumentStore, AuthorContext } from "./store.js";
import { isCharacterActor } from "./knowledge.js";

/** The `_id` of a stored document, or `""` when the row is malformed. */
function idOf(doc: Record<string, unknown>): string {
  const id = doc["_id"];
  return typeof id === "string" ? id : "";
}

function nameOf(doc: Record<string, unknown>): string {
  const name = doc["name"];
  return typeof name === "string" ? name : "";
}

function arrayOf(doc: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const raw = doc[key];
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

/** The `actorId` a token or a combatant points at, or `null` when unlinked. */
function actorIdOf(entry: Record<string, unknown>): string | null {
  const actorId = entry["actorId"];
  return typeof actorId === "string" && actorId.length > 0 ? actorId : null;
}

/**
 * Every unfinished encounter naming any of `actorIds` (REQ-NPC-052).
 *
 * "Unfinished" is `ended !== true`, not `started === true`: an encounter the GM
 * has built but not begun is exactly the case where the actor was just added to
 * the tracker, and deleting it there is the same dangling combatant as deleting
 * it mid-round. `combat:endCombat` sets `ended` and leaves the row (REQ-CBT-006),
 * so a finished encounter never blocks anything.
 */
export function findBlockingCombats(
  store: DocumentStore,
  actorIds: ReadonlySet<string>,
): ActorDeleteBlockingCombat[] {
  if (actorIds.size === 0) return [];

  const sceneNames = sceneNameIndex(store);
  const blocking: ActorDeleteBlockingCombat[] = [];

  for (const combat of store.getAll("combats")) {
    if (combat["ended"] === true) continue;

    let combatantCount = 0;
    for (const combatant of arrayOf(combat, "combatants")) {
      const actorId = actorIdOf(combatant);
      if (actorId !== null && actorIds.has(actorId)) combatantCount += 1;
    }
    if (combatantCount === 0) continue;

    const sceneId = typeof combat["sceneId"] === "string" ? combat["sceneId"] : "";
    blocking.push({
      combatId: idOf(combat),
      sceneId,
      sceneName: sceneNames.get(sceneId) ?? "",
      combatantCount,
    });
  }
  return blocking;
}

/** sceneId → scene name, for naming a scene without a second read per hit. */
function sceneNameIndex(store: DocumentStore): Map<string, string> {
  const index = new Map<string, string>();
  for (const scene of store.getAll("scenes")) {
    const id = idOf(scene);
    if (id !== "") index.set(id, nameOf(scene));
  }
  return index;
}

/**
 * The refusal message of REQ-NPC-052 — it says what blocks AND how to unblock.
 *
 * English, like every other server refusal: this string is a protocol-level
 * diagnostic, and the sentence the reader sees is the client's own i18n copy.
 */
export function blockingCombatMessage(
  actorId: string,
  blocking: readonly ActorDeleteBlockingCombat[],
): string {
  const where = blocking
    .map((c) => `${c.combatId}${c.sceneName === "" ? "" : ` (scene "${c.sceneName}")`}`)
    .join(", ");
  return (
    `Actor/${actorId} is in an active combat and cannot be deleted: ${where}. ` +
    `End the encounter (combat:endCombat) or take the actor out of it ` +
    `(combat:removeCombatant), then delete again.`
  );
}

/**
 * How many presences the actor has, and in which scenes (REQ-NPC-051).
 *
 * Scenes with no presence are left out entirely — the confirmation lists where
 * the actor IS, not the whole world.
 */
export function findPresences(store: DocumentStore, actorId: string): ActorDeletePresence[] {
  const presences: ActorDeletePresence[] = [];
  for (const scene of store.getAll("scenes")) {
    let count = 0;
    for (const token of arrayOf(scene, "tokens")) {
      if (actorIdOf(token) === actorId) count += 1;
    }
    if (count === 0) continue;
    presences.push({ sceneId: idOf(scene), sceneName: nameOf(scene), presenceCount: count });
  }
  return presences;
}

/**
 * The knowledge the world holds about this actor (REQ-NPC-054).
 *
 * The tally is resolved over the world's CHARACTERS, not over the exception keys:
 * a general rule of `known` with no exception at all means every character knows
 * the actor (REQ-CTT-070), and a summary that counted only exceptions would
 * report zero and tell the reader nothing falls.
 */
export function summarizeKnowledgeAbout(
  store: DocumentStore,
  doc: Record<string, unknown>,
): ActorDeleteKnowledgeSummary {
  const map: KnowledgeMap = readKnowledgeMap(doc);
  let knownBy = 0;
  let glimpsedBy = 0;

  for (const candidate of store.getAll("actors")) {
    if (!isCharacterActor(candidate)) continue;
    const characterId = idOf(candidate);
    if (characterId === "") continue;
    const state = resolveKnowledgeFromMap(map, characterId);
    if (state === KnowledgeState.Known) knownBy += 1;
    else if (state === KnowledgeState.Glimpsed) glimpsedBy += 1;
  }

  return {
    general: map.general,
    exceptionCount: Object.keys(map.exceptions).length,
    knownBy,
    glimpsedBy,
  };
}

/**
 * Everything the confirmation of REQ-NPC-051 has to show, plus the refusal of
 * REQ-NPC-052 so the dialog can say "this one will not go" before asking.
 */
export function buildActorDeletePreview(
  store: DocumentStore,
  doc: Record<string, unknown>,
): ActorDeletePreviewResult {
  const actorId = idOf(doc);
  const presences = findPresences(store, actorId);
  const blockingCombats = findBlockingCombats(store, new Set([actorId]));

  return {
    actorId,
    name: nameOf(doc),
    type: typeof doc["type"] === "string" ? doc["type"] : "",
    presences,
    presenceCount: presences.reduce((total, p) => total + p.presenceCount, 0),
    knowledge: summarizeKnowledgeAbout(store, doc),
    itemCount: arrayOf(doc, "items").length,
    blockingCombats,
    deletable: blockingCombats.length === 0,
  };
}

/** One scene whose token list has to be rewritten because an actor went away. */
export interface PresenceRemoval {
  readonly sceneId: string;
  /** The tokens that survive — what gets persisted. */
  readonly tokens: Record<string, unknown>[];
  /** How many presences were dropped from this scene. */
  readonly removedCount: number;
}

/**
 * Plan the removal of every presence of `actorIds`, without writing (REQ-NPC-053).
 *
 * Planned BEFORE the actor rows go and applied after: a plan built from a store
 * that still holds the actor cannot be wrong about which scenes it touches, and a
 * `NOT_FOUND` in the middle of the delete loop then leaves no scene already
 * rewritten for a delete that never happened.
 */
export function planPresenceRemoval(
  store: DocumentStore,
  actorIds: ReadonlySet<string>,
): PresenceRemoval[] {
  if (actorIds.size === 0) return [];

  const removals: PresenceRemoval[] = [];
  for (const scene of store.getAll("scenes")) {
    const tokens = arrayOf(scene, "tokens");
    const surviving = tokens.filter((token) => {
      const actorId = actorIdOf(token);
      return actorId === null || !actorIds.has(actorId);
    });
    if (surviving.length === tokens.length) continue;
    removals.push({
      sceneId: idOf(scene),
      tokens: surviving,
      removedCount: tokens.length - surviving.length,
    });
  }
  return removals;
}

/**
 * Persist a plan from {@link planPresenceRemoval}, returning the updated scenes so
 * the caller can broadcast a single delta — no client should need a reload to
 * stop drawing a token whose actor is gone.
 */
export function applyPresenceRemoval(
  store: DocumentStore,
  removals: readonly PresenceRemoval[],
  author?: AuthorContext,
): Record<string, unknown>[] {
  const updated: Record<string, unknown>[] = [];
  for (const removal of removals) {
    if (removal.sceneId === "") continue;
    const result = store.update("scenes", removal.sceneId, { tokens: removal.tokens }, author);
    if (result !== null) updated.push(result);
  }
  return updated;
}
