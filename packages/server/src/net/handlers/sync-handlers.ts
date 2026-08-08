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
import type { Logger } from "pino";
import type { HandlerFn } from "../handler-registry.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import type { DocumentStore } from "../../documents/store.js";
import { OwnershipLevel, resolveOwnership, isRolePrivileged } from "../../documents/ownership.js";
import {
  stripHiddenTokens,
  redactSecretDoors,
  stripHiddenTiles,
  stripHiddenCombatantsFromCombat,
} from "../redaction.js";
import type { SystemModule } from "@fusion/system-api";
import { runActorDerivation } from "../derive-runner.js";
import { getAmbientTrackState } from "./sound-handlers.js";

import { WorldResyncRequestPayloadSchema, WorldActiveScenePayloadSchema } from "@fusion/shared";
import type {
  Envelope,
  WorldSnapshotPayload,
  WorldActiveScenePayload,
  ResyncDeltaPayload,
  ResyncFullPayload,
  Ownership,
  ChatMessage,
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
  // M2-C: combats appear in the join snapshot so reconnecting clients restore
  // the active encounter (REQ-CBT-005, REQ-CBT-NFR-002). Hidden combatants are
  // stripped for non-GM viewers below (REQ-CBT-031).
  { table: "combats", docType: "Combat" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPrivileged(role: number): boolean {
  return isRolePrivileged(role);
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
 * Filter a list of buffered ops for delivery to a non-privileged client.
 *
 * Invariant (specs 04/05): a hidden token's position/existence must never
 * reach a non-GM socket — including via delta resync replay.
 *
 * The OpBuffer stores the SAME GM-visible envelopes that the live broadcast
 * path produces.  Every embedded token op (create / update / delete on a
 * Token) is buffered by the doc handlers as a Scene update of the form
 * `{ documentType: "Scene", documents: [fullScene] }` (see handleEmbedded*),
 * and primary Scene create/update ops use the same `{ documentType, documents }`
 * shape.  There is therefore exactly one shape to redact here, and it is the
 * same one `broadcastToWorld` redacts live: map each Scene doc through the
 * canonical `stripHiddenTokens`.
 *
 * There is no separate "Token" branch and no `payload.updates` / `payload.data`
 * branch: those shapes are never buffered, so handling them would be dead code.
 *
 * The buffered envelope is SHARED with every other consumer (the GM delta, the
 * buffer itself).  We must never mutate it in place — when redaction removes a
 * token we emit a fresh cloned envelope and leave the buffered original intact.
 *
 * Returns a new array; each element is either the original op (nothing to
 * redact) or a redacted clone.
 */
function filterOpsForRole(ops: Envelope[]): Envelope[] {
  return ops.map((op) => {
    // M2-C: combat broadcasts may carry hidden combatants in their payload.
    // Strip them for non-GM delta replay (REQ-CBT-031).
    if (op.type === "combat:created" || op.type === "combat:updated") {
      return filterCombatOpForRole(op);
    }

    if (op.type !== "doc:create" && op.type !== "doc:update") return op;

    const payload = op.payload as Record<string, unknown> | null | undefined;
    if (!payload || typeof payload !== "object") return op;
    if (payload["documentType"] !== "Scene") return op;

    const documents = payload["documents"];
    if (!Array.isArray(documents)) return op;

    // Apply hidden-token, secret-door and hidden-tile redaction.
    const stripped = (documents as Record<string, unknown>[]).map((doc) => {
      let redacted = stripHiddenTokens(doc);
      redacted = redactSecretDoors(redacted);
      redacted = stripHiddenTiles(redacted);
      return redacted;
    });
    // If nothing changed (all same references), return the original op.
    const changed = stripped.some((doc, i) => doc !== documents[i]);
    if (!changed) return op;

    // Clone — never mutate the shared buffered envelope.
    return { ...op, payload: { ...payload, documents: stripped } };
  });
}

/**
 * Redact hidden combatants from a buffered combat envelope for non-GM delta
 * replay. Handles both payload shapes:
 *   - combat:created → { combat: CombatDocument }
 *   - combat:updated → { combatId, diff: { combatants?: [...] }, seq }
 *
 * Returns the original envelope when nothing needs redacting (fast path); never
 * mutates the shared buffered envelope — clones only when stripping.
 *
 * REQ-CBT-031: hidden combatants must never reach a non-GM socket, including via
 * delta resync replay.
 */
function filterCombatOpForRole(op: Envelope): Envelope {
  const payload = op.payload as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== "object") return op;

  // combat:created — { combat }
  const combat = payload["combat"];
  if (combat && typeof combat === "object") {
    const stripped = stripHiddenCombatantsFromCombat(combat as Record<string, unknown>);
    if (stripped === combat) return op;
    return { ...op, payload: { ...payload, combat: stripped } };
  }

  // combat:updated — { combatId, diff: { combatants?, activeCombatantId? }, seq }
  const diff = payload["diff"];
  if (diff && typeof diff === "object") {
    const diffObj = diff as Record<string, unknown>;
    const combatants = diffObj["combatants"];

    // When the diff carries the full combatants array we can both strip hidden
    // combatants AND determine whether the active pointer must be masked.
    if (Array.isArray(combatants)) {
      const combatantList = combatants as Record<string, unknown>[];
      const filtered = combatantList.filter((c) => c["hidden"] !== true);
      const activeId = diffObj["activeCombatantId"];
      const activeIsHidden =
        typeof activeId === "string" &&
        combatantList.some((c) => c["_id"] === activeId && c["hidden"] === true);

      const nothingRemoved = filtered.length === combatantList.length;
      if (nothingRemoved && !activeIsHidden) return op;

      const newDiff: Record<string, unknown> = { ...diffObj };
      if (!nothingRemoved) newDiff["combatants"] = filtered;
      if (activeIsHidden) newDiff["activeCombatantId"] = null;
      return { ...op, payload: { ...payload, diff: newDiff } };
    }

    // Diff WITHOUT the combatants array (e.g. a pure turnIndex/round/active
    // transition from next/previous). We cannot tell from the diff alone whether
    // activeCombatantId points at a hidden combatant, so mask it conservatively
    // for non-GM replay: if the diff sets activeCombatantId, drop it. Losing the
    // active pointer on replay is harmless — the client falls back to no
    // highlight until the next full payload — whereas leaking a hidden id is not.
    if (typeof diffObj["activeCombatantId"] === "string") {
      return {
        ...op,
        payload: { ...payload, diff: { ...diffObj, activeCombatantId: null } },
      };
    }
  }

  return op;
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
      } else if (docType === "Combat") {
        // M2-C: the combat tracker is shared world state, not ownership-gated —
        // every player sees the encounter. Combats carry no ownership map, so
        // the LIMITED filter would wrongly hide them from all players. We expose
        // every combat but strip hidden combatants for non-GM viewers
        // (REQ-CBT-031..033).
        visible = all.map((combat) => stripHiddenCombatantsFromCombat(combat));
      } else {
        visible = all.filter((doc) => {
          const ownership = getOwnershipFromDoc(doc);
          const level = resolveOwnership(ownership, userId, role);
          return level >= OwnershipLevel.LIMITED;
        });

        // Strip hidden tokens and tiles and redact secret doors from Scene
        // documents for non-GM players (M1-C hidden tokens, M2-A secret doors,
        // hidden tiles for the multi-image scene).
        if (docType === "Scene") {
          visible = visible.map((scene) => {
            let redacted = stripHiddenTokens(scene);
            redacted = redactSecretDoors(redacted);
            redacted = stripHiddenTiles(redacted);
            return redacted;
          });
        }
      }

      // WIRING-DERIVE: compute-on-read for Actor documents joining the
      // snapshot — covers actors that predate derivation wiring (or any
      // other drift) without requiring a doc:update round-trip. Mutates a
      // shallow clone (never the object read from the store) since this
      // computed view is read-only and must not silently persist.
      //
      // ROBUSTNESS (audit issue 1): a minimal-but-schema-valid Actor doc
      // (e.g. `{name, type: "character"}`, accepted by the store's
      // passthrough `system` schema) makes the pf2e/sf2e DeriveSteps throw a
      // TypeError on missing fields. Before this fix the try/catch around
      // the WHOLE TABLE (see the outer catch below) meant one malformed
      // actor turned `documents["Actor"] = []` for EVERY viewer, hiding even
      // well-formed actors. Each actor is now derived independently: a
      // failure logs a warning and that actor is served without `derived`
      // (or whatever it already had), while every other actor is unaffected.
      if (docType === "Actor" && deps.systemModule) {
        const systemModule = deps.systemModule;
        visible = visible.map((actor) => {
          try {
            const clone: Record<string, unknown> = { ...actor };
            const sys = actor["system"];
            // Deep-clone (audit issue 5) — some DeriveSteps mirror computed
            // ability mods onto system.abilities.<ability>.mod for their own
            // internal use (see doc-handlers.ts recomputeDerivedIfNeeded for
            // the full rationale); a shallow clone would still share those
            // nested objects with the store-returned document.
            clone["system"] =
              sys && typeof sys === "object" && !Array.isArray(sys)
                ? structuredClone(sys as Record<string, unknown>)
                : {};
            runActorDerivation(clone, systemModule);
            return clone;
          } catch (err) {
            deps.logger?.warn(
              { err, documentId: actor["_id"] },
              "Actor derivation failed while building snapshot — serving document without derived",
            );
            return actor;
          }
        });
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
    // M3 mapa-som: ambient table track playing right now (or null). Late
    // joiners derive their loop position from `startedAt` locally.
    ambientTrack: getAmbientTrackState(deps.db),
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
  /**
   * Optional: returns recent chat messages visible to a specific user.
   * When provided, the join snapshot will include up to 50 recent messages
   * filtered by the viewer's role (REQ-CHT-033).
   */
  getRecentChat?: (userId: string, role: number) => ChatMessage[];
  /**
   * The world's resolved SystemModule, when available. Used to compute
   * `system.derived` on Actor documents served in the join snapshot
   * (WIRING-DERIVE) — covers actors created before derivation was wired, or
   * any drift, without requiring a doc:update round-trip. Optional —
   * undefined skips derivation (stub system, or no system package loaded).
   */
  systemModule?: SystemModule;
  /**
   * Optional structured logger. When provided, a per-document derivation
   * failure while building the snapshot is logged at `warn` level instead of
   * being silently swallowed — see buildSnapshot.
   */
  logger?: Logger;
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
  if (lastSeq !== undefined) {
    // Try delta first.  Pass currentSeq so opsAfter can distinguish between
    // "client already up-to-date" (empty return) and "buffer lost after restart"
    // (null → fall through to full snapshot).
    const rawDelta = deps.opBuffer.opsAfter(lastSeq, deps.seqStore.peek());
    if (rawDelta !== null) {
      // Redact hidden tokens for non-privileged clients (delta-resync leak fix)
      const delta = isPrivileged(role) ? rawDelta : filterOpsForRole(rawDelta);
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

  // REQ-CHT-033: include recent chat in the join snapshot so the client
  // can display the last N messages without a separate chat:history request.
  if (deps.getRecentChat) {
    const recentChat = deps.getRecentChat(userId, role);
    if (recentChat.length > 0) {
      socket.emit("op", {
        type: "doc:create",
        seq: deps.seqStore.peek(),
        ts: Date.now(),
        payload: {
          documentType: "ChatMessage",
          documents: recentChat,
        },
      });
    }
  }
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

    const rawDelta = deps.opBuffer.opsAfter(lastSeq, deps.seqStore.peek());
    if (rawDelta !== null) {
      // Redact hidden tokens for non-privileged clients (delta-resync leak fix)
      const delta = isPrivileged(ctx.role) ? rawDelta : filterOpsForRole(rawDelta);
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
