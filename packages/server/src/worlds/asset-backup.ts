/**
 * Asset backup — content-addressed repository + per-backup manifest.
 *
 * T024 / D4: "backup do mundo = banco + assets deduplicados por hash".
 *
 * Problem this closes: every backup world-manager.ts wrote before this
 * module copied only world.db. Restoring one of those backups brought back
 * documents whose img/texture/background fields point at files in assets/
 * that may since have been renamed, replaced or deleted — the database is
 * internally consistent but the files it references are gone.
 *
 * Design:
 *
 *  - A single content-addressed BLOB REPOSITORY lives at
 *    `<worldBackupsDir>/assets-repo/<sha256-hex>` — one copy of a given
 *    byte sequence no matter how many backups reference it. The blob's
 *    filename is the hash of its CONTENT, computed here by hashing the
 *    file's bytes — never trusted from the on-disk filename. REQ-SEC-040
 *    assigns uploaded assets a name with only an 8-char hash *prefix*
 *    (`slug-a3f8bc12.webp`), and at least one asset in the real world
 *    (`taverna-demo.jpg`, seeded by script) has no hash in its name at
 *    all, so the name is never a substitute for actually hashing.
 *  - Each backup that captures assets gets a companion MANIFEST file next
 *    to its `.db` file: `<same-basename>.assets.json`, listing every file
 *    that was present directly under `assets/` at backup time together
 *    with its content hash and size. The manifest is what makes a single
 *    backup's asset set independently restorable — the repository alone
 *    doesn't know which blobs belong to which backup, only which blobs
 *    exist.
 *
 * Dedup: {@link backupAssets} hashes every file in `assets/` on every
 * call — the read+hash cost is unavoidable, content-addressing only elides
 * the COPY — but only writes a blob into the repository for hashes it has
 * not seen before. A world whose assets are unchanged between two backups
 * pays for N file reads and writes zero new bytes.
 *
 * Async by design: `backup()` in world-manager.ts uses SQLite's online
 * backup API specifically so a GM's live session is never blocked while a
 * backup runs. {@link backupAssets} has to honour that same guarantee —
 * every read, hash and copy below goes through `node:fs/promises` and a
 * streaming SHA-256 (`createReadStream` + `createHash`, never a full
 * `readFileSync` into memory), so hashing a multi-hundred-MB video/audio
 * asset costs one bounded chunk buffer at a time, not a heap allocation the
 * size of the file, and yields to the event loop between chunks instead of
 * hogging it for the whole read.
 *
 * Measured (review fix, 2026-08-16 — 80 MB synthetic asset, 5ms event-loop
 * heartbeat probe, 3 runs): the OLD `readFileSync`-per-asset version
 * serviced ZERO heartbeat ticks during its ~130-150ms wall time — the event
 * loop was fully blocked for the entire hash pass, meaning any socket.io
 * message, HTTP request or other timer due during that window queued behind
 * it. The NEW streaming version serviced 39-42 ticks against an expected
 * 43-48 (85-93%) over its ~210-240ms wall time — slower in wall-clock terms
 * (expected: real async I/O scheduling costs more than one big synchronous
 * read) but the event loop stays responsive throughout instead of freezing.
 *
 * Pruning safety: {@link pruneUnreferencedAssetBlobs} must run after
 * removing any manifest. It unions the hashes referenced by every manifest
 * still on disk and removes repository blobs outside that union — a full
 * sweep, not a per-backup refcount, so it is self-healing rather than
 * dependent on every call site keeping a counter in sync. This is what
 * stops "two backups share an asset; deleting the older one deletes the
 * blob the newer one still needs" (the failure mode a naive
 * delete-what-this-backup-owns implementation falls into).
 *
 * Restore is a MERGE, not a wholesale directory replace — see
 * {@link restoreAssets}'s doc comment for why.
 */

import { existsSync, readFileSync, readdirSync, rmSync, createReadStream } from "node:fs";
import { mkdir, readdir, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Manifest shape
// ---------------------------------------------------------------------------

export interface AssetManifestEntry {
  /** Filename as it appears directly under the world's `assets/` directory. */
  name: string;
  /** Full SHA-256 hex digest (64 chars) of the file's content. */
  hash: string;
  sizeBytes: number;
}

export interface AssetBackupManifest {
  /** Format tag — bump if the shape below ever changes incompatibly. */
  version: 1;
  files: AssetManifestEntry[];
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * The shared, content-addressed blob repository for a world's backups.
 * One repository serves every backup of that world — this is what makes
 * dedup possible across backups, not just within a single one.
 */
export function assetsRepoDir(worldBackupsDir: string): string {
  return join(worldBackupsDir, "assets-repo");
}

/**
 * The manifest path that goes with a given `.db` backup file.
 * `pre-event-update-*.db` and other non-asset-bearing backups simply never
 * get one written — {@link readAssetManifest} returns null for those.
 */
export function assetManifestPath(dbBackupPath: string): string {
  if (!dbBackupPath.endsWith(".db")) {
    throw new Error(`Expected a ".db" backup path, got: "${dbBackupPath}"`);
  }
  return `${dbBackupPath.slice(0, -".db".length)}.assets.json`;
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/**
 * Hash a file's content via a streaming read (bounded chunk buffers, never
 * the whole file in memory) and report its size as measured while streaming
 * — a second `statSync` for size would be redundant and could race with a
 * concurrent write, so the byte count comes from the same pass as the hash.
 */
function hashFileStreaming(filePath: string): Promise<{ hash: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      sizeBytes += buf.length;
      hash.update(buf);
    });
    stream.on("end", () => {
      resolve({ hash: hash.digest("hex"), sizeBytes });
    });
  });
}

/**
 * Snapshot every file directly under `worldAssetsDir` into the
 * content-addressed repository under `worldBackupsDir`, and write a
 * manifest for this specific backup next to `dbBackupPath`.
 *
 * Assets are stored flat today (REQ-AST-002/`buildSafeFilename` — no
 * subdirectories, `GET /assets/<name>`), so only regular files directly in
 * `worldAssetsDir` are considered; a stray subdirectory is skipped rather
 * than crashing the backup.
 *
 * Files are hashed/copied one at a time (not `Promise.all`) — deliberately:
 * this keeps file-descriptor usage bounded regardless of how many assets a
 * world has, at the cost of not parallelising I/O across files. Each
 * individual file's read is still fully async/streamed (see
 * {@link hashFileStreaming}), which is what actually matters for not
 * blocking the event loop — see this module's doc comment.
 *
 * @returns the manifest that was written, or null when `worldAssetsDir`
 *   does not exist (nothing to back up — e.g. a world older than the
 *   assets feature, or a caller that deliberately skips assets for this
 *   backup type; see world-manager.ts's `backupPreUpdate`/`delete` for
 *   the types that intentionally never call this function).
 */
export async function backupAssets(
  worldAssetsDir: string,
  worldBackupsDir: string,
  dbBackupPath: string,
): Promise<AssetBackupManifest | null> {
  if (!existsSync(worldAssetsDir)) return null;

  let entries;
  try {
    entries = await readdir(worldAssetsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const repoDir = assetsRepoDir(worldBackupsDir);
  await mkdir(repoDir, { recursive: true });

  const files: AssetManifestEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue; // defensive — assets/ is flat by design today
    const filePath = join(worldAssetsDir, entry.name);
    const { hash, sizeBytes } = await hashFileStreaming(filePath);

    const blobPath = join(repoDir, hash);
    if (!existsSync(blobPath)) {
      // fs.copyFile is a native OS-level copy (uv_fs_copyfile) — it never
      // buffers the file's content in the JS heap the way
      // readFileSync+writeFileSync would.
      await copyFile(filePath, blobPath);
    }

    files.push({ name: entry.name, hash, sizeBytes });
  }

  const manifest: AssetBackupManifest = { version: 1, files };
  await writeFile(assetManifestPath(dbBackupPath), JSON.stringify(manifest), "utf8");
  return manifest;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link readAssetManifest} when a manifest file EXISTS but its
 * content is not a usable manifest (invalid JSON, or valid JSON that
 * doesn't match {@link AssetBackupManifest}'s shape).
 *
 * Deliberately distinct from "no manifest at all" (a legitimate, silent
 * `null` — see {@link readAssetManifest}'s doc comment): a backup that
 * bundled assets but whose manifest is now unreadable must abort the
 * restore loudly, not quietly restore world.db while leaving assets/
 * untouched with no indication anything was skipped.
 */
export class CorruptedAssetManifestError extends Error {
  constructor(manifestPath: string, cause: unknown) {
    super(
      `Asset manifest at "${manifestPath}" exists but is not readable/valid — ` +
        `refusing to restore silently without its assets. Cause: ${String(cause)}`,
    );
    this.name = "CorruptedAssetManifestError";
  }
}

/** Runtime shape check — `readAssetManifest` must not trust `JSON.parse`'s output type. */
function isValidManifestShape(value: unknown): value is AssetBackupManifest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["version"] !== 1 || !Array.isArray(v["files"])) return false;
  return (v["files"] as unknown[]).every((f: unknown) => {
    if (typeof f !== "object" || f === null) return false;
    const entry = f as Record<string, unknown>;
    return (
      typeof entry["name"] === "string" &&
      typeof entry["hash"] === "string" &&
      typeof entry["sizeBytes"] === "number"
    );
  });
}

/**
 * Read the manifest for a given `.db` backup file.
 *
 * @returns null when the manifest file does not exist at all — a
 *   legitimate case: backups taken before this feature shipped, or backup
 *   kinds that never call {@link backupAssets} (`pre-update`,
 *   `pre-migration`, `pre-delete`).
 * @throws {@link CorruptedAssetManifestError} when the file exists but
 *   cannot be read as a valid manifest — this is corruption, not absence,
 *   and callers (restoreBackup) must abort rather than treat it as "no
 *   assets to restore".
 */
export function readAssetManifest(dbBackupPath: string): AssetBackupManifest | null {
  const p = assetManifestPath(dbBackupPath);
  if (!existsSync(p)) return null;

  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch (err) {
    throw new CorruptedAssetManifestError(p, err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CorruptedAssetManifestError(p, err);
  }

  if (!isValidManifestShape(parsed)) {
    throw new CorruptedAssetManifestError(p, "manifest JSON does not match the expected shape");
  }

  return parsed;
}

/**
 * Thrown when a manifest references a blob the content-addressed
 * repository does not have. See {@link validateManifestBlobs}.
 */
export class MissingAssetBlobError extends Error {
  constructor(hash: string, name: string) {
    super(
      `Asset backup repository is missing blob "${hash}" for "${name}" — ` +
        `the repository is corrupted or was modified out of band`,
    );
    this.name = "MissingAssetBlobError";
  }
}

/**
 * Verify every blob `manifest` references exists in the repository —
 * WITHOUT copying anything. Cheap (a stat per file), meant to be called
 * before any part of a restore touches world.db, so a missing blob aborts
 * the whole restore instead of leaving world.db swapped and assets/ half
 * (or not at all) restored — see restoreBackup's doc comment in
 * world-manager.ts for the atomicity story this makes possible.
 *
 * @throws {@link MissingAssetBlobError} naming the exact missing blob.
 */
export function validateManifestBlobs(
  manifest: AssetBackupManifest,
  worldBackupsDir: string,
): void {
  const repoDir = assetsRepoDir(worldBackupsDir);
  for (const file of manifest.files) {
    if (!existsSync(join(repoDir, file.hash))) {
      throw new MissingAssetBlobError(file.hash, file.name);
    }
  }
}

/**
 * Write back every file listed in `manifest` from the repository into
 * `worldAssetsDir`.
 *
 * Deliberately a MERGE, not a directory replace: a file that exists in
 * `worldAssetsDir` today but is not in `manifest` (e.g. uploaded after
 * this backup was taken) is left untouched. Restoring a backup answers
 * "bring back what this snapshot remembers", not "make the directory
 * contain nothing but this snapshot" — the world.db side of a restore
 * doesn't wipe unrelated data either, it swaps in the chosen point-in-time
 * file. A destructive replace here would silently delete an asset
 * uploaded five minutes ago because a GM restored a backup from
 * yesterday, with no warning and no way back.
 *
 * Callers should have already run {@link validateManifestBlobs} before
 * touching world.db (see restoreBackup in world-manager.ts) — the check
 * here is defense-in-depth against a blob disappearing between that
 * up-front validation and this write-back (e.g. a concurrent prune), not
 * the primary safety mechanism.
 *
 * @throws {@link MissingAssetBlobError} if the repository is missing a
 *   blob the manifest references.
 */
export async function restoreAssets(
  manifest: AssetBackupManifest,
  worldBackupsDir: string,
  worldAssetsDir: string,
): Promise<void> {
  await mkdir(worldAssetsDir, { recursive: true });
  const repoDir = assetsRepoDir(worldBackupsDir);

  for (const file of manifest.files) {
    const blobPath = join(repoDir, file.hash);
    if (!existsSync(blobPath)) {
      throw new MissingAssetBlobError(file.hash, file.name);
    }
    await copyFile(blobPath, join(worldAssetsDir, file.name));
  }
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

/** Best-effort removal of the manifest that goes with a `.db` backup file. */
export function removeAssetManifest(dbBackupPath: string): void {
  try {
    rmSync(assetManifestPath(dbBackupPath), { force: true });
  } catch {
    // Best-effort — matches pruneBackups()'s handling of the .db file itself.
  }
}

/**
 * Sweep the repository and delete every blob not referenced by any
 * manifest still on disk under `worldBackupsDir`.
 *
 * Must be called after removing one or more backups (and their manifests)
 * so a blob shared by an old, now-deleted backup and a newer, still-live
 * one survives — the whole point of content addressing is that deleting
 * one backup must never corrupt another.
 *
 * @returns the hashes of blobs that were removed.
 */
export function pruneUnreferencedAssetBlobs(worldBackupsDir: string): string[] {
  const repoDir = assetsRepoDir(worldBackupsDir);
  if (!existsSync(repoDir)) return [];

  let backupDirEntries: string[];
  try {
    backupDirEntries = readdirSync(worldBackupsDir);
  } catch {
    return [];
  }

  const referenced = new Set<string>();
  for (const entry of backupDirEntries) {
    if (!entry.endsWith(".assets.json")) continue;
    try {
      const manifest = JSON.parse(
        readFileSync(join(worldBackupsDir, entry), "utf8"),
      ) as AssetBackupManifest;
      for (const file of manifest.files) referenced.add(file.hash);
    } catch {
      // A manifest we can't parse can't tell us what it needs — skip it
      // rather than guess. Worst case: its blobs are kept a bit longer
      // than strictly necessary, which is the safe direction to err in.
    }
  }

  let blobs: string[];
  try {
    blobs = readdirSync(repoDir);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const hash of blobs) {
    if (referenced.has(hash)) continue;
    try {
      rmSync(join(repoDir, hash), { force: true });
      removed.push(hash);
    } catch {
      // Best-effort — matches every other prune operation in this feature.
    }
  }
  return removed;
}
