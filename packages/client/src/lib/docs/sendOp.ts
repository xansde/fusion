/**
 * sendOp — typed socket.io op emitter with ack correlation.
 *
 * REQ-NET-011: requests include requestId (ULID); server echoes it in ack.
 * The promise resolves when the ack with matching requestId arrives.
 * Rejects on timeout (default 10 s) or ack.ok === false.
 *
 * Usage:
 *   const result = await sendOp(socket, { type: "doc:update", payload: {...} });
 */

import type { Socket } from "socket.io-client";
import type { Envelope, Ack, ErrorCode, ChatMessage } from "@fusion/shared";
import { createDocumentId } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class OpError extends Error {
  constructor(
    public readonly code: ErrorCode | "TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "OpError";
  }
}

// ---------------------------------------------------------------------------
// sendOp
// ---------------------------------------------------------------------------

export interface SendOpOptions {
  /** Timeout in ms before the promise rejects with TIMEOUT. Default: 10 000. */
  timeoutMs?: number;
}

/**
 * Emit an op via the socket.io "op" event and wait for the ack.
 *
 * Automatically adds `requestId` and `ts` to the envelope.
 * The ack's `requestId` is matched against the sent one for correctness.
 *
 * @param socket  Connected socket.io Socket.
 * @param envelope  Partial envelope (type + payload required; requestId/ts are added).
 * @param options  Optional timeout override.
 * @returns The `result` field of the success ack.
 * @throws {OpError} on ack failure or timeout.
 */
export function sendOp<R = unknown>(
  socket: Socket,
  envelope: Omit<Envelope, "requestId" | "ts"> & { requestId?: string },
  options: SendOpOptions = {},
): Promise<R> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const requestId = envelope.requestId ?? createDocumentId();

  const outgoing: Envelope = {
    ...envelope,
    requestId,
    ts: Date.now(),
  };

  return new Promise<R>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new OpError(
          "TIMEOUT",
          `Op "${outgoing.type}" timed out after ${timeoutMs.toString()}ms (requestId=${requestId})`,
        ),
      );
    }, timeoutMs);

    socket.emit("op", outgoing, (ack: Ack<R>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // REQ-NET-011: verify requestId echo (advisory — server may not yet echo)
      if (ack.requestId !== undefined && ack.requestId !== requestId) {
        // Mismatched requestId — likely a bug in the server; still resolve if ok
        console.warn(`[sendOp] requestId mismatch: sent=${requestId} got=${ack.requestId}`);
      }

      if (ack.ok) {
        resolve(ack.result);
      } else {
        reject(new OpError(ack.code, ack.message));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// sendChatOpForId — flat chat:send op → resolves the canonical message id
// ---------------------------------------------------------------------------

/**
 * Send a flat `chat:send` op and resolve the CANONICAL message `_id` the server
 * assigned (r18-N1). Every chat:send branch returns `{ result: { message } }`
 * (see chat-handler.ts), so the id is already on the ack — no wire change.
 *
 * Used by the spell-cast flow (SpellsTab) to chain the spell-attack roll under
 * its announcement: send the announcement here, then send the attack with
 * `flags.parentMessageId` = the returned id, so the chat nests them into ONE
 * card instead of two loose messages. Returns null when the ack carries no
 * message (defensive — should not happen for chat:send).
 *
 * Throws {@link OpError} on ack failure / timeout, exactly like sendOp(); the
 * caller decides whether to still fire the child un-nested (the fallback is a
 * top-level roll, never a lost roll).
 */
export async function sendChatOpForId(
  socket: Socket,
  op: { readonly type: "chat:send" } & Record<string, unknown>,
  options: SendOpOptions = {},
): Promise<string | null> {
  const { type, ...payload } = op;
  const result = await sendOp<{ message?: ChatMessage }>(
    socket,
    { type: type as Envelope["type"], payload },
    options,
  );
  return result?.message?._id ?? null;
}

// ---------------------------------------------------------------------------
// makeSendOpFn — adapts sendOp() to the flat `sendOpFn(op)` callback shape
// ---------------------------------------------------------------------------

/**
 * Every sheet VM (CharacterSheetVM, OradorSheetVM, CompositorVM, ...) builds
 * "op" objects shaped as `{ type: "...", ...fields }` (flat — see e.g.
 * DocUpdatePayload in oradorSheetVM.ts or EtmosConjuracaoProporOp in
 * compositorVM.ts) and every sheet component takes a `sendOpFn?: (op) => void`
 * prop with a no-op default (injected for testability, mirroring
 * CharacterSheet.svelte's pattern).
 *
 * `sendOp()` itself expects the split `{ type, payload }` envelope shape.
 * This adapter is the ONE place that bridges the two: split `type` from the
 * rest of the flat op and forward to `sendOp(socket, { type, payload })`.
 *
 * Callers that open a sheet/window (ActorDirectory.svelte, registerEtmosSheets.ts)
 * should build `sendOpFn` via this helper instead of leaving the prop
 * unset — an unset `sendOpFn` silently no-ops (see each sheet's default),
 * which would make every button that only calls `sendOpFn(...)` (autosave,
 * rolls, "Propor ao Narrador") appear to do nothing.
 *
 * doc:update shape mismatch (pre-existing, not introduced by this adapter):
 * every sheet VM's DocUpdatePayload is `{ type: "doc:update", documentType,
 * id, diff, expectedVersion? }` (singular `id`/`diff`), but the WIRE schema
 * (`DocUpdatePayloadSchema`, packages/shared/src/protocol.ts) requires
 * `{ documentType, updates: [{ _id, diff, expectedVersion? }] }` (a batch
 * array). Sending the flat shape gets rejected with VALIDATION_FAILED —
 * verified against a real boot()'d server. Normalizing here (instead of in
 * every VM) fixes autosave for ALL sheets — PF2e's CharacterSheet/NpcSheet
 * included — without touching their (correct, well-tested) VM logic.
 *
 * FROZEN-SOCKET FIX: `socket` may be a Socket instance (legacy — captured at
 * call time) OR an accessor `() => Socket | null` resolved lazily on EVERY
 * op. Sheet windows outlive socket reconnects (SocketManager.connect()
 * creates a brand-new Socket instance, so a captured reference goes stale
 * and its emits are silently buffered forever — see WindowHost's frozen
 * componentProps). Callers that open long-lived windows (ActorDirectory)
 * should pass `() => getSocket()` so ops always ride the LIVE socket. When
 * the accessor returns null/disconnected at op time, the op is dropped with
 * a console.error (the sheet's own UI feedback for that case lives in the
 * feature components, e.g. SpellPickerDialog's not-connected state).
 */
export function makeSendOpFn(socket: Socket | (() => Socket | null)): (op: unknown) => void {
  const resolveSocket: () => Socket | null = typeof socket === "function" ? socket : () => socket;
  return (op) => {
    if (op === null || typeof op !== "object" || !("type" in op)) {
      console.error("[sendOpFn] malformed op (missing type):", op);
      return;
    }
    const { type, ...payload } = op as { type: string } & Record<string, unknown>;
    const live = resolveSocket();
    if (!live) {
      console.error(`[sendOpFn] "${type}" dropped: no live socket (disconnected?)`);
      return;
    }
    let normalizedPayload = payload;
    if (type === "doc:update") normalizedPayload = normalizeDocUpdate(payload);
    else if (type === "doc:create") normalizedPayload = normalizeDocCreate(payload);
    else if (type === "doc:delete") normalizedPayload = normalizeDocDelete(payload);
    sendOp(live, { type: type as Envelope["type"], payload: normalizedPayload }).catch(
      (err: unknown) => {
        console.error(`[sendOpFn] "${type}" failed:`, err);
      },
    );
  };
}

/**
 * Normalizes a flat `{ documentType, id, diff, expectedVersion?, embedded? }`
 * doc:update op (every sheet VM's shape) into the wire shape `{ documentType,
 * updates: [{ _id, diff, expectedVersion?, embedded? }] }`. `embedded`
 * (`{ type, id }` — see DocUpdatePayloadSchema, packages/shared/src/protocol.ts)
 * is preserved verbatim into the batched update entry when present, so ops
 * targeting an embedded document (e.g. a spellcastingEntry Item on an Actor)
 * are routed correctly server-side. A payload that already carries `updates`
 * (e.g. a future multi-doc batch update) passes through unchanged.
 */
function normalizeDocUpdate(payload: Record<string, unknown>): Record<string, unknown> {
  if ("updates" in payload) return payload;
  const { documentType, id, diff, expectedVersion, embedded } = payload;
  if (typeof id !== "string" || diff === null || typeof diff !== "object") return payload;
  return {
    documentType,
    updates: [
      {
        _id: id,
        diff,
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        ...(embedded !== undefined ? { embedded } : {}),
      },
    ],
  };
}

/**
 * Normalizes a flat `{ documentType, data, parent? }` doc:create op into the
 * wire shape `{ documentType, data: [...], parent? }` (DocCreatePayloadSchema
 * expects `data` as an array — VM builders pass a single object for
 * ergonomics). `parent` (`{ type, id }`, e.g. `{ type: "Actor", id }` for an
 * embedded Item) is forwarded verbatim. A payload that already carries an
 * array `data` passes through unchanged.
 */
function normalizeDocCreate(payload: Record<string, unknown>): Record<string, unknown> {
  const { data } = payload;
  if (Array.isArray(data)) return payload;
  if (data === undefined) return payload;
  return { ...payload, data: [data] };
}

/**
 * Normalizes a flat `{ documentType, id, parent? }` doc:delete op (single
 * target — the common case for embedded item removal) into the wire shape
 * `{ documentType, ids: [...], parent? }` (DocDeletePayloadSchema). A payload
 * that already carries `ids` passes through unchanged.
 */
function normalizeDocDelete(payload: Record<string, unknown>): Record<string, unknown> {
  if ("ids" in payload) return payload;
  const { id } = payload;
  if (typeof id !== "string") return payload;
  const { id: _drop, ...rest } = payload;
  return { ...rest, ids: [id] };
}

/**
 * Split a flat op `{ type, ...fields }` into the `{ type, payload }` envelope
 * shape `sendOp()` expects, applying the same doc:create/update/delete wire
 * normalization `makeSendOpFn` does. Callers that need the ack promise (e.g.
 * PetsTab awaits familiar creation to surface errors) go through `sendOp`
 * directly and must normalize with THIS — otherwise the flat op is sent
 * verbatim (with a redundant `type` field and an object `data`), which the
 * server's DocCreatePayloadSchema rejects with "Expected array, received
 * object" (r16 pets bug). A payload already in wire shape passes through.
 */
export function toEnvelope(op: { readonly type: string }): {
  type: Envelope["type"];
  payload: Record<string, unknown>;
} {
  // Accept any typed op interface (CreateFamiliarOp, UpdateFamiliarOp, …) —
  // they don't carry an index signature, so widen to a record for the
  // rest-destructure. Every op is a plain object with a `type` discriminator.
  const { type, ...payload } = op as { type: string } & Record<string, unknown>;
  let normalizedPayload: Record<string, unknown> = payload;
  if (type === "doc:update") normalizedPayload = normalizeDocUpdate(payload);
  else if (type === "doc:create") normalizedPayload = normalizeDocCreate(payload);
  else if (type === "doc:delete") normalizedPayload = normalizeDocDelete(payload);
  return { type: type as Envelope["type"], payload: normalizedPayload };
}
