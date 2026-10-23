/**
 * moveActor.test.ts — the two ways to move a non-playable (spec 42 §5.3, G071).
 *
 * REQ-NPC-028: the move exists by drag AND by an explicit control on the row.
 * REQ-NPC-029: "Sem pasta" is a valid destination of both.
 *
 * The tests are written against the behaviour a Mestre would observe — which op
 * leaves, and what the control offers — never against the shape of the module.
 * The destination list is asserted against folders written by hand in the fixture,
 * not against the tree's own output re-derived here.
 */

import { describe, expect, it } from "vitest";

import { buildFolderTree, UNFILED_FOLDER_ID } from "../folderTree.js";
import {
  NPC_DRAG_MIME,
  buildMoveActorOp,
  buildNpcDragPayload,
  moveTargetOptions,
  normalizeFolderId,
  readNpcDragPayload,
} from "../moveActor.js";

const FOLDERS = [
  { _id: "fld-aldeia", name: "Aldeia", type: "Actor", parentId: null },
  { _id: "fld-taverna", name: "Taverna", type: "Actor", parentId: "fld-aldeia" },
  { _id: "fld-bosque", name: "Bosque", type: "Actor", parentId: null },
  // A folder of another tree: it is not a place a non-playable can be sent.
  { _id: "fld-cenas", name: "Cenas", type: "Scene", parentId: null },
];

const ACTORS = [
  { _id: "act-lobo", name: "Lobo", type: "npc", folder: "fld-bosque" },
  { _id: "act-taverneiro", name: "Taverneiro", type: "npc", folder: "fld-taverna" },
  { _id: "act-armadilha", name: "Armadilha", type: "hazard", folder: null },
];

const tree = buildFolderTree(FOLDERS, ACTORS, "Actor");

describe("REQ-NPC-028: the move is one operation, whichever gesture asked for it", () => {
  it("REQ-NPC-028: moving into a folder writes that folder on the actor", () => {
    const op = buildMoveActorOp("act-lobo", "fld-bosque", "fld-taverna");

    expect(op).toEqual({
      type: "doc:update",
      payload: {
        documentType: "Actor",
        updates: [{ _id: "act-lobo", diff: { folder: "fld-taverna" } }],
      },
    });
  });

  it("REQ-NPC-028: dropping an actor on the folder it is already in sends nothing", () => {
    // RNF-NPC-04: a move that changes nothing must not rebuild the list.
    expect(buildMoveActorOp("act-lobo", "fld-bosque", "fld-bosque")).toBeNull();
    expect(buildMoveActorOp("act-armadilha", null, UNFILED_FOLDER_ID)).toBeNull();
    expect(buildMoveActorOp("act-armadilha", undefined, null)).toBeNull();
  });

  it("REQ-NPC-028: an actor without an id produces no op at all", () => {
    expect(buildMoveActorOp("", "fld-bosque", "fld-taverna")).toBeNull();
  });
});

describe('REQ-NPC-029: "Sem pasta" is a destination, on both paths', () => {
  it("REQ-NPC-029: moving to Sem pasta writes a literal null on the folder field", () => {
    const byDrag = buildMoveActorOp("act-taverneiro", "fld-taverna", UNFILED_FOLDER_ID);
    const byControl = buildMoveActorOp("act-taverneiro", "fld-taverna", null);

    // A null at the top level of the patch means "set to null" — the actor really
    // stops belonging to a folder, instead of keeping the old id.
    expect(byDrag?.payload.updates[0]?.diff).toEqual({ folder: null });
    // Both gestures build the SAME op: the sentinel and the null are one thing.
    expect(byControl).toEqual(byDrag);
  });

  it("REQ-NPC-029: every spelling of no-folder collapses to one", () => {
    expect(normalizeFolderId(UNFILED_FOLDER_ID)).toBeNull();
    expect(normalizeFolderId("")).toBeNull();
    expect(normalizeFolderId(null)).toBeNull();
    expect(normalizeFolderId(undefined)).toBeNull();
    expect(normalizeFolderId("fld-bosque")).toBe("fld-bosque");
  });

  it("REQ-NPC-029: the explicit control offers Sem pasta, and offers it last", () => {
    const options = moveTargetOptions(tree, "fld-taverna");
    const last = options[options.length - 1];

    expect(last?.unfiled).toBe(true);
    expect(last?.value).toBe(UNFILED_FOLDER_ID);
    expect(options.filter((option) => option.unfiled)).toHaveLength(1);
  });
});

describe("REQ-NPC-028: what the explicit control offers", () => {
  it("REQ-NPC-028: every folder of the actor tree is a destination, in tree order", () => {
    const options = moveTargetOptions(tree, null);

    // Written by hand from the fixture: Aldeia (root) holds Taverna; Bosque is the
    // other root; the Scene folder is not a place for a non-playable.
    expect(options.map((option) => option.value)).toEqual([
      "fld-aldeia",
      "fld-taverna",
      "fld-bosque",
      UNFILED_FOLDER_ID,
    ]);
    expect(options.map((option) => option.depth)).toEqual([0, 1, 0, 0]);
    expect(options.map((option) => option.name)).toEqual(["Aldeia", "Taverna", "Bosque", ""]);
  });

  it("REQ-NPC-028: the folder the actor sits in is marked, and it is the only one", () => {
    const inTaverna = moveTargetOptions(tree, "fld-taverna").filter((option) => option.current);
    const unfiled = moveTargetOptions(tree, null).filter((option) => option.current);

    expect(inTaverna.map((option) => option.value)).toEqual(["fld-taverna"]);
    expect(unfiled.map((option) => option.value)).toEqual([UNFILED_FOLDER_ID]);
  });

  it("REQ-NPC-028: a collapsed folder is still a destination the keyboard can pick", () => {
    // Collapsing is display state (REQ-NPC-027); the control lists the tree, not
    // the drawn rows, or the keyboard path would be weaker than the drag.
    const options = moveTargetOptions(tree, "fld-bosque");
    expect(options.some((option) => option.value === "fld-taverna")).toBe(true);
  });
});

describe("REQ-NPC-028: the drag carries the typed payload of REQ-UIF-044", () => {
  it("REQ-NPC-028: the payload names the actor being dragged, and survives a round trip", () => {
    const payload = buildNpcDragPayload({
      _id: "act-lobo",
      name: "Lobo",
      type: "npc",
      img: "lobo.webp",
      folder: "fld-bosque",
    });

    expect(payload).toEqual({
      kind: "actor",
      _id: "act-lobo",
      documentType: "Actor",
      subtype: "npc",
      name: "Lobo",
      img: "lobo.webp",
      origin: "sidebar",
    });
    expect(readNpcDragPayload(JSON.stringify(payload))).toEqual(payload);
    expect(NPC_DRAG_MIME).toBe("application/fusion-actor");
  });

  it("REQ-NPC-028: a drag that is not an actor is refused, so no folder eats it", () => {
    expect(readNpcDragPayload(null)).toBeNull();
    expect(readNpcDragPayload("")).toBeNull();
    expect(readNpcDragPayload("not json")).toBeNull();
    expect(readNpcDragPayload(JSON.stringify({ kind: "compendium-actor", uuid: "x" }))).toBeNull();
    expect(readNpcDragPayload(JSON.stringify({ kind: "actor", documentType: "Item" }))).toBeNull();
    expect(
      readNpcDragPayload(JSON.stringify({ kind: "actor", documentType: "Actor", _id: "" })),
    ).toBeNull();
  });
});
