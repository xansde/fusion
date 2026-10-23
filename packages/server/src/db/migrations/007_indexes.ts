/**
 * Migration 007 — Indexes that match the queries the server actually runs (T009).
 *
 * The indexes from migration 001 were written from the shape of the tables,
 * not from the queries. This corrects three of them:
 *
 *  - Chat history pages with a keyset cursor:
 *      WHERE timestamp < ? OR (timestamp = ? AND id < ?)
 *      ORDER BY timestamp DESC, id DESC
 *    `id` is the tie-breaker, so a single-column index on `timestamp` leaves
 *    SQLite sorting the result. `idx_chat_ts_id` covers the comparison and the
 *    ordering in one.
 *
 *  - `idx_chat_timestamp` becomes dead weight the moment the composite exists:
 *    anything a `(timestamp)` index can serve, a `(timestamp, id)` index serves
 *    too. Keeping both means paying for two index writes per message.
 *
 *  - `idx_scenes_nav` indexes `scenes.navigation`, which no query in the
 *    codebase filters or orders by — not in the server, not through the generic
 *    document query, whose ORDER BY whitelist does not even include it.
 *
 * `users(name COLLATE NOCASE)` is the fourth query in this family, and it is
 * already served: migration 006 created `idx_users_name_nocase` as part of the
 * rebuild, where the uniqueness rule and the lookup index are the same object.
 *
 * REQ-PER-NF-002 (query latency).
 */

import type { FusionMigration } from "../migrations.js";

export const migration007: FusionMigration = {
  version: 7,
  description: "Indexes: chat keyset pagination, drop unused scene/chat indexes (T009)",

  up(db) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_ts_id
        ON chat_messages(timestamp DESC, id DESC);

      DROP INDEX IF EXISTS idx_chat_timestamp;
      DROP INDEX IF EXISTS idx_scenes_nav;
    `);
  },
};
