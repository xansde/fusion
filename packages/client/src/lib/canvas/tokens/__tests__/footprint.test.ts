/**
 * footprint.test.ts — footprintOf() derives a token's grid footprint from
 * its effective actor's size category, never from a field the token carries.
 *
 * Spec: 41-token.md REQ-TOK-012, REQ-TOK-017, CA-TOK-002; 15-api-de-sistemas.md
 * REQ-SYS-009 (TK041/DEC-TOK-03).
 */

import { describe, expect, it, beforeEach } from "vitest";
import { footprintOf } from "../footprint.js";
import { resetFootprintRegistry, seedFootprintRegistry } from "../footprintRegistry.svelte.js";

beforeEach(() => {
  resetFootprintRegistry();
});

const PF2E_TABLE = {
  tiny: { width: 1, height: 1 },
  sm: { width: 1, height: 1 },
  med: { width: 1, height: 1 },
  lg: { width: 2, height: 2 },
  huge: { width: 3, height: 3 },
  grg: { width: 4, height: 4 },
};

describe("footprintOf (REQ-TOK-012, REQ-SYS-009)", () => {
  it("CA-TOK-002: a PF2e Large actor occupies 2x2, from the registry's table", () => {
    seedFootprintRegistry(PF2E_TABLE);
    const actor = { system: { traits: { size: "lg" } } };

    expect(footprintOf(undefined, actor)).toEqual({ width: 2, height: 2 });
  });

  it("reads the raw `{ value: size }` shape too (NpcSizeSchema's on-disk form)", () => {
    seedFootprintRegistry(PF2E_TABLE);
    const actor = { system: { traits: { size: { value: "huge" } } } };

    expect(footprintOf(undefined, actor)).toEqual({ width: 3, height: 3 });
  });

  it("REQ-TOK-017: the SAME actor derives a different footprint after its size changes — no token write involved", () => {
    seedFootprintRegistry(PF2E_TABLE);
    const medium = { system: { traits: { size: "med" } } };
    const grown = { system: { traits: { size: "huge" } } };

    expect(footprintOf(undefined, medium)).toEqual({ width: 1, height: 1 });
    expect(footprintOf(undefined, grown)).toEqual({ width: 3, height: 3 });
  });

  it("falls back to 1x1 when the actor has no size declared", () => {
    seedFootprintRegistry(PF2E_TABLE);
    expect(footprintOf(undefined, { system: {} })).toEqual({ width: 1, height: 1 });
    expect(footprintOf(undefined, undefined)).toEqual({ width: 1, height: 1 });
  });

  it("falls back to 1x1 when the registry has not answered yet (fail open)", () => {
    const actor = { system: { traits: { size: "lg" } } };
    expect(footprintOf(undefined, actor)).toEqual({ width: 1, height: 1 });
  });

  it("falls back to 1x1 for a size category the system's table does not declare", () => {
    seedFootprintRegistry({ lg: { width: 2, height: 2 } });
    const actor = { system: { traits: { size: "grg" } } };
    expect(footprintOf(undefined, actor)).toEqual({ width: 1, height: 1 });
  });
});
