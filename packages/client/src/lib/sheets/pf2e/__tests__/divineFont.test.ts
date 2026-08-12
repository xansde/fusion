/**
 * divineFont.test.ts — the Cleric "Divine Font" builder support (issue #34,
 * plus the live-test fix on top of it: the "font" axis was never wired into
 * prerequisite matching, and the synthesized pick's name was English while
 * the picker dialog was already pt-BR).
 *
 * Covers:
 *   - a level-1 `divineFont` slot appears for the Cleric (whose class doc
 *     declares a "Divine Font" featuresByLevel placeholder, verified against
 *     the real pack below) and NOT for a class without one (Magus);
 *   - `chooseDivineFont` emits a `classFeature` item named with the REAL
 *     pt-BR picker-dialog labels ("Fonte de Cura"/"Fonte de Dano", read from
 *     the actual i18n file — non-circular), carrying a stable
 *     `flags.fusion.sourceId` that differs between the two picks, plus a
 *     matching `system.build.choices` marker;
 *   - re-picking (Heal → Harm) REPLACES the item, same as any other axis;
 *   - the produced item (its REAL pt-BR name, not a hand-rolled English
 *     fixture) resolves REAL feats-core prerequisites in every direction PF2e
 *     actually cares about: the matching font is met, the mismatched one is
 *     unmet, a generic "divine font" requirement (Martyr) is met by either,
 *     an OR-list (Versatile Font) is met by either, and deity/legacy prose
 *     this module can't check (Bless Tonic/Toxin, Necromancer's Visage) is
 *     NEVER falsely marked — proving the fix's payoff against real pack
 *     data, not a re-assertion of this module's own table.
 *
 * 100% headless (no PIXI/Svelte/browser). Ops validated against the wire Zod
 * schema, mirroring kineticGate.test.ts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  derivePlan,
  chooseDivineFont,
  checkFeatPrerequisites,
  CLASS_CHOICE_SLOTS,
  type PlanOpBuilderContext,
  type ClassSystemLike,
} from "../planVM.js";
import { DocCreatePayloadSchema, DocUpdatePayloadSchema } from "@fusion/shared";
import { DOCUMENT_NAMES_PT } from "../../../compendium/documentNamesPt.js";

const PACKS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../systems/pf2e/packs",
);

function loadPack(slug: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(path.join(PACKS, slug, "documents.json"), "utf8")) as Array<
    Record<string, unknown>
  >;
}

/**
 * The REAL pt-BR message catalog — read from disk, not copied into this
 * file, so the "produced item name matches the dialog" assertions below fail
 * loudly if the two ever drift (live-test finding: they already had once —
 * DIVINE_FONT_OPTIONS was English while the dialog's labels were pt-BR).
 */
const PT_BR_MESSAGES = JSON.parse(
  readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../i18n/pt-BR.json"),
    "utf8",
  ),
) as Record<string, string>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Cleric class doc: keyAbility WIS, "Divine Font" + "Doctrine" at level 1. */
function clericClassDoc(): Record<string, unknown> {
  return {
    _id: "item-cleric-class",
    name: "Cleric",
    type: "class",
    system: {
      hp: 8,
      keyAbility: ["wis"],
      perception: 0,
      savingThrows: { fortitude: 1, reflex: 0, will: 2 },
      trainedSkills: { value: ["religion"], additional: 2 },
      traits: { rarity: "common", value: [] },
      featLevels: { ancestry: [1], class: [2], general: [3], skill: [2] },
      proficiencyUpgrades: [
        { level: 5, stat: "perception", rank: 2 },
        { level: 9, stat: "will", rank: 3 },
      ],
      featuresByLevel: [
        { level: 1, uuid: "a", name: "Deity" },
        { level: 1, uuid: "b", name: "Cleric Spellcasting" },
        { level: 1, uuid: "c", name: "Doctrine" },
        { level: 1, uuid: "d", name: "First Doctrine" },
        { level: 1, uuid: "e", name: "Divine Font" },
      ],
    },
    flags: { fusion: { conversion: "partial" } },
  };
}

/** Magus class doc WITHOUT a Divine Font feature (negative control). */
function magusClassDoc(): Record<string, unknown> {
  return {
    _id: "item-magus-class",
    name: "Magus",
    type: "class",
    system: {
      hp: 8,
      keyAbility: ["dex", "str"],
      trainedSkills: { value: ["arcana"], additional: 2 },
      traits: { rarity: "common", value: [] },
      featLevels: { ancestry: [1], class: [2], general: [3], skill: [2] },
      featuresByLevel: [{ level: 1, uuid: "y", name: "Hybrid Study" }],
    },
    flags: { fusion: { conversion: "full" } },
  };
}

function actorDoc(
  classDoc: Record<string, unknown>,
  items: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  return {
    _id: "actor-cleric",
    type: "character",
    system: { level: { value: 1 }, build: { choices: [] } },
    items: [classDoc, ...items],
  };
}

function ctx(doc: Record<string, unknown>, editable = true): PlanOpBuilderContext {
  return { actorId: "actor-cleric", doc, editable };
}

/**
 * The REAL classFeature item `chooseDivineFont` produces for `choice` — used
 * by every prerequisite-resolution test below instead of a hand-rolled
 * English-named fixture. Feeding the ACTUAL synthesized item (pt-BR name +
 * `flags.fusion.sourceId`) through `checkFeatPrerequisites` is what proves
 * the fix end-to-end: a fixture built with the old English name would keep
 * passing even if the sourceId-based axis matching were broken.
 */
function chosenFontItem(choice: "heal" | "harm"): Record<string, unknown> {
  const ops = chooseDivineFont(ctx(actorDoc(clericClassDoc())), 1, choice);
  const createOp = ops.find((o) => o.type === "doc:create") as { data: Record<string, unknown> };
  return createOp.data;
}

// ---------------------------------------------------------------------------
// Real-pack anchors — RAW subheadings + the two real prerequisite strings.
// ---------------------------------------------------------------------------

const classFeatures = loadPack("class-features-core");
const feats = loadPack("feats-core");

/** The real "Divine Font" classFeature doc, class-features-core. */
function realDivineFontDoc(): Record<string, unknown> {
  const doc = classFeatures.find((d) => d["name"] === "Divine Font");
  if (!doc) throw new Error("fixture drift: 'Divine Font' missing from class-features-core");
  return doc;
}

/** Extracts "Healing Font"/"Harmful Font" from the vendor description's own bold subheadings — not hardcoded. */
function ravSubheadings(description: string): string[] {
  const matches = [...description.matchAll(/<strong>([^:<]+):<\/strong>/g)];
  return matches.map((m) => m[1]!.trim()).filter((s) => /Font$/.test(s));
}

describe("Divine Font — slot presence (issue #34)", () => {
  it("CLASS_CHOICE_SLOTS maps 'Divine Font' to the divineFont slot type", () => {
    expect(CLASS_CHOICE_SLOTS["Divine Font"]).toBe("divineFont");
  });

  it("adds a level-1 divineFont slot for a Cleric actor", () => {
    const plan = derivePlan(actorDoc(clericClassDoc()));
    const level1 = plan.levels.find((l) => l.level === 1)!;
    const slot = level1.slots.find((s) => s.type === "divineFont");
    expect(slot).toBeDefined();
    expect(slot!.slotId).toBe("divineFont-1");
    expect(slot!.filled).toBe(false);
  });

  it("does NOT add a divineFont slot for a non-Cleric class", () => {
    const plan = derivePlan(actorDoc(magusClassDoc()));
    const level1 = plan.levels.find((l) => l.level === 1)!;
    expect(level1.slots.some((s) => s.type === "divineFont")).toBe(false);
  });
});

describe("chooseDivineFont — the produced item", () => {
  it("'Divine Font' (class-features-core) documents exactly 'Healing Font' and 'Harmful Font'", () => {
    // Non-circular anchor: the expected names come from the vendor's OWN
    // description text, not from planVM's DIVINE_FONT_OPTIONS table.
    const description = (realDivineFontDoc()["system"] as Record<string, unknown>)[
      "description"
    ] as string;
    expect(ravSubheadings(description).sort()).toEqual(["Harmful Font", "Healing Font"]);
  });

  it("chooseDivineFont('heal') creates a classFeature named after the dialog's own pt-BR label (issue #34 live-test fix)", () => {
    const doc = actorDoc(clericClassDoc());
    const ops = chooseDivineFont(ctx(doc), 1, "heal");

    const createOp = ops.find((o) => o.type === "doc:create")!;
    if (createOp.type !== "doc:create") throw new Error("expected doc:create");
    const createWire = {
      documentType: createOp.documentType,
      data: [createOp.data],
      parent: createOp.parent,
    };
    expect(DocCreatePayloadSchema.safeParse(createWire).success).toBe(true);
    expect(createOp.data["type"]).toBe("classFeature");
    // Non-circular anchor: compared against the REAL pt-BR i18n file the
    // picker dialog itself reads, not an English copy hardcoded here.
    expect(createOp.data["name"]).toBe(PT_BR_MESSAGES["FUSION.Sheet.Plan.DivineFont.Heal"]);
    expect(createOp.data["name"]).toBe("Fonte de Cura");
    const flags = createOp.data["flags"] as {
      fusion?: { build?: unknown; sourceId?: unknown };
    };
    expect(flags.fusion?.build).toEqual({ level: 1, slot: "divineFont-1" });
    // Tarefa A/B interaction: the choice keeps a stable identity beyond its
    // (now pt-BR) display name — that's what axis matching resolves through.
    expect(typeof flags.fusion?.sourceId).toBe("string");
    expect(flags.fusion?.sourceId).not.toBe("");

    const updateOp = ops.find((o) => o.type === "doc:update")!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    const updateWire = {
      documentType: updateOp.documentType,
      updates: [{ _id: updateOp.id, diff: updateOp.diff }],
    };
    expect(DocUpdatePayloadSchema.safeParse(updateWire).success).toBe(true);
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toContainEqual({ level: 1, slot: "divineFont-1", type: "divineFont" });
  });

  it("chooseDivineFont('harm') creates a classFeature named after the dialog's own pt-BR label", () => {
    const doc = actorDoc(clericClassDoc());
    const ops = chooseDivineFont(ctx(doc), 1, "harm");
    const data = (ops.find((o) => o.type === "doc:create") as { data: Record<string, unknown> })
      .data;
    expect(data["name"]).toBe(PT_BR_MESSAGES["FUSION.Sheet.Plan.DivineFont.Harm"]);
    expect(data["name"]).toBe("Fonte de Dano");
  });

  it("heal and harm picks carry DIFFERENT stable sourceIds (identity, not just 'a string')", () => {
    const healFlags = (chosenFontItem("heal")["flags"] as { fusion?: { sourceId?: unknown } })
      .fusion;
    const harmFlags = (chosenFontItem("harm")["flags"] as { fusion?: { sourceId?: unknown } })
      .fusion;
    expect(healFlags?.sourceId).toBeTruthy();
    expect(harmFlags?.sourceId).toBeTruthy();
    expect(healFlags?.sourceId).not.toBe(harmFlags?.sourceId);
  });

  it("re-picking (Heal → Harm) REPLACES the item instead of accreting a second one", () => {
    const healItem = {
      _id: "item-heal-font",
      name: "Fonte de Cura",
      type: "classFeature",
      system: { traits: { value: ["cleric"] } },
      flags: { fusion: { build: { level: 1, slot: "divineFont-1" } } },
    };
    const doc = actorDoc(clericClassDoc(), [healItem]);
    const ops = chooseDivineFont(ctx(doc), 1, "harm");
    const deleteOp = ops.find((o) => o.type === "doc:delete");
    expect(deleteOp).toBeDefined();
    expect((deleteOp as { id: string }).id).toBe("item-heal-font");
    const createOp = ops.find((o) => o.type === "doc:create") as { data: Record<string, unknown> };
    expect(createOp.data["name"]).toBe("Fonte de Dano");
  });

  it("returns no ops when not editable", () => {
    const doc = actorDoc(clericClassDoc());
    expect(chooseDivineFont(ctx(doc, false), 1, "heal")).toEqual([]);
  });
});

describe("checkFeatPrerequisites — the Divine Font pick resolves REAL font prerequisites (issue #34 live-test fix)", () => {
  /** Real feats-core doc + its literal prerequisites array, unmodified. */
  function realFeat(name: string): Record<string, unknown> {
    const doc = feats.find((d) => d["name"] === name);
    if (!doc) throw new Error(`fixture drift: '${name}' missing from feats-core`);
    return doc;
  }

  /** A real feats-core doc, embedded with a build flag — mirrors the existing file's `featItem` fixtures. */
  function featItemFor(name: string, level: number): Record<string, unknown> {
    return {
      ...realFeat(name),
      _id: `item-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      flags: { fusion: { build: { level, slot: `classFeat-${level}` } } },
    };
  }

  const clericSystem = clericClassDoc()["system"] as ClassSystemLike;

  // ---------------------------------------------------------------------
  // 1 & 2 — the live-test bug itself. Before this fix, choosing EITHER font
  // left BOTH "Healing Hands" and "Harming Hands" unmarked — an invisible
  // false negative, identical on screen regardless of the pick. Both
  // directions of both choices are asserted so a regression on either side
  // fails loudly.
  // ---------------------------------------------------------------------

  it("Healing Font: 'Healing Hands' (real prereq: 'healing font') is met, 'Harming Hands' (real prereq: 'harmful font') is unmet", () => {
    expect(
      (realFeat("Healing Hands")["system"] as Record<string, unknown>)["prerequisites"],
    ).toEqual([{ value: "healing font" }]);
    expect(
      (realFeat("Harming Hands")["system"] as Record<string, unknown>)["prerequisites"],
    ).toEqual([{ value: "harmful font" }]);

    const pick = chosenFontItem("heal");
    const healingHands = featItemFor("Healing Hands", 2);
    const harmingHands = featItemFor("Harming Hands", 2);

    expect(
      checkFeatPrerequisites(healingHands, [pick, healingHands], undefined, 2),
    ).toBeUndefined();
    const issue = checkFeatPrerequisites(harmingHands, [pick, harmingHands], undefined, 2);
    expect(issue?.reasonKey).toBe("FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet");
  });

  it("Harmful Font: 'Harming Hands' is met, 'Healing Hands' is unmet (inverse of the heal case)", () => {
    const pick = chosenFontItem("harm");
    const healingHands = featItemFor("Healing Hands", 2);
    const harmingHands = featItemFor("Harming Hands", 2);

    expect(
      checkFeatPrerequisites(harmingHands, [pick, harmingHands], undefined, 2),
    ).toBeUndefined();
    const issue = checkFeatPrerequisites(healingHands, [pick, healingHands], undefined, 2);
    expect(issue?.reasonKey).toBe("FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet");
  });

  // ---------------------------------------------------------------------
  // 3 — Martyr's bare "divine font" is a GENERIC requirement (already
  // resolvable before this fix, via the class doc's own featuresByLevel
  // entry — NOT via the axis match this fix adds): met by having Divine
  // Font at all, regardless of which side was picked.
  // ---------------------------------------------------------------------

  it("'Martyr' (real prereq: 'divine font') is met with EITHER font — generic requirement", () => {
    expect((realFeat("Martyr")["system"] as Record<string, unknown>)["prerequisites"]).toEqual([
      { value: "divine font" },
    ]);
    const martyr = featItemFor("Martyr", 8);

    for (const choice of ["heal", "harm"] as const) {
      const pick = chosenFontItem(choice);
      expect(
        checkFeatPrerequisites(martyr, [pick, martyr], clericSystem, 8),
        `Martyr should be met for choice=${choice}`,
      ).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------
  // 3b — adversarial-review fix: the case above passes `clericSystem`, which
  // ALREADY resolves "divine font" through `knownPossessedNames` (the Cleric
  // class doc's own `featuresByLevel` entry), so it never actually exercised
  // the axis-suffix match this fix adds to `AXIS_SUFFIX_TO_SLOT_TYPE`. A
  // character whose `classSystem` doesn't carry that "Divine Font"
  // featuresByLevel entry — `classSystem` is `undefined` (most callers in
  // this file), or belongs to a DIFFERENT class than the one that granted the
  // font (e.g. a Fighter who took a Cleric dedication feat chain) — has no
  // other way to resolve the bare "divine font" requirement, so it falls
  // through to the axis-suffix path. Before the fix, "divine font" stripped
  // to "divine" there — a string that can never equal the chosen font's core
  // ("healing"/"harmful") — producing a FALSE "unmet" on Martyr regardless of
  // which font was picked. These two cases are hand-asserted from the RAW
  // rule ("divine font" = have any Divine Font at all), not read off the
  // pack.
  // ---------------------------------------------------------------------

  it("'Martyr' is met with EITHER font when classSystem is undefined (most callers never pass one)", () => {
    const martyr = featItemFor("Martyr", 8);

    for (const choice of ["heal", "harm"] as const) {
      const pick = chosenFontItem(choice);
      expect(
        checkFeatPrerequisites(martyr, [pick, martyr], undefined, 8),
        `Martyr should be met for choice=${choice} with classSystem=undefined`,
      ).toBeUndefined();
    }
  });

  it("'Martyr' is met with EITHER font when classSystem belongs to a DIFFERENT class (e.g. a Fighter with a Cleric dedication)", () => {
    const fighterSystem: ClassSystemLike = {
      featuresByLevel: [{ level: 1, uuid: "f", name: "Attack of Opportunity" }],
    };
    const martyr = featItemFor("Martyr", 8);

    for (const choice of ["heal", "harm"] as const) {
      const pick = chosenFontItem(choice);
      expect(
        checkFeatPrerequisites(martyr, [pick, martyr], fighterSystem, 8),
        `Martyr should be met for choice=${choice} with a non-Cleric classSystem`,
      ).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------
  // 4 — an OR case: "Versatile Font" itself requires "harmful font or
  // healing font" (its second prerequisite, "deity that allows clerics to
  // have both fonts", is unrelated prose this module can't resolve and must
  // stay silent — it must NOT block the OR half from working).
  // ---------------------------------------------------------------------

  it("'Versatile Font' (real prereq: 'harmful font or healing font') is met by EITHER font", () => {
    const prereqs = (realFeat("Versatile Font")["system"] as Record<string, unknown>)[
      "prerequisites"
    ] as Array<Record<string, unknown>>;
    expect(prereqs).toContainEqual({ value: "harmful font or healing font" });

    for (const choice of ["heal", "harm"] as const) {
      const pick = chosenFontItem(choice);
      const versatileFont = featItemFor("Versatile Font", 2);
      expect(
        checkFeatPrerequisites(versatileFont, [pick, versatileFont], undefined, 2),
        `Versatile Font should be met for choice=${choice}`,
      ).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------
  // 5 — Bless Tonic / Bless Toxin: "deity who grants heal/harm divine font"
  // is deity-conditioned prose this module can't check (no Deity document).
  // CHOSEN BEHAVIOUR: "unresolved" (silence), never "unmet" — DEC-BC-05
  // forbids fabricating a mark for data this module doesn't model. Asserted
  // for BOTH font choices: the naive axis-suffix strip this fix would
  // otherwise apply ("deity who grants heal divine font" → "deity who
  // grants heal divine") can never equal "healing"/"harmful", so without the
  // UNRESOLVABLE_FONT_PROSE guard this feat would be falsely marked unmet
  // for EVERY Cleric who has picked a font at all — not merely the "wrong"
  // one.
  // ---------------------------------------------------------------------

  it("'Bless Tonic' (real prereq: 'deity who grants heal divine font') is NEVER falsely marked unmet", () => {
    expect(
      (realFeat("Bless Tonic")["system"] as Record<string, unknown>)["prerequisites"],
    ).toContainEqual({ value: "deity who grants heal divine font" });
    const blessTonic = featItemFor("Bless Tonic", 7);

    for (const choice of ["heal", "harm"] as const) {
      const pick = chosenFontItem(choice);
      expect(
        checkFeatPrerequisites(blessTonic, [pick, blessTonic], undefined, 7),
        `Bless Tonic should stay unmarked for choice=${choice}`,
      ).toBeUndefined();
    }
  });

  it("'Bless Toxin' (real prereq: 'deity who grants harm divine font') is NEVER falsely marked unmet", () => {
    expect(
      (realFeat("Bless Toxin")["system"] as Record<string, unknown>)["prerequisites"],
    ).toContainEqual({ value: "deity who grants harm divine font" });
    const blessToxin = featItemFor("Bless Toxin", 7);

    for (const choice of ["heal", "harm"] as const) {
      const pick = chosenFontItem(choice);
      expect(
        checkFeatPrerequisites(blessToxin, [pick, blessToxin], undefined, 7),
        `Bless Toxin should stay unmarked for choice=${choice}`,
      ).toBeUndefined();
    }
  });

  // A THIRD case the exhaustive pack grep for "font" turned up beyond the
  // two the live test reported — same trap, same underlying string: "cleric
  // with a negative font" is the LEGACY pre-remaster name for a font concept
  // Fusion's Divine Font choice doesn't model 1:1. It appears verbatim, as
  // one candidate of an identical THREE-way OR ("cleric with a negative
  // font, oracle of bones, or necromancer wizard"), in THREE real feats:
  // Necromancer's Visage, Sepulchral Sublimation and Undying Conviction.
  //
  // IMPORTANT (post-review correction): unlike the Bless Tonic/Toxin cases
  // below, this integration-level test does NOT by itself prove the
  // UNRESOLVABLE_FONT_PROSE guard matters. The OR's other two candidates
  // ("oracle of bones", "necromancer wizard") match no known name or axis
  // phrase either way, so `evaluatePrerequisiteEntry` already downgrades the
  // whole three-way entry to "unknown" via its `allResolved` logic —
  // regardless of whether "cleric with a negative font" is guarded or left
  // to the naive axis-suffix path. This test still earns its place as an
  // integration/regression guard against real pack drift (grep above), but
  // the guard's OWN load-bearing proof is the isolated test right after it,
  // which reproduces the phrase as PF2e never actually presents it — alone.
  it.each(["Necromancer's Visage", "Sepulchral Sublimation", "Undying Conviction"])(
    "'%s' (real prereq OR-candidate: 'cleric with a negative font') is NEVER falsely marked unmet",
    (featName) => {
      const prereqs = (realFeat(featName)["system"] as Record<string, unknown>)[
        "prerequisites"
      ] as Array<Record<string, unknown>>;
      expect(prereqs).toContainEqual({
        value: "cleric with a negative font, oracle of bones, or necromancer wizard",
      });
      const item = featItemFor(featName, 12);

      for (const choice of ["heal", "harm"] as const) {
        const pick = chosenFontItem(choice);
        expect(
          checkFeatPrerequisites(item, [pick, item], undefined, 12),
          `${featName} should stay unmarked for choice=${choice}`,
        ).toBeUndefined();
      }
    },
  );

  // The guard's ACTUAL load-bearing proof: "cleric with a negative font" as
  // the SOLE prerequisite candidate — a shape that never occurs in real
  // packs (it's always accompanied by two other always-unresolved OR
  // siblings, see above), constructed here specifically to bypass the OR
  // downgrade and exercise UNRESOLVABLE_FONT_PROSE directly. Without that
  // entry, `matchAxisSuffix` WOULD match the " font" suffix, strip to
  // "cleric with a negative", and compare it against the chosen font's core
  // ("healing"/"harmful") — never equal, so the naive path produces a FALSE
  // "unmet" here. This test fails if UNRESOLVABLE_FONT_PROSE's "cleric with
  // a negative font" entry is removed.
  it("'cleric with a negative font' in ISOLATION (never how real packs present it) is NEVER falsely marked unmet — this is what the guard actually protects", () => {
    const synthetic = {
      _id: "item-synthetic-negative-font",
      name: "Synthetic Negative Font Feat",
      type: "feat",
      system: {
        category: "class",
        level: 1,
        traits: { rarity: "common", value: ["cleric"] },
        prerequisites: [{ value: "cleric with a negative font" }],
      },
      flags: { fusion: { build: { level: 1, slot: "classFeat-1" } } },
    };

    for (const choice of ["heal", "harm"] as const) {
      const pick = chosenFontItem(choice);
      expect(
        checkFeatPrerequisites(synthetic, [pick, synthetic], undefined, 1),
        `synthetic 'cleric with a negative font' should stay unmarked for choice=${choice}`,
      ).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------
  // Backward compatibility — a character saved BEFORE this fix has its
  // Divine Font pick stored as a classFeature item with the OLD English
  // name ("Healing Font"/"Harmful Font") and NO `flags.fusion.sourceId`
  // (that flag was introduced by this fix). `axisChoiceNames` falls back to
  // `itemName(it)` when no sourceId → DIVINE_FONT_CORE_BY_SOURCE_ID mapping
  // exists, and the generic "font"-suffix strip in `axisCoreName` reduces
  // that legacy English name to the same "healing"/"harmful" core the new
  // sourceId path produces — so old saves keep resolving correctly without
  // migration. This must stay covered: the doc comments on `axisChoiceNames`
  // and `DIVINE_FONT_OPTIONS` now say identity is "sourceId, never the
  // name", and a future cleanup that drops the `?? itemName(it)` fallback
  // would break every pre-fix Cleric save in silence without a test here.
  // ---------------------------------------------------------------------

  function legacyFontItem(name: "Healing Font" | "Harmful Font"): Record<string, unknown> {
    return {
      _id: "item-legacy-font",
      name,
      type: "classFeature",
      flags: { fusion: { build: { level: 1, slot: "divineFont-1" } } },
      // Deliberately NO flags.fusion.sourceId — pre-fix saves never had one.
    };
  }

  it("a LEGACY 'Healing Font' item (no sourceId, pre-fix save) still resolves 'Healing Hands' met / 'Harming Hands' unmet", () => {
    const legacy = legacyFontItem("Healing Font");
    expect((legacy["flags"] as { fusion: { sourceId?: unknown } }).fusion.sourceId).toBeUndefined();
    const healingHands = featItemFor("Healing Hands", 2);
    const harmingHands = featItemFor("Harming Hands", 2);

    expect(
      checkFeatPrerequisites(healingHands, [legacy, healingHands], undefined, 2),
    ).toBeUndefined();
    const issue = checkFeatPrerequisites(harmingHands, [legacy, harmingHands], undefined, 2);
    expect(issue?.reasonKey).toBe("FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet");
  });

  it("a LEGACY 'Harmful Font' item (no sourceId, pre-fix save) still resolves 'Harming Hands' met / 'Healing Hands' unmet", () => {
    const legacy = legacyFontItem("Harmful Font");
    const healingHands = featItemFor("Healing Hands", 2);
    const harmingHands = featItemFor("Harming Hands", 2);

    expect(
      checkFeatPrerequisites(harmingHands, [legacy, harmingHands], undefined, 2),
    ).toBeUndefined();
    const issue = checkFeatPrerequisites(healingHands, [legacy, healingHands], undefined, 2);
    expect(issue?.reasonKey).toBe("FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet");
  });

  // ---------------------------------------------------------------------
  // "Ebb and Flow" (level 14) is the odd one out among the 19 real "font"
  // prerequisites: its value is the FEAT NAME "Versatile Font" verbatim, not
  // a "<heal|harm> font" pattern — but "Versatile Font" itself ends in
  // " Font", so it ALSO matches the divineFont axis suffix. This is a
  // behaviour change (post-review finding): before this fix, "font" wasn't
  // an axis suffix at all, so this prerequisite silently fell to "unknown"
  // for every Cleric; now a Cleric who has picked a font but doesn't hold
  // the "Versatile Font" feat gets a real "unmet" mark on it. Covered here
  // because it's the only one of the 19 that changes via a DIFFERENT path
  // than the axis-pick match: it's satisfied by literally POSSESSING the
  // "Versatile Font" feat (a direct name match via `knownPossessedNames`,
  // checked BEFORE the axis path ever runs), not by which font was chosen.
  // ---------------------------------------------------------------------

  it("'Ebb and Flow' (real prereq: the feat name 'Versatile Font') is UNMET when a font is chosen but 'Versatile Font' itself isn't held", () => {
    expect(
      (realFeat("Ebb and Flow")["system"] as Record<string, unknown>)["prerequisites"],
    ).toEqual([{ value: "Versatile Font" }]);
    const ebbAndFlow = featItemFor("Ebb and Flow", 14);
    const pick = chosenFontItem("heal");

    const issue = checkFeatPrerequisites(ebbAndFlow, [pick, ebbAndFlow], undefined, 14);
    expect(issue?.reasonKey).toBe("FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet");
    // Non-circular anchor: the pt-BR label comes from the SAME document-name
    // index `translatePrerequisite` reads (not re-implemented in this test).
    expect(DOCUMENT_NAMES_PT["versatile font"]).toBe("Fonte Versátil");
    expect(issue?.params?.["prerequisite"]).toBe(DOCUMENT_NAMES_PT["versatile font"]);
  });

  it("'Ebb and Flow' is met once the Cleric actually holds 'Versatile Font' — a direct name match, not the divineFont axis", () => {
    const pick = chosenFontItem("heal");
    // Embedded actor items are EN of birth (server overlay translates only on
    // read, see planVM.ts's own note near chooseDivineFont) — so the held
    // feat's stored name is the literal EN pack name, matching the
    // prerequisite's EN text directly.
    const versatileFont = featItemFor("Versatile Font", 2);
    expect(versatileFont["name"]).toBe("Versatile Font");
    const ebbAndFlow = featItemFor("Ebb and Flow", 14);

    expect(
      checkFeatPrerequisites(ebbAndFlow, [pick, versatileFont, ebbAndFlow], undefined, 14),
    ).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // 6 — the critical interaction between Tarefas A and B: the produced item
  // is named with the REAL pt-BR dialog labels (not the old English vendor
  // subheadings), and the axis match above still resolves correctly THROUGH
  // that pt-BR name (every test in this describe block already proves this
  // implicitly, since `chosenFontItem` never uses the English name — this
  // test just makes the display-name claim explicit).
  // ---------------------------------------------------------------------

  it("the produced item is named with the REAL pt-BR dialog labels, not the old English ones", () => {
    expect(chosenFontItem("heal")["name"]).toBe(
      PT_BR_MESSAGES["FUSION.Sheet.Plan.DivineFont.Heal"],
    );
    expect(chosenFontItem("harm")["name"]).toBe(
      PT_BR_MESSAGES["FUSION.Sheet.Plan.DivineFont.Harm"],
    );
    expect(chosenFontItem("heal")["name"]).not.toBe("Healing Font");
    expect(chosenFontItem("harm")["name"]).not.toBe("Harmful Font");
  });
});

describe("axisChoiceNames — a hostile sourceId must not crash the Plan column (adversarial-review fix, issue #34)", () => {
  /**
   * `DIVINE_FONT_CORE_BY_SOURCE_ID` is a plain object literal, which inherits
   * `Object.prototype`. Before this fix, indexing it with an untrusted
   * `flags.fusion.sourceId` of "constructor" resolved to `Object`'s own
   * `constructor` FUNCTION rather than `undefined` — a truthy value that slid
   * past the `?? itemName(it)` fallback, got stored as the axis's "chosen
   * name", and later crashed `normalizePrereqText` (`text.normalize is not a
   * function`) the moment any font-suffixed prerequisite tried to compare
   * against it — taking out the entire Plan column derivation, not just the
   * one slot. A real save could carry a poisoned sourceId this way (manual
   * edit, corrupted import, a future bug elsewhere); this VM must degrade to
   * "unresolved" for that slot, never throw.
   */
  function poisonedFontItem(): Record<string, unknown> {
    return {
      _id: "item-poisoned-font",
      name: "Fonte Envenenada",
      type: "classFeature",
      flags: {
        fusion: {
          build: { level: 1, slot: "divineFont-1" },
          sourceId: "constructor",
        },
      },
    };
  }

  it("does not throw and simply leaves the axis unresolved when a divineFont item's sourceId is 'constructor'", () => {
    // Reuses the module-scoped `feats` pack (loaded once above) — the real
    // "Healing Hands" doc, whose prerequisite ("healing font") is exactly the
    // font-suffixed shape that reaches `axisCoreName` and would otherwise
    // crash on the poisoned entry.
    const healingHandsDoc = feats.find((d) => d["name"] === "Healing Hands");
    if (!healingHandsDoc) throw new Error("fixture drift: 'Healing Hands' missing from feats-core");
    const healingHands = {
      ...healingHandsDoc,
      _id: "item-healing-hands",
      flags: { fusion: { build: { level: 2, slot: "classFeat-2" } } },
    };
    const poisoned = poisonedFontItem();

    expect(() =>
      checkFeatPrerequisites(healingHands, [poisoned, healingHands], undefined, 2),
    ).not.toThrow();
  });
});
