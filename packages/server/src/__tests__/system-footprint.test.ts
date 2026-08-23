/**
 * system-footprint.test.ts — the door a token's size→footprint table comes
 * through (spec 15 REQ-SYS-009, spec 41-token.md TK041/DEC-TOK-03).
 *
 * A token's occupied cells are DERIVED from its effective actor's size
 * category (REQ-TOK-012/REQ-TOK-017) — never a field the server bakes into
 * the token at creation, unlike `bar1`/`bar2` (REQ-SYS-004). The client
 * package cannot import a game system, so this handler is the only path the
 * conversion table has to reach the canvas at all.
 */

import { describe, expect, it } from "vitest";

import {
  buildSystemFootprintHandler,
  type FootprintManifestSource,
} from "../net/handlers/system.js";
import type { HandlerContext } from "../net/handler-registry.js";
import { UserRole } from "../documents/ownership.js";

function ctx(role: number): HandlerContext {
  return { userId: "user-1", role, worldId: "world-1" };
}

function systemWith(sizeToFootprint?: Record<string, { width: number; height: number }>) {
  return { manifest: { id: "pf2e", sizeToFootprint } };
}

function footprintOf(source: FootprintManifestSource | undefined, role = UserRole.PLAYER) {
  const ack = buildSystemFootprintHandler(source)({}, ctx(role));
  if (!("ok" in ack) || !ack.ok) throw new Error("handler refused");
  return ack.result;
}

describe("system:footprint (REQ-SYS-009)", () => {
  it("hands the client the manifest's sizeToFootprint table intact", () => {
    const source = systemWith({
      tiny: { width: 1, height: 1 },
      med: { width: 1, height: 1 },
      lg: { width: 2, height: 2 },
      huge: { width: 3, height: 3 },
      grg: { width: 4, height: 4 },
    });

    const result = footprintOf(source);

    expect(result.systemId).toBe("pf2e");
    expect(result.sizeToFootprint["lg"]).toEqual({ width: 2, height: 2 });
    expect(result.sizeToFootprint["grg"]).toEqual({ width: 4, height: 4 });
  });

  it("answers an empty map when the system declares no table, never an error", () => {
    const result = footprintOf(systemWith(undefined));

    expect(result).toEqual({ systemId: "pf2e", sizeToFootprint: {} });
  });

  it("answers an empty map when the world has no system at all, never an error", () => {
    const result = footprintOf(undefined);

    expect(result).toEqual({ systemId: null, sizeToFootprint: {} });
  });

  it("is the same for every seat — a player receives what the Mestre receives", () => {
    const source = systemWith({ lg: { width: 2, height: 2 } });

    expect(footprintOf(source, UserRole.PLAYER)).toEqual(footprintOf(source, UserRole.GAMEMASTER));
  });
});
