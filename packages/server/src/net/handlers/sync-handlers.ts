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
import { DocumentNotFoundError } from "../../documents/store.js";
import { OwnershipLevel, resolveOwnership, isRolePrivileged } from "../../documents/ownership.js";
import {
  redactCombatDocsForNonPrivileged,
  redactSceneDocsForNonPrivileged,
  stripHiddenCombatantsFromCombat,
} from "../redaction.js";
import { broadcastToWorld } from "./doc-handlers.js";
import type { SystemModule } from "@fusion/system-api";
import { runActorDerivation } from "../derive-runner.js";

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
 * Invariant (specs 04/05/44): a hidden token's position/existence — and the
 * existence of any scene that is not on air — must never reach a non-GM socket,
 * including via delta resync replay. A player who reconnects must not be able to
 * read out of the buffer what the live path refused to send.
 *
 * The OpBuffer stores the SAME GM-visible envelopes that the live broadcast
 * path produces.  Every embedded token op (create / update / delete on a
 * Token) is buffered by the doc handlers as a Scene update of the form
 * `{ documentType: "Scene", documents: [fullScene] }` (see handleEmbedded*),
 * and primary Scene create/update ops use the same `{ documentType, documents }`
 * shape.  There is therefore exactly one shape to redact here, and it is the
 * same one `broadcastToWorld` redacts live: run the batch through the canonical
 * `redactSceneDocsForNonPrivileged`.
 *
 * There is no separate "Token" branch and no `payload.updates` / `payload.data`
 * branch: those shapes are never buffered, so handling them would be dead code.
 *
 * The buffered envelope is SHARED with every other consumer (the GM delta, the
 * buffer itself).  We must never mutate it in place — when redaction removes a
 * token we emit a fresh cloned envelope and leave the buffered original intact.
 *
 * Ownership is deliberately NOT filtered here, because the live broadcast does
 * not filter it either (`broadcastToWorld` redacts a Scene per socket but
 * delivers it to everyone). Filtering only the replay would make what a player
 * sees depend on whether they were connected at the time. The snapshot DOES
 * filter by ownership, so the two paths disagree — a real contradiction, with
 * the table-facing consequences documented as a task in
 * `docs/design/banco-de-dados/tasks.md`. Picking a side is a product decision,
 * not something to settle inside an unrelated fix.
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

    if (op.type === "doc:delete") {
      return filterSceneDeleteOpForRole(op);
    }

    if (op.type !== "doc:create" && op.type !== "doc:update") return op;

    const payload = op.payload as Record<string, unknown> | null | undefined;
    if (!payload || typeof payload !== "object") return op;

    const documentType = payload["documentType"];

    // REQ-CBA-082 / REQ-CBT-031: the generic document path buffers Combat
    // bodies too — a `doc:update` on a Combat, and every embedded Combatant op
    // (which republishes the parent as `{ documentType: "Combat", documents:
    // [...] }`, since T036 started broadcasting the document itself so the
    // client's `_stats.version` can move). Replaying them raw would hand a
    // reconnecting player exactly the hidden combatants the live path refused
    // to send. Same redaction function the live path uses — the one in
    // net/redaction.ts, never a second copy of the predicate.
    if (documentType === "Combat") {
      return filterCombatDocOpForRole(op, payload);
    }

    if (documentType !== "Scene") return op;

    const documents = payload["documents"];
    if (!Array.isArray(documents)) return op;

    // Drop every scene that was not on air and redact the one that was
    // (REQ-CEN-071..073) — the same rule the live broadcast applies, so a
    // player who reconnects cannot read from the buffer what the live path
    // refused to send.
    const stripped = redactSceneDocsForNonPrivileged(documents as Record<string, unknown>[]);
    // If nothing changed (same length, all same references), return the original op.
    const changed =
      stripped.length !== documents.length || stripped.some((doc, i) => doc !== documents[i]);
    if (!changed) return op;

    // Clone — never mutate the shared buffered envelope. The op itself is kept
    // (possibly with an empty `documents`) so the replayed seq stays contiguous.
    return { ...op, payload: { ...payload, documents: stripped } };
  });
}

/**
 * Blank the id list of a buffered Scene `doc:delete` for non-GM delta replay.
 *
 * REQ-CEN-071: a player only ever received the scene on air, so replaying the
 * removal of any other scene would tell them, after the fact, that a scene they
 * were never allowed to see existed. The live path can tell the two apart
 * (`broadcastToWorld` gets the on-air ids captured before the rows went); the
 * buffer cannot — the `active` mirror died with the document — so the whole id
 * list is dropped here rather than guessed.
 *
 * The envelope itself is kept, with an empty `ids`, so the replayed seq stays
 * contiguous. Consequence worth naming: a player offline while the GM deleted
 * the scene ON AIR keeps a stale copy of it. That case is exactly what
 * REQ-CEN-064 says must be refused server-side (deleting the scene on air) and
 * is not implemented yet — the refusal is the fix, not a wider replay.
 */
function filterSceneDeleteOpForRole(op: Envelope): Envelope {
  const payload = op.payload as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== "object") return op;
  if (payload["documentType"] !== "Scene") return op;
  const ids = payload["ids"];
  if (!Array.isArray(ids) || ids.length === 0) return op;
  return { ...op, payload: { ...payload, ids: [] } };
}

/**
 * Redact hidden combatants from a buffered `doc:create` / `doc:update` whose
 * `documentType` is "Combat" — the generic-document counterpart of
 * {@link filterCombatOpForRole}, which covers only the dedicated `combat:*`
 * envelopes.
 *
 * Shape: `{ documentType: "Combat", documents: [fullCombat] }`, the same one
 * `broadcastToWorld` redacts live, so a player who reconnects cannot read from
 * the buffer what the live path refused to send (REQ-CBA-082, REQ-CBT-031).
 *
 * Never mutates the shared buffered envelope — clones only when stripping.
 */
function filterCombatDocOpForRole(op: Envelope, payload: Record<string, unknown>): Envelope {
  const documents = payload["documents"];
  if (!Array.isArray(documents)) return op;

  const originals = documents as Record<string, unknown>[];
  const redacted = redactCombatDocsForNonPrivileged(originals);
  const changed = redacted.some((doc, i) => doc !== originals[i]);
  if (!changed) return op;

  return { ...op, payload: { ...payload, documents: redacted } };
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
 * Two document types answer to a rule of their own instead of ownership:
 * Combat (shared world state, REQ-CBT-031..033) and Scene (only the one on air
 * reaches a player, REQ-CEN-071..073). Both carry their redaction.
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
      } else if (docType === "Scene") {
        // Spec 44 §5.8: for a player the scene list is not ownership-gated, it
        // is ON-AIR-gated — the same shape as the Combat carve-out above, and
        // for the same reason. Scenes carry the default ownership of NONE, so
        // the LIMITED filter used to drop EVERY scene from a player's join
        // snapshot, the scene on air included: a player joining mid-session
        // got no map at all and only recovered when the GM happened to touch
        // the scene and the live broadcast leaked it (REQ-CEN-072).
        // The on-air rule is at once stricter — no off-air scene passes,
        // whatever its ownership map claims (REQ-CEN-071, REQ-CEN-073) — and
        // sufficient, and it carries the hidden-token / secret-door redaction.
        visible = redactSceneDocsForNonPrivileged(all);
      } else {
        visible = all.filter((doc) => {
          const ownership = getOwnershipFromDoc(doc);
          const level = resolveOwnership(ownership, userId, role);
          return level >= OwnershipLevel.LIMITED;
        });
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
// T032 — doc:update broadcast for scene version bumps
// ---------------------------------------------------------------------------

/**
 * Broadcast a `doc:update` for one or more Scene documents whose `active`
 * mirror was just written by `buildActiveSceneHandler`.
 *
 * Delivery matches doc-handlers.ts's `broadcastToWorld` exactly — the same
 * per-socket walk and the same single funnel (`redactSceneDocsForNonPrivileged`,
 * REQ-CEN-071..073): a non-privileged socket only ever receives the scene that
 * is on air, redacted; every other scene is dropped from its copy of the batch.
 */
function broadcastSceneVersionUpdates(
  deps: SyncHandlerDeps,
  scenes: Record<string, unknown>[],
): void {
  if (scenes.length === 0) return;

  const seq = deps.seqStore.next();
  const fullEnvelope: Envelope = {
    type: "doc:update",
    seq,
    ts: Date.now(),
    payload: { documentType: "Scene", documents: scenes },
  };
  // REQ-NET-062: push the GM-visible (full) envelope BEFORE emitting, same
  // ordering as every other doc:update broadcast site — a resync:delta
  // client must see this version bump even if it reconnects mid-emit.
  deps.opBuffer.push(fullEnvelope);

  for (const [, socket] of deps.ns.sockets) {
    const data = socket.data as { role?: unknown } | null | undefined;
    const role = typeof data?.role === "number" ? data.role : 0;

    if (isPrivileged(role)) {
      socket.emit("op", fullEnvelope);
      continue;
    }

    // REQ-CEN-071..073: same funnel as every other Scene emission — off-air
    // scenes are dropped for the player (the envelope still goes out, possibly
    // with empty `documents`, to keep the seq contiguous), the on-air scene
    // keeps its hidden-token / secret-door redaction.
    const redacted = redactSceneDocsForNonPrivileged(scenes);
    socket.emit("op", {
      ...fullEnvelope,
      payload: { documentType: "Scene", documents: redacted },
    });
  }
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

    // REQ-CEN-045: a target that does not exist is a FAILURE, not a silent
    // divergence. Without this, the reconcile below took every scene off the
    // air, wrote a pointer naming nothing and broadcast it: the source of
    // truth would name a scene with no body behind it, every client would
    // render an empty canvas, and no resync would ever repair it (the snapshot
    // reads the same broken pointer). Refuse before writing anything.
    // `sceneId: null` stays legal — that is how "nothing on air" is expressed.
    if (sceneId !== null) {
      try {
        deps.store.get("scenes", sceneId);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          return {
            ok: false,
            code: "NOT_FOUND" as const,
            message: `Scene not found: ${sceneId}`,
          };
        }
        throw err;
      }
    }

    // T010: settings['_meta:activeScene'] is the source of truth — it is what
    // the join snapshot reads and what survives a restart. The `active` field
    // on each scene document is a mirror, maintained here and nowhere else
    // (doc:update refuses to write it). Reconciling every document against the
    // target, instead of trusting the mirror to say who is active today, also
    // repairs a world whose mirrors drifted apart in the past.
    const allScenes = deps.store.getAll("scenes");
    const updatedScenes: Record<string, unknown>[] = [];

    for (const scene of allScenes) {
      const id = scene["_id"] as string;
      const shouldBeActive = id === sceneId;
      const mirrorSaysActive = scene["active"] === true;

      if (shouldBeActive !== mirrorSaysActive) {
        const updated = deps.store.update(
          "scenes",
          id,
          { active: shouldBeActive },
          { userId: ctx.userId },
        );
        if (updated) updatedScenes.push(updated);
      }
    }

    // Persist active scene in settings via raw SQL (the meta key contains ":"
    // which fails the BaseDocument _id regex — we use direct SQL like SeqStore)
    persistActiveSceneId(deps.db, sceneId);

    // REQ-CEN-072: a player's mirror only ever holds the scene on air
    // (REQ-CEN-071), so the scene that just went on air has to be handed to
    // them NOW — the activation broadcast below carries an id, not a body, and
    // the canvas renders from the mirror. Emitted BEFORE world:activeScene so
    // the document lands before the pointer that references it. Privileged
    // sockets get the same envelope, which also repairs their `active` mirror.
    if (sceneId !== null) {
      let onAirScene: Record<string, unknown> | null = null;
      try {
        onAirScene = deps.store.get("scenes", sceneId);
      } catch {
        onAirScene = null; // scene vanished between reconcile and broadcast
      }
      if (onAirScene) {
        const docSeq = deps.seqStore.next();
        const docEnvelope: Envelope = {
          type: "doc:update",
          seq: docSeq,
          ts: Date.now(),
          payload: { documentType: "Scene", documents: [onAirScene] },
        };
        deps.opBuffer.push(docEnvelope);
        broadcastToWorld(deps.ns, docEnvelope, "Scene");
      }
    }

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

    // T032: the store.update() calls above bumped `_stats.version` on every
    // affected scene without ever emitting a doc:update — a connected
    // client's DocumentMirror would be stuck on the stale version forever
    // (no doc:update ever arrives to trigger a resync). Broadcast the
    // version bump for the scenes that LEFT the air; the scene that went on
    // air already travelled above (body before pointer, REQ-CEN-072), with
    // its bumped version, so emitting it again here would only duplicate the
    // envelope. Non-privileged sockets receive the envelope with the off-air
    // scenes dropped (REQ-CEN-071), through the single redaction funnel.
    broadcastSceneVersionUpdates(
      deps,
      updatedScenes.filter((scene) => scene["_id"] !== sceneId),
    );

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
