/**
 * divineFont.test.ts — the Cleric "Divine Font" builder support (issue #34).
 *
 * Covers:
 *   - a level-1 `divineFont` slot appears for the Cleric (whose class doc
 *     declares a "Divine Font" featuresByLevel placeholder, verified against
 *     the real pack below) and NOT for a class without one (Magus);
 *   - `chooseDivineFont` emits a `classFeature` item named literally
 *     "Healing Font" / "Harmful Font" — the RAW subheadings quoted from the
 *     REAL "Divine Font" doc's own description in
 *     systems/pf2e/packs/class-features-core (non-circular: the expected
 *     names are extracted from the vendor text, not invented here) — plus a
 *     matching `system.build.choices` marker;
 *   - re-picking (Heal → Harm) REPLACES the item, same as any other axis;
 *   - the produced item's name resolves the REAL feats-core prerequisite
 *     text of "Healing Hands"/"Harming Hands" (direct-name match, the same
 *     mechanism `knownPossessedNames` already applies to every feat/
 *     classFeature name) — proving the fix's payoff against real pack data,
 *     not a re-assertion of this module's own table.
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
} from "../planVM.js";
import { DocCreatePayloadSchema, DocUpdatePayloadSchema } from "@fusion/shared";

const PACKS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../systems/pf2e/packs",
);

function loadPack(slug: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(path.join(PACKS, slug, "documents.json"), "utf8")) as Array<
    Record<string, unknown>
  >;
}

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

describe("chooseDivineFont — the produced item names match the REAL vendor RAW subheadings", () => {
  it("'Divine Font' (class-features-core) documents exactly 'Healing Font' and 'Harmful Font'", () => {
    // Non-circular anchor: the expected names come from the vendor's OWN
    // description text, not from planVM's DIVINE_FONT_OPTIONS table.
    const description = (realDivineFontDoc()["system"] as Record<string, unknown>)[
      "description"
    ] as string;
    expect(ravSubheadings(description).sort()).toEqual(["Harmful Font", "Healing Font"]);
  });

  it("chooseDivineFont('heal') creates a classFeature named 'Healing Font'", () => {
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
    expect(createOp.data["name"]).toBe("Healing Font");
    const flags = createOp.data["flags"] as { fusion?: { build?: unknown } };
    expect(flags.fusion?.build).toEqual({ level: 1, slot: "divineFont-1" });

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

  it("chooseDivineFont('harm') creates a classFeature named 'Harmful Font'", () => {
    const doc = actorDoc(clericClassDoc());
    const ops = chooseDivineFont(ctx(doc), 1, "harm");
    const data = (ops.find((o) => o.type === "doc:create") as { data: Record<string, unknown> })
      .data;
    expect(data["name"]).toBe("Harmful Font");
  });

  it("re-picking (Heal → Harm) REPLACES the item instead of accreting a second one", () => {
    const healItem = {
      _id: "item-heal-font",
      name: "Healing Font",
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
    expect(createOp.data["name"]).toBe("Harmful Font");
  });

  it("returns no ops when not editable", () => {
    const doc = actorDoc(clericClassDoc());
    expect(chooseDivineFont(ctx(doc, false), 1, "heal")).toEqual([]);
  });
});

describe("checkFeatPrerequisites — the Divine Font pick resolves REAL font prerequisites (issue #34)", () => {
  /** Real feats-core doc + its literal prerequisites array, unmodified. */
  function realFeat(name: string): Record<string, unknown> {
    const doc = feats.find((d) => d["name"] === name);
    if (!doc) throw new Error(`fixture drift: '${name}' missing from feats-core`);
    return doc;
  }

  it("'Healing Hands' (real prereq: 'healing font') is met once Healing Font is chosen", () => {
    const healingHands = realFeat("Healing Hands");
    const prereqs = (healingHands["system"] as Record<string, unknown>)["prerequisites"];
    expect(prereqs).toEqual([{ value: "healing font" }]);

    const healFontItem = {
      _id: "item-heal-font",
      name: "Healing Font",
      type: "classFeature",
      system: { traits: { value: ["cleric"] } },
      flags: { fusion: { build: { level: 1, slot: "divineFont-1" } } },
    };
    const featItem = {
      ...healingHands,
      _id: "item-healing-hands",
      flags: { fusion: { build: { level: 2, slot: "classFeat-2" } } },
    };
    expect(
      checkFeatPrerequisites(featItem, [healFontItem, featItem], undefined, 2),
    ).toBeUndefined();
  });

  it("'Harming Hands' (real prereq: 'harmful font') is met once Harmful Font is chosen", () => {
    const harmingHands = realFeat("Harming Hands");
    const prereqs = (harmingHands["system"] as Record<string, unknown>)["prerequisites"];
    expect(prereqs).toEqual([{ value: "harmful font" }]);

    const harmFontItem = {
      _id: "item-harm-font",
      name: "Harmful Font",
      type: "classFeature",
      system: { traits: { value: ["cleric"] } },
      flags: { fusion: { build: { level: 1, slot: "divineFont-1" } } },
    };
    const featItem = {
      ...harmingHands,
      _id: "item-harming-hands",
      flags: { fusion: { build: { level: 2, slot: "classFeat-2" } } },
    };
    expect(
      checkFeatPrerequisites(featItem, [harmFontItem, featItem], undefined, 2),
    ).toBeUndefined();
  });
});
