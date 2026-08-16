/**
 * `actor:deletePreview` — what a delete would take with it (REQ-NPC-051).
 *
 * Spec 42 §5.7. Read-only: it persists nothing, broadcasts nothing and burns no
 * `seq`. It exists so the confirmation dialog states the consequences from the
 * same store the delete will act on, instead of counting in a client mirror that
 * is missing two of the three answers — a Scene the seat never received is not in
 * `worldMirror` (REQ-CEN-071), and knowledge never reaches a non-privileged
 * payload at all (REQ-CTT-084).
 *
 * The gate is `isRolePrivileged` and nothing else (REQ-NPC-050, REQ-GAV-034):
 * the preview names scenes and counts who knows the actor, which is exactly the
 * material redaction keeps from a player seat. Answering it to a player would
 * hand over, in a "harmless" query, what the emission funnel spends three code
 * paths withholding.
 */

import type { Ack } from "@fusion/shared";
import { ActorDeletePreviewPayloadSchema } from "@fusion/shared";
import type { HandlerFn } from "../handler-registry.js";
import { isRolePrivileged } from "../../documents/ownership.js";
import { DocumentNotFoundError } from "../../documents/store.js";
import { buildActorDeletePreview } from "../../documents/actor-deletion.js";
import { isCharacterActor, isNonPlayableActor } from "../../documents/knowledge.js";
import type { DocHandlerDeps } from "./doc-handlers.js";

function ackError(code: string, message: string): Ack<never> {
  return { ok: false, code: code as never, message };
}

export function buildActorDeletePreviewHandler(deps: DocHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can preview an actor deletion");
    }

    const parsed = ActorDeletePreviewPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { actorId } = parsed.data;

    let actor: Record<string, unknown>;
    try {
      actor = deps.store.get("actors", actorId);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", `Document not found: Actor/${actorId}`);
      }
      throw err;
    }

    // REQ-NPC-055: this tab does not delete a player character, in any seat
    // (DEC-NPC-02) — so its own query does not answer about one either. Letting
    // it answer would put a working "what falls with this character" behind a
    // gesture that has no screen anywhere (Q-NPC-06), and the first caller to
    // find the query would build that screen against a delete nobody specified.
    if (isCharacterActor(actor)) {
      return ackError(
        "VALIDATION_FAILED",
        `Actor/${actorId} is a player character — the NPCs tab does not delete characters`,
      );
    }

    // REQ-NPC-052: the preview answers ONLY about the subtypes whose delete the
    // refusal actually governs. `doc:delete` blocks an unfinished encounter for a
    // non-playable and for nothing else, so answering about a `familiar` or a
    // `loot` would let this query report `deletable: false` for a delete the
    // server would then happily perform — a confirmation promising a refusal
    // that never comes is worse than no confirmation at all. The domain of the
    // query and the domain of the guard are the same set, on purpose.
    if (!isNonPlayableActor(actor)) {
      return ackError(
        "VALIDATION_FAILED",
        `Actor/${actorId} is not a non-playable — the NPCs tab previews npc/hazard deletions only`,
      );
    }

    // A read answers on the sequence the world is already at: nothing moved, so
    // advancing `seq` would make every client replay a delta that does not exist.
    return {
      ok: true,
      seq: deps.seqStore.peek(),
      result: buildActorDeletePreview(deps.store, actor),
    };
  };
}
