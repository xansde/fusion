/**
 * rollDisplay.test.ts — the roll reads itself out loud, with no click.
 *
 * REQ-ACH-021: every displayed roll shows the formula, the value of EACH die and the
 * applied modifier, besides the total — without interaction. This module is the pure
 * formatting half of that promise (REQ-ROL-028..030 give the structured terms); the
 * component half is asserted in components/chat/__tests__/ChatMessage.test.ts.
 *
 * REQ-ACH-022 / REQ-ACH-023 reuse the very same functions for the nested child rolls
 * and for each target's saving throw, so a save line can never end up poorer than the
 * top-level roll it mirrors.
 */

import { describe, it, expect } from "vitest";
import type { RollResultData, RollTermResult } from "@fusion/shared";

import {
  buildRollDisplay,
  buildRollSegments,
  formatDiceGroup,
  rollBreakdown,
  rollModifierSegments,
  rollSummary,
} from "../rollDisplay.js";

function diceTerm(
  expression: string,
  faces: number,
  values: readonly number[],
  overrides: Partial<RollTermResult> = {},
): RollTermResult {
  return {
    type: "dice",
    expression,
    total: values.reduce((a, b) => a + b, 0),
    faces,
    number: values.length,
    results: values.map((result) => ({ result, active: true })),
    ...overrides,
  };
}

function op(expression: string): RollTermResult {
  return { type: "operator", expression, total: 0 };
}

function num(value: number): RollTermResult {
  return { type: "numeric", expression: String(value), total: value };
}

function roll(terms: RollTermResult[], overrides: Partial<RollResultData> = {}): RollResultData {
  const total = overrides.total ?? 0;
  return {
    rollId: "r1",
    formula: "2d4+4",
    expandedFormula: "2d4+4",
    total,
    terms,
    rollMode: "public",
    timestamp: 1000,
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// REQ-ACH-021 — each die, the modifier, the total, with no interaction
// ---------------------------------------------------------------------------

describe("REQ-ACH-021 — the dice values and the modifier are part of the reading", () => {
  it("renders 2d4+4 as the canonical [3, 2] + 4 breakdown", () => {
    const r = roll([diceTerm("2d4", 4, [3, 2]), op("+"), num(4)], { total: 9 });
    expect(rollBreakdown(r)).toBe("[3, 2] + 4");
    expect(rollSummary(r)).toBe("2d4+4 → [3, 2] + 4 = 9");
  });

  it("keeps every individual die, never the group subtotal (REQ-ROL-029)", () => {
    const r = roll([diceTerm("4d6", 6, [6, 1, 4, 4])], { formula: "4d6", total: 15 });
    const [segment] = buildRollSegments(r);
    expect(segment?.dice.map((d) => d.value)).toEqual([6, 1, 4, 4]);
    expect(rollBreakdown(r)).toBe("[6, 1, 4, 4]");
    expect(rollBreakdown(r)).not.toContain("15");
  });

  it("marks a discarded die instead of hiding it (4d6k3)", () => {
    const term = diceTerm("4d6k3", 6, [6, 5, 4, 1]);
    const results = [...(term.results ?? [])];
    results[3] = { result: 1, active: false, discarded: true };
    const r = roll([{ ...term, results, total: 15 }], { formula: "4d6k3", total: 15 });
    expect(rollBreakdown(r)).toBe("[6, 5, 4, ~1~]");
    expect(buildRollSegments(r)[0]?.dice[3]?.discarded).toBe(true);
  });

  it("flags a natural 20 and a natural 1 on a d20 for the caller to colour", () => {
    const crit = buildRollSegments(roll([diceTerm("1d20", 20, [20])], { total: 20 }));
    const fumble = buildRollSegments(roll([diceTerm("1d20", 20, [1])], { total: 1 }));
    expect(crit[0]?.dice[0]?.crit).toBe(true);
    expect(crit[0]?.dice[0]?.fumble).toBe(false);
    expect(fumble[0]?.dice[0]?.fumble).toBe(true);
    // A d6 six is not a crit — the flag is about the d20, not about the maximum.
    const d6 = buildRollSegments(roll([diceTerm("1d6", 6, [6])], { total: 6 }));
    expect(d6[0]?.dice[0]?.crit).toBe(false);
  });

  it("exposes the applied modifier as its own segment (REQ-ACH-021)", () => {
    const r = roll([diceTerm("1d20", 20, [11]), op("+"), num(7)], {
      formula: "1d20+7",
      total: 18,
    });
    expect(rollModifierSegments(r).map((s) => s.text)).toEqual(["7"]);
    expect(rollBreakdown(r)).toBe("[11] + 7");
  });

  it("keeps a subtracted modifier legible with its sign", () => {
    const r = roll([diceTerm("1d20", 20, [12]), op("-"), num(2)], {
      formula: "1d20-2",
      total: 10,
    });
    expect(rollBreakdown(r)).toBe("[12] - 2");
  });

  it("carries the term flavor so a damage type is not lost", () => {
    const r = roll([diceTerm("2d6", 6, [4, 5], { flavor: "fire" })], {
      formula: "2d6[fire]",
      total: 9,
    });
    expect(buildRollSegments(r)[0]?.flavor).toBe("fire");
  });

  it("degrades to the total when the server sent no terms at all", () => {
    const r = roll([], { formula: "7", total: 7 });
    expect(rollBreakdown(r)).toBe("7");
    expect(rollSummary(r)).toBe("7 → 7 = 7");
  });

  it("does not swallow a parenthetical/pool term it cannot expand", () => {
    const r = roll([{ type: "parenthetical", expression: "(2+3)*2", total: 10 }], {
      formula: "(2+3)*2",
      total: 10,
    });
    const [segment] = buildRollSegments(r);
    expect(segment?.kind).toBe("other");
    expect(rollBreakdown(r)).toBe("(2+3)*2 (10)");
  });

  it("buildRollDisplay bundles formula, segments, breakdown and total in one read", () => {
    const display = buildRollDisplay(
      roll([diceTerm("2d4", 4, [3, 2]), op("+"), num(4)], { total: 9, flavor: "Dano" }),
    );
    expect(display).toMatchObject({
      formula: "2d4+4",
      total: 9,
      breakdown: "[3, 2] + 4",
      flavor: "Dano",
    });
    expect(display.segments).toHaveLength(3);
    expect(display.segments.map((s) => s.kind)).toEqual(["dice", "operator", "number"]);
  });
});

// ---------------------------------------------------------------------------
// formatDiceGroup — the smallest unit both the card and the save line reuse
// ---------------------------------------------------------------------------

describe("formatDiceGroup (shared by REQ-ACH-022 and REQ-ACH-023)", () => {
  it("brackets the values, comma separated", () => {
    expect(
      formatDiceGroup([
        {
          value: 3,
          discarded: false,
          exploded: false,
          rerolled: false,
          success: false,
          failure: false,
          crit: false,
          fumble: false,
        },
        {
          value: 2,
          discarded: false,
          exploded: false,
          rerolled: false,
          success: false,
          failure: false,
          crit: false,
          fumble: false,
        },
      ]),
    ).toBe("[3, 2]");
  });

  it("marks an exploded die so the extra die is not read as a typo", () => {
    expect(
      formatDiceGroup([
        {
          value: 6,
          discarded: false,
          exploded: true,
          rerolled: false,
          success: false,
          failure: false,
          crit: false,
          fumble: false,
        },
        {
          value: 2,
          discarded: false,
          exploded: false,
          rerolled: false,
          success: false,
          failure: false,
          crit: false,
          fumble: false,
        },
      ]),
    ).toBe("[6!, 2]");
  });

  it("renders an empty group as empty brackets instead of throwing", () => {
    expect(formatDiceGroup([])).toBe("[]");
  });
});
