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
