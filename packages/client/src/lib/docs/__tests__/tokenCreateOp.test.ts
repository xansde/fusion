/**
 * tokenCreateOp.test.ts — the shared `doc:create` envelope for landing a Token on a
 * Scene (TK022-client, spec 41 §7.2).
 *
 * REQ-TOK-001: a token's scene comes from the embedding, never from a field of the
 * token itself — `buildTokenCreateOp` carries the scene as `parent`, and the fields the
 * caller passes never leak an `sceneId`.
 *
 * REQ-TOK-020: creation requires `actorId`, `x`, `y` — this module does not invent or
 * drop any of what the caller supplies; it is a pure envelope wrapper. Callers (tested
 * separately) are the ones responsible for actually supplying the three.
 */

import { describe, expect, it } from "vitest";
import { buildTokenCreateOp } from "../tokenCreateOp.js";

describe("REQ-TOK-001 / REQ-TOK-020: buildTokenCreateOp", () => {
  it("REQ-TOK-020: is a doc:create of documentType Token", () => {
    const op = buildTokenCreateOp("scn-clareira001", { actorId: "act-lobo00000001", x: 10, y: 20 });

    expect(op.type).toBe("doc:create");
    expect(op.payload.documentType).toBe("Token");
    expect(op.payload.data).toEqual([{ actorId: "act-lobo00000001", x: 10, y: 20 }]);
  });

  it("REQ-TOK-001: the scene comes from `parent`, not from a field on the token", () => {
    const op = buildTokenCreateOp("scn-clareira001", { actorId: "act-lobo00000001", x: 0, y: 0 });

    expect(op.payload.parent).toEqual({ type: "Scene", id: "scn-clareira001" });
    expect(op.payload.data[0]).not.toHaveProperty("sceneId");
    expect(op.payload.data[0]).not.toHaveProperty("_id");
  });

  it("carries through whatever overridable field the caller supplies, unmodified", () => {
    const op = buildTokenCreateOp("scn-clareira001", {
      actorId: "act-lobo00000001",
      x: 0,
      y: 0,
      name: "Lobo Alfa",
      hidden: true,
    });

    expect(op.payload.data[0]).toEqual({
      actorId: "act-lobo00000001",
      x: 0,
      y: 0,
      name: "Lobo Alfa",
      hidden: true,
    });
  });
});
