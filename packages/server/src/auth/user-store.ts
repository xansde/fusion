/**
 * UserStore — CRUD operations for users in world.db.
 *
 * Users are stored in the `users` table (migration 002 adds auth columns).
 * This module is the authoritative layer for reading/writing user records
 * including password hashes. It never leaks password_hash to callers that
 * request the "public" user shape.
 *
 * REQ-USR-001..006, REQ-USR-025..030
 */

import type { Database as Db } from "better-sqlite3";
import { createDocumentId } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Role numeric values (REQ-USR-005) */
export enum Role {
  PLAYER = 1,
  TRUSTED = 2,
  ASSISTANT = 3,
  GAMEMASTER = 4,
}

/** Full internal record including password_hash (NEVER send to clients). */
export interface UserRecord {
  id: string;
  name: string;
  role: Role;
  color: string;
  avatar: string | null;
  password_hash: string | null;
  active: boolean;
  preferences: Record<string, unknown>;
  created_at: number; // Unix ms
  updated_at: number; // Unix ms
}

/** Safe public shape sent to clients (no password_hash, no _stats leaks). */
export interface UserPublic {
  id: string;
  name: string;
  role: Role;
  color: string;
  avatar: string | null;
  active: boolean;
  preferences: Record<string, unknown>;
}

/** Minimal shape for the join screen (REQ-USR-037). */
export interface UserJoinInfo {
  id: string;
  name: string;
  color: string;
  hasPassword: boolean;
}

// ---------------------------------------------------------------------------
// Raw DB row (as returned by better-sqlite3)
// ---------------------------------------------------------------------------

interface RawUserRow {
  id: string;
  name: string;
  role: number;
  color: string;
  avatar: string | null;
  password_hash: string | null;
  active: number; // SQLite stores booleans as 0/1
  preferences: string; // JSON
  created_at: number;
  updated_at: number;
  data: string; // legacy JSON blob (migration 001) — ignored here
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToRecord(row: RawUserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    color: row.color,
    avatar: row.avatar ?? null,
    password_hash: row.password_hash ?? null,
    active: row.active !== 0,
    preferences: JSON.parse(row.preferences || "{}") as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toPublic(record: UserRecord): UserPublic {
  return {
    id: record.id,
    name: record.name,
    role: record.role,
    color: record.color,
    avatar: record.avatar,
    active: record.active,
    preferences: record.preferences,
  };
}

export function toJoinInfo(record: UserRecord): UserJoinInfo {
  return {
    id: record.id,
    name: record.name,
    color: record.color,
    hasPassword: record.password_hash !== null,
  };
}

/** Suggest a color that is not yet used in this world. */
export function suggestColor(existingColors: string[]): string {
  const palette = [
    "#e03030",
    "#d86910",
    "#d4ba00",
    "#40ab23",
    "#1f8dd6",
    "#7052c8",
    "#c035a2",
    "#3aabad",
    "#e87272",
    "#f0a83a",
    "#f0dc5a",
    "#72c96e",
    "#72b8e8",
    "#aa93e0",
    "#e07ac8",
    "#7ad3d4",
  ];
  const used = new Set(existingColors.map((c) => c.toLowerCase()));
  const available = palette.find((c) => !used.has(c));
  return available ?? palette[existingColors.length % palette.length] ?? "#888888";
}

// ---------------------------------------------------------------------------
// UserStore
// ---------------------------------------------------------------------------

export class UserStore {
  constructor(private readonly db: Db) {}

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  findById(id: string): UserRecord | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
      | RawUserRow
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  findByName(name: string): UserRecord | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE name = ? COLLATE NOCASE`).get(name) as
      | RawUserRow
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  listAll(): UserRecord[] {
    const rows = this.db.prepare(`SELECT * FROM users ORDER BY name`).all() as RawUserRow[];
    return rows.map(rowToRecord);
  }

  listActive(): UserRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM users WHERE active = 1 ORDER BY name`)
      .all() as RawUserRow[];
    return rows.map(rowToRecord);
  }

  /** Count users with a given role. */
  countByRole(role: Role): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = ? AND active = 1`)
      .get(role) as { cnt: number };
    return row.cnt;
  }

  existingColors(): string[] {
    const rows = this.db.prepare(`SELECT color FROM users`).all() as { color: string }[];
    return rows.map((r) => r.color);
  }

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  create(params: {
    name: string;
    role: Role;
    color?: string;
    avatar?: string | null;
    passwordHash?: string | null;
    active?: boolean;
    preferences?: Record<string, unknown>;
  }): UserRecord {
    const id = createDocumentId();
    const now = Date.now();
    const color = params.color ?? suggestColor(this.existingColors());
    const active = params.active ?? true;

    // The `data` column is legacy (migration 001 schema) — store minimal JSON.
    const data = JSON.stringify({ _id: id, name: params.name, role: params.role });

    this.db
      .prepare(
        `INSERT INTO users
           (id, data, name, role, color, avatar, password_hash, active, preferences, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data,
        params.name,
        params.role,
        color,
        params.avatar ?? null,
        params.passwordHash ?? null,
        active ? 1 : 0,
        JSON.stringify(params.preferences ?? {}),
        now,
        now,
      );

    const created = this.findById(id);
    if (!created) throw new Error(`User "${id}" not found after insert`);
    return created;
  }

  // --------------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------------

  update(
    id: string,
    patch: Partial<{
      name: string;
      role: Role;
      color: string;
      avatar: string | null;
      active: boolean;
      preferences: Record<string, unknown>;
    }>,
  ): UserRecord {
    const now = Date.now();
    const fields: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) {
      fields.push("name = ?");
      values.push(patch.name);
    }
    if (patch.role !== undefined) {
      fields.push("role = ?");
      values.push(patch.role);
    }
    if (patch.color !== undefined) {
      fields.push("color = ?");
      values.push(patch.color);
    }
    if ("avatar" in patch) {
      fields.push("avatar = ?");
      values.push(patch.avatar ?? null);
    }
    if (patch.active !== undefined) {
      fields.push("active = ?");
      values.push(patch.active ? 1 : 0);
    }
    if (patch.preferences !== undefined) {
      fields.push("preferences = ?");
      values.push(JSON.stringify(patch.preferences));
    }

    if (fields.length === 0) {
      const unchanged = this.findById(id);
      if (!unchanged) throw new Error(`User "${id}" not found`);
      return unchanged;
    }

    fields.push("updated_at = ?");
    values.push(now);
    values.push(id);

    this.db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    const updated = this.findById(id);
    if (!updated) throw new Error(`User "${id}" not found after update`);
    return updated;
  }

  /** Update password hash only (atomic — also used by reset-password). */
  updatePasswordHash(id: string, hash: string | null): void {
    this.db
      .prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .run(hash, Date.now(), id);
  }
}
