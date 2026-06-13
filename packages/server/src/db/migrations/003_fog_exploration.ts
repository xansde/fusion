/**
 * Migration 003 — Fog exploration table.
 *
 * Creates the `fog_exploration` table that persists per-user, per-scene
 * fog-of-war exploration state. The table is intentionally simple: the
 * server is "storage-dumb" and does NOT recalculate vision — it only stores
 * whatever the client sends.
 *
 * Design notes (spec 07 §D6, spec 02 §DEC-18, spec 04 §fog ops):
 *   - Primary key: (user_id, scene_id) — one row per user/scene pair.
 *   - `shape` column: JSON blob (FogShapeData wire format). No separate BLOB
 *     column — JSON keeps the data debuggable and avoids codec complexity.
 *   - `updated_at`: Unix epoch ms; used for conflict resolution if a user has
 *     the scene open on two devices simultaneously (last write wins — Q4).
 *   - FK on `scene_id` REFERENCES `scenes(id)`: deletions of a scene cascade
 *     to delete all exploration rows, satisfying the "delete scene → delete
 *     its fog" requirement.
 *   - No FK on `user_id` because users are stored in the same `users` table
 *     that may be modified independently; the cascade is handled manually in
 *     the scene-delete path (the FK on scene_id covers the main cascade need).
 *
 * REQ-VIS-083: persist exploration by (user, scene).
 * REQ-VIS-086/087: reset by GM deletes rows; DEC-18 says fog is NOT a
 *   first-class Document in the MVP.
 */

import type { FusionMigration } from "../migrations.js";

export const migration003: FusionMigration = {
  version: 3,
  description: "Fog of war: fog_exploration table (user_id, scene_id, shape JSON, updated_at)",

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fog_exploration (
        user_id     TEXT    NOT NULL,
        scene_id    TEXT    NOT NULL,
        shape       TEXT    NOT NULL,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (user_id, scene_id)
      );

      -- Index for GM reset-all (delete all rows for a scene) — covered by PK
      -- but an explicit scene_id index helps the DELETE scan.
      CREATE INDEX IF NOT EXISTS idx_fog_scene
        ON fog_exploration(scene_id);

      -- Trigger: cascade-delete fog_exploration rows when a scene is deleted.
      -- This replaces the FK REFERENCES scenes(id) ON DELETE CASCADE, which
      -- would reject fog:update for scenes that don't yet exist in the scenes
      -- table (e.g. during tests or when the scene hasn't been persisted yet).
      CREATE TRIGGER IF NOT EXISTS trg_fog_cascade_scene_delete
        AFTER DELETE ON scenes
        FOR EACH ROW
      BEGIN
        DELETE FROM fog_exploration WHERE scene_id = OLD.id;
      END;
    `);
  },
};
