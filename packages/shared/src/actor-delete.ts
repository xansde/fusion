/**
 * actor-delete.ts — what `actor:deletePreview` asks and what it answers.
 *
 * Spec 42 §5.7. Deleting a non-playable is the only destructive gesture of the
 * NPCs tab, and REQ-NPC-051 says the confirmation has to SHOW what falls with
 * it before it falls: how many presences are on the table and in which scenes,
 * what knowledge the world holds about the actor, and the sheet with its
 * embedded items. REQ-NPC-052 adds a refusal the confirmation must be able to
 * anticipate — an actor in an unfinished encounter is not deletable at all.
 *
 * The query exists instead of letting the client count for itself because two of
 * the three answers are not in the client's mirror to count: a Scene the player
 * seat never received is not in `worldMirror` (REQ-CEN-071), and knowledge is
 * stripped from every non-privileged payload (REQ-CTT-084). A privileged seat
 * does hold most of it — but the count would then be re-derived in the client and
 * drift from the rule the server actually enforces on delete, which is precisely
 * the divergence a confirmation dialog must not have.
 *
 * Nothing here writes: the query is read-only, and the delete itself stays on
 * `doc:delete` (REQ-NPC-050), which re-checks the same refusal server-side.
 */

import { z } from "zod";
import type { KnowledgeState } from "./knowledge.js";

/**
 * `actor:deletePreview` — read what a delete would take with it (REQ-NPC-051).
 */
export const ActorDeletePreviewPayloadSchema = z
  .object({
    actorId: z.string().min(1),
  })
  .strict();

export type ActorDeletePreviewPayload = z.infer<typeof ActorDeletePreviewPayloadSchema>;

/**
 * One scene the actor is present in, and how many presences it holds there
 * (REQ-NPC-051).
 *
 * Deliberately NOT a list of token ids: REQ-NPC-036 says the tab shows how many
 * presences and in which scenes, and nothing of the individual presence. A
 * confirmation dialog listing token ids would be the first screen of this tab to
 * break that, and the id would be useless to the reader anyway.
 */
export interface ActorDeletePresence {
  readonly sceneId: string;
  readonly sceneName: string;
  /** How many tokens of this actor stand in that scene. */
  readonly presenceCount: number;
}

/**
 * The knowledge the world holds ABOUT the actor being deleted — the general rule
 * plus a tally of the exceptions, which is what REQ-NPC-054 removes.
 *
 * A tally rather than the map itself: the confirmation says what disappears, and
 * the grid that edits it is the "Quem conhece quem" window (REQ-NPC-072).
 */
export interface ActorDeleteKnowledgeSummary {
  /** The general rule (REQ-CTT-072) as stored on the actor. */
  readonly general: KnowledgeState;
  /** How many characters have an exception naming this actor (REQ-CTT-072). */
  readonly exceptionCount: number;
  /** Characters whose effective state is `known` (REQ-CTT-070). */
  readonly knownBy: number;
  /** Characters whose effective state is `glimpsed` (REQ-CTT-070). */
  readonly glimpsedBy: number;
}

/**
 * An unfinished encounter that names the actor — the reason a delete is refused
 * (REQ-NPC-052), and the thing the reader has to resolve to unblock it.
 */
export interface ActorDeleteBlockingCombat {
  readonly combatId: string;
  readonly sceneId: string;
  readonly sceneName: string;
  /** How many combatants of this encounter point at the actor (REQ-CBT-002). */
  readonly combatantCount: number;
}

/** What `actor:deletePreview` acks with. */
export interface ActorDeletePreviewResult {
  readonly actorId: string;
  readonly name: string;
  /** The Actor subtype, so the caller can tell an npc from a hazard. */
  readonly type: string;
  /** Scenes holding at least one presence, in world order (REQ-NPC-051). */
  readonly presences: readonly ActorDeletePresence[];
  /** Presences across every scene — the sum of `presences[].presenceCount`. */
  readonly presenceCount: number;
  /** The knowledge that ceases to exist with the actor (REQ-NPC-054). */
  readonly knowledge: ActorDeleteKnowledgeSummary;
  /** Items embedded in the sheet that go with it (REQ-NPC-051). */
  readonly itemCount: number;
  /** Unfinished encounters naming the actor; empty when none (REQ-NPC-052). */
  readonly blockingCombats: readonly ActorDeleteBlockingCombat[];
  /** False exactly when `blockingCombats` is non-empty (REQ-NPC-052). */
  readonly deletable: boolean;
}
