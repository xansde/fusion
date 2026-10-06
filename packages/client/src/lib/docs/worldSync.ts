/**
 * worldSync.ts — wire DocumentMirror + reconnect resync to the socket.
 *
 * REQ-NET-062..064: snapshot on join, delta/full on resync, boot buffering.
 *
 * Responsibilities:
 *   1. On "op" event: feed to mirror (mirror handles boot buffering).
 *      Also handles world:activeScene envelopes received on the "op" channel.
 *   2. On "connect" / reconnect: send resync:request with lastSeq.
 *      Note: socket.io reuses the same Socket instance on reconnect;
 *      the "connect" event re-fires on the same object after reconnection.
 *   3. Handle resync ack (delta or full snapshot).
 *      Also processes resync:full / resync:delta envelopes pushed proactively
 *      by the server on the "op" channel at join time (sendJoinSnapshot).
 *   4. Gap detection: when DocumentMirror fires a gap event, sends a
 *      resync:request (REQ-NET-063).
 *
 * This module is a plain TS module (no PIXI, no Svelte runes).
 * It is wired up from session.svelte.ts after a successful connect.
 */

import type { Socket } from "socket.io-client";
import type {
  Envelope,
  WorldSnapshotPayload,
  WorldActiveScenePayload,
  ResyncDeltaPayload,
  ResyncFullPayload,
  WorldResyncRequestPayload,
} from "@fusion/shared";
import { createDocumentId } from "@fusion/shared";
import { DocumentMirror } from "./DocumentMirror.js";
import { setActiveSceneId, syncActiveSceneFromMirror } from "./activeScene.svelte.js";
import { applyWorldSettingDocs } from "../settings/worldSettingsRegistry.svelte.js";

// ---------------------------------------------------------------------------
// Singleton mirror (one per app session)
// ---------------------------------------------------------------------------

export const worldMirror = new DocumentMirror();

// ---------------------------------------------------------------------------
// Wire socket events
// ---------------------------------------------------------------------------

/**
 * Apply a single canonical op envelope to the mirror and any side-effects.
 *
 * Used both for live "op" events AND for replaying ops inside resync:delta
 * payloads (both the proactive push from sendJoinSnapshot and the ack of a
 * _sendResyncRequest call).  Centralising the logic here ensures that
 * world:activeScene ops are never silently dropped during delta replay.
 *
 * REQ-NET-005: world:activeScene must update the active scene regardless of
 * whether it arrives live or as part of a delta catch-up.
 */
function _applyIncomingOp(op: Envelope): void {
  if (op.type === "world:activeScene") {
    // Advance the mirror seq first, then update the active scene state.
    worldMirror.feedOp(op);
    const payload = op.payload as WorldActiveScenePayload;
    if ("sceneId" in payload) {
      setActiveSceneId(payload.sceneId ?? null, worldMirror);
    }
    return;
  }

  worldMirror.feedOp(op);

  // If a Scene doc changed, re-derive the active scene from the mirror.
  if (op.type === "doc:create" || op.type === "doc:update" || op.type === "doc:delete") {
    const payload = op.payload as { documentType?: string; documents?: unknown };
    if (payload.documentType === "Scene") {
      syncActiveSceneFromMirror(worldMirror);
    }
    // HJ-09 (#434): a world setting changed. The Mundo registry (the GM's section, a player's Plano reading
    // `campaign.trainedSkills`) must not stay on the value fetched at mount; `Setting` is not mirrored.
    if (
      payload.documentType === "Setting" &&
      op.type !== "doc:delete" &&
      Array.isArray(payload.documents)
    ) {
      applyWorldSettingDocs(payload.documents as unknown[]);
    }
  }
}

/**
 * Attach all world-sync event handlers to the given socket.
 * Returns a cleanup function that removes all handlers.
 *
 * Call once per socket instance (re-call after reconnect is safe since
 * socket.io replaces the socket object on reconnect).
 */
export function attachWorldSync(socket: Socket): () => void {
  // ---- Handler: canonical op broadcast ----
  const onOp = (envelope: Envelope) => {
    // Handle proactive join-snapshot envelopes pushed by sendJoinSnapshot.
    // These arrive on the "op" channel at connect time: resync:full contains a
    // complete snapshot; resync:delta contains ops to replay. Processing them
    // here avoids a redundant resync:request round-trip.
    if (envelope.type === "resync:full") {
      const payload = envelope.payload as { snapshot?: WorldSnapshotPayload; reason?: string };
      if (payload.snapshot) {
        _applySnapshot(payload.snapshot);
      }
      return;
    }

    if (envelope.type === "resync:delta") {
      const payload = envelope.payload as {
        fromSeq?: number;
        toSeq?: number;
        ops?: Envelope[];
      };
      if (Array.isArray(payload.ops)) {
        // _applyIncomingOp keeps world:activeScene ops inside a delta handled (FIX-3).
        _applyDelta(payload.ops, payload.toSeq);
      }
      return;
    }

    // For all other envelope types (doc:*, world:activeScene, token:*, etc.)
    // use the unified handler.
    _applyIncomingOp(envelope);
  };

  // ---- Handler: reconnect → send resync:request ----
  // socket.io reuses the same Socket instance on reconnect;
  // the "connect" event re-fires on the same object after reconnection.
  const onConnect = () => {
    _sendResyncRequest(socket);
  };

  // ---- Handler: gap detection → trigger resync (REQ-NET-063) ----
  const offGap = worldMirror.onGap(() => {
    _sendResyncRequest(socket);
  });

  socket.on("op", onOp);
  socket.on("connect", onConnect);

  // If already connected, request sync immediately
  if (socket.connected) {
    _sendResyncRequest(socket);
  }

  return () => {
    socket.off("op", onOp);
    socket.off("connect", onConnect);
    offGap();
  };
}

// ---------------------------------------------------------------------------
// Resync request
// ---------------------------------------------------------------------------

function _sendResyncRequest(socket: Socket): void {
  const lastSeq = worldMirror.seq >= 0 ? worldMirror.seq : undefined;

  const payload: WorldResyncRequestPayload = {
    lastSeq: lastSeq ?? 0,
  };

  const reqId = createDocumentId();
  const envelope: Envelope<WorldResyncRequestPayload> = {
    type: "resync:request",
    requestId: reqId,
    ts: Date.now(),
    payload,
  };

  socket.emit(
    "op",
    envelope,
    (ack: { ok: boolean; result?: ResyncDeltaPayload | ResyncFullPayload }) => {
      if (!ack.ok) {
        console.warn("[worldSync] resync:request failed", ack);
        return;
      }

      // The server answers `{ type: "delta" | "full", payload }`; the bare payload shape is still accepted.
      const raw = ack.result as unknown as { payload?: unknown } | undefined;
      const result = (
        raw && typeof raw === "object" && raw.payload && typeof raw.payload === "object"
          ? raw.payload
          : raw
      ) as ResyncDeltaPayload | ResyncFullPayload | undefined;
      if (!result) return;

      // Discriminate between delta and full
      if ("ops" in result) {
        // ResyncDeltaPayload — replay each op through the unified handler so
        // that world:activeScene ops inside a delta are not silently dropped
        // (FIX-3).
        const delta = result;
        _applyDelta(delta.ops as Envelope[], delta.toSeq);
      } else if ("snapshot" in result) {
        // ResyncFullPayload
        const full = result;
        if (full.snapshot) {
          _applySnapshot(full.snapshot);
        }
      }
    },
  );
}

/**
 * Replay a resync delta. It lists only the ops this viewer may see, so the seq has holes the mirror must cross: each op
 * is applied as the next one, and the delta's `toSeq` closes the range.
 */
function _applyDelta(ops: Envelope[], toSeq: number | undefined): void {
  for (const op of ops) {
    if (typeof op.seq === "number") worldMirror.advanceSeqTo(op.seq - 1);
    _applyIncomingOp(op);
  }
  if (typeof toSeq === "number") worldMirror.advanceSeqTo(toSeq);
}

function _applySnapshot(snapshot: WorldSnapshotPayload): void {
  worldMirror.applySnapshot(snapshot);
  // After snapshot, re-derive active scene
  syncActiveSceneFromMirror(worldMirror);
  // The snapshot carries the active scene id (string | null, always present)
  setActiveSceneId(snapshot.activeSceneId, worldMirror);
}
