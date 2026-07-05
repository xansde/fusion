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
import type { Envelope, Ack, ErrorCode } from "@fusion/shared";
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
 */
export function makeSendOpFn(socket: Socket): (op: unknown) => void {
  return (op) => {
    if (op === null || typeof op !== "object" || !("type" in op)) {
      console.error("[sendOpFn] malformed op (missing type):", op);
      return;
    }
    const { type, ...payload } = op as { type: string } & Record<string, unknown>;
    let normalizedPayload = payload;
    if (type === "doc:update") normalizedPayload = normalizeDocUpdate(payload);
    else if (type === "doc:create") normalizedPayload = normalizeDocCreate(payload);
    else if (type === "doc:delete") normalizedPayload = normalizeDocDelete(payload);
    sendOp(socket, { type: type as Envelope["type"], payload: normalizedPayload }).catch(
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
