/**
 * Migration 001 — Initial schema.
 *
 * Creates all primary Document tables, the schema_migrations control table,
 * and all required indexes.
 *
 * REQ-PER-006, REQ-PER-007, REQ-PER-008.
 */

import type { FusionMigration } from "../migrations.js";

export const migration001: FusionMigration = {
  version: 1,
  description: "Initial schema: document tables, indexes, schema_migrations",

  up(db) {
    // ------------------------------------------------------------------
    // schema_migrations control table
    // ------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY NOT NULL,
        applied_at  INTEGER NOT NULL,
        description TEXT    NOT NULL
      );
    `);

    // ------------------------------------------------------------------
    // Document tables
    // REQ-PER-006
    // ------------------------------------------------------------------

    db.exec(`
      CREATE TABLE IF NOT EXISTS actors (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        folder_id   TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS items (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        folder_id   TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scenes (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        active      INTEGER NOT NULL DEFAULT 0,
        navigation  INTEGER NOT NULL DEFAULT 1,
        folder_id   TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        folder_id   TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS macros (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        folder_id   TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roll_tables (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        folder_id   TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        folder_id   TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        timestamp   INTEGER NOT NULL,
        author_id   TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS combats (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        scene_id    TEXT,
        active      INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        role        INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS folders (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        parent_id   TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        id          TEXT    PRIMARY KEY NOT NULL,
        data        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `);

    // ------------------------------------------------------------------
    // Indexes
    // REQ-PER-007
    // ------------------------------------------------------------------
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_actors_name        ON actors(name);
      CREATE INDEX IF NOT EXISTS idx_actors_type        ON actors(type);
      CREATE INDEX IF NOT EXISTS idx_actors_folder      ON actors(folder_id);

      CREATE INDEX IF NOT EXISTS idx_items_name         ON items(name);
      CREATE INDEX IF NOT EXISTS idx_items_type         ON items(type);
      CREATE INDEX IF NOT EXISTS idx_items_folder       ON items(folder_id);

      CREATE INDEX IF NOT EXISTS idx_scenes_active      ON scenes(active);
      CREATE INDEX IF NOT EXISTS idx_scenes_nav         ON scenes(navigation);
      CREATE INDEX IF NOT EXISTS idx_scenes_folder      ON scenes(folder_id);

      CREATE INDEX IF NOT EXISTS idx_journal_name       ON journal_entries(name);
      CREATE INDEX IF NOT EXISTS idx_journal_folder     ON journal_entries(folder_id);

      CREATE INDEX IF NOT EXISTS idx_chat_timestamp     ON chat_messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_chat_author        ON chat_messages(author_id);

      CREATE INDEX IF NOT EXISTS idx_folders_type       ON folders(type);
      CREATE INDEX IF NOT EXISTS idx_folders_parent     ON folders(parent_id);

      CREATE INDEX IF NOT EXISTS idx_roll_tables_folder ON roll_tables(folder_id);

      CREATE INDEX IF NOT EXISTS idx_combats_scene      ON combats(scene_id);
      CREATE INDEX IF NOT EXISTS idx_combats_active     ON combats(active);
    `);
  },
};
