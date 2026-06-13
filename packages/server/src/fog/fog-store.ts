/**
 * FogStore — low-level SQLite access for fog_exploration rows.
 *
 * The server is intentionally "storage-dumb" regarding fog:
 *   - It stores whatever the client sends (after validation).
 *   - It never recalculates vision or merges shapes.
 *   - It never returns fog data for a user other than the requester.
 *
 * All public methods take explicit (userId, sceneId) parameters.
 * There is NO method that accepts a userId from the payload — the caller
 * (handler) always passes ctx.userId from the authenticated session.
 *
 * Spec: 07-visao-iluminacao-fog.md §REQ-VIS-083, §REQ-VIS-086, §REQ-VIS-087
 * Spec: 02-modelo-de-dados.md §DEC-18 (fog is NOT a first-class Document)
 * Spec: 04-rede-e-sincronizacao.md §fog ops
 */

import type { Database as Db } from "better-sqlite3";
import { MAX_FOG_PAYLOAD_BYTES, isValidFogShapeData, emptyFogShapeData } from "@fusion/shared";
import type { FogShapeData } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Row type (matches the fog_exploration table schema)
// ---------------------------------------------------------------------------

interface FogExplorationRow {
  user_id: string;
  scene_id: string;
  shape: string; // JSON-serialized FogShapeData
  updated_at: number; // Unix epoch ms
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class FogPayloadTooLargeError extends Error {
  constructor(
    public readonly bytes: number,
    public readonly limit: number,
  ) {
    super(
      `Fog payload is too large: ${String(bytes)} bytes (limit: ${String(limit)} bytes). ` +
        "The client must simplify the shape before sending.",
    );
    this.name = "FogPayloadTooLargeError";
  }
}

export class FogShapeValidationError extends Error {
  constructor(detail: string) {
    super(`Invalid FogShapeData: ${detail}`);
    this.name = "FogShapeValidationError";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FogStoreGetResult {
  /** Stored FogShapeData, or null if no exploration recorded. */
  shape: FogShapeData | null;
}

export interface FogStoreResetResult {
  /** IDs of users whose fog was deleted (may be empty if already clean). */
  affectedUserIds: string[];
}

export class FogStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  // --------------------------------------------------------------------------
  // upsert — fog:update handler
  //
  // Stores the full FogShapeData for (userId, sceneId).
  // Validates size and shape before writing.
  //
  // Isolation guarantee: the userId argument MUST come from the authenticated
  // session context, NEVER from the payload. The handler enforces this.
  // --------------------------------------------------------------------------

  upsert(userId: string, sceneId: string, shapeData: FogShapeData): void {
    // Validate the shape structure
    if (!isValidFogShapeData(shapeData)) {
      throw new FogShapeValidationError("shape does not match FogShapeData schema");
    }

    // Serialize and size-check before writing
    let json: string;
    try {
      json = JSON.stringify(shapeData);
    } catch {
      throw new FogShapeValidationError("shape cannot be serialized to JSON");
    }

    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes > MAX_FOG_PAYLOAD_BYTES) {
      throw new FogPayloadTooLargeError(bytes, MAX_FOG_PAYLOAD_BYTES);
    }

    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO fog_exploration (user_id, scene_id, shape, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, scene_id) DO UPDATE
           SET shape = excluded.shape,
               updated_at = excluded.updated_at`,
      )
      .run(userId, sceneId, json, now);
  }

  // --------------------------------------------------------------------------
  // get — fog:get handler
  //
  // Returns the stored FogShapeData for (userId, sceneId), or null.
  //
  // Isolation guarantee: userId comes from the authenticated session.
  // --------------------------------------------------------------------------

  get(userId: string, sceneId: string): FogStoreGetResult {
    const row = this.db
      .prepare<[string, string], FogExplorationRow>(
        `SELECT user_id, scene_id, shape, updated_at
         FROM fog_exploration
         WHERE user_id = ? AND scene_id = ?`,
      )
      .get(userId, sceneId);

    if (!row) {
      return { shape: null };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.shape);
    } catch {
      // Corrupted row — treat as empty rather than crashing
      return { shape: emptyFogShapeData() };
    }

    if (!isValidFogShapeData(parsed)) {
      // Schema mismatch after migration — treat as empty
      return { shape: emptyFogShapeData() };
    }

    return { shape: parsed };
  }

  // --------------------------------------------------------------------------
  // resetAll — GM fog:reset with target:"all"
  //
  // Deletes ALL fog rows for a scene. Returns the list of affected user IDs
  // so the handler can broadcast fog:wasReset to the right clients.
  // --------------------------------------------------------------------------

  resetAll(sceneId: string): FogStoreResetResult {
    // Collect affected user IDs before deletion
    const rows = this.db
      .prepare<
        [string],
        { user_id: string }
      >(`SELECT user_id FROM fog_exploration WHERE scene_id = ?`)
      .all(sceneId);

    const affectedUserIds = rows.map((r) => r.user_id);

    if (affectedUserIds.length > 0) {
      this.db.prepare(`DELETE FROM fog_exploration WHERE scene_id = ?`).run(sceneId);
    }

    return { affectedUserIds };
  }

  // --------------------------------------------------------------------------
  // resetOne — GM fog:reset with target:{ userId }
  //
  // Deletes the fog row for a specific user in a scene.
  // Returns the affected user IDs (0 or 1 element).
  // --------------------------------------------------------------------------

  resetOne(userId: string, sceneId: string): FogStoreResetResult {
    const info = this.db
      .prepare(`DELETE FROM fog_exploration WHERE user_id = ? AND scene_id = ?`)
      .run(userId, sceneId);

    const affectedUserIds = info.changes > 0 ? [userId] : [];
    return { affectedUserIds };
  }

  // --------------------------------------------------------------------------
  // getUserIds — list all users with fog recorded for a scene
  // (Internal helper; not exposed as a handler)
  // --------------------------------------------------------------------------

  getUserIds(sceneId: string): string[] {
    const rows = this.db
      .prepare<
        [string],
        { user_id: string }
      >(`SELECT user_id FROM fog_exploration WHERE scene_id = ?`)
      .all(sceneId);
    return rows.map((r) => r.user_id);
  }
}
