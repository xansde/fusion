/**
 * class-levels-plan.test.ts — the Plan surface of the multiclass variant.
 *
 * The load-bearing rule here is the table's, not the spec's: a NEW class may
 * only enter at level 1 or at an EVEN level; odd levels must continue a class
 * already on the sheet. It is enforced in two places on purpose (picker and
 * op builder), and both are pinned here — an op builder that trusts the UI to
 * have filtered correctly is one bug away from writing an illegal build.
 *
 * Ops are validated against the real wire schemas, like the rest of planVM's
 * suite.
 *
 * Spec: 30-multiclasse-por-niveis.md §6.2, §6.9 (REQ-MCL-001/010/011/081).
 */

import { describe, it, expect } from "vitest";
import {
  derivePlan,
  planContext,
  canTakeNewClassAt,
  classOptionsAt,
  classesOnSheet,
  classLevelTally,
  chooseClassLevel,
  setClassLevelsVariant,
  getClassLevelsVariant,
  resolveClassRef,
  type PlanOpBuilderContext,
} from "../planVM.js";
import { DocCreatePayloadSchema, DocUpdatePayloadSchema } from "@fusion/shared";

/**
 * The op builders emit the CLIENT shape (`{type, documentType, id, diff}`);
 * the wire schema takes a batched `{documentType, updates:[{_id, diff}]}`.
 * Same conversion the rest of planVM's suite does before validating.
 */
function asWireUpdate(op: unknown): unknown {
  const o = op as { documentType: string; id: string; diff: Record<string, unknown> };
  return { documentType: o.documentType, updates: [{ _id: o.id, diff: o.diff }] };
}

/** Same, for creates: the wire batches `data` into an array. */
function asWireCreate(op: unknown): unknown {
  const o = op as { documentType: string; data: unknown; parent: unknown };
  return { documentType: o.documentType, data: [o.data], parent: o.parent };
}

const FIGHTER_SRC = "8zn3cD6GSmoo1LW4";
const MAGUS_SRC = "HQBA9Yx2s8ycvz3C";

function fighterClassDoc(): Record<string, unknown> {
  return {
    _id: "pack-fighter",
    name: "Fighter",
    type: "class",
    flags: { fusion: { sourceId: FIGHTER_SRC } },
    system: {
      hp: 10,
      keyAbility: ["str"],
      featLevels: { class: [1, 2, 4, 6], ancestry: [1, 5], general: [3], skill: [2, 4] },
      featuresByLevel: [{ level: 1, uuid: "u-reactive", name: "Reactive Strike" }],
      trainedSkills: { value: ["athletics"], additional: 3 },
    },
  };
}

function magusClassDoc(): Record<string, unknown> {
  return {
    _id: "pack-magus",
    name: "Magus",
    type: "class",
    flags: { fusion: { sourceId: MAGUS_SRC } },
    system: {
      hp: 8,
      keyAbility: ["int"],
      featLevels: { class: [1, 2, 4, 6], ancestry: [1, 5], general: [3], skill: [2, 4] },
      featuresByLevel: [{ level: 1, uuid: "u-spellstrike", name: "Spellstrike" }],
      trainedSkills: { value: ["arcana"], additional: 2 },
      spellcasting: {
        tradition: "arcane",
        type: "prepared",
        ability: "int",
        cantripsKnown: [{ level: 1, count: 5 }],
        slots: [{ level: 1, slots: { "1": 1 } }],
      },
    },
  };
}

/**
 * Magus WITH its level-1 "Conflux Spells" focus feature — `magusClassDoc()`
 * above deliberately omits it (its own tests don't need focus). Additive
 * fixture for issue #5's 3rd call site: multiclassing into a class whose
 * OWN level-1 feature opens a focus pool (`hasFocusFeature`/
 * `resolveClassFocusGrant`), same recognition `applyClass` already used —
 * `chooseClassLevel` never called it before this fix.
 */
function magusClassDocWithFocus(): Record<string, unknown> {
  const doc = magusClassDoc();
  const system = doc["system"] as Record<string, unknown>;
  return {
    ...doc,
    system: {
      ...system,
      featuresByLevel: [
        ...(system["featuresByLevel"] as unknown[]),
        { level: 1, uuid: "u-conflux", name: "Conflux Spells" },
      ],
    },
  };
}

/** An actor with the given embedded class items and build block. */
function actorDoc(
  level: number,
  classDocs: Array<Record<string, unknown>>,
  build: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: "actor-torvin",
    name: "Torvin",
    type: "character",
    items: classDocs.map((doc, i) => ({ ...doc, _id: `item-class-${String(i)}` })),
    system: {
      level: { value: level },
      details: {},
      build: { abilities: {}, choices: [], ...build },
    },
  };
}

function opCtx(doc: Record<string, unknown>): PlanOpBuilderContext {
  return { ...planContext(doc), actorId: "actor-torvin", editable: true, doc };
}

/** classLevel choices assigning each level to a class sourceId. */
function split(levels: Record<number, string>): Array<Record<string, unknown>> {
  return Object.entries(levels).map(([level, ref]) => ({
    level: Number(level),
    slot: `classLevel-${level}`,
    type: "classLevel",
    ref,
  }));
}

// ---------------------------------------------------------------------------
// The table's rule
// ---------------------------------------------------------------------------

describe("canTakeNewClassAt — a new class enters at 1 or at an even level", () => {
  it("allows level 1 (the first class)", () => {
    expect(canTakeNewClassAt(1)).toBe(true);
  });

  it("allows every even level", () => {
    for (const level of [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]) {
      expect(canTakeNewClassAt(level)).toBe(true);
    }
  });

  it("refuses every odd level above 1", () => {
    for (const level of [3, 5, 7, 9, 11, 13, 15, 17, 19]) {
      expect(canTakeNewClassAt(level)).toBe(false);
    }
  });
});

describe("classOptionsAt — what the picker may offer", () => {
  const doc = actorDoc(6, [fighterClassDoc(), magusClassDoc()], {
    variantRules: { classLevels: true },
    choices: split({ 1: FIGHTER_SRC, 2: FIGHTER_SRC, 3: MAGUS_SRC }),
  });

  it("returns null (no restriction) on levels that admit a new class", () => {
    expect(classOptionsAt(doc, 1)).toBeNull();
    expect(classOptionsAt(doc, 2)).toBeNull();
    expect(classOptionsAt(doc, 6)).toBeNull();
  });

  it("restricts odd levels to the classes already on the sheet", () => {
    const options = classOptionsAt(doc, 5);
    expect(options).not.toBeNull();
    expect(options?.map((o) => o.sourceId).sort()).toEqual([FIGHTER_SRC, MAGUS_SRC].sort());
  });

  it("offers only the single class when the sheet has one, on an odd level", () => {
    const single = actorDoc(3, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC, 2: FIGHTER_SRC }),
    });
    expect(classOptionsAt(single, 3)?.map((o) => o.sourceId)).toEqual([FIGHTER_SRC]);
  });
});

describe("classesOnSheet — identity by sourceId, never by name", () => {
  it("lists each distinct class once", () => {
    const doc = actorDoc(6, [fighterClassDoc(), magusClassDoc()]);
    expect(classesOnSheet(doc).map((c) => c.sourceId)).toEqual([FIGHTER_SRC, MAGUS_SRC]);
  });

  it("does not merge two classes that happen to share a name", () => {
    const homonym = {
      ...magusClassDoc(),
      name: "Fighter",
      flags: { fusion: { sourceId: "other" } },
    };
    const doc = actorDoc(6, [fighterClassDoc(), homonym]);
    expect(classesOnSheet(doc)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The Plan surface
// ---------------------------------------------------------------------------

describe("derivePlan — the classLevel slot", () => {
  it("does not appear with the variant off", () => {
    const plan = derivePlan(actorDoc(3, [fighterClassDoc()]));
    for (const level of plan.levels) {
      expect(level.slots.some((s) => s.type === "classLevel")).toBe(false);
    }
  });

  it("appears once per level with the variant on, as the FIRST slot", () => {
    const plan = derivePlan(
      actorDoc(3, [fighterClassDoc()], { variantRules: { classLevels: true } }),
    );
    expect(plan.levels).toHaveLength(3);
    for (const level of plan.levels) {
      expect(level.slots[0]?.type).toBe("classLevel");
    }
  });

  it("shows the running CLASS level, not the character level", () => {
    // Fighter at 1, 2 and 4; Magus at 3. At character level 4 the Fighter is
    // on its 3rd class level — that is the number that gates its features.
    const plan = derivePlan(
      actorDoc(4, [fighterClassDoc(), magusClassDoc()], {
        variantRules: { classLevels: true },
        choices: split({ 1: FIGHTER_SRC, 2: FIGHTER_SRC, 3: MAGUS_SRC, 4: FIGHTER_SRC }),
      }),
    );
    const labels = plan.levels.map((l) => l.slots.find((s) => s.type === "classLevel")?.choiceName);
    expect(labels).toEqual(["Fighter 1", "Fighter 2", "Magus 1", "Fighter 3"]);
  });

  it("leaves the slot unfilled where no class was assigned", () => {
    const plan = derivePlan(
      actorDoc(2, [fighterClassDoc()], {
        variantRules: { classLevels: true },
        choices: split({ 1: FIGHTER_SRC }),
      }),
    );
    expect(plan.levels[0]?.slots[0]?.filled).toBe(true);
    expect(plan.levels[1]?.slots[0]?.filled).toBe(false);
  });
});

describe("classLevelTally", () => {
  it("counts only up to the level asked for", () => {
    const choices = [
      { level: 1, slot: "classLevel-1", type: "classLevel", ref: FIGHTER_SRC },
      { level: 2, slot: "classLevel-2", type: "classLevel", ref: FIGHTER_SRC },
      { level: 3, slot: "classLevel-3", type: "classLevel", ref: MAGUS_SRC },
    ];
    expect(classLevelTally(choices, 2).get(FIGHTER_SRC)).toBe(2);
    expect(classLevelTally(choices, 2).get(MAGUS_SRC)).toBeUndefined();
    expect(classLevelTally(choices, 3).get(MAGUS_SRC)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Op builders
// ---------------------------------------------------------------------------

describe("chooseClassLevel", () => {
  it("records the choice without a new item when the class is already on the sheet", () => {
    const doc = actorDoc(3, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC, 2: FIGHTER_SRC }),
    });
    const ops = chooseClassLevel(opCtx(doc), 3, fighterClassDoc());

    expect(ops.filter((o) => o.type === "doc:create")).toHaveLength(0);
    const update = ops.find((o) => o.type === "doc:update");
    expect(DocUpdatePayloadSchema.safeParse(asWireUpdate(update)).success).toBe(true);
    const choices = (update as { diff: Record<string, unknown> }).diff[
      "system.build.choices"
    ] as Array<Record<string, unknown>>;
    expect(choices).toContainEqual({
      level: 3,
      slot: "classLevel-3",
      type: "classLevel",
      ref: FIGHTER_SRC,
    });
  });

  it("materializes the class item when the class is NEW", () => {
    const doc = actorDoc(2, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC }),
    });
    const ops = chooseClassLevel(opCtx(doc), 2, magusClassDoc());

    const creates = ops.filter((o) => o.type === "doc:create");
    expect(creates.length).toBeGreaterThanOrEqual(1);
    for (const op of creates) {
      expect(DocCreatePayloadSchema.safeParse(asWireCreate(op)).success).toBe(true);
    }
    const classCreate = creates.find(
      (o) => (o as { data: Record<string, unknown> }).data["type"] === "class",
    );
    expect(classCreate).toBeDefined();
  });

  it("does NOT replace the existing class — both coexist (REQ-MCL-011)", () => {
    const doc = actorDoc(2, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC }),
    });
    const ops = chooseClassLevel(opCtx(doc), 2, magusClassDoc());
    // A replacement would delete the Fighter item first; taking a second class
    // must never do that.
    expect(ops.some((o) => o.type === "doc:delete")).toBe(false);
  });

  it("tags a new caster's spellcasting entry with classKey", () => {
    const doc = actorDoc(2, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC }),
    });
    const ops = chooseClassLevel(opCtx(doc), 2, magusClassDoc());
    const entry = ops.find(
      (o) =>
        o.type === "doc:create" &&
        (o as { data: Record<string, unknown> }).data["type"] === "spellcastingEntry",
    ) as { data: Record<string, unknown> } | undefined;
    expect(entry).toBeDefined();
    const flags = entry?.data["flags"] as Record<string, unknown>;
    const fusion = flags["fusion"] as Record<string, unknown>;
    // Without this the server refuses to guess which class the entry belongs
    // to once there are two casting classes — by design.
    expect(fusion["classKey"]).toBe(MAGUS_SRC);
  });

  it("issue #5 (multiclass): a second class with a level-1 focus feature also opens its own classKey-tagged focus pool", () => {
    const doc = actorDoc(2, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC }),
    });
    const ops = chooseClassLevel(opCtx(doc), 2, magusClassDocWithFocus());

    const focusEntry = ops.find(
      (o) =>
        o.type === "doc:create" &&
        (o as { data: Record<string, unknown> }).data["name"] === "Focus Spells",
    ) as { data: Record<string, unknown> } | undefined;
    expect(focusEntry).toBeDefined();
    const flags = focusEntry?.data["flags"] as Record<string, unknown>;
    const fusion = flags["fusion"] as Record<string, unknown>;
    // Same reasoning as the spellcasting entry above: without classKey the
    // server can't attribute this focus entry to the SECOND class.
    expect(fusion["classKey"]).toBe(MAGUS_SRC);
    const sys = focusEntry?.data["system"] as Record<string, unknown>;
    expect(sys["isFocusPool"]).toBe(true);
    expect((sys["tradition"] as Record<string, unknown>)["value"]).toBe("arcane");
    expect((sys["ability"] as Record<string, unknown>)["value"]).toBe("int");

    const poolUpdate = ops.find(
      (o) =>
        o.type === "doc:update" &&
        (o as { diff: Record<string, unknown> }).diff["system.resources.focusPoints.value"] !==
          undefined,
    );
    expect(poolUpdate).toBeDefined();
    expect((poolUpdate as { diff: Record<string, unknown> }).diff).toEqual({
      "system.resources.focusPoints.value": 1,
      "system.resources.focusPoints.max": 1,
    });
  });

  it("issue #5 (multiclass): does NOT re-open the pool when the actor already has a focus entry", () => {
    const doc = actorDoc(2, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC }),
    });
    // Simulates a focus entry already opened by some other source (e.g. the
    // primary class) — its spent points must survive this pick untouched.
    (doc["items"] as Array<Record<string, unknown>>).push({
      _id: "existing-focus",
      name: "Focus Spells",
      type: "spellcastingEntry",
      system: { isFocusPool: true, tradition: { value: "divine" }, ability: { value: "cha" } },
    });
    const ops = chooseClassLevel(opCtx(doc), 2, magusClassDocWithFocus());
    const poolUpdate = ops.find(
      (o) =>
        o.type === "doc:update" &&
        (o as { diff: Record<string, unknown> }).diff["system.resources.focusPoints.value"] !==
          undefined,
    );
    expect(poolUpdate).toBeUndefined();
  });

  it("issue #5 (multiclass): a second class with NO focus feature (Fighter) opens no focus pool", () => {
    const doc = actorDoc(2, [magusClassDocWithFocus()], {
      variantRules: { classLevels: true },
      choices: split({ 1: MAGUS_SRC }),
    });
    const ops = chooseClassLevel(opCtx(doc), 2, fighterClassDoc());
    const focusEntry = ops.find(
      (o) =>
        o.type === "doc:create" &&
        (o as { data: Record<string, unknown> }).data["name"] === "Focus Spells",
    );
    expect(focusEntry).toBeUndefined();
  });

  it("REFUSES a new class on an odd level, even if the UI asks", () => {
    const doc = actorDoc(3, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC, 2: FIGHTER_SRC }),
    });
    expect(chooseClassLevel(opCtx(doc), 3, magusClassDoc())).toEqual([]);
  });

  it("allows CONTINUING an existing class on an odd level", () => {
    const doc = actorDoc(3, [fighterClassDoc(), magusClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC, 2: MAGUS_SRC }),
    });
    expect(chooseClassLevel(opCtx(doc), 3, magusClassDoc()).length).toBeGreaterThan(0);
  });

  it("replaces the previous choice for the same level instead of duplicating", () => {
    const doc = actorDoc(2, [fighterClassDoc(), magusClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC, 2: FIGHTER_SRC }),
    });
    const ops = chooseClassLevel(opCtx(doc), 2, magusClassDoc());
    const update = ops.find((o) => o.type === "doc:update") as {
      diff: Record<string, unknown>;
    };
    const choices = update.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices.filter((c) => c["slot"] === "classLevel-2")).toHaveLength(1);
    expect(choices.find((c) => c["slot"] === "classLevel-2")?.["ref"]).toBe(MAGUS_SRC);
  });

  it("does nothing when the sheet is not editable", () => {
    const doc = actorDoc(2, [fighterClassDoc()], { variantRules: { classLevels: true } });
    const ctx = { ...opCtx(doc), editable: false };
    expect(chooseClassLevel(ctx, 2, magusClassDoc())).toEqual([]);
  });
});

describe("setClassLevelsVariant", () => {
  it("turns the flag on", () => {
    const doc = actorDoc(3, [fighterClassDoc()]);
    const op = setClassLevelsVariant(opCtx(doc), true);
    expect(DocUpdatePayloadSchema.safeParse(asWireUpdate(op)).success).toBe(true);
    expect(op?.diff["system.build.variantRules.classLevels"]).toBe(true);
  });

  it("seeds the split with the existing class so nothing is lost (REQ-MCL-003)", () => {
    const doc = actorDoc(3, [fighterClassDoc()]);
    const op = setClassLevelsVariant(opCtx(doc), true);
    const choices = op?.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(3);
    expect(choices.every((c) => c["ref"] === FIGHTER_SRC)).toBe(true);
    expect(choices.map((c) => c["level"])).toEqual([1, 2, 3]);
  });

  it("does not re-seed when a split already exists", () => {
    const doc = actorDoc(3, [fighterClassDoc(), magusClassDoc()], {
      choices: split({ 1: FIGHTER_SRC, 2: MAGUS_SRC, 3: MAGUS_SRC }),
    });
    const op = setClassLevelsVariant(opCtx(doc), true);
    expect(op?.diff["system.build.choices"]).toBeUndefined();
  });

  it("turning it off keeps the split, so flipping back does not lose the plan", () => {
    const doc = actorDoc(3, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC, 2: FIGHTER_SRC, 3: FIGHTER_SRC }),
    });
    const op = setClassLevelsVariant(opCtx(doc), false);
    expect(op?.diff["system.build.variantRules.classLevels"]).toBe(false);
    expect(op?.diff["system.build.choices"]).toBeUndefined();
  });

  it("getClassLevelsVariant reads the flag, defaulting to off", () => {
    expect(getClassLevelsVariant({ build: {} })).toBe(false);
    expect(getClassLevelsVariant({})).toBe(false);
    expect(getClassLevelsVariant({ build: { variantRules: { classLevels: true } } })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ref shapes — the client must read what the server reads
// ---------------------------------------------------------------------------

describe("resolveClassRef — tolerant, like the server's matchClass", () => {
  it("resolves a bare sourceId (what chooseClassLevel writes)", () => {
    const doc = actorDoc(2, [fighterClassDoc()]);
    expect(resolveClassRef(FIGHTER_SRC, classesOnSheet(doc))?.name).toBe("Fighter");
  });

  it("resolves a full compendium uuid ending in the sourceId", () => {
    const doc = actorDoc(2, [fighterClassDoc()]);
    const uuid = `Compendium.fusion.classes-core.${FIGHTER_SRC}`;
    expect(resolveClassRef(uuid, classesOnSheet(doc))?.name).toBe("Fighter");
  });

  it("returns undefined for a ref that matches nothing", () => {
    const doc = actorDoc(2, [fighterClassDoc()]);
    expect(
      resolveClassRef("Compendium.fusion.classes-core.nope", classesOnSheet(doc)),
    ).toBeUndefined();
  });

  it("labels the slot with the class NAME even when the ref is a uuid", () => {
    // Regression: a sheet seeded with uuid refs printed the raw uuid at the
    // player instead of "Guerreiro 1".
    const plan = derivePlan(
      actorDoc(2, [fighterClassDoc()], {
        variantRules: { classLevels: true },
        choices: [
          {
            level: 1,
            slot: "classLevel-1",
            type: "classLevel",
            ref: `Compendium.fusion.classes-core.${FIGHTER_SRC}`,
          },
          {
            level: 2,
            slot: "classLevel-2",
            type: "classLevel",
            ref: `Compendium.fusion.classes-core.${FIGHTER_SRC}`,
          },
        ],
      }),
    );
    const labels = plan.levels.map((l) => l.slots.find((s) => s.type === "classLevel")?.choiceName);
    expect(labels).toEqual(["Fighter 1", "Fighter 2"]);
  });
});

// ---------------------------------------------------------------------------
// Live defects (argiburgo, Torvin) — pinned so they cannot come back
// ---------------------------------------------------------------------------

describe("no duplicate class item (live defect: Cleric twice)", () => {
  it("does not create a second item for a class already recorded in the choices", () => {
    // The doc snapshot is STALE: the choice for level 1 already names the
    // Magus, but the item it created has not landed on `items` yet — exactly
    // what two quick picks in a row look like.
    const doc = actorDoc(2, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: MAGUS_SRC }),
    });
    const ops = chooseClassLevel(opCtx(doc), 2, magusClassDoc());
    const classCreates = ops.filter(
      (o) =>
        o.type === "doc:create" &&
        (o as { data: Record<string, unknown> }).data["type"] === "class",
    );
    expect(classCreates).toHaveLength(0);
  });

  it("still creates the item the FIRST time the class appears", () => {
    const doc = actorDoc(2, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_SRC }),
    });
    const ops = chooseClassLevel(opCtx(doc), 2, magusClassDoc());
    const classCreates = ops.filter(
      (o) =>
        o.type === "doc:create" &&
        (o as { data: Record<string, unknown> }).data["type"] === "class",
    );
    expect(classCreates).toHaveLength(1);
  });

  it("records the choice either way", () => {
    const doc = actorDoc(2, [fighterClassDoc()], {
      variantRules: { classLevels: true },
      choices: split({ 1: MAGUS_SRC }),
    });
    const update = chooseClassLevel(opCtx(doc), 2, magusClassDoc()).find(
      (o) => o.type === "doc:update",
    ) as { diff: Record<string, unknown> };
    const choices = update.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices.find((c) => c["slot"] === "classLevel-2")?.["ref"]).toBe(MAGUS_SRC);
  });
});

describe("features come from the class that bought the level", () => {
  it("gives Magus's LEVEL-1 package when the Magus enters at character level 2", () => {
    const plan = derivePlan(
      actorDoc(2, [fighterClassDoc(), magusClassDoc()], {
        variantRules: { classLevels: true },
        choices: split({ 1: FIGHTER_SRC, 2: MAGUS_SRC }),
      }),
    );
    // Level 2 is the Magus's FIRST class level, so it shows Spellstrike (the
    // Magus's level-1 feature) — not the Fighter's, and not the Magus's
    // level-2 package.
    const names = plan.levels[1]?.autoFeatures.map((f) => f.name) ?? [];
    expect(names).toContain("Spellstrike");
    expect(names).not.toContain("Reactive Strike");
  });

  it("keeps the Fighter's level-1 features on the level the Fighter bought", () => {
    const plan = derivePlan(
      actorDoc(2, [fighterClassDoc(), magusClassDoc()], {
        variantRules: { classLevels: true },
        choices: split({ 1: FIGHTER_SRC, 2: MAGUS_SRC }),
      }),
    );
    expect(plan.levels[0]?.autoFeatures.map((f) => f.name)).toContain("Reactive Strike");
  });

  it("offers a class feat at level 1 and on even levels, not on odd ones", () => {
    const plan = derivePlan(
      actorDoc(5, [fighterClassDoc(), magusClassDoc()], {
        variantRules: { classLevels: true },
        choices: split({
          1: FIGHTER_SRC,
          2: MAGUS_SRC,
          3: MAGUS_SRC,
          4: FIGHTER_SRC,
          5: FIGHTER_SRC,
        }),
      }),
    );
    const hasClassFeat = plan.levels.map((l) => l.slots.some((s) => s.type === "classFeat"));
    // A new class entering must not hand out an extra class feat: the cadence
    // stays on the character level (1, 2, 4, …).
    expect(hasClassFeat).toEqual([true, true, false, true, false]);
  });
});
