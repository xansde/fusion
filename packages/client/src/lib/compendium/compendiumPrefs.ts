/**
 * compendiumPrefs.ts — what the Compendium tab keeps on the device.
 *
 * Spec 43 (`specs/43-aba-compendio.md`) §5.9 and §7. The drawer unmounts a panel
 * when the user goes to another tab (REQ-GAV-017), so everything the panel knew
 * dies with it. This module is what survives that, and it draws a deliberate
 * line between two lifetimes:
 *
 *  - **the browser session** — the open pack, the typed text and the active
 *    facets (REQ-CPD-080). Losing the search because someone went to answer a
 *    question in Chat is the friction the drawer creates; keeping it FOREVER is
 *    worse (DEC-CPD-09: coming back tomorrow to a forgotten filter is more
 *    confusing than starting clean). `sessionStorage` is exactly that lifetime —
 *    closing the browser tab zeroes it, with no expiry logic to write;
 *  - **the device** — pinned entries and the recently used block (REQ-CPD-082,
 *    REQ-CPD-083), which are a personal preference and are meant to be there
 *    tomorrow, so they live in `localStorage`.
 *
 * Both are keyed per world AND per user (REQ-CPD-081), the same composition
 * `lib/sidebar/preferences.ts` uses: a shared browser must not hand the GM's
 * pinned bestiary to the player who logs in next. None of it is a Document —
 * DEC-UIF-10 keeps local ergonomics on the client, and nothing here is ever sent
 * to the server.
 *
 * A pin whose pack is no longer visible (audience changed, pack removed) is
 * filtered out **at display time** and left in storage (REQ-CPD-084). Deleting it
 * would be the destructive reading of "disappears": a pack that comes back
 * should bring its pins back with it, and a single unreadable row must never
 * take the others down with it.
 *
 * The badge rule of §5.1 also lives here, as pure data: the tab lights a state
 * dot while a batch import STARTED BY THIS USER is running, and nothing else
 * (REQ-CPD-002..005). The reactive singleton the rail reads is the thin wrapper
 * in `importActivity.ts`; the rule that decides on and off is here so it can be
 * tested without a rune, a rail or a socket.
 *
 * Pure TS: storage in, plain values out, no runes and no DOM.
 */

import {
  initialBrowserScope,
  type BrowserScopeState,
  type CompendiumFacets,
  type CompendiumScope,
} from "./browserScope.js";

// ---------------------------------------------------------------------------
// Keys — `fusion:<thing>:<worldId>:<userId>` (REQ-CPD-081)
// ---------------------------------------------------------------------------

/** Session-scoped view state: open pack, text, facets (REQ-CPD-080). */
export const COMPENDIUM_VIEW_KEY_PREFIX = "fusion:compendiumView";

/** Device-scoped pins (REQ-CPD-082). */
export const COMPENDIUM_PINS_KEY_PREFIX = "fusion:compendiumPins";

/** Device-scoped recently used (REQ-CPD-083). */
export const COMPENDIUM_RECENT_KEY_PREFIX = "fusion:compendiumRecent";

export function compendiumViewKey(worldId: string, userId: string): string {
  return `${COMPENDIUM_VIEW_KEY_PREFIX}:${worldId}:${userId}`;
}

export function compendiumPinsKey(worldId: string, userId: string): string {
  return `${COMPENDIUM_PINS_KEY_PREFIX}:${worldId}:${userId}`;
}

export function compendiumRecentKey(worldId: string, userId: string): string {
  return `${COMPENDIUM_RECENT_KEY_PREFIX}:${worldId}:${userId}`;
}

/**
 * Without both ids there is no owner for the value, so nothing is read or
 * written — an anonymous key would leak one seat's state into the next one.
 */
function hasIdentity(worldId: string, userId: string): boolean {
  return worldId.length > 0 && userId.length > 0;
}

/**
 * The two lifetimes, resolved late on purpose: reading the global inside the
 * `try` is what makes "no storage at all" (Node, private mode) a caught
 * `ReferenceError` instead of a crash at import time.
 */
type StorageKind = "session" | "local";

function storageOf(kind: StorageKind): Storage {
  return kind === "session" ? sessionStorage : localStorage;
}

function readRaw(kind: StorageKind, key: string): string | null {
  try {
    return storageOf(kind).getItem(key);
  } catch {
    /* storage unavailable (tests, private mode) — treat as "nothing saved". */
    return null;
  }
}

function writeRaw(kind: StorageKind, key: string, value: string): void {
  try {
    storageOf(kind).setItem(key, value);
  } catch {
    /* a preference that cannot be written is not an error to report. */
  }
}

function removeRaw(kind: StorageKind, key: string): void {
  try {
    storageOf(kind).removeItem(key);
  } catch {
    /* ignore */
  }
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseArray(raw: string | null): unknown[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The view that survives a tab switch — session lifetime (REQ-CPD-080/081)
// ---------------------------------------------------------------------------

function readScope(value: unknown): CompendiumScope | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record["kind"] === "root") return { kind: "root" };
  if (
    record["kind"] === "pack" &&
    typeof record["packId"] === "string" &&
    record["packId"].length > 0 &&
    typeof record["packLabel"] === "string"
  ) {
    return { kind: "pack", packId: record["packId"], packLabel: record["packLabel"] };
  }
  return null;
}

function readFacets(value: unknown): CompendiumFacets {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  const facets: {
    documentType?: string;
    rarity?: string;
    minLevel?: number;
    maxLevel?: number;
    packId?: string;
  } = {};
  for (const key of ["documentType", "rarity", "packId"] as const) {
    const raw = record[key];
    if (typeof raw === "string" && raw.length > 0) facets[key] = raw;
  }
  for (const key of ["minLevel", "maxLevel"] as const) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) facets[key] = raw;
  }
  return facets;
}

/**
 * Restore what this seat was looking at, within this browser session
 * (REQ-CPD-080). Anything unusable — nothing saved, another origin's JSON, a
 * shape from an older build — is a clean start, never a thrown error: the panel
 * losing a preference must not cost the user the panel.
 */
export function loadBrowserView(worldId: string, userId: string): BrowserScopeState {
  if (!hasIdentity(worldId, userId)) return initialBrowserScope();
  const record = parseObject(readRaw("session", compendiumViewKey(worldId, userId)));
  if (record === null) return initialBrowserScope();
  const scope = readScope(record["scope"]);
  if (scope === null) return initialBrowserScope();
  return {
    scope,
    search: typeof record["search"] === "string" ? record["search"] : "",
    facets: readFacets(record["facets"]),
  };
}

/** Remember the open pack, the text and the facets for this browser session. */
export function saveBrowserView(worldId: string, userId: string, view: BrowserScopeState): void {
  if (!hasIdentity(worldId, userId)) return;
  writeRaw(
    "session",
    compendiumViewKey(worldId, userId),
    JSON.stringify({ scope: view.scope, search: view.search, facets: view.facets }),
  );
}

/** Drop the saved view of this seat (used when the panel wants a clean start). */
export function clearBrowserView(worldId: string, userId: string): void {
  if (!hasIdentity(worldId, userId)) return;
  removeRaw("session", compendiumViewKey(worldId, userId));
}

/**
 * Reconcile a restored view against the packs the caller may actually see.
 *
 * A pack scope whose pack is gone (removed, or `audience: "gm"` for a seat that
 * is no longer privileged) falls back to the root scope, keeping the text and
 * the facets — the same forgiving rule REQ-CPD-084 states for pins, applied to
 * the scope so restoring never lands the panel on a pack the server will refuse.
 */
export function reconcileBrowserView(
  view: BrowserScopeState,
  visiblePackIds: Iterable<string>,
): BrowserScopeState {
  if (view.scope.kind !== "pack") return view;
  const visible = new Set(visiblePackIds);
  if (visible.has(view.scope.packId)) return view;
  return { ...view, scope: { kind: "root" } };
}

// ---------------------------------------------------------------------------
// Pinned and recently used — device lifetime (REQ-CPD-082..084)
// ---------------------------------------------------------------------------

/**
 * The little an entry needs to be listed again without its pack index being
 * loaded (RNF-CPD-04): who it is, where it came from, and what to call it.
 */
export interface CompendiumEntryRef {
  /** Stable identity of the entry inside the collection. */
  readonly uuid: string;
  /** The pack it belongs to — the field REQ-CPD-084 filters on. */
  readonly packId: string;
  /** Label to draw, as it read when the mark was made. */
  readonly name: string;
  /** Document type, so the block can draw the same type icon as a result line. */
  readonly documentType: string;
}

/** What put an entry in the recently used block (REQ-CPD-083). */
export type CompendiumRecentReason = "preview" | "import";

/** One row of the recently used block. */
export interface CompendiumRecentEntry extends CompendiumEntryRef {
  /** Epoch ms of the last use — ordering only, never drawn as a date. */
  readonly at: number;
  readonly reason: CompendiumRecentReason;
}

/**
 * How many rows the recently used block keeps (REQ-CPD-083): a fixed ceiling,
 * with no setting to change it. It is a shortcut, not a history — a block long
 * enough to scroll would compete with the shelf it sits on top of.
 */
export const COMPENDIUM_RECENT_LIMIT = 8;

function readEntryRef(value: unknown): CompendiumEntryRef | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const uuid = record["uuid"];
  const packId = record["packId"];
  if (typeof uuid !== "string" || uuid.length === 0) return null;
  if (typeof packId !== "string" || packId.length === 0) return null;
  return {
    uuid,
    packId,
    name: typeof record["name"] === "string" ? record["name"] : uuid,
    documentType: typeof record["documentType"] === "string" ? record["documentType"] : "",
  };
}

/**
 * Read the pins of this seat. Rows that do not parse are skipped one by one:
 * one bad row must never cost the user the rest of the list (REQ-CPD-084).
 */
export function loadPinnedEntries(worldId: string, userId: string): CompendiumEntryRef[] {
  if (!hasIdentity(worldId, userId)) return [];
  const rows: CompendiumEntryRef[] = [];
  const seen = new Set<string>();
  for (const raw of parseArray(readRaw("local", compendiumPinsKey(worldId, userId)))) {
    const entry = readEntryRef(raw);
    if (entry === null || seen.has(entry.uuid)) continue;
    seen.add(entry.uuid);
    rows.push(entry);
  }
  return rows;
}

/** Persist the pins of this seat on this device (REQ-CPD-081, REQ-CPD-082). */
export function savePinnedEntries(
  worldId: string,
  userId: string,
  entries: readonly CompendiumEntryRef[],
): void {
  if (!hasIdentity(worldId, userId)) return;
  writeRaw("local", compendiumPinsKey(worldId, userId), JSON.stringify(entries));
}

/** Whether an entry is currently pinned (REQ-CPD-082). */
export function isEntryPinned(entries: readonly CompendiumEntryRef[], uuid: string): boolean {
  return entries.some((entry) => entry.uuid === uuid);
}

/**
 * Pin or unpin, returning a new list (the argument is untouched).
 *
 * A new pin goes to the FRONT — the block reads newest first, so pinning
 * something shows it where the user is already looking instead of below a fold.
 */
export function togglePinnedEntry(
  entries: readonly CompendiumEntryRef[],
  entry: CompendiumEntryRef,
): CompendiumEntryRef[] {
  if (isEntryPinned(entries, entry.uuid)) {
    return entries.filter((pinned) => pinned.uuid !== entry.uuid);
  }
  return [entry, ...entries];
}

/**
 * Drop the rows whose pack the caller can no longer see (REQ-CPD-084).
 *
 * Display-time only: the storage keeps them, so a pack the GM reopens brings its
 * pins back instead of having silently destroyed them. The others are untouched
 * either way — this is a filter, never a "clear the list because one row broke".
 */
export function filterByVisiblePacks<T extends CompendiumEntryRef>(
  entries: readonly T[],
  visiblePackIds: Iterable<string>,
): T[] {
  const visible = new Set(visiblePackIds);
  return entries.filter((entry) => visible.has(entry.packId));
}

function readRecentEntry(value: unknown): CompendiumRecentEntry | null {
  const ref = readEntryRef(value);
  if (ref === null) return null;
  const record = value as Record<string, unknown>;
  const at = record["at"];
  const reason = record["reason"];
  return {
    ...ref,
    at: typeof at === "number" && Number.isFinite(at) ? at : 0,
    reason: reason === "import" ? "import" : "preview",
  };
}

/**
 * Read the recently used block, newest first and already capped — a file grown
 * by an older build (or by hand) cannot make the block long.
 */
export function loadRecentEntries(worldId: string, userId: string): CompendiumRecentEntry[] {
  if (!hasIdentity(worldId, userId)) return [];
  const rows: CompendiumRecentEntry[] = [];
  const seen = new Set<string>();
  for (const raw of parseArray(readRaw("local", compendiumRecentKey(worldId, userId)))) {
    const entry = readRecentEntry(raw);
    if (entry === null || seen.has(entry.uuid)) continue;
    seen.add(entry.uuid);
    rows.push(entry);
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, COMPENDIUM_RECENT_LIMIT);
}

/** Persist the recently used block of this seat, capped (REQ-CPD-083). */
export function saveRecentEntries(
  worldId: string,
  userId: string,
  entries: readonly CompendiumRecentEntry[],
): void {
  if (!hasIdentity(worldId, userId)) return;
  writeRaw(
    "local",
    compendiumRecentKey(worldId, userId),
    JSON.stringify(entries.slice(0, COMPENDIUM_RECENT_LIMIT)),
  );
}

/**
 * Record a use — previewing or bringing an entry over (REQ-CPD-083).
 *
 * Newest first, one row per entry (using the same thing twice moves it up rather
 * than listing it twice), and never longer than the fixed ceiling.
 */
export function recordRecentEntry(
  entries: readonly CompendiumRecentEntry[],
  entry: CompendiumEntryRef,
  reason: CompendiumRecentReason,
  now: number = Date.now(),
): CompendiumRecentEntry[] {
  const head: CompendiumRecentEntry = { ...entry, at: now, reason };
  return [head, ...entries.filter((row) => row.uuid !== entry.uuid)].slice(
    0,
    COMPENDIUM_RECENT_LIMIT,
  );
}

// ---------------------------------------------------------------------------
// The tab badge — a state dot, and only for a running batch import
// ---------------------------------------------------------------------------

/**
 * Batch imports this seat started and has not seen finish (REQ-CPD-003).
 *
 * Ids rather than a counter so a run that ends twice — a cancel racing the
 * server's own "done" — cannot leave the dot lit forever.
 */
export interface BatchImportActivity {
  readonly running: readonly string[];
}

/** Nothing running: the tab draws no badge at all (REQ-CPD-005). */
export const NO_BATCH_IMPORTS: BatchImportActivity = Object.freeze({ running: Object.freeze([]) });

/** A batch import of this user started (REQ-CPD-003). Idempotent per run id. */
export function beginBatchImport(
  activity: BatchImportActivity,
  runId: string,
): BatchImportActivity {
  if (activity.running.includes(runId)) return activity;
  return { running: [...activity.running, runId] };
}

/**
 * A batch import finished, failed or was cancelled (REQ-CPD-003) — the same
 * exit for all three, because the dot means "work in flight", not "success".
 */
export function endBatchImport(activity: BatchImportActivity, runId: string): BatchImportActivity {
  if (!activity.running.includes(runId)) return activity;
  return { running: activity.running.filter((id) => id !== runId) };
}

/**
 * The badge value the rail reads (REQ-CPD-002): a boolean, so the tab
 * structurally cannot show a counter, and false whenever nothing of this user's
 * is running (REQ-CPD-005). Opening the tab is not an argument of this function,
 * which is how REQ-CPD-004 (opening the tab does not change the dot) holds.
 */
export function batchImportBadgeValue(activity: BatchImportActivity): boolean {
  return activity.running.length > 0;
}
