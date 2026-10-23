/**
 * Migration 005 — Roll audit log (T007).
 *
 * Brings `roll_audit_log` under the migration framework. Until now the table
 * was created on demand by `chat/roll-service.ts`, which meant a world's
 * schema depended on whether anyone had ever built a RollService — a database
 * that had never served a session simply did not have the table.
 *
 * The DDL is a faithful copy of the `ensureAuditTable` it replaces, verified
 * against the `sqlite_master` of every world on disk (8 of them, all carrying
 * this table with byte-identical DDL). `CREATE TABLE IF NOT EXISTS` is what
 * makes the upgrade a no-op for those worlds: they keep the table they already
 * have, rows and all, and only the version counter moves.
 *
 * Keeping the shape identical is not cosmetic. The schema guard compares the
 * file's `sqlite_master` against what these migrations produce, so a table
 * that already exists with a *different* definition would fail every boot from
 * here on.
 *
 * REQ-ROL-026 (audit trail of every roll, seed included, server-side only).
 */

import type { FusionMigration } from "../migrations.js";

export const migration005: FusionMigration = {
  version: 5,
  description: "Roll audit log: roll_audit_log table, previously created ad-hoc (T007)",

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS roll_audit_log (
        roll_id          TEXT    PRIMARY KEY NOT NULL,
        world_id         TEXT    NOT NULL,
        user_id          TEXT    NOT NULL,
        actor_id         TEXT,
        formula          TEXT    NOT NULL,
        expanded_formula TEXT    NOT NULL,
        total            REAL    NOT NULL,
        seed             INTEGER NOT NULL,
        created_at       INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_roll_audit_world_user
        ON roll_audit_log(world_id, user_id, created_at);
    `);
  },
};
