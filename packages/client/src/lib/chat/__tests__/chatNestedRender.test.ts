/**
 * chatNestedRender.test.ts — classification of a spell-cast card's nested
 * children into roll lines (attack/damage) vs graded save lines (r18-N1).
 */

import { describe, it, expect } from "vitest";
import type { ChatMessage, RollResultData } from "@fusion/shared";
import { classifyNestedChildren } from "../chatNestedRender.js";

function rollData(overrides: Partial<RollResultData> = {}): RollResultData {
  return {
    rollId: "r1",
    formula: "1d20+9",
    expandedFormula: "1d20+9",
    total: 22,
    terms: [
      {
        type: "dice",
        expression: "1d20",
        total: 13,
        faces: 20,
        number: 1,
        results: [{ result: 13, active: true }],
      },
    ],
    rollMode: "public",
    timestamp: 1000,
    warnings: [],
    ...overrides,
  };
}

function child(
  id: string,
  alias: string,
  roll: RollResultData | undefined,
  flags: ChatMessage["flags"] = { fusion: { parentMessageId: "p1" } },
): ChatMessage {
  return {
    _id: id,
    _stats: {
      createdTime: 1000,
      modifiedTime: 1000,
      version: 1,
      lastModifiedBy: "u1",
      createdBy: "u1",
      coreVersion: "0.1.0",
      systemId: null,
      systemVersion: null,
      engineSchemaVersion: 1,
      systemSchemaVersion: null,
    },
    sort: 0,
    ownership: { default: 0 },
    flags,
    type: "roll",
    worldId: "w1",
    content: "",
    speaker: { userId: "u1", alias },
    timestamp: 1000,
    whisper: [],
    blind: false,
    ...(roll ? { rolls: [roll] } : {}),
  };
}

describe("classifyNestedChildren", () => {
  it("classifies an attack roll (no degree) as a roll line", () => {
    const atk = child("atk", "Tobias", rollData({ formula: "1d20+9", total: 22, flavor: "Ataque" }));
    const { rolls, saves } = classifyNestedChildren([atk]);
    expect(saves).toHaveLength(0);
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatchObject({ messageId: "atk", formula: "1d20+9", total: 22, flavor: "Ataque" });
  });

  it("classifies a damage roll (no degree, no d20) as a roll line with no crit class", () => {
    const dmg = child(
      "dmg",
      "Tobias",
      rollData({
        formula: "3d4",
        total: 7,
        flavor: "Arco Elétrico — Dano electricity",
        terms: [
          {
            type: "dice",
            expression: "3d4",
            total: 7,
            faces: 4,
            number: 3,
            results: [
              { result: 2, active: true },
              { result: 3, active: true },
              { result: 2, active: true },
            ],
          },
        ],
      }),
    );
    const { rolls } = classifyNestedChildren([dmg]);
    expect(rolls[0]?.totalClass).toBe("");
    expect(rolls[0]?.flavor).toBe("Arco Elétrico — Dano electricity");
  });

  it("colors a nat-20 attack roll as crit", () => {
    const crit = child(
      "crit",
      "Tobias",
      rollData({
        terms: [
          {
            type: "dice",
            expression: "1d20",
            total: 20,
            faces: 20,
            number: 1,
            results: [{ result: 20, active: true }],
          },
        ],
      }),
    );
    expect(classifyNestedChildren([crit]).rolls[0]?.totalClass).toBe("crit");
  });

  it("classifies a graded roll as a save line with degree + basicSave", () => {
    const save = child(
      "save",
      "Bruenor",
      rollData({ formula: "1d20+8", total: 18, degreeOfSuccess: "success" }),
      { fusion: { parentMessageId: "p1" }, pf2e: { checkContext: { kind: "save", basicSave: true } } },
    );
    const { rolls, saves } = classifyNestedChildren([save]);
    expect(rolls).toHaveLength(0);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      messageId: "save",
      alias: "Bruenor",
      total: 18,
      degree: "success",
      basicSave: true,
    });
  });

  it("keeps degreeRaw and null degree when the grade is unknown", () => {
    const save = child(
      "save",
      "X",
      rollData({ degreeOfSuccess: "weirdGrade" }),
      { fusion: { parentMessageId: "p1" }, pf2e: { checkContext: { kind: "save" } } },
    );
    const { saves } = classifyNestedChildren([save]);
    expect(saves[0]?.degree).toBeNull();
    expect(saves[0]?.degreeRaw).toBe("weirdGrade");
    expect(saves[0]?.basicSave).toBe(false);
  });

  it("splits a mixed batch (attack + damage + 2 saves) preserving order", () => {
    const list = [
      child("atk", "Tobias", rollData({ flavor: "Ataque" })),
      child("dmg", "Tobias", rollData({ formula: "3d4", flavor: "Dano" })),
      child("s1", "Ana", rollData({ degreeOfSuccess: "failure" }), {
        fusion: { parentMessageId: "p1" },
        pf2e: { checkContext: { kind: "save", basicSave: true } },
      }),
      child("s2", "Bob", rollData({ degreeOfSuccess: "criticalSuccess" }), {
        fusion: { parentMessageId: "p1" },
        pf2e: { checkContext: { kind: "save", basicSave: true } },
      }),
    ];
    const { rolls, saves } = classifyNestedChildren(list);
    expect(rolls.map((r) => r.messageId)).toEqual(["atk", "dmg"]);
    expect(saves.map((s) => s.messageId)).toEqual(["s1", "s2"]);
    expect(saves.map((s) => s.degree)).toEqual(["failure", "criticalSuccess"]);
  });

  it("skips a non-roll child defensively", () => {
    const noRoll = child("x", "Y", undefined);
    const { rolls, saves } = classifyNestedChildren([noRoll]);
    expect(rolls).toHaveLength(0);
    expect(saves).toHaveLength(0);
  });
});
