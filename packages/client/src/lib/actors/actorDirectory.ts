/**
 * actorDirectory.ts — Actor directory logic for the sidebar Actors tab.
 *
 * REQ-UIF-002 (Actors tab), REQ-UIF-044..046 (drag & drop).
 *
 * Responsibilities:
 *   - Query actors from the DocumentMirror.
 *   - Filter by ownership (players see only their own; GMs see all).
 *   - Group by folder.
 *   - Filter by search query.
 *   - Build DragPayload for dragging an actor to the canvas (creates a Token).
 *
 * This module is a pure TS module (no DOM/Svelte) for Vitest testability.
 */

import type { BaseDocument, OwnershipLevel } from "@fusion/shared";
import { getUserLevel } from "@fusion/shared";

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

// ---------------------------------------------------------------------------
// Actor list filtering and grouping
// ---------------------------------------------------------------------------

/**
 * Filtered and grouped actor list for display in the sidebar.
 */
export interface ActorGroup {
  /** Folder _id or null for actors without a folder. */
  folderId: string | null;
  folderName: string;
  actors: ActorDocument[];
}

export interface ActorDirectoryState {
  /** All actor groups ordered by folder name. */
  groups: ActorGroup[];
  /** Total actor count visible to this user. */
  total: number;
}

/**
 * Filter and group actors for the sidebar directory.
 *
 * @param actors      All Actor documents from the DocumentMirror.
 * @param userId      Current user's ID.
 * @param isGm        Whether the current user is GM.
 * @param searchQuery Optional search string to filter by name.
 * @param minLevel    Minimum ownership level for non-GMs. Default OBSERVER (2).
 * @returns           Grouped and filtered actor state.
 */
export function buildActorDirectory(
  actors: ActorDocument[],
  userId: string,
  isGm: boolean,
  searchQuery = "",
  minLevel: OwnershipLevel = 2, // OBSERVER
): ActorDirectoryState {
  const q = searchQuery.trim().toLowerCase();

  // Filter by permission and search
  const visible = actors.filter((actor) => {
    if (!isGm) {
      const level = getUserLevel(actor.ownership, userId);
      if (level < minLevel) return false;
    }
    if (q && !actor.name.toLowerCase().includes(q)) return false;
    return true;
  });

  // Sort by name
  visible.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  // Group by folder
  const byFolder = new Map<string | null, ActorDocument[]>();
  for (const actor of visible) {
    const folderId = actor.folder ?? null;
    const existing = byFolder.get(folderId);
    if (existing) {
      existing.push(actor);
    } else {
      byFolder.set(folderId, [actor]);
    }
  }

  // Build groups sorted: null folder last
  const groups: ActorGroup[] = [];
  for (const [folderId, groupActors] of byFolder) {
    groups.push({
      folderId,
      folderName: folderId ?? "", // caller resolves folder name via t()
      actors: groupActors,
    });
  }

  // Sort: actors without folder last
  groups.sort((a, b) => {
    if (a.folderId === null && b.folderId !== null) return 1;
    if (a.folderId !== null && b.folderId === null) return -1;
    return a.folderName.localeCompare(b.folderName, "pt-BR");
  });

  return { groups, total: visible.length };
}
