/**
 * petsVM.test.ts — Pets tab view-model tests (r16-G4, spec 29).
 *
 * Acceptance fixture: Tobias, Ratfolk Magus 3 with the Rat Familiar feat
 * (`familiarAbilities` upgrade-to-2) — must yield a 4-ability budget, a
 * level-3 master snapshot (HP 15 on the created familiar), and correct
 * create/link/toggle/HP ops.
 */

import { describe, it, expect } from "vitest";
import {
  detectFamiliarGrant,
  buildMasterSnapshot,
  masterAbilityMod,
  buildCreateFamiliarOp,
  buildToggleAbilityOp,
  buildSetHpOp,
  buildRenameOp,
  buildMasterRefreshOp,
  linkedFamiliars,
  readFamiliar,
  filterAbilityRows,
  FAMILIAR_ABILITY_BASE,
  type AbilityRow,
} from "../petsVM.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Tobias, Ratfolk Magus 3 with the Rat Familiar ancestry feat. */
function tobias(): Record<string, unknown> {
  return {
    _id: "tob0123456789abc",
    name: "Tobias",
    type: "character",
    ownership: { default: 0, u1: 3 },
    system: {
      level: { value: 3 },
      details: { keyAbility: "int", class: "Magus", ancestry: "Ratfolk" },
      derived: {
        abilityMods: { str: 0, dex: 3, con: 1, int: 4, wis: 1, cha: 0 },
        ac: { total: 19 },
        saves: { fortitude: { total: 8 }, reflex: { total: 10 }, will: { total: 7 } },
        perception: { total: 9 },
      },
    },
    items: [
      {
        _id: "featrat000000001",
        type: "feat",
        name: "Rat Familiar",
        system: {
          category: "ancestry",
          rules: [
            {
              kind: "set-property",
              selector: "system.attributes.familiarAbilities.value",
              value: 2,
              mode: "upgrade",
            },
          ],
        },
      },
    ],
  };
}

/** A familiar Actor already linked to Tobias. */
function pickpocket(masterId = "tob0123456789abc"): Record<string, unknown> {
  return {
    _id: "fam0000000000001",
    name: "Pickpocket",
    type: "familiar",
    system: {
      companionKind: "familiar",
      masterActorId: masterId,
      appearance: "a scruffy black rat",
      attributes: { hp: { value: 15, max: 15, temp: 0 } },
      abilitiesBudget: { value: 4, max: 4 },
      selectedAbilities: ["darkvision", "climber"],
      derived: {
        hp: { value: 15, max: 15, temp: 0 },
        ac: { total: 19 },
        perception: { total: 9 },
        saves: { fortitude: { total: 8 }, reflex: { total: 10 }, will: { total: 7 } },
        attack: { total: 7 },
        speed: { value: 25, otherSpeeds: [] },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// detectFamiliarGrant
// ---------------------------------------------------------------------------

describe("detectFamiliarGrant", () => {
  it("detects Rat Familiar and computes a 4-ability budget (base 2 + bump 2)", () => {
    const { canHaveFamiliar, abilityBudget } = detectFamiliarGrant(tobias());
    expect(canHaveFamiliar).toBe(true);
    expect(abilityBudget).toBe(4);
  });

  it("returns no familiar and base budget for a character without the feat", () => {
    const plain = { _id: "x", type: "character", system: {}, items: [] };
    const { canHaveFamiliar, abilityBudget } = detectFamiliarGrant(plain);
    expect(canHaveFamiliar).toBe(false);
    expect(abilityBudget).toBe(FAMILIAR_ABILITY_BASE);
  });

  it("detects a curated feat name even without a familiarAbilities rule", () => {
    const withFamiliarFeat = {
      _id: "x",
      type: "character",
      system: {},
      items: [{ _id: "f", type: "feat", name: "Familiar", system: { rules: [] } }],
    };
    expect(detectFamiliarGrant(withFamiliarFeat).canHaveFamiliar).toBe(true);
  });

  it("takes the highest bump (upgrade semantics), not the sum", () => {
    const twoFeats = {
      _id: "x",
      type: "character",
      system: {},
      items: [
        {
          _id: "a",
          type: "feat",
          name: "Rat Familiar",
          system: { rules: [{ kind: "set-property", selector: "system.attributes.familiarAbilities.value", value: 2 }] },
        },
        {
          _id: "b",
          type: "feat",
          name: "Enhanced Familiar",
          system: { rules: [{ kind: "set-property", selector: "system.attributes.familiarAbilities.value", value: 4 }] },
        },
      ],
    };
    // base 2 + max(2,4) = 6
    expect(detectFamiliarGrant(twoFeats).abilityBudget).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Master snapshot
// ---------------------------------------------------------------------------

describe("buildMasterSnapshot", () => {
  it("snapshots level, key-ability mod, AC, saves, perception", () => {
    const s = buildMasterSnapshot(tobias());
    expect(s.level).toBe(3);
    expect(s.abilityMod).toBe(4); // int mod (Magus key ability)
    expect(s.ac).toBe(19);
    expect(s.saves).toEqual({ fortitude: 8, reflex: 10, will: 7 });
    expect(s.perception).toBe(9);
    expect(s.name).toBe("Tobias");
  });

  it("masterAbilityMod resolves the key ability from details", () => {
    expect(masterAbilityMod(tobias())).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Create op
// ---------------------------------------------------------------------------

describe("buildCreateFamiliarOp", () => {
  it("creates a familiar Actor with HP 15, budget 4, master link + ownership", () => {
    const op = buildCreateFamiliarOp({
      masterId: "tob0123456789abc",
      masterDoc: tobias(),
      name: "Pickpocket",
      appearance: "a scruffy black rat",
    });
    expect(op.type).toBe("doc:create");
    expect(op.documentType).toBe("Actor");
    expect(op.data["type"]).toBe("familiar");
    expect(op.data["name"]).toBe("Pickpocket");
    expect(op.data["ownership"]).toEqual({ default: 0, u1: 3 });
    const sys = op.data["system"] as Record<string, unknown>;
    expect(sys["masterActorId"]).toBe("tob0123456789abc");
    expect(sys["companionKind"]).toBe("familiar");
    expect((sys["abilitiesBudget"] as { max: number }).max).toBe(4);
    const hp = (sys["attributes"] as { hp: { max: number; value: number } }).hp;
    expect(hp.max).toBe(15);
    expect(hp.value).toBe(15);
    expect((sys["master"] as { level: number }).level).toBe(3);
  });

  it("falls back to a default name when blank", () => {
    const op = buildCreateFamiliarOp({ masterId: "m", masterDoc: tobias(), name: "   " });
    expect(op.data["name"]).toBe("Familiar");
  });
});

// ---------------------------------------------------------------------------
// Linked familiars + read
// ---------------------------------------------------------------------------

describe("linkedFamiliars / readFamiliar", () => {
  it("finds familiars linked to the master and reads derived stats", () => {
    const actors = [tobias(), pickpocket(), { _id: "other", type: "npc", system: {} }];
    const fams = linkedFamiliars(actors, "tob0123456789abc");
    expect(fams).toHaveLength(1);
    const f = fams[0]!;
    expect(f.name).toBe("Pickpocket");
    expect(f.hp).toEqual({ value: 15, max: 15 });
    expect(f.ac).toBe(19);
    expect(f.attack).toBe(7);
    expect(f.saves.reflex).toBe(10);
    expect(f.abilitiesBudget.max).toBe(4);
    expect(f.selectedAbilities).toEqual(["darkvision", "climber"]);
    expect(f.orphaned).toBe(false);
  });

  it("flags an orphan when masterActorId does not match", () => {
    const f = readFamiliar(pickpocket("someone-else"), "tob0123456789abc");
    expect(f.orphaned).toBe(true);
  });

  it("excludes familiars linked to a different master", () => {
    const actors = [pickpocket("another-master")];
    expect(linkedFamiliars(actors, "tob0123456789abc")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Toggle abilities (slot budget)
// ---------------------------------------------------------------------------

describe("buildToggleAbilityOp", () => {
  it("adds an ability when under budget", () => {
    const f = readFamiliar(pickpocket(), "tob0123456789abc"); // 2/4 used
    const op = buildToggleAbilityOp(f, "scent");
    expect(op).not.toBeNull();
    expect((op!.diff["system"] as { selectedAbilities: string[] }).selectedAbilities).toEqual([
      "darkvision",
      "climber",
      "scent",
    ]);
  });

  it("removes an already-selected ability", () => {
    const f = readFamiliar(pickpocket(), "tob0123456789abc");
    const op = buildToggleAbilityOp(f, "darkvision");
    expect((op!.diff["system"] as { selectedAbilities: string[] }).selectedAbilities).toEqual([
      "climber",
    ]);
  });

  it("refuses to add past the budget cap", () => {
    const full = pickpocket();
    (full["system"] as Record<string, unknown>)["selectedAbilities"] = ["a", "b", "c", "d"];
    (full["system"] as Record<string, unknown>)["abilitiesBudget"] = { value: 4, max: 4 };
    const f = readFamiliar(full, "tob0123456789abc");
    expect(buildToggleAbilityOp(f, "e")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HP / rename / refresh ops
// ---------------------------------------------------------------------------

describe("HP / rename / refresh ops", () => {
  it("clamps HP to [0, max]", () => {
    const f = readFamiliar(pickpocket(), "tob0123456789abc"); // max 15
    expect(diffHp(buildSetHpOp(f, 8))).toBe(8);
    expect(diffHp(buildSetHpOp(f, 99))).toBe(15);
    expect(diffHp(buildSetHpOp(f, -3))).toBe(0);
  });

  it("renames and trims", () => {
    const f = readFamiliar(pickpocket(), "tob0123456789abc");
    expect(buildRenameOp(f, "  Whiskers  ").diff["name"]).toBe("Whiskers");
  });

  it("skips the master refresh when nothing changed", () => {
    const f = readFamiliar(pickpocket(), "tob0123456789abc");
    expect(buildMasterRefreshOp(f, "tob0123456789abc", tobias())).toBeNull();
  });

  it("emits a refresh when the master levelled up", () => {
    const leveled = tobias();
    (leveled["system"] as Record<string, unknown>)["level"] = { value: 5 };
    const f = readFamiliar(pickpocket(), "tob0123456789abc"); // hp.max 15, level-3 based
    const op = buildMasterRefreshOp(f, "tob0123456789abc", leveled);
    expect(op).not.toBeNull();
    expect((op!.diff["system"] as { master: { level: number } }).master.level).toBe(5);
  });
});

function diffHp(op: { diff: Record<string, unknown> }): number {
  const sys = op.diff["system"] as { attributes: { hp: { value: number } } };
  return sys.attributes.hp.value;
}

// ---------------------------------------------------------------------------
// Picker filter
// ---------------------------------------------------------------------------

describe("filterAbilityRows", () => {
  const rows: AbilityRow[] = [
    { slug: "darkvision", name: "Visão no Escuro", subtitleEn: "Darkvision", uuid: "u1", searchText: "darkvision visao no escuro" },
    { slug: "flier", name: "Voador", subtitleEn: "Flier", uuid: "u2", searchText: "flier voador" },
  ];

  it("matches accent-insensitively across locales", () => {
    expect(filterAbilityRows(rows, "visao").map((r) => r.slug)).toEqual(["darkvision"]);
    expect(filterAbilityRows(rows, "flier").map((r) => r.slug)).toEqual(["flier"]);
  });

  it("returns all rows sorted by display name when the query is empty", () => {
    // "Visão no Escuro" < "Voador" (Vi < Vo), so darkvision sorts first.
    expect(filterAbilityRows(rows, "").map((r) => r.slug)).toEqual(["darkvision", "flier"]);
  });
});
