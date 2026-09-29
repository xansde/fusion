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

// Spec 17 DEC-PF2-13 / REQ-PF2-154 (core #288): nothing wrote a character's `traits.size` — it sat
// at the schema default `med` — so a Minotaur took one square. The sheet now DERIVES the size and
// the server persists and transmits it in `system.derived.size`; the token reads that first.
describe("footprintOf — the derived size (REQ-PF2-154, REQ-TOK-012)", () => {
  it("a Minotaur character occupies 2x2: `derived.size` is Large although `traits.size` sits at the default", () => {
    seedFootprintRegistry(PF2E_TABLE);
    const minotaur = { system: { derived: { size: "lg" }, traits: { size: "med" } } };

    expect(footprintOf(undefined, minotaur)).toEqual({ width: 2, height: 2 });
  });

  it("the derived size WINS over a stored `traits.size`, in both directions (a Littlehorn Minotaur is Medium)", () => {
    seedFootprintRegistry(PF2E_TABLE);
    expect(
      footprintOf(undefined, { system: { derived: { size: "med" }, traits: { size: "lg" } } }),
    ).toEqual({
      width: 1,
      height: 1,
    });
    expect(
      footprintOf(undefined, { system: { derived: { size: "huge" }, traits: { size: "med" } } }),
    ).toEqual({
      width: 3,
      height: 3,
    });
  });

  it("REQ-TOK-017: the same character changes footprint when its heritage changes — no write to the token", () => {
    seedFootprintRegistry(PF2E_TABLE);
    const minotaur = { system: { derived: { size: "lg" } } };
    const littlehorn = { system: { derived: { size: "med" } } };

    expect(footprintOf(undefined, minotaur)).toEqual({ width: 2, height: 2 });
    expect(footprintOf(undefined, littlehorn)).toEqual({ width: 1, height: 1 });
  });

  it("an NPC has no derived size: `traits.size` still decides (a Large ogre is 2x2)", () => {
    seedFootprintRegistry(PF2E_TABLE);
    const ogre = { system: { derived: { ac: { value: 20 } }, traits: { size: "lg" } } };

    expect(footprintOf(undefined, ogre)).toEqual({ width: 2, height: 2 });
  });

  it("a glimpsed contact carries only `derived.size` in its payload (REQ-CTT-081) and still occupies its squares", () => {
    seedFootprintRegistry(PF2E_TABLE);
    const glimpsed = { system: { derived: { size: "lg" } } };

    expect(footprintOf(undefined, glimpsed)).toEqual({ width: 2, height: 2 });
  });

  it("a derived size the system's table does not declare falls back to 1x1 — it does not fall through to `traits.size`", () => {
    seedFootprintRegistry({ lg: { width: 2, height: 2 } });
    const actor = { system: { derived: { size: "grg" }, traits: { size: "lg" } } };

    expect(footprintOf(undefined, actor)).toEqual({ width: 1, height: 1 });
  });
});
