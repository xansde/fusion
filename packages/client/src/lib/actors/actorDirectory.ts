/**
 * actorDirectory.ts — what survived the burial of the legacy Actors directory (G078).
 *
 * REQ-UIF-044..046 (drag & drop of an actor onto the canvas).
 *
 * The panel this module was written for is gone: spec 39 took the player-facing
 * list (Contatos), spec 42 took the authoring of non-playables (NPCs), and the old
 * directory panel was deleted with them. What is left here is the ONE piece both
 * of those tabs still consume, and nothing else:
 *
 *   - `buildActorDragPayload` — the payload an actor row puts on a drag, read by
 *     `TableScreen.handleCanvasDrop` (Contatos uses it; the NPCs row builds the
 *     same shape through `lib/npcs/moveActor.ts`, deliberately the same MIME).
 *   - `buildTokenFromActorFields` — the pure transformation from that payload to
 *     the presence created on the scene.
 *
 * The list/filter/group half (the builder that returned the grouped list, and the
 * shapes it returned) went with the panel: ownership filtering is now
 * `lib/contacts/contactsVM.ts`, and folder grouping is `lib/npcs/folderTree.ts`.
 * Keeping a second, unused answer for either would be the exact duplication those
 * two specs removed.
 *
 * This module is a pure TS module (no DOM/Svelte) for Vitest testability.
 */

import type { BaseDocument } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Actor document type (minimal — full schema is in the system packages)
// ---------------------------------------------------------------------------

/**
 * Minimal Actor document as stored in the DocumentMirror.
 * The full `system` blob is system-specific; we only need the base fields here.
 */
export interface ActorDocument extends BaseDocument {
  name: string;
  type: string;
  img?: string | null;
  folder?: string | null;
  system?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// DragPayload for actor drag-to-canvas (REQ-UIF-044)
// ---------------------------------------------------------------------------

/**
 * Payload carried during drag of an Actor from the sidebar.
 * Consumed by the canvas drop handler to create a Token linked to the actor.
 */
export interface ActorDragPayload {
  /** Discriminator — allows drop zones to identify this as an actor drag. */
  readonly kind: "actor";
  /** UUID of the Actor document (nanoid 16-char _id). */
  readonly uuid: string;
  /** documentType always "Actor". */
  readonly documentType: "Actor";
  /** Actor subtype (e.g. "character", "npc"). */
  readonly subtype: string;
  /** Display name (for drag ghost / tooltip). */
  readonly name: string;
  /** Image path (for drag ghost). */
  readonly img: string | null;
  /** Drag origin. */
  readonly origin: "sidebar";
}

/**
 * Build a DragPayload for an actor.
 * Called when the user starts dragging an actor row in the sidebar.
 */
export function buildActorDragPayload(actor: ActorDocument): ActorDragPayload {
  return {
    kind: "actor",
    uuid: actor._id,
    documentType: "Actor",
    subtype: actor.type,
    name: actor.name,
    img: actor.img ?? null,
    origin: "sidebar",
  };
}

// ---------------------------------------------------------------------------
// Token creation op builder (for drag-to-canvas)
// ---------------------------------------------------------------------------

/**
 * Options for building a token-creation op when an actor is dropped on the canvas.
 */
export interface TokenFromActorOptions {
  /** The actor drag payload from the sidebar drag. */
  payload: ActorDragPayload;
  /** Scene ID where the token should be created. */
  sceneId: string;
  /** Canvas coordinates (scene pixel space) where the drop occurred. */
  x: number;
  y: number;
  /** Grid cell size in pixels (for snapping). */
  gridSize: number;
  /** Whether to snap to grid. Default true. */
  snapToGrid?: boolean;
}

/**
 * Token fields to set on doc:create (embedded Token in Scene).
 * Partial — the server fills defaults for unlisted fields.
 */
export interface TokenCreateFields {
  name: string;
  actorId: string;
  texture: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Build the token creation op payload for dropping an actor on the canvas.
 *
 * Returns the `diff` object to embed in a `doc:create` op with
 * `embedded.type = "Token"` and `embedded.sceneId = <sceneId>`.
 *
 * The actual op is emitted by the canvas drop handler; this function
 * provides the pure data transformation that can be unit-tested.
 */
export function buildTokenFromActorFields(opts: TokenFromActorOptions): TokenCreateFields {
  const snap = opts.snapToGrid !== false;
  const gs = opts.gridSize;

  let x = opts.x;
  let y = opts.y;

  if (snap && gs > 0) {
    x = Math.round(x / gs) * gs;
    y = Math.round(y / gs) * gs;
  }

  return {
    name: opts.payload.name,
    actorId: opts.payload.uuid,
    texture: opts.payload.img,
    x,
    y,
    width: 1,
    height: 1,
  };
}
