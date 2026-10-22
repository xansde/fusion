/**
 * noteUi.svelte.ts - UI state of the map pins, shared by the GM button, the canvas
 * adapter (attachNotes.ts) and the pin window (MapNotePopup.svelte).
 */

export const noteUi: {
  /** The GM is placing a pin: the next click on the map drops it. */
  placing: boolean;
  /** Where a new pin is being written (scene pixels), or null. */
  draftAt: { x: number; y: number } | null;
  /** The pin whose window is open, or null. */
  openId: string | null;
} = $state({ placing: false, draftAt: null, openId: null });

export function startPlacing(): void {
  noteUi.placing = true;
  noteUi.openId = null;
  noteUi.draftAt = null;
}

export function stopPlacing(): void {
  noteUi.placing = false;
}

/** A click on the map while placing: write the new pin there. */
export function openDraft(at: { x: number; y: number }): void {
  noteUi.draftAt = at;
  noteUi.placing = false;
  noteUi.openId = null;
}

export function openNote(id: string): void {
  noteUi.openId = id;
  noteUi.draftAt = null;
  noteUi.placing = false;
}

export function closeNoteWindow(): void {
  noteUi.openId = null;
  noteUi.draftAt = null;
}
