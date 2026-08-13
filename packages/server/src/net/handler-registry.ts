/**
 * Handler registry — maps "domain:action" to typed socket handlers.
 *
 * Each handler receives:
 *   - the validated envelope payload
 *   - a context object (userId, role, socket, worldId)
 *
 * Returns an Ack-compatible object (ok, result, seq, etc.) or throws.
 *
 * REQ-NET-013: actions are discriminated by Envelope.type, not by socket event.
 */

import type { Ack } from "@fusion/shared";

export interface HandlerContext {
  userId: string;
  role: number;
  worldId: string;
  /**
   * Set ONLY by `token:updateActor` when it re-enters the `doc:update` handler
   * to write a token's `actorDelta` (REQ-DOC-034). Never read from the wire —
   * the dispatcher builds this context from the authenticated session, so a
   * client cannot forge it.
   *
   * It exists because the two writes are indistinguishable at the embedded
   * update: the routed one carries a delta the server itself derived and
   * sanitised, the direct one carries whatever a client typed. Without the
   * marker, allowing the first also allows the second — which is how a player
   * writes `ownership` or a forged `system.derived` into a token's actor by
   * addressing the Token instead of the op built for it.
   */
  deltaWriteRouted?: boolean;
}

export type HandlerFn<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  ctx: HandlerContext,
) => Promise<Ack<TResult>> | Ack<TResult>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = HandlerFn<any, any>;

export class HandlerRegistry {
  private readonly handlers = new Map<string, AnyHandler>();

  /**
   * Register a handler for a specific envelope type.
   * The handler is keyed by `type` (e.g., "system:ping").
   */
  register<TPayload, TResult>(type: string, fn: HandlerFn<TPayload, TResult>): void {
    this.handlers.set(type, fn as AnyHandler);
  }

  /** Look up a handler by type. Returns undefined if not registered. */
  get(type: string): AnyHandler | undefined {
    return this.handlers.get(type);
  }

  /** Return all registered type keys. */
  keys(): string[] {
    return [...this.handlers.keys()];
  }
}
