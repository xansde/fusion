/**
 * `mount:mount` / `mount:dismount` — the rider climbs onto, or steps down from, a mount
 * (BHR-F5-02, spec 52 REQ-PET-123, REQ-BHR-174..176, plan §2.5).
 *
 * `MountState` lives on the two tokens of the scene (`flags.fusion.mount`), written ONLY here:
 * the rider token gets `{ mountTokenId }`, the mount token `{ riderTokenId }`. Everything is
 * decided on the server (the sheet hiding a button protects nothing):
 *
 *   mount:mount
 *     - both tokens exist, in the same scene, bound to actors, neither already mounted/ridden;
 *     - adjacent and the mount is AT LEAST ONE size above the rider (PF2e remaster: the mount
 *       must be a size larger; `position.ts`, BHR-F5-01) — the reason goes back in the refusal;
 *     - permission: GM/assistant always (the Mestre does it); a player only if they OWN the
 *       actor of the rider AND the mount is an active animal companion linked to that rider
 *       (`system.companionKind = "animalCompanion"`, `system.masterActorId`, `system.companion.active`
 *       absent or true). Another player's companion, or an unlinked creature, is PERMISSION_DENIED.
 *       Geometry (adjacency, size) binds the Mestre too: he moves a token first if he wants it.
 *   mount:dismount
 *     - the rider is mounted; GM/assistant, or OWNER of the actor of the rider;
 *     - `to` becomes the square of the rider: it must be adjacent to the mount and free of every
 *       other token (the mount included). A mount that no longer exists (stale flag) only clears
 *       the rider.
 *
 * Broadcast: a `doc:update` of the Scene through `broadcastToWorld` (same seq, OpBuffer replay
 * and hidden-token funnel as an ordinary embedded Token update). The token gets no badge
 * (Q-BHR-01): the state shows on the sheet strip only. The MAP group shared by the pair
 * (`mapGroupOf`) is BHR-F5-05; moving the rider along with the mount is BHR-F5-03 (`mount-follow.ts`).
 */

import type { Namespace } from "socket.io";
import {
  MountDismountPayloadSchema,
  MountMountPayloadSchema,
  readActorSizeCategory,
  readMountState,
  resolveEffectiveActor,
  squarePixelToCell,
} from "@fusion/shared";
import type { Ack, Envelope, ErrorCode } from "@fusion/shared";
import type { HandlerContext, HandlerFn } from "../net/handler-registry.js";
import type { SeqStore } from "../net/seq-store.js";
import type { OpBuffer } from "../net/op-buffer.js";
import { withMountFlag } from "./mount-follow.js";
import { broadcastToWorld } from "../net/handlers/doc-handlers.js";
import type { DocumentStore } from "../documents/store.js";
import { DocumentNotFoundError } from "../documents/store.js";
import { OwnershipLevel, isRolePrivileged, resolveOwnership } from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";
import {
  areAdjacent,
  sizeRank,
  tokenCells,
  type PositionGrid,
  type PositionedToken,
} from "./position.js";

export interface MountHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
}

type Rec = Record<string, unknown>;

function ackError(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, code, message };
}

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readActorOrNull(store: DocumentStore, actorId: string): Rec | null {
  try {
    return store.get("actors", actorId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return null;
    throw err;
  }
}

function callerOwns(actor: Rec, ctx: HandlerContext): boolean {
  const raw = actor["ownership"];
  const ownership: Ownership = isRec(raw) ? (raw as Ownership) : { default: OwnershipLevel.NONE };
  return resolveOwnership(ownership, ctx.userId, ctx.role) >= OwnershipLevel.OWNER;
}

/** A token plus what the checks need about it. */
interface Seat {
  token: Rec;
  tokenId: string;
  actorId: string;
  actor: Rec;
  /** Effective size code (token delta applied), or undefined when the actor declares none. */
  size: string | undefined;
}

interface Located {
  scene: Rec;
  sceneId: string;
  tokens: Rec[];
}

/**
 * Locate the scene holding `tokenId`. The tokens come from `getRaw` (no legacy-token read
 * filter): both handlers replace `Scene.tokens` in full, so rebuilding from the filtered `get()`
 * would erase every legacy token from the row (REQ-TOK-002). The broadcast re-reads through `get()`.
 */
function findScene(store: DocumentStore, tokenId: string): Located | null {
  for (const listed of store.getAll("scenes")) {
    const sceneId = listed["_id"];
    if (typeof sceneId !== "string") continue;
    const scene = store.getRaw("scenes", sceneId);
    const tokens = scene["tokens"];
    if (!Array.isArray(tokens)) continue;
    if (!(tokens as Rec[]).some((t) => t["_id"] === tokenId)) continue;
    return { scene, sceneId, tokens: tokens as Rec[] };
  }
  return null;
}

/** The seat of a token, or a message saying why it cannot take part. */
function seatOf(store: DocumentStore, tokens: Rec[], tokenId: string): Seat | string {
  const token = tokens.find((t) => t["_id"] === tokenId);
  if (token === undefined) return `Token ${tokenId} is not in the same scene`;
  const actorId = token["actorId"];
  if (typeof actorId !== "string" || actorId === "") {
    return `Token ${tokenId} is not bound to an actor`;
  }
  const actor = readActorOrNull(store, actorId);
  if (actor === null) return `Token ${tokenId} points to an actor that does not exist`;
  const system = isRec(actor["system"]) ? actor["system"] : {};
  const effective = resolveEffectiveActor(
    {
      actorLink: token["actorLink"] !== false,
      actorDelta: isRec(token["actorDelta"])
        ? (token["actorDelta"] as { system?: Record<string, unknown> })
        : null,
    },
    { name: "", system },
  );
  return { token, tokenId, actorId, actor, size: readActorSizeCategory(effective.system) };
}

function positioned(seat: Seat, size: string): PositionedToken {
  return {
    id: seat.tokenId,
    x: Number(seat.token["x"] ?? 0),
    y: Number(seat.token["y"] ?? 0),
    size,
  };
}

function gridOf(scene: Rec): PositionGrid {
  const g = isRec(scene["grid"]) ? scene["grid"] : {};
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    size: num(g["size"], 100),
    distance: num(g["distance"], 5),
    ...(typeof g["offsetX"] === "number" ? { offsetX: g["offsetX"] } : {}),
    ...(typeof g["offsetY"] === "number" ? { offsetY: g["offsetY"] } : {}),
    ...(typeof g["diagonalRule"] === "string"
      ? { diagonalRule: g["diagonalRule"] as NonNullable<PositionGrid["diagonalRule"]> }
      : {}),
    ...(typeof g["type"] === "string"
      ? { type: g["type"] as NonNullable<PositionGrid["type"]> }
      : {}),
  };
}

/** True when `mount` is an active animal companion whose master is `riderActorId` (spec 52). */
function isCompanionOf(mount: Rec, riderActorId: string): boolean {
  const sys = mount["system"];
  if (!isRec(sys)) return false;
  if (sys["companionKind"] !== "animalCompanion" || sys["masterActorId"] !== riderActorId) {
    return false;
  }
  const companion = sys["companion"];
  return !(isRec(companion) && companion["active"] === false);
}

function persistAndBroadcast(
  deps: MountHandlerDeps,
  located: Located,
  nextTokens: Rec[],
  ctx: HandlerContext,
): Ack<{ documentType: "Scene"; documents: Rec[] }> {
  deps.store.update("scenes", located.sceneId, { tokens: nextTokens }, { userId: ctx.userId });
  // Re-read through the filtered get(): the broadcast never carries the raw token list.
  const scene = deps.store.get("scenes", located.sceneId);
  const payload = { documentType: "Scene" as const, documents: [scene] };
  const seq = deps.seqStore.next();
  const envelope: Envelope = { type: "doc:update", seq, ts: Date.now(), payload };
  deps.opBuffer.push(envelope);
  broadcastToWorld(deps.ns, envelope, "Scene");
  return { ok: true, seq, result: payload };
}

export function buildMountHandler(deps: MountHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = MountMountPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { riderTokenId, mountTokenId } = parsed.data;
    if (riderTokenId === mountTokenId) {
      return ackError("VALIDATION_FAILED", "A creature cannot mount itself");
    }

    const located = findScene(deps.store, riderTokenId);
    if (located === null) return ackError("NOT_FOUND", `Token not found: ${riderTokenId}`);
    const rider = seatOf(deps.store, located.tokens, riderTokenId);
    if (typeof rider === "string") return ackError("VALIDATION_FAILED", rider);
    const mount = seatOf(deps.store, located.tokens, mountTokenId);
    if (typeof mount === "string") return ackError("VALIDATION_FAILED", mount);

    // Permission first: a player learns nothing about the geometry of creatures that are not theirs.
    if (!isRolePrivileged(ctx.role)) {
      if (!callerOwns(rider.actor, ctx)) {
        return ackError("PERMISSION_DENIED", "mount:mount requires OWNER of the rider's actor");
      }
      if (!isCompanionOf(mount.actor, rider.actorId)) {
        return ackError(
          "PERMISSION_DENIED",
          "Only an animal companion linked to the rider can be mounted by a player; ask the GM",
        );
      }
    }

    if (readMountState(rider.token).mountTokenId !== undefined) {
      return ackError("CONFLICT", "The rider is already mounted");
    }
    if (readMountState(mount.token).riderTokenId !== undefined) {
      return ackError("CONFLICT", "The mount already has a rider");
    }

    if (rider.size === undefined || mount.size === undefined) {
      return ackError("VALIDATION_FAILED", "Both creatures need a size to mount");
    }
    const grid = gridOf(located.scene);
    try {
      if (sizeRank(mount.size) < sizeRank(rider.size) + 1) {
        return ackError(
          "VALIDATION_FAILED",
          `The mount must be at least one size larger than the rider (rider ${rider.size}, mount ${mount.size})`,
        );
      }
      if (!areAdjacent(positioned(rider, rider.size), positioned(mount, mount.size), grid)) {
        return ackError("VALIDATION_FAILED", "The rider must be adjacent to the mount");
      }
    } catch (err) {
      if (err instanceof RangeError) return ackError("VALIDATION_FAILED", err.message);
      throw err;
    }

    const nextTokens = located.tokens.map((t) =>
      t["_id"] === riderTokenId
        ? withMountFlag(t, { mountTokenId })
        : t["_id"] === mountTokenId
          ? withMountFlag(t, { riderTokenId })
          : t,
    );
    return persistAndBroadcast(deps, located, nextTokens, ctx);
  };
}

export function buildDismountHandler(deps: MountHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = MountDismountPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { riderTokenId, to } = parsed.data;

    const located = findScene(deps.store, riderTokenId);
    if (located === null) return ackError("NOT_FOUND", `Token not found: ${riderTokenId}`);
    const rider = seatOf(deps.store, located.tokens, riderTokenId);
    if (typeof rider === "string") return ackError("VALIDATION_FAILED", rider);

    if (!isRolePrivileged(ctx.role) && !callerOwns(rider.actor, ctx)) {
      return ackError("PERMISSION_DENIED", "mount:dismount requires OWNER of the rider's actor");
    }
    const mountTokenId = readMountState(rider.token).mountTokenId;
    if (mountTokenId === undefined) return ackError("CONFLICT", "The rider is not mounted");
    if (rider.size === undefined) {
      return ackError("VALIDATION_FAILED", "The rider needs a size to dismount");
    }

    const grid = gridOf(located.scene);
    let dest: { x: number; y: number };
    try {
      // Snap to the square holding `to`: the stored position is always a cell origin.
      const cell = squarePixelToCell(to.x, to.y, grid.size, grid.offsetX ?? 0, grid.offsetY ?? 0);
      dest = {
        x: cell.i * grid.size + (grid.offsetX ?? 0),
        y: cell.j * grid.size + (grid.offsetY ?? 0),
      };
      const riderAtDest: PositionedToken = { id: riderTokenId, ...dest, size: rider.size };
      const taken = new Set(
        tokenCells(riderAtDest, grid).map((c) => `${String(c.i)}:${String(c.j)}`),
      );

      // The mount may be gone (deleted token, stale flag): then there is nothing to be adjacent to.
      const mount = seatOf(deps.store, located.tokens, mountTokenId);
      if (typeof mount !== "string" && mount.size !== undefined) {
        if (!areAdjacent(riderAtDest, positioned(mount, mount.size), grid)) {
          return ackError("VALIDATION_FAILED", "The destination must be adjacent to the mount");
        }
      }

      // Every other token with a size blocks its squares, the mount and the hidden ones included.
      for (const other of located.tokens) {
        const otherId = other["_id"];
        if (typeof otherId !== "string" || otherId === riderTokenId) continue;
        const seat = seatOf(deps.store, located.tokens, otherId);
        if (typeof seat === "string" || seat.size === undefined) continue;
        for (const c of tokenCells(positioned(seat, seat.size), grid)) {
          if (taken.has(`${String(c.i)}:${String(c.j)}`)) {
            return ackError("VALIDATION_FAILED", "The destination square is occupied");
          }
        }
      }
    } catch (err) {
      if (err instanceof RangeError) return ackError("VALIDATION_FAILED", err.message);
      throw err;
    }

    const nextTokens = located.tokens.map((t) => {
      if (t["_id"] === riderTokenId) return { ...withMountFlag(t, undefined), ...dest };
      // Only a mount that points back at this rider is released: a stale or forged flag never frees another's.
      if (t["_id"] === mountTokenId && readMountState(t).riderTokenId === riderTokenId) {
        return withMountFlag(t, undefined);
      }
      return t;
    });
    return persistAndBroadcast(deps, located, nextTokens, ctx);
  };
}
