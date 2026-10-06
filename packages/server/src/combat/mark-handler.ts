/**
 * `mark:set` / `mark:clear` — the Prey (`TokenMark`) persisted on the marking
 * actor (BHR-F3-06, spec 52 REQ-BHR-086..090, plan §2.1).
 *
 * The mark lives in `Actor.flags.fusion.tokenMarks` of the actor that marked,
 * NOT in the `TargetingStore`: targeting is ephemeral (REQ-CBT-055 clears it at
 * the end of the targeter's turn), the Prey stays until a new Hunt Prey
 * replaces it, the owner or the GM removes it (DC-03/DC-04). It has no
 * `daily-prep` or `turnEnd` expiry.
 *
 * Permission, all decided here on the server (the client hiding a button is no
 * protection):
 *   - `mark:set`  GM/assistant (`isRolePrivileged`): any actor, any token.
 *                 Player: only an actor they OWN and only a token that is in
 *                 their OWN live TargetSelection at the moment of the set
 *                 (ALQ-F1-05) and that is not hidden from them. Anything else
 *                 is `PERMISSION_DENIED`.
 *   - `mark:clear` GM/assistant: any actor. Player: only an actor they OWN (no
 *                 live target needed — removing is never a leak).
 * The server fills `targetActorId`, `sceneId` and `createdAt` itself and forces
 * `exclusive` for the slugs that are exclusive by rule (Hunt Prey), so a client
 * cannot hoard several Preys by sending `exclusive: false`.
 *
 * Broadcast: a `doc:update` of the Actor, through `broadcastToWorld`, exactly
 * like `actor:setKnowledge` — same seq, same OpBuffer replay, same redaction
 * funnel (`stripHiddenTokenMarks` in `net/redaction.ts`): a mark on a token
 * hidden from a player never reaches that player.
 *
 * Reading: {@link getMarksOn} / {@link createTokenMarkSource} plug into the
 * `TokenMarkSource` extension point of `chat/roll-resolution.ts` (BHR-F2-05).
 */

import type { Namespace } from "socket.io";
import {
  EXCLUSIVE_MARK_SLUGS,
  MarkClearPayloadSchema,
  MarkSetPayloadSchema,
  TOKEN_MARKS_FLAG_KEY,
  TOKEN_MARKS_FLAG_NAMESPACE,
  readTokenMarks,
} from "@fusion/shared";
import type { Ack, Envelope, ErrorCode, TokenMark } from "@fusion/shared";
import type { HandlerContext, HandlerFn } from "../net/handler-registry.js";
import type { SeqStore } from "../net/seq-store.js";
import type { OpBuffer } from "../net/op-buffer.js";
import { broadcastToWorld } from "../net/handlers/doc-handlers.js";
import { tokenIsHiddenFromViewer, tokenLookupSourceFromStore } from "../net/redaction.js";
import type { DocumentStore } from "../documents/store.js";
import { DocumentNotFoundError } from "../documents/store.js";
import { OwnershipLevel, isRolePrivileged, resolveOwnership } from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";
import type { TokenMarkSource } from "../chat/roll-resolution.js";
import type { TargetingStore } from "./targeting-store.js";
import { locateToken, resolveTargetSelection } from "./target-selection.js";

export interface MarkHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
  targetingStore: TargetingStore;
}

function ackError(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, code, message };
}

function readActorOrNull(store: DocumentStore, actorId: string): Record<string, unknown> | null {
  try {
    return store.get("actors", actorId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return null;
    throw err;
  }
}

function callerOwns(actor: Record<string, unknown>, ctx: HandlerContext): boolean {
  const raw = actor["ownership"];
  const ownership: Ownership =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Ownership)
      : { default: OwnershipLevel.NONE };
  return resolveOwnership(ownership, ctx.userId, ctx.role) >= OwnershipLevel.OWNER;
}

/** Persist `next` as the actor's `tokenMarks` and broadcast the Actor delta. */
function persistAndBroadcast(
  deps: MarkHandlerDeps,
  actorId: string,
  next: readonly TokenMark[],
  ctx: HandlerContext,
): Ack<{ documentType: "Actor"; documents: Record<string, unknown>[] }> {
  const updated = deps.store.update(
    "actors",
    actorId,
    { flags: { [TOKEN_MARKS_FLAG_NAMESPACE]: { [TOKEN_MARKS_FLAG_KEY]: next } } },
    { userId: ctx.userId },
  );
  const documents = updated === null ? [] : [updated];
  const payload = { documentType: "Actor" as const, documents };
  const seq = deps.seqStore.next();
  const envelope: Envelope = { type: "doc:update", seq, ts: Date.now(), payload };
  deps.opBuffer.push(envelope);
  broadcastToWorld(deps.ns, envelope, "Actor");
  return { ok: true, seq, result: payload };
}

export function buildMarkSetHandler(deps: MarkHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = MarkSetPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { sourceActorId, mark: requested } = parsed.data;

    const actor = readActorOrNull(deps.store, sourceActorId);
    if (actor === null) return ackError("NOT_FOUND", `Document not found: Actor/${sourceActorId}`);

    const privileged = isRolePrivileged(ctx.role);
    if (!privileged) {
      if (!callerOwns(actor, ctx)) {
        return ackError("PERMISSION_DENIED", "mark:set requires OWNER of the marking actor");
      }
      const inSelection = resolveTargetSelection(deps.store, deps.targetingStore, ctx.userId).some(
        (t) => t.tokenId === requested.targetTokenId,
      );
      if (!inSelection) {
        return ackError(
          "PERMISSION_DENIED",
          "mark:set requires the token to be in your own live target selection",
        );
      }
      // A selection can name a token the GM hid afterwards: no mark on it.
      const token = tokenLookupSourceFromStore(deps.store).findToken(requested.targetTokenId);
      if (token !== undefined && tokenIsHiddenFromViewer(token, ctx.userId)) {
        return ackError("PERMISSION_DENIED", "mark:set cannot name a token hidden from you");
      }
    }

    const located = locateToken(deps.store, requested.targetTokenId);
    if (located === null || located.actorId === null) {
      return ackError(
        "VALIDATION_FAILED",
        `Token ${requested.targetTokenId} does not exist or is not bound to an actor`,
      );
    }

    const exclusive = EXCLUSIVE_MARK_SLUGS.includes(requested.slug)
      ? true
      : (requested.exclusive ?? false);
    const mark: TokenMark = {
      slug: requested.slug,
      targetTokenId: requested.targetTokenId,
      targetActorId: located.actorId,
      sceneId: located.sceneId,
      createdAt: Date.now(),
      exclusive,
    };

    // Exclusive: the new mark REPLACES every earlier one of the slug on this
    // actor (REQ-BHR-088). Otherwise only the same slug on the same token is
    // replaced, so repeating a set neither duplicates nor refuses.
    const kept = readTokenMarks(actor).filter((existing) =>
      exclusive
        ? existing.slug !== mark.slug
        : !(existing.slug === mark.slug && existing.targetTokenId === mark.targetTokenId),
    );
    return persistAndBroadcast(deps, sourceActorId, [...kept, mark], ctx);
  };
}

export function buildMarkClearHandler(deps: MarkHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = MarkClearPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { sourceActorId, slug, targetTokenId } = parsed.data;

    const actor = readActorOrNull(deps.store, sourceActorId);
    if (actor === null) return ackError("NOT_FOUND", `Document not found: Actor/${sourceActorId}`);
    if (!isRolePrivileged(ctx.role) && !callerOwns(actor, ctx)) {
      return ackError("PERMISSION_DENIED", "mark:clear requires OWNER of the marking actor");
    }

    const current = readTokenMarks(actor);
    const next = current.filter(
      (m) =>
        !(m.slug === slug && (targetTokenId === undefined || m.targetTokenId === targetTokenId)),
    );
    if (next.length === current.length) {
      // Nothing moved: do not burn a seq or wake every client.
      return {
        ok: true,
        seq: deps.seqStore.peek(),
        result: { documentType: "Actor", documents: [] },
      };
    }
    return persistAndBroadcast(deps, sourceActorId, next, ctx);
  };
}

// ---------------------------------------------------------------------------
// Reading — the roll resolver's side (REQ-BHR-090)
// ---------------------------------------------------------------------------

/**
 * Every mark, by any actor, sitting on `targetTokenId` — with the actor that
 * placed it. Scans the world's actors (marks are rare and rolls are not a hot
 * path); a mark whose token is gone simply never matches.
 */
export function getMarksOn(
  store: DocumentStore,
  targetTokenId: string,
): { sourceActorId: string; mark: TokenMark }[] {
  const found: { sourceActorId: string; mark: TokenMark }[] = [];
  for (const actor of store.getAll("actors")) {
    const id = actor["_id"];
    if (typeof id !== "string") continue;
    for (const mark of readTokenMarks(actor)) {
      if (mark.targetTokenId === targetTokenId) found.push({ sourceActorId: id, mark });
    }
  }
  return found;
}

/**
 * The real {@link TokenMarkSource} (extension point of BHR-F2-05): the slugs of
 * the marks the ROLLER placed on the roll's single target token. Looking the
 * owner up for an active companion (DC-08) belongs to the CompanionLink task.
 */
export function createTokenMarkSource(store: DocumentStore): TokenMarkSource {
  return {
    marksOn: ({ rollerActorId, targetTokenId }) =>
      getMarksOn(store, targetTokenId)
        .filter((entry) => entry.sourceActorId === rollerActorId)
        .map((entry) => entry.mark.slug),
  };
}
