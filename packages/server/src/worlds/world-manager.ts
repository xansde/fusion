/**
 * WorldManager — manages world lifecycle: create, open, close, list, delete, backup.
 *
 * REQ-PER-009: process lock (world.lock)
 * REQ-PER-010: world.json manifest
 * REQ-PER-012..016: CRUD operations on worlds
 * REQ-PER-024..027: backup support
 * DEC-PER-03: one DB per world
 * DEC-PER-06: process lock via world.lock
 */

import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  statSync,
  copyFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { openDatabase, applyMigrations, DatabaseCorruptionError } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { runGc, formatGcReport } from "../db/gc.js";
import type { GcOptions } from "../db/gc.js";
import { DEFAULT_GC_SESSION_RETENTION_DAYS, DEFAULT_GC_AUDIT_RETENTION_MONTHS } from "../config.js";
import {
  FUSION_VERSION,
  MINIMUM_FUSION_DATA_FORMAT,
  type WorldManifest,
  type WorldLock,
  type BackupEntry,
  type CreateWorldOptions,
} from "@fusion/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLUG_REGEX = /^[a-z0-9_]{1,64}$/;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class WorldNotFoundError extends Error {
  constructor(slug: string) {
    super(`World "${slug}" not found`);
    this.name = "WorldNotFoundError";
  }
}

export class WorldLockedError extends Error {
  constructor(
    slug: string,
    public readonly lockedByPid: number,
  ) {
    super(
      `World "${slug}" is already in use by process ${String(lockedByPid)}. ` +
        `Close the other instance before continuing.`,
    );
    this.name = "WorldLockedError";
  }
}

export class WorldAlreadyOpenError extends Error {
  constructor(slug: string) {
    super(`World "${slug}" is already open in this manager`);
    this.name = "WorldAlreadyOpenError";
  }
}

export class InvalidSlugError extends Error {
  constructor(slug: string) {
    super(
      `Invalid world slug "${slug}". ` +
        `Slug must match [a-z0-9_]{1,64} (lowercase letters, digits and underscores only).`,
    );
    this.name = "InvalidSlugError";
  }
}

export class WorldSystemNotFoundError extends Error {
  constructor(systemId: string) {
    super(`System "${systemId}" is not registered in the SystemRegistry`);
    this.name = "WorldSystemNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface OpenWorld {
  db: FusionDatabase;
  manifest: WorldManifest;
  lockPath: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "world"
  );
}

function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

function worldDir(dataDir: string, slug: string): string {
  return join(dataDir, "worlds", slug);
}

export function lockPath(dataDir: string, slug: string): string {
  return join(worldDir(dataDir, slug), "world.lock");
}

function manifestPath(dataDir: string, slug: string): string {
  return join(worldDir(dataDir, slug), "world.json");
}

function dbPath(dataDir: string, slug: string): string {
  return join(worldDir(dataDir, slug), "world.db");
}

function backupsDir(dataDir: string, slug: string): string {
  return join(worldDir(dataDir, slug), "backups");
}

function readManifest(dataDir: string, slug: string): WorldManifest {
  const p = manifestPath(dataDir, slug);
  if (!existsSync(p)) throw new WorldNotFoundError(slug);
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as WorldManifest;
}

function writeManifest(dataDir: string, slug: string, manifest: WorldManifest): void {
  const p = manifestPath(dataDir, slug);
  writeFileSync(p, JSON.stringify(manifest, null, 2), "utf8");
}

/**
 * Check whether a process with the given PID is running on this OS.
 * Returns false if the process is not found (stale lock).
 */
export function isProcessAlive(pid: number): boolean {
  try {
    // signal 0 — does not kill but checks whether the process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and validate the world.lock file.
 * Returns the lock content or null if the file does not exist.
 */
export function readLock(lockFilePath: string): WorldLock | null {
  if (!existsSync(lockFilePath)) return null;
  try {
    const raw = readFileSync(lockFilePath, "utf8");
    return JSON.parse(raw) as WorldLock;
  } catch {
    // Corrupted lock file — treat as stale
    return null;
  }
}

function writeLock(lockFilePath: string): void {
  const lock: WorldLock = {
    pid: process.pid,
    started_at: new Date().toISOString(),
  };
  writeFileSync(lockFilePath, JSON.stringify(lock), "utf8");
}

function removeLock(lockFilePath: string): void {
  try {
    rmSync(lockFilePath, { force: true });
  } catch {
    // Best-effort — if removal fails the lock will be treated as stale next time
  }
}

// ---------------------------------------------------------------------------
// WorldManager
// ---------------------------------------------------------------------------

/**
 * How many backups of each kind to keep, per world.
 *
 * Only `auto` had a limit before: every pre-migration, pre-delete,
 * pre-restore and pre-update backup was a full copy of the database kept
 * forever. On a world that migrates often that is unbounded growth in a
 * directory nobody looks at.
 *
 * `manual` is deliberately unlimited: a backup someone asked for by hand does
 * not disappear on its own — same reasoning as chat in D5. Any value <= 0
 * means "keep everything".
 */
export type BackupRetention = Record<BackupEntry["type"], number>;

const DEFAULT_BACKUP_RETENTION: BackupRetention = {
  auto: 10, // REQ-PER-025
  manual: 0, // unlimited — human intent, never pruned automatically
  "pre-migration": 5,
  "pre-delete": 3,
  "pre-restore": 3,
  "pre-update": 5,
};

export interface WorldManagerOptions {
  /** Root data directory (the fusion-data/ equivalent). */
  dataDir: string;
  /**
   * Optional set of valid system IDs.
   * When provided, create() validates that the requested system is registered.
   */
  validSystemIds?: ReadonlySet<string> | { has(id: string): boolean };
  /**
   * Maximum number of automatic backups per world before pruning.
   * Default: 10 (REQ-PER-025).
   *
   * Shorthand for `backupRetention: { auto: n }`; the explicit map wins.
   */
  maxAutoBackups?: number;
  /**
   * Per-type backup retention. Merged over {@link DEFAULT_BACKUP_RETENTION},
   * so passing `{ "pre-migration": 2 }` only changes that one.
   */
  backupRetention?: Partial<BackupRetention>;
  /**
   * Open worlds whose schema diverges from this build's migrations instead of
   * refusing (D6 escape hatch — `fusion serve --force-schema`).
   */
  forceSchema?: boolean;
  /**
   * Retention window for the boot-time GC (T017, D5), run once per
   * `open()` right after migrations succeed. Omit either field (or the
   * whole option) to use the same defaults `ServerConfig` ships with
   * (`config.ts`'s `DEFAULT_GC_SESSION_RETENTION_DAYS` /
   * `DEFAULT_GC_AUDIT_RETENTION_MONTHS`) — this mirrors `backupRetention`
   * above: a per-instance override that falls back to the product default
   * when the caller does not have a loaded `ServerConfig` to thread through
   * (see `db/gc.ts` for what `0`/`null` mean: disable that target, not
   * "collect everything").
   */
  gcOptions?: Pick<GcOptions, "sessionRetentionDays" | "auditRetentionMonths">;
}

export class WorldManager {
  private readonly dataDir: string;
  private readonly validSystemIds: { has(id: string): boolean } | undefined;
  private readonly backupRetention: BackupRetention;
  private readonly forceSchema: boolean;
  private readonly gcOptions: Pick<GcOptions, "sessionRetentionDays" | "auditRetentionMonths">;

  /** Map of slug → open world state (in-process). */
  private readonly openWorlds = new Map<string, OpenWorld>();

  constructor(options: WorldManagerOptions) {
    this.dataDir = options.dataDir;
    this.validSystemIds = options.validSystemIds;
    this.forceSchema = options.forceSchema ?? false;
    this.backupRetention = {
      ...DEFAULT_BACKUP_RETENTION,
      ...(options.maxAutoBackups !== undefined ? { auto: options.maxAutoBackups } : {}),
      ...options.backupRetention,
    };
    this.gcOptions = {
      sessionRetentionDays:
        options.gcOptions?.sessionRetentionDays ?? DEFAULT_GC_SESSION_RETENTION_DAYS,
      auditRetentionMonths:
        options.gcOptions?.auditRetentionMonths ?? DEFAULT_GC_AUDIT_RETENTION_MONTHS,
    };

    // Ensure base directories exist
    mkdirSync(join(this.dataDir, "worlds"), { recursive: true });
    mkdirSync(join(this.dataDir, "trash"), { recursive: true });
  }

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  /**
   * Create a new world.
   *
   * REQ-PER-013:
   *  - Validates slug uniqueness and format.
   *  - Creates directory structure.
   *  - Initialises world.db with PRAGMAs + migrations.
   *  - Writes world.json.
   */
  create(options: CreateWorldOptions): WorldManifest {
    const slug = options.slug ? options.slug : slugify(options.title);

    if (!isValidSlug(slug)) {
      throw new InvalidSlugError(slug);
    }

    const dir = worldDir(this.dataDir, slug);
    if (existsSync(dir)) {
      throw new Error(`World with slug "${slug}" already exists`);
    }

    if (this.validSystemIds && !this.validSystemIds.has(options.system)) {
      throw new WorldSystemNotFoundError(options.system);
    }

    // Create directory structure
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, "assets"), { recursive: true });
    mkdirSync(join(dir, "backups"), { recursive: true });

    // Create and initialise DB (skip integrity check on brand-new DB)
    const dbFilePath = dbPath(this.dataDir, slug);
    const fusionDb = openDatabase({ path: dbFilePath, skipIntegrityCheck: true });

    try {
      applyMigrations(fusionDb.raw, dbFilePath, { force: this.forceSchema });
    } finally {
      fusionDb.close();
    }

    const now = new Date().toISOString();
    const manifest: WorldManifest = {
      id: slug,
      title: options.title,
      system: options.system,
      systemVersion: "0.0.0",
      fusionVersion: FUSION_VERSION,
      schemaVersion: 1,
      description: options.description ?? "",
      ...(options.coverImage !== undefined ? { coverImage: options.coverImage } : {}),
      createdAt: now,
      lastOpenedAt: now,
      playTime: 0,
      compatibility: {
        // M6/B3: the data-format floor, NOT the creating binary's version —
        // see shared/src/version.ts's doc comment on MINIMUM_FUSION_DATA_FORMAT.
        minimumFusion: MINIMUM_FUSION_DATA_FORMAT,
      },
    };

    writeManifest(this.dataDir, slug, manifest);
    return manifest;
  }

  // --------------------------------------------------------------------------
  // Open
  // --------------------------------------------------------------------------

  /**
   * Open a world by slug.
   *
   * REQ-PER-009 (process lock):
   *  - If world.lock exists and PID is alive → WorldLockedError.
   *  - If world.lock exists but PID is dead → removes stale lock and continues.
   *  - Writes fresh world.lock with current PID.
   *
   * REQ-PER-005: runs integrity_check via openDatabase.
   * REQ-PER-011: updates lastOpenedAt in world.json.
   */
  open(slug: string): WorldManifest {
    if (!isValidSlug(slug)) throw new InvalidSlugError(slug);

    if (this.openWorlds.has(slug)) throw new WorldAlreadyOpenError(slug);

    const dir = worldDir(this.dataDir, slug);
    if (!existsSync(dir)) throw new WorldNotFoundError(slug);

    // -- Process lock handling (REQ-PER-009) --
    const lock = lockPath(this.dataDir, slug);
    const existingLock = readLock(lock);

    if (existingLock !== null) {
      if (isProcessAlive(existingLock.pid)) {
        throw new WorldLockedError(slug, existingLock.pid);
      }
      // Stale lock — remove it
      removeLock(lock);
    }

    // REQ-PER-040: check for WAL/SHM without main db (inconsistent state)
    const dbFilePath = dbPath(this.dataDir, slug);
    const walPath = `${dbFilePath}-wal`;
    const shmPath = `${dbFilePath}-shm`;
    const mainExists = existsSync(dbFilePath);
    const walExists = existsSync(walPath);
    const shmExists = existsSync(shmPath);

    if (!mainExists && (walExists || shmExists)) {
      throw new Error(
        `World "${slug}" is in an inconsistent state: WAL/SHM files exist without world.db. ` +
          `Manual recovery is required.`,
      );
    }

    // Write fresh lock before opening DB
    writeLock(lock);

    let fusionDb: FusionDatabase;
    try {
      fusionDb = openDatabase({ path: dbFilePath });
      applyMigrations(fusionDb.raw, dbFilePath, { force: this.forceSchema });
    } catch (err) {
      // Release lock on failure
      removeLock(lock);

      // REQ-PER-005 / CA-PER-05: attempt auto-recovery when corruption is detected.
      if (err instanceof DatabaseCorruptionError) {
        const recovered = this._attemptCorruptionRecovery(slug, dbFilePath, err);
        if (recovered) {
          // Retry: re-acquire lock and open the restored database.
          writeLock(lock);
          try {
            fusionDb = openDatabase({ path: dbFilePath });
            applyMigrations(fusionDb.raw, dbFilePath, { force: this.forceSchema });
          } catch (retryErr) {
            removeLock(lock);
            throw retryErr;
          }
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // Boot-time GC (T017, D5) — expired sessions and stale roll-audit-log
    // rows, run once per open, strictly AFTER migrations have succeeded
    // above (never before: GC assumes the schema the current build expects).
    // Best-effort: a GC failure must not prevent the world from opening —
    // there is no scenario where refusing to let the GM play is the right
    // response to a cleanup pass failing.
    try {
      const report = runGc(fusionDb.raw, this.gcOptions);
      const line = formatGcReport(report);
      if (line !== null) {
        // stderr, like every other diagnostic in this file: stdout carries
        // command output, and a maintenance line has no business in it.
        process.stderr.write(`${line} (world "${slug}")\n`);
      }
    } catch (err) {
      process.stderr.write(
        `[fusion:world-manager] GC failed for world "${slug}" — continuing without it. ${String(err)}\n`,
      );
    }

    // Pre-migration backups are written by the migration framework, which knows
    // nothing about retention — this is the only place that can prune them.
    this.pruneBackups(slug, ["pre-migration"]);

    // Read and update manifest (REQ-PER-011)
    const manifest = readManifest(this.dataDir, slug);
    manifest.lastOpenedAt = new Date().toISOString();
    manifest.fusionVersion = FUSION_VERSION;
    writeManifest(this.dataDir, slug, manifest);

    this.openWorlds.set(slug, { db: fusionDb, manifest, lockPath: lock });
    return manifest;
  }

  // --------------------------------------------------------------------------
  // Close
  // --------------------------------------------------------------------------

  /**
   * Close an open world.
   * Flushes WAL via checkpoint, releases lock.
   */
  close(slug: string): void {
    const world = this.openWorlds.get(slug);
    if (!world) return; // already closed or never opened

    try {
      world.db.close(); // includes WAL checkpoint (TRUNCATE)
    } finally {
      removeLock(world.lockPath);
      this.openWorlds.delete(slug);
    }
  }

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------

  /**
   * List all worlds available in the data directory.
   * Returns WorldManifest for each world that has a world.json.
   */
  list(): WorldManifest[] {
    const worldsDir = join(this.dataDir, "worlds");
    if (!existsSync(worldsDir)) return [];

    const results: WorldManifest[] = [];
    let entries: string[];
    try {
      entries = readdirSync(worldsDir);
    } catch {
      return [];
    }

    for (const entry of entries) {
      const mp = join(worldsDir, entry, "world.json");
      if (!existsSync(mp)) continue;
      try {
        const raw = readFileSync(mp, "utf8");
        results.push(JSON.parse(raw) as WorldManifest);
      } catch {
        // Skip invalid manifests
      }
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Get
  // --------------------------------------------------------------------------

  /** Get manifest for a specific world (reads world.json). */
  getManifest(slug: string): WorldManifest {
    return readManifest(this.dataDir, slug);
  }

  /** Return the open DB handle for a world (null if not open). */
  getDatabase(slug: string): FusionDatabase | null {
    return this.openWorlds.get(slug)?.db ?? null;
  }

  // --------------------------------------------------------------------------
  // Delete (soft — moves to trash)
  // --------------------------------------------------------------------------

  /**
   * Delete a world by moving it to the trash directory (soft-delete).
   *
   * Design decision: REQ-PER-014.3 states "remove the world directory recursively".
   * We implement a soft-delete instead — the directory is renamed to
   * dataDir/trash/<slug>-<timestamp> — because it is safer (operator can still
   * recover from trash) and the pre-delete backup is co-located with the trashed
   * world. This diverges from the literal spec but satisfies the intent (the world
   * becomes inaccessible) while adding a safety net.
   *
   * If hard deletion is ever needed, a `hardDelete` option can be added that
   * calls rmSync on the trash entry after the rename.
   *
   * REQ-PER-014:
   *  - Refuses if world.lock is active.
   *  - Creates pre-delete backup of world.db.
   *  - Moves entire world directory to dataDir/trash/<slug>-<ts>.
   */
  delete(slug: string): void {
    if (!isValidSlug(slug)) throw new InvalidSlugError(slug);

    const dir = worldDir(this.dataDir, slug);
    if (!existsSync(dir)) throw new WorldNotFoundError(slug);

    // Refuse if currently open (in this process)
    if (this.openWorlds.has(slug)) {
      throw new Error(`Cannot delete world "${slug}" while it is open. Close it first.`);
    }

    // Check for active lock from another process
    const lock = lockPath(this.dataDir, slug);
    const existingLock = readLock(lock);
    if (existingLock !== null && isProcessAlive(existingLock.pid)) {
      throw new WorldLockedError(slug, existingLock.pid);
    }

    // Create pre-delete backup (REQ-PER-014)
    const dbFilePath = dbPath(this.dataDir, slug);
    if (existsSync(dbFilePath)) {
      const bDir = backupsDir(this.dataDir, slug);
      mkdirSync(bDir, { recursive: true });
      const ts = Date.now();
      copyFileSync(dbFilePath, join(bDir, `pre-delete-${String(ts)}.db`));
      // Prune before the directory moves to trash, so the trashed copy does not
      // carry every pre-delete backup this world ever accumulated.
      this.pruneBackups(slug, ["pre-delete"]);
    }

    // Move to trash (non-destructive)
    const trashDir = join(this.dataDir, "trash");
    mkdirSync(trashDir, { recursive: true });
    const dest = join(trashDir, `${slug}-${String(Date.now())}`);
    renameSync(dir, dest);
  }

  // --------------------------------------------------------------------------
  // Backup
  // --------------------------------------------------------------------------

  /**
   * Create a backup of a world's database.
   *
   * Uses Database.backup() (online backup API) — safe while the world is open.
   * Falls back to file copy when the world is closed.
   *
   * REQ-PER-024..026.
   */
  async backup(slug: string, type: "auto" | "manual"): Promise<BackupEntry> {
    if (!isValidSlug(slug)) throw new InvalidSlugError(slug);

    const dir = worldDir(this.dataDir, slug);
    if (!existsSync(dir)) throw new WorldNotFoundError(slug);

    const bDir = backupsDir(this.dataDir, slug);
    mkdirSync(bDir, { recursive: true });

    const ts = Date.now();
    const filename = `${type}-${String(ts)}.db`;
    const destPath = join(bDir, filename);

    const openWorld = this.openWorlds.get(slug);

    if (openWorld) {
      // World is open — use online backup API (non-blocking for readers)
      await openWorld.db.raw.backup(destPath);
    } else {
      // World is closed — safe to copy file directly
      const srcPath = dbPath(this.dataDir, slug);
      if (!existsSync(srcPath)) {
        throw new Error(`world.db not found for "${slug}"`);
      }
      copyFileSync(srcPath, destPath);
    }

    // Prune old backups of this kind (REQ-PER-025)
    this.pruneBackups(slug, [type]);

    const stat = statSync(destPath);
    return {
      filename,
      type,
      timestamp: ts,
      sizeBytes: stat.size,
      path: destPath,
    };
  }

  /**
   * Create a pre-update backup with the exact canonical filename
   * REQ-DST-022 specifies: `pre-event-update-<version>-<timestamp-ISO>.db`
   * (distinct from the generic `<type>-<epochMs>.db` naming `backup()`
   * uses for auto/manual/pre-delete/pre-restore/pre-migration — the design
   * doc §2.1 point 3 and the spec both call out this exact filename shape,
   * which an ISO timestamp with colons would break as-is on Windows
   * filesystems, hence the colon-stripped ISO below).
   *
   * Reuses the SAME online-backup-API-when-open / file-copy-when-closed
   * logic as {@link backup} — this is deliberately NOT a call to
   * `backup(slug, "pre-update")`, because that generic method's filename
   * format (`pre-update-<epochMs>.db`) does not match the canonical
   * `pre-event-update-<version>-<ISO>.db` shape the spec requires callers
   * (update/updater.ts) to produce.
   */
  async backupPreUpdate(slug: string, version: string): Promise<BackupEntry> {
    if (!isValidSlug(slug)) throw new InvalidSlugError(slug);

    const dir = worldDir(this.dataDir, slug);
    if (!existsSync(dir)) throw new WorldNotFoundError(slug);

    const bDir = backupsDir(this.dataDir, slug);
    mkdirSync(bDir, { recursive: true });

    const ts = Date.now();
    // Colons are invalid in Windows filenames — strip them from the ISO
    // string (keeping it lexically sortable and still round-trippable via
    // Date parsing if colons are reinserted before the seconds/millis part).
    const isoSafe = new Date(ts).toISOString().replace(/:/g, "-");
    const filename = `pre-event-update-${version}-${isoSafe}.db`;
    const destPath = join(bDir, filename);

    const openWorld = this.openWorlds.get(slug);
    if (openWorld) {
      await openWorld.db.raw.backup(destPath);
    } else {
      const srcPath = dbPath(this.dataDir, slug);
      if (!existsSync(srcPath)) {
        throw new Error(`world.db not found for "${slug}"`);
      }
      copyFileSync(srcPath, destPath);
    }

    this.pruneBackups(slug, ["pre-update"]);

    const stat = statSync(destPath);
    return {
      filename,
      type: "pre-update",
      timestamp: ts,
      sizeBytes: stat.size,
      path: destPath,
    };
  }

  /**
   * List all backups for a world.
   * REQ-PER-027.
   */
  listBackups(slug: string): BackupEntry[] {
    const bDir = backupsDir(this.dataDir, slug);
    if (!existsSync(bDir)) return [];

    let files: string[];
    try {
      files = readdirSync(bDir);
    } catch {
      return [];
    }

    return files
      .filter((f) => f.endsWith(".db"))
      .map((filename) => {
        const fullPath = join(bDir, filename);
        const stat = statSync(fullPath);
        const type = this._backupType(filename);
        const timestamp = this._backupTimestamp(filename);
        return {
          filename,
          type,
          timestamp,
          sizeBytes: stat.size,
          path: fullPath,
        } satisfies BackupEntry;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Attempt to recover from a corrupted world.db.
   *
   * CA-PER-05 / REQ-PER-005: on DatabaseCorruptionError:
   *  1. Rename the corrupted file to world.db.corrupted.<timestamp>.
   *  2. Find the most recent backup in backups/.
   *  3. Copy it to world.db and return true.
   *  4. If no backup is available, return false (caller must rethrow).
   *
   * @returns true if a backup was successfully restored, false otherwise.
   */
  private _attemptCorruptionRecovery(
    slug: string,
    dbFilePath: string,
    err: DatabaseCorruptionError,
  ): boolean {
    const ts = Date.now();
    const corruptedPath = `${dbFilePath}.corrupted.${String(ts)}`;

    // Log the corruption details for operators.
    // Use process.stderr directly — WorldManager has no injected logger instance.
    process.stderr.write(
      `[fusion:world-manager] FATAL: world "${slug}" failed integrity check. ` +
        `Integrity result: ${err.integrityResult}. ` +
        `Renaming corrupted file to: ${corruptedPath}\n`,
    );

    try {
      renameSync(dbFilePath, corruptedPath);
    } catch {
      process.stderr.write(
        `[fusion:world-manager] Could not rename corrupted database for world "${slug}"\n`,
      );
      return false;
    }

    // Find the most recent backup.
    const backups = this.listBackups(slug);
    if (backups.length === 0) {
      process.stderr.write(
        `[fusion:world-manager] No backup available to restore world "${slug}". ` +
          `Manual recovery required. Corrupted file kept at: ${corruptedPath}\n`,
      );
      return false;
    }

    // listBackups sorts oldest→newest; pick the last entry.
    const latestBackup = backups[backups.length - 1];

    if (!latestBackup) {
      return false;
    }

    process.stderr.write(
      `[fusion:world-manager] Restoring world "${slug}" from backup: ${latestBackup.filename}\n`,
    );

    try {
      copyFileSync(latestBackup.path, dbFilePath);
    } catch {
      process.stderr.write(
        `[fusion:world-manager] Failed to copy backup "${latestBackup.filename}" ` +
          `for world "${slug}"\n`,
      );
      return false;
    }

    process.stderr.write(
      `[fusion:world-manager] World "${slug}" restored from backup "${latestBackup.filename}".\n`,
    );
    return true;
  }

  /**
   * Prune backups down to the configured retention.
   *
   * @param types Which kinds to prune. Omit to prune every kind — used after
   *              open(), which is when pre-migration backups appear (they are
   *              written by the migration framework, not by this class).
   * @returns the filenames removed.
   */
  pruneBackups(slug: string, types?: readonly BackupEntry["type"][]): string[] {
    const bDir = backupsDir(this.dataDir, slug);
    const all = this.listBackups(slug);
    const kinds = types ?? (Object.keys(this.backupRetention) as BackupEntry["type"][]);
    const removed: string[] = [];

    for (const type of kinds) {
      const limit = this.backupRetention[type];
      if (limit <= 0) continue; // unlimited

      const ofType = all.filter((b) => b.type === type).sort((a, b) => a.timestamp - b.timestamp);
      if (ofType.length <= limit) continue;

      // listBackups sorts oldest→newest; drop from the front.
      for (const entry of ofType.slice(0, ofType.length - limit)) {
        try {
          rmSync(join(bDir, entry.filename), { force: true });
          removed.push(entry.filename);
        } catch {
          // Best-effort
        }
      }
    }

    return removed;
  }

  private _backupType(filename: string): BackupEntry["type"] {
    if (filename.startsWith("pre-event-update-")) return "pre-update";
    if (filename.startsWith("auto-")) return "auto";
    if (filename.startsWith("manual-")) return "manual";
    if (filename.startsWith("pre-delete-")) return "pre-delete";
    if (filename.startsWith("pre-restore-")) return "pre-restore";
    if (filename.startsWith("pre-migration-")) return "pre-migration";
    return "manual";
  }

  private _backupTimestamp(filename: string): number {
    // Filenames like "auto-1717000000000.db" (epoch-ms suffix).
    const epochMatch = /(\d{10,})\.db$/.exec(filename);
    if (epochMatch?.[1] !== undefined) return parseInt(epochMatch[1], 10);

    // Filenames like "pre-event-update-1.2.3-2026-07-03T10-56-14.799Z.db"
    // (colon-stripped ISO suffix — see backupPreUpdate's `.replace(/:/g, "-")`,
    // which only touches the two literal colons in "THH:MM:SS" — the
    // milliseconds separator stays a literal "."). Reinsert the two colons
    // before parsing.
    const isoMatch = /(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3}Z)\.db$/.exec(filename);
    const datePart = isoMatch?.[1];
    const minutes = isoMatch?.[2];
    const secondsAndMs = isoMatch?.[3];
    if (datePart !== undefined && minutes !== undefined && secondsAndMs !== undefined) {
      const reconstructed = `${datePart}:${minutes}:${secondsAndMs}`;
      const parsed = Date.parse(reconstructed);
      if (!Number.isNaN(parsed)) return parsed;
    }

    return 0;
  }

  // --------------------------------------------------------------------------
  // Cleanup — close all open worlds (for graceful shutdown)
  // --------------------------------------------------------------------------

  closeAll(): void {
    for (const slug of [...this.openWorlds.keys()]) {
      this.close(slug);
    }
  }
}
