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

// --------------------------------------------------------------------------
// system:conditions
// --------------------------------------------------------------------------

/**
 * The display contract of one condition, as the UI consumes it.
 *
 * Deliberately NOT the whole `ConditionDefinition` (REQ-SYS-043): `effects`,
 * `overrides` and `valued` are rules the server runs, not something a chip
 * draws, and `img` points at the system's artwork, which the chip never shows
 * (REQ-CTT-030). Sending less is both smaller and safer than sending all of it
 * and trusting the client to look away.
 */
export interface ConditionDisplayContract {
  slug: string;
  label: string;
  /** `"benefit" | "harm" | "special"`; absent ⇒ the UI draws a situation. */
  tone?: string;
  /** Short help, already translated by the system; absent ⇒ no tooltip. */
  help?: string;
  /** Emphasis, never a fourth tone; absent ⇒ no emphasis. */
  critical?: boolean;
}

export interface SystemConditionsResult {
  /** Id of the world's active system, or `null` when no system is resolved. */
  systemId: string | null;
  conditions: ConditionDisplayContract[];
}

export type SystemConditionsPayload = Record<string, never>;

/**
 * Source of the world's registered conditions — the `SystemModule`'s own
 * registry, narrowed to what this handler reads so that tests (and a world
 * with no system) need nothing else.
 */
export interface ConditionRegistrySource {
  manifest: { id: string };
  registries: {
    conditions: ReadonlyMap<
      string,
      {
        slug: string;
        label: string;
        img?: string;
        tone?: string;
        help?: string;
        critical?: boolean;
      }
    >;
  };
}

/**
 * `system:conditions` — hand the client the active system's condition
 * dictionary (REQ-SYS-043, DEC-CTT-11).
 *
 * Why this exists at all: the drawer paints a condition by the `tone`, `help`
 * and `critical` the SYSTEM declared (REQ-CTT-031/032/034), and the client
 * package cannot import a game system (only the server resolves one, by world).
 * Without this door the declaration has no way to reach the chip and every
 * condition degrades to a tooltip-less situation.
 *
 * No role gate, on purpose: this is the system's static dictionary — the same
 * text for every seat, carrying nothing about any actor. WHICH conditions a
 * given user sees comes from the Actor payload, which is redacted upstream.
 *
 * A world whose system registered nothing (or that has no system at all)
 * answers with an empty list rather than an error: the UI degrades open
 * (REQ-CTT-035) and must never be left without an answer to wait for.
 */
export function buildSystemConditionsHandler(
  systemModule?: ConditionRegistrySource,
): HandlerFn<SystemConditionsPayload, SystemConditionsResult> {
  return () => {
    if (!systemModule) {
      return { ok: true, result: { systemId: null, conditions: [] } };
    }
    const conditions: ConditionDisplayContract[] = [];
    for (const def of systemModule.registries.conditions.values()) {
      const entry: ConditionDisplayContract = { slug: def.slug, label: def.label };
      if (def.tone !== undefined) entry.tone = def.tone;
      if (def.help !== undefined) entry.help = def.help;
      if (def.critical !== undefined) entry.critical = def.critical;
      conditions.push(entry);
    }
    return { ok: true, result: { systemId: systemModule.manifest.id, conditions } };
  };
}

// --------------------------------------------------------------------------
// system:footprint
// --------------------------------------------------------------------------

/** One size category's occupied cells, as declared by the manifest. */
export interface FootprintEntry {
  width: number;
  height: number;
}

export interface SystemFootprintResult {
  /** Id of the world's active system, or `null` when no system is resolved. */
  systemId: string | null;
  /** Size category → footprint (REQ-SYS-009). Empty when the system declares none. */
  sizeToFootprint: Record<string, FootprintEntry>;
}

export type SystemFootprintPayload = Record<string, never>;

/**
 * Source of the world's `sizeToFootprint` mapping — the `SystemModule`'s own
 * manifest, narrowed to what this handler reads (same shape discipline as
 * `ConditionRegistrySource`, so tests need nothing else).
 */
export interface FootprintManifestSource {
  manifest: { id: string; sizeToFootprint?: Record<string, FootprintEntry> | undefined };
}

/**
 * `system:footprint` — hand the client the active system's size→footprint
 * table (REQ-SYS-009, spec 41-token.md TK041/DEC-TOK-03).
 *
 * Why this exists: a token's occupied cells are DERIVED from its effective
 * actor's size category (REQ-TOK-012/REQ-TOK-017) — never a field on the
 * token, never baked in at creation (unlike `bar1`/`bar2`, REQ-SYS-004). The
 * canvas needs the conversion table to draw a token at all, and the client
 * package cannot import a game system (only the server resolves one, per
 * world) — this is that door, same shape as `system:conditions`.
 *
 * No role gate, on purpose: this is the system's static table, the same for
 * every seat. A world whose system declared no `sizeToFootprint` (or that has
 * no system at all) answers with an empty map rather than an error — the
 * canvas degrades to every token occupying one cell (`footprint.ts`'s
 * pre-TK041 default), never left without an answer to wait for.
 */
export function buildSystemFootprintHandler(
  systemModule?: FootprintManifestSource,
): HandlerFn<SystemFootprintPayload, SystemFootprintResult> {
  return () => {
    if (!systemModule) {
      return { ok: true, result: { systemId: null, sizeToFootprint: {} } };
    }
    return {
      ok: true,
      result: {
        systemId: systemModule.manifest.id,
        sizeToFootprint: systemModule.manifest.sizeToFootprint ?? {},
      },
    };
  };
}
