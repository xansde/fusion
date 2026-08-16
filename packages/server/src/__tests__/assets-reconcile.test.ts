/**
 * Tests for asset reconciliation and GC (T022/T023, ../assets/reconcile.ts).
 *
 * The trap this task's brief calls out by name: a reconciliation that only
 * scans `@fusion/shared`'s `DOCUMENT_TABLES` allowlist misreports every
 * `region_maps`-referenced file as an orphan (`region_maps` is deliberately
 * NOT in that allowlist on this line — see migration 004's docstring) and a
 * GC built on that report would delete an in-use map image. The flagship
 * test below asserts a `region_maps` reference lands in `referenced`, by
 * name — a `DOCUMENT_TABLES`-only implementation fails that exact assertion,
 * which is what makes it a non-circular check rather than one that merely
 * restates the code under test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "better-sqlite3";

import { openDatabase, applyMigrations } from "../db/index.js";
import { getAssetRecord } from "../assets/asset-store.js";
import {
  reconcileAssets,
  runAssetGc,
  extractAssetRefs,
  assetRefToStorageName,
  DEFAULT_ORPHAN_GRACE_MS,
} from "../assets/reconcile.js";
import { printAssetsReconcileHelp } from "../cli/commands/assets.js";
import { backupAssets, readAssetManifest, assetsRepoDir } from "../worlds/asset-backup.js";

// ---------------------------------------------------------------------------
// Fixture PNG/JPEG bytes — just enough for magic-bytes.ts's detectType() to
// recognise the type. Content past the signature is irrelevant to this scan.
// ---------------------------------------------------------------------------

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00]);

// ---------------------------------------------------------------------------
// World fixture
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

function newTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

interface TestWorld {
  db: Database;
  assetsDir: string;
  close: () => void;
}

function buildTestWorld(): TestWorld {
  const worldDir = newTempDir("fusion-assets-reconcile-world");
  const assetsDir = join(worldDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const dbPath = join(worldDir, "world.db");
  const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, dbPath);

  return { db: fusionDb.raw, assetsDir, close: () => fusionDb.close() };
}

/** Write a fixture file into a world's assets/ dir and return its storage name. */
function putAsset(assetsDir: string, name: string, bytes: Buffer): string {
  writeFileSync(join(assetsDir, name), bytes);
  return name;
}

/** Insert a row into a DOCUMENT_TABLES table (actors/items — both have `type`). */
function insertDocTableRow(
  db: Database,
  table: "actors" | "items",
  id: string,
  dataObj: Record<string, unknown>,
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO ${table} (id, data, name, type, folder_id, sort, created_at, updated_at)
     VALUES (@id, @data, @name, @type, NULL, 0, @now, @now)`,
  ).run({
    id,
    data: JSON.stringify(dataObj),
    name: String(dataObj["name"] ?? id),
    type: "test",
    now,
  });
}

/**
 * Insert a row into `region_maps` — deliberately NOT in `DOCUMENT_TABLES`
 * (see migration 004's docstring and this file's header comment). This is
 * the table that catches an allowlist-based reconciliation being wrong.
 */
function insertRegionMapRow(db: Database, id: string, dataObj: Record<string, unknown>): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO region_maps (id, data, name, folder_id, sort, created_at, updated_at)
     VALUES (@id, @data, @name, NULL, 0, @now, @now)`,
  ).run({ id, data: JSON.stringify(dataObj), name: String(dataObj["name"] ?? id), now });
}

beforeEach(() => {
  tempDirs = [];
});

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("extractAssetRefs / assetRefToStorageName", () => {
  it("finds a reference regardless of which JSON key holds it", () => {
    const raw = JSON.stringify({ someArbitraryField: "/assets/hero-a1b2c3d4.png", other: 1 });
    expect(extractAssetRefs(raw)).toEqual(["/assets/hero-a1b2c3d4.png"]);
  });

  it("finds a reference nested inside an array of objects", () => {
    const raw = JSON.stringify({ pins: [{ icon: "/assets/pin-icon-deadbeef.png" }] });
    expect(extractAssetRefs(raw)).toEqual(["/assets/pin-icon-deadbeef.png"]);
  });

  it("decodes a percent-encoded name back to the exact on-disk filename", () => {
    // Mirrors the client's assetUrl(): "a b.png" -> "/assets/a%20b.png".
    expect(assetRefToStorageName("/assets/a%20b.png")).toBe("a b.png");
    expect(assetRefToStorageName("/assets/my%20map.png")).toBe("my map.png");
  });

  it("decodes each nested segment independently", () => {
    expect(assetRefToStorageName("/assets/tokens/a%20b.png")).toBe("tokens/a b.png");
  });

  // -------------------------------------------------------------------------
  // Achado 1 — encodeURIComponent() leaves `! ' ( ) *` unescaped; the old
  // character-class pattern truncated the match at the first one of those,
  // producing a reference that could never match the real on-disk name.
  // -------------------------------------------------------------------------

  it("captures a name with unescaped parens without truncating — 'mapa (1).jpg'", () => {
    const encoded = encodeURIComponent("mapa (1).jpg"); // -> "mapa%20(1).jpg"
    const raw = JSON.stringify({ background: `/assets/${encoded}` });
    expect(extractAssetRefs(raw)).toEqual([`/assets/${encoded}`]);
    expect(assetRefToStorageName(`/assets/${encoded}`)).toBe("mapa (1).jpg");
  });

  it("round-trips a name with an accented character", () => {
    const encoded = encodeURIComponent("mapa-café.jpg");
    const raw = JSON.stringify({ image: `/assets/${encoded}` });
    expect(extractAssetRefs(raw)).toEqual([`/assets/${encoded}`]);
    expect(assetRefToStorageName(`/assets/${encoded}`)).toBe("mapa-café.jpg");
  });

  it("round-trips a name with an apostrophe", () => {
    const encoded = encodeURIComponent("d'Artagnan's map.png");
    const raw = JSON.stringify({ image: `/assets/${encoded}` });
    expect(extractAssetRefs(raw)).toEqual([`/assets/${encoded}`]);
    expect(assetRefToStorageName(`/assets/${encoded}`)).toBe("d'Artagnan's map.png");
  });

  it("round-trips a name with an exclamation mark", () => {
    const encoded = encodeURIComponent("boss!.png");
    const raw = JSON.stringify({ image: `/assets/${encoded}` });
    expect(extractAssetRefs(raw)).toEqual([`/assets/${encoded}`]);
    expect(assetRefToStorageName(`/assets/${encoded}`)).toBe("boss!.png");
  });

  it("stops at the escaped quote from a TipTap <img> tag embedded in JSON text, not before", () => {
    // A journal document stores TipTap content as an HTML string INSIDE a
    // JSON field — JSON.stringify escapes each `"` in that HTML as `\"`, so
    // the raw column text literally contains `\"` right after the filename.
    // The scan must stop there (excludes `\`), not swallow the trailing
    // escape into the match.
    const html = `<p><img src="/assets/journal-map.png"></p>`;
    const raw = JSON.stringify({ content: html });
    expect(raw).toMatch(/\/assets\/journal-map\.png\\"/); // sanity: JSON really escapes it this way
    expect(extractAssetRefs(raw)).toEqual(["/assets/journal-map.png"]);
  });

  // -------------------------------------------------------------------------
  // Achado 5 — a `data` column is `TEXT NOT NULL` by schema declaration, but
  // SQLite does not enforce that at the type level; a row can still come
  // back NULL or as a Buffer (BLOB) at runtime.
  // -------------------------------------------------------------------------

  it("returns [] instead of throwing for null/undefined column content", () => {
    expect(extractAssetRefs(null)).toEqual([]);
    expect(extractAssetRefs(undefined)).toEqual([]);
  });

  it("scans a Buffer (BLOB column) as UTF-8 text instead of throwing", () => {
    const buf = Buffer.from(JSON.stringify({ icon: "/assets/blob-encoded.png" }), "utf8");
    expect(extractAssetRefs(buf)).toEqual(["/assets/blob-encoded.png"]);
  });
});

// ---------------------------------------------------------------------------
// reconcileAssets — the five-way classification
// ---------------------------------------------------------------------------

describe("reconcileAssets", () => {
  it("classifies referenced (common table), referenced (region_maps, percent-encoded), orphaned, and broken correctly — by name", () => {
    const world = buildTestWorld();
    try {
      const heroName = putAsset(world.assetsDir, "hero-a1b2c3d4.png", PNG_BYTES);
      const mapName = putAsset(world.assetsDir, "taverna-demo.jpg", JPEG_BYTES);
      const spacedName = putAsset(world.assetsDir, "my map.png", PNG_BYTES);
      const orphanName = putAsset(world.assetsDir, "truly-orphaned.png", PNG_BYTES);
      // Deliberately no file written for "missing-99999999.png" — the point
      // of the broken-reference case is that nothing is there.

      insertDocTableRow(world.db, "actors", "actor-1", {
        name: "Hero",
        portrait: `/assets/${heroName}`,
      });

      // The table this task's brief warns about: NOT in DOCUMENT_TABLES.
      insertRegionMapRow(world.db, "map-1", {
        name: "A Taverna do Javali",
        image: `/assets/${mapName}`,
      });

      // Percent-encoded reference — the "%20" case that killed an earlier
      // design on this project (see reconcile.ts module doc).
      insertDocTableRow(world.db, "items", "item-1", {
        name: "Spaced item",
        icon: `/assets/${encodeURIComponent(spacedName)}`,
      });

      // A dangling reference: points at a file that does not exist on disk.
      insertDocTableRow(world.db, "items", "item-2", {
        name: "Broken item",
        icon: "/assets/missing-99999999.png",
      });

      const report = reconcileAssets({
        db: world.db,
        assetsDir: world.assetsDir,
        orphanGraceMs: 0,
      });

      // --- referenced (by name, not count) ---
      const referencedNames = report.referenced.map((r) => r.name).sort();
      expect(referencedNames).toEqual([heroName, mapName, spacedName].sort());

      const heroEntry = report.referenced.find((r) => r.name === heroName);
      expect(heroEntry?.references).toEqual([
        expect.objectContaining({ table: "actors", documentId: "actor-1" }),
      ]);

      // The region_maps case, specifically — this is the assertion a
      // DOCUMENT_TABLES-only scan fails: it would put this file in
      // `orphaned` instead.
      const mapEntry = report.referenced.find((r) => r.name === mapName);
      expect(mapEntry?.references).toEqual([
        expect.objectContaining({ table: "region_maps", documentId: "map-1" }),
      ]);

      const spacedEntry = report.referenced.find((r) => r.name === spacedName);
      expect(spacedEntry?.references).toEqual([
        expect.objectContaining({ table: "items", documentId: "item-1" }),
      ]);

      // --- orphaned (by name) ---
      expect(report.orphaned.map((o) => o.name)).toEqual([orphanName]);
      expect(report.recentUnreferenced).toEqual([]);

      // --- broken (by name) ---
      expect(report.broken).toHaveLength(1);
      expect(report.broken[0]?.storageName).toBe("missing-99999999.png");
      expect(report.broken[0]?.references).toEqual([
        expect.objectContaining({ table: "items", documentId: "item-2" }),
      ]);

      // --- backfill: the registry started empty, all 4 disk files got a row ---
      expect(report.backfilled.sort()).toEqual([heroName, mapName, orphanName, spacedName].sort());
      for (const name of [heroName, mapName, spacedName, orphanName]) {
        expect(getAssetRecord(world.db, name)).toBeDefined();
      }
    } finally {
      world.close();
    }
  });

  it("does not backfill a second time once a registry row already exists", () => {
    const world = buildTestWorld();
    try {
      const name = putAsset(world.assetsDir, "solo-11112222.png", PNG_BYTES);
      const first = reconcileAssets({ db: world.db, assetsDir: world.assetsDir, orphanGraceMs: 0 });
      expect(first.backfilled).toEqual([name]);

      const second = reconcileAssets({
        db: world.db,
        assetsDir: world.assetsDir,
        orphanGraceMs: 0,
      });
      expect(second.backfilled).toEqual([]);
      expect(second.orphaned.map((o) => o.name)).toEqual([name]);
    } finally {
      world.close();
    }
  });

  it("keeps a just-arrived unreferenced file out of `orphaned` until the grace period passes", () => {
    const world = buildTestWorld();
    try {
      const name = putAsset(world.assetsDir, "fresh-99990000.png", PNG_BYTES);

      // Default grace period, clock at "now" — the file was written a
      // moment ago by putAsset() above, so its mtime is effectively now.
      const freshReport = reconcileAssets({ db: world.db, assetsDir: world.assetsDir });
      expect(freshReport.orphaned.map((o) => o.name)).not.toContain(name);
      expect(freshReport.recentUnreferenced.map((o) => o.name)).toEqual([name]);

      // Same file, clock advanced past the grace period — same registry row
      // (same createdAt), so this simulates time passing without re-writing
      // the file.
      const agedReport = reconcileAssets({
        db: world.db,
        assetsDir: world.assetsDir,
        now: Date.now() + DEFAULT_ORPHAN_GRACE_MS + 60_000,
      });
      expect(agedReport.orphaned.map((o) => o.name)).toEqual([name]);
      expect(agedReport.recentUnreferenced).toEqual([]);
    } finally {
      world.close();
    }
  });

  it("ACHADO 1 — full pipeline: 'mapa (1).jpg' is referenced, and never orphaned, despite unescaped parens in its encoded form", () => {
    const world = buildTestWorld();
    try {
      const mapName = putAsset(world.assetsDir, "mapa (1).jpg", JPEG_BYTES);

      insertRegionMapRow(world.db, "map-1", {
        name: "Mapa da campanha",
        image: `/assets/${encodeURIComponent(mapName)}`,
      });

      const report = reconcileAssets({
        db: world.db,
        assetsDir: world.assetsDir,
        orphanGraceMs: 0,
      });

      // This is the assertion the truncating pattern fails: it stops the
      // match at "mapa%20", never matches "mapa (1).jpg" on disk, and the
      // file falls through to `orphaned` — exactly the "campaign map
      // deleted by gc" outcome this task's brief calls out.
      expect(report.referenced.map((r) => r.name)).toContain(mapName);
      expect(report.orphaned.map((o) => o.name)).not.toContain(mapName);
      expect(report.broken).toEqual([]);
    } finally {
      world.close();
    }
  });

  it("ACHADO 2 — a reference differing only in case is `referenced`, never orphaned, and flagged as a case mismatch", () => {
    const world = buildTestWorld();
    try {
      // Simulates what Windows' case-insensitive filesystem actually does:
      // the disk file is "Taverna.jpg" but the document stores the lowercase
      // form — the server serves the file fine, so reconciliation must agree.
      const diskName = putAsset(world.assetsDir, "Taverna.jpg", JPEG_BYTES);

      insertRegionMapRow(world.db, "map-1", {
        name: "A Taverna",
        image: "/assets/taverna.jpg",
      });

      const report = reconcileAssets({
        db: world.db,
        assetsDir: world.assetsDir,
        orphanGraceMs: 0,
      });

      expect(report.referenced.map((r) => r.name)).toEqual([diskName]);
      expect(report.orphaned).toEqual([]);
      expect(report.broken).toEqual([]);
      expect(report.caseMismatches).toEqual([
        expect.objectContaining({ diskName, referencedAs: "taverna.jpg" }),
      ]);
    } finally {
      world.close();
    }
  });

  it("ACHADO 5 — survives a scannable table whose `data` column holds NULL or a BLOB instead of TEXT", () => {
    const world = buildTestWorld();
    try {
      // A table PRAGMA table_info() would find (any `data` column, no
      // allowlist — see module doc) but whose column holds something other
      // than TEXT: exactly the schema-drift scenario this module's central
      // thesis (survive shape changes) exists for.
      world.db.exec(`CREATE TABLE drifted_docs (id TEXT PRIMARY KEY, data)`);
      world.db.prepare(`INSERT INTO drifted_docs (id, data) VALUES (?, ?)`).run("null-row", null);
      world.db
        .prepare(`INSERT INTO drifted_docs (id, data) VALUES (?, ?)`)
        .run("blob-row", Buffer.from(JSON.stringify({ icon: "/assets/blob-ref.png" }), "utf8"));

      const refName = putAsset(world.assetsDir, "blob-ref.png", PNG_BYTES);

      expect(() =>
        reconcileAssets({ db: world.db, assetsDir: world.assetsDir, orphanGraceMs: 0 }),
      ).not.toThrow();

      const report = reconcileAssets({
        db: world.db,
        assetsDir: world.assetsDir,
        orphanGraceMs: 0,
      });
      expect(report.referenced.map((r) => r.name)).toContain(refName);
    } finally {
      world.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Achado 3 — backups are out of scope by design; prove the T024 blob
// repository actually protects a post-T024 backup from a live gc run,
// rather than merely asserting it in a comment.
// ---------------------------------------------------------------------------

describe("GC safety relative to world backups (Achado 3)", () => {
  it("a post-T024 backup manifest and its blob survive gc deleting the same file from the live assets/ dir", async () => {
    const world = buildTestWorld();
    try {
      const name = putAsset(world.assetsDir, "orphan-in-backup-9f8e7d6c.png", PNG_BYTES);

      const backupsDir = newTempDir("fusion-assets-reconcile-backups");
      // backupAssets() only writes a sibling ".assets.json" next to this
      // path — the ".db" file itself does not need to exist for this test.
      const fakeDbBackupPath = join(backupsDir, "manual-1700000000000.db");
      const manifest = await backupAssets(world.assetsDir, backupsDir, fakeDbBackupPath);
      expect(manifest?.files.map((f) => f.name)).toEqual([name]);

      // Nothing in world.db references it — reconcile calls it orphaned,
      // and gc (confirmed) removes it from the LIVE assets/ dir.
      const report = reconcileAssets({
        db: world.db,
        assetsDir: world.assetsDir,
        orphanGraceMs: 0,
      });
      expect(report.orphaned.map((o) => o.name)).toEqual([name]);

      const gcResult = runAssetGc({
        db: world.db,
        assetsDir: world.assetsDir,
        report,
        confirm: true,
      });
      expect(gcResult.deleted).toEqual([name]);
      expect(existsSync(join(world.assetsDir, name))).toBe(false);

      // The backup's manifest and blob are untouched — runAssetGc() never
      // looked at backupsDir at all. This is what makes restoring this
      // backup safe even though the live copy is gone.
      const manifestAfterGc = readAssetManifest(fakeDbBackupPath);
      expect(manifestAfterGc?.files.map((f) => f.name)).toEqual([name]);
      const blobHash = manifestAfterGc?.files[0]?.hash;
      expect(blobHash).toBeDefined();
      expect(readdirSync(assetsRepoDir(backupsDir))).toContain(blobHash);
    } finally {
      world.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Achado 4 — the reconcile help text must not promise a narrower set of
// writes than the command actually performs.
// ---------------------------------------------------------------------------

describe("printAssetsReconcileHelp (Achado 4)", () => {
  it("does not claim the registry backfill is the only write this command makes", () => {
    let out = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    try {
      printAssetsReconcileHelp();
    } finally {
      spy.mockRestore();
    }

    expect(out).not.toMatch(/this is the only write this command makes/i);
    // The corrected text must actually disclose the other writes, not just
    // drop the false claim.
    expect(out.toLowerCase()).toContain("migrat");
  });
});

// ---------------------------------------------------------------------------
// runAssetGc — never automatic (T023)
// ---------------------------------------------------------------------------

describe("runAssetGc", () => {
  it("without confirmation, deletes nothing — file and registry row both survive", () => {
    const world = buildTestWorld();
    try {
      const name = putAsset(world.assetsDir, "orphan-aaaa0000.png", PNG_BYTES);
      const report = reconcileAssets({
        db: world.db,
        assetsDir: world.assetsDir,
        orphanGraceMs: 0,
      });
      expect(report.orphaned.map((o) => o.name)).toEqual([name]);

      const result = runAssetGc({
        db: world.db,
        assetsDir: world.assetsDir,
        report,
        confirm: false,
      });

      expect(result.confirmed).toBe(false);
      expect(result.candidates).toEqual([name]);
      expect(result.deleted).toEqual([]);
      expect(existsSync(join(world.assetsDir, name))).toBe(true);
      expect(getAssetRecord(world.db, name)).toBeDefined();
    } finally {
      world.close();
    }
  });

  it("with confirmation, a report where nothing cleared the grace period deletes nothing at all", () => {
    // Regression guard for T023's hard rule: GC must never delete what the
    // report did not call `orphaned`, even with confirm:true. A file that
    // just landed on disk (mtime ~ now) and has no reference sits in
    // `recentUnreferenced` under the default grace period — this asserts GC
    // leaves it alone, on disk AND in the registry.
    const world = buildTestWorld();
    try {
      const referencedName = putAsset(world.assetsDir, "kept-a1a1a1a1.png", PNG_BYTES);
      const recentName = putAsset(world.assetsDir, "recent-c3c3c3c3.png", PNG_BYTES);

      insertDocTableRow(world.db, "actors", "actor-1", {
        name: "Hero",
        portrait: `/assets/${referencedName}`,
      });

      const report = reconcileAssets({
        db: world.db,
        assetsDir: world.assetsDir,
        orphanGraceMs: DEFAULT_ORPHAN_GRACE_MS,
      });
      expect(report.orphaned).toEqual([]);
      expect(report.recentUnreferenced.map((o) => o.name)).toEqual([recentName]);

      const result = runAssetGc({
        db: world.db,
        assetsDir: world.assetsDir,
        report,
        confirm: true,
      });

      expect(result.confirmed).toBe(true);
      expect(result.candidates).toEqual([]);
      expect(result.deleted).toEqual([]);
      for (const name of [referencedName, recentName]) {
        expect(existsSync(join(world.assetsDir, name))).toBe(true);
        expect(getAssetRecord(world.db, name)).toBeDefined();
      }
    } finally {
      world.close();
    }
  });

  it("with confirmation and a report that DOES call a file orphaned, deletes exactly that file and its registry row", () => {
    const world = buildTestWorld();
    try {
      const referencedName = putAsset(world.assetsDir, "kept-d4d4d4d4.png", PNG_BYTES);
      const orphanName = putAsset(world.assetsDir, "orphan-e5e5e5e5.png", PNG_BYTES);

      insertDocTableRow(world.db, "actors", "actor-1", {
        name: "Hero",
        portrait: `/assets/${referencedName}`,
      });

      const report = reconcileAssets({
        db: world.db,
        assetsDir: world.assetsDir,
        orphanGraceMs: 0,
      });
      expect(report.orphaned.map((o) => o.name)).toEqual([orphanName]);

      const result = runAssetGc({
        db: world.db,
        assetsDir: world.assetsDir,
        report,
        confirm: true,
      });

      expect(result.confirmed).toBe(true);
      expect(result.deleted).toEqual([orphanName]);
      expect(result.failed).toEqual([]);

      expect(existsSync(join(world.assetsDir, orphanName))).toBe(false);
      expect(getAssetRecord(world.db, orphanName)).toBeUndefined();

      // The referenced file is untouched, on disk and in the registry.
      expect(existsSync(join(world.assetsDir, referencedName))).toBe(true);
      expect(getAssetRecord(world.db, referencedName)).toBeDefined();
    } finally {
      world.close();
    }
  });
});
