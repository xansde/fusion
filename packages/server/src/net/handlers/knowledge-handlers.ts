/**
 * `actor:setKnowledge` — the one operation that writes contact knowledge.
 *
 * Spec 39 §5.8/§5.9. Knowledge is a field of the contact's own Actor document
 * (`flags.fusion.knowledge`), but it is NOT writable through the generic
 * `doc:update` path: that path authorizes on `ownership`, and a player who
 * owns their own sheet would then be able to declare themselves known to
 * everybody. `rejectUnwritableField` in doc-handlers.ts refuses the flag path
 * outright (the same treatment `Scene.active` gets, and for the same reason),
 * which leaves this handler as the single door — and it is gated on
 * `isRolePrivileged`, never on a duplicated role comparison
 * (REQ-CTT-080, REQ-GAV-034).
 *
 * Normalization happens HERE, on the server, not on the caller's side: an
 * exception equal to the general rule is removed rather than stored
 * (REQ-CTT-072), and a state outside the three is rejected by the payload
 * schema before anything is read.
 *
 * The broadcast goes out as a `doc:update` envelope for the Actor. That is
 * deliberate: the delta then travels the same pipe — same `seq`, same
 * `OpBuffer` replay, same redaction funnel — as any other document change, so
 * every affected user sees the contact appear, change or vanish without
 * reloading the page (REQ-CTT-075), and there is no second emission path for
 * redaction to miss.
 */

import type { HandlerFn } from "../handler-registry.js";
import type { Ack, Envelope } from "@fusion/shared";
import { ActorSetKnowledgePayloadSchema } from "@fusion/shared";
import { isRolePrivileged } from "../../documents/ownership.js";
import { DocumentNotFoundError } from "../../documents/store.js";
import { planKnowledgeEdit, isCharacterActor } from "../../documents/knowledge.js";
import type { DocHandlerDeps } from "./doc-handlers.js";
import { broadcastToWorld } from "./doc-handlers.js";

function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}

function ackError(code: string, message: string): Ack<never> {
  return { ok: false, code: code as never, message };
}

export function buildActorSetKnowledgeHandler(deps: DocHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    // REQ-CTT-080: the client hiding the control is not protection. Only a
    // privileged role writes knowledge — a player who forges the op is refused
    // here, before the payload is even read.
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can change contact knowledge");
    }

    const parsed = ActorSetKnowledgePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }

    const author = { userId: ctx.userId };
    const updated: Record<string, unknown>[] = [];

    for (const edit of parsed.data.updates) {
      let existing: Record<string, unknown>;
      try {
        existing = deps.store.get("actors", edit.actorId);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          return ackError("NOT_FOUND", `Document not found: Actor/${edit.actorId}`);
        }
        throw err;
      }

      // An exception is keyed by a character Actor's id (spec 39 §5.8). A key
      // that names nothing would sit in the map for good, unreachable from the
      // window's grid — so it is refused on the way in. Removal (`null`) is
      // always allowed: it is how a stale key is cleaned up.
      for (const [characterId, state] of Object.entries(edit.exceptions ?? {})) {
        if (state === null) continue;
        const invalid = notACharacter(deps, characterId);
        if (invalid) return invalid;
      }

      const plan = planKnowledgeEdit(existing, edit);
      if (!plan) continue;

      const result = deps.store.update("actors", edit.actorId, plan.patch, author);
      if (result !== null) updated.push(result);
    }

    if (updated.length === 0) {
      // Nothing actually moved — do not burn a seq or wake every client.
      return ackOk({ documentType: "Actor", documents: [] }, deps.seqStore.peek());
    }

    const seq = deps.seqStore.next();
    const payload = { documentType: "Actor", documents: updated };
    const envelope: Envelope = { type: "doc:update", seq, ts: Date.now(), payload };
    deps.opBuffer.push(envelope);
    broadcastToWorld(deps.ns, envelope, "Actor");

    return ackOk(payload, seq);
  };
}

function notACharacter(deps: DocHandlerDeps, characterId: string): Ack<never> | null {
  let character: Record<string, unknown>;
  try {
    character = deps.store.get("actors", characterId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return ackError("VALIDATION_FAILED", `Exception names an unknown Actor: ${characterId}`);
    }
    throw err;
  }
  if (!isCharacterActor(character)) {
    return ackError(
      "VALIDATION_FAILED",
      `Exception names Actor/${characterId}, which is not a character`,
    );
  }
  return null;
}
