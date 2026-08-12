/**
 * prereqEvaluator.test.ts — the prerequisite/slot-requirement evaluator's
 * resolution rules, covering issues #17, #19, #21 and #31.
 *
 * These assert against PF2e's RULES (a Bard whose muse is Maestro satisfies
 * "maestro muse"), never against a table inside the code that produced the
 * behaviour — the circularity that made the r22 twelve-class sweep useless
 * (issue #48). Fixture names/traits are the real vendor ones, quoted from
 * systems/pf2e/packs, so a pack rename breaks the test loudly instead of
 * letting it pass on invented data.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFeatPrerequisites, checkSlotRequirement } from "../planVM.js";

const PACKS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../systems/pf2e/packs",
);

function loadPack(slug: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(path.join(PACKS, slug, "documents.json"), "utf8")) as Array<
    Record<string, unknown>
  >;
}

/** Same normalization the evaluator applies to a prerequisite string. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A materialized axis choice, as `chooseClassChoice` writes it: the item IS
 * the chosen option's own document (e.g. "Maestro"), stamped with the axis
 * slot. `axisChoiceNames` finds it via `flags.fusion.build.slot`.
 */
function axisItem(name: string, slotType: string): Record<string, unknown> {
  return {
    _id: `item-${slotType}`,
    name,
    type: "classFeature",
    system: { traits: { value: [], otherTags: [] } },
    flags: { fusion: { build: { level: 1, slot: `${slotType}-1` } } },
  };
}

/** A class feat with the given prerequisite prose, filling a level-1 class-feat slot. */
function featWithPrereq(
  name: string,
  prerequisites: string[],
  traits: string[] = [],
): Record<string, unknown> {
  return {
    _id: `item-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type: "feat",
    system: {
      category: "class",
      level: 1,
      traits: { rarity: "common", value: traits },
      prerequisites: prerequisites.map((value) => ({ value })),
    },
    flags: { fusion: { build: { level: 1, slot: "classFeat-1" } } },
  };
}

// ---------------------------------------------------------------------------
// #19 — the four r22 axes (muse, cause, doctrine) reach the evaluator
// ---------------------------------------------------------------------------

describe("checkFeatPrerequisites — r22 subclass axes (issue #19)", () => {
  it("Bard with the Maestro muse satisfies 'maestro muse' (Lingering Composition)", () => {
    const muse = axisItem("Maestro", "muse");
    const feat = featWithPrereq("Lingering Composition", ["maestro muse"], ["bard"]);
    expect(checkFeatPrerequisites(feat, [muse, feat], undefined, 1)).toBeUndefined();
  });

  it("Bard with the Enigma muse does NOT satisfy 'maestro muse' — marked unmet", () => {
    const muse = axisItem("Enigma", "muse");
    const feat = featWithPrereq("Lingering Composition", ["maestro muse"], ["bard"]);
    const issue = checkFeatPrerequisites(feat, [muse, feat], undefined, 1);
    expect(issue?.reasonKey).toBe("FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet");
  });

  it("Champion with the Justice cause satisfies 'justice cause' (Nimble Reprisal)", () => {
    const cause = axisItem("Justice", "cause");
    const feat = featWithPrereq("Nimble Reprisal", ["justice cause"], ["champion"]);
    expect(checkFeatPrerequisites(feat, [cause, feat], undefined, 1)).toBeUndefined();
  });

  it("Cleric with the Warpriest doctrine satisfies 'warpriest doctrine' (Warpriest's Armor)", () => {
    const doctrine = axisItem("Warpriest", "doctrine");
    const feat = featWithPrereq("Warpriest's Armor", ["warpriest doctrine"], ["cleric"]);
    expect(checkFeatPrerequisites(feat, [doctrine, feat], undefined, 1)).toBeUndefined();
  });

  it("a generic axis requirement ('cause') is met by ANY choice on that axis", () => {
    const cause = axisItem("Grandeur", "cause");
    const feat = featWithPrereq("Some Champion Feat", ["cause"], ["champion"]);
    expect(checkFeatPrerequisites(feat, [cause, feat], undefined, 1)).toBeUndefined();
  });

  it("an axis with NO choice made yet is never marked (mid-build, DEC-BC-05)", () => {
    const feat = featWithPrereq("Lingering Composition", ["maestro muse"], ["bard"]);
    expect(checkFeatPrerequisites(feat, [feat], undefined, 1)).toBeUndefined();
  });

  it("the same mid-build rule holds for the pre-existing axes (instinct)", () => {
    // Regression guard: this path used to answer "unmet" for an unchosen
    // axis, contradicting checkFeatPrerequisites' own documented contract.
    // The bug was only ever visible on `instinct`; #19 would have spread it.
    const feat = featWithPrereq("Draconic Arrogance", ["dragon instinct"], ["barbarian"]);
    expect(checkFeatPrerequisites(feat, [feat], undefined, 1)).toBeUndefined();
  });

  it("a chosen-but-different axis IS still marked (the mark that must survive)", () => {
    const instinct = axisItem("Bloodrager", "instinct");
    const feat = featWithPrereq("Draconic Arrogance", ["dragon instinct"], ["barbarian"]);
    const issue = checkFeatPrerequisites(feat, [instinct, feat], undefined, 1);
    expect(issue?.reasonKey).toBe("FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet");
  });
});

// ---------------------------------------------------------------------------
// #19 — the same rule swept over EVERY real axis prerequisite in the packs.
//
// This is the non-circular half: the feats, the prerequisite strings and the
// axis-option documents all come from systems/pf2e/packs, and the assertion
// is PF2e's rule ("the axis option a feat names is the one that satisfies
// it"), not a table inside planVM. A pack rename, a legacy option name or a
// missing option document fails this — which is exactly the family of defects
// that #26 and #28 track for other axes.
// ---------------------------------------------------------------------------

describe("checkFeatPrerequisites — every real axis prerequisite in feats-core (issue #19)", () => {
  const AXES = [
    { suffix: "muse", otherTag: "bard-muse", classTrait: "bard", slotType: "muse" },
    { suffix: "cause", otherTag: "champion-cause", classTrait: "champion", slotType: "cause" },
    { suffix: "doctrine", otherTag: "cleric-doctrine", classTrait: "cleric", slotType: "doctrine" },
  ] as const;

  const feats = loadPack("feats-core");
  const classFeatures = loadPack("class-features-core");

  /** Every `<X> <suffix>` prerequisite in feats-core, with the feat that declares it. */
  function axisPrereqs(suffix: string): Array<{ featName: string; raw: string; wanted: string }> {
    const out: Array<{ featName: string; raw: string; wanted: string }> = [];
    for (const feat of feats) {
      const sys = feat["system"] as Record<string, unknown> | undefined;
      const list = sys?.["prerequisites"];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const raw =
          typeof entry === "string" ? entry : (entry as Record<string, unknown> | null)?.["value"];
        if (typeof raw !== "string") continue;
        const norm = normalize(raw);
        if (!norm.endsWith(` ${suffix}`)) continue;
        out.push({
          featName: String(feat["name"]),
          raw,
          wanted: norm.slice(0, -(suffix.length + 1)).trim(),
        });
      }
    }
    return out;
  }

  /** The axis's option documents, as `chooseClassChoice` would embed them. */
  function optionsFor(otherTag: string): Array<Record<string, unknown>> {
    return classFeatures.filter((doc) => {
      const traits = (doc["system"] as Record<string, unknown> | undefined)?.["traits"];
      const tags = (traits as Record<string, unknown> | undefined)?.["otherTags"];
      return Array.isArray(tags) && tags.includes(otherTag);
    });
  }

  for (const axis of AXES) {
    it(`every '<X> ${axis.suffix}' prerequisite names a real ${axis.otherTag} option and resolves`, () => {
      const prereqs = axisPrereqs(axis.suffix);
      expect(prereqs.length).toBeGreaterThan(0);

      const options = optionsFor(axis.otherTag);
      expect(options.length).toBeGreaterThan(1);

      const unmatched: string[] = [];
      const notMet: string[] = [];
      const notMarked: string[] = [];

      for (const { featName, raw, wanted } of prereqs) {
        const match = options.find((o) => normalize(String(o["name"])) === wanted);
        if (!match) {
          unmatched.push(`${featName} :: "${raw}"`);
          continue;
        }
        const feat = featWithPrereq(featName, [raw], [axis.classTrait]);

        // Chosen option IS the one the feat names → satisfied, no mark.
        const chosen = axisItem(String(match["name"]), axis.slotType);
        if (checkFeatPrerequisites(feat, [chosen, feat], undefined, 20) !== undefined) {
          notMet.push(`${featName} :: "${raw}" with ${String(match["name"])}`);
        }

        // Any OTHER option on the same axis → not satisfied, must be marked.
        const other = options.find((o) => normalize(String(o["name"])) !== wanted);
        if (other) {
          const wrong = axisItem(String(other["name"]), axis.slotType);
          if (checkFeatPrerequisites(feat, [wrong, feat], undefined, 20) === undefined) {
            notMarked.push(`${featName} :: "${raw}" with ${String(other["name"])}`);
          }
        }
      }

      expect({ unmatched, notMet, notMarked }).toEqual({
        unmatched: [],
        notMet: [],
        notMarked: [],
      });
    });
  }
});

// ---------------------------------------------------------------------------
// #21 — the Kinetic Gate axis is NOT name-resolvable, so it must not mark
// ---------------------------------------------------------------------------

describe("checkFeatPrerequisites — Kinetic Gate is not name-resolvable (issue #21)", () => {
  it("'Nourishing Gate' is never marked unmet: the gate item is always literally 'Kinetic Gate'", () => {
    // chooseKineticGate stores the pick in `system.kineticGates`, so the slot
    // item's NAME carries no element — comparing names could only ever produce
    // a false unmet, for every Kineticist that ever existed.
    const gate = axisItem("Kinetic Gate", "kineticGate");
    const feat = featWithPrereq(
      "Elemental Apotheosis",
      ["Nourishing Gate", "exactly one kinetic element"],
      ["kineticist"],
    );
    expect(checkFeatPrerequisites(feat, [gate, feat], undefined, 20)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #31 — the Oxford comma must not corrupt the last alternative
// ---------------------------------------------------------------------------

describe("checkFeatPrerequisites — Oxford comma in an OR-list (issue #31)", () => {
  it("the LAST alternative after ', or' still resolves (no stray 'or ' prefix)", () => {
    const muse = axisItem("Polymath", "muse");
    const feat = featWithPrereq(
      "Multi-Muse Feat",
      ["enigma muse, maestro muse, or polymath muse"],
      ["bard"],
    );
    expect(checkFeatPrerequisites(feat, [muse, feat], undefined, 1)).toBeUndefined();
  });

  it("an OR-list where NO alternative is satisfied is still marked unmet", () => {
    const muse = axisItem("Warrior", "muse");
    const feat = featWithPrereq(
      "Multi-Muse Feat",
      ["enigma muse, maestro muse, or polymath muse"],
      ["bard"],
    );
    const issue = checkFeatPrerequisites(feat, [muse, feat], undefined, 1);
    expect(issue?.reasonKey).toBe("FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet");
  });

  it("a plain 'A or B' list keeps working", () => {
    const muse = axisItem("Enigma", "muse");
    const feat = featWithPrereq("Two-Muse Feat", ["enigma muse or maestro muse"], ["bard"]);
    expect(checkFeatPrerequisites(feat, [muse, feat], undefined, 1)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #17 — a feat shared by several classes is not "the wrong class"
// ---------------------------------------------------------------------------

describe("checkSlotRequirement — multi-class feat traits (issue #17)", () => {
  const ctx = (classSlug: string) => ({ classSlug });

  it("Reach Spell (bard+cleric+druid+oracle+sorcerer+witch+wizard) is fine for a Wizard", () => {
    const feat = featWithPrereq(
      "Reach Spell",
      [],
      ["bard", "cleric", "druid", "oracle", "sorcerer", "witch", "wizard"],
    );
    expect(checkSlotRequirement(feat, "classFeat", 1, ctx("wizard"))).toBeUndefined();
  });

  it("Agile Shield Grip (champion+fighter) is fine for a Fighter — the trait is not first", () => {
    const feat = featWithPrereq("Agile Shield Grip", [], ["champion", "fighter"]);
    expect(checkSlotRequirement(feat, "classFeat", 1, ctx("fighter"))).toBeUndefined();
  });

  it("Agile Shield Grip (champion+fighter) IS wrong-class for a Monk", () => {
    const feat = featWithPrereq("Agile Shield Grip", [], ["champion", "fighter"]);
    const issue = checkSlotRequirement(feat, "classFeat", 1, ctx("monk"));
    expect(issue?.reasonKey).toBe("FUSION.Sheet.Plan.Requirement.WrongClass");
  });

  it("a single-class feat still marks the wrong class", () => {
    const feat = featWithPrereq("Bardic Lore", [], ["bard"]);
    const issue = checkSlotRequirement(feat, "classFeat", 1, ctx("wizard"));
    expect(issue?.reasonKey).toBe("FUSION.Sheet.Plan.Requirement.WrongClass");
  });

  it("a feat with no class trait at all stays eligible", () => {
    const feat = featWithPrereq("Canny Acumen", [], ["general"]);
    expect(checkSlotRequirement(feat, "classFeat", 1, ctx("monk"))).toBeUndefined();
  });
});
