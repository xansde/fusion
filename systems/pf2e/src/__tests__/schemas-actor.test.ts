/**
 * @fusion/system-pf2e — Actor schema tests.
 *
 * Verifies that each actor schema:
 *   1. Accepts a valid sample matching the real importer data shape.
 *   2. Rejects malformed data on required fields.
 *   3. Passes through extra fields (REQ-PF2-204).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CharacterSystemSchema } from "../schemas/actor-character.js";
import { NpcSystemSchema } from "../schemas/actor-npc.js";
import { HazardSystemSchema } from "../schemas/actor-hazard.js";
import { LootSystemSchema } from "../schemas/actor-loot.js";

// ---------------------------------------------------------------------------
// character
// ---------------------------------------------------------------------------

describe("CharacterSystemSchema", () => {
  /** Minimal valid character — all required fields filled. */
  const validCharacter = {
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
    saves: {
      fortitude: { rank: 2 },
      reflex: { rank: 1 },
      will: { rank: 1 },
    },
    perception: { rank: 1 },
    skills: {
      acrobatics: { rank: 0 },
      athletics: { rank: 2 },
    },
    proficiencies: {
      classDC: { rank: 1 },
    },
    details: {
      keyAbility: "str",
      class: "Fighter",
      level: 5,
    },
  };

  it("accepts a valid character", () => {
    const result = CharacterSystemSchema.safeParse(validCharacter);
    expect(result.success).toBe(true);
  });

  it("defaults abilities.mod to 0", () => {
    const result = CharacterSystemSchema.safeParse(validCharacter);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.abilities.str.mod).toBe(0);
    }
  });

  it("defaults systemVersion", () => {
    const result = CharacterSystemSchema.safeParse(validCharacter);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.systemVersion).toBe("0.1.0");
    }
  });

  it("passes through extra fields (REQ-PF2-204)", () => {
    const withExtra = { ...validCharacter, unknownField: "ignored but accepted" };
    const result = CharacterSystemSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
  });

  it("rejects invalid proficiency rank (out of range)", () => {
    const bad = {
      ...validCharacter,
      saves: { ...validCharacter.saves, fortitude: { rank: 5 } }, // rank max = 4
    };
    const result = CharacterSystemSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects missing abilities", () => {
    const { abilities: _a, ...noAbilities } = validCharacter;
    const result = CharacterSystemSchema.safeParse(noAbilities);
    expect(result.success).toBe(false);
  });

  it("rejects negative HP value", () => {
    const bad = {
      ...validCharacter,
      attributes: { ...validCharacter.attributes, hp: { value: -1, max: 60 } },
    };
    const result = CharacterSystemSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts character with trait data", () => {
    const withTraits = {
      ...validCharacter,
      traits: { rarity: "uncommon", value: ["human", "humanoid"], size: "med" },
    };
    const result = CharacterSystemSchema.safeParse(withTraits);
    expect(result.success).toBe(true);
  });

  it("rejects invalid keyAbility slug", () => {
    const bad = {
      ...validCharacter,
      details: { ...validCharacter.details, keyAbility: "luck" },
    };
    const result = CharacterSystemSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// npc — modelled on Skeleton Guard from analysis/02-schema-actor-item.md
// ---------------------------------------------------------------------------

describe("NpcSystemSchema", () => {
  const skeletonGuard = {
    abilities: {
      str: { mod: 3 },
      dex: { mod: 4 },
      con: { mod: 0 },
      int: { mod: -4 },
      wis: { mod: 0 },
      cha: { mod: 0 },
    },
    attributes: {
      ac: { value: 16, details: "" },
      hp: { value: 4, max: 4, details: "void healing" },
      speed: { value: 25 },
      perception: { mod: 6, senses: [{ type: "darkvision" }] },
      iwr: {
        immunities: [
          { type: "death-effects" },
          { type: "disease" },
          { type: "paralyzed" },
          { type: "poison" },
          { type: "unconscious" },
        ],
        resistances: [
          { type: "cold", value: 5 },
          { type: "electricity", value: 5 },
          { type: "fire", value: 5 },
          { type: "piercing", value: 5 },
        ],
        weaknesses: [],
      },
    },
    details: {
      level: { value: -1 },
      languages: { value: [] },
      publicNotes: "<p>The most common skeletal minions...</p>",
      publication: {
        license: "ORC",
        remaster: true,
        title: "Pathfinder Monster Core",
      },
    },
    saves: {
      fortitude: { value: 2 },
      reflex: { value: 9 },
      will: { value: 2 },
    },
    skills: {
      acr: { base: 8 },
      ath: { base: 5 },
    },
    traits: {
      rarity: "common",
      value: ["mindless", "skeleton", "undead", "unholy"],
      size: "med",
    },
  };

  it("accepts Skeleton Guard statblock", () => {
    const result = NpcSystemSchema.safeParse(skeletonGuard);
    expect(result.success).toBe(true);
  });

  it("accepts negative creature level", () => {
    const result = NpcSystemSchema.safeParse(skeletonGuard);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details.level.value).toBe(-1);
    }
  });

  it("defaults systemVersion", () => {
    const result = NpcSystemSchema.safeParse(skeletonGuard);
    if (result.success) {
      expect(result.data.systemVersion).toBe("0.1.0");
    }
  });

  it("passes through extra fields (REQ-PF2-204)", () => {
    const withExtra = {
      ...skeletonGuard,
      initiative: { statistic: "perception" },
      extraField: true,
    };
    const result = NpcSystemSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
  });

  it("rejects missing abilities block", () => {
    const { abilities: _a, ...noAbilities } = skeletonGuard;
    const result = NpcSystemSchema.safeParse(noAbilities);
    expect(result.success).toBe(false);
  });

  it("rejects string saves value", () => {
    const bad = {
      ...skeletonGuard,
      saves: { ...skeletonGuard.saves, fortitude: { value: "bad" } },
    };
    const result = NpcSystemSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts NPC with empty skills", () => {
    const minimal = { ...skeletonGuard, skills: {} };
    const result = NpcSystemSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NpcSystemSchema conformance vs. the REAL committed bestiary pack
// (audit M4.5-corretor, ISSUE MEDIA) — data-driven guard against
// importer↔schema drift.
//
// The hand-authored `skeletonGuard` fixture above documents the shape the
// schema is WRITTEN against, but drifted from the real shape the importer
// (tools/importer-pf2e/src/transform.mjs normalizeActorSystem) actually
// produces — every real NPC failed NpcSystemSchema.safeParse (perception
// required-but-absent, allSaves/traits.size shape mismatch) despite ~2.9k
// green tests, because no test ever parsed the committed pack data itself.
// This test iterates every NPC in systems/pf2e/packs/bestiary-core/
// documents.json and is therefore a permanent guard against the schema
// silently drifting away from the importer's real output again.
// ---------------------------------------------------------------------------

describe("NpcSystemSchema conformance — real bestiary-core pack", () => {
  const packPath = fileURLToPath(
    new URL("../../packs/bestiary-core/documents.json", import.meta.url),
  );
  const pack = JSON.parse(readFileSync(packPath, "utf8")) as Array<{
    name: string;
    system: unknown;
  }>;

  it("the pack fixture itself is non-empty (guards against a silently-empty pack file)", () => {
    expect(pack.length).toBeGreaterThan(0);
  });

  it.each(pack.map((doc) => [doc.name, doc.system] as const))(
    "NPC %s from the real pack parses against NpcSystemSchema",
    (name, system) => {
      const result = NpcSystemSchema.safeParse(system);
      if (!result.success) {
        throw new Error(`${name} failed: ${JSON.stringify(result.error.issues)}`);
      }
      expect(result.success).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// hazard
// ---------------------------------------------------------------------------

describe("HazardSystemSchema", () => {
  const trapData = {
    level: { value: 3 },
    attributes: {
      hp: { value: 50, max: 50 },
      ac: { value: 18 },
      hardness: 10,
      iwr: { immunities: [{ type: "mental" }], weaknesses: [], resistances: [] },
    },
    saves: { reflex: { value: 10 } },
    details: { trigger: "A creature steps on the plate.", effect: "The spear fires." },
  };

  it("accepts valid hazard", () => {
    expect(HazardSystemSchema.safeParse(trapData).success).toBe(true);
  });

  it("defaults systemVersion", () => {
    const result = HazardSystemSchema.safeParse(trapData);
    if (result.success) expect(result.data.systemVersion).toBe("0.1.0");
  });

  it("rejects negative AC", () => {
    const bad = { ...trapData, attributes: { ...trapData.attributes, ac: { value: -1 } } };
    expect(HazardSystemSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loot
// ---------------------------------------------------------------------------

describe("LootSystemSchema", () => {
  it("accepts minimal loot (all fields optional)", () => {
    const result = LootSystemSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("defaults publicAccess to false", () => {
    const result = LootSystemSchema.safeParse({});
    if (result.success) expect(result.data.publicAccess).toBe(false);
  });

  it("accepts loot with description", () => {
    const result = LootSystemSchema.safeParse({
      publicAccess: true,
      description: "A pile of goblin treasure.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-boolean publicAccess", () => {
    expect(LootSystemSchema.safeParse({ publicAccess: "yes" }).success).toBe(false);
  });
});
