/**
 * Migration 008 — One source of truth for the active scene (T010).
 *
 * "Which scene is active" was recorded in three places: the `scenes.active`
 * column (with an index), the `active` field inside the scene document's JSON,
 * and `settings['_meta:activeScene']`. Only the last one was ever read — the
 * snapshot the client joins with, and the broadcast that follows an activation,
 * both come from it. The column was written on every scene create and update
 * and read by nobody.
 *
 * Three representations, one reader: the other two could drift for months
 * without anything noticing. This removes the column and its index; the field
 * inside the document stays as a mirror the official handler keeps in step,
 * and `world:activeScene` becomes the only way to move it (see
 * `net/handlers/doc-handlers.ts`, which now refuses `active` in a generic
 * scene update).
 *
 * The index has to go first: SQLite refuses to drop a column while an index
 * still covers it, and says so with a bare SQLITE_ERROR that gives no hint
 * about the ordering.
 *
 * DEC-SYNC (active scene lives in world settings).
 */

import type { FusionMigration } from "../migrations.js";

export const migration008: FusionMigration = {
  version: 8,
  description: "Active scene: drop scenes.active column and its index (T010)",

  up(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_scenes_active;
      ALTER TABLE scenes DROP COLUMN active;
    `);
  },
};
