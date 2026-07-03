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

function lockPath(dataDir: string, slug: string): string {
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
function isProcessAlive(pid: number): boolean {
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
function readLock(lockFilePath: string): WorldLock | null {
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
   */
  maxAutoBackups?: number;
}

export class WorldManager {
  private readonly dataDir: string;
  private readonly validSystemIds: { has(id: string): boolean } | undefined;
  private readonly maxAutoBackups: number;

  /** Map of slug → open world state (in-process). */
  private readonly openWorlds = new Map<string, OpenWorld>();

  constructor(options: WorldManagerOptions) {
    this.dataDir = options.dataDir;
    this.validSystemIds = options.validSystemIds;
    this.maxAutoBackups = options.maxAutoBackups ?? 10;

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
      applyMigrations(fusionDb.raw, dbFilePath);
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
      applyMigrations(fusionDb.raw, dbFilePath);
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
            applyMigrations(fusionDb.raw, dbFilePath);
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

    // Prune old auto backups (REQ-PER-025)
    if (type === "auto") {
      this._pruneAutoBackups(slug);
    }

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

  private _pruneAutoBackups(slug: string): void {
    const bDir = backupsDir(this.dataDir, slug);
    const allBackups = this.listBackups(slug);
    const autoBackups = allBackups.filter((b) => b.type === "auto");

    if (autoBackups.length <= this.maxAutoBackups) return;

    // Sort oldest first, remove the oldest
    const toRemove = autoBackups
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, autoBackups.length - this.maxAutoBackups);

    for (const entry of toRemove) {
      try {
        rmSync(join(bDir, entry.filename), { force: true });
      } catch {
        // Best-effort
      }
    }
  }

  private _backupType(filename: string): BackupEntry["type"] {
    if (filename.startsWith("auto-")) return "auto";
    if (filename.startsWith("manual-")) return "manual";
    if (filename.startsWith("pre-delete-")) return "pre-delete";
    if (filename.startsWith("pre-restore-")) return "pre-restore";
    if (filename.startsWith("pre-migration-")) return "pre-migration";
    return "manual";
  }

  private _backupTimestamp(filename: string): number {
    // Filenames like "auto-1717000000000.db"
    const match = /(\d{10,})\.db$/.exec(filename);
    return match?.[1] !== undefined ? parseInt(match[1], 10) : 0;
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
