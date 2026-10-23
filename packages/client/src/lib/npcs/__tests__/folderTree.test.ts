/**
 * folderTree.test.ts — the folder tree of the NPCs tab (spec 42 §5.3, G070).
 *
 * Covers REQ-NPC-020 (a real tree, nested by `parentId`), REQ-NPC-023 (the pinned
 * block, outside the folder's place in the tree, carrying the mother's path),
 * REQ-NPC-024 (unpinning restores the natural ordering, and no previous position
 * is kept), REQ-NPC-026 (the count is the whole subtree) and REQ-NPC-014 ("Sem
 * pasta", always last, not a folder).
 *
 * The expected halves are written by hand here, never derived from the same
 * function under test: comparing `buildFolderTree` against itself would pass for
 * any nesting at all.
 */

import { describe, expect, it } from "vitest";

import {
  buildFolderTree,
  docsOfFolder,
  flattenTree,
  folderPath,
  isNonPlayableActor,
  pinnedFolders,
  wouldCreateCycle,
  UNFILED_FOLDER_ID,
  type FolderLike,
  type FolderedDoc,
} from "../folderTree.js";

// ---------------------------------------------------------------------------
// Fixtures — a two-level tree with a sibling, plus one scene folder that must
// not take part, written out by hand.
// ---------------------------------------------------------------------------

const FOLDERS: FolderLike[] = [
  { _id: "fld-bosque", name: "Bosque", type: "Actor", parentId: null },
  { _id: "fld-aldeia", name: "Aldeia", type: "Actor", parentId: null },
  { _id: "fld-taverna", name: "Taverna", type: "Actor", parentId: "fld-aldeia" },
  { _id: "fld-porao", name: "Porão", type: "Actor", parentId: "fld-taverna" },
  // Another tree entirely: the world's folders table holds every type.
  { _id: "fld-mapas", name: "Mapas", type: "Scene", parentId: null },
];

const ACTORS: FolderedDoc[] = [
  { _id: "act-lobo", name: "Lobo", type: "npc", folder: "fld-bosque" },
  { _id: "act-urso", name: "Urso", type: "npc", folder: "fld-bosque" },
  { _id: "act-taverneiro", name: "Taverneiro", type: "npc", folder: "fld-taverna" },
  { _id: "act-rato", name: "Rato", type: "npc", folder: "fld-porao" },
  { _id: "act-armadilha", name: "Armadilha", type: "hazard", folder: null },
  { _id: "act-orfao", name: "Órfão", type: "npc", folder: "fld-que-nao-existe" },
];

function names(nodes: readonly { name: string }[]): string[] {
  return nodes.map((node) => node.name);
}

describe("REQ-NPC-020: the panel draws a real folder tree, nested by parentId", () => {
  it("REQ-NPC-020: nests by parentId and keeps another type's folders out", () => {
    const tree = buildFolderTree(FOLDERS, ACTORS, "Actor");

    expect(names(tree.roots)).toEqual(["Aldeia", "Bosque"]);
    expect(names(tree.roots[0]!.children)).toEqual(["Taverna"]);
    expect(names(tree.roots[0]!.children[0]!.children)).toEqual(["Porão"]);
    // The Scene folder belongs to another tab's tree entirely.
    expect(tree.byId.has("fld-mapas")).toBe(false);
  });

  it("REQ-NPC-020: a folder whose parent does not exist is drawn as a root, not dropped", () => {
    const orphaned: FolderLike[] = [
      { _id: "fld-a", name: "Solta", type: "Actor", parentId: "fld-que-sumiu" },
    ];
    const tree = buildFolderTree(orphaned, [], "Actor");

    expect(names(tree.roots)).toEqual(["Solta"]);
  });

  it("REQ-NPC-020: a parent chain that loops does not hang and does not hide a folder", () => {
    const cyclic: FolderLike[] = [
      { _id: "fld-a", name: "A", type: "Actor", parentId: "fld-b" },
      { _id: "fld-b", name: "B", type: "Actor", parentId: "fld-a" },
    ];
    const tree = buildFolderTree(cyclic, [], "Actor");

    expect(names(tree.roots).sort()).toEqual(["A", "B"]);
  });

  it("REQ-NPC-020: a move that would make a folder its own ancestor is detectable", () => {
    const tree = buildFolderTree(FOLDERS, ACTORS, "Actor");

    expect(wouldCreateCycle(tree, "fld-aldeia", "fld-porao")).toBe(true);
    expect(wouldCreateCycle(tree, "fld-aldeia", "fld-aldeia")).toBe(true);
    expect(wouldCreateCycle(tree, "fld-aldeia", "fld-bosque")).toBe(false);
    expect(wouldCreateCycle(tree, "fld-aldeia", null)).toBe(false);
  });
});

describe("REQ-NPC-026: the count of a folder is its whole subtree", () => {
  it("REQ-NPC-026: Aldeia counts Taverna and Porão, not only what sits in it", () => {
    const tree = buildFolderTree(FOLDERS, ACTORS, "Actor");
    const aldeia = tree.byId.get("fld-aldeia")!;
    const taverna = tree.byId.get("fld-taverna")!;
    const porao = tree.byId.get("fld-porao")!;

    // Written by hand from the fixture: Taverneiro (Taverna) + Rato (Porão).
    expect(aldeia.ownCount).toBe(0);
    expect(aldeia.subtreeCount).toBe(2);
    expect(taverna.subtreeCount).toBe(2);
    expect(porao.subtreeCount).toBe(1);
    expect(tree.byId.get("fld-bosque")!.subtreeCount).toBe(2);
  });

  it("REQ-NPC-026: only npc and hazard are counted — a player's character is not this tab's", () => {
    const withCharacter: FolderedDoc[] = [
      ...ACTORS,
      { _id: "act-pc", name: "Fofurinha", type: "character", folder: "fld-bosque" },
    ];
    const npcsOnly = withCharacter.filter(isNonPlayableActor);
    const tree = buildFolderTree(FOLDERS, npcsOnly, "Actor");

    expect(tree.byId.get("fld-bosque")!.subtreeCount).toBe(2);
    expect(npcsOnly.some((doc) => doc._id === "act-pc")).toBe(false);
  });
});

describe('REQ-NPC-014: "Sem pasta" holds what belongs to no folder', () => {
  it("REQ-NPC-014: an actor with no folder, and one naming a folder that vanished, land there", () => {
    const tree = buildFolderTree(FOLDERS, ACTORS, "Actor");

    expect(names(tree.unfiled as { name: string }[])).toEqual(["Armadilha", "Órfão"]);
    // It is not a folder: no id of the tree matches the group's own marker.
    expect(tree.byId.has(UNFILED_FOLDER_ID)).toBe(false);
  });

  it("REQ-NPC-013: rows inside a folder come out in pt-BR alphabetical order", () => {
    expect(names(docsOfFolder(ACTORS, "fld-bosque") as { name: string }[])).toEqual([
      "Lobo",
      "Urso",
    ]);
    expect(docsOfFolder(ACTORS, "fld-porao").map((doc) => doc._id)).toEqual(["act-rato"]);
  });
});

describe("REQ-NPC-023 / REQ-NPC-024: pinning is a view, and unpinning restores nothing", () => {
  it("REQ-NPC-023: a pinned folder gets a block entry with the mother's path", () => {
    const tree = buildFolderTree(FOLDERS, ACTORS, "Actor");
    const block = pinnedFolders(tree, new Set(["fld-porao", "fld-bosque"]));

    expect(block.map((entry) => entry.node.name)).toEqual(["Bosque", "Porão"]);
    expect(block.find((entry) => entry.node.id === "fld-porao")!.parentPath).toEqual([
      "Aldeia",
      "Taverna",
    ]);
    // A root folder has no path to show.
    expect(block.find((entry) => entry.node.id === "fld-bosque")!.parentPath).toEqual([]);
    expect(folderPath(tree, "fld-taverna")).toEqual(["Aldeia"]);
  });

  it("REQ-NPC-023: a pinned folder leaves its place in the tree — the whole subtree goes with it", () => {
    const tree = buildFolderTree(FOLDERS, ACTORS, "Actor");
    const pinned = new Set(["fld-taverna"]);
    const rows = flattenTree(tree, new Set(), pinned);

    // Taverna itself is gone from the main tree ("fora da posição delas na
    // árvore", REQ-NPC-023/DEC-NPC-03) — it lives in the pinned block instead.
    expect(rows.find((row) => row.node.id === "fld-taverna")).toBeUndefined();
    // Its child Porão travels with it: the subtree is not left behind to be
    // reparented into the main tree.
    expect(rows.find((row) => row.node.id === "fld-porao")).toBeUndefined();
    // What did not get pinned stays exactly where it always was.
    expect(names(rows.map((row) => row.node))).toEqual(["Aldeia", "Bosque"]);
    // A row that does survive the walk is never the pinned one — the field only
    // exists so callers do not have to re-check the pinned set themselves.
    expect(rows.every((row) => row.pinned === false)).toBe(true);
  });

  it("REQ-NPC-024: unpinning gives back exactly the tree of before — nothing was remembered", () => {
    const tree = buildFolderTree(FOLDERS, ACTORS, "Actor");
    const before = flattenTree(tree, new Set(), new Set()).map((row) => row.node.id);

    const whilePinned = flattenTree(tree, new Set(), new Set(["fld-porao"])).map(
      (row) => row.node.id,
    );
    const after = flattenTree(tree, new Set(), new Set()).map((row) => row.node.id);

    // While pinned, Porão is genuinely missing from the tree — proving the
    // citation below is not comparing a walk against itself.
    expect(whilePinned).not.toEqual(before);
    expect(whilePinned).toEqual(before.filter((id) => id !== "fld-porao"));
    // Unpinning gives back exactly the tree of before: nothing was remembered,
    // there was nothing TO remember.
    expect(after).toEqual(before);
    expect(pinnedFolders(tree, new Set()).length).toBe(0);
  });

  it("REQ-NPC-023: a pin naming a folder that no longer exists draws no block entry", () => {
    const tree = buildFolderTree(FOLDERS, ACTORS, "Actor");

    expect(pinnedFolders(tree, new Set(["fld-que-sumiu"]))).toEqual([]);
  });
});

describe("REQ-NPC-027: a collapsed folder hides its branch and nothing else", () => {
  it("REQ-NPC-027: collapsing Aldeia hides Taverna and Porão, and keeps Bosque", () => {
    const tree = buildFolderTree(FOLDERS, ACTORS, "Actor");
    const rows = flattenTree(tree, new Set(["fld-aldeia"]));

    expect(rows.map((row) => row.node.name)).toEqual(["Aldeia", "Bosque"]);
    expect(rows[0]!.collapsed).toBe(true);
    // The count is unchanged by collapsing: it describes the folder, not the view.
    expect(rows[0]!.node.subtreeCount).toBe(2);
  });
});
