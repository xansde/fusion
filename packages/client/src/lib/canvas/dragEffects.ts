/**
 * dragEffects.ts — the drag OPERATION the canvas drop zone and its drag sources
 * have to agree on (REQ-UIF-044/045/046, REQ-NPC-063).
 *
 * HTML5 drag-and-drop negotiates an operation, not only a payload. The source
 * declares which operations it allows in `dataTransfer.effectAllowed` at
 * `dragstart`; the zone asks for one of them in `dataTransfer.dropEffect` at
 * `dragover`. When the asked-for effect is outside what the source allowed, the
 * browser sets the current drag operation to "none" and REFUSES TO FIRE `drop`
 * — even though the zone called `preventDefault()` and the payload was sitting
 * in `dataTransfer.types` the whole time. No handler of ours runs and nothing
 * reports an error: the gesture just ends in `dragend` with
 * `dropEffect === "none"`.
 *
 * That is what broke dragging an NPC row onto the map (TK042a): the row declared
 * `effectAllowed = "move"` (it also drags into folders, where moving is the
 * right verb) while the canvas asked for `dropEffect = "copy"` (dropping an
 * actor on the map copies it into a token — the NPC stays in the list). Two
 * halves that each look right, one impossible operation. A source that feeds
 * both destinations has to allow both.
 *
 * The values below are that agreement, in one place, and `allowsDropEffect` is
 * the browser's rule written down so a test can exercise it directly instead of
 * only through a component — the same shape as `canvasDragTypes.ts`, which
 * exists because the previous defect in this same gesture was likewise
 * invisible from either side alone.
 */

/** What a drop zone may ask for on `dragover` (`dataTransfer.dropEffect`). */
export type DropEffect = "none" | "copy" | "link" | "move";

/** What a drag source may allow on `dragstart` (`dataTransfer.effectAllowed`). */
export type EffectAllowed =
  | "none"
  | "copy"
  | "copyLink"
  | "copyMove"
  | "link"
  | "linkMove"
  | "move"
  | "all"
  | "uninitialized";

const ALL_OPERATIONS: readonly DropEffect[] = ["copy", "link", "move"];

/** The HTML spec's effectAllowed → permitted operations table. */
const PERMITTED: Readonly<Record<EffectAllowed, readonly DropEffect[]>> = {
  none: [],
  copy: ["copy"],
  copyLink: ["copy", "link"],
  copyMove: ["copy", "move"],
  link: ["link"],
  linkMove: ["link", "move"],
  move: ["move"],
  all: ALL_OPERATIONS,
  // A source that never set `effectAllowed` allows everything.
  uninitialized: ALL_OPERATIONS,
};

/**
 * True when a source declaring `effectAllowed` would let a zone complete a drop
 * asking for `dropEffect` — i.e. when the browser will actually fire `drop`.
 *
 * `dropEffect: "none"` is false on purpose: it is the browser's own way of
 * saying "this drop cannot happen", which is the failure being guarded against,
 * not a success case.
 */
export function allowsDropEffect(effectAllowed: string, dropEffect: DropEffect): boolean {
  // A value outside the spec's enum behaves like "uninitialized" — that is what a
  // browser does with it, and guessing "forbidden" here would invent a refusal.
  const permitted =
    effectAllowed in PERMITTED ? PERMITTED[effectAllowed as EffectAllowed] : ALL_OPERATIONS;
  return dropEffect !== "none" && permitted.includes(dropEffect);
}

/**
 * The canvas copies: dropping an actor on the map creates a token OF that actor
 * (REQ-NPC-063) and the actor stays wherever it was. Shared by every source that
 * targets the map — the NPCs tab, the contacts tab and the compendium browser.
 */
export const CANVAS_DROP_EFFECT: DropEffect = "copy";

/** Dropping an NPC row on a folder MOVES it (REQ-NPC-028/029). */
export const NPC_FOLDER_DROP_EFFECT: DropEffect = "move";

/**
 * An NPC row is dragged to two destinations with opposite verbs — the map
 * (copy) and a folder (move) — so it has to allow both, or the browser silently
 * refuses the one it did not declare (TK042a).
 */
export const NPC_DRAG_EFFECT_ALLOWED: EffectAllowed = "copyMove";
