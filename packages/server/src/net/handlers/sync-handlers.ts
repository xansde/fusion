/**
 * Sync handlers — world:snapshot (join), resync:request, world:activeScene.
 *
 * REQ-NET-062..063: buffer circular N=1000, delta ou snapshot completo no join.
 * REQ-NET-024: snapshot filtrado por ownership.
 *
 * world:activeScene (GM only):
 *   - Persists active scene setting in the world's settings table.
 *   - Broadcasts world:activeScene event to all connected clients.
 *   - Ensures at most one scene has active=true at a time.
 */

import type { Socket, Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";
import type { HandlerFn } from "../handler-registry.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import type { DocumentStore } from "../../documents/store.js";
import { OwnershipLevel, resolveOwnership, UserRole } from "../../documents/ownership.js";

import { WorldResyncRequestPayloadSchema, WorldActiveScenePayloadSchema } from "@fusion/shared";
import type {
  WorldSnapshotPayload,
  WorldActiveScenePayload,
  ResyncDeltaPayload,
  ResyncFullPayload,
  Ownership,
} from "@fusion/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Setting key that stores the ID of the currently active scene. */
const ACTIVE_SCENE_SETTING_KEY = "_meta:activeScene";

/** Document tables included in the snapshot. */
const SNAPSHOT_TABLES: Array<{ table: string; docType: string }> = [
  { table: "scenes", docType: "Scene" },
  { table: "actors", docType: "Actor" },
  { table: "items", docType: "Item" },
  { table: "journal_entries", docType: "JournalEntry" },
  { table: "macros", docType: "Macro" },
  { table: "roll_tables", docType: "RollTable" },
  { table: "playlists", docType: "Playlist" },
  { table: "folders", docType: "Folder" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPrivileged(role: number): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
  return role >= UserRole.ASSISTANT_GM;
}

function getOwnershipFromDoc(doc: Record<string, unknown>): Ownership {
  if (
    doc["ownership"] &&
    typeof doc["ownership"] === "object" &&
    !Array.isArray(doc["ownership"])
  ) {
    return doc["ownership"] as Ownership;
  }
  return { default: OwnershipLevel.NONE };
}

/**
 * Read the active scene ID from world settings via raw SQL.
 * Returns null if not set.
 *
 * Uses raw SQL (bypasses DocumentStore) because the meta key "_meta:activeScene"
 * contains ":" which fails the BaseDocument _id regex.
 */
function getActiveSceneId(db: Db): string | null {
  try {
    const row = db
      .prepare(`SELECT data FROM settings WHERE id = ?`)
      .get(ACTIVE_SCENE_SETTING_KEY) as { data: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.data) as { value?: unknown };
    return typeof parsed.value === "string" ? parsed.value : null;
  } catch {
    return null;
  }
}

/**
 * Persist active scene ID to the settings table via raw SQL (upsert).
 */
function persistActiveSceneId(db: Db, sceneId: string | null): void {
  const now = Date.now();
  const data = JSON.stringify({ key: ACTIVE_SCENE_SETTING_KEY, value: sceneId });
  db.prepare(
    `INSERT OR REPLACE INTO settings (id, data, created_at, updated_at)
     VALUES (?, ?, coalesce((SELECT created_at FROM settings WHERE id = ?), ?), ?)`,
  ).run(ACTIVE_SCENE_SETTING_KEY, data, ACTIVE_SCENE_SETTING_KEY, now, now);
}

/**
 * Strip hidden tokens from a Scene document for non-GM players.
 *
 * REQ-NET-024 / FIX-4 (M1-B): players must not receive tokens whose
 * `hidden` field is true.  Fine-grained actor-ownership visibility
 * (e.g. tokens whose actor the player does not own) is deferred to M1-C.
 *
 * Returns a shallow copy of the scene with the tokens array filtered.
 * If the scene has no tokens array the original object is returned unchanged.
 */
function stripHiddenTokens(scene: Record<string, unknown>): Record<string, unknown> {
  const rawTokens = scene["tokens"];
  if (!Array.isArray(rawTokens)) return scene;

  const filtered = (rawTokens as Record<string, unknown>[]).filter(
    (token) => token["hidden"] !== true,
  );

  // Only allocate a new object when something was actually removed.
  if (filtered.length === rawTokens.length) return scene;
  return { ...scene, tokens: filtered };
}

/**
 * Build a world snapshot for a specific user.
 * Filters documents by ownership (REQ-NET-024).
 * For non-GM users, also strips hidden tokens from Scene documents (FIX-4).
 */
function buildSnapshot(deps: SyncHandlerDeps, userId: string, role: number): WorldSnapshotPayload {
  const documents: Record<string, unknown[]> = {};

  for (const { table, docType } of SNAPSHOT_TABLES) {
    try {
      const all = deps.store.getAll(table as never);
      let visible: Record<string, unknown>[];

      if (isPrivileged(role)) {
        visible = all;
      } else {
        visible = all.filter((doc) => {
          const ownership = getOwnershipFromDoc(doc);
          const level = resolveOwnership(ownership, userId, role);
          return level >= OwnershipLevel.LIMITED;
        });

        // Strip hidden tokens from Scene documents for non-GM players (FIX-4).
        // Per-actor ownership visibility is deferred to M1-C.
        if (docType === "Scene") {
          visible = visible.map(stripHiddenTokens);
        }
      }

      documents[docType] = visible;
    } catch {
      documents[docType] = [];
    }
  }

  return {
    seq: deps.seqStore.peek(),
    activeSceneId: getActiveSceneId(deps.db),
    documents,
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface SyncHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
  /** Raw DB for direct settings access (bypasses DocumentStore schema for meta keys). */
  db: Db;
}

// ---------------------------------------------------------------------------
// Join handler — sends snapshot or delta on initial connect
// ---------------------------------------------------------------------------

/**
 * Called on socket connection after auth.
 * Sends either a delta (if client has lastSeq in buffer) or a full snapshot.
 *
 * This is invoked directly from the connection handler, not via op/query events.
 */
export function sendJoinSnapshot(
  socket: Socket,
  deps: SyncHandlerDeps,
  userId: string,
  role: number,
  lastSeq?: number,
): void {
  if (lastSeq !== undefined && lastSeq > 0) {
    // Try delta first.  Pass currentSeq so opsAfter can distinguish between
    // "client already up-to-date" (empty return) and "buffer lost after restart"
    // (null → fall through to full snapshot).
    const delta = deps.opBuffer.opsAfter(lastSeq, deps.seqStore.peek());
    if (delta !== null) {
      // Client can catch up with delta
      const deltaPayload: ResyncDeltaPayload = {
        fromSeq: lastSeq + 1,
        toSeq: deps.seqStore.peek(),
        ops: delta,
      };
      socket.emit("op", {
        type: "resync:delta",
        seq: deps.seqStore.peek(),
        ts: Date.now(),
        payload: deltaPayload,
      });
      return;
    }
  }

  // Full snapshot
  const snapshot = buildSnapshot(deps, userId, role);
  const fullPayload: ResyncFullPayload = {
    reason: lastSeq !== undefined ? "seq_out_of_buffer" : undefined,
    snapshot,
  };

  socket.emit("op", {
    type: "resync:full",
    seq: deps.seqStore.peek(),
    ts: Date.now(),
    payload: fullPayload,
  });
}

// ---------------------------------------------------------------------------
// resync:request handler factory
// ---------------------------------------------------------------------------

export function buildResyncRequestHandler(deps: SyncHandlerDeps): HandlerFn {
  return (_rawPayload, ctx) => {
    const parsed = WorldResyncRequestPayloadSchema.safeParse(_rawPayload);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION_FAILED" as const, message: parsed.error.message };
    }
    const payload = parsed.data;
    const { lastSeq } = payload;

    const delta = deps.opBuffer.opsAfter(lastSeq, deps.seqStore.peek());
    if (delta !== null) {
      const deltaPayload: ResyncDeltaPayload = {
        fromSeq: lastSeq + 1,
        toSeq: deps.seqStore.peek(),
        ops: delta,
      };
      return {
        ok: true as const,
        seq: deps.seqStore.peek(),
        result: { type: "delta", payload: deltaPayload },
      };
    }

    // Full resync needed
    const snapshot = buildSnapshot(deps, ctx.userId, ctx.role);
    const fullPayload: ResyncFullPayload = {
      reason: "seq_out_of_buffer",
      snapshot,
    };
    return {
      ok: true as const,
      seq: deps.seqStore.peek(),
      result: { type: "full", payload: fullPayload },
    };
  };
}

// ---------------------------------------------------------------------------
// world:activeScene handler factory (GM only)
// ---------------------------------------------------------------------------

export function buildActiveSceneHandler(deps: SyncHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    // Only GM/ASSISTANT can activate scenes
    if (!isPrivileged(ctx.role)) {
      return {
        ok: false,
        code: "PERMISSION_DENIED" as const,
        message: "Only GM can activate scenes",
      };
    }

    const parsed = WorldActiveScenePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION_FAILED" as const, message: parsed.error.message };
    }
    const payload = parsed.data;
    const { sceneId } = payload;

    // Deactivate all scenes, then activate the target (atomic via store)
    const allScenes = deps.store.getAll("scenes");

    for (const scene of allScenes) {
      const id = scene["_id"] as string;
      const isTarget = id === sceneId;
      const isCurrentlyActive = scene["active"] === true;

      if (isTarget && !isCurrentlyActive) {
        // Activate this scene
        deps.store.update("scenes", id, { active: true }, { userId: ctx.userId });
      } else if (!isTarget && isCurrentlyActive) {
        // Deactivate this scene
        deps.store.update("scenes", id, { active: false }, { userId: ctx.userId });
      }
    }

    // Persist active scene in settings via raw SQL (the meta key contains ":"
    // which fails the BaseDocument _id regex — we use direct SQL like SeqStore)
    persistActiveSceneId(deps.db, sceneId);

    // Broadcast world:activeScene to all clients
    const seq = deps.seqStore.next();
    const broadcastEnvelope = {
      type: "world:activeScene" as const,
      seq,
      ts: Date.now(),
      payload: { sceneId } satisfies WorldActiveScenePayload,
    };
    deps.opBuffer.push(broadcastEnvelope);
    deps.ns.emit("op", broadcastEnvelope);

    // requestId injection is owned by the dispatcher (socket-manager.ts).
    // This handler must not set it — doing so would be inconsistent with all
    // other handlers and could allow client-controlled requestId injection.
    return { ok: true, seq, result: { sceneId } };
  };
}

// ---------------------------------------------------------------------------
// Export for use in tests
// ---------------------------------------------------------------------------

export { buildSnapshot, getActiveSceneId, persistActiveSceneId };
