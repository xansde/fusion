/**
 * map-note.ts - map pins ("notas") stored in `Scene.notes`.
 *
 * A pin is a point on the scene with a short title and text; the text lives in
 * the pin itself (there is no journal in this line). Persisted in the Scene's
 * `notes` array, which the Scene schema already declares (`z.array(z.unknown())`),
 * so no field is stripped on the way in.
 *
 * Visibility is the server's call: a pin reaches a player only with
 * `gmOnly: false` (fail closed, see net/redaction.ts `redactGmOnlyNotes`).
 */

import { z } from "zod";

export const MAP_NOTE_TITLE_MAX = 80;
export const MAP_NOTE_TEXT_MAX = 1000;
/** Pins kept per scene (guards the size of the Scene row). */
export const MAP_NOTES_MAX = 100;

export const MapNoteSchema = z.object({
  id: z.string().min(1).max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  title: z.string().trim().min(1).max(MAP_NOTE_TITLE_MAX),
  text: z.string().max(MAP_NOTE_TEXT_MAX).default(""),
  /** true: only the GM sees the pin. */
  gmOnly: z.boolean(),
  /** true: players may rewrite title/text of this pin (not move or hide it). */
  playersCanEdit: z.boolean().default(false),
});
export type MapNote = z.infer<typeof MapNoteSchema>;

export const NoteCreatePayloadSchema = z.object({
  sceneId: z.string().min(1),
  note: MapNoteSchema.omit({ id: true }).partial({ text: true, playersCanEdit: true }),
});
export type NoteCreatePayload = z.infer<typeof NoteCreatePayloadSchema>;

export const NoteUpdatePayloadSchema = z.object({
  sceneId: z.string().min(1),
  noteId: z.string().min(1),
  patch: MapNoteSchema.omit({ id: true }).partial(),
});
export type NoteUpdatePayload = z.infer<typeof NoteUpdatePayloadSchema>;

export const NoteDeletePayloadSchema = z.object({
  sceneId: z.string().min(1),
  noteId: z.string().min(1),
});
export type NoteDeletePayload = z.infer<typeof NoteDeletePayloadSchema>;

/** The pins of a scene body that parse as notes, in order (junk entries are skipped). */
export function parseMapNotes(raw: unknown): MapNote[] {
  if (!Array.isArray(raw)) return [];
  const out: MapNote[] = [];
  for (const item of raw as unknown[]) {
    const r = MapNoteSchema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}
