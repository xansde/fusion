/**
 * folderTree.ts — the folder tree of the NPCs tab, as pure functions.
 *
 * Spec 42 §5.3 (`specs/42-aba-npcs.md`). Everything the panel draws about folders
 * is decided here: what nests under what (REQ-NPC-020), how many non-playables a
 * folder holds counting its whole subtree (REQ-NPC-026), which folders are pinned
 * to the block at the top and what path is shown next to them (REQ-NPC-023), and
 * what "Sem pasta" is (REQ-NPC-014).
 *
 * Two shapes make two rules fall out instead of being enforced by hand:
 *
 *  - **Unpinning is free** (REQ-NPC-024). Pinning is a SET of ids and nothing
 *    else — no index, no "previous position", no ordering key. There is no
 *    remembered place to restore, so a folder that stops being pinned lands
 *    exactly where the natural ordering puts it, and it could not do otherwise.
 *  - **A pin is not a folder change** (REQ-NPC-025). No function in this file
 *    takes or returns a `Folder` document: pinning reads a set and produces a
 *    view, so there is no path from the gesture to a write.
 *
 * A parent that does not exist, and a parent chain that loops, both make the
 * folder a root instead of making it disappear: a tree that hides a folder
 * because of a bad reference is a tree the user cannot repair.
 */

/** The fields of a `Folder` document this module reads. */
export interface FolderLike {
  readonly _id: string;
  readonly name?: string;
  readonly type?: string;
  readonly parentId?: string | null;
  readonly sort?: number;
}

/** The fields of a foldered document (an Actor, here) this module reads. */
export interface FolderedDoc {
  readonly _id: string;
  readonly name?: string;
  readonly type?: string;
  readonly folder?: string | null;
}

/** One folder as the panel draws it. */
export interface FolderTreeNode {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  /** 0 for a root folder. */
  readonly depth: number;
  readonly children: FolderTreeNode[];
  /** Non-playables sitting directly in this folder. */
  ownCount: number;
  /** Non-playables in this folder AND every folder below it (REQ-NPC-026). */
  subtreeCount: number;
}

export interface FolderTree {
  readonly roots: FolderTreeNode[];
  readonly byId: ReadonlyMap<string, FolderTreeNode>;
  /** Documents that belong to no folder — the "Sem pasta" group (REQ-NPC-014). */
  readonly unfiled: FolderedDoc[];
}

/** The id the panel uses for the "Sem pasta" group; never a `Folder` id. */
export const UNFILED_FOLDER_ID = "__unfiled__";

/**
 * The subtypes this tab lists (spec 42 §3): a non-playable is an `npc` or a
 * `hazard`. A player's character belongs to the Contatos tab, a familiar is drawn
 * inside its owner's line, and the baú is not an actor at all (DEC-NPC-08).
 */
export const NON_PLAYABLE_SUBTYPES: readonly string[] = ["npc", "hazard"];

export function isNonPlayableActor(doc: FolderedDoc): boolean {
  return typeof doc.type === "string" && NON_PLAYABLE_SUBTYPES.includes(doc.type);
}

/** pt-BR alphabetical order (REQ-NPC-013), applied to folders as well as rows. */
export function compareByName(a: { name?: string }, b: { name?: string }): number {
  return (a.name ?? "").localeCompare(b.name ?? "", "pt-BR", { sensitivity: "base" });
}

function folderName(folder: FolderLike): string {
  const name = folder.name;
  return typeof name === "string" && name.trim().length > 0 ? name : "";
}

/**
 * Resolve the parent of a folder, collapsing to `null` (a root) when the parent
 * is missing or when following the chain comes back to where it started.
 */
function resolveParentId(
  folder: FolderLike,
  known: ReadonlyMap<string, FolderLike>,
): string | null {
  const parentId = folder.parentId;
  if (typeof parentId !== "string" || parentId.length === 0) return null;
  if (!known.has(parentId)) return null;

  // Cycle guard: walk up from the parent; meeting this folder again means the
  // chain loops, and a looping branch is treated as a root rather than dropped.
  const visited = new Set<string>([folder._id]);
  let cursor: string | undefined = parentId;
  while (cursor !== undefined) {
    if (visited.has(cursor)) return null;
    visited.add(cursor);
    const next: string | null | undefined = known.get(cursor)?.parentId;
    cursor = typeof next === "string" && next.length > 0 && known.has(next) ? next : undefined;
  }
  return parentId;
}

/**
 * Build the tree of folders with the documents distributed into it.
 *
 * Only folders of the given `folderType` take part (`Actor`, here): the world's
 * folders table also holds the scene and journal trees, and mixing them would
 * put a scene folder in the NPCs tab.
 */
export function buildFolderTree(
  folders: readonly FolderLike[],
  docs: readonly FolderedDoc[],
  folderType = "Actor",
): FolderTree {
  const relevant = folders.filter(
    (folder) => folder.type === folderType && folderName(folder).length > 0,
  );
  const known = new Map<string, FolderLike>(relevant.map((folder) => [folder._id, folder]));

  const nodes = new Map<string, FolderTreeNode>();
  for (const folder of relevant) {
    nodes.set(folder._id, {
      id: folder._id,
      name: folderName(folder),
      parentId: resolveParentId(folder, known),
      depth: 0,
      children: [],
      ownCount: 0,
      subtreeCount: 0,
    });
  }

  const roots: FolderTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }

  // Distribute the documents. A document whose folder id names nothing lands in
  // "Sem pasta" — the reference is soft (REQ-DOC-011), so a stale id must not
  // hide the actor from the only list that can put it back somewhere.
  const unfiled: FolderedDoc[] = [];
  for (const doc of docs) {
    const folderId = doc.folder;
    const node =
      typeof folderId === "string" && folderId.length > 0 ? nodes.get(folderId) : undefined;
    if (node === undefined) unfiled.push(doc);
    else node.ownCount += 1;
  }

  const sortBranch = (branch: FolderTreeNode[], depth: number): void => {
    branch.sort(compareByName);
    for (const node of branch) {
      (node as { depth: number }).depth = depth;
      sortBranch(node.children, depth + 1);
    }
  };
  sortBranch(roots, 0);

  const countSubtree = (node: FolderTreeNode): number => {
    let total = node.ownCount;
    for (const child of node.children) total += countSubtree(child);
    node.subtreeCount = total;
    return total;
  };
  for (const root of roots) countSubtree(root);

  unfiled.sort(compareByName);
  return { roots, byId: nodes, unfiled };
}

/** The names of a folder's ancestors, outermost first (REQ-NPC-023). */
export function folderPath(tree: FolderTree, folderId: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>([folderId]);
  let cursor = tree.byId.get(folderId)?.parentId ?? null;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const node = tree.byId.get(cursor);
    if (node === undefined) break;
    path.unshift(node.name);
    cursor = node.parentId;
  }
  return path;
}

/** One entry of the pinned block at the top of the panel (REQ-NPC-023). */
export interface PinnedFolder {
  readonly node: FolderTreeNode;
  /** The mother's path, empty when the folder is already at the root. */
  readonly parentPath: string[];
}

/**
 * The pinned block, in the same pt-BR alphabetical order the tree uses.
 *
 * Order is derived from the folder's own name, never from when it was pinned:
 * the block is a shortcut to folders the user already knows the name of, so a
 * chronological list would move a folder every time another one is pinned.
 */
export function pinnedFolders(tree: FolderTree, pinned: ReadonlySet<string>): PinnedFolder[] {
  const entries: PinnedFolder[] = [];
  for (const id of pinned) {
    const node = tree.byId.get(id);
    if (node === undefined) continue;
    entries.push({ node, parentPath: folderPath(tree, id) });
  }
  entries.sort((a, b) => compareByName(a.node, b.node));
  return entries;
}

/** One row of the flattened tree the panel renders. */
export interface FolderRow {
  readonly node: FolderTreeNode;
  readonly collapsed: boolean;
  /**
   * Always `false`: a pinned folder never reaches `flattenTree`'s output at all
   * (REQ-NPC-023/DEC-NPC-03 — it moves to the pinned block instead of staying
   * here). Kept in the shape for callers that still want to say "this row is
   * never the pinned one" without reading `pinned.has(node.id)` themselves.
   */
  readonly pinned: boolean;
}

/**
 * Flatten the tree into the rows to draw, skipping everything under a collapsed
 * folder (REQ-NPC-027).
 *
 * A pinned folder is removed from its place in the tree, along with everything
 * under it: REQ-NPC-023 puts the pinned block "fora da posição delas na árvore",
 * and DEC-NPC-03 repeats it — the block at the top is where the folder lives now,
 * not an extra way in. The whole subtree travels with it (the decided design of
 * §13's prototype: a pinned folder's own children are never walked from here
 * either), which is also why unpinning has nothing to restore (REQ-NPC-024) — no
 * position was ever kept, because the folder never had two positions at once.
 */
export function flattenTree(
  tree: FolderTree,
  collapsed: ReadonlySet<string>,
  pinned: ReadonlySet<string> = new Set(),
): FolderRow[] {
  const rows: FolderRow[] = [];
  const walk = (branch: readonly FolderTreeNode[]): void => {
    for (const node of branch) {
      // REQ-NPC-023/DEC-NPC-03: a pinned folder and its whole subtree move to
      // the pinned block, so this walk neither draws a row for it nor descends
      // into its children from here — the same loop check covers roots and
      // nested folders alike.
      if (pinned.has(node.id)) continue;
      const isCollapsed = collapsed.has(node.id);
      // Past the guard above, a row reaching this line is never pinned.
      rows.push({ node, collapsed: isCollapsed, pinned: false });
      if (!isCollapsed) walk(node.children);
    }
  };
  walk(tree.roots);
  return rows;
}

/** The documents sitting directly in a folder, alphabetically (REQ-NPC-013). */
export function docsOfFolder(docs: readonly FolderedDoc[], folderId: string | null): FolderedDoc[] {
  const inFolder = docs.filter((doc) => {
    const id = typeof doc.folder === "string" && doc.folder.length > 0 ? doc.folder : null;
    return id === folderId;
  });
  inFolder.sort(compareByName);
  return inFolder;
}

/**
 * Whether `candidateParentId` is inside `folderId`'s own subtree — the move that
 * would detach a whole branch from the tree by making it its own ancestor.
 */
export function wouldCreateCycle(
  tree: FolderTree,
  folderId: string,
  candidateParentId: string | null,
): boolean {
  if (candidateParentId === null) return false;
  if (candidateParentId === folderId) return true;
  const seen = new Set<string>();
  let cursor: string | null = candidateParentId;
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === folderId) return true;
    seen.add(cursor);
    cursor = tree.byId.get(cursor)?.parentId ?? null;
  }
  return false;
}
