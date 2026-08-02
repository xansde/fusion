/**
 * @fusion/system-pf2e — Schema surface of the class-levels variant.
 *
 * Covers the toggle (REQ-MCL-001), the level split as open-typed `choices`
 * (DEC-MCL-02), and the consistency refinement between `level.value` and the
 * split (REQ-MCL-012) — including the cases where it must stay SILENT, which
 * is what keeps a world with the variant off unaffected (REQ-MCL-002/003).
 *
 * Spec: 30-multiclasse-por-niveis.md §5.1, §6.1, §6.2.
 */

import { describe, it, expect } from "vitest";
import { CharacterSystemSchema } from "../schemas/actor-character.js";

/** Minimal valid character, level 5, no build block. */
const baseCharacter = {
  level: { value: 5 },
  abilities: {
    str: { value: 18 },
    dex: { value: 14 },
    con: { value: 16 },
    int: { value: 10 },
    wis: { value: 12 },
    cha: { value: 8 },
  },
  attributes: {
    hp: { value: 55, max: 60 },
    speed: { value: 25 },
    dying: { value: 0, max: 4 },
    wounded: { value: 0 },
    doomed: { value: 0 },
  },
  saves: { fortitude: { rank: 2 }, reflex: { rank: 1 }, will: { rank: 1 } },
  perception: { rank: 1 },
  skills: { athletics: { rank: 2 } },
  proficiencies: { classDC: { rank: 1 } },
  details: { keyAbility: "str", class: "Fighter", level: 5 },
};

/** A `Fighter 3 / Wizard 2` split: levels 1,2,4 fighter; 3,5 wizard. */
const fighter3Wizard2 = [
  { level: 1, slot: "classLevel-1", type: "classLevel", ref: "Compendium.classes.fighter" },
  { level: 2, slot: "classLevel-2", type: "classLevel", ref: "Compendium.classes.fighter" },
  { level: 3, slot: "classLevel-3", type: "classLevel", ref: "Compendium.classes.wizard" },
  { level: 4, slot: "classLevel-4", type: "classLevel", ref: "Compendium.classes.fighter" },
  { level: 5, slot: "classLevel-5", type: "classLevel", ref: "Compendium.classes.wizard" },
];

const withBuild = (build: Record<string, unknown>): Record<string, unknown> => ({
  ...baseCharacter,
  build: { abilities: {}, ...build },
});

describe("REQ-MCL-001 — the toggle", () => {
  it("defaults to off when no build block exists at all", () => {
    const parsed = CharacterSystemSchema.parse(baseCharacter);
    expect(parsed.build).toBeUndefined();
  });

  it("defaults to off when a build block exists without variantRules", () => {
    const parsed = CharacterSystemSchema.parse(withBuild({}));
    expect(parsed.build?.variantRules.classLevels).toBe(false);
  });

  it("round-trips when explicitly enabled", () => {
    const parsed = CharacterSystemSchema.parse(
      withBuild({ variantRules: { classLevels: true }, choices: fighter3Wizard2 }),
    );
    expect(parsed.build?.variantRules.classLevels).toBe(true);
  });

  it("is independent of freeArchetype (Q-MCL-01)", () => {
    const parsed = CharacterSystemSchema.parse(
      withBuild({
        freeArchetype: false,
        variantRules: { classLevels: true },
        choices: fighter3Wizard2,
      }),
    );
    expect(parsed.build?.freeArchetype).toBe(false);
    expect(parsed.build?.variantRules.classLevels).toBe(true);
  });
});

describe("DEC-MCL-02 — the split rides on the existing open `choices` type", () => {
  it("accepts classLevel entries alongside other choice types", () => {
    const parsed = CharacterSystemSchema.parse(
      withBuild({
        variantRules: { classLevels: true },
        choices: [
          ...fighter3Wizard2,
          {
            level: 2,
            slot: "classFeat-2",
            type: "classFeat",
            ref: "Compendium.feats.sudden-charge",
          },
          {
            level: 1,
            slot: "skillTraining-1a",
            type: "skillTraining",
            skill: "acrobatics",
            rank: 1,
          },
        ],
      }),
    );
    const split = parsed.build?.choices.filter((c) => c.type === "classLevel");
    expect(split).toHaveLength(5);
  });

  it("keeps the per-level decision, not an aggregate — order is recoverable", () => {
    const parsed = CharacterSystemSchema.parse(
      withBuild({ variantRules: { classLevels: true }, choices: fighter3Wizard2 }),
    );
    const first = parsed.build?.choices.find((c) => c.type === "classLevel" && c.level === 1);
    // REQ-MCL-013: the class at character level 1 is the first class, and it
    // is a rule-bearing fact (key ability boost, level-1 class feat).
    expect(first?.ref).toContain("fighter");
  });
});

describe("REQ-MCL-012 — the split must agree with the character level", () => {
  const parseWithSplit = (
    choices: unknown[],
    level = 5,
    classLevels = true,
  ): ReturnType<typeof CharacterSystemSchema.safeParse> =>
    CharacterSystemSchema.safeParse({
      ...baseCharacter,
      level: { value: level },
      build: { abilities: {}, variantRules: { classLevels }, choices },
    });

  it("accepts a split that covers every level exactly once", () => {
    expect(parseWithSplit(fighter3Wizard2).success).toBe(true);
  });

  it("rejects a split with fewer entries than the character level", () => {
    const result = parseWithSplit(fighter3Wizard2.slice(0, 4));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("REQ-MCL-010/012");
  });

  it("rejects a hole in the middle even when the COUNT matches", () => {
    // Level 3 assigned twice, level 4 not at all: five entries, still wrong.
    // A bare count check passes this — which is why the per-level check exists.
    const holed = [
      ...fighter3Wizard2.slice(0, 3),
      { level: 3, slot: "classLevel-3b", type: "classLevel", ref: "Compendium.classes.wizard" },
      fighter3Wizard2[4],
    ];
    const result = parseWithSplit(holed);
    expect(result.success).toBe(false);
    const message = JSON.stringify(result.error?.issues);
    expect(message).toContain("character level 3 is assigned to 2 classes");
    expect(message).toContain("character level 4 is assigned to 0 classes");
  });

  it("never silently repairs — it reports, and the document stays as authored", () => {
    const result = parseWithSplit(fighter3Wizard2.slice(0, 4));
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });
});

describe("REQ-MCL-002/003 — the refinement stays inert when it must", () => {
  it("ignores an inconsistent split when the variant is OFF", () => {
    // A sheet that experimented with the variant and turned it back off must
    // still load: with the toggle false nothing in spec 30 runs at all.
    const result = CharacterSystemSchema.safeParse({
      ...baseCharacter,
      build: {
        abilities: {},
        variantRules: { classLevels: false },
        choices: fighter3Wizard2.slice(0, 2),
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts the variant ON with no split recorded yet (REQ-MCL-003)", () => {
    // Turning the toggle on for an already-built character must not invalidate
    // it: the absent split reads as "every level in the current class".
    const result = CharacterSystemSchema.safeParse({
      ...baseCharacter,
      build: { abilities: {}, variantRules: { classLevels: true }, choices: [] },
    });
    expect(result.success).toBe(true);
  });

  it("leaves a plain r9 character (no build block) completely untouched", () => {
    const result = CharacterSystemSchema.safeParse(baseCharacter);
    expect(result.success).toBe(true);
  });
});

describe("Q-MCL-02 — the level cap is the variant's parameter", () => {
  it("still rejects a character level above the cap", () => {
    const result = CharacterSystemSchema.safeParse({ ...baseCharacter, level: { value: 21 } });
    expect(result.success).toBe(false);
  });

  it("accepts a full 20-level split", () => {
    const twenty = Array.from({ length: 20 }, (_, index) => ({
      level: index + 1,
      slot: `classLevel-${String(index + 1)}`,
      type: "classLevel",
      ref: index % 2 === 0 ? "Compendium.classes.fighter" : "Compendium.classes.wizard",
    }));
    const result = CharacterSystemSchema.safeParse({
      ...baseCharacter,
      level: { value: 20 },
      build: { abilities: {}, variantRules: { classLevels: true }, choices: twenty },
    });
    expect(result.success).toBe(true);
  });
});
