/**
 * Integration tests for T024 — world backups include assets (D4).
 *
 * All tests use real directories in OS temp — no mocks, no in-memory fs.
 *
 * Covers the literal "pronto quando" from docs/design/banco-de-dados/tasks.md:
 *   backup -> apaga assets -> restaura -> todas as referencias resolvem
 * plus the two failure modes a naive dedup/backup implementation falls into:
 *   - re-copying unchanged assets on every backup (dedup)
 *   - a prune deleting a blob a surviving backup still needs (poda segura)
 * and the constraint that content hashing must never trust the filename.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import { WorldManager } from "../worlds/index.js";
import { assetsRepoDir, backupAssets } from "../worlds/asset-backup.js";
import { DocumentStore } from "../documents/index.js";
import { runWorldRestoreCommand } from "../cli/commands/worlds.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-wba-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

let tempDirs: string[] = [];

beforeEach(() => {
  tempDirs = [];
});

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  }
});

function newTempDir(): string {
  const dir = makeTempDir();
  tempDirs.push(dir);
  return dir;
}

function worldAssetsDir(dataDir: string, slug: string): string {
  return join(dataDir, "worlds", slug, "assets");
}

function worldBackupsDir(dataDir: string, slug: string): string {
  return join(dataDir, "worlds", slug, "backups");
}

function worldDbPath(dataDir: string, slug: string): string {
  return join(dataDir, "worlds", slug, "world.db");
}

function writeAsset(dataDir: string, slug: string, name: string, content: Buffer): void {
  const dir = worldAssetsDir(dataDir, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content);
}

/** Sum of file sizes directly inside `dir` (the repo is flat — no subdirs). */
function dirTotalBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const stat = statSync(join(dir, name));
    if (stat.isFile()) total += stat.size;
  }
  return total;
}

function dirFileCount(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile()).length;
}

/** Placeholder backup file with a canonical name, mirroring the pattern
 * world-manager.test.ts uses to control timestamps precisely (Date.now()
 * has millisecond resolution — a loop of real backup() calls can collide). */
function seedDbBackup(dataDir: string, slug: string, filename: string, content: string): string {
  const bDir = worldBackupsDir(dataDir, slug);
  mkdirSync(bDir, { recursive: true });
  const p = join(bDir, filename);
  writeFileSync(p, content, "utf8");
  return p;
}

// ---------------------------------------------------------------------------
// The literal "pronto quando"
// ---------------------------------------------------------------------------

describe("T024 — backup/restore includes assets (D4)", () => {
  it("backup -> delete assets dir -> restore -> every document's asset reference resolves to a real file", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "Backup Assets World", system: "pf2e", slug: "bk_assets" });

    // Two assets, referenced by two different documents — this is what the
    // GM actually feels: an Actor portrait and a Scene background loading.
    const goblinPng = randomBytes(1200);
    const mapJpg = randomBytes(3400);
    writeAsset(dataDir, "bk_assets", "goblin-1a2b3c4d.png", goblinPng);
    // No hash in this name — mirrors taverna-demo.jpg in the real world
    // (seeded by script, predates the upload naming convention).
    writeAsset(dataDir, "bk_assets", "taverna-demo.jpg", mapJpg);

    wm.open("bk_assets");
    const db = wm.getDatabase("bk_assets");
    if (!db) throw new Error("world did not open");
    const store = new DocumentStore({ db: db.raw, defaultAuthor: { userId: "gm" } });

    const goblin = store.create("actors", {
      name: "Goblin",
      type: "npc",
      img: "assets/goblin-1a2b3c4d.png",
    });
    const scene = store.create("scenes", {
      name: "The Sleeping Dragon",
      background: "assets/taverna-demo.jpg",
    });
    wm.close("bk_assets");

    const entry = await wm.backup("bk_assets", "manual");
    expect(entry.filename).toMatch(/^manual-\d+\.db$/);

    // Wipe the assets directory entirely — the exact disaster this feature
    // exists to survive.
    rmSync(worldAssetsDir(dataDir, "bk_assets"), { recursive: true, force: true });
    expect(existsSync(worldAssetsDir(dataDir, "bk_assets"))).toBe(false);

    const result = await wm.restoreBackup("bk_assets", entry.filename);
    expect(result.assetsRestored).toBe(true);
    expect(result.preRestoreBackup).not.toBeNull();

    // Not "N files copied" — resolve each document's actual reference, the
    // way the table the GM sits at experiences it.
    wm.open("bk_assets");
    const db2 = wm.getDatabase("bk_assets");
    if (!db2) throw new Error("world did not reopen");
    const store2 = new DocumentStore({ db: db2.raw, defaultAuthor: { userId: "gm" } });

    const goblinAfter = store2.get("actors", goblin._id as string);
    const sceneAfter = store2.get("scenes", scene._id as string);
    wm.close("bk_assets");

    const goblinName = (goblinAfter.img as string).replace(/^assets\//, "");
    const sceneName = (sceneAfter.background as string).replace(/^assets\//, "");

    const goblinPath = join(worldAssetsDir(dataDir, "bk_assets"), goblinName);
    const scenePath = join(worldAssetsDir(dataDir, "bk_assets"), sceneName);

    expect(existsSync(goblinPath)).toBe(true);
    expect(existsSync(scenePath)).toBe(true);
    expect(readFileSync(goblinPath).equals(goblinPng)).toBe(true);
    expect(readFileSync(scenePath).equals(mapJpg)).toBe(true);
  });

  it("restore does not delete an asset uploaded after the backup was taken (merge, not replace)", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "Merge World", system: "pf2e", slug: "merge_bk" });

    const oldAsset = randomBytes(500);
    writeAsset(dataDir, "merge_bk", "old-asset.png", oldAsset);

    const entry = await wm.backup("merge_bk", "manual");

    // Uploaded after the backup — must survive a restore of that backup.
    const newAsset = randomBytes(500);
    writeAsset(dataDir, "merge_bk", "new-asset.png", newAsset);

    await wm.restoreBackup("merge_bk", entry.filename);

    const assetsDir = worldAssetsDir(dataDir, "merge_bk");
    expect(existsSync(join(assetsDir, "old-asset.png"))).toBe(true);
    expect(existsSync(join(assetsDir, "new-asset.png"))).toBe(true);
    expect(readFileSync(join(assetsDir, "new-asset.png")).equals(newAsset)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Dedup — measure bytes in the repository, not call counts.
  // -------------------------------------------------------------------------

  it("two backups of unchanged assets copy zero new bytes into the repository", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "Dedup World", system: "pf2e", slug: "dedup_bk" });

    const content = randomBytes(5000);
    writeAsset(dataDir, "dedup_bk", "unchanged.png", content);

    await wm.backup("dedup_bk", "manual");
    const repoDir = assetsRepoDir(worldBackupsDir(dataDir, "dedup_bk"));
    const bytesAfterFirst = dirTotalBytes(repoDir);
    const filesAfterFirst = dirFileCount(repoDir);

    expect(bytesAfterFirst).toBe(content.length);
    expect(filesAfterFirst).toBe(1);

    // Same content, second backup — must not add a second copy.
    await wm.backup("dedup_bk", "manual");
    const bytesAfterSecond = dirTotalBytes(repoDir);
    const filesAfterSecond = dirFileCount(repoDir);

    expect(bytesAfterSecond).toBe(bytesAfterFirst);
    expect(filesAfterSecond).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Safe pruning — the failure mode this feature exists to prevent.
  // -------------------------------------------------------------------------

  it("pruning the older of two backups sharing an asset keeps the newer one restorable", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir, backupRetention: { manual: 1 } });
    wm.create({ title: "Prune Safety World", system: "pf2e", slug: "prune_assets" });

    const shared = randomBytes(2000);
    writeAsset(dataDir, "prune_assets", "shared.png", shared);

    // Two manual backups, distinct timestamps, both referencing the SAME
    // asset content (identical bytes -> identical hash -> shared blob).
    const older = seedDbBackup(dataDir, "prune_assets", "manual-1700000000000.db", "backup-1");
    await backupAssets(
      worldAssetsDir(dataDir, "prune_assets"),
      worldBackupsDir(dataDir, "prune_assets"),
      older,
    );

    const newer = seedDbBackup(dataDir, "prune_assets", "manual-1700000001000.db", "backup-2");
    await backupAssets(
      worldAssetsDir(dataDir, "prune_assets"),
      worldBackupsDir(dataDir, "prune_assets"),
      newer,
    );

    const repoDir = assetsRepoDir(worldBackupsDir(dataDir, "prune_assets"));
    expect(dirFileCount(repoDir)).toBe(1); // deduped to one blob before any pruning

    // retention.manual = 1 -> prunes the older manual backup, keeping the newer.
    const removed = wm.pruneBackups("prune_assets", ["manual"]);
    expect(removed).toEqual(["manual-1700000000000.db"]);

    // The manifest for the pruned backup is gone...
    expect(existsSync(`${older.slice(0, -3)}.assets.json`)).toBe(false);
    // ...but the newer backup's manifest, and the blob it needs, survive.
    expect(existsSync(`${newer.slice(0, -3)}.assets.json`)).toBe(true);
    expect(dirFileCount(repoDir)).toBe(1);

    // Prove it, don't just infer it: actually restore from the survivor.
    rmSync(worldAssetsDir(dataDir, "prune_assets"), { recursive: true, force: true });
    const result = await wm.restoreBackup("prune_assets", "manual-1700000001000.db");
    expect(result.assetsRestored).toBe(true);

    const restoredPath = join(worldAssetsDir(dataDir, "prune_assets"), "shared.png");
    expect(existsSync(restoredPath)).toBe(true);
    expect(readFileSync(restoredPath).equals(shared)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Content hashing must never trust the filename.
  // -------------------------------------------------------------------------

  it("dedups by content hash even when one filename has no hash and the other's 'hash' is fake", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "Hash Trust World", system: "pf2e", slug: "hash_trust" });

    const content = randomBytes(900);
    // Looks like the REQ-SEC-040 naming convention (slug + 8 hex chars) but
    // the "hash" suffix is fabricated and does not match this content's
    // real digest — if the code ever trusted the filename instead of
    // hashing the bytes, this and the file below would NOT dedup, or
    // worse, would silently be stored under the wrong key.
    writeAsset(dataDir, "hash_trust", "goblin-deadbeef.png", content);
    // Same bytes, no hash-shaped suffix at all — mirrors taverna-demo.jpg.
    writeAsset(dataDir, "hash_trust", "taverna-demo.jpg", content);

    await wm.backup("hash_trust", "manual");

    const repoDir = assetsRepoDir(worldBackupsDir(dataDir, "hash_trust"));
    expect(dirFileCount(repoDir)).toBe(1); // one blob for the one distinct content

    rmSync(worldAssetsDir(dataDir, "hash_trust"), { recursive: true, force: true });
    // create() itself triggers a "pre-migration" backup (migrating from
    // schema version 0) — filter it out, it has no asset manifest by design.
    const [entry] = wm.listBackups("hash_trust").filter((b) => b.type === "manual");
    if (!entry) throw new Error("expected a manual backup to exist");
    await wm.restoreBackup("hash_trust", entry.filename);

    const assetsDir = worldAssetsDir(dataDir, "hash_trust");
    expect(readFileSync(join(assetsDir, "goblin-deadbeef.png")).equals(content)).toBe(true);
    expect(readFileSync(join(assetsDir, "taverna-demo.jpg")).equals(content)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Special characters in filenames (Windows copyFileSync concerns).
  // -------------------------------------------------------------------------

  it("preserves filenames with spaces and parentheses through backup and restore", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "Special Names World", system: "pf2e", slug: "special_names" });

    const content = randomBytes(300);
    const trickyName = "old map (final) v2.png";
    writeAsset(dataDir, "special_names", trickyName, content);

    const entry = await wm.backup("special_names", "manual");
    rmSync(worldAssetsDir(dataDir, "special_names"), { recursive: true, force: true });
    await wm.restoreBackup("special_names", entry.filename);

    const restoredPath = join(worldAssetsDir(dataDir, "special_names"), trickyName);
    expect(existsSync(restoredPath)).toBe(true);
    expect(readFileSync(restoredPath).equals(content)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Review fixes (2026-08-16): atomicity, corrupted-manifest handling, and the
// CLI entry point that finally makes restoreBackup reachable outside tests.
// ---------------------------------------------------------------------------

describe("T024 review fix — restore atomicity and corrupted-manifest handling", () => {
  it("aborts and leaves world.db byte-for-byte unchanged when the backup's manifest references a missing blob", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "Atomic Restore World", system: "pf2e", slug: "atomic_restore" });

    writeAsset(dataDir, "atomic_restore", "art.png", randomBytes(800));
    const entry = await wm.backup("atomic_restore", "manual");

    // Corrupt the manifest to reference a hash that was never stored — a
    // blob that cannot exist under any circumstance. Deliberately NOT
    // "delete every blob from the repo": the live assets/ directory still
    // has the original file, and restoreBackup's own pre-restore safety
    // snapshot re-hashes+re-populates the repo from whatever is currently
    // live BEFORE the restore proper runs — so a deleted-but-still-live
    // blob would be silently healed by that snapshot and never actually
    // exercise the missing-blob path. A fabricated hash can't be healed
    // that way, since nothing will ever hash to it.
    const manifestPath = join(
      worldBackupsDir(dataDir, "atomic_restore"),
      entry.filename.replace(/\.db$/, ".assets.json"),
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      files: { hash: string }[];
    };
    const firstFile = manifest.files[0];
    if (!firstFile) throw new Error("expected the manifest to have at least one file");
    firstFile.hash = "0".repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const dbFilePath = worldDbPath(dataDir, "atomic_restore");
    const dbBefore = readFileSync(dbFilePath);
    const backupCountBefore = wm.listBackups("atomic_restore").length;

    await expect(wm.restoreBackup("atomic_restore", entry.filename)).rejects.toThrow(
      /missing blob/i,
    );

    // Not just "it threw" — the actual proof: world.db is untouched, byte
    // for byte, and no pre-restore safety snapshot was even created (proving
    // validation ran BEFORE any side effect, not just before the db swap).
    const dbAfter = readFileSync(dbFilePath);
    expect(dbAfter.equals(dbBefore)).toBe(true);
    expect(wm.listBackups("atomic_restore").length).toBe(backupCountBefore);
  });

  it("aborts on a corrupted asset manifest with a clear error, without touching world.db or silently reporting success", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "Corrupt Manifest World", system: "pf2e", slug: "corrupt_manifest" });

    writeAsset(dataDir, "corrupt_manifest", "art.png", randomBytes(800));
    const entry = await wm.backup("corrupt_manifest", "manual");

    // Corrupt the manifest file itself (not the repository) — malformed JSON.
    const manifestPath = join(
      worldBackupsDir(dataDir, "corrupt_manifest"),
      entry.filename.replace(/\.db$/, ".assets.json"),
    );
    writeFileSync(manifestPath, "{ this is not valid json", "utf8");

    const dbFilePath = worldDbPath(dataDir, "corrupt_manifest");
    const dbBefore = readFileSync(dbFilePath);

    await expect(wm.restoreBackup("corrupt_manifest", entry.filename)).rejects.toThrow(/manifest/i);

    const dbAfter = readFileSync(dbFilePath);
    expect(dbAfter.equals(dbBefore)).toBe(true);
  });

  it("a manifest that legitimately does not exist (pre-migration backup) is NOT an error — restores world.db only", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "No Manifest World", system: "pf2e", slug: "no_manifest" });

    // world.create() itself triggers a "pre-migration" backup, which never
    // calls backupAssets by design — this is the legitimate null case
    // readAssetManifest must keep silent about (see its doc comment).
    const [preMigration] = wm.listBackups("no_manifest").filter((b) => b.type === "pre-migration");
    if (!preMigration) throw new Error("expected a pre-migration backup to exist");

    const result = await wm.restoreBackup("no_manifest", preMigration.filename);
    expect(result.assetsRestored).toBe(false);
  });
});

describe("T024 review fix — fusion world restore CLI command", () => {
  class ProcessExitSignal extends Error {
    constructor(public readonly code: number | undefined) {
      super(`process.exit(${String(code)})`);
    }
  }

  let stdoutChunks: string[];
  let stderrChunks: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ProcessExitSignal(code);
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stdoutChunks.push(chunk.toString());
      return true;
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderrChunks.push(chunk.toString());
      return true;
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("refuses with a clear error and exit(1) when --backup is missing", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "CLI World", system: "pf2e", slug: "cli_missing_backup" });

    await expect(
      runWorldRestoreCommand(["cli_missing_backup", "--data-dir", dataDir]),
    ).rejects.toBeInstanceOf(ProcessExitSignal);
    expect(stderrChunks.join("")).toContain("--backup");
  });

  it("dry-runs by default: previews the backup and asset count, and does not touch world.db", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "CLI Dry Run World", system: "pf2e", slug: "cli_dryrun" });
    writeAsset(dataDir, "cli_dryrun", "art.png", randomBytes(400));
    const entry = await wm.backup("cli_dryrun", "manual");

    const dbFilePath = worldDbPath(dataDir, "cli_dryrun");
    const dbBefore = readFileSync(dbFilePath);

    await runWorldRestoreCommand(["cli_dryrun", "--backup", entry.filename, "--data-dir", dataDir]);

    expect(readFileSync(dbFilePath).equals(dbBefore)).toBe(true);
    const out = stdoutChunks.join("");
    expect(out).toContain("DRY RUN");
    expect(out).toContain(entry.filename);
    expect(out).toContain("--confirm-restore");
    expect(out).toContain("1 file(s)"); // the one asset backed up above
  });

  it("refuses to execute (even with --confirm-restore) when the world is locked by a live process", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "CLI Lock World", system: "pf2e", slug: "cli_locked" });
    const entry = await wm.backup("cli_locked", "manual");

    // Simulate a live lock — this test process's own PID is always "alive"
    // from isProcessAlive's point of view (kill(pid, 0) succeeds on self).
    const lockFile = join(dataDir, "worlds", "cli_locked", "world.lock");
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }),
      "utf8",
    );

    await expect(
      runWorldRestoreCommand([
        "cli_locked",
        "--backup",
        entry.filename,
        "--confirm-restore",
        entry.filename,
        "--data-dir",
        dataDir,
      ]),
    ).rejects.toBeInstanceOf(ProcessExitSignal);
    expect(stderrChunks.join("")).toMatch(/in use by process/i);
  });

  it("full cycle: backup -> delete assets -> confirmed CLI restore -> assets resolve again", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "CLI Full Cycle World", system: "pf2e", slug: "cli_full_cycle" });

    const content = randomBytes(600);
    writeAsset(dataDir, "cli_full_cycle", "art.png", content);
    const entry = await wm.backup("cli_full_cycle", "manual");

    rmSync(worldAssetsDir(dataDir, "cli_full_cycle"), { recursive: true, force: true });

    await runWorldRestoreCommand([
      "cli_full_cycle",
      "--backup",
      entry.filename,
      "--confirm-restore",
      entry.filename,
      "--data-dir",
      dataDir,
    ]);

    const restoredPath = join(worldAssetsDir(dataDir, "cli_full_cycle"), "art.png");
    expect(existsSync(restoredPath)).toBe(true);
    expect(readFileSync(restoredPath).equals(content)).toBe(true);
    expect(stdoutChunks.join("")).toContain("restored from");
  });

  it("refuses when --confirm-restore does not match --backup", async () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir });
    wm.create({ title: "CLI Mismatch World", system: "pf2e", slug: "cli_mismatch" });
    const entry = await wm.backup("cli_mismatch", "manual");

    await expect(
      runWorldRestoreCommand([
        "cli_mismatch",
        "--backup",
        entry.filename,
        "--confirm-restore",
        "some-other-file.db",
        "--data-dir",
        dataDir,
      ]),
    ).rejects.toBeInstanceOf(ProcessExitSignal);
    expect(stderrChunks.join("")).toContain("does not match");
  });
});
