/**
 * moveActor.ts — moving a non-playable between folders (spec 42 §5.3, G071).
 *
 * REQ-NPC-028 asks for TWO ways to move an actor — a drag onto the destination
 * folder (REQ-UIF-044) and an explicit control on the row that a keyboard can
 * reach (REQ-UIF-064) — and says both must exist. REQ-NPC-029 makes "Sem pasta" a
 * valid destination of both.
 *
 * The two gestures are different only in how the destination is picked. Everything
 * after that is one function, `buildMoveActorOp`, so the drag and the control can
 * never drift into moving an actor in two different ways:
 *
 *  - **"Sem pasta" is the absence of a folder, not a folder** (REQ-NPC-014). It has
 *    no `Folder` id to write, so it travels as the sentinel `UNFILED_FOLDER_ID`
 *    through the UI and becomes a literal `null` in the op. `normalizeFolderId`
 *    is the single place that collapses the sentinel, `""` and `undefined` into
 *    that one `null`, so "no folder" has exactly one spelling on the wire.
 *  - **A move that changes nothing emits nothing** (RNF-NPC-04). Dropping an actor
 *    on the folder it already sits in returns `null` instead of an op, so the list
 *    is not rebuilt and the scroll position is not lost for a gesture that meant
 *    nothing.
 *
 * The destination list is built from the whole tree, not from the drawn rows: a
 * collapsed folder is still a place an actor can be sent, and the control is the
 * only path for someone who cannot drag.
 */

import { UNFILED_FOLDER_ID, type FolderTree, type FolderTreeNode } from "./folderTree.js";

/**
 * The MIME the row's drag carries. Deliberately the same one the canvas already
 * reads for an actor drag: one vocabulary for "an actor is being dragged", so the
 * same gesture can end on a folder or, later, on the table.
 */
export const NPC_DRAG_MIME = "application/fusion-actor";

/**
 * The typed payload of REQ-UIF-044, as this tab writes it.
 *
 * Wire-compatible with `ActorDragPayload` (`lib/actors/actorDirectory.ts`) —
 * both carry the `"application/fusion-actor"` MIME and are parsed by the
 * same `TableScreen._getActorDragPayload` when an NPC row is dropped on the
 * canvas, not just on a folder. `_id`, not `uuid` (#170): this field only
 * ever carried `actor._id`, never a UUID.
 */
export interface NpcDragPayload {
  readonly kind: "actor";
  readonly _id: string;
  readonly documentType: "Actor";
  readonly subtype: string;
  readonly name: string;
  readonly img: string | null;
  readonly origin: "sidebar";
}

/** The fields of an actor document this module reads. */
export interface MovableActor {
  readonly _id: string;
  readonly name?: string;
  readonly type?: string;
  readonly img?: string | null;
  readonly folder?: string | null;
}

export function buildNpcDragPayload(actor: MovableActor): NpcDragPayload {
  return {
    kind: "actor",
    _id: actor._id,
    documentType: "Actor",
    subtype: actor.type ?? "npc",
    name: actor.name ?? "",
    img: actor.img ?? null,
    origin: "sidebar",
  };
}

/** Parse a drag payload back, returning null for anything that is not one. */
export function readNpcDragPayload(raw: string | null | undefined): NpcDragPayload | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (candidate["kind"] !== "actor") return null;
    if (candidate["documentType"] !== "Actor") return null;
    const id = candidate["_id"];
    if (typeof id !== "string" || id.length === 0) return null;
    return {
      kind: "actor",
      _id: id,
      documentType: "Actor",
      subtype: typeof candidate["subtype"] === "string" ? candidate["subtype"] : "npc",
      name: typeof candidate["name"] === "string" ? candidate["name"] : "",
      img: typeof candidate["img"] === "string" ? candidate["img"] : null,
      origin: "sidebar",
    };
  } catch {
    return null;
  }
}

/**
 * The one spelling of "no folder" (REQ-NPC-029): the `UNFILED_FOLDER_ID` sentinel
 * the UI hands around, the empty string a form control produces, and `undefined`
 * all collapse to the `null` the document stores.
 */
export function normalizeFolderId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0) return null;
  if (value === UNFILED_FOLDER_ID) return null;
  return value;
}

/** The `doc:update` that moves an actor; `folder: null` is "Sem pasta". */
export interface MoveActorOp {
  readonly type: "doc:update";
  readonly payload: {
    readonly documentType: "Actor";
    readonly updates: readonly { readonly _id: string; readonly diff: { folder: string | null } }[];
  };
}

/**
 * Build the op both gestures send, or `null` when there is nothing to send.
 *
 * `folder` is a top-level field, where a `null` in a patch means "set to null"
 * rather than "delete the key" (`documents/merge.ts`), so "Sem pasta" is written,
 * not merely omitted.
 */
export function buildMoveActorOp(
  actorId: string,
  currentFolderId: string | null | undefined,
  targetFolderId: string | null | undefined,
): MoveActorOp | null {
  if (typeof actorId !== "string" || actorId.length === 0) return null;
  const from = normalizeFolderId(currentFolderId);
  const to = normalizeFolderId(targetFolderId);
  if (from === to) return null;
  return {
    type: "doc:update",
    payload: { documentType: "Actor", updates: [{ _id: actorId, diff: { folder: to } }] },
  };
}

/** One destination offered by the explicit control on the row (REQ-NPC-028). */
export interface MoveTargetOption {
  /** The `Folder` id, or `UNFILED_FOLDER_ID` for "Sem pasta" (REQ-NPC-029). */
  readonly value: string;
  /** The folder's name; empty for "Sem pasta", whose label is the tab's own. */
  readonly name: string;
  /** Nesting depth, so the control can show where the folder sits. */
  readonly depth: number;
  /** True for the folder the actor is in right now. */
  readonly current: boolean;
  /** True for the "Sem pasta" entry, which names no document. */
  readonly unfiled: boolean;
}

/**
 * Every place an actor can be sent, in the tree's own order, with "Sem pasta"
 * last — the same position it holds in the panel (REQ-NPC-014), so the control
 * and the tree do not teach two different orders.
 *
 * Collapsed folders are included on purpose: recolhido is a display state
 * (REQ-NPC-027), and hiding a destination because a row is folded would make the
 * keyboard path weaker than the drag it exists to replace.
 */
export function moveTargetOptions(
  tree: FolderTree,
  currentFolderId: string | null | undefined,
): MoveTargetOption[] {
  const current = normalizeFolderId(currentFolderId);
  const options: MoveTargetOption[] = [];

  const walk = (branch: readonly FolderTreeNode[]): void => {
    for (const node of branch) {
      options.push({
        value: node.id,
        name: node.name,
        depth: node.depth,
        current: node.id === current,
        unfiled: false,
      });
      walk(node.children);
    }
  };
  walk(tree.roots);

  options.push({
    value: UNFILED_FOLDER_ID,
    name: "",
    depth: 0,
    current: current === null,
    unfiled: true,
  });
  return options;
}
