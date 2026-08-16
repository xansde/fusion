/**
 * Tests for the `assets` table (T020, migration 009) and its registration
 * from the upload/delete routes (T021).
 *
 * The circular-test trap here would be asserting the registry row against
 * what the upload route *says* it wrote (its own JSON response). Every
 * "matches the file" assertion below instead re-derives the expectation
 * independently from the file actually on disk: `statSync` for size,
 * `sha256Hex` over the bytes for the digest, and `detectType` (the same
 * magic-bytes detector the route uses, but invoked fresh here) for the mime
 * type. A route that recorded the wrong number, or recorded nothing at all,
 * fails these — a route that merely echoes its own belief back would not.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import FormData from "form-data";

import {
  openDatabase,
  applyMigrations,
  checkSchema,
  getSchemaVersion,
  registerMigrations,
} from "../db/index.js";
import type { FusionMigration } from "../db/index.js";
import { migration001 } from "../db/migrations/001_initial_schema.js";
import { migration002 } from "../db/migrations/002_users_sessions.js";
import { migration003 } from "../db/migrations/003_fog_exploration.js";
import { migration004 } from "../db/migrations/004_region_maps.js";
import { migration005 } from "../db/migrations/005_roll_audit_log.js";
import { migration006 } from "../db/migrations/006_constraints.js";
import { migration007 } from "../db/migrations/007_indexes.js";
import { migration008 } from "../db/migrations/008_scene_active.js";
import { migration009 } from "../db/migrations/009_assets.js";

import { AuthService } from "../auth/service.js";
import { loadOrCreateSecret } from "../auth/crypto.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { registerAssetRoutes } from "../assets/routes.js";
import { recordAsset, getAssetRecord, listAssetRecords } from "../assets/asset-store.js";
import { sha256Hex } from "../assets/slug.js";
import { detectType } from "../assets/magic-bytes.js";

// ---------------------------------------------------------------------------
// Migration fixtures
// ---------------------------------------------------------------------------

const UP_TO_8: FusionMigration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
];
const ALL: FusionMigration[] = [...UP_TO_8, migration009];

let schemaTempDirs: string[] = [];

function newSchemaTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-assets-registry-schema-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  schemaTempDirs.push(dir);
  return dir;
}

/** Build a database at a given point in migration history and close it. */
function seedDatabase(path: string, migrations: FusionMigration[]): void {
  registerMigrations(migrations);
  const db = openDatabase({ path, skipIntegrityCheck: true });
  try {
    applyMigrations(db.raw, path);
  } finally {
    db.close();
  }
}

beforeEach(() => {
  schemaTempDirs = [];
  registerMigrations(ALL);
});

afterEach(() => {
  registerMigrations(ALL);
  for (const dir of schemaTempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  }
});

// ---------------------------------------------------------------------------
// Migration 009 (T020)
// ---------------------------------------------------------------------------

describe("migration 009 — assets table (T020)", () => {
  it("a brand-new database is born with the assets table and its digest index", () => {
    const path = join(newSchemaTempDir(), "world.db");
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      applyMigrations(db.raw, path);

      expect(getSchemaVersion(db.raw)).toBe(9);

      const table = db.raw
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='assets'`)
        .get();
      expect(table).toBeDefined();

      const index = db.raw
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_assets_digest'`)
        .get();
      expect(index).toBeDefined();
    } finally {
      db.close();
    }
  });

  it("a version-8 database upgrades to 9, gaining an empty assets table without disturbing what it had", () => {
    const path = join(newSchemaTempDir(), "world.db");
    seedDatabase(path, UP_TO_8);

    // A row in an untouched table, so the upgrade has something to preserve.
    registerMigrations(UP_TO_8);
    const before = openDatabase({ path, skipIntegrityCheck: true });
    before.raw
      .prepare(
        `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
         VALUES ('act1', '{}', 'Fofurinha', 'character', 0, 1, 1)`,
      )
      .run();
    expect(getSchemaVersion(before.raw)).toBe(8);
    before.close();

    registerMigrations(ALL);
    const after = openDatabase({ path, skipIntegrityCheck: true });
    try {
      applyMigrations(after.raw, path);

      expect(getSchemaVersion(after.raw)).toBe(9);
      const row = after.raw.prepare(`SELECT name FROM actors WHERE id = 'act1'`).get() as
        | { name: string }
        | undefined;
      expect(row?.name).toBe("Fofurinha");

      const count = after.raw.prepare(`SELECT COUNT(*) AS n FROM assets`).get() as { n: number };
      expect(count.n).toBe(0);
    } finally {
      after.close();
    }
  });

  it("the schema guard accepts both a fresh v9 database and one migrated from v8", () => {
    const freshPath = join(newSchemaTempDir(), "world.db");
    const fresh = openDatabase({ path: freshPath, skipIntegrityCheck: true });
    try {
      applyMigrations(fresh.raw, freshPath);
      expect(checkSchema(fresh.raw).ok).toBe(true);
    } finally {
      fresh.close();
    }

    const migratedPath = join(newSchemaTempDir(), "world.db");
    seedDatabase(migratedPath, UP_TO_8);
    registerMigrations(ALL);
    const migrated = openDatabase({ path: migratedPath, skipIntegrityCheck: true });
    try {
      applyMigrations(migrated.raw, migratedPath);
      expect(getSchemaVersion(migrated.raw)).toBe(9);
      expect(checkSchema(migrated.raw).ok).toBe(true);
    } finally {
      migrated.close();
    }
  });
});

// ---------------------------------------------------------------------------
// asset-store (T020) — direct unit coverage of the upsert/idempotency choice
// ---------------------------------------------------------------------------

describe("asset-store.recordAsset — idempotency", () => {
  it("registering the same name twice upserts instead of throwing a PK violation", () => {
    const path = join(newSchemaTempDir(), "world.db");
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      applyMigrations(db.raw, path);

      recordAsset(db.raw, {
        name: "goblin-a3f8bc12.png",
        digest: "a".repeat(64),
        bytes: 100,
        mimeType: "image/png",
        uploadedBy: "user-1",
        createdAt: 1000,
      });

      // Second registration of the SAME name — must not throw, and must
      // refresh the metadata while keeping the original createdAt.
      expect(() => {
        recordAsset(db.raw, {
          name: "goblin-a3f8bc12.png",
          digest: "a".repeat(64),
          bytes: 100,
          mimeType: "image/png",
          uploadedBy: "user-2",
          createdAt: 2000,
        });
      }).not.toThrow();

      const rows = listAssetRecords(db.raw);
      expect(rows).toHaveLength(1);
      // `uploaded_by` answers "who put this file here", and that does not
      // change because somebody sent the same bytes again — otherwise the
      // column quietly becomes "the last person who tried", and a second GM
      // re-uploading an existing file takes the credit without a single byte
      // on disk changing. Same reasoning as `created_at` below.
      expect(rows[0]?.uploadedBy).toBe("user-1");
      expect(rows[0]?.createdAt).toBe(1000); // preserved from the first insert

      const row = getAssetRecord(db.raw, "goblin-a3f8bc12.png");
      expect(row?.bytes).toBe(100);
      expect(row?.digest).toBe("a".repeat(64));
    } finally {
      db.close();
    }
  });

  it("getAssetRecord returns undefined for a name that was never registered", () => {
    const path = join(newSchemaTempDir(), "world.db");
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      applyMigrations(db.raw, path);
      expect(getAssetRecord(db.raw, "never-uploaded.png")).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// HTTP integration — POST /api/assets/upload and DELETE /api/assets/:name
// ---------------------------------------------------------------------------

/** Valid PNG: minimal 1×1 white pixel (same fixture shape as assets.test.ts). */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

/** A second, different valid PNG (bigger IDAT chunk padding) — different digest. */
const PNG_BYTES_2 = Buffer.concat([PNG_BYTES, Buffer.from([0x00])]);

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-assets-registry-http-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface HttpTestContext {
  dataDir: string;
  assetsDir: string;
  fastify: FastifyInstance;
  db: Database;
  gmToken: string;
  gmUserId: string;
}

async function buildHttpTestContext(): Promise<HttpTestContext> {
  const dataDir = makeTempDir();
  const assetsDir = join(dataDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const dbPath = join(dataDir, "world.db");
  const secret = loadOrCreateSecret(dataDir);
  const dbHandle = openDatabase({ path: dbPath, skipIntegrityCheck: true });
  applyMigrations(dbHandle.raw, dbPath);
  const authService = new AuthService(dbHandle.raw, secret, "test-world");

  const { user: gm, password: gmPass } = await authService.bootstrapGm();

  const fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);
  registerAuthRoutes(fastify, {
    authService,
    worldInfo: { id: "test-world", title: "Test", systemId: "stub" },
  });
  registerAssetRoutes(fastify, {
    authService,
    assetsDir,
    maxUploadBytes: 1024 * 1024,
    db: dbHandle.raw,
  });
  await fastify.ready();

  async function loginFor(id: string, pass: string): Promise<string> {
    const resp = await fastify.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: id, password: pass },
    });
    const body = resp.json() as { ok: boolean; accessToken: string };
    return body.accessToken;
  }

  const gmToken = await loginFor(gm.id, gmPass);

  return { dataDir, assetsDir, fastify, db: dbHandle.raw, gmToken, gmUserId: gm.id };
}

async function uploadFile(
  fastify: FastifyInstance,
  token: string,
  fileBuffer: Buffer,
  filename: string,
  contentType = "image/png",
) {
  const form = new FormData();
  form.append("file", fileBuffer, { filename, contentType });
  const headers = { ...form.getHeaders(), authorization: `Bearer ${token}` };
  return fastify.inject({
    method: "POST",
    url: "/api/assets/upload",
    headers,
    payload: form.getBuffer(),
  });
}

let ctx: HttpTestContext;
const httpTempDirs: string[] = [];

describe("POST /api/assets/upload registers a row (T021)", () => {
  beforeEach(async () => {
    ctx = await buildHttpTestContext();
    httpTempDirs.push(ctx.dataDir);
  });

  afterEach(async () => {
    await ctx.fastify.close();
    for (const dir of httpTempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  it("writes a row whose hash, bytes and mime match the file actually on disk", async () => {
    const resp = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "token.png", "image/png");
    expect(resp.statusCode).toBe(201);
    const body = resp.json() as { path: string };

    const diskPath = join(ctx.assetsDir, body.path);
    expect(existsSync(diskPath)).toBe(true);

    // Independently re-derive every expectation from the file on disk —
    // never from the route's own JSON response (see file header).
    const diskBytes = readFileSync(diskPath);
    const expectedDigest = sha256Hex(diskBytes);
    const expectedSize = statSync(diskPath).size;
    const expectedMime = detectType(diskBytes)?.mime;

    const row = getAssetRecord(ctx.db, body.path);
    expect(row).toBeDefined();
    expect(row?.digest).toBe(expectedDigest);
    expect(row?.bytes).toBe(expectedSize);
    expect(row?.mimeType).toBe(expectedMime);
    expect(row?.uploadedBy).toBe(ctx.gmUserId);
    expect(typeof row?.createdAt).toBe("number");
  });

  it("uploading the same content twice does not crash and leaves exactly one row", async () => {
    const resp1 = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "first.png", "image/png");
    expect(resp1.statusCode).toBe(201);
    const body1 = resp1.json() as { path: string; deduplicated: boolean };
    expect(body1.deduplicated).toBe(false);

    const resp2 = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "second.png", "image/png");
    expect(resp2.statusCode).toBe(200);
    const body2 = resp2.json() as { path: string; deduplicated: boolean };
    expect(body2.deduplicated).toBe(true);
    // Dedup means no second file — same storage name reported both times.
    expect(body2.path).toBe(body1.path);

    const rows = listAssetRecords(ctx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(body1.path);
  });

  it("registers a second, distinct row for genuinely different content", async () => {
    await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "a.png", "image/png");
    await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES_2, "b.png", "image/png");

    const rows = listAssetRecords(ctx.db);
    expect(rows).toHaveLength(2);
    const digests = new Set(rows.map((r) => r.digest));
    expect(digests.size).toBe(2);
  });

  it("DELETE removes the registry row along with the file", async () => {
    const upload = await uploadFile(ctx.fastify, ctx.gmToken, PNG_BYTES, "tok.png", "image/png");
    const { path: assetName } = upload.json() as { path: string };
    expect(getAssetRecord(ctx.db, assetName)).toBeDefined();

    const del = await ctx.fastify.inject({
      method: "DELETE",
      url: `/api/assets/${assetName}`,
      headers: { authorization: `Bearer ${ctx.gmToken}` },
    });
    expect(del.statusCode).toBe(200);
    expect(existsSync(join(ctx.assetsDir, assetName))).toBe(false);
    expect(getAssetRecord(ctx.db, assetName)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// A world with files on disk from before this feature existed (T022 boundary)
// ---------------------------------------------------------------------------

describe("a world with pre-existing, unregistered assets keeps working", () => {
  it("opens and serves a file that has no row in the assets table", async () => {
    const context = await buildHttpTestContext();
    httpTempDirs.push(context.dataDir);
    try {
      // Simulate a file that predates the registry: written straight to
      // disk, bypassing the upload route entirely, so no row was ever
      // recorded for it. This is what every world's assets/ directory
      // looks like the moment migration 009 lands — T022's reconciliation
      // is what eventually backfills it, not this migration.
      const legacyName = "legacy-deadbeef.png";
      writeFileSync(join(context.assetsDir, legacyName), PNG_BYTES);

      expect(listAssetRecords(context.db)).toHaveLength(0);
      expect(getAssetRecord(context.db, legacyName)).toBeUndefined();

      const listResp = await context.fastify.inject({
        method: "GET",
        url: "/api/assets",
        headers: { authorization: `Bearer ${context.gmToken}` },
      });
      expect(listResp.statusCode).toBe(200);
      const listed = (listResp.json() as { assets: Array<{ name: string }> }).assets;
      expect(listed.some((a) => a.name === legacyName)).toBe(true);

      const getResp = await context.fastify.inject({
        method: "GET",
        url: `/assets/${legacyName}`,
        headers: { authorization: `Bearer ${context.gmToken}` },
      });
      expect(getResp.statusCode).toBe(200);
    } finally {
      await context.fastify.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The dedup branch describes the file ON DISK, never the request that matched it
// ---------------------------------------------------------------------------

describe("dedup branch backfills from disk, not from the incoming upload", () => {
  it("records the stored file's own digest and size when it had no row", async () => {
    const context = await buildHttpTestContext();
    httpTempDirs.push(context.dataDir);
    try {
      // A file already on disk, unregistered, whose NAME carries the 8-hex
      // prefix the dedup scan looks for — but whose CONTENT is not what the
      // next upload will send. `findExistingByDigest` matches on that
      // substring alone, so a match is a likely duplicate, never a proof.
      const incoming = PNG_BYTES;
      const prefix = sha256Hex(incoming).slice(0, 8);
      const storedBytes = Buffer.concat([PNG_BYTES, Buffer.from("different tail")]);
      const storedName = `decoy-${prefix}.png`;
      writeFileSync(join(context.assetsDir, storedName), storedBytes);
      expect(getAssetRecord(context.db, storedName)).toBeUndefined();

      const resp = await uploadFile(context.fastify, context.gmToken, incoming, "incoming.png");
      expect(resp.statusCode).toBe(200);
      expect((resp.json() as { deduplicated: boolean }).deduplicated).toBe(true);

      // The row must describe what is on disk under that name. Recording the
      // uploaded buffer's digest/size here would write a plausible lie: the
      // registry would claim bytes the file does not have.
      const row = getAssetRecord(context.db, storedName);
      expect(row).toBeDefined();
      expect(row?.digest).toBe(sha256Hex(storedBytes));
      expect(row?.bytes).toBe(storedBytes.length);
      expect(row?.digest).not.toBe(sha256Hex(incoming));
    } finally {
      await context.fastify.close();
    }
  });

  it("leaves an existing row alone instead of overwriting it", async () => {
    const context = await buildHttpTestContext();
    httpTempDirs.push(context.dataDir);
    try {
      const first = await uploadFile(context.fastify, context.gmToken, PNG_BYTES, "first.png");
      expect(first.statusCode).toBe(201);
      const name = (first.json() as { path: string }).path.replace(/^\/assets\//, "");
      const before = getAssetRecord(context.db, name);
      expect(before).toBeDefined();

      const second = await uploadFile(context.fastify, context.gmToken, PNG_BYTES, "second.png");
      expect(second.statusCode).toBe(200);

      expect(getAssetRecord(context.db, name)).toEqual(before);
    } finally {
      await context.fastify.close();
    }
  });
});
