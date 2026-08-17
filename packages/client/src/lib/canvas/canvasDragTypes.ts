/**
 * canvasDragTypes.ts — type-only gate for the canvas drop zone (REQ-UIF-045).
 *
 * The HTML5 drag-and-drop protocol runs `dragover` in "protected mode": every
 * browser exposes `dataTransfer.types` at that point, but `dataTransfer.getData()`
 * always returns an empty string until `drop` fires — reading the payload early is
 * simply not possible, by spec, not by bug. A `dragover` handler that calls
 * `getData()` to decide whether to `event.preventDefault()` therefore never sees a
 * payload, never calls `preventDefault()`, and the browser refuses to fire `drop`
 * at all (its own rule, not this app's). This module is the fix: it answers "is
 * this drag one the canvas cares about" from `.types` alone, so `TableScreen.svelte`
 * can `preventDefault()` on `dragover` without touching `getData()` — the real
 * payload is still only read on `drop`, by `_getActorDragPayload`/
 * `_getCompendiumDragPayload`, where `getData()` is finally unlocked.
 */

import { NPC_DRAG_MIME } from "../npcs/moveActor.js";

export type DragTypesSource = Pick<DataTransfer, "types"> | null | undefined;

/** True when the drag carries an actor payload (REQ-UIF-046a: sidebar → canvas). */
export function hasActorDragType(dataTransfer: DragTypesSource): boolean {
  return dataTransfer?.types.includes(NPC_DRAG_MIME) ?? false;
}

/**
 * True when the drag carries a compendium payload (REQ-CPD-062/063). Compendium
 * drags write `text/plain` (see `CompendiumBrowser.svelte`); other, unrelated
 * `text/plain` drags (e.g. the scene-reorder drag in `ScenesTab.svelte`) also match
 * this type-only check, but that is harmless here — `decideSceneDrop` refuses
 * anything that does not parse as a compendium payload once `drop` reads it for
 * real, and a refusal that does not touch the wire is not a false accept.
 */
export function hasCompendiumDragType(dataTransfer: DragTypesSource): boolean {
  return dataTransfer?.types.includes("text/plain") ?? false;
}
