/**
 * Map pin handlers - scene:noteCreate / scene:noteUpdate / scene:noteDelete.
 *
 * A pin is a point on the scene with a title and a short text, stored in the
 * Scene's own `notes` array (shared/map-note.ts). Dedicated ops, not the generic
 * doc:update, because the permission model is per pin:
 *
 *   - the GM (privileged role) creates, moves, edits, hides (`gmOnly`) and deletes;
 *   - a player may rewrite title/text of a VISIBLE pin the GM flagged
 *     `playersCanEdit` - nothing else (not position, not the flags, not delete);
 *   - a GM-only pin answers a player exactly like a pin that does not exist.
 *
 * Visibility on the wire is not decided here: the scene broadcast, the join
 * snapshot, the resync and the acks all go through net/redaction.ts
 * (`redactGmOnlyNotes`), so a pin the GM hid never leaves the server.
 */

import type { Namespace } from "socket.io";
import type { HandlerFn } from "../handler-registry.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import type { DocumentStore } from "../../documents/store.js";
import { DocumentNotFoundError } from "../../documents/store.js";
import { isRolePrivileged } from "../../documents/ownership.js";
import {
  MapNoteSchema,
  NoteCreatePayloadSchema,
  NoteUpdatePayloadSchema,
  NoteDeletePayloadSchema,
  MAP_NOTES_MAX,
  createDocumentId,
  type Ack,
  type Envelope,
  type MapNote,
} from "@fusion/shared";
import { broadcastToWorld } from "./doc-handlers.js";
import { sceneIsInvisibleToRole } from "../redaction.js";

export interface NoteHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
}

function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}

function ackError(code: string, message: string): Ack<never> {
  return { ok: false, code: code as never, message };
}

const NOTE_NOT_FOUND = "Note not found";

/** Load a scene for an op that took its id from the client (off-air reads as not found). */
function loadScene(
  store: DocumentStore,
  sceneId: string,
  role: number,
): { scene: Record<string, unknown> } | { err: Ack<never> } {
  const notFound = { err: ackError("NOT_FOUND", `Scene not found: ${sceneId}`) };
  try {
    const scene = store.get("scenes", sceneId);
    if (sceneIsInvisibleToRole(role, scene)) return notFound;
    return { scene };
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return notFound;
    throw err;
  }
}

/** The pins of a scene body that are well formed; junk entries are kept out of the rewrite. */
function notesOf(scene: Record<string, unknown>): MapNote[] {
  const raw = scene["notes"];
  if (!Array.isArray(raw)) return [];
  const out: MapNote[] = [];
  for (const item of raw as unknown[]) {
    const r = MapNoteSchema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** Persist the new pin list, broadcast the scene (redacted per socket) and ack. */
function persist(
  deps: NoteHandlerDeps,
  sceneId: string,
  userId: string,
  notes: MapNote[],
  result: Record<string, unknown>,
): Ack<unknown> {
  const updated = deps.store.update("scenes", sceneId, { notes }, { userId });
  if (!updated) return ackOk(result, deps.seqStore.peek());
  const seq = deps.seqStore.next();
  const envelope: Envelope = {
    type: "doc:update",
    seq,
    ts: Date.now(),
    payload: { documentType: "Scene", documents: [updated] },
  };
  deps.opBuffer.push(envelope);
  broadcastToWorld(deps.ns, envelope, "Scene");
  return ackOk(result, seq);
}

export function buildNoteCreateHandler(deps: NoteHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can place map pins");
    }
    const parsed = NoteCreatePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { sceneId, note } = parsed.data;

    const loaded = loadScene(deps.store, sceneId, ctx.role);
    if ("err" in loaded) return loaded.err;

    const notes = notesOf(loaded.scene);
    if (notes.length >= MAP_NOTES_MAX) {
      return ackError("VALIDATION_FAILED", `At most ${String(MAP_NOTES_MAX)} pins per scene`);
    }
    const built = MapNoteSchema.safeParse({ ...note, id: createDocumentId() });
    if (!built.success) return ackError("VALIDATION_FAILED", built.error.message);

    return persist(deps, sceneId, ctx.userId, [...notes, built.data], {
      sceneId,
      note: built.data,
    });
  };
}

export function buildNoteUpdateHandler(deps: NoteHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = NoteUpdatePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { sceneId, noteId, patch } = parsed.data;

    const loaded = loadScene(deps.store, sceneId, ctx.role);
    if ("err" in loaded) return loaded.err;

    const notes = notesOf(loaded.scene);
    const idx = notes.findIndex((n) => n.id === noteId);
    const current = notes[idx];
    if (!current) return ackError("NOT_FOUND", NOTE_NOT_FOUND);

    const privileged = isRolePrivileged(ctx.role);
    if (!privileged) {
      // A pin the GM hid answers like a pin that is not there.
      if (current.gmOnly) return ackError("NOT_FOUND", NOTE_NOT_FOUND);
      if (!current.playersCanEdit) {
        return ackError("PERMISSION_DENIED", "The GM did not allow players to edit this pin");
      }
      const extra = Object.keys(patch).filter((k) => k !== "title" && k !== "text");
      if (extra.length > 0) {
        return ackError("PERMISSION_DENIED", "Players may only change a pin's title and text");
      }
    }

    const merged = MapNoteSchema.safeParse({ ...current, ...patch, id: current.id });
    if (!merged.success) return ackError("VALIDATION_FAILED", merged.error.message);

    const next = [...notes];
    next[idx] = merged.data;
    return persist(deps, sceneId, ctx.userId, next, { sceneId, note: merged.data });
  };
}

export function buildNoteDeleteHandler(deps: NoteHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can delete map pins");
    }
    const parsed = NoteDeletePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { sceneId, noteId } = parsed.data;

    const loaded = loadScene(deps.store, sceneId, ctx.role);
    if ("err" in loaded) return loaded.err;

    const notes = notesOf(loaded.scene);
    if (!notes.some((n) => n.id === noteId)) return ackError("NOT_FOUND", NOTE_NOT_FOUND);

    return persist(
      deps,
      sceneId,
      ctx.userId,
      notes.filter((n) => n.id !== noteId),
      { sceneId, noteId },
    );
  };
}
