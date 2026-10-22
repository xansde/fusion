/**
 * activeActorStore.svelte.ts — the reactive reader of the active actor, and the publisher the
 * TokenInteractionManager feeds (BAR-F1-01).
 *
 * Contract: `docs/design/barra-de-acoes/tasks.md` §2.4. Spec 53 REQ-BAR-001..005 and
 * REQ-BAR-007..010.
 *
 * `getActiveActor()` is the ONLY door the UI reads the active actor through, and it only ever
 * returns what `resolveActiveActor` (the pure gate, `activeActor.ts`) decided — so a provider
 * never receives an actor a player does not own (D-BA01). The inputs are gathered here:
 *
 *  - who is looking: `setActiveActorViewer`, from the table shell;
 *  - what is selected: `publishTokenSelection`, from the TokenInteractionManager. Kept by ACTOR
 *    (the token only points at it), so it survives a scene change; the token is re-resolved in
 *    the scene the canvas draws, or becomes `null` (REQ-BAR-007);
 *  - what the user owns: `ownedActorIdsOf` over the live mirror — the one ownership predicate of
 *    the client (REQ-TOK-032, REQ-BAR-004), read on every call, never a snapshot;
 *  - the last use of each character (Q-BAR-01): `noteActorUsed`, in memory until BAR-F3-04
 *    keeps it on the device;
 *  - whether an actor has a provider: `setActiveActorProviderCheck`, wired to the registry by
 *    BAR-F1-04. Until then every actor counts as having one.
 *
 * Only the manager of the scene the canvas draws speaks for the selection (agreed reading of
 * §2.4): the manager also publishes in `destroy()`, and the table shell destroys it on the way
 * to the next scene, so a publication from a scene that already left the canvas is a teardown,
 * not a gesture, and it leaves the selection alone. The click on empty canvas of the CURRENT
 * scene still clears it (D-BA10 for the Mestre).
 *
 * Reactivity follows the house pattern (`combatStore`'s `targetingStore.version`): plain module
 * state plus one `$state` counter the reader touches. The writers run inside `untrack`, because
 * the manager's `destroy()` runs inside the table shell's scene `$effect` and must not make that
 * effect depend on this store.
 *
 * `.svelte.ts` is required, not decorative: `$state` is a compiler rune.
 */

import { untrack } from "svelte";
import type { SceneDocument } from "@fusion/shared";

import { worldMirror } from "../docs/worldSync.js";
import { activeSceneState } from "../docs/activeScene.svelte.js";
import { sceneListState } from "../scenes/scenesState.svelte.js";
import { resolveCanvasScene, scenePrepareState } from "../scenes/prepareState.svelte.js";
import { ownedActorIdsOf } from "../combat/combatBadge.svelte.js";
import { PLAYER_CHARACTER_SUBTYPES } from "../contacts/contactsVM.js";
import {
  resolveActiveActor,
  type ActiveActorInput,
  type ActiveActorResult,
} from "./activeActor.js";

interface Viewer {
  userId: string;
  isGm: boolean;
}

/** One selected actor, and the token it was selected through on the canvas scene. */
interface SelectedActor {
  actorId: string;
  tokenId: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let viewer: Viewer | null = null;
let selection: readonly SelectedActor[] = [];
const lastUsedAt = new Map<string, number>();
let lastStamp = 0;
let providerCheck: (actorId: string) => boolean = () => true;

/** The Svelte-visible signal, bumped by every writer and by every Actor change in the mirror. */
const signal: { version: number } = $state({ version: 0 });

/** The last answer handed out: an equal answer is handed out as the SAME object. */
let lastResult: ActiveActorResult = { kind: "none", reason: "no-character" };

/** Without a seated user there is nobody whose bar to draw. */
const NOBODY: ActiveActorResult = { kind: "none", reason: "no-character" };

function changed(): void {
  untrack(() => {
    signal.version += 1;
  });
}

// Ownership changes arrive as Actor updates (an OWNER granted mid-session, an actor deleted):
// the next read already sees them, this only tells Svelte to read again.
worldMirror.subscribe<Record<string, unknown>>("Actor", changed);

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * The active actor, gated (D-BA01). The ONLY door the UI reads it through; reactive inside a
 * template, `$derived` or `$effect`. A `none` result means: draw no bar (D-BA10).
 */
export function getActiveActor(): ActiveActorResult {
  void signal.version;
  const scene = canvasScene();
  const next = viewer === null ? NOBODY : resolveActiveActor(buildInput(viewer, scene));
  if (!sameResult(lastResult, next)) lastResult = next;
  return lastResult;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/**
 * The selection of the manager of scene `sceneId`. Only the TokenInteractionManager calls it,
 * through the table shell. An empty list clears the selection — but only from the scene the
 * canvas draws: from any other scene it is the teardown of a manager whose scene already left
 * the canvas, and the selection, kept by actor, carries on into the new scene.
 */
export function publishTokenSelection(sel: { sceneId: string; tokenIds: readonly string[] }): void {
  untrack(() => {
    const scene = canvasScene();
    if (scene === null || scene._id !== sel.sceneId) return;

    const next: SelectedActor[] = [];
    for (const tokenId of sel.tokenIds) {
      const token = scene.tokens.find((candidate) => candidate._id === tokenId);
      if (token !== undefined) next.push({ actorId: token.actorId, tokenId });
    }
    selection = next;
    changed();

    // Q-BAR-01: a selection that became the active actor is a use of that actor.
    const result = getActiveActor();
    if (result.kind === "actor" && result.via === "selection") noteActorUsed(result.actorId);
  });
}

/**
 * Who is looking (the table shell, from the session). `isGm` is the privileged role
 * (`isRolePrivileged`, role ≥ ASSISTANT), REQ-BAR-001. A different user — or none — drops the
 * previous seat's selection and uses: they were never this seat's.
 */
export function setActiveActorViewer(next: Viewer | null): void {
  untrack(() => {
    if (viewer?.userId === next?.userId && viewer?.isGm === next?.isGm) return;
    if (viewer?.userId !== next?.userId) {
      selection = [];
      lastUsedAt.clear();
    }
    viewer = next === null ? null : { userId: next.userId, isGm: next.isGm };
    changed();
  });
}

/**
 * "Last used" (Q-BAR-01): the store notes the actor a selection made active, and the bar notes
 * the actor of every successful execution (BAR-F1-04). Strictly increasing stamps, so two uses
 * in the same millisecond still have an order.
 */
export function noteActorUsed(actorId: string): void {
  untrack(() => {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    lastUsedAt.set(actorId, lastStamp);
    changed();
  });
}

/**
 * Whether an actor has a provider. BAR-F1-04 wires it to `actionBarRegistry`; unwired, every
 * actor counts as having one. It is only ever asked about actors that already passed the gate.
 */
export function setActiveActorProviderCheck(fn: (actorId: string) => boolean): void {
  untrack(() => {
    providerCheck = fn;
    changed();
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The scene this client draws — the same question, and the same answer, as the table shell's. */
function canvasScene(): SceneDocument | null {
  return resolveCanvasScene({
    activeScene: activeSceneState.scene,
    scenes: sceneListState.scenes,
    prepareSceneId: scenePrepareState.sceneId,
  });
}

function buildInput(seat: Viewer, scene: SceneDocument | null): ActiveActorInput {
  const actors = worldMirror.getByType<Record<string, unknown>>("Actor");
  const ownedActorIds = ownedActorIdsOf(actors, seat.userId);

  // Owned first: the type of an actor the user does not own is never even looked at.
  const ownedCharacters: Array<{
    actorId: string;
    lastUsedAt: number | null;
    tokenId: string | null;
  }> = [];
  for (const actor of actors) {
    const actorId = actor["_id"];
    if (typeof actorId !== "string" || !ownedActorIds.has(actorId)) continue;
    const subtype = actor["type"];
    if (typeof subtype !== "string" || !PLAYER_CHARACTER_SUBTYPES.has(subtype)) continue;
    ownedCharacters.push({
      actorId,
      lastUsedAt: lastUsedAt.get(actorId) ?? null,
      tokenId: tokenOf(scene, actorId, null),
    });
  }

  return {
    viewer: seat,
    selection: selection.map((entry) => ({
      actorId: entry.actorId,
      tokenId: tokenOf(scene, entry.actorId, entry.tokenId),
    })),
    ownedActorIds,
    ownedCharacters,
    // An actor gone from the mirror has no bar to draw.
    hasProvider: (actorId) =>
      worldMirror.getDoc("Actor", actorId) !== undefined && providerCheck(actorId),
  };
}

/**
 * The actor's token on the canvas scene: the one it was selected through while that token is
 * still there, else the first of its tokens, else `null`.
 */
function tokenOf(
  scene: SceneDocument | null,
  actorId: string,
  preferred: string | null,
): string | null {
  const tokens = scene?.tokens ?? [];
  if (preferred !== null) {
    const still = tokens.some((token) => token._id === preferred && token.actorId === actorId);
    if (still) return preferred;
  }
  return tokens.find((token) => token.actorId === actorId)?._id ?? null;
}

function sameResult(a: ActiveActorResult, b: ActiveActorResult): boolean {
  if (a.kind === "actor" && b.kind === "actor") {
    return a.actorId === b.actorId && a.tokenId === b.tokenId && a.via === b.via;
  }
  if (a.kind === "none" && b.kind === "none") return a.reason === b.reason;
  if (a.kind === "group" && b.kind === "group") {
    return sameIds(a.tokenIds, b.tokenIds) && sameIds(a.actorIds, b.actorIds);
  }
  return false;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
