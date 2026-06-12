/**
 * Document operation handlers — doc:create, doc:update, doc:delete.
 *
 * REQ-NET-020..026: server-authoritative CRUD with permission checks,
 * validation, persistence, seq assignment and broadcast.
 *
 * Permission rules (spec 05):
 *   - GM (role 4) or ASSISTANT (role 3): can do everything.
 *   - Scene create/update/delete: GM/ASSISTANT only.
 *   - Token embedded create/update/delete on a Scene: GM/ASSISTANT OR the
 *     player who owns the referenced Actor (OWNER level).
 *   - Other primary docs: GM/ASSISTANT for create/delete; OWNER for update.
 *
 * Embedded documents (tokens inside scenes) are addressed via
 *   DocCreatePayload.parent / DocDeletePayload.parent or
 *   DocUpdatePayload.updates[*].embedded
 *
 * REQ-NET-025: embedded doc ops must update the parent document and broadcast
 * the parent's new state with a fresh seq.
 *
 * M1-C hidden-token broadcast filtering (REQ-CNV hidden token):
 *
 * When a Scene update touches hidden tokens, we emit per-socket payloads
 * instead of a single namespace-wide emit.  The filtering semantics are:
 *
 *   - GM/ASSISTANT sockets receive the full Scene including all hidden tokens.
 *   - Player sockets receive the Scene with hidden tokens stripped out.
 *
 * From a player's perspective this produces naturally correct event semantics:
 *   - Token created as hidden     → player receives nothing about that token
 *                                   (Scene update arrives without it).
 *   - Token toggled hidden→visible → player receives doc:update with Scene
 *                                   now including that token (create-like).
 *   - Token toggled visible→hidden → player receives doc:update with Scene
 *                                   no longer containing that token (delete-like).
 *   - Token moved while hidden    → player receives doc:update for the Scene
 *                                   but the token is absent, so position leaks
 *                                   nothing.
 *
 * We only pay the per-socket iteration cost when the operation actually
 * involves a Scene document.  All other doc types (Actor, Item, etc.) continue
 * to use the cheap namespace-wide emit path.
 */

import type { Namespace, Socket } from "socket.io";
import type { HandlerFn, HandlerContext } from "../handler-registry.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import type { DocumentStore } from "../../documents/store.js";
import {
  DocumentNotFoundError,
  DocumentValidationError,
  DocumentIdCollisionError,
} from "../../documents/store.js";
import {
  UserRole,
  resolveOwnership,
  OwnershipLevel,
  isRolePrivileged,
} from "../../documents/ownership.js";
import {
  DocCreatePayloadSchema,
  DocUpdatePayloadSchema,
  DocDeletePayloadSchema,
  TokenDocumentSchema,
} from "@fusion/shared";
import type { DocUpdatePayload, Ack, Ownership, Envelope, ErrorCode } from "@fusion/shared";
import { createDocumentId } from "@fusion/shared";
import {
  stripHiddenTokens,
  scenePayloadHasHiddenTokens,
  redactSecretDoors,
  scenePayloadHasSecretDoors,
} from "../redaction.js";

// ---------------------------------------------------------------------------
// Ack builder helpers
// ---------------------------------------------------------------------------

/**
 * Build a success ack.
 *
 * requestId is intentionally omitted — the central dispatcher in
 * socket-manager.ts injects it from the incoming envelope for all acks.
 * Single source of truth: dispatcher owns requestId injection.
 */
function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Map from documentType string (client-facing) to DocumentTable key. */
const TYPE_TO_TABLE: Record<string, string> = {
  Actor: "actors",
  Item: "items",
  Scene: "scenes",
  JournalEntry: "journal_entries",
  Macro: "macros",
  RollTable: "roll_tables",
  Playlist: "playlists",
  ChatMessage: "chat_messages",
  Combat: "combats",
  User: "users",
  Folder: "folders",
  Setting: "settings",
};

/** Document types that only GM/ASSISTANT can create or delete. */
const GM_ONLY_CREATE_DELETE = new Set(["Scene", "Actor", "Item", "Macro", "RollTable", "Playlist"]);

/** Embedded collection names → their parent's documentType. */
const EMBEDDED_PARENT_MAP: Record<string, string> = {
  Token: "Scene",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveTable(documentType: string): string | null {
  return TYPE_TO_TABLE[documentType] ?? null;
}

function isPrivileged(role: number): boolean {
  return isRolePrivileged(role);
}

/** Extract the ownership map from a raw document, returning a default if absent. */
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
 * Build a broadcast envelope for an op and push it to the buffer.
 */
function buildBroadcastEnvelope(
  type: "doc:create" | "doc:update" | "doc:delete",
  payload: unknown,
  seq: number,
): Envelope {
  return {
    type,
    seq,
    ts: Date.now(),
    payload,
  };
}

// ---------------------------------------------------------------------------
// Context needed by all doc handlers
// ---------------------------------------------------------------------------

export interface DocHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
}

// ---------------------------------------------------------------------------
// doc:create handler factory
// ---------------------------------------------------------------------------

export function buildDocCreateHandler(deps: DocHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = DocCreatePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const payload = parsed.data;
    const { documentType, data, parent } = payload;

    // Embedded token creation (tokens inside a Scene)
    if (parent) {
      return handleEmbeddedCreate(deps, ctx, documentType, data, parent);
    }

    // Primary document creation
    const table = resolveTable(documentType);
    if (!table) {
      return ackError("VALIDATION_FAILED", `Unknown documentType: ${documentType}`);
    }

    // Permission check: GM_ONLY_CREATE_DELETE types require GM/ASSISTANT
    if (GM_ONLY_CREATE_DELETE.has(documentType) && !isPrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", `Only GM/Assistant can create ${documentType}`);
    }

    // Non-privileged users can create their own documents for allowed types
    // (e.g., Actor requires ACTOR_CREATE permission — simplified here to TRUSTED+)
    if (
      !isPrivileged(ctx.role) && // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      ctx.role < UserRole.TRUSTED
    ) {
      return ackError("PERMISSION_DENIED", "Insufficient role to create documents");
    }

    const authorCtx = { userId: ctx.userId };
    const created: Record<string, unknown>[] = [];

    try {
      for (const item of data) {
        const doc = deps.store.create(table as never, item as Record<string, unknown>, authorCtx);
        created.push(doc);
      }
    } catch (err) {
      if (err instanceof DocumentValidationError) {
        return ackError("VALIDATION_FAILED", err.message);
      }
      if (err instanceof DocumentIdCollisionError) {
        return ackError("VALIDATION_FAILED", err.message);
      }
      throw err;
    }

    const seq = deps.seqStore.next();
    const broadcastPayload = { documentType, documents: created };
    const envelope = buildBroadcastEnvelope("doc:create", broadcastPayload, seq);
    deps.opBuffer.push(envelope);

    // Broadcast to world (per-socket hidden-token filtering applied for Scene).
    broadcastToWorld(deps.ns, envelope, documentType);

    return ackOk({ documentType, documents: created }, seq);
  };
}

// ---------------------------------------------------------------------------
// doc:update handler factory
// ---------------------------------------------------------------------------

export function buildDocUpdateHandler(deps: DocHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = DocUpdatePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const payload = parsed.data;
    const { documentType, updates } = payload;

    // Check for embedded updates (tokens inside scenes)
    const hasEmbedded = updates.some((u) => u.embedded);
    if (hasEmbedded) {
      // All updates in the batch must be embedded OR all primary
      return handleEmbeddedUpdate(deps, ctx, documentType, updates);
    }

    const table = resolveTable(documentType);
    if (!table) {
      return ackError("VALIDATION_FAILED", `Unknown documentType: ${documentType}`);
    }

    const authorCtx = { userId: ctx.userId };
    const updated: Record<string, unknown>[] = [];

    for (const upd of updates) {
      // Load existing document for ownership check
      let existing: Record<string, unknown>;
      try {
        existing = deps.store.get(table as never, upd._id);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          return ackError("NOT_FOUND", `Document not found: ${documentType}/${upd._id}`);
        }
        throw err;
      }

      // Permission check: must be GM/ASSISTANT or OWNER of the document
      if (!isPrivileged(ctx.role)) {
        const ownership = getOwnershipFromDoc(existing);
        const level = resolveOwnership(ownership, ctx.userId, ctx.role);
        if (level < OwnershipLevel.OWNER) {
          return ackError("PERMISSION_DENIED", `No OWNER access to ${documentType}/${upd._id}`);
        }
      }

      // STALE_WRITE check: expectedVersion must match _stats.version (monotonic
      // write counter, starts at 1 and increments on every successful update).
      // Do NOT compare against modifiedTime — it is a wall-clock timestamp
      // which lives in a different numeric space and is not monotonically
      // reliable for concurrent-write detection.
      if (upd.expectedVersion !== undefined) {
        const stats = existing["_stats"] as Record<string, unknown> | undefined;
        const currentVersion = stats?.["version"] as number | undefined;
        if (currentVersion !== undefined && currentVersion !== upd.expectedVersion) {
          return ackError("STALE_WRITE", "Document has been modified since last read");
        }
      }

      // Apply patch — expand dot-path keys (e.g. "grid.size") into nested
      // objects before handing off to the store.  This ensures that
      // {"grid.size": 140} is treated as {grid: {size: 140}} rather than
      // being stored as a literal key "grid.size" (which Zod would silently
      // discard on read-back).  The same expansion is already applied in the
      // embedded path via applyDotPathDiff in handleEmbeddedUpdate.
      const expandedDiff = applyDotPathDiff({}, upd.diff);
      let result: Record<string, unknown> | null;
      try {
        result = deps.store.update(table as never, upd._id, expandedDiff, authorCtx);
      } catch (err) {
        if (err instanceof DocumentValidationError) {
          return ackError("VALIDATION_FAILED", err.message);
        }
        if (err instanceof DocumentNotFoundError) {
          return ackError("NOT_FOUND", `Document not found: ${documentType}/${upd._id}`);
        }
        throw err;
      }

      if (result !== null) {
        updated.push(result);
      }
    }

    if (updated.length === 0) {
      // All no-ops — return current seq without incrementing
      return ackOk({ documentType, documents: [] }, deps.seqStore.peek());
    }

    const seq = deps.seqStore.next();
    const broadcastPayload = { documentType, documents: updated };
    const envelope = buildBroadcastEnvelope("doc:update", broadcastPayload, seq);
    deps.opBuffer.push(envelope);

    broadcastToWorld(deps.ns, envelope, documentType);

    return ackOk({ documentType, documents: updated }, seq);
  };
}

// ---------------------------------------------------------------------------
// doc:delete handler factory
// ---------------------------------------------------------------------------

export function buildDocDeleteHandler(deps: DocHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = DocDeletePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const payload = parsed.data;
    const { documentType, ids, parent } = payload;

    // Embedded token deletion
    if (parent) {
      return handleEmbeddedDelete(deps, ctx, documentType, ids, parent);
    }

    const table = resolveTable(documentType);
    if (!table) {
      return ackError("VALIDATION_FAILED", `Unknown documentType: ${documentType}`);
    }

    // Permission check for delete: GM/ASSISTANT only for important types
    if (GM_ONLY_CREATE_DELETE.has(documentType) && !isPrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", `Only GM/Assistant can delete ${documentType}`);
    }

    // For other types: non-privileged must own the document
    if (!isPrivileged(ctx.role)) {
      for (const id of ids) {
        let existing: Record<string, unknown>;
        try {
          existing = deps.store.get(table as never, id);
        } catch (err) {
          if (err instanceof DocumentNotFoundError) {
            return ackError("NOT_FOUND", `Document not found: ${documentType}/${id}`);
          }
          throw err;
        }
        const ownership = getOwnershipFromDoc(existing);
        const level = resolveOwnership(ownership, ctx.userId, ctx.role);
        if (level < OwnershipLevel.OWNER) {
          return ackError("PERMISSION_DENIED", `No OWNER access to ${documentType}/${id}`);
        }
      }
    }

    const deletedIds: string[] = [];
    try {
      for (const id of ids) {
        deps.store.delete(table as never, id);
        deletedIds.push(id);
      }
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", err.message);
      }
      throw err;
    }

    const seq = deps.seqStore.next();
    const broadcastPayload = { documentType, ids: deletedIds };
    const envelope = buildBroadcastEnvelope("doc:delete", broadcastPayload, seq);
    deps.opBuffer.push(envelope);

    // Broadcast delete to all clients (no ownership filter for deletes — everyone must remove)
    deps.ns.emit("op", envelope);

    return ackOk({ documentType, ids: deletedIds }, seq);
  };
}

// ---------------------------------------------------------------------------
// Embedded document operations (tokens inside scenes)
// ---------------------------------------------------------------------------

function handleEmbeddedCreate(
  deps: DocHandlerDeps,
  ctx: HandlerContext,
  embeddedType: string,
  data: unknown[],
  parent: { type: string; id: string },
): Ack {
  const parentTable = resolveTable(parent.type);
  if (!parentTable) {
    return ackError("VALIDATION_FAILED", `Unknown parent type: ${parent.type}`);
  }

  // Embedded create: GM/ASSISTANT only for Scene tokens (TOKEN_CREATE permission)
  if (
    !isPrivileged(ctx.role) && // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    ctx.role < UserRole.TRUSTED
  ) {
    return ackError("PERMISSION_DENIED", "Insufficient role to create embedded documents");
  }

  // Load parent
  let parentDoc: Record<string, unknown>;
  try {
    parentDoc = deps.store.get(parentTable as never, parent.id);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return ackError("NOT_FOUND", `Parent document not found: ${parent.type}/${parent.id}`);
    }
    throw err;
  }

  // Check parent ownership (must be able to edit the parent scene)
  if (!isPrivileged(ctx.role)) {
    const ownership = getOwnershipFromDoc(parentDoc);
    const level = resolveOwnership(ownership, ctx.userId, ctx.role);
    if (level < OwnershipLevel.OWNER) {
      return ackError("PERMISSION_DENIED", `No OWNER access to parent ${parent.type}/${parent.id}`);
    }
  }

  // Get the embedded collection name (e.g., "tokens" for Token)
  const collectionKey = embeddedType.toLowerCase() + "s"; // "Token" → "tokens"
  const rawExisting = parentDoc[collectionKey];
  const existing = Array.isArray(rawExisting) ? (rawExisting as Record<string, unknown>[]) : [];

  // Validate and create each embedded doc.
  // _id is always generated server-side for embedded documents — any _id
  // supplied by the client is ignored to prevent collisions and ensure
  // uniqueness within the parent's embedded collection.
  const created: Record<string, unknown>[] = [];
  const existingIds = new Set(existing.map((t) => t["_id"] as string));

  for (const item of data) {
    const raw = { ...(item as Record<string, unknown>) };
    // Always generate a fresh server-side _id; never trust the client-supplied one
    let newId = createDocumentId();
    // In the astronomically unlikely case of collision with existing, regenerate
    while (existingIds.has(newId)) {
      newId = createDocumentId();
    }
    raw["_id"] = newId;
    existingIds.add(newId); // prevent collision within the same batch

    // Validate against Token schema if applicable
    if (embeddedType === "Token") {
      const tokenResult = TokenDocumentSchema.safeParse(raw);
      if (!tokenResult.success) {
        return ackError("VALIDATION_FAILED", tokenResult.error.message);
      }
      created.push(tokenResult.data);
    } else {
      created.push(raw);
    }
  }

  // Update parent with new embedded collection
  const updatedCollection = [...existing, ...created];
  const patch: Record<string, unknown> = { [collectionKey]: updatedCollection };

  const updatedParent = deps.store.update(parentTable as never, parent.id, patch, {
    userId: ctx.userId,
  });

  if (!updatedParent) {
    return ackError("INTERNAL_ERROR", "Failed to update parent document");
  }

  const seq = deps.seqStore.next();
  const broadcastPayload = { documentType: parent.type, documents: [updatedParent] };
  const envelope = buildBroadcastEnvelope("doc:update", broadcastPayload, seq);
  deps.opBuffer.push(envelope);

  // parent.type is "Scene" for token ops — hidden-token filtering applied.
  broadcastToWorld(deps.ns, envelope, parent.type);

  return {
    ok: true as const,
    seq,
    result: { documentType: embeddedType, documents: created, parent: updatedParent },
  };
}

function handleEmbeddedUpdate(
  deps: DocHandlerDeps,
  ctx: HandlerContext,
  parentType: string,
  updates: DocUpdatePayload["updates"],
): Ack {
  // Group updates by parent
  const byParent = new Map<string, typeof updates>();
  for (const upd of updates) {
    if (!upd.embedded) continue;
    const parentId = upd.embedded.id;
    if (!byParent.has(parentId)) {
      byParent.set(parentId, []);
    }
    const parentBatch = byParent.get(parentId);
    if (parentBatch) parentBatch.push(upd);
  }

  // Determine parent table from embedded type (all updates assumed same parent type)
  const firstEmbedded = updates.find((u) => u.embedded);
  const embeddedType = firstEmbedded?.embedded?.type ?? "Token";
  const resolvedParentType = EMBEDDED_PARENT_MAP[embeddedType] ?? parentType;
  const parentTable = resolveTable(resolvedParentType);
  if (!parentTable) {
    return ackError("VALIDATION_FAILED", `Unknown parent type: ${resolvedParentType}`);
  }

  const allUpdatedParents: Record<string, unknown>[] = [];

  for (const [parentId, parentUpdates] of byParent) {
    let parentDoc: Record<string, unknown>;
    try {
      parentDoc = deps.store.get(parentTable as never, parentId);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", `Parent not found: ${resolvedParentType}/${parentId}`);
      }
      throw err;
    }

    const collectionKey = embeddedType.toLowerCase() + "s"; // "tokens"
    const rawCollection = parentDoc[collectionKey];
    const collection = [
      ...(Array.isArray(rawCollection) ? (rawCollection as Record<string, unknown>[]) : []),
    ];

    for (const upd of parentUpdates) {
      const tokenId = upd._id;

      // Verify actor ownership for token updates (REQ-DOC-025)
      // If not privileged, user must own the actor that the token references
      if (!isPrivileged(ctx.role)) {
        const token = collection.find((t) => t["_id"] === tokenId);
        if (!token) {
          return ackError("NOT_FOUND", `Embedded doc not found: ${embeddedType}/${tokenId}`);
        }

        // Check if user owns the referenced actor (or the scene itself)
        const actorId = token["actorId"] as string | null | undefined;
        if (actorId) {
          try {
            const actor = deps.store.get("actors", actorId);
            const ownership = getOwnershipFromDoc(actor);
            const level = resolveOwnership(ownership, ctx.userId, ctx.role);
            if (level < OwnershipLevel.OWNER) {
              return ackError(
                "PERMISSION_DENIED",
                `No OWNER access to actor ${actorId} for token ${tokenId}`,
              );
            }
          } catch {
            // Actor not found — only GM can update orphaned tokens
            if (!isPrivileged(ctx.role)) {
              return ackError(
                "PERMISSION_DENIED",
                `Token ${tokenId} has no actor and you are not GM`,
              );
            }
          }
        } else {
          // No actorId — GM-only token
          return ackError("PERMISSION_DENIED", `Token ${tokenId} is GM-only (no actorId)`);
        }
      }

      // --- Field allowlist / protection (FIX-5) ---

      // Build a sanitized diff: strip _id always (immutable), and block
      // actorId changes for non-privileged users.
      const { _id: _strippedId, ...sanitizedDiff } = upd.diff;
      void _strippedId;

      // actorId reassignment is a privileged operation: it changes which actor
      // a token represents and affects ownership resolution for future updates.
      // Only GM/ASSISTANT may change actorId.
      if ("actorId" in sanitizedDiff && !isPrivileged(ctx.role)) {
        return ackError(
          "PERMISSION_DENIED",
          `Only GM/Assistant can change actorId on token ${tokenId}`,
        );
      }

      // Apply diff to token
      const idx = collection.findIndex((t) => t["_id"] === tokenId);
      if (idx === -1) {
        return ackError("NOT_FOUND", `Embedded doc not found: ${embeddedType}/${tokenId}`);
      }

      // Build the updated token by applying dot-path diff (uses sanitized diff)
      const existingToken = collection[idx] ?? {};
      const patchedToken = applyDotPathDiff(existingToken, sanitizedDiff);
      collection[idx] = patchedToken;
    }

    // Persist parent with updated embedded collection
    const parentPatch: Record<string, unknown> = { [collectionKey]: collection };
    const updatedParent = deps.store.update(parentTable as never, parentId, parentPatch, {
      userId: ctx.userId,
    });

    if (updatedParent) {
      allUpdatedParents.push(updatedParent);
    }
  }

  if (allUpdatedParents.length === 0) {
    return {
      ok: true as const,
      seq: deps.seqStore.peek(),
      result: { documentType: resolvedParentType, documents: [] },
    };
  }

  const seq = deps.seqStore.next();
  const broadcastPayload = { documentType: resolvedParentType, documents: allUpdatedParents };
  const envelope = buildBroadcastEnvelope("doc:update", broadcastPayload, seq);
  deps.opBuffer.push(envelope);

  // resolvedParentType is "Scene" for token ops — hidden-token filtering applied.
  broadcastToWorld(deps.ns, envelope, resolvedParentType);

  return {
    ok: true as const,
    seq,
    result: { documentType: resolvedParentType, documents: allUpdatedParents },
  };
}

function handleEmbeddedDelete(
  deps: DocHandlerDeps,
  ctx: HandlerContext,
  embeddedType: string,
  ids: string[],
  parent: { type: string; id: string },
): Ack {
  const parentTable = resolveTable(parent.type);
  if (!parentTable) {
    return ackError("VALIDATION_FAILED", `Unknown parent type: ${parent.type}`);
  }

  let parentDoc: Record<string, unknown>;
  try {
    parentDoc = deps.store.get(parentTable as never, parent.id);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return ackError("NOT_FOUND", `Parent not found: ${parent.type}/${parent.id}`);
    }
    throw err;
  }

  // Permission: GM/ASSISTANT or actor owner
  if (!isPrivileged(ctx.role)) {
    const collKey = embeddedType.toLowerCase() + "s";
    const rawColl = parentDoc[collKey];
    const collection = Array.isArray(rawColl) ? (rawColl as Record<string, unknown>[]) : [];
    for (const id of ids) {
      const token = collection.find((t) => t["_id"] === id);
      if (token) {
        const actorId = token["actorId"] as string | null | undefined;
        if (!actorId) {
          return ackError("PERMISSION_DENIED", `Token ${id} is GM-only`);
        }
        try {
          const actor = deps.store.get("actors", actorId);
          const ownership = getOwnershipFromDoc(actor);
          const level = resolveOwnership(ownership, ctx.userId, ctx.role);
          if (level < OwnershipLevel.OWNER) {
            return ackError("PERMISSION_DENIED", `No OWNER access to actor for token ${id}`);
          }
        } catch {
          return ackError("PERMISSION_DENIED", `Token ${id} actor not found and you are not GM`);
        }
      }
    }
  }

  const collectionKey = embeddedType.toLowerCase() + "s";
  const rawDeleteColl = parentDoc[collectionKey];
  const collection = Array.isArray(rawDeleteColl)
    ? (rawDeleteColl as Record<string, unknown>[])
    : [];
  const idsToDelete = new Set(ids);
  const updatedCollection = collection.filter((item) => !idsToDelete.has(item["_id"] as string));

  const patch: Record<string, unknown> = { [collectionKey]: updatedCollection };
  const updatedParent = deps.store.update(parentTable as never, parent.id, patch, {
    userId: ctx.userId,
  });

  if (!updatedParent) {
    return ackError("INTERNAL_ERROR", "Failed to update parent after embedded delete");
  }

  const seq = deps.seqStore.next();
  const broadcastPayload = { documentType: parent.type, documents: [updatedParent] };
  const envelope = buildBroadcastEnvelope("doc:update", broadcastPayload, seq);
  deps.opBuffer.push(envelope);

  // parent.type is "Scene" for token ops — hidden-token filtering applied.
  broadcastToWorld(deps.ns, envelope, parent.type);

  return {
    ok: true as const,
    seq,
    result: { documentType: embeddedType, ids, parent: updatedParent },
  };
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

/**
 * Return true when the socket belongs to a GM or ASSISTANT.
 * socket.data is typed as `unknown` by socket.io; we read role defensively.
 */
function socketIsPrivileged(socket: Socket): boolean {
  const data = socket.data as Record<string, unknown> | null | undefined;
  if (!data) return false;
  const role = data["role"];
  return typeof role === "number" && isRolePrivileged(role);
}

/**
 * Broadcast a doc op envelope to all sockets in the world namespace.
 *
 * For Scene updates (doc:create / doc:update) that may contain sensitive data
 * (hidden tokens or secret doors), we iterate sockets and send per-socket payloads:
 *   - privileged sockets (GM / ASSISTANT) → full payload
 *   - player sockets → payload with:
 *       • hidden tokens stripped
 *       • secret doors redacted as plain walls
 *
 * For all other document types or Scene updates without sensitive data,
 * we use the cheap namespace-wide emit (no per-socket iteration cost).
 *
 * doc:delete envelopes are always namespace-wide: deletes carry only IDs.
 */
function broadcastToWorld(ns: Namespace, envelope: Envelope, documentType?: string): void {
  // Only Scene doc:create / doc:update need redaction filtering.
  if (
    documentType === "Scene" &&
    (envelope.type === "doc:create" || envelope.type === "doc:update")
  ) {
    const payload = envelope.payload as {
      documentType: string;
      documents: Record<string, unknown>[];
    };

    const hasHiddenTokens = scenePayloadHasHiddenTokens(payload.documents);
    const hasSecretDoors = scenePayloadHasSecretDoors(payload.documents);

    if (hasHiddenTokens || hasSecretDoors) {
      // Build the player-visible payload once (shared across all player sockets).
      const filteredDocs = payload.documents.map((d) => {
        let redacted = d;
        if (hasHiddenTokens && Array.isArray(d["tokens"])) {
          redacted = stripHiddenTokens(redacted);
        }
        if (hasSecretDoors && Array.isArray(redacted["walls"])) {
          redacted = redactSecretDoors(redacted);
        }
        return redacted;
      });
      const playerEnvelope: Envelope = {
        ...envelope,
        payload: { ...payload, documents: filteredDocs },
      };

      // Iterate all connected sockets in the namespace.
      for (const [, socket] of ns.sockets) {
        if (socketIsPrivileged(socket)) {
          socket.emit("op", envelope);
        } else {
          socket.emit("op", playerEnvelope);
        }
      }
      return;
    }
  }

  // Fast path: no redaction concern — namespace-wide emit.
  ns.emit("op", envelope);
}

// ---------------------------------------------------------------------------
// Utility: apply dot-path diff to an object
// ---------------------------------------------------------------------------

/**
 * Apply a diff in dot-path notation to an object.
 * Example: diff = { "x": 100, "y": 200 } on token → sets token.x and token.y.
 * Also handles simple top-level key updates.
 */
function applyDotPathDiff(
  target: Record<string, unknown>,
  diff: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const [path, value] of Object.entries(diff)) {
    const parts = path.split(".");
    if (parts.length === 1) {
      result[path] = value;
    } else {
      // Navigate and set nested
      let current: Record<string, unknown> = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i] ?? "";
        if (
          current[key] === undefined ||
          typeof current[key] !== "object" ||
          current[key] === null
        ) {
          current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
      }
      const lastKey = parts[parts.length - 1] ?? "";
      current[lastKey] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Build an error ack.
 * requestId is intentionally omitted here — the central dispatcher in
 * socket-manager.ts injects it from the incoming envelope for all acks
 * (both success and error).  Handlers must NOT set it; doing so would
 * create a duplicate that the dispatcher would overwrite anyway.
 *
 * Single source of truth: dispatcher owns requestId injection.
 */
function ackError(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, code, message };
}
