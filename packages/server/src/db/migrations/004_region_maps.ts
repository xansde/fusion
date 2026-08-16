/**
 * Migration 004 — Region maps.
 *
 * Creates the `region_maps` table: id, JSON blob, name, folder, sort,
 * timestamps — the plainest document table in the schema, the same shape as
 * `journal_entries`, with none of the scene columns (`active`, `navigation`).
 *
 * WHY THIS EXISTS HERE: on this line there is no RegionMap document type and
 * nothing reads this table. It is ported verbatim from the other line because
 * existing worlds are already recorded at schema version 4 with this exact
 * table in them — `applyMigrations` only applies `version > MAX(version)`, so
 * a *different* migration numbered 004 would be skipped in silence and the
 * schema guard would then flag the world as divergent on every boot.
 *
 * Keep the DDL byte-identical to the world data already on disk. If this line
 * ever grows its own region maps, that is a NEW migration, not an edit here.
 *
 * Deliberately NOT tagged with the spec-34 requirement it satisfies elsewhere:
 * the traceability report would then count spec 34 as partly implemented here,
 * which it is not — an empty table is not a feature. The tag belongs to the
 * migration on the line that actually has region maps.
 */

import type { FusionMigration } from "../migrations.js";

export const migration004: FusionMigration = {
  version: 4,
  description: "Region maps: region_maps table (RegionMap document type, DEC-MREG-08)",

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS region_maps (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        folder_id   TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_region_maps_name   ON region_maps(name);
      CREATE INDEX IF NOT EXISTS idx_region_maps_folder ON region_maps(folder_id);
    `);
  },
};
