/**
 * M2-A Vision handlers — walls, ambient lights, door state, token move collision.
 *
 * Spec references:
 *  - 07-visao-iluminacao-fog.md §REQ-VIS-001..007, REQ-VIS-040, REQ-VIS-091
 *  - 05-usuarios-e-permissoes.md — GM-only wall/light CRUD; any user opens unlocked door
 *
 * Handler architecture:
 *   Walls and AmbientLights are embedded in Scene, just like Tokens.
 *   We reuse the same handleEmbeddedCreate/Update/Delete pattern from doc-handlers.ts,
 *   but with GM-only permission for walls and lights.
 *
 *   Door state toggle is a dedicated op "scene:doorState" because:
 *     - The permission model differs per doorType/doorState transition
 *     - It should not go through the generic doc:update path (cleaner semantics)
 *
 *   Token move collision:
 *     The token:move handler is extended to validate movement against walls.
 *     When movement would cross a wall with move:"normal" and the door is not open,
 *     the server rejects with MOVE_BLOCKED (unless force:true AND GM).
 *
 * Redaction of secret doors:
 *   Secret doors (doorType:"secret") must be redacted for non-GM clients, appearing
 *   as plain walls (doorType:"none", doorState preserved as "closed").
 *   This is handled in redaction.ts via the new redactSecretDoors() function.
 */

import type { Namespace } from "socket.io";
import type { HandlerFn, HandlerContext } from "../handler-registry.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import type { DocumentStore } from "../../documents/store.js";
import { DocumentNotFoundError } from "../../documents/store.js";
import {
  isRolePrivileged,
  testOwnership,
  UserRole,
  OwnershipLevel,
} from "../../documents/ownership.js";
import type { Ownership } from "../../documents/ownership.js";
import {
  WallDocumentSchema,
  AmbientLightDocumentSchema,
  DoorStatePayloadSchema,
  TokenMovePayloadSchema,
  type WallDocument,
  type Ack,
  type Envelope,
  createDocumentId,
  wallsBlockingMovement,
  moveBlocked,
} from "@fusion/shared";
import { broadcastToWorld } from "./doc-handlers.js";

// ---------------------------------------------------------------------------
// Handler context shape (same deps pattern as doc-handlers.ts)
// ---------------------------------------------------------------------------

export interface VisionHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
}

// ---------------------------------------------------------------------------
// Ack / error helpers (mirrors doc-handlers.ts style)
// ---------------------------------------------------------------------------

function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}

function ackError(code: string, message: string): Ack<never> {
  return { ok: false, code: code as never, message };
}

function buildEnvelope(
  type: "doc:create" | "doc:update" | "doc:delete",
  payload: unknown,
  seq: number,
): Envelope {
  return { type, seq, ts: Date.now(), payload };
}

// ---------------------------------------------------------------------------
// Scene loading helper
// ---------------------------------------------------------------------------

function loadScene(
  store: DocumentStore,
  sceneId: string,
): { scene: Record<string, unknown>; err: Ack<never> | null } {
  try {
    const scene = store.get("scenes", sceneId);
    return { scene, err: null };
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return { scene: {}, err: ackError("NOT_FOUND", `Scene not found: ${sceneId}`) };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Wall embedded CRUD — GM/ASSISTANT only
// REQ-VIS-001..003: walls with independent restrictions
// REQ-VIS-005, REQ-VIS-008: GM-only create/edit/delete
// ---------------------------------------------------------------------------

/**
 * Build the Wall embedded-create handler.
 * Payload: { documentType: "Wall", data: WallDocument[], parent: { type: "Scene", id: sceneId } }
 * Permission: GM/ASSISTANT only.
 */
export function buildWallCreateHandler(deps: VisionHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    // Parse using DocCreatePayload structure
    const parsed = parseEmbeddedCreatePayload(rawPayload, "Wall");
    if ("err" in parsed) return parsed.err;
    const { data, sceneId } = parsed;

    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can create walls");
    }

    const { scene, err } = loadScene(deps.store, sceneId);
    if (err) return err;

    const existing = getCollection<WallDocument>(scene, "walls");
    const existingIds = new Set(existing.map((w) => w._id));

    const created: WallDocument[] = [];
    for (const item of data) {
      const raw = { ...(item as Record<string, unknown>) };
      // Always server-generated _id
      let newId = createDocumentId();
      while (existingIds.has(newId)) newId = createDocumentId();
      raw["_id"] = newId;
      existingIds.add(newId);

      const result = WallDocumentSchema.safeParse(raw);
      if (!result.success) {
        return ackError("VALIDATION_FAILED", result.error.message);
      }
      created.push(result.data);
    }

    const updatedWalls = [...existing, ...created];
    return persistAndBroadcast(deps, ctx, sceneId, { walls: updatedWalls }, "Wall", created);
  };
}

/**
 * Build the Wall embedded-update handler.
 * Payload: { documentType: "Wall", updates: [{_id, diff, embedded:{type:"Wall",id:sceneId}}] }
 * Permission: GM/ASSISTANT only.
 */
export function buildWallUpdateHandler(deps: VisionHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can update walls");
    }

    const parsed = parseEmbeddedUpdatePayload(rawPayload, "Wall");
    if ("err" in parsed) return parsed.err;
    const { updates, sceneId } = parsed;

    const { scene, err } = loadScene(deps.store, sceneId);
    if (err) return err;

    const collection = getCollection<WallDocument>(scene, "walls");

    for (const upd of updates) {
      const idx = collection.findIndex((w) => w._id === upd._id);
      if (idx === -1) {
        return ackError("NOT_FOUND", `Wall not found: ${upd._id} in scene ${sceneId}`);
      }
      const existing = collection[idx];
      if (!existing) continue;
      const { _id: _stripped, ...diff } = upd.diff;
      void _stripped;
      const merged = { ...existing, ...diff, _id: existing._id };
      const result = WallDocumentSchema.safeParse(merged);
      if (!result.success) {
        return ackError("VALIDATION_FAILED", result.error.message);
      }
      collection[idx] = result.data;
    }

    return persistAndBroadcast(deps, ctx, sceneId, { walls: collection }, "Scene", null);
  };
}

/**
 * Build the Wall embedded-delete handler.
 * Payload: { documentType: "Wall", ids: string[], parent: { type: "Scene", id: sceneId } }
 * Permission: GM/ASSISTANT only.
 */
export function buildWallDeleteHandler(deps: VisionHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can delete walls");
    }

    const parsed = parseEmbeddedDeletePayload(rawPayload, "Wall");
    if ("err" in parsed) return parsed.err;
    const { ids, sceneId } = parsed;

    const { scene, err } = loadScene(deps.store, sceneId);
    if (err) return err;

    const collection = getCollection<WallDocument>(scene, "walls");
    const toDelete = new Set(ids);
    const updatedWalls = collection.filter((w) => !toDelete.has(w._id));

    const updatedParent = deps.store.update(
      "scenes",
      sceneId,
      { walls: updatedWalls },
      {
        userId: ctx.userId,
      },
    );
    if (!updatedParent) {
      return ackError("INTERNAL_ERROR", "Failed to update scene after wall delete");
    }
    const seq = deps.seqStore.next();
    const envelope = buildEnvelope(
      "doc:update",
      { documentType: "Scene", documents: [updatedParent] },
      seq,
    );
    deps.opBuffer.push(envelope);
    broadcastToWorld(deps.ns, envelope, "Scene");

    return ackOk({ documentType: "Wall", ids, parent: updatedParent }, seq);
  };
}

// ---------------------------------------------------------------------------
// AmbientLight embedded CRUD — GM/ASSISTANT only
// REQ-VIS-040: lights with position, radii, color, angle, enabled
// ---------------------------------------------------------------------------

export function buildLightCreateHandler(deps: VisionHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = parseEmbeddedCreatePayload(rawPayload, "Light");
    if ("err" in parsed) return parsed.err;
    const { data, sceneId } = parsed;

    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can create lights");
    }

    const { scene, err } = loadScene(deps.store, sceneId);
    if (err) return err;

    const existing = getCollection<Record<string, unknown>>(scene, "lights");
    const existingIds = new Set(existing.map((l) => l["_id"] as string));

    const created: Record<string, unknown>[] = [];
    for (const item of data) {
      const raw = { ...(item as Record<string, unknown>) };
      let newId = createDocumentId();
      while (existingIds.has(newId)) newId = createDocumentId();
      raw["_id"] = newId;
      existingIds.add(newId);

      const result = AmbientLightDocumentSchema.safeParse(raw);
      if (!result.success) {
        return ackError("VALIDATION_FAILED", result.error.message);
      }
      created.push(result.data);
    }

    const updatedLights = [...existing, ...created];
    return persistAndBroadcast(deps, ctx, sceneId, { lights: updatedLights }, "Light", created);
  };
}

export function buildLightUpdateHandler(deps: VisionHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can update lights");
    }

    const parsed = parseEmbeddedUpdatePayload(rawPayload, "Light");
    if ("err" in parsed) return parsed.err;
    const { updates, sceneId } = parsed;

    const { scene, err } = loadScene(deps.store, sceneId);
    if (err) return err;

    const collection = getCollection<Record<string, unknown>>(scene, "lights");

    for (const upd of updates) {
      const idx = collection.findIndex((l) => l["_id"] === upd._id);
      if (idx === -1) {
        return ackError("NOT_FOUND", `Light not found: ${upd._id} in scene ${sceneId}`);
      }
      const existing = collection[idx];
      if (!existing) continue;
      const { _id: _stripped, ...diff } = upd.diff;
      void _stripped;
      const merged = { ...existing, ...diff, _id: existing["_id"] };
      const result = AmbientLightDocumentSchema.safeParse(merged);
      if (!result.success) {
        return ackError("VALIDATION_FAILED", result.error.message);
      }
      collection[idx] = result.data;
    }

    return persistAndBroadcast(deps, ctx, sceneId, { lights: collection }, "Scene", null);
  };
}

export function buildLightDeleteHandler(deps: VisionHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can delete lights");
    }

    const parsed = parseEmbeddedDeletePayload(rawPayload, "Light");
    if ("err" in parsed) return parsed.err;
    const { ids, sceneId } = parsed;

    const { scene, err } = loadScene(deps.store, sceneId);
    if (err) return err;

    const collection = getCollection<Record<string, unknown>>(scene, "lights");
    const toDelete = new Set(ids);
    const updatedLights = collection.filter((l) => !toDelete.has(l["_id"] as string));

    const updatedParent = deps.store.update(
      "scenes",
      sceneId,
      { lights: updatedLights },
      {
        userId: ctx.userId,
      },
    );
    if (!updatedParent) {
      return ackError("INTERNAL_ERROR", "Failed to update scene after light delete");
    }
    const seq = deps.seqStore.next();
    const envelope = buildEnvelope(
      "doc:update",
      { documentType: "Scene", documents: [updatedParent] },
      seq,
    );
    deps.opBuffer.push(envelope);
    broadcastToWorld(deps.ns, envelope, "Scene");

    return ackOk({ documentType: "Light", ids, parent: updatedParent }, seq);
  };
}

// ---------------------------------------------------------------------------
// scene:doorState — toggle door state
// REQ-VIS-004: open door does not restrict any dimension
// REQ-VIS-005: secret doors invisible to non-GM (handled in redaction)
// REQ-VIS-007: locked door can only be unlocked by GM
// ---------------------------------------------------------------------------

/**
 * Build the scene:doorState handler.
 *
 * Permission rules:
 *   - doorType "secret": GM/ASSISTANT only (see/operate)
 *   - doorType "door", transition to "locked" or from "locked": GM/ASSISTANT only
 *   - doorType "door", closed→open or open→closed (unlocked): any authenticated user
 */
export function buildDoorStateHandler(deps: VisionHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = DoorStatePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { sceneId, wallId, state } = parsed.data;

    const { scene, err } = loadScene(deps.store, sceneId);
    if (err) return err;

    const walls = getCollection<WallDocument>(scene, "walls");
    const wallIdx = walls.findIndex((w) => w._id === wallId);
    if (wallIdx === -1) {
      return ackError("NOT_FOUND", `Wall not found: ${wallId} in scene ${sceneId}`);
    }

    const wall = walls[wallIdx];
    if (!wall) {
      return ackError("INTERNAL_ERROR", `Wall index mismatch: ${String(wallIdx)}`);
    }

    // Validate that this is actually a door
    if (wall.doorType === "none") {
      return ackError("VALIDATION_FAILED", `Wall ${wallId} is not a door`);
    }

    // Permission checks
    const isPrivileged = isRolePrivileged(ctx.role);

    // Secret doors: GM only
    if (wall.doorType === "secret" && !isPrivileged) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can operate secret doors");
    }

    // Locking/unlocking: GM only
    if ((state === "locked" || wall.doorState === "locked") && !isPrivileged) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can lock or unlock doors");
    }

    // Players cannot open locked doors (already covered above since doorState === "locked"
    // requires GM, but be explicit)
    if (!isPrivileged && wall.doorState === "locked" && state === "open") {
      return ackError("PERMISSION_DENIED", "Cannot open a locked door");
    }

    // Apply the state change
    const updatedWall: WallDocument = { ...wall, doorState: state };
    const updatedWalls = [...walls];
    updatedWalls[wallIdx] = updatedWall;

    const updatedParent = deps.store.update(
      "scenes",
      sceneId,
      { walls: updatedWalls },
      { userId: ctx.userId },
    );

    if (!updatedParent) {
      // No change (already that state) — return current seq without incrementing
      return ackOk({ sceneId, wallId, state }, deps.seqStore.peek());
    }

    const seq = deps.seqStore.next();

    // Broadcast with secret-door redaction
    // Non-GM clients see secret doors as plain walls; the broadcast must redact.
    const envelope = buildEnvelope(
      "doc:update",
      { documentType: "Scene", documents: [updatedParent] },
      seq,
    );
    deps.opBuffer.push(envelope);

    // Broadcast per-socket with secret-door redaction
    broadcastToWorld(deps.ns, envelope, "Scene");

    return ackOk({ sceneId, wallId, state }, seq);
  };
}

// ---------------------------------------------------------------------------
// token:move — with wall collision validation
// REQ-VIS-091: server validates movement against walls; rejects with MOVE_BLOCKED
// ---------------------------------------------------------------------------

/**
 * Build the token:move handler with wall collision validation.
 *
 * If the movement path crosses a wall with move:"normal" (and door is not open),
 * the server rejects with code MOVE_BLOCKED.
 *
 * GM/ASSISTANT can pass force:true to bypass the collision check.
 */
export function buildTokenMoveHandler(deps: VisionHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = TokenMovePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { sceneId, tokenId, x, y, rotation, force } = parsed.data;

    // Load the scene
    const { scene, err } = loadScene(deps.store, sceneId);
    if (err) return err;

    // Find the token
    const tokens = getCollection<Record<string, unknown>>(scene, "tokens");
    const tokenIdx = tokens.findIndex((t) => t["_id"] === tokenId);
    if (tokenIdx === -1) {
      return ackError("NOT_FOUND", `Token not found: ${tokenId} in scene ${sceneId}`);
    }

    const token = tokens[tokenIdx];
    if (!token) {
      return ackError("INTERNAL_ERROR", `Token index mismatch: ${String(tokenIdx)}`);
    }

    // Permission check: must be GM or own the actor
    const isPrivileged = isRolePrivileged(ctx.role);
    if (!isPrivileged) {
      const actorId = token["actorId"] as string | null | undefined;
      if (!actorId) {
        return ackError("PERMISSION_DENIED", `Token ${tokenId} is GM-only (no actorId)`);
      }
      try {
        const actor = deps.store.get("actors", actorId);
        const ownership = actor["ownership"] as Ownership | undefined;
        // Delegate to the single source of truth (documents/ownership.ts) so
        // `ownership.default` and INHERIT are resolved correctly — a
        // hand-rolled `ownership[userId] ?? ownership.default ?? 0` read
        // stops at a per-user INHERIT entry instead of falling through to
        // `default`/folder resolution. `role` is PLAYER here (not
        // ctx.role): this branch only runs when isPrivileged is already
        // false, so the GM-bypass has been handled above.
        const owns = ownership
          ? testOwnership(ownership, ctx.userId, UserRole.PLAYER, OwnershipLevel.OWNER)
          : false;
        if (!owns) {
          return ackError("PERMISSION_DENIED", `No OWNER access to token ${tokenId}`);
        }
      } catch {
        return ackError("PERMISSION_DENIED", `Actor not found for token ${tokenId}`);
      }
    }

    // Collision check (REQ-VIS-091)
    // GM with force:true bypasses the check
    const bypassCollision = isPrivileged && force === true;

    if (!bypassCollision) {
      // Load walls from the scene
      const walls = getCollection<WallDocument>(scene, "walls");

      // Filter walls that block movement
      const blockingWalls = wallsBlockingMovement(walls);

      // Current token position (center point based on width/height defaults to top-left)
      const fromX = typeof token["x"] === "number" ? token["x"] : 0;
      const fromY = typeof token["y"] === "number" ? token["y"] : 0;

      const from = { x: fromX, y: fromY };
      const to = { x, y };

      if (moveBlocked(from, to, blockingWalls)) {
        return ackError(
          "MOVE_BLOCKED",
          `Movement from (${String(fromX)},${String(fromY)}) to (${String(x)},${String(y)}) is blocked by a wall`,
        );
      }
    }

    // Apply the move
    const updatedToken: Record<string, unknown> = { ...token, x, y };
    if (rotation !== undefined) {
      updatedToken["rotation"] = rotation;
    }
    const updatedTokens: Record<string, unknown>[] = [...tokens];
    updatedTokens[tokenIdx] = updatedToken;

    const updatedParent = deps.store.update(
      "scenes",
      sceneId,
      { tokens: updatedTokens },
      { userId: ctx.userId },
    );

    if (!updatedParent) {
      // No-op
      return ackOk({ sceneId, tokenId, x, y }, deps.seqStore.peek());
    }

    const seq = deps.seqStore.next();
    const envelope = buildEnvelope(
      "doc:update",
      { documentType: "Scene", documents: [updatedParent] },
      seq,
    );
    deps.opBuffer.push(envelope);
    // A token move rewrites the whole Scene body — name included — so it takes
    // the same per-socket funnel as every other Scene emission (REQ-CEN-071).
    // It used to be a bare `ns.emit`, which handed every player the document of
    // whatever scene the GM happened to be arranging.
    broadcastToWorld(deps.ns, envelope, "Scene");

    return ackOk({ sceneId, tokenId, x, y }, seq);
  };
}

// The local `broadcastSceneWithSecretDoorRedaction` that used to live here was
// a second, parallel implementation of the same per-socket Scene emission —
// with its own inline role read and only the secret-door half of the redaction.
// It is now `broadcastToWorld` (doc-handlers.ts) for every caller, so there is a
// single funnel: `isRolePrivileged` decides, `net/redaction.ts` redacts.

// ---------------------------------------------------------------------------
// Payload parsing helpers (for the embedded op patterns)
// ---------------------------------------------------------------------------

interface EmbeddedCreateParsed {
  data: unknown[];
  sceneId: string;
}

interface EmbeddedUpdateEntry {
  _id: string;
  diff: Record<string, unknown>;
}

interface EmbeddedUpdateParsed {
  updates: EmbeddedUpdateEntry[];
  sceneId: string;
}

interface EmbeddedDeleteParsed {
  ids: string[];
  sceneId: string;
}

function parseEmbeddedCreatePayload(
  rawPayload: unknown,
  expectedType: string,
): EmbeddedCreateParsed | { err: Ack<never> } {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { err: ackError("VALIDATION_FAILED", "Invalid payload") };
  }
  const p = rawPayload as Record<string, unknown>;

  if (p["documentType"] !== expectedType) {
    return {
      err: ackError(
        "VALIDATION_FAILED",
        `Expected documentType "${expectedType}", got "${String(p["documentType"])}"`,
      ),
    };
  }

  const data = p["data"];
  if (!Array.isArray(data)) {
    return { err: ackError("VALIDATION_FAILED", "payload.data must be an array") };
  }

  const parent = p["parent"] as Record<string, unknown> | undefined;
  if (!parent || parent["type"] !== "Scene" || typeof parent["id"] !== "string") {
    return {
      err: ackError("VALIDATION_FAILED", "payload.parent must be {type:'Scene', id:string}"),
    };
  }

  return { data, sceneId: parent["id"] };
}

function parseEmbeddedUpdatePayload(
  rawPayload: unknown,
  expectedType: string,
): EmbeddedUpdateParsed | { err: Ack<never> } {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { err: ackError("VALIDATION_FAILED", "Invalid payload") };
  }
  const p = rawPayload as Record<string, unknown>;

  if (p["documentType"] !== expectedType) {
    return {
      err: ackError(
        "VALIDATION_FAILED",
        `Expected documentType "${expectedType}", got "${String(p["documentType"])}"`,
      ),
    };
  }

  const updates = p["updates"];
  if (!Array.isArray(updates)) {
    return { err: ackError("VALIDATION_FAILED", "payload.updates must be an array") };
  }

  // All updates must have embedded.type == expectedType and same sceneId
  const validUpdates: EmbeddedUpdateEntry[] = [];
  let sceneId: string | null = null;

  for (const upd of updates as Record<string, unknown>[]) {
    const embedded = upd["embedded"] as Record<string, unknown> | undefined;
    if (!embedded || embedded["type"] !== expectedType || typeof embedded["id"] !== "string") {
      return {
        err: ackError(
          "VALIDATION_FAILED",
          `All updates must have embedded.type="${expectedType}" and embedded.id`,
        ),
      };
    }
    const sid = embedded["id"];
    if (sceneId !== null && sceneId !== sid) {
      return { err: ackError("VALIDATION_FAILED", "All updates must target the same scene") };
    }
    sceneId = sid;

    if (typeof upd["_id"] !== "string" || !upd["diff"] || typeof upd["diff"] !== "object") {
      return { err: ackError("VALIDATION_FAILED", "Each update must have _id and diff") };
    }

    validUpdates.push({
      _id: upd["_id"],
      diff: upd["diff"] as Record<string, unknown>,
    });
  }

  if (!sceneId) {
    return { err: ackError("VALIDATION_FAILED", "No updates provided") };
  }

  return { updates: validUpdates, sceneId };
}

function parseEmbeddedDeletePayload(
  rawPayload: unknown,
  expectedType: string,
): EmbeddedDeleteParsed | { err: Ack<never> } {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { err: ackError("VALIDATION_FAILED", "Invalid payload") };
  }
  const p = rawPayload as Record<string, unknown>;

  if (p["documentType"] !== expectedType) {
    return {
      err: ackError(
        "VALIDATION_FAILED",
        `Expected documentType "${expectedType}", got "${String(p["documentType"])}"`,
      ),
    };
  }

  const ids = p["ids"];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    return { err: ackError("VALIDATION_FAILED", "payload.ids must be string[]") };
  }

  const parent = p["parent"] as Record<string, unknown> | undefined;
  if (!parent || parent["type"] !== "Scene" || typeof parent["id"] !== "string") {
    return {
      err: ackError("VALIDATION_FAILED", "payload.parent must be {type:'Scene', id:string}"),
    };
  }

  return { ids, sceneId: parent["id"] };
}

// ---------------------------------------------------------------------------
// Collection helpers
// ---------------------------------------------------------------------------

function getCollection<T>(scene: Record<string, unknown>, key: string): T[] {
  const raw = scene[key];
  return Array.isArray(raw) ? (raw as T[]) : [];
}

// ---------------------------------------------------------------------------
// Persist and broadcast helper
// ---------------------------------------------------------------------------

function persistAndBroadcast(
  deps: VisionHandlerDeps,
  ctx: HandlerContext,
  sceneId: string,
  patch: Record<string, unknown>,
  embeddedType: string,
  created: unknown[] | null,
): Ack {
  const updatedParent = deps.store.update("scenes", sceneId, patch, { userId: ctx.userId });
  if (!updatedParent) {
    return ackError("INTERNAL_ERROR", "Failed to update scene");
  }

  const seq = deps.seqStore.next();

  // Scene bodies always go per-socket (broadcastToWorld): off-air scenes are
  // dropped for players and secret doors are masked (REQ-CEN-071, REQ-VIS-005).
  const envelope = buildEnvelope(
    "doc:update",
    { documentType: "Scene", documents: [updatedParent] },
    seq,
  );
  deps.opBuffer.push(envelope);
  broadcastToWorld(deps.ns, envelope, "Scene");

  if (created !== null) {
    return {
      ok: true as const,
      seq,
      result: { documentType: embeddedType, documents: created, parent: updatedParent },
    };
  }

  return {
    ok: true as const,
    seq,
    result: { documentType: "Scene", documents: [updatedParent] },
  };
}
