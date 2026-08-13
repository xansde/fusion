/**
 * doctrineProficiency.test.ts — the Cleric doctrine's proficiency progression
 * (issue #50).
 *
 * Before this fix, `system.proficiencyUpgrades` on the embedded `class` item
 * only ever carried the 4 UNCONDITIONAL Cleric lines (perception@5, will@9,
 * reflex@11, armor.unarmored@13) — Fortitude and spellcasting proficiency
 * stayed locked at Trained for the whole 1-20 range, regardless of doctrine,
 * because the doctrine-specific lines live behind an actor-flag indirection
 * the class item's own `items{}` map never reaches (see
 * `doctrineProficiencyOps`'s doc comment in planVM.ts).
 *
 * The assertion values below are quoted from Pathfinder 2e's Divine Mysteries
 * (Cloistered Cleric / Warpriest doctrine tables), independently re-derived
 * in tools/importer-pf2e/src/curation/classes/cleric.json's nota 6 — NOT read
 * back from planVM's own DOCTRINE_PROFICIENCY_UPGRADES table (that would be
 * circular). `effectiveRank` (systems/pf2e/src/derivations/build.ts) already
 * consumes `entry.system.proficiencyUpgrades` generically for any stat — this
 * suite only proves the array `chooseClassChoice` writes onto the class item
 * is exactly the one that table needs; the cross-package pipeline itself
 * (server-side) is out of scope for a client-only test.
 */

import { describe, it, expect } from "vitest";
import { chooseClassChoice, type PlanOpBuilderContext } from "../planVM.js";
import { DocUpdatePayloadSchema } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The 4 UNCONDITIONAL Cleric proficiency lines (classes-core, measured directly against the pack — same for every doctrine). */
const BASE_CLERIC_UPGRADES = [
  { level: 5, stat: "perception", rank: 2 },
  { level: 9, stat: "will", rank: 3 },
  { level: 11, stat: "reflex", rank: 2 },
  { level: 13, stat: "armor.unarmored", rank: 2 },
];

function clericClassDoc(
  proficiencyUpgrades: Array<{ level: number; stat: string; rank: number }> = BASE_CLERIC_UPGRADES,
): Record<string, unknown> {
  return {
    _id: "item-cleric-class",
    name: "Cleric",
    type: "class",
    system: {
      hp: 8,
      keyAbility: ["wis"],
      traits: { rarity: "common", value: [] },
      featLevels: { ancestry: [1], class: [2], general: [3], skill: [2] },
      proficiencyUpgrades,
      featuresByLevel: [
        { level: 1, uuid: "c", name: "Doctrine" },
        { level: 1, uuid: "e", name: "Divine Font" },
      ],
    },
    flags: { fusion: { conversion: "partial" } },
  };
}

function doctrineFeatureDoc(name: "Cloistered Cleric" | "Warpriest"): Record<string, unknown> {
  return {
    _id: `item-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type: "classFeature",
    system: { category: "doctrine", traits: { value: ["cleric"], otherTags: ["cleric-doctrine"] } },
    flags: { fusion: { conversion: "partial" } },
  };
}

function actorDoc(classDoc: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: "actor-cleric",
    type: "character",
    system: { level: { value: 1 }, build: { choices: [] } },
    items: [classDoc],
  };
}

function ctx(doc: Record<string, unknown>, editable = true): PlanOpBuilderContext {
  return { actorId: "actor-cleric", doc, editable };
}

/** Extracts the `system.proficiencyUpgrades` diff targeting the class item, validating it against the wire schema on the way. */
function classProficiencyDiff(
  ops: ReturnType<typeof chooseClassChoice>,
): Array<{ level: number; stat: string; rank: number }> {
  const updateOp = ops.find(
    (o) => o.type === "doc:update" && o.documentType === "Item" && o.id === "item-cleric-class",
  );
  if (!updateOp || updateOp.type !== "doc:update") {
    throw new Error("expected a doc:update targeting the class item");
  }
  const wire = {
    documentType: updateOp.documentType,
    updates: [{ _id: updateOp.id, diff: updateOp.diff }],
  };
  expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);
  return updateOp.diff["system.proficiencyUpgrades"] as Array<{
    level: number;
    stat: string;
    rank: number;
  }>;
}

// ---------------------------------------------------------------------------

describe("chooseClassChoice(doctrine) — merges doctrine-specific proficiencies (issue #50)", () => {
  it("Cloistered Cleric: fortitude@3(2), spellcasting@7(2)/15(3)/19(4), weapons.simple+unarmed@11(2)", () => {
    const ops = chooseClassChoice(
      ctx(actorDoc(clericClassDoc())),
      "doctrine",
      1,
      doctrineFeatureDoc("Cloistered Cleric"),
    );
    const merged = classProficiencyDiff(ops);

    // The 4 base lines survive untouched.
    for (const base of BASE_CLERIC_UPGRADES) expect(merged).toContainEqual(base);

    // RAW Cloistered Cleric doctrine table (Player Core p.112 / Divine
    // Mysteries; re-measured in cleric.json's nota 6, not this table).
    expect(merged).toContainEqual({ level: 3, stat: "fortitude", rank: 2 });
    expect(merged).toContainEqual({ level: 7, stat: "spellcasting", rank: 2 });
    expect(merged).toContainEqual({ level: 11, stat: "weapons.simple", rank: 2 });
    expect(merged).toContainEqual({ level: 11, stat: "weapons.unarmed", rank: 2 });
    expect(merged).toContainEqual({ level: 15, stat: "spellcasting", rank: 3 });
    expect(merged).toContainEqual({ level: 19, stat: "spellcasting", rank: 4 });

    // A Cloistered Cleric reaches legendary (rank 4) spellcasting — Warpriest never does.
    expect(merged.filter((u) => u.stat === "spellcasting").map((u) => u.rank)).toEqual([2, 3, 4]);
  });

  it("Warpriest: fortitude@1(2)+@15(3), armor.light+medium@1(1), weapons.martial@3(1)/7(2)+simple+unarmed@7(2), spellcasting@11(2)/19(3)", () => {
    const ops = chooseClassChoice(
      ctx(actorDoc(clericClassDoc())),
      "doctrine",
      1,
      doctrineFeatureDoc("Warpriest"),
    );
    const merged = classProficiencyDiff(ops);

    for (const base of BASE_CLERIC_UPGRADES) expect(merged).toContainEqual(base);

    // RAW Warpriest doctrine table.
    expect(merged).toContainEqual({ level: 1, stat: "fortitude", rank: 2 });
    expect(merged).toContainEqual({ level: 1, stat: "armor.light", rank: 1 });
    expect(merged).toContainEqual({ level: 1, stat: "armor.medium", rank: 1 });
    expect(merged).toContainEqual({ level: 3, stat: "weapons.martial", rank: 1 });
    expect(merged).toContainEqual({ level: 7, stat: "weapons.martial", rank: 2 });
    expect(merged).toContainEqual({ level: 7, stat: "weapons.simple", rank: 2 });
    expect(merged).toContainEqual({ level: 7, stat: "weapons.unarmed", rank: 2 });
    expect(merged).toContainEqual({ level: 11, stat: "spellcasting", rank: 2 });
    expect(merged).toContainEqual({ level: 15, stat: "fortitude", rank: 3 });
    expect(merged).toContainEqual({ level: 19, stat: "spellcasting", rank: 3 });

    // Warpriest tops out at expert (rank 3) spellcasting — never legendary.
    expect(merged.filter((u) => u.stat === "spellcasting").map((u) => u.rank)).toEqual([2, 3]);
  });

  it("swapping doctrines REPLACES the merged lines instead of accreting both", () => {
    // First pick: Cloistered Cleric, exactly as the sheet would persist it.
    const firstOps = chooseClassChoice(
      ctx(actorDoc(clericClassDoc())),
      "doctrine",
      1,
      doctrineFeatureDoc("Cloistered Cleric"),
    );
    const afterFirstPick = classProficiencyDiff(firstOps);

    // Re-pick: Warpriest, starting from the class item's state AFTER the
    // first pick (what the real sheet would have persisted).
    const secondOps = chooseClassChoice(
      ctx(actorDoc(clericClassDoc(afterFirstPick))),
      "doctrine",
      1,
      doctrineFeatureDoc("Warpriest"),
    );
    const afterSwap = classProficiencyDiff(secondOps);

    // No Cloistered-only line survives the swap (e.g. legendary spellcasting@19).
    expect(afterSwap).not.toContainEqual({ level: 19, stat: "spellcasting", rank: 4 });
    // The Warpriest lines are present.
    expect(afterSwap).toContainEqual({ level: 19, stat: "spellcasting", rank: 3 });
    // The base 4 lines still survive the swap.
    for (const base of BASE_CLERIC_UPGRADES) expect(afterSwap).toContainEqual(base);
    // No duplicate base lines accreted.
    expect(afterSwap.filter((u) => u.stat === "perception")).toHaveLength(1);
  });

  it("an unrecognized doctrine option (e.g. the Battle Creed archetype doctrine) is a safe no-op", () => {
    // Battle Creed is a real cleric-doctrine option (class-archetype),
    // deliberately NOT curated here — DOCTRINE_PROFICIENCY_UPGRADES only
    // covers the two core doctrines. Must not throw and must not touch the
    // class item's proficiencyUpgrades.
    const battleCreedDoc = { ...doctrineFeatureDoc("Warpriest"), name: "Battle Creed" };
    const ops = chooseClassChoice(ctx(actorDoc(clericClassDoc())), "doctrine", 1, battleCreedDoc);
    expect(
      ops.some(
        (o) => o.type === "doc:update" && o.documentType === "Item" && o.id === "item-cleric-class",
      ),
    ).toBe(false);
  });

  it("other class-choice axes (bloodline) do NOT touch proficiencyUpgrades", () => {
    const bloodlineDoc = {
      _id: "item-bloodline",
      name: "Bloodline: Draconic",
      type: "classFeature",
      system: { traits: { value: ["sorcerer"] } },
    };
    // Same class item id/_id as the doctrine tests — only the slotType
    // differs, isolating "doctrine" as the trigger for doctrineProficiencyOps.
    const ops = chooseClassChoice(ctx(actorDoc(clericClassDoc())), "bloodline", 1, bloodlineDoc);
    expect(
      ops.some(
        (o) => o.type === "doc:update" && o.documentType === "Item" && o.id === "item-cleric-class",
      ),
    ).toBe(false);
  });
});
