/**
 * Migration 011 — asset browser category (the FilePicker's tabs).
 *
 * Adds a NULLABLE `category` column to the `assets` registry. NULL means "not set by anybody":
 * the server then derives the category (mime type, icon area, where documents use the file), so
 * every asset that already exists is classified without rewriting a single row. A value is written
 * only when the GM moves an asset to another tab or when an upload declares the tab it was sent
 * from. Worlds that predate this migration open unchanged (the column is nullable, no backfill).
 */

import type { FusionMigration } from "../migrations.js";

export const migration011: FusionMigration = {
  version: 11,
  description: "Asset browser: assets.category (nullable) for the FilePicker tabs",

  up(db) {
    db.exec(`ALTER TABLE assets ADD COLUMN category TEXT;`);
  },
};
