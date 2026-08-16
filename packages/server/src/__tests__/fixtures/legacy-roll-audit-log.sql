-- Captured from a real world database (schema version 3), where this
-- table was created by the ensureAuditTable() that chat/roll-service.ts carried
-- before migration 005 adopted it. Do not retype it: the whole point is that
-- this text was never typed by whoever wrote the migration.
--
-- Extracted with: SELECT sql FROM sqlite_master WHERE name IN (...)

CREATE TABLE roll_audit_log (
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

CREATE INDEX idx_roll_audit_world_user
      ON roll_audit_log(world_id, user_id, created_at);
