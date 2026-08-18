/**
 * M2-A Vision handlers — walls, ambient lights, door state, token movement.
 *
 * Spec references:
 *  - 07-visao-iluminacao-fog.md §REQ-VIS-001..007, REQ-VIS-040
 *  - 05-usuarios-e-permissoes.md — GM-only wall/light CRUD; any user opens unlocked door
 *  - 41-token.md §5.5 (REQ-TOK-040..044, DEC-TOK-07) — token:move's own rules
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
 *   Token move (TK062, spec 41-token.md):
 *     token:move validates ONLY the permission of REQ-TOK-032 — no wall
 *     collision, no elevation, no distance travelled (REQ-TOK-042). Wall
 *     collision (REQ-VIS-091, ex-M2-A) was REMOVED here, not fixed: D24/D25
 *     (docs/design/spec-41-token/decisoes.md) put vision/fog/lighting/wall
 *     collision entirely out of spec 41's scope, deferred whole to spec 07
 *     when it lands. `wallsBlockingMovement`/`moveBlocked`
 *     (packages/shared/src/vision/walls.ts) stay defined — spec 07's future
 *     collision will need the same math — but nothing in this file calls
 *     them anymore.
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
} from "@fusion/shared";
import { broadcastToWorld } from "./doc-handlers.js";
import { sceneIsInvisibleToRole } from "../redaction.js";

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

/**
 * Load a Scene for an op that took its id from the client.
 *
 * The `role` argument is what makes an off-air scene indistinguishable from a
 * scene that does not exist (REQ-CEN-070, REQ-CEN-071): the refusal is built
 * HERE, from the same template, before any caller gets to look at the body —
 * so a non-privileged requester cannot tell "no such scene" apart from "a scene
 * the GM is preparing", and cannot write into the latter (REQ-CEN-073).
 * Privileged callers (`isRolePrivileged`, via redaction.ts) are unaffected.
 */
function loadScene(
  store: DocumentStore,
  sceneId: string,
  role: number,
): { scene: Record<string, unknown>; err: Ack<never> | null } {
  const notFound = { scene: {}, err: ackError("NOT_FOUND", `Scene not found: ${sceneId}`) };
  try {
    const scene = store.get("scenes", sceneId);
    if (sceneIsInvisibleToRole(role, scene)) return notFound;
    return { scene, err: null };
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return notFound;
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

    const { scene, err } = loadScene(deps.store, sceneId, ctx.role);
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

    const { scene, err } = loadScene(deps.store, sceneId, ctx.role);
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

    const { scene, err } = loadScene(deps.store, sceneId, ctx.role);
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

    const { scene, err } = loadScene(deps.store, sceneId, ctx.role);
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

    const { scene, err } = loadScene(deps.store, sceneId, ctx.role);
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

    const { scene, err } = loadScene(deps.store, sceneId, ctx.role);
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

    const { scene, err } = loadScene(deps.store, sceneId, ctx.role);
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
// token:move
// TK062 (spec 41-token.md, DEC-TOK-07): the ONLY validation left is permission
// (REQ-TOK-032) and the token staying inside the scene's bounds (REQ-TOK-042).
// Wall collision (REQ-VIS-091) is REMOVED, not fixed: D24/D25
// (docs/design/spec-41-token/decisoes.md) close Q-TOK-04 — vision, fog,
// lighting and wall collision are OUT of spec 41's scope, deferred whole to a
// future spec. Issue #166 (collision ignoring footprint) is therefore not a
// bug to fix here: the code it would have fixed is gone. `force` (the
// GM-only collision bypass flag) is gone from TokenMovePayloadSchema for the
// same reason — nothing is left for it to bypass.
// ---------------------------------------------------------------------------

/**
 * Build the token:move handler.
 *
 * REQ-TOK-042 (DEC-TOK-07): validates ONLY the permission of REQ-TOK-032 —
 * no collision, no elevation, no distance travelled. A token with a
 * multi-cell footprint stays grid-snapped (REQ-TOK-043) by construction: the
 * client always sends grid-aligned coordinates, and this handler persists
 * them as-is.
 */
export function buildTokenMoveHandler(deps: VisionHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = TokenMovePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { sceneId, tokenId, x, y, rotation } = parsed.data;

    // Load the scene
    const { scene, err } = loadScene(deps.store, sceneId, ctx.role);
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

    // Apply the move
    const updatedToken: Record<string, unknown> = { ...token, x, y };
    if (rotation !== undefined) {
      updatedToken["rotation"] = rotation;
    }

    // REQ-TOK-002: `tokens` above came from `scene` (loadScene → the
    // FILTERED `store.get()`). Persisting a replacement array reconstructed
    // from it would permanently drop, from the row, any legacy token (no
    // resolvable actorId) this scene holds — read the untouched RAW row just
    // for the array being written back. `tokenId` was already found in the
    // filtered `tokens` above, so it necessarily has a resolvable actorId
    // and survives into `rawTokens` unchanged too; the `t` fallback below is
    // defensive only.
    const rawScene = deps.store.getRaw("scenes", sceneId);
    const rawTokens = getCollection<Record<string, unknown>>(rawScene, "tokens");
    const updatedTokens: Record<string, unknown>[] = rawTokens.map((t) =>
      t["_id"] === tokenId ? updatedToken : t,
    );

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

    // REQ-TOK-002: re-read through the filtered `get()` — the write above
    // used the RAW tokens array, so a legacy token survived on disk but must
    // not reach the broadcast below.
    const filteredParent = deps.store.get("scenes", sceneId);

    const seq = deps.seqStore.next();
    const envelope = buildEnvelope(
      "doc:update",
      { documentType: "Scene", documents: [filteredParent] },
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
