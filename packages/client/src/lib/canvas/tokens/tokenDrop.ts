/**
 * tokenDrop.ts — pure payload builder for the canvas actor-drop-to-token flow.
 *
 * REQ-UIF-046 [MVP]: dragging an Actor (sidebar or compendium import) onto the
 * canvas creates a Token embedded in the active Scene.
 *
 * BUG FIX: TableScreen.svelte's handleCanvasDrop used to build the doc:create
 * envelope by hand with the wrong wire keys (`embedded`/`documents` instead of
 * `parent`/`data` — DocCreatePayloadSchema in packages/shared/src/protocol.ts
 * requires `data` as an array and an optional `parent: { type, id }`) AND fired
 * it fire-and-forget via `sock.emit("op", ...)` with no ack callback, so the
 * server's VALIDATION_FAILED rejection was silently swallowed — the exact same
 * class of bug already fixed for the Actor "+Novo" button (ActorDirectory.svelte).
 *
 * This module is the single place that builds the correct payload, so it can be
 * unit-tested against DocCreatePayloadSchema.parse() directly and the client
 * can never again drift from the server's schema for this flow.
 */

import type { DocCreatePayload } from "@fusion/shared";
import {
  buildTokenFromActorFields,
  type TokenFromActorOptions,
} from "../../actors/actorDirectory.js";

/** MIME type the actor sidebar writes on dragstart. */
export const ACTOR_DRAG_MIME = "application/fusion-actor";

/** MIME type compendium entries are dragged with. */
export const COMPENDIUM_DRAG_MIME = "text/plain";

/**
 * Whether a dragover event carrying these MIME types should be accepted as a
 * canvas drop target.
 *
 * MUST be decided from `DataTransfer.types` alone. During `dragover` the drag
 * data store is in *protected mode* (HTML spec, "drag data store mode"):
 * `getData()` returns `""` no matter what `dragstart` put in it — only the
 * `types` list is readable. The real data comes back on `drop`.
 *
 * BUG FIX: handleCanvasDragOver used to call getData() and bail when it came
 * back empty, so it never called preventDefault(). Without that, the canvas is
 * not a valid drop target, the browser shows the "no drop" cursor and the
 * `drop` event NEVER fires — dragging an actor onto the map did nothing, with
 * the correct-payload code downstream sitting unreachable behind it.
 *
 * `text/plain` is deliberately loose here: any plain-text drag makes the canvas
 * accept the drop, and handleCanvasDrop then parses it and ignores it if it is
 * not a compendium payload. Accepting-then-ignoring is the safe direction —
 * the strict alternative would be to re-block real compendium drags, which is
 * the bug this fixes.
 */
export function canAcceptCanvasDrop(types: readonly string[] | undefined): boolean {
  if (!types) return false;
  return types.includes(ACTOR_DRAG_MIME) || types.includes(COMPENDIUM_DRAG_MIME);
}

/**
 * Build the `doc:create` payload for dropping an actor on the canvas.
 *
 * Wraps {@link buildTokenFromActorFields} (the existing, tested field-mapping
 * logic — name/actorId/texture/x/y snapped to the grid) into the wire shape
 * DocCreatePayloadSchema expects: `{ documentType: "Token", data: [fields],
 * parent: { type: "Scene", id: sceneId } }`.
 *
 * @param opts Same options as buildTokenFromActorFields (actor payload, scene,
 *   drop coordinates, grid size).
 * @returns A DocCreatePayload ready to pass to sendOp/makeSendOpFn.
 */
export function buildTokenDropPayload(opts: TokenFromActorOptions): DocCreatePayload {
  const fields = buildTokenFromActorFields(opts);
  return {
    documentType: "Token",
    data: [fields],
    parent: { type: "Scene", id: opts.sceneId },
  };
}
