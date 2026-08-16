/**
 * Asset reconciliation and garbage collection (T022 / T023).
 *
 * Migration 009's `assets` table is a light *registry* of files under
 * `worlds/<slug>/assets/` (see `db/migrations/009_assets.ts`) — it does not
 * track which documents reference an asset, and a world that predates that
 * migration starts with an EMPTY table even though its `assets/` directory
 * is full of files nobody registered. This module answers two questions the
 * registry alone cannot:
 *
 *   1. Which files on disk are actually used by a document, which are
 *      dangling references (a document points at a file that no longer
 *      exists), and which are orphans (a file nobody points at)?
 *   2. Given that report, which orphans is it now safe to delete?
 *
 * ---------------------------------------------------------------------------
 * DESIGN — genericity over field lists (see the T022 task brief)
 * ---------------------------------------------------------------------------
 *
 * There is deliberately no list of "fields that hold an asset path" (no
 * `["background", "texture", "portrait", "image", ...]`). Token/actor/scene
 * shapes are exactly what is expected to keep changing on this project —  a
 * field-name allowlist would silently stop finding references the moment a
 * shape is redefined, and a stale reconciliation report is worse than none:
 * it tells a GM a file is safe to delete when it might not be.
 *
 * Instead, {@link extractAssetRefs} regex-scans the RAW JSON TEXT of a
 * document's `data` column for the one thing every stored reference has in
 * common regardless of which key holds it: the `/assets/<name>` URL shape
 * that `assetUrl()` (client `lib/assets/assetApi.ts`) produces. This is a
 * text scan, not a `JSON.parse` + key walk — a reference nested at any depth,
 * under any key name, in any document shape, is found the same way.
 *
 * Which TABLES get scanned is equally generic: every table in the database
 * that has a `data` column (via `PRAGMA table_info`), not
 * `@fusion/shared`'s `DOCUMENT_TABLES` allowlist. That allowlist exists for
 * a different purpose (which tables `DocumentStore` will read/write through
 * the generic Document CRUD API) and `region_maps` — the plainest document
 * table in the schema (see migration 004's own docstring) — is deliberately
 * NOT in it on this line. Scanning only `DOCUMENT_TABLES` would report every
 * `region_maps`-referenced file as an orphan and hand the GM a "safe to
 * delete" button for a map image that is very much in use — the single most
 * expensive mistake this task's brief calls out. `PRAGMA table_info` finds
 * `region_maps` (and any future non-document table with a `data` blob) the
 * same way it finds `actors` or `scenes`: no table is special-cased in
 * either direction.
 *
 * ---------------------------------------------------------------------------
 * DESIGN — one canonical name, decoded from the URL form
 * ---------------------------------------------------------------------------
 *
 * The stored reference and the on-disk filename are NOT the same string.
 * `assetUrl()` percent-encodes each `/`-separated segment before persisting
 * it (`"a b.png"` → `"/assets/a%20b.png"`), so the JSON text contains the
 * URL-encoded form while `readdirSync` returns the raw filename. Comparing
 * the two without normalising either one is exactly how an earlier design on
 * this project went wrong (see this file's task brief). {@link
 * assetRefToStorageName} performs the SAME strip-prefix + per-segment
 * `decodeURIComponent` the client's own `resolveAssetUrl()` does
 * (`lib/assets/assetApi.ts`) — one canonical direction, matched against the
 * raw on-disk name, never the reverse (re-encoding the disk listing would
 * have to guess which characters the client would have escaped).
 *
 * ---------------------------------------------------------------------------
 * DESIGN — "orphan" is a claim, not a fact
 * ---------------------------------------------------------------------------
 *
 * A file that finished uploading ten seconds ago and has not been saved onto
 * a document yet is, for one instant, byte-for-byte indistinguishable from a
 * real orphan: nothing references it. {@link reconcileAssets} splits
 * unreferenced files into `orphaned` (older than `orphanGraceMs`, default
 * {@link DEFAULT_ORPHAN_GRACE_MS}) and `recentUnreferenced` (younger). GC
 * ({@link runAssetGc}) only ever acts on `report.orphaned` — a file in
 * `recentUnreferenced` cannot be deleted by this module no matter what is
 * passed to `runAssetGc`, not even with `confirm: true`. Age is measured
 * from the asset's registry `created_at`, which for a file this same scan
 * had to backfill (see below) is the file's mtime — the moment it landed on
 * disk — not "now", so a first-ever reconciliation on an old world does not
 * misreport every pre-existing file as "just arrived".
 *
 * ---------------------------------------------------------------------------
 * DESIGN — reconciliation also fills the registry gap
 * ---------------------------------------------------------------------------
 *
 * Per migration 009's own docstring, a world that predates it has files on
 * disk with no row in `assets` at all. Filling that gap IS this task's job,
 * not a side effect: {@link reconcileAssets} registers (via `recordAsset`,
 * upsert-safe) every disk file missing a row before it computes the report,
 * using content read from the file itself (digest via `sha256Hex`, MIME via
 * the same `detectType` magic-byte sniffer the upload route uses) — never
 * from a document reference, which is a claim about the file, not evidence
 * about it.
 *
 * ---------------------------------------------------------------------------
 * DESIGN — backups are out of scope, on purpose (adversarial review, Achado 3)
 * ---------------------------------------------------------------------------
 *
 * This module only ever looks at the LIVE `world.db` and the LIVE `assets/`
 * directory — it does not open, or even enumerate, a world's backup files.
 * That is deliberate, not an oversight, and it is safe because of what
 * `worlds/asset-backup.ts` (T024) already guarantees: every backup taken
 * since T024 copies each asset it captures into a content-addressed blob
 * repository (`<backups>/assets-repo/<sha256>`) independent of the live
 * `assets/` directory, with a per-backup manifest recording which blobs it
 * needs. {@link runAssetGc} only ever `unlinkSync`s inside the LIVE
 * `assetsDir` — it never touches a backup directory or its blob repository —
 * so deleting a live orphan cannot make `fusion world restore` come back
 * missing a file for any backup that has a manifest. `asset-backup.ts`'s
 * `pruneUnreferencedAssetBlobs` is the only code that ever removes a blob
 * from that repository, and it unions every manifest still on disk before
 * doing so; a live GC run plays no part in that decision.
 *
 * The gap this leaves: a backup written BEFORE T024 has no manifest and no
 * blob copies of its own — `readAssetManifest` returns `null` for it, and
 * restoring it only swaps `world.db` back in (`assetsRestored: false`),
 * leaving `assets/` exactly as it is at restore time. If this module's GC
 * deletes a file that such a pre-T024 backup's OLD documents reference
 * (because, by the time GC runs, nothing in the LIVE database references it
 * any more), restoring that old backup brings back documents pointing at a
 * file that is genuinely gone, with no copy anywhere to bring it back from.
 * No scan closes this gap — the bytes a pre-T024 backup needs were simply
 * never captured. `cli/commands/assets.ts` surfaces this in both
 * `reconcile`'s and `gc`'s help text and report output; there is no code fix
 * for it here, only the warning.
 */

import { readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join as joinPath } from "node:path";
import type { Dirent } from "node:fs";
import type { Database } from "better-sqlite3";
import { sha256Hex } from "./slug.js";
import { detectType } from "./magic-bytes.js";
import { guardPath, PathTraversalError } from "./path-guard.js";
import { recordAsset, getAssetRecord, listAssetRecords, deleteAssetRecord } from "./asset-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default minimum age (ms) before an unreferenced file is reported as
 * `orphaned` rather than `recentUnreferenced`. One hour comfortably covers
 * "picked a file in the upload dialog, has not saved the document yet"
 * without hiding genuine cruft for long.
 */
export const DEFAULT_ORPHAN_GRACE_MS = 60 * 60 * 1000;

/**
 * Matches the `/assets/<name>` shape `assetUrl()` persists into documents.
 *
 * Delimited by CONTEXT, not by an allowed-character allowlist. An earlier
 * version of this pattern enumerated the characters it expected
 * (`[A-Za-z0-9._~%-]`), which is narrower than what `encodeURIComponent()`
 * actually leaves unescaped — it does NOT escape `! ' ( ) *`, so a filename
 * as ordinary as "mapa (1).jpg" (Windows' own default name for a second
 * download of the same file) truncated at the `(` and reported a
 * currently-in-use map as an orphan (adversarial review, Achado 1).
 *
 * The reference lives inside JSON text, where a string value ends at the
 * first unescaped `"` — so that is the reference's natural right edge, not
 * any particular character class. `\` is excluded too: a document that
 * stores HTML (TipTap journal content) as a JSON string has its own `"`
 * escaped to `\"`, so the raw column text contains `.../assets/x.png\"` —
 * without excluding `\` the match would swallow that trailing escape.
 * Whitespace, `<` and `>` are excluded as a defensive fallback for a
 * reference sitting in unquoted/HTML-ish text, so a match never runs past
 * an obvious token or tag boundary. Nothing else is excluded: printable
 * punctuation an OS filename can legally contain (parens, apostrophe,
 * exclamation mark, accented/Unicode characters, the `%` of a percent
 * escape) all pass through untouched — exactly what `encodeURIComponent()`
 * can produce.
 */
const ASSET_REF_PATTERN = /\/assets\/[^"\\\s<>]+/g;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One occurrence of an asset reference found inside a document's `data` column. */
export interface AssetReference {
  /** Table the reference was found in (e.g. "scenes", "region_maps"). */
  table: string;
  /** The document's `id` column, or `rowid:<n>` for a table without one. */
  documentId: string;
  /** The raw `/assets/...` substring exactly as it appears in the JSON text. */
  rawPath: string;
  /** {@link assetRefToStorageName}-normalised name, comparable to a disk filename. */
  storageName: string;
}

/** A file on disk with no document reference, past or short of the grace period. */
export interface OrphanedAsset {
  name: string;
  bytes: number;
  digest: string;
  /** Registry `created_at` (epoch ms) — file mtime for a just-backfilled row. */
  createdAt: number;
}

/** A document reference pointing at a name that does not exist on disk. */
export interface BrokenReference {
  storageName: string;
  references: AssetReference[];
}

/**
 * A document reference that matched an on-disk file only when compared
 * case-insensitively (adversarial review, Achado 2). The GM's server runs on
 * Windows, whose default filesystems are case-insensitive: a file named
 * `Taverna.jpg` on disk IS served for a reference to `/assets/taverna.jpg`,
 * so that reference is never broken and that file is never an orphan — this
 * only flags the byte-level mismatch as a warning to clean up, not a fault.
 */
export interface CaseMismatch {
  /** The exact byte sequence on disk. */
  diskName: string;
  /** The reference as stored in the document, differing from `diskName` only in case. */
  referencedAs: string;
  references: AssetReference[];
}

export interface AssetReconcileReport {
  scannedAt: number;
  assetsDir: string;
  /** On-disk files with at least one live document reference (exact match or case-insensitive). */
  referenced: Array<{ name: string; references: AssetReference[] }>;
  /** On-disk files with no reference, older than the grace period — GC candidates. */
  orphaned: OrphanedAsset[];
  /** On-disk files with no reference, but too recent to call orphaned. Never a GC candidate. */
  recentUnreferenced: OrphanedAsset[];
  /** Document references pointing at a name that does not exist on disk, even case-insensitively. */
  broken: BrokenReference[];
  /**
   * References counted in `referenced` above only because a case-insensitive
   * comparison matched — the byte-exact names differ. Never affects
   * `orphaned`/`broken`, purely informational (Achado 2).
   */
  caseMismatches: CaseMismatch[];
  /** Names newly inserted into the `assets` table by this run (registry gap-fill). */
  backfilled: string[];
}

export interface ReconcileAssetsOptions {
  db: Database;
  assetsDir: string;
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: number;
  /** Overrides {@link DEFAULT_ORPHAN_GRACE_MS} for tests. */
  orphanGraceMs?: number;
}

export interface AssetGcOptions {
  db: Database;
  assetsDir: string;
  /**
   * A report from {@link reconcileAssets}. GC only ever deletes names in
   * `report.orphaned` — it never re-derives its own view of what is an
   * orphan, so the caller can inspect (or print) exactly what will be
   * removed before opting into `confirm: true`.
   */
  report: AssetReconcileReport;
  /** Nothing is deleted unless this is `true` (T023 — never automatic). */
  confirm: boolean;
}

export interface AssetGcResult {
  confirmed: boolean;
  /** `report.orphaned` names — always populated, even in preview (`confirm: false`). */
  candidates: string[];
  deleted: string[];
  failed: Array<{ name: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Reference extraction (generic — no field-name list, see module doc)
// ---------------------------------------------------------------------------

/**
 * Find every `/assets/<name>` occurrence in a raw JSON text blob.
 *
 * Deliberately operates on the raw string, not a parsed object: the pattern
 * is matched regardless of which JSON key holds it or how deeply nested it
 * is, which is the point (see module doc, "genericity over field lists").
 *
 * Accepts `string | Buffer | null | undefined` because the caller
 * ({@link scanTableForRefs}) reads a `data` column whose declared schema is
 * `TEXT NOT NULL` today, which SQLite does not enforce at the type level — a
 * future migration, or a hand-edited row, can leave it NULL or a BLOB
 * (adversarial review, Achado 5). Neither is a reference to report, and
 * neither should abort reconciliation for every OTHER row in the database:
 * a BLOB is decoded as UTF-8 best-effort (still scanned, on the assumption
 * it is JSON text stored oddly), and anything else — NULL, or any other
 * runtime type — yields no matches rather than throwing.
 */
export function extractAssetRefs(rawJsonText: string | Buffer | null | undefined): string[] {
  if (typeof rawJsonText === "string") {
    return rawJsonText.match(ASSET_REF_PATTERN) ?? [];
  }
  if (Buffer.isBuffer(rawJsonText)) {
    return rawJsonText.toString("utf8").match(ASSET_REF_PATTERN) ?? [];
  }
  return [];
}

/**
 * Normalise a stored `/assets/<name>` reference into the canonical on-disk
 * name — the SAME strip-prefix + per-segment `decodeURIComponent` the
 * client's `resolveAssetUrl()` performs, so this is comparable byte-for-byte
 * against `readdirSync` output (see module doc, "one canonical name").
 *
 * A malformed percent-sequence is left as-is rather than thrown: it means
 * the reference is already broken (or hand-edited), and reporting it as a
 * dangling reference is more useful than crashing the whole reconciliation
 * over one bad row.
 */
export function assetRefToStorageName(ref: string): string {
  const rest = ref.replace(/^\/assets\//, "");
  return rest
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join("/");
}

// ---------------------------------------------------------------------------
// Disk walk
// ---------------------------------------------------------------------------

/**
 * List every regular file under `root`, recursively, as POSIX-style
 * relative paths (`/`-joined regardless of OS). Mirrors the dotfile
 * exclusion `assets/routes.ts`'s static-serving route already applies
 * (`.thumbs`, `.meta`, ...) so this scan and what a client can actually
 * fetch agree on what counts as "an asset".
 */
function walkAssetsDir(root: string): string[] {
  const out: string[] = [];

  function walk(dir: string, relPrefix: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // assets/ may not exist yet on a brand-new world
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relName = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(joinPath(dir, entry.name), relName);
      } else if (entry.isFile()) {
        out.push(relName);
      }
    }
  }

  walk(root, "");
  return out;
}

/** Best-effort MIME guess from extension — fallback for {@link detectType} misses (e.g. audio). */
function guessMimeFromExt(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Table scan (generic — every table with a `data` column, see module doc)
// ---------------------------------------------------------------------------

interface ScannableTable {
  name: string;
  hasId: boolean;
}

/**
 * Every table with a `data` column, discovered from the schema itself
 * (`PRAGMA table_info`) rather than `@fusion/shared`'s `DOCUMENT_TABLES`
 * allowlist. See module doc — this is what makes `region_maps` (not in that
 * allowlist on this line) get scanned like any other document table.
 */
function listScannableTables(db: Database): ScannableTable[] {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;

  const result: ScannableTable[] = [];
  for (const { name } of tables) {
    // Table names come from sqlite_master itself (never user input), so
    // interpolating into PRAGMA — which does not accept bound parameters
    // for identifiers — is safe here.
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((c) => c.name));
    if (columnNames.has("data")) {
      result.push({ name, hasId: columnNames.has("id") });
    }
  }
  return result;
}

function scanTableForRefs(db: Database, table: ScannableTable): AssetReference[] {
  const idExpr = table.hasId ? "id" : "rowid";
  const rows = db.prepare(`SELECT ${idExpr} AS doc_id, data FROM ${table.name}`).all() as Array<{
    doc_id: string | number;
    // Not necessarily a string at runtime — see extractAssetRefs's doc
    // comment (Achado 5).
    data: string | Buffer | null;
  }>;

  const refs: AssetReference[] = [];
  for (const row of rows) {
    for (const rawPath of extractAssetRefs(row.data)) {
      refs.push({
        table: table.name,
        documentId: table.hasId ? String(row.doc_id) : `rowid:${String(row.doc_id)}`,
        rawPath,
        storageName: assetRefToStorageName(rawPath),
      });
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Scan `assetsDir` and every document-shaped table in `db`, backfilling any
 * missing `assets` registry rows along the way, and return a classification
 * report. Read/write against the registry table, but never touches files on
 * disk (no deletes) — see {@link runAssetGc} for the destructive half.
 */
export function reconcileAssets(options: ReconcileAssetsOptions): AssetReconcileReport {
  const { db, assetsDir } = options;
  const now = options.now ?? Date.now();
  const graceMs = options.orphanGraceMs ?? DEFAULT_ORPHAN_GRACE_MS;

  const diskNames = walkAssetsDir(assetsDir);

  // 1. Backfill registry rows for files the registration path never saw
  //    (pre-existing files, or a failed best-effort registration at upload
  //    time — see asset-store.ts / routes.ts for why that path never
  //    hard-fails). Metadata comes from the file itself, never a document
  //    reference (module doc, "reconciliation also fills the registry gap").
  const backfilled: string[] = [];
  for (const name of diskNames) {
    if (getAssetRecord(db, name) !== undefined) continue;

    const filePath = joinPath(assetsDir, ...name.split("/"));
    let buf: Buffer;
    try {
      buf = readFileSync(filePath);
    } catch {
      continue; // vanished between the directory listing and this read; next run retries
    }

    const detected = detectType(buf);
    let createdAt = now;
    try {
      // Clamp to `now`: the filesystem's mtime carries sub-millisecond
      // precision that can round up past the integer `now` captured a few
      // lines above for a file written moments earlier in the very same
      // tick — without the clamp that reads as "created in the future"
      // and the grace-period math below (`now - createdAt`) goes negative,
      // permanently misclassifying a normal, already-old file as recent.
      createdAt = Math.min(now, Math.round(statSync(filePath).mtimeMs));
    } catch {
      // fall back to `now` — best-effort, file existed a moment ago
    }

    recordAsset(db, {
      name,
      digest: sha256Hex(buf),
      bytes: buf.length,
      mimeType: detected?.mime ?? guessMimeFromExt(name),
      uploadedBy: null, // unknown: whoever wrote this file predates the registry
      createdAt,
    });
    backfilled.push(name);
  }

  // 2. Snapshot the (now-complete) registry for age lookups.
  const registryByName = new Map(listAssetRecords(db).map((r) => [r.name, r]));

  // 3. Scan every `data`-bearing table for references (generic, see module doc).
  const allRefs: AssetReference[] = [];
  for (const table of listScannableTables(db)) {
    allRefs.push(...scanTableForRefs(db, table));
  }

  const refsByStorageName = new Map<string, AssetReference[]>();
  for (const ref of allRefs) {
    const list = refsByStorageName.get(ref.storageName) ?? [];
    list.push(ref);
    refsByStorageName.set(ref.storageName, list);
  }

  // 4. Classify.
  const diskSet = new Set(diskNames);

  // Case-insensitive fallback index (Achado 2): a reference that misses an
  // exact match may still be the file Windows/macOS actually serve. Built
  // unconditionally — one lowercase pass over the disk listing, negligible
  // next to the table scan above — to keep the classification loop below a
  // single straightforward pass rather than a retry-on-miss.
  const diskByLowerName = new Map<string, string[]>();
  for (const name of diskNames) {
    const lower = name.toLowerCase();
    const list = diskByLowerName.get(lower) ?? [];
    list.push(name);
    diskByLowerName.set(lower, list);
  }

  const referenced: AssetReconcileReport["referenced"] = [];
  const broken: BrokenReference[] = [];
  const caseMismatches: CaseMismatch[] = [];
  for (const [storageName, references] of refsByStorageName) {
    if (diskSet.has(storageName)) {
      referenced.push({ name: storageName, references });
      continue;
    }

    // No byte-exact match — before calling this reference broken, check
    // whether a case-insensitive filesystem would still serve it. Never
    // call a reference broken (or its target an orphan) over a difference
    // the OS itself does not see (module doc, "orphan is a claim, not a
    // fact"). A case-sensitive filesystem (Linux/CI) can, in principle,
    // hold two files differing only by case — this would then flag BOTH as
    // "referenced" by the one reference, a false positive the conservative
    // direction absorbs on purpose: it only ever prevents a delete, never
    // causes one.
    const caseInsensitiveMatches = diskByLowerName.get(storageName.toLowerCase()) ?? [];
    if (caseInsensitiveMatches.length > 0) {
      for (const diskName of caseInsensitiveMatches) {
        referenced.push({ name: diskName, references });
        caseMismatches.push({ diskName, referencedAs: storageName, references });
      }
      continue;
    }

    broken.push({ storageName, references });
  }

  // Names classified `referenced` above (exact OR case-insensitive) are
  // never eligible for `orphaned`/`recentUnreferenced` — see the loop below.
  const referencedDiskNames = new Set(referenced.map((r) => r.name));

  const orphaned: OrphanedAsset[] = [];
  const recentUnreferenced: OrphanedAsset[] = [];
  for (const name of diskNames) {
    if (referencedDiskNames.has(name)) continue;

    const record = registryByName.get(name);
    const entry: OrphanedAsset = {
      name,
      bytes: record?.bytes ?? 0,
      digest: record?.digest ?? "",
      // record is guaranteed to exist post-backfill; the `now` fallback is
      // defensive only (e.g. a concurrent external delete of the row).
      createdAt: record?.createdAt ?? now,
    };

    if (now - entry.createdAt >= graceMs) {
      orphaned.push(entry);
    } else {
      recentUnreferenced.push(entry);
    }
  }

  return {
    scannedAt: now,
    assetsDir,
    referenced,
    orphaned,
    recentUnreferenced,
    broken,
    caseMismatches,
    backfilled,
  };
}

// ---------------------------------------------------------------------------
// Garbage collection (T023 — never automatic)
// ---------------------------------------------------------------------------

/**
 * Delete the orphans in `options.report` — and ONLY those. Preview by
 * default: `confirm: false` (or omitted) returns `candidates` without
 * touching disk or the registry. `recentUnreferenced` and `broken` entries
 * in the report are never candidates for deletion, no matter what — see
 * module doc, "orphan is a claim, not a fact".
 */
export function runAssetGc(options: AssetGcOptions): AssetGcResult {
  const { db, assetsDir, report, confirm } = options;
  const candidates = report.orphaned.map((o) => o.name);

  if (!confirm) {
    return { confirmed: false, candidates, deleted: [], failed: [] };
  }

  const deleted: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const name of candidates) {
    try {
      const filePath = guardPath(assetsDir, name);
      unlinkSync(filePath);
      deleteAssetRecord(db, name);
      deleted.push(name);
    } catch (err) {
      const message =
        err instanceof PathTraversalError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      failed.push({ name, error: message });
    }
  }

  return { confirmed: true, candidates, deleted, failed };
}
