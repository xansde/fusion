/**
 * preyMarks.ts — the Prey (`TokenMark` slug `hunted-prey`) as the canvas draws it (BHR-F3-07).
 *
 * Pure: no PIXI, no Svelte, no mirror. The marks live in
 * `Actor.flags.fusion.tokenMarks` (BHR-F3-06) and reach the client through the
 * normal Actor `doc:update` broadcast, ALREADY redacted by the server — a mark on
 * a token hidden from a player never arrives. {@link collectPreyMarks} repeats
 * that cut on the client (a `hidden` flip can land before the mark is rewritten),
 * so the seal is never drawn on a token the viewer is not meant to see.
 *
 * REQ-BHR-091, REQ-CNV-105, REQ-TOK-115.
 */

import { HUNTED_PREY_MARK_SLUG, readTokenMarks } from "@fusion/shared";
import { displayName } from "../docs/displayName.js";

export interface PreyActorLike {
  _id: string;
  name?: string;
  flags?: Record<string, unknown> | null;
}

export interface PreySceneLike {
  _id: string;
  tokens?: ReadonlyArray<{
    _id: string;
    actorId?: string;
    hidden?: boolean;
    seenBy?: readonly string[];
  }>;
}

export interface PreyMarkSources {
  actors: readonly PreyActorLike[];
  scenes: readonly PreySceneLike[];
  /** GM / assistant: sees hidden tokens (and therefore their marks). */
  viewerIsPrivileged: boolean;
  viewerUserId: string;
}

/** One seal to draw: which token, and whose Prey it is. */
export interface PreyMarkView {
  tokenId: string;
  slug: string;
  sourceActorId: string;
  /** Display name of the actor that marked — feeds the "Presa de <nome>" tooltip. */
  sourceName: string;
}

function isHiddenFrom(
  token: { hidden?: boolean; seenBy?: readonly string[] },
  viewerUserId: string,
): boolean {
  if (token.hidden !== true) return false;
  return !(Array.isArray(token.seenBy) && token.seenBy.includes(viewerUserId));
}

export function collectPreyMarks(sources: PreyMarkSources): PreyMarkView[] {
  const tokens = new Map<string, { hidden?: boolean; seenBy?: readonly string[] }>();
  for (const scene of sources.scenes) {
    for (const token of scene.tokens ?? []) tokens.set(token._id, token);
  }

  const out: PreyMarkView[] = [];
  for (const actor of sources.actors) {
    for (const mark of readTokenMarks(actor)) {
      if (mark.slug !== HUNTED_PREY_MARK_SLUG) continue;
      const token = tokens.get(mark.targetTokenId);
      if (token === undefined) continue;
      if (!sources.viewerIsPrivileged && isHiddenFrom(token, sources.viewerUserId)) continue;
      out.push({
        tokenId: mark.targetTokenId,
        slug: mark.slug,
        sourceActorId: actor._id,
        sourceName: displayName(actor),
      });
    }
  }
  return out;
}
