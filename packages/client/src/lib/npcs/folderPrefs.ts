/**
 * folderPrefs.ts — what the device remembers about the NPC folder tree.
 *
 * Spec 42 §5.3: which folders this user pinned (REQ-NPC-025) and which he left
 * collapsed (REQ-NPC-027) live in the CLIENT, keyed by world **and** user
 * (DEC-UIF-10) — never in the `Folder` document. Two consequences the panel
 * depends on:
 *
 *  - a second GM, on another device, sees none of the first one's pins, because
 *    there is nothing on the server to see;
 *  - the `Folder` documents are byte-identical before and after a pin, because
 *    no function here writes a document — the whole module only touches
 *    `localStorage`.
 *
 * Both ids are part of the storage key, following the `fusion:<thing>` convention
 * the rest of the client uses (`lib/contacts/categories.ts` is the same shape):
 * a device shared by two GMs keeps two independent sets, and the isolation IS the
 * key, not a check some code path could skip.
 *
 * Every mutation is pure and returns a new value; persisting is the caller's
 * second step, which keeps the rules testable without a DOM.
 */

/** Key prefix, following the `fusion:<thing>` convention used across the client. */
export const NPC_FOLDER_PREFS_KEY_PREFIX = "fusion:npcFolders";

/** One user's folder view state in one world. */
export interface NpcFolderPrefs {
  /**
   * Ids of the pinned folders (REQ-NPC-023). A SET, deliberately: there is no
   * index and no previous position, so unpinning has nothing to restore and the
   * folder falls back to its natural place (REQ-NPC-024).
   */
  readonly pinned: readonly string[];
  /** Ids of the folders left collapsed (REQ-NPC-027). */
  readonly collapsed: readonly string[];
}

export function npcFolderPrefsKey(worldId: string, userId: string): string {
  return `${NPC_FOLDER_PREFS_KEY_PREFIX}:${worldId}:${userId}`;
}

export function emptyNpcFolderPrefs(): NpcFolderPrefs {
  return { pinned: [], collapsed: [] };
}

function toggle(list: readonly string[], id: string): string[] {
  if (id.length === 0) return [...list];
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

/** Pin a folder, or unpin it if it is already pinned (REQ-NPC-023/024). */
export function togglePinned(prefs: NpcFolderPrefs, folderId: string): NpcFolderPrefs {
  return { pinned: toggle(prefs.pinned, folderId), collapsed: [...prefs.collapsed] };
}

/** Collapse a folder, or expand it if it is collapsed (REQ-NPC-027). */
export function toggleCollapsed(prefs: NpcFolderPrefs, folderId: string): NpcFolderPrefs {
  return { pinned: [...prefs.pinned], collapsed: toggle(prefs.collapsed, folderId) };
}

/**
 * Drop ids that name no folder any more.
 *
 * A folder deleted on the server would otherwise keep a dead entry here forever;
 * pruning on read means the state file cannot grow without bound, and a recreated
 * id (which cannot happen — ids are nanoids) could not inherit an old pin.
 */
export function pruneNpcFolderPrefs(
  prefs: NpcFolderPrefs,
  liveFolderIds: ReadonlySet<string>,
): NpcFolderPrefs {
  return {
    pinned: prefs.pinned.filter((id) => liveFolderIds.has(id)),
    collapsed: prefs.collapsed.filter((id) => liveFolderIds.has(id)),
  };
}

function hasIdentity(worldId: string, userId: string): boolean {
  return worldId.length > 0 && userId.length > 0;
}

function readList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/**
 * Read this user's folder view state in this world. A user who never pinned
 * anything, storage that is unavailable and a corrupt entry all give the same
 * empty value — the panel has one case to draw, not three.
 */
export function loadNpcFolderPrefs(worldId: string, userId: string): NpcFolderPrefs {
  if (!hasIdentity(worldId, userId)) return emptyNpcFolderPrefs();
  try {
    if (typeof localStorage === "undefined") return emptyNpcFolderPrefs();
    const raw = localStorage.getItem(npcFolderPrefsKey(worldId, userId));
    if (raw === null) return emptyNpcFolderPrefs();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return emptyNpcFolderPrefs();
    const value = parsed as Record<string, unknown>;
    return { pinned: readList(value["pinned"]), collapsed: readList(value["collapsed"]) };
  } catch {
    /* storage unavailable or unparseable — treat as "nothing pinned". */
    return emptyNpcFolderPrefs();
  }
}

/**
 * Persist this user's folder view state in this world (REQ-NPC-025/027). Never
 * sent to the server, and no other user's entry is touched. Failures are
 * swallowed (private mode, quota, storage disabled): losing a pin is not worth
 * breaking the tab.
 */
export function saveNpcFolderPrefs(worldId: string, userId: string, prefs: NpcFolderPrefs): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      npcFolderPrefsKey(worldId, userId),
      JSON.stringify({ pinned: prefs.pinned, collapsed: prefs.collapsed }),
    );
  } catch {
    /* ignore */
  }
}

/** Drop this user's folder view state in this world. */
export function clearNpcFolderPrefs(worldId: string, userId: string): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(npcFolderPrefsKey(worldId, userId));
  } catch {
    /* ignore */
  }
}
