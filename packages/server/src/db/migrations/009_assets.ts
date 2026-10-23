/**
 * Migration 009 — Asset registry table (T020).
 *
 * Named `008_assets.ts` in the original plan (docs/design/banco-de-dados/tasks.md),
 * but `008` was already taken by `008_scene_active` by the time this landed —
 * this is `009` instead. Skipping a used version number is exactly what the
 * schema guard (D6) exists to catch, so the number was re-checked against
 * `db/index.ts` before writing this file, not assumed from the plan doc.
 *
 * D2 keeps the world lean by moving sounds and images out of `world.db` and
 * into `worlds/<slug>/assets/` on disk — the directory is what grows, not the
 * database. D3 asks for a *light* registry of what lives there: this table
 * describes the file (name, content hash, size, mime, who uploaded it, when),
 * nothing more. It does not track which documents reference an asset — no
 * foreign keys into `actors`/`scenes`/etc., no write-path hook on document
 * save. Finding orphans/usage is a scan-time job (T022's reconciliation),
 * deliberately kept out of the hot path of every document write.
 *
 * `name` is the primary key, not `digest`. The upload route (T021,
 * `assets/routes.ts`) already deduplicates by content hash *before* writing:
 * a second upload of identical bytes never creates a second file, so on disk
 * there is exactly one filename per digest already. The filename is also the
 * thing every other part of the system addresses the asset by (URLs, the
 * `DELETE /api/assets/:name` route, directory listings) — it is the row's
 * real identity, so it is the row's key. `digest` keeps a plain (non-unique)
 * index: useful for reverse lookups and for D4's backup-dedup-by-hash later,
 * without asserting a uniqueness guarantee the write path does not actually
 * enforce (a rare 8-hex prefix collision in the *directory* dedup scan is a
 * pre-existing characteristic of that scan, not something this table should
 * pretend can't happen by refusing a second row).
 *
 * A brand-new database gets this table empty. Worlds that already have files
 * under `assets/` from before this migration get no rows for them — the
 * table describes what the *registration path* has seen, and a fresh
 * `CREATE TABLE` cannot retroactively know about files it never touched.
 * That gap is exactly what T022's reconciliation (scan the directory, insert
 * what's missing) is for; this migration only has to not break on their
 * account, which it doesn't — `assets` is additive schema, nothing here reads
 * the directory or assumes rows exist for every file in it.
 */

import type { FusionMigration } from "../migrations.js";

export const migration009: FusionMigration = {
  version: 9,
  description: "Asset registry: assets table (name, digest, bytes, mime, uploader) (T020)",

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        name        TEXT    PRIMARY KEY NOT NULL,
        digest      TEXT    NOT NULL,
        bytes       INTEGER NOT NULL,
        mime_type   TEXT    NOT NULL,
        uploaded_by TEXT,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_assets_digest ON assets(digest);
    `);
  },
};
