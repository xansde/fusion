/**
 * sceneShelf.ts — the archive of the Cenas tab (spec 44, §5.4; DEC-CEN-05).
 *
 * Under the "no ar" head lives the archive: every OTHER scene of the world, grouped by
 * the folder of its own document and ordered by the document's manual `sort`. Both
 * fields existed in `Scene` since spec 02 and never had a consumer in the UI — this is
 * the consumer (emenda of `02` in §12 of spec 44).
 *
 * Deliberate boundaries:
 *  - **this tab does not manage folders** (DEC-CEN-05, Q-CEN-01). It groups by the
 *    folder a scene already has; creating, renaming and moving folders is not here, and
 *    the folder of a scene is chosen in its configuration window (REQ-CEN-061);
 *  - **the scene on air never appears here** (REQ-CEN-036) — it lives in the head, and
 *    a second line for it would be a second answer to "what is the table looking at";
 *  - **the module emits i18n keys, never sentences**, and resolves no asset: the same
 *    contract `scenesTabVM.ts` established for the head;
 *  - **collapsed groups are a device value** (REQ-CEN-033, DEC-UIF-10): they follow the
 *    per world + user `localStorage` pattern of `lib/sidebar/preferences.ts` and never
 *    travel to the server. The ORDER, by contrast, is world data and is written to the
 *    document (REQ-CEN-037).
 */

import type { Socket } from "socket.io-client";
import type { SceneDocument } from "@fusion/shared";
import { sendOp } from "../docs/sendOp.js";
import { SCENE_HEAD_KEYS, type SceneHeadLine } from "./scenesTabVM.js";

// ---------------------------------------------------------------------------
// i18n keys and constants
// ---------------------------------------------------------------------------

export const SCENE_SHELF_KEYS = {
  /** Label of the group that holds the scenes with no folder (REQ-CEN-032). */
  noFolder: "FUSION.Scene.Shelf.NoFolder",
  /** Accessible name of the search field (REQ-CEN-034). */
  search: "FUSION.Scene.Shelf.Search",
  searchPlaceholder: "FUSION.Scene.Shelf.SearchPlaceholder",
  /** A search that matched nothing — said out loud, never a blank panel. */
  noResults: "FUSION.Scene.Shelf.NoResults",
  /** The footer line that points the region map at the Hub (REQ-CEN-039). */
  regionMap: "FUSION.Scene.Shelf.RegionMap",
  collapse: "FUSION.Scene.Shelf.Collapse",
  expand: "FUSION.Scene.Shelf.Expand",
  markDarkness: "FUSION.Scene.Shelf.MarkDarkness",
  markFog: "FUSION.Scene.Shelf.MarkFog",
  /** Accessible name of the drag handle of a line (REQ-CEN-037). */
  reorder: "FUSION.Scene.Shelf.Reorder",
  reorderFailed: "FUSION.Scene.Shelf.ReorderFailed",
} as const;

/**
 * How many scenes the archive draws before it offers the search (REQ-CEN-034).
 *
 * The requirement is written in terms of "more scenes than fit without scrolling", which
 * is a measured height and cannot be decided by a pure projection. This is the count
 * that stands in for it: a drawer-wide line is ~34 px and the archive gets roughly a
 * third of a 900 px viewport, so beyond eight lines the list is already scrolling on the
 * smallest table we support.
 */
export const SCENE_SHELF_SEARCH_THRESHOLD = 8;

/** Key of the group of scenes with no folder — it has no folder id to be keyed by. */
export const UNFILED_GROUP_KEY = "__unfiled__";

/** Key prefix, following the `fusion:<thing>` convention used across the client. */
export const SCENE_SHELF_COLLAPSED_KEY_PREFIX = "fusion:sceneFolders";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A message the component resolves through `t()` — key plus interpolation vars. */
export type SceneShelfLine = SceneHeadLine;

/**
 * The little a folder document has to expose for the archive to group by it.
 *
 * Structural on purpose: the client mirror carries `Folder` documents (they travel in
 * the join snapshot), but the shared package declares no `FolderDocument` type, and this
 * module has no business depending on the one the server declares.
 */
export interface SceneShelfFolder {
  readonly _id: string;
  readonly name: string;
  readonly sort?: number | undefined;
}

/** One environment mark of a line — shown only while it is ON (REQ-CEN-035). */
export interface SceneShelfMark {
  readonly id: "darkness" | "fog";
  readonly labelKey: string;
}

/** One scene of the archive (REQ-CEN-035). */
export interface SceneShelfEntryVM {
  readonly sceneId: string;
  /** Untruncated name — truncation is layout, exactly as in the head (REQ-CEN-013). */
  readonly name: string;
  readonly folderId: string | null;
  /** The document's manual position, carried so a drag can compute the next one. */
  readonly sort: number;
  readonly dimensions: SceneShelfLine;
  readonly marks: readonly SceneShelfMark[];
}

/** One folder group of the archive (REQ-CEN-030, REQ-CEN-032). */
export interface SceneShelfGroupVM {
  /** Stable key of the group, also the key of its collapsed state (REQ-CEN-033). */
  readonly key: string;
  /** Folder id, or `null` for the group of scenes with no folder. */
  readonly folderId: string | null;
  /** Folder name as data — `null` for the unfiled group, which is named by key. */
  readonly label: string | null;
  /** i18n key of the label when there is no folder name to show (REQ-CEN-032). */
  readonly labelKey: string | null;
  readonly collapsed: boolean;
  readonly entries: readonly SceneShelfEntryVM[];
}

export interface SceneShelfVM {
  readonly groups: readonly SceneShelfGroupVM[];
  /** Whether the panel offers the search at all (REQ-CEN-034). */
  readonly searchable: boolean;
  /** The query in force, trimmed — empty string when nothing is being searched. */
  readonly query: string;
  readonly hasResults: boolean;
  /** How many scenes the archive holds — the one on air excluded (REQ-CEN-036). */
  readonly total: number;
  /** What to say when there is no line to draw: "no result" vs. "no scene". */
  readonly emptyKey: string | null;
  /** The line pointing the region map at the Hub (REQ-CEN-039, DEC-CEN-10). */
  readonly footer: SceneShelfLine;
}

export interface SceneShelfInput {
  readonly scenes: readonly SceneDocument[];
  /** Id of the scene on air, from the world's single source (DEC-CEN-02). */
  readonly activeSceneId: string | null;
  /** `Folder` documents of the mirror, for the group names (REQ-CEN-030). */
  readonly folders?: readonly SceneShelfFolder[] | undefined;
  /** Keys of the groups this user collapsed on this device (REQ-CEN-033). */
  readonly collapsedFolderIds?: readonly string[] | undefined;
  /** What the GM typed in the search field (REQ-CEN-034). */
  readonly query?: string | undefined;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function sortOf(scene: SceneDocument): number {
  const value = (scene as { sort?: unknown }).sort;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function createdTimeOf(scene: SceneDocument): number {
  const stats = (scene as { _stats?: { createdTime?: unknown } })._stats;
  const value = stats?.createdTime;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function folderOf(scene: SceneDocument): string | null {
  const value = (scene as { folder?: unknown }).folder;
  return typeof value === "string" && value !== "" ? value : null;
}

function darknessOf(scene: SceneDocument): number {
  const value = (scene as { darkness?: unknown }).darkness;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The manual order of a group (REQ-CEN-031).
 *
 * `sort` decides; scenes that share one keep creation order, which is what makes a scene
 * created now land at the END of its group even before anyone stamps it a sort.
 */
function byManualOrder(a: SceneDocument, b: SceneDocument): number {
  const bySort = sortOf(a) - sortOf(b);
  if (bySort !== 0) return bySort;
  const byCreation = createdTimeOf(a) - createdTimeOf(b);
  if (byCreation !== 0) return byCreation;
  return a._id.localeCompare(b._id);
}

function marksOf(scene: SceneDocument): SceneShelfMark[] {
  const marks: SceneShelfMark[] = [];
  if (darknessOf(scene) > 0) {
    marks.push({ id: "darkness", labelKey: SCENE_SHELF_KEYS.markDarkness });
  }
  if (scene.fogEnabled) {
    marks.push({ id: "fog", labelKey: SCENE_SHELF_KEYS.markFog });
  }
  return marks;
}

function entryOf(scene: SceneDocument): SceneShelfEntryVM {
  return {
    sceneId: scene._id,
    name: scene.name,
    folderId: folderOf(scene),
    sort: sortOf(scene),
    dimensions: {
      key: SCENE_HEAD_KEYS.dimensions,
      vars: { width: scene.width, height: scene.height },
    },
    marks: marksOf(scene),
  };
}

/**
 * Project the archive of the Cenas tab.
 *
 * Pure: the same world, the same search and the same device preferences always yield the
 * same archive, so a change of scene on air, of folder or of order is a recompute.
 */
export function buildSceneShelfVM(input: SceneShelfInput): SceneShelfVM {
  const { scenes, activeSceneId } = input;
  const folders = input.folders ?? [];
  const collapsedKeys = new Set(input.collapsedFolderIds ?? []);
  const query = (input.query ?? "").trim().toLowerCase();
  const searching = query !== "";

  // REQ-CEN-036: the scene on air lives in the head and nowhere else.
  const archived = scenes.filter((scene) => scene._id !== activeSceneId);

  const folderNames = new Map(folders.map((folder) => [folder._id, folder.name]));
  const folderSorts = new Map(folders.map((folder) => [folder._id, folder.sort ?? 0]));

  // Group by the folder of each document (REQ-CEN-030).
  const byFolder = new Map<string | null, SceneDocument[]>();
  for (const scene of archived) {
    const folderId = folderOf(scene);
    const bucket = byFolder.get(folderId);
    if (bucket === undefined) byFolder.set(folderId, [scene]);
    else bucket.push(scene);
  }

  const groups: SceneShelfGroupVM[] = [];
  for (const [folderId, bucket] of byFolder) {
    // A folder the mirror has no document for still groups: its id is the honest label.
    const label = folderId === null ? null : (folderNames.get(folderId) ?? folderId);
    const folderMatches = searching && label !== null && label.toLowerCase().includes(query);

    const ordered = bucket
      .slice()
      .sort(byManualOrder)
      .filter((scene) => !searching || folderMatches || scene.name.toLowerCase().includes(query));

    // REQ-CEN-034: a group with no result is hidden, never drawn empty.
    if (ordered.length === 0) continue;

    groups.push({
      key: folderId ?? UNFILED_GROUP_KEY,
      folderId,
      label,
      labelKey: folderId === null ? SCENE_SHELF_KEYS.noFolder : null,
      // A collapsed group would hide a hit, so a running search opens it (REQ-CEN-034);
      // the stored preference is untouched and comes back when the field is cleared.
      collapsed: !searching && collapsedKeys.has(folderId ?? UNFILED_GROUP_KEY),
      entries: ordered.map(entryOf),
    });
  }

  // REQ-CEN-032: the unfiled group is always last, whatever the folder names are.
  groups.sort((a, b) => {
    if (a.folderId === null) return b.folderId === null ? 0 : 1;
    if (b.folderId === null) return -1;
    const bySort = (folderSorts.get(a.folderId) ?? 0) - (folderSorts.get(b.folderId) ?? 0);
    if (bySort !== 0) return bySort;
    return (a.label ?? "").localeCompare(b.label ?? "", "pt-BR");
  });

  const hasResults = groups.length > 0;

  return {
    groups,
    searchable: archived.length > SCENE_SHELF_SEARCH_THRESHOLD,
    query,
    hasResults,
    total: archived.length,
    emptyKey: hasResults ? null : searching ? SCENE_SHELF_KEYS.noResults : null,
    footer: { key: SCENE_SHELF_KEYS.regionMap },
  };
}

/**
 * The `sort` a scene created now must carry to enter at the END of its group
 * (REQ-CEN-031).
 *
 * Exported for whoever creates or moves a scene into a folder (the configuration window,
 * REQ-CEN-060/061): the archive can order a tie by creation time, but a document that
 * states its position does not depend on that tie-break surviving.
 */
export function nextSortInFolder(
  scenes: readonly SceneDocument[],
  folderId: string | null,
): number {
  const inFolder = scenes.filter((scene) => folderOf(scene) === folderId);
  if (inFolder.length === 0) return 0;
  return Math.max(...inFolder.map(sortOf)) + 1;
}

// ---------------------------------------------------------------------------
// Collapsed groups — this device, this world, this user (REQ-CEN-033)
// ---------------------------------------------------------------------------

/**
 * Storage key of one user's collapsed groups in one world.
 *
 * Both ids are part of the key, exactly as in `lib/sidebar/preferences.ts`: a device
 * shared by two users keeps two independent entries, and another world starts fresh.
 */
export function sceneShelfCollapsedKey(worldId: string, userId: string): string {
  return `${SCENE_SHELF_COLLAPSED_KEY_PREFIX}:${worldId}:${userId}`;
}

function hasIdentity(worldId: string, userId: string): boolean {
  return worldId.length > 0 && userId.length > 0;
}

/** Which groups this user left collapsed here — `[]` for anything unusable. */
export function loadCollapsedSceneFolders(worldId: string, userId: string): string[] {
  if (!hasIdentity(worldId, userId)) return [];
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(sceneShelfCollapsedKey(worldId, userId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    /* storage unavailable or unparseable — treat as "nothing collapsed". */
    return [];
  }
}

/** Persist the collapsed groups of this user in this world. Never sent to the server. */
export function saveCollapsedSceneFolders(
  worldId: string,
  userId: string,
  collapsed: readonly string[],
): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(sceneShelfCollapsedKey(worldId, userId), JSON.stringify([...collapsed]));
  } catch {
    /* ignore */
  }
}

/** Add or remove one group from the collapsed set (pure). */
export function toggleCollapsedSceneFolder(
  collapsed: readonly string[],
  groupKey: string,
): string[] {
  return collapsed.includes(groupKey)
    ? collapsed.filter((key) => key !== groupKey)
    : [...collapsed, groupKey];
}

// ---------------------------------------------------------------------------
// Reorder (REQ-CEN-037)
// ---------------------------------------------------------------------------

/** One scene's new position in its group. */
export interface SceneSortUpdate {
  readonly sceneId: string;
  readonly sort: number;
}

/** The little a line has to expose for a drag to be computable. */
export interface SceneShelfOrderable {
  readonly sceneId: string;
  readonly sort: number;
}

/**
 * Where a drag leaves the group (REQ-CEN-037).
 *
 * Pure: takes the group as it is drawn, returns the whole group's new positions, and
 * says nothing about the wire. Positions are renumbered from 0 with step 1 so the result
 * does not depend on the gaps the previous order happened to have. A drop that changes
 * nothing — same index, or a scene that is not in this group — returns `[]`, so an
 * accidental drag writes nothing.
 */
export function reorderWithinGroup(
  entries: readonly SceneShelfOrderable[],
  movedSceneId: string,
  targetIndex: number,
): SceneSortUpdate[] {
  const from = entries.findIndex((entry) => entry.sceneId === movedSceneId);
  if (from === -1) return [];

  const clamped = Math.max(0, Math.min(targetIndex, entries.length - 1));
  if (clamped === from) return [];

  const next = entries.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [];
  next.splice(clamped, 0, moved);

  return next.map((entry, index) => ({ sceneId: entry.sceneId, sort: index }));
}

/**
 * Write the new order to the documents (REQ-CEN-037).
 *
 * The order is world data — shared by everyone at the table — so unlike the collapsed
 * state it is a document write, not a device value. One `doc:update` carries the whole
 * group, and each diff carries `sort` and nothing else.
 */
export async function persistSceneOrder(
  socket: Socket,
  updates: readonly SceneSortUpdate[],
): Promise<void> {
  if (updates.length === 0) return;
  await sendOp(socket, {
    type: "doc:update",
    payload: {
      documentType: "Scene",
      updates: updates.map((update) => ({
        _id: update.sceneId,
        diff: { sort: update.sort },
      })),
    },
  });
}
