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
 * A batch is all-or-nothing: every edit is judged in a pre-flight pass before
 * the first row is written (REQ-CTT-070). The window's own caller sends one
 * edit per contact when a column is cycled, so a refusal halfway through would
 * otherwise persist part of the column, skip the broadcast and still ack
 * `ok:false` — the divergence `buildDocUpdateHandler` pre-flights against.
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

    // Pre-flight: the whole batch is judged before a single row is written.
    // The write loop below persists as it goes, so a guard that fired mid-loop
    // would leave the earlier contacts written, skip the broadcast entirely and
    // still ack `ok:false` — server and clients diverging in silence until the
    // next resync (the same trap `buildDocUpdateHandler` pre-flights against).
    // This is not a hypothetical batch: `columnCycleEdits` sends one edit PER
    // CONTACT, so one stale id among them would half-write the whole column.
    const knownCharacters = new Set<string>();
    for (const edit of parsed.data.updates) {
      const missing = ensureActorExists(deps, edit.actorId);
      if (missing) return missing;

      // An exception is keyed by a character Actor's id (spec 39 §5.8). A key
      // that names nothing would sit in the map for good, unreachable from the
      // window's grid — so it is refused on the way in. Removal (`null`) is
      // always allowed: it is how a stale key is cleaned up.
      for (const [characterId, state] of Object.entries(edit.exceptions ?? {})) {
        if (state === null || knownCharacters.has(characterId)) continue;
        const invalid = notACharacter(deps, characterId);
        if (invalid) return invalid;
        knownCharacters.add(characterId);
      }
    }

    const author = { userId: ctx.userId };
    const updated: Record<string, unknown>[] = [];

    for (const edit of parsed.data.updates) {
      // Read inside the write loop, not in the pre-flight: two edits may name
      // the same contact, and the second has to plan against what the first
      // just wrote. Existence was settled above and nothing here deletes, so
      // this read cannot come up empty.
      const plan = planKnowledgeEdit(deps.store.get("actors", edit.actorId), edit);
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

/** `NOT_FOUND` if the batch names a contact the world no longer holds. */
function ensureActorExists(deps: DocHandlerDeps, actorId: string): Ack<never> | null {
  try {
    deps.store.get("actors", actorId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return ackError("NOT_FOUND", `Document not found: Actor/${actorId}`);
    }
    throw err;
  }
  return null;
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
