/**
 * Built-in system handlers.
 *
 * Registered on every world namespace:
 *   - system:ping  → responds with pong + serverTime
 *   - system:whoami → responds with the user record from the access token
 *
 * REQ-NET-013: handler discriminated by Envelope.type.
 */

import type { HandlerFn } from "../handler-registry.js";
import type { UserPublic } from "../../auth/user-store.js";

// --------------------------------------------------------------------------
// system:ping
// --------------------------------------------------------------------------

export interface PingPayload {
  nonce?: string;
}

export interface PongResult {
  pong: true;
  serverTime: number;
  nonce?: string;
}

export const systemPingHandler: HandlerFn<PingPayload, PongResult> = (payload) => {
  const result: PongResult = {
    pong: true,
    serverTime: Date.now(),
  };
  if (payload.nonce !== undefined) {
    result.nonce = payload.nonce;
  }
  return { ok: true, result };
};

// --------------------------------------------------------------------------
// system:whoami
// --------------------------------------------------------------------------

export type WhoAmIResult = UserPublic;

export type SystemWhoAmIPayload = Record<string, never>;

/**
 * Build the whoami handler bound to the AuthService.
 * The user is retrieved from the auth service (via the userId in context).
 */
export function buildWhoAmIHandler(
  getUser: (id: string) => UserPublic | null,
): HandlerFn<SystemWhoAmIPayload, WhoAmIResult> {
  return (_payload, ctx) => {
    const user = getUser(ctx.userId);
    if (!user) {
      return {
        ok: false,
        code: "AUTH_FAILED" as const,
        message: "User not found",
      };
    }
    return { ok: true, result: user };
  };
}
