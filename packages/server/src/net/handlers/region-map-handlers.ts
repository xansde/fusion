/**
 * Region map handlers — pins and the table's comments on them.
 *
 * Spec: `34-mapa-de-regiao.md` (DEC-MREG-08, REQ-MREG-025..030),
 * `05-usuarios-e-permissoes.md`.
 *
 * ## Why these are dedicated ops and not the generic embedded path
 *
 * Two reasons, and neither is style:
 *
 *  1. **Authorship is not the client's to state.** A pin records who dropped
 *     it and a comment records who wrote it; both come from `ctx.userId` here
 *     and are never read from the payload. Through the generic embedded path a
 *     player could post a comment signed by the GM.
 *  2. **Comments are an append, and array merge is a replacement.** The
 *     document store replaces arrays wholesale (REQ-DOC-037), so two players
 *     commenting within the same round trip would each write their own copy of
 *     the list and the slower one would erase the other. Appending server-side
 *     against the freshly loaded document is the only shape that survives a
 *     table talking at once.
 *
 * ## Who may do what
 *
 * | Op                   | GM  | Player                                  |
 * |----------------------|-----|-----------------------------------------|
 * | createPin            | yes | yes — born visible, authored by them    |
 * | updatePin            | any | only their own pin                      |
 * | deletePin            | any | only their own pin                      |
 * | reveal               | yes | never — the reveal IS the GM's control  |
 * | comment              | yes | on any pin they can actually read       |
 *
 * A player may never write `ownership`, `kind` or `authorId` through any of
 * these ops: those three fields together are the reveal state (REQ-DOC-056),
 * and a player who could set them would hand themselves the map.
 */

import type { Namespace } from "socket.io";
import type { HandlerFn } from "../handler-registry.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import type { DocumentStore } from "../../documents/store.js";
import { DocumentNotFoundError } from "../../documents/store.js";
import { isRolePrivileged, resolveOwnership, OwnershipLevel } from "../../documents/ownership.js";
import {
  MapPinSchema,
  PinCommentSchema,
  RegionMapDocumentSchema,
  clampNormalised,
  createDocumentId,
  createGmPin,
  createPlayerPin,
  type Ack,
  type Envelope,
  type MapPin,
  type Ownership,
} from "@fusion/shared";
import { z } from "zod";
import { emitRegionMapOp } from "../redaction.js";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface RegionMapHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
  /**
   * Display name for a userId, stamped onto pins and comments.
   *
   * Denormalised on purpose (see `PinCommentSchema`): a comment has to keep
   * reading as itself even for a viewer who never receives the User document.
   */
  getUserName: (userId: string) => string | null;
}

// ---------------------------------------------------------------------------
// Ack helpers — same shape as the other handler modules
// ---------------------------------------------------------------------------

function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}

function ackError(code: string, message: string): Ack<never> {
  return { ok: false, code: code as never, message };
}

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

const DocIdSchema = z.string().regex(/^[A-Za-z0-9]{16}$/);

/**
 * Content a client may write on a pin.
 *
 * `ownership`, `kind` and `authorId` are absent by construction — this schema
 * IS the boundary, so a payload carrying them fails validation instead of
 * being stripped somewhere downstream and hoping nobody forgets.
 */
const PinContentSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    text: z.string().max(120).optional(),
    description: z.string().max(4000).optional(),
    icon: z.string().max(8).optional(),
  })
  .strict();

const CreatePinPayloadSchema = z
  .object({
    mapId: DocIdSchema,
    pin: PinContentSchema,
  })
  .strict();

const UpdatePinPayloadSchema = z
  .object({
    mapId: DocIdSchema,
    pinId: DocIdSchema,
    patch: PinContentSchema.partial(),
  })
  .strict();

const DeletePinPayloadSchema = z.object({ mapId: DocIdSchema, pinId: DocIdSchema }).strict();

const RevealPayloadSchema = z
  .object({
    mapId: DocIdSchema,
    pinId: DocIdSchema,
    /** Users whose level changes. Empty means "the default", i.e. everyone. */
    userIds: z.array(z.string()).default(() => []),
    /** NONE (hidden) · LIMITED (rumour) · OBSERVER (known). */
    level: z.union([
      z.literal(OwnershipLevel.NONE),
      z.literal(OwnershipLevel.LIMITED),
      z.literal(OwnershipLevel.OBSERVER),
    ]),
  })
  .strict();

const CommentPayloadSchema = z
  .object({
    mapId: DocIdSchema,
    pinId: DocIdSchema,
    text: z.string().min(1).max(2000),
  })
  .strict();

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function loadMap(
  store: DocumentStore,
  mapId: string,
): { map: Record<string, unknown>; err: Ack<never> | null } {
  try {
    return { map: store.get("region_maps", mapId), err: null };
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return { map: {}, err: ackError("NOT_FOUND", `Mapa não encontrado: ${mapId}`) };
    }
    throw err;
  }
}

function pinsOf(map: Record<string, unknown>): MapPin[] {
  const raw = map["pins"];
  if (!Array.isArray(raw)) return [];
  return raw as MapPin[];
}

function ownershipOfPin(pin: MapPin): Ownership {
  return pin.ownership;
}

/**
 * Persist the new pin list and tell the world.
 *
 * The emit goes through `emitRegionMapOp`, which builds one payload per socket
 * — the pins are cut per user, so a single shared envelope would show every
 * player the same map and the reveal would be over.
 */
function persistAndBroadcast(
  deps: RegionMapHandlerDeps,
  userId: string,
  mapId: string,
  pins: MapPin[],
): Ack {
  const updated = deps.store.update("region_maps", mapId, { pins }, { userId });
  if (!updated) {
    return ackError("INTERNAL_ERROR", "Falha ao gravar o mapa");
  }

  const seq = deps.seqStore.next();
  const envelope: Envelope = {
    type: "doc:update",
    seq,
    ts: Date.now(),
    payload: { documentType: "RegionMap", documents: [updated] },
  };
  deps.opBuffer.push(envelope);
  // A map with zero pins has nothing per-viewer about it; emit it plainly.
  if (!emitRegionMapOp(deps.ns, envelope)) {
    deps.ns.emit("op", envelope);
  }

  return ackOk({ documentType: "RegionMap", documents: [updated] }, seq);
}

/** May this user edit or delete this pin? */
function mayEditPin(pin: MapPin, userId: string, role: number): boolean {
  if (isRolePrivileged(role)) return true;
  return pin.kind === "player" && pin.authorId === userId;
}

// ---------------------------------------------------------------------------
// regionMap:createPin
// ---------------------------------------------------------------------------

/**
 * Drop a pin. Anyone at the table may — that is the point of REQ-MREG-026.
 *
 * The two defaults diverge here and nowhere else: a GM pin is prep and starts
 * hidden, a player pin is table talk and starts visible. The client does not
 * get a say in which it made.
 */
export function buildCreatePinHandler(deps: RegionMapHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = CreatePinPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { mapId, pin } = parsed.data;

    const { map, err } = loadMap(deps.store, mapId);
    if (err) return err;

    // A player who cannot even see the map cannot pin it.
    if (!isRolePrivileged(ctx.role)) {
      const level = resolveOwnership(
        (map["ownership"] ?? { default: OwnershipLevel.NONE }) as Ownership,
        ctx.userId,
        ctx.role,
      );
      if (level < OwnershipLevel.OBSERVER) {
        return ackError("PERMISSION_DENIED", "Este mapa não está aberto para você");
      }
    }

    // Built key by key rather than spread: under `exactOptionalPropertyTypes`
    // an absent field and a field set to `undefined` are different things, and
    // the second would overwrite a schema default with nothing.
    const fields: Partial<MapPin> = {
      x: clampNormalised(pin.x),
      y: clampNormalised(pin.y),
    };
    if (pin.text !== undefined) fields.text = pin.text;
    if (pin.description !== undefined) fields.description = pin.description;
    if (pin.icon !== undefined) fields.icon = pin.icon;

    const created = isRolePrivileged(ctx.role)
      ? createGmPin(createDocumentId(), fields)
      : createPlayerPin(
          createDocumentId(),
          ctx.userId,
          deps.getUserName(ctx.userId) ?? "Jogador",
          fields,
        );

    return persistAndBroadcast(deps, ctx.userId, mapId, [...pinsOf(map), created]);
  };
}

// ---------------------------------------------------------------------------
// regionMap:updatePin
// ---------------------------------------------------------------------------

/** Move or re-word a pin. A player may only touch their own. */
export function buildUpdatePinHandler(deps: RegionMapHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = UpdatePinPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { mapId, pinId, patch } = parsed.data;

    const { map, err } = loadMap(deps.store, mapId);
    if (err) return err;

    const pins = pinsOf(map);
    const index = pins.findIndex((pin) => pin._id === pinId);
    if (index === -1) return ackError("NOT_FOUND", `Pino não encontrado: ${pinId}`);

    const existing = pins[index];
    if (!existing) return ackError("NOT_FOUND", `Pino não encontrado: ${pinId}`);

    if (!mayEditPin(existing, ctx.userId, ctx.role)) {
      return ackError("PERMISSION_DENIED", "Só o autor do pino pode editá-lo");
    }

    const merged = {
      ...existing,
      ...patch,
      ...(patch.x !== undefined ? { x: clampNormalised(patch.x) } : {}),
      ...(patch.y !== undefined ? { y: clampNormalised(patch.y) } : {}),
      // Identity and reveal survive any content edit.
      _id: existing._id,
      kind: existing.kind,
      authorId: existing.authorId,
      authorName: existing.authorName,
      ownership: existing.ownership,
      comments: existing.comments,
    };

    const result = MapPinSchema.safeParse(merged);
    if (!result.success) return ackError("VALIDATION_FAILED", result.error.message);

    const next = [...pins];
    next[index] = result.data;
    return persistAndBroadcast(deps, ctx.userId, mapId, next);
  };
}

// ---------------------------------------------------------------------------
// regionMap:deletePin
// ---------------------------------------------------------------------------

export function buildDeletePinHandler(deps: RegionMapHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = DeletePinPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { mapId, pinId } = parsed.data;

    const { map, err } = loadMap(deps.store, mapId);
    if (err) return err;

    const pins = pinsOf(map);
    const existing = pins.find((pin) => pin._id === pinId);
    if (!existing) return ackError("NOT_FOUND", `Pino não encontrado: ${pinId}`);

    if (!mayEditPin(existing, ctx.userId, ctx.role)) {
      return ackError("PERMISSION_DENIED", "Só o autor do pino pode removê-lo");
    }

    return persistAndBroadcast(
      deps,
      ctx.userId,
      mapId,
      pins.filter((pin) => pin._id !== pinId),
    );
  };
}

// ---------------------------------------------------------------------------
// regionMap:reveal — GM only
// ---------------------------------------------------------------------------

/**
 * Move a pin's reveal for one or more players (REQ-MREG-006).
 *
 * An empty `userIds` writes the map's `default` instead, which is how "reveal
 * to the whole table" is expressed without enumerating who is connected.
 */
export function buildRevealPinHandler(deps: RegionMapHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Só o GM revela pinos");
    }

    const parsed = RevealPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { mapId, pinId, userIds, level } = parsed.data;

    const { map, err } = loadMap(deps.store, mapId);
    if (err) return err;

    const pins = pinsOf(map);
    const index = pins.findIndex((pin) => pin._id === pinId);
    if (index === -1) return ackError("NOT_FOUND", `Pino não encontrado: ${pinId}`);
    const existing = pins[index];
    if (!existing) return ackError("NOT_FOUND", `Pino não encontrado: ${pinId}`);

    const ownership: Record<string, number> = { ...ownershipOfPin(existing) };
    if (userIds.length === 0) {
      ownership["default"] = level;
    } else {
      for (const userId of userIds) ownership[userId] = level;
    }

    const result = MapPinSchema.safeParse({ ...existing, ownership });
    if (!result.success) return ackError("VALIDATION_FAILED", result.error.message);

    const next = [...pins];
    next[index] = result.data;
    return persistAndBroadcast(deps, ctx.userId, mapId, next);
  };
}

// ---------------------------------------------------------------------------
// regionMap:comment
// ---------------------------------------------------------------------------

/**
 * Append a comment to a pin, signed by whoever is on this socket.
 *
 * The reveal gate is `OBSERVER`: a viewer at `limited` sees a "?" and does not
 * know what the place is, so there is nothing for them to comment on — and
 * letting them write would tell them a pin is there to be written on.
 */
export function buildCommentHandler(deps: RegionMapHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = CommentPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { mapId, pinId, text } = parsed.data;

    const { map, err } = loadMap(deps.store, mapId);
    if (err) return err;

    const pins = pinsOf(map);
    const index = pins.findIndex((pin) => pin._id === pinId);
    if (index === -1) return ackError("NOT_FOUND", `Pino não encontrado: ${pinId}`);
    const existing = pins[index];
    if (!existing) return ackError("NOT_FOUND", `Pino não encontrado: ${pinId}`);

    if (!isRolePrivileged(ctx.role)) {
      const level = resolveOwnership(ownershipOfPin(existing), ctx.userId, ctx.role);
      if (level < OwnershipLevel.OBSERVER) {
        return ackError("NOT_FOUND", `Pino não encontrado: ${pinId}`);
      }
    }

    const comment = PinCommentSchema.parse({
      _id: createDocumentId(),
      authorId: ctx.userId,
      authorName: deps.getUserName(ctx.userId) ?? "Jogador",
      text,
      createdAt: Date.now(),
    });

    const result = MapPinSchema.safeParse({
      ...existing,
      comments: [...existing.comments, comment],
    });
    if (!result.success) return ackError("VALIDATION_FAILED", result.error.message);

    const next = [...pins];
    next[index] = result.data;
    return persistAndBroadcast(deps, ctx.userId, mapId, next);
  };
}

/** Re-exported for the seeding path and tests. */
export { RegionMapDocumentSchema };
