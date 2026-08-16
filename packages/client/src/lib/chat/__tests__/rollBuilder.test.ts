/**
 * rollBuilder.test.ts — what the roll builder composes, and what it refuses to decide.
 *
 * Spec 38 (`specs/38-aba-chat.md`), DEC-ACH-06 and REQ-ACH-060..063. The window answers
 * "what do I roll"; the selector answers "who sees it" (REQ-ACH-061), so the composition
 * below never produces, mentions or stores a roll mode — that absence is asserted here,
 * not left to inspection.
 *
 * The formula is also checked against the real parser (`checkFavoriteFormula`), because a
 * builder that composes something the engine cannot roll is worse than no builder.
 */

import { describe, expect, it } from "vitest";

import { checkFavoriteFormula } from "../favoriteDice.js";
import {
  DEFAULT_ROLL_BUILDER_SPEC,
  buildRollFormula,
  favoriteFromSpec,
  normalizeSpec,
} from "../rollBuilder.js";

import type { RollBuilderSpec } from "../rollBuilder.js";

function spec(patch: Partial<RollBuilderSpec> = {}): RollBuilderSpec {
  return { ...DEFAULT_ROLL_BUILDER_SPEC, ...patch };
}

describe("a janela compõe o QUE se rola (REQ-ACH-060)", () => {
  it("starts on the roll everyone makes first", () => {
    expect(buildRollFormula(DEFAULT_ROLL_BUILDER_SPEC)).toBe("1d20");
  });

  it("composes quantity, faces and modifier", () => {
    expect(buildRollFormula(spec({ count: 2, faces: 6, modifier: 3 }))).toBe("2d6+3");
    expect(buildRollFormula(spec({ count: 1, faces: 8, modifier: -2 }))).toBe("1d8-2");
    expect(buildRollFormula(spec({ modifier: 0 }))).toBe("1d20");
  });

  it("turns advantage into an extra die kept high, and disadvantage into kept low", () => {
    expect(buildRollFormula(spec({ edge: "advantage" }))).toBe("2d20kh1");
    expect(buildRollFormula(spec({ edge: "disadvantage" }))).toBe("2d20kl1");
    expect(buildRollFormula(spec({ count: 2, faces: 6, edge: "advantage" }))).toBe("3d6kh2");
  });

  it("keeps the highest N when asked (REQ-ROL-004)", () => {
    expect(buildRollFormula(spec({ count: 4, faces: 6, keepHighest: 3 }))).toBe("4d6kh3");
  });

  it("explodes (REQ-ROL-006) before the keep modifier, which is the order the engine parses", () => {
    expect(buildRollFormula(spec({ count: 3, faces: 6, explode: true }))).toBe("3d6!");
    expect(buildRollFormula(spec({ count: 4, faces: 6, explode: true, keepHighest: 3 }))).toBe(
      "4d6!kh3",
    );
  });

  it("appends the label as a roll note (REQ-ROL-013)", () => {
    expect(buildRollFormula(spec({ modifier: 5, label: "Ataque" }))).toBe("1d20+5 # Ataque");
    expect(buildRollFormula(spec({ label: "   " }))).toBe("1d20");
  });

  it("composes only formulas the engine can actually roll", () => {
    const cases: RollBuilderSpec[] = [
      DEFAULT_ROLL_BUILDER_SPEC,
      spec({ count: 4, faces: 6, keepHighest: 3, modifier: 2 }),
      spec({ edge: "advantage", modifier: 7, label: "Ataque" }),
      spec({ edge: "disadvantage", count: 2, faces: 10, explode: true }),
      spec({ count: 8, faces: 4, modifier: -3 }),
    ];
    for (const s of cases) {
      const formula = buildRollFormula(s);
      expect(checkFavoriteFormula(formula), formula).toEqual({ valid: true });
    }
  });

  it("never emits a roll mode: the window does not choose the audience (REQ-ACH-061)", () => {
    const formula = buildRollFormula(spec({ edge: "advantage", modifier: 4, label: "Furtiva" }));
    expect(formula).not.toMatch(/public|gmroll|blindroll|selfroll/);
    expect(Object.keys(DEFAULT_ROLL_BUILDER_SPEC)).not.toContain("mode");
    expect(Object.keys(DEFAULT_ROLL_BUILDER_SPEC)).not.toContain("rollMode");
  });
});

describe("valores impossíveis não viram fórmula quebrada (REQ-ACH-060)", () => {
  it("clamps the die pool and the faces into what the engine accepts", () => {
    expect(buildRollFormula(spec({ count: 0 }))).toBe("1d20");
    expect(buildRollFormula(spec({ count: -4, faces: 0 }))).toBe("1d2");
    expect(buildRollFormula(spec({ count: 2.7, faces: 6.9 }))).toBe("2d6");
  });

  it("never keeps more dice than were rolled", () => {
    expect(normalizeSpec(spec({ count: 2, keepHighest: 9 })).keepHighest).toBe(2);
    expect(buildRollFormula(spec({ count: 2, faces: 6, keepHighest: 9 }))).toBe("2d6kh2");
    expect(checkFavoriteFormula("2d6kh2")).toEqual({ valid: true });
  });

  it("does not clutter the preview with 'keep 1 of 1'", () => {
    expect(buildRollFormula(spec({ count: 1, faces: 20, keepHighest: 1 }))).toBe("1d20");
  });

  it("lets advantage own the keep, so the two cannot contradict each other", () => {
    expect(buildRollFormula(spec({ count: 1, faces: 20, edge: "advantage", keepHighest: 1 }))).toBe(
      "2d20kh1",
    );
  });
});

describe("salvar a montagem como favorito (REQ-ACH-062)", () => {
  it("creates a favourite with the composed label and formula, following the selector", () => {
    const favorite = favoriteFromSpec(spec({ modifier: 7, label: "Ataque" }));
    expect(favorite).toEqual({ label: "Ataque", formula: "1d20+7 # Ataque", mode: null });
    // `mode: null` IS "follows the selector" — REQ-ACH-062 says a saved build never comes
    // out locked, because the window does not choose an audience (DEC-ACH-06).
    expect(favorite.mode).toBeNull();
  });

  it("falls back to the formula as the label when nothing was typed (REQ-ACH-051)", () => {
    const favorite = favoriteFromSpec(spec({ count: 2, faces: 6, modifier: 3 }));
    expect(favorite.label).toBe("2d6+3");
    expect(favorite.formula).toBe("2d6+3");
  });

  it("produces a favourite the row can actually fire (REQ-ACH-054)", () => {
    const favorite = favoriteFromSpec(spec({ count: 4, faces: 6, keepHighest: 3, explode: true }));
    expect(checkFavoriteFormula(favorite.formula)).toEqual({ valid: true });
  });
});
