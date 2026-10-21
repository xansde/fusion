/**
 * noteModel.ts - pure rules of the map pins on the client (the drawing and the
 * form live elsewhere). The server is the authority; these only decide what the
 * UI offers.
 */

import { parseMapNotes, type MapNote } from "@fusion/shared";

/**
 * The pins this viewer should draw. The server already withholds GM-only pins from
 * players; filtering again here means a stale or odd copy in the mirror still
 * cannot paint one.
 */
export function visibleNotes(raw: unknown, isGm: boolean): MapNote[] {
  const notes = parseMapNotes(raw);
  return isGm ? notes : notes.filter((n) => !n.gmOnly);
}

/** What the viewer may do with an open pin. */
export interface NoteAbilities {
  /** Move, hide, change the flags, delete. */
  manage: boolean;
  /** Rewrite title and text. */
  editText: boolean;
}

export function noteAbilities(note: MapNote, isGm: boolean): NoteAbilities {
  if (isGm) return { manage: true, editText: true };
  return { manage: false, editText: !note.gmOnly && note.playersCanEdit };
}

export interface NoteDraft {
  title: string;
  text: string;
  gmOnly: boolean;
  playersCanEdit: boolean;
}

export const EMPTY_DRAFT: NoteDraft = {
  title: "",
  text: "",
  gmOnly: false,
  playersCanEdit: false,
};

/** True when the draft can be sent (the server requires a non-blank title). */
export function draftIsValid(draft: NoteDraft): boolean {
  return draft.title.trim().length > 0;
}

/** Payload of `scene:noteCreate`. */
export function createPayload(
  sceneId: string,
  at: { x: number; y: number },
  draft: NoteDraft,
): { sceneId: string; note: Record<string, unknown> } {
  return {
    sceneId,
    note: {
      x: Math.round(at.x),
      y: Math.round(at.y),
      title: draft.title.trim(),
      text: draft.text,
      gmOnly: draft.gmOnly,
      playersCanEdit: draft.playersCanEdit,
    },
  };
}

/**
 * Payload of `scene:noteUpdate` carrying only what the viewer may change: a
 * player's patch holds title and text and nothing else, or the server refuses it.
 */
export function updatePayload(
  sceneId: string,
  note: MapNote,
  draft: NoteDraft,
  isGm: boolean,
): { sceneId: string; noteId: string; patch: Record<string, unknown> } {
  const patch: Record<string, unknown> = {
    title: draft.title.trim(),
    text: draft.text,
  };
  if (isGm) {
    patch["gmOnly"] = draft.gmOnly;
    patch["playersCanEdit"] = draft.playersCanEdit;
  }
  return { sceneId, noteId: note.id, patch };
}
