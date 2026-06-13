/**
 * M2-B Fog-of-war handlers — fog:update, fog:get, fog:reset.
 *
 * Spec: 07-visao-iluminacao-fog.md §REQ-VIS-083..087
 * Spec: 04-rede-e-sincronizacao.md §fog ops
 *
 * ## Security invariants (enforced here, not in FogStore):
 *
 *   1. **userId isolation** — the server ALWAYS uses `ctx.userId` (from the
 *      authenticated JWT) as the owner. Any userId field in the payload is
 *      ignored. A forged payload cannot read or write another user's fog.
 *
 *   2. **GM has no fog** — fog:update with ctx.role >= ASSISTANT is rejected
 *      with a no-op ok (GMs see everything; no exploration to persist).
 *
 *   3. **GM-only reset** — fog:reset requires ctx.role >= ASSISTANT. A player
 *      attempting a reset receives PERMISSION_DENIED.
 *
 *   4. **Size enforcement** — fog:update payload is validated by FogStore.upsert
 *      against MAX_FOG_PAYLOAD_BYTES. Oversized payloads get a clear error.
 *
 * ## Broadcast:
 *
 *   - fog:update   — no broadcast (fog is per-user; other clients don't care).
 *   - fog:get      — no broadcast (response via ack only).
 *   - fog:reset    — broadcasts fog:wasReset to each affected user's socket room
 *     (`user:<userId>`). This ensures the client discards its local uncommitted
 *     state (REQ-VIS-087, research 04 §4.5, issues #8122 #7613).
 *
 * ## Envelope channel:
 *   fog:update / fog:reset → "op" event (mutating)
 *   fog:get                → "query" event (read-only, responds via ack)
 *   fog:wasReset           → server-emitted on "op" channel to affected rooms
 */

import type { Namespace } from "socket.io";
import type { HandlerFn, HandlerContext } from "../handler-registry.js";
import type { FogStore } from "../../fog/fog-store.js";
import { FogPayloadTooLargeError, FogShapeValidationError } from "../../fog/fog-store.js";
import { isRolePrivileged } from "../../documents/ownership.js";
import { FogUpdatePayloadSchema, FogGetPayloadSchema, FogResetPayloadSchema } from "@fusion/shared";
import type { Ack, FogWasResetPayload } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Handler dependencies
// ---------------------------------------------------------------------------

export interface FogHandlerDeps {
  fogStore: FogStore;
  ns: Namespace;
}

// ---------------------------------------------------------------------------
// Ack helpers
// ---------------------------------------------------------------------------

function ackOk<R>(result: R): Ack<R> {
  // Fog handlers do NOT allocate a seq number — fog is not part of the
  // authoritative op stream (no resync, no op-buffer). seq is omitted.
  return { ok: true, seq: 0, result };
}

function ackError(code: string, message: string): Ack<never> {
  return { ok: false, code: code as never, message };
}

// ---------------------------------------------------------------------------
// fog:update — client sends its accumulated FogShapeData to persist
//
// REQ-VIS-083: throttled persistence; server is storage-only.
// Isolation: payload.sceneId is used, but userId always comes from ctx.
// GM/ASSISTANT: no-op ok (GMs see everything; no fog to store).
// ---------------------------------------------------------------------------

export function buildFogUpdateHandler(deps: FogHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    // GMs have no fog (D8 — GM sees everything)
    if (isRolePrivileged(ctx.role)) {
      return ackOk({ stored: false, reason: "gm_no_fog" });
    }

    const parsed = FogUpdatePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }

    const { sceneId, shape } = parsed.data;

    try {
      // Always write to ctx.userId — payload cannot override this
      deps.fogStore.upsert(ctx.userId, sceneId, shape);
    } catch (err) {
      if (err instanceof FogPayloadTooLargeError) {
        return ackError(
          "PAYLOAD_TOO_LARGE",
          `Fog shape exceeds size limit (${String(err.bytes)} bytes, limit ${String(err.limit)} bytes). ` +
            "Simplify before sending.",
        );
      }
      if (err instanceof FogShapeValidationError) {
        return ackError("VALIDATION_FAILED", err.message);
      }
      throw err;
    }

    return ackOk({ stored: true });
  };
}

// ---------------------------------------------------------------------------
// fog:get — client requests its stored exploration on scene load
//
// REQ-VIS-084: load persisted exploration on scene open.
// Isolation: response contains only ctx.userId's data.
// ---------------------------------------------------------------------------

export function buildFogGetHandler(deps: FogHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    // GMs have no fog (D8)
    if (isRolePrivileged(ctx.role)) {
      return ackOk({ sceneId: extractSceneId(rawPayload), shape: null });
    }

    const parsed = FogGetPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }

    const { sceneId } = parsed.data;

    // Always read ctx.userId's fog — no cross-user access possible
    const result = deps.fogStore.get(ctx.userId, sceneId);

    return ackOk({ sceneId, shape: result.shape });
  };
}

// ---------------------------------------------------------------------------
// fog:reset — GM clears exploration for all users or a specific user
//
// REQ-VIS-086/087: reset must persist AND broadcast to clients so they
// discard any uncommitted local state.
//
// Broadcast: fog:wasReset is emitted to:
//   - "all": every affected user's socket room (user:<userId>)
//   - { userId }: only that user's room
//
// Security: only GM/ASSISTANT can reset. Player → PERMISSION_DENIED.
// ---------------------------------------------------------------------------

export function buildFogResetHandler(deps: FogHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    // Only GM/ASSISTANT can reset fog (REQ-VIS-086)
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can reset fog of war");
    }

    const parsed = FogResetPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }

    const { sceneId, target } = parsed.data;

    let affectedUserIds: string[];

    if (target === "all") {
      const result = deps.fogStore.resetAll(sceneId);
      affectedUserIds = result.affectedUserIds;
    } else {
      const result = deps.fogStore.resetOne(target.userId, sceneId);
      affectedUserIds = result.affectedUserIds;
    }

    // Broadcast fog:wasReset to each affected user's room.
    // Even if affectedUserIds is empty (fog was already clean), we still
    // broadcast to the targeted room so clients with uncommitted local state
    // discard it (REQ-VIS-087).
    const broadcastTarget =
      target === "all"
        ? affectedUserIds // broadcast to each affected user individually
        : [typeof target === "object" && "userId" in target ? target.userId : ""];

    // Determine the set of rooms to notify
    const roomsToNotify = new Set<string>();
    if (target === "all") {
      // Notify all currently-known affected users
      for (const uid of affectedUserIds) {
        roomsToNotify.add(`user:${uid}`);
      }
    } else if (typeof target === "object" && "userId" in target) {
      // Always notify the targeted user, even if they had no stored fog
      // (so they discard uncommitted local state — REQ-VIS-087)
      roomsToNotify.add(`user:${target.userId}`);
    }

    const wasResetPayload: FogWasResetPayload = { sceneId, target };

    for (const room of roomsToNotify) {
      deps.ns.to(room).emit("op", {
        type: "fog:wasReset",
        ts: Date.now(),
        payload: wasResetPayload,
      });
    }

    // Return the list of affected users so the caller can confirm
    void broadcastTarget; // used above via roomsToNotify
    return ackOk({ sceneId, target, affectedUserIds });
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Safely extract sceneId from an unknown payload for error responses. */
function extractSceneId(raw: unknown): string {
  if (raw && typeof raw === "object" && "sceneId" in raw && typeof raw.sceneId === "string") {
    return raw.sceneId;
  }
  return "";
}
