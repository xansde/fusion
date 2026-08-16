/**
 * Access layer for the `assets` table (migration 009, T020).
 *
 * A light registry, by design (D3): one row per file under
 * `worlds/<slug>/assets/`, describing the file — never which documents
 * reference it. See `db/migrations/009_assets.ts` for the full rationale
 * and `assets/routes.ts` (T021) for the only writer in the upload path.
 */

import type { Database } from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A registered asset, as read back from the `assets` table. */
export interface AssetRecord {
  /** Storage filename — the row's primary key (see migration 009 for why). */
  name: string;
  /** Full SHA-256 hex digest (64 chars) of the file content. */
  digest: string;
  /** File size in bytes. */
  bytes: number;
  /** MIME type detected at upload time (magic-bytes, not client-supplied). */
  mimeType: string;
  /** User id of the uploader, or `null` for rows backfilled by reconciliation. */
  uploadedBy: string | null;
  /** Epoch milliseconds the row was first created. */
  createdAt: number;
}

/** Input to {@link recordAsset}. */
export interface RecordAssetInput {
  name: string;
  digest: string;
  bytes: number;
  mimeType: string;
  uploadedBy: string | null;
  /** Defaults to `Date.now()`. Exposed for tests and reconciliation backfill. */
  createdAt?: number;
}

interface AssetTableRow {
  name: string;
  digest: string;
  bytes: number;
  mime_type: string;
  uploaded_by: string | null;
  created_at: number;
}

function fromRow(row: AssetTableRow): AssetRecord {
  return {
    name: row.name,
    digest: row.digest,
    bytes: row.bytes,
    mimeType: row.mime_type,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Register a file that exists on disk under the world's assets directory.
 *
 * Idempotent by design: `name` is content-addressed (it embeds an 8-char
 * prefix of the digest), so registering the same name twice describes the
 * same physical file. This upserts instead of failing on the primary-key
 * conflict — the two callers that need that are the upload route sending the
 * exact same request twice (retry, double-click) and the dedup branch of
 * that same route re-registering a file a *previous* upload already wrote.
 * `created_at` AND `uploaded_by` are preserved from the first registration:
 * both answer "who put this file here, and when", and neither changes because
 * somebody sent the same bytes again. Refreshing `uploaded_by` on every call
 * would silently turn the column into "the last person who tried", which is
 * not what its name says and not a question anyone asked.
 */
export function recordAsset(db: Database, input: RecordAssetInput): void {
  const createdAt = input.createdAt ?? Date.now();
  db.prepare(
    `INSERT INTO assets (name, digest, bytes, mime_type, uploaded_by, created_at)
     VALUES (@name, @digest, @bytes, @mimeType, @uploadedBy, @createdAt)
     ON CONFLICT(name) DO UPDATE SET
       digest      = excluded.digest,
       bytes       = excluded.bytes,
       mime_type   = excluded.mime_type`,
  ).run({
    name: input.name,
    digest: input.digest,
    bytes: input.bytes,
    mimeType: input.mimeType,
    uploadedBy: input.uploadedBy,
    createdAt,
  });
}

/**
 * Remove the registry row for `name`, if any.
 *
 * A no-op (not an error) when the row does not exist — the caller is
 * `DELETE /api/assets/:name` after the file itself is already gone from
 * disk, and a file that was never registered (pre-existing, not yet
 * reconciled) is deleted the same way a registered one is.
 */
export function deleteAssetRecord(db: Database, name: string): void {
  db.prepare(`DELETE FROM assets WHERE name = ?`).run(name);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Look up a single asset by storage filename. Returns `undefined` if absent. */
export function getAssetRecord(db: Database, name: string): AssetRecord | undefined {
  const row = db.prepare(`SELECT * FROM assets WHERE name = ?`).get(name) as
    | AssetTableRow
    | undefined;
  return row ? fromRow(row) : undefined;
}

/** List every registered asset, ordered by filename. */
export function listAssetRecords(db: Database): AssetRecord[] {
  const rows = db.prepare(`SELECT * FROM assets ORDER BY name`).all() as AssetTableRow[];
  return rows.map(fromRow);
}
