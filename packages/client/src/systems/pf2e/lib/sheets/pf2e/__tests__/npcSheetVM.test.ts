/**
 * npcSheetVM.test.ts — Unit tests for NpcSheetVM.
 *
 * Tests are 100% headless (no PIXI, no Svelte, no browser APIs).
 * REQ-PF2-111.
 */

import { describe, it, expect } from "vitest";
import { NpcSheetVM } from "../npcSheetVM.js";
import { OwnershipLevel } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNpc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "npc-001",
    name: "Goblin Warrior",
    img: "img/goblin.webp",
    type: "npc",
    items: [
      {
        _id: "melee-dogslicer",
        name: "Dogslicer",
        type: "melee",
        system: {
          bonus: 7,
          damage: [{ formula: "1d6", damageType: "slashing" }],
          traits: { value: ["agile", "backstabber"] },
        },
      },
      {
        _id: "action-goblin-scuttle",
        name: "Goblin Scuttle",
        type: "action",
        system: {
          actionType: { value: "reaction" },
          actions: { value: 0 },
          traits: { value: ["goblin"] },
          description: { value: "The goblin moves to a flanking position." },
        },
      },
      {
        _id: "cond-frightened",
        name: "Frightened",
        type: "condition",
        system: { slug: "frightened", value: 1 },
      },
    ],
    system: {
      level: { value: -1 },
      attributes: {
        hp: { value: 6, max: 6, temp: 0, details: "" },
        ac: { value: 16, details: "" },
        speed: { value: 25 },
        perception: { mod: 5, senses: [], details: "" },
        iwr: { immunities: [], weaknesses: [], resistances: [] },
        fortitude: { value: 4 },
        reflex: { value: 8 },
        will: { value: 1 },
      },
      skills: {
        stealth: { value: 7, label: "Stealth" },
        acrobatics: { value: 5, label: "Acrobatics" },
      },
      derived: {
        ac: { total: 16, modifiers: [] },
        hp: { value: 6, max: 6, temp: 0 },
        perception: { total: 5, modifiers: [] },
        saves: {
          fortitude: { total: 4, modifiers: [] },
          reflex: { total: 8, modifiers: [] },
          will: { total: 1, modifiers: [] },
        },
        skills: {
          stealth: { total: 7, modifiers: [] },
          acrobatics: { total: 5, modifiers: [] },
        },
      },
    },
    ...overrides,
  };
}

function makeVM(
  docOverrides: Record<string, unknown> = {},
  opts: { ownership?: number; isGm?: boolean } = {},
): NpcSheetVM {
  return new NpcSheetVM({
    doc: makeNpc(docOverrides),
    actorId: "npc-001",
    ownership: opts.ownership ?? OwnershipLevel.OWNER,
    isGm: opts.isGm ?? true,
  });
}

// ---------------------------------------------------------------------------
// Basic fields
// ---------------------------------------------------------------------------

describe("NpcSheetVM — basic fields", () => {
  it("reads name", () => {
    expect(makeVM().name).toBe("Goblin Warrior");
  });

  it("REQ-CMP-055: the header resolves the pt-BR snapshot when the actor was imported with one (A041)", () => {
    const vm = makeVM({
      name: "Eagle",
      flags: {
        fusion: {
          packName: "bestiary",
          sourceId: "eagle-001",
          i18n: { "pt-BR": { name: "Águia" } },
        },
      },
    });
    expect(vm.name).toBe("Águia");
  });

  it("REQ-CMP-055: falls back to the EN doc.name when the actor was imported before the flag existed", () => {
    const vm = makeVM({
      name: "Eagle",
      flags: { fusion: { packName: "bestiary", sourceId: "eagle-001" } },
    });
    expect(vm.name).toBe("Eagle");
  });

  it("reads level", () => {
    expect(makeVM().level).toBe(-1);
  });

  it("reads img", () => {
    expect(makeVM().img).toBe("img/goblin.webp");
  });
});

// ---------------------------------------------------------------------------
// HP
// ---------------------------------------------------------------------------

describe("NpcSheetVM — HP", () => {
  it("returns hp from derived", () => {
    const vm = makeVM();
    expect(vm.hpCurrent).toBe(6);
    expect(vm.hpMax).toBe(6);
  });

  it("falls back to attributes.hp when no derived", () => {
    const doc = makeNpc();
    (doc["system"] as Record<string, unknown>)["derived"] = undefined;
    const vm = new NpcSheetVM({
      doc,
      actorId: "npc-001",
      ownership: OwnershipLevel.OWNER,
      isGm: true,
    });
    expect(vm.hpCurrent).toBe(6);
    expect(vm.hpMax).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// AC
// ---------------------------------------------------------------------------

describe("NpcSheetVM — AC", () => {
  it("returns AC from derived", () => {
    const vm = makeVM();
    expect(vm.ac.total).toBe(16);
    expect(vm.ac.totalFormatted).toBe("16");
  });
});

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------

describe("NpcSheetVM — perception", () => {
  it("returns perception from derived", () => {
    const vm = makeVM();
    expect(vm.perception.total).toBe(5);
    expect(vm.perception.totalFormatted).toBe("+5");
  });

  it("falls back to attributes.perception.mod when no derived", () => {
    const doc = makeNpc();
    (doc["system"] as Record<string, unknown>)["derived"] = undefined;
    const vm = new NpcSheetVM({ doc, actorId: "n", ownership: OwnershipLevel.OWNER, isGm: true });
    expect(vm.perception.total).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

describe("NpcSheetVM — saves", () => {
  it("returns 3 save rows", () => {
    expect(makeVM().saves).toHaveLength(3);
  });

  it("returns fortitude from derived", () => {
    const fort = makeVM().saves.find((s) => s.label === "Fortitude")!;
    expect(fort.total).toBe(4);
    expect(fort.totalFormatted).toBe("+4");
  });

  it("returns reflex from derived", () => {
    const ref = makeVM().saves.find((s) => s.label === "Reflex")!;
    expect(ref.total).toBe(8);
    expect(ref.totalFormatted).toBe("+8");
  });
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

describe("NpcSheetVM — skills", () => {
  it("returns skills from derived", () => {
    const vm = makeVM();
    const stealth = vm.skills.find((s) => s.slug === "stealth")!;
    expect(stealth.total).toBe(7);
    expect(stealth.totalFormatted).toBe("+7");
    expect(stealth.label).toBe("Stealth");
  });
});

// ---------------------------------------------------------------------------
// Strikes
// ---------------------------------------------------------------------------

describe("NpcSheetVM — strikes", () => {
  it("returns strikes from melee items", () => {
    const vm = makeVM();
    expect(vm.strikes).toHaveLength(1);
    const dogslicer = vm.strikes[0]!;
    expect(dogslicer.name).toBe("Dogslicer");
    expect(dogslicer.bonus).toBe(7);
    expect(dogslicer.bonusFormatted).toBe("+7");
  });

  it("includes damage entries", () => {
    const strike = makeVM().strikes[0]!;
    expect(strike.damageEntries).toHaveLength(1);
    expect(strike.damageEntries[0]!.formula).toBe("1d6");
    expect(strike.damageEntries[0]!.damageType).toBe("slashing");
  });

  it("includes traits", () => {
    const strike = makeVM().strikes[0]!;
    expect(strike.traits).toContain("agile");
    expect(strike.traits).toContain("backstabber");
  });

  it("rollStrike builds correct op", () => {
    const vm = makeVM();
    const op = vm.rollStrike("melee-dogslicer");
    expect(op.type).toBe("roll:check");
    expect(op.formula).toBe("1d20 + 7");
    expect(op.context["type"]).toBe("strike");
    expect(op.context["label"]).toBe("Dogslicer");
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe("NpcSheetVM — actions", () => {
  it("returns actions from action items", () => {
    const vm = makeVM();
    expect(vm.actions).toHaveLength(1);
    const scuttle = vm.actions[0]!;
    expect(scuttle.name).toBe("Goblin Scuttle");
    expect(scuttle.actionCost).toBe("R");
    expect(scuttle.traits).toContain("goblin");
  });
});

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

describe("NpcSheetVM — conditions", () => {
  it("returns active conditions", () => {
    const vm = makeVM();
    expect(vm.conditions).toHaveLength(1);
    const frightened = vm.conditions[0]!;
    expect(frightened.slug).toBe("frightened");
    expect(frightened.value).toBe(1);
    expect(frightened.itemId).toBe("cond-frightened");
  });

  // T034: same migration as characterSheetVM — the dot-path operators these
  // used to assert were never implemented server-side.
  it("toggleCondition removes existing condition via embedded delete", () => {
    const vm = makeVM();
    const op = vm.toggleCondition("frightened");
    expect(op).not.toBeNull();
    expect(op).toMatchObject({
      type: "doc:delete",
      documentType: "Item",
      id: "cond-frightened",
      parent: { type: "Actor" },
    });
  });

  it("toggleCondition adds new condition via embedded create", () => {
    const vm = makeVM();
    const op = vm.toggleCondition("prone");
    expect(op).not.toBeNull();
    expect(op).toMatchObject({
      type: "doc:create",
      documentType: "Item",
      data: { type: "condition", system: { slug: "prone" } },
      parent: { type: "Actor" },
    });
    if (op?.type !== "doc:create") throw new Error("expected a doc:create op");
    const system = op.data["system"] as Record<string, unknown>;
    expect("value" in system).toBe(false);
  });

  it("toggleCondition returns null when not editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.toggleCondition("prone")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Roll ops
// ---------------------------------------------------------------------------

describe("NpcSheetVM — roll ops", () => {
  it("rollPerception returns correct formula", () => {
    const op = makeVM().rollPerception();
    expect(op.formula).toBe("1d20 + 5");
    expect(op.context["type"]).toBe("perception");
  });

  it("rollSave reflex returns correct formula", () => {
    const op = makeVM().rollSave("reflex");
    expect(op.formula).toBe("1d20 + 8");
  });

  it("rollSkill stealth returns correct formula", () => {
    const op = makeVM().rollSkill("stealth");
    expect(op.formula).toBe("1d20 + 7");
    expect(op.context["skill"]).toBe("stealth");
  });
});

// ---------------------------------------------------------------------------
// HP delta / field update
// ---------------------------------------------------------------------------

describe("NpcSheetVM — editing ops", () => {
  it("applyHpDelta clamps at max", () => {
    const op = makeVM().applyHpDelta(100);
    expect(op!.diff["system.attributes.hp.value"]).toBe(6);
  });

  it("applyHpDelta clamps at 0", () => {
    const op = makeVM().applyHpDelta(-100);
    expect(op!.diff["system.attributes.hp.value"]).toBe(0);
  });

  it("fieldUpdate returns diff for editable", () => {
    const op = makeVM().fieldUpdate("system.attributes.hp.value", 3);
    expect(op!.diff["system.attributes.hp.value"]).toBe(3);
  });

  it("fieldUpdate returns null for non-editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.fieldUpdate("system.attributes.hp.value", 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

describe("NpcSheetVM — permission", () => {
  it("editable is true for GM", () => {
    expect(makeVM({}, { isGm: true, ownership: OwnershipLevel.NONE }).editable).toBe(true);
  });

  it("editable is true for OWNER", () => {
    expect(makeVM({}, { isGm: false, ownership: OwnershipLevel.OWNER }).editable).toBe(true);
  });

  it("editable is false for OBSERVER", () => {
    expect(makeVM({}, { isGm: false, ownership: OwnershipLevel.OBSERVER }).editable).toBe(false);
  });
});
