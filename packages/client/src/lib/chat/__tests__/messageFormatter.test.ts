/**
 * Tests for messageFormatter.
 */

import { describe, it, expect } from "vitest";
import {
  formatDie,
  formatTerm,
  formatRoll,
  getMessageDisplayMeta,
  getRollTotalClass,
} from "../messageFormatter.js";
import type { DiceResult, RollTermResult, RollResultData, ChatMessage } from "@fusion/shared";

// ---------------------------------------------------------------------------
// formatDie
// ---------------------------------------------------------------------------

describe("formatDie", () => {
  it("marks crit on d20 nat 20", () => {
    const die: DiceResult = { result: 20, active: true };
    expect(formatDie(die, 20).isCrit).toBe(true);
    expect(formatDie(die, 20).isFumble).toBe(false);
  });

  it("marks fumble on d20 nat 1", () => {
    const die: DiceResult = { result: 1, active: true };
    expect(formatDie(die, 20).isFumble).toBe(true);
    expect(formatDie(die, 20).isCrit).toBe(false);
  });

  it("no crit/fumble on non-d20", () => {
    const die: DiceResult = { result: 6, active: true };
    expect(formatDie(die, 6).isCrit).toBe(false);
    expect(formatDie(die, 6).isFumble).toBe(false);
  });

  it("marks discarded, exploded, rerolled", () => {
    const die: DiceResult = {
      result: 3,
      active: false,
      discarded: true,
      exploded: true,
      rerolled: true,
    };
    const f = formatDie(die, 6);
    expect(f.discarded).toBe(true);
    expect(f.exploded).toBe(true);
    expect(f.rerolled).toBe(true);
    expect(f.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatTerm
// ---------------------------------------------------------------------------

describe("formatTerm", () => {
  it("formats dice term with dice array", () => {
    const term: RollTermResult = {
      type: "dice",
      expression: "2d6",
      total: 7,
      number: 2,
      faces: 6,
      results: [
        { result: 3, active: true },
        { result: 4, active: true },
      ],
    };
    const f = formatTerm(term);
    expect(f.dice).toHaveLength(2);
    expect(f.faces).toBe(6);
    expect(f.total).toBe(7);
  });

  it("formats numeric term without dice", () => {
    const term: RollTermResult = {
      type: "numeric",
      expression: "5",
      total: 5,
    };
    const f = formatTerm(term);
    expect(f.dice).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatRoll
// ---------------------------------------------------------------------------

describe("formatRoll", () => {
  const sampleRoll: RollResultData = {
    rollId: "roll-1",
    formula: "1d20+5",
    expandedFormula: "1d20+5",
    total: 18,
    terms: [
      {
        type: "dice",
        expression: "1d20",
        total: 13,
        faces: 20,
        number: 1,
        results: [{ result: 13, active: true }],
      },
      { type: "operator", expression: "+", total: 0 },
      { type: "numeric", expression: "5", total: 5 },
    ],
    rollMode: "public",
    timestamp: 1700000000000,
    warnings: [],
  };

  it("maps all fields", () => {
    const f = formatRoll(sampleRoll);
    expect(f.rollId).toBe("roll-1");
    expect(f.total).toBe(18);
    expect(f.terms).toHaveLength(3);
    expect(f.rollMode).toBe("public");
  });
});

// ---------------------------------------------------------------------------
// getRollTotalClass
// ---------------------------------------------------------------------------

describe("getRollTotalClass", () => {
  it("returns crit for nat 20 on single d20", () => {
    const roll = {
      rollId: "x",
      formula: "1d20",
      expandedFormula: "1d20",
      total: 20,
      rollMode: "public" as const,
      terms: [
        {
          type: "dice" as const,
          expression: "1d20",
          total: 20,
          faces: 20,
          dice: [
            {
              value: 20,
              active: true,
              discarded: false,
              isCrit: true,
              isFumble: false,
              isSuccess: false,
              isFailure: false,
              exploded: false,
              rerolled: false,
            },
          ],
        },
      ],
      warnings: [],
    };
    expect(getRollTotalClass(roll)).toBe("crit");
  });

  it("returns fumble for nat 1", () => {
    const roll = {
      rollId: "x",
      formula: "1d20",
      expandedFormula: "1d20",
      total: 1,
      rollMode: "public" as const,
      terms: [
        {
          type: "dice" as const,
          expression: "1d20",
          total: 1,
          faces: 20,
          dice: [
            {
              value: 1,
              active: true,
              discarded: false,
              isCrit: false,
              isFumble: true,
              isSuccess: false,
              isFailure: false,
              exploded: false,
              rerolled: false,
            },
          ],
        },
      ],
      warnings: [],
    };
    expect(getRollTotalClass(roll)).toBe("fumble");
  });

  it("returns empty for non-d20 rolls", () => {
    const roll = {
      rollId: "x",
      formula: "2d6",
      expandedFormula: "2d6",
      total: 8,
      rollMode: "public" as const,
      terms: [
        {
          type: "dice" as const,
          expression: "2d6",
          total: 8,
          faces: 6,
          dice: [
            {
              value: 4,
              active: true,
              discarded: false,
              isCrit: false,
              isFumble: false,
              isSuccess: false,
              isFailure: false,
              exploded: false,
              rerolled: false,
            },
            {
              value: 4,
              active: true,
              discarded: false,
              isCrit: false,
              isFumble: false,
              isSuccess: false,
              isFailure: false,
              exploded: false,
              rerolled: false,
            },
          ],
        },
      ],
      warnings: [],
    };
    expect(getRollTotalClass(roll)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getMessageDisplayMeta
// ---------------------------------------------------------------------------

describe("getMessageDisplayMeta", () => {
  const baseMsg = {
    _id: "abcdefghij012345",
    type: "text",
    worldId: "world-1",
    content: "Hello",
    speaker: { userId: "u1", alias: "Alice" },
    timestamp: new Date("2024-01-15T10:35:00").getTime(),
    whisper: [],
    blind: false,
    sort: 0,
    ownership: { default: 0 },
    flags: {},
    _stats: { created: 0, updated: 0, createdBy: "u1", updatedBy: "u1", seq: 1 },
  } as unknown as ChatMessage;

  it("returns correct typeClass for text", () => {
    expect(getMessageDisplayMeta(baseMsg).typeClass).toBe("msg--text");
  });

  it("returns correct typeClass for roll", () => {
    expect(getMessageDisplayMeta({ ...baseMsg, type: "roll" }).typeClass).toBe("msg--roll");
  });

  it("formats time as HH:MM", () => {
    const meta = getMessageDisplayMeta(baseMsg);
    expect(meta.timeStr).toMatch(/^\d{2}:\d{2}$/);
  });

  it("sets alias from speaker", () => {
    expect(getMessageDisplayMeta(baseMsg).alias).toBe("Alice");
  });

  it("detects whisper", () => {
    const msg = { ...baseMsg, whisper: ["u2"] };
    expect(getMessageDisplayMeta(msg).isWhisper).toBe(true);
  });

  it("detects blind", () => {
    const msg = { ...baseMsg, blind: true };
    expect(getMessageDisplayMeta(msg).isBlind).toBe(true);
  });
});
