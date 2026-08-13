/**
 * Migration 004 — Region maps.
 *
 * Creates the `region_maps` table behind the `RegionMap` document type
 * (DEC-MREG-08): the picture the table consults, with pins on it.
 *
 * It is a table of its own rather than a flavour of `scenes` because a region
 * map is not a place the party stands in — see the header of
 * `packages/shared/src/region-map.ts` for the reasoning. Structurally it is
 * the plainest document table in the schema: id, JSON blob, name, folder,
 * sort, timestamps — the same shape as `journal_entries`, with none of the
 * scene columns (`active`, `navigation`) a map has no meaning for.
 *
 * REQ-MREG-025.
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
