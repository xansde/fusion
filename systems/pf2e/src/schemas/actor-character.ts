/**
 * @fusion/system-pf2e — Actor "character" schema.
 *
 * Defines the Zod schema for the `system` field of a player character (PC)
 * actor, aligned to the real data shape produced by the importer
 * (tools/importer-pf2e/analysis/02-schema-actor-item.md).
 *
 * Clean-room: spec 17 §Model de dados; ORC/OGL rules only.
 * REQ-PF2-002.
 */

import { z } from "zod";
import {
  AbilitySlugSchema,
  HpBlockSchema,
  IwrBlockSchema,
  ProficiencyRankSchema,
  SenseDataSchema,
  SkillSlugSchema,
  SpeedSchema,
} from "../schema-primitives.js";

// ---------------------------------------------------------------------------
// Ability score block
// REQ-PF2-010
// ---------------------------------------------------------------------------

/**
 * A single ability entry.
 *
 * Characters store the raw score (value) from which the modifier is derived.
 * NPCs store only the modifier (mod). During derivation the engine computes
 * `mod = floor((value - 10) / 2)` (REQ-PF2-010).
 *
 * Both `value` (score) and `mod` (derived) are present on character because
 * some item rules reference the score directly.
 */
export const CharacterAbilitySchema = z.object({
  /** Raw ability score (e.g. 16 → STR +3). */
  value: z.number().int(),
  /** Derived modifier — `floor((value - 10) / 2)`. Stored for cache, computed by engine. */
  mod: z.number().int().default(0),
});

const CharacterAbilitiesSchema = z.object({
  str: CharacterAbilitySchema,
  dex: CharacterAbilitySchema,
  con: CharacterAbilitySchema,
  int: CharacterAbilitySchema,
  wis: CharacterAbilitySchema,
  cha: CharacterAbilitySchema,
});

// ---------------------------------------------------------------------------
// Proficiency records
// REQ-PF2-011
// ---------------------------------------------------------------------------

const SaveProficiencySchema = z.object({
  rank: ProficiencyRankSchema,
});

const SavesSchema = z.object({
  fortitude: SaveProficiencySchema,
  reflex: SaveProficiencySchema,
  will: SaveProficiencySchema,
});

/** Per-skill proficiency rank; lore flag marks custom Lore skills. */
const SkillProficiencySchema = z.object({
  rank: ProficiencyRankSchema,
  /** True when this is a Lore skill (custom, keyed to INT). REQ-PF2-013 */
  lore: z.boolean().optional(),
});

/**
 * Skills map — 16 canonical skills keyed by slug.
 *
 * Uses z.record so that custom Lore skills (added by the importer as extra
 * keys) are also stored here without breaking the schema. REQ-PF2-013.
 */
const _CharacterSkillsSchema = z.record(SkillSlugSchema, SkillProficiencySchema).and(
  // Require at least one key to detect completely empty objects from bad data.
  // In practice the character always has all 16 skills.
  z.object({}).catchall(SkillProficiencySchema),
);

// ---------------------------------------------------------------------------
// Attributes
// REQ-PF2-020..022
// ---------------------------------------------------------------------------

const CharacterAttributesSchema = z.object({
  hp: HpBlockSchema,
  /** Derived: 10 + dexCapped + armorPotency + ... Updated by prepareData. */
  ac: z.object({ value: z.number().int() }).default({ value: 10 }),
  speed: SpeedSchema,
  dying: z.object({
    value: z.number().int().min(0).default(0),
    /** maxDying = 4 − doomed.value. REQ-PF2-074 */
    max: z.number().int().min(0).default(4),
  }),
  wounded: z.object({ value: z.number().int().min(0).default(0) }),
  doomed: z.object({ value: z.number().int().min(0).default(0) }),
  iwr: IwrBlockSchema.default({ immunities: [], weaknesses: [], resistances: [] }),
});

// ---------------------------------------------------------------------------
// Weapon and armor proficiencies
// REQ-PF2-030..032
// ---------------------------------------------------------------------------

const ProficiencyBlockSchema = z.object({
  /** Class DC proficiency rank. REQ-PF2-016 */
  classDC: z.object({ rank: ProficiencyRankSchema }).default({ rank: 0 }),
  /** Weapon category proficiencies. */
  weapons: z
    .object({
      unarmed: ProficiencyRankSchema.default(0),
      simple: ProficiencyRankSchema.default(0),
      martial: ProficiencyRankSchema.default(0),
      advanced: ProficiencyRankSchema.default(0),
    })
    .default({ unarmed: 0, simple: 0, martial: 0, advanced: 0 }),
  /** Armor category proficiencies. REQ-PF2-020 */
  armor: z
    .object({
      unarmored: ProficiencyRankSchema.default(0),
      light: ProficiencyRankSchema.default(0),
      medium: ProficiencyRankSchema.default(0),
      heavy: ProficiencyRankSchema.default(0),
    })
    .default({ unarmored: 0, light: 0, medium: 0, heavy: 0 }),
});

// ---------------------------------------------------------------------------
// Resources (Hero Points, Focus Points)
// REQ-PF2-044, REQ-PF2-083
// ---------------------------------------------------------------------------

const ResourcesSchema = z.object({
  heroPoints: z
    .object({ value: z.number().int().min(0), max: z.number().int().min(0) })
    .default({ value: 1, max: 3 }),
  /**
   * Focus points pool. `max` is capped at 3 (REQ-PF2-083, DEC-R10-02) — this
   * is a hard PF2e rule, not a soft UI limit, so it's safe to enforce here:
   * no production code path calls `CharacterSystemSchema.parse` strictly on
   * document load/update (verified — only tests call `parseCharacterSystem`
   * directly), so tightening this bound cannot brick an existing world doc
   * mid-session. The derivation step (R10-A item 5 / batch A2) additionally
   * clamps `max` to 3 when recomputing from focus-granting items, so the
   * value is double-guarded even if a future load path starts validating.
   */
  focusPoints: z
    .object({ value: z.number().int().min(0), max: z.number().int().min(0).max(3) })
    .default({ value: 0, max: 0 }),
});

// ---------------------------------------------------------------------------
// Details (key ability, ABC references)
// ---------------------------------------------------------------------------

const CharacterDetailsSchema = z.object({
  /**
   * Key ability for Class DC and spellcasting.
   * REQ-PF2-016.
   */
  keyAbility: AbilitySlugSchema,
  /** Ancestry item name/slug (imported from ABC). */
  ancestry: z.string().optional(),
  /** Background item name/slug. */
  background: z.string().optional(),
  /** Class item name/slug. */
  class: z.string().optional(),
  /** Character's level (1..20). REQ-PF2-011 */
  level: z.number().int().min(1).max(20).default(1),
});

// ---------------------------------------------------------------------------
// Build (level-by-level character builder state)
// R10-A, DEC-R10-01.
//
// The build block records *choices* that aren't represented by an embedded
// item: ability boosts/flaws by origin, and a flat log of builder slot
// choices (feats, skill training/increases, hybrid studies, ability
// boosts, ...). Choices that ARE items (class, ancestry, heritage,
// background, feat, classFeature) are embedded on the actor and tagged
// with `flags.fusion.build = {level, slot}` instead of living here.
//
// Derivation only applies build-driven steps (abilities from boosts, HP,
// class proficiencies/saves/classDC, trained skills, spellcasting slots)
// when an embedded `type: 'class'` item exists — see R10-A item 5. Actors
// without a class item keep the r9 manual-entry behavior untouched.
// ---------------------------------------------------------------------------

/** Ability boosts/flaws granted by ancestry, background, class, and level-ups. */
const BuildAbilitiesSchema = z
  .object({
    /** Ability slugs boosted by ancestry (fixed boosts). */
    ancestryBoosts: z.array(AbilitySlugSchema).default([]),
    /** Ability slugs flawed by ancestry. */
    ancestryFlaws: z.array(AbilitySlugSchema).default([]),
    /** Free ability boost slugs chosen from ancestry (unrestricted boosts). */
    ancestryFree: z.array(AbilitySlugSchema).default([]),
    /** Ability slugs boosted by background. */
    backgroundBoosts: z.array(AbilitySlugSchema).default([]),
    /** Key ability boost slug(s) chosen at class selection. */
    classBoost: z.array(AbilitySlugSchema).default([]),
    /** Ability boosts chosen at level-up milestones, keyed by level (as string). */
    levelledBoosts: z.record(z.string(), z.array(AbilitySlugSchema)).default({}),
  })
  .default({});
export type BuildAbilities = z.infer<typeof BuildAbilitiesSchema>;

/**
 * A single builder slot choice.
 *
 * `slot` is a unique id for the slot within the plan (e.g. "classFeat-2",
 * "skillTraining-1a"), used by the UI to know which slot a choice fills and
 * to allow removal/replacement. `type` identifies what kind of choice this
 * is; kept as an open string (documented enum below) rather than a closed
 * z.enum so future archetypes/classes can introduce new slot types:
 *   - "classFeat" | "skillFeat" | "generalFeat" | "ancestryFeat" | "archetypeFeat"
 *   - "heritage"
 *   - "skillTraining" | "skillIncrease"
 *   - "hybridStudy"
 *   - "abilityBoosts"
 */
const BuildChoiceSchema = z.object({
  level: z.number().int().min(1).max(20),
  slot: z.string().min(1),
  type: z.string().min(1),
  /** Compendium UUID reference, when the choice targets a compendium doc. */
  ref: z.string().optional(),
  /** Embedded item id, when the choice materialized an embedded item. */
  itemId: z.string().optional(),
  /** Skill slug, for skillTraining/skillIncrease choices. */
  skill: z.string().optional(),
  /** Resulting proficiency rank, for skillTraining/skillIncrease choices. */
  rank: ProficiencyRankSchema.optional(),
});
export type BuildChoice = z.infer<typeof BuildChoiceSchema>;

const CharacterBuildSchema = z
  .object({
    abilities: BuildAbilitiesSchema,
    choices: z.array(BuildChoiceSchema).default([]),
    /** Extra max HP granted by build choices (e.g. ancestry/heritage), flat. */
    bonusHp: z.number().int().min(0).default(0),
    /** Extra max HP granted per level (e.g. a feat that adds HP/level). */
    bonusHpPerLevel: z.number().int().min(0).default(0),
    /** Free Archetype variant rule toggle — grants archetype feat slots on even levels. */
    freeArchetype: z.boolean().default(false),
  })
  .default({});
export type CharacterBuild = z.infer<typeof CharacterBuildSchema>;

// ---------------------------------------------------------------------------
// Full CharacterSystem schema
// REQ-PF2-002 / spec 17 §schemas character
// ---------------------------------------------------------------------------

export const CharacterSystemSchema = z
  .object({
    /** System schema version for migrations. REQ-PF2-205 */
    systemVersion: z.string().default("0.1.0"),
    /** Character level. REQ-PF2-011 */
    level: z.object({ value: z.number().int().min(1).max(20) }).default({ value: 1 }),
    abilities: CharacterAbilitiesSchema,
    attributes: CharacterAttributesSchema,
    saves: SavesSchema,
    /** Perception proficiency rank. REQ-PF2-014 */
    perception: z.object({
      rank: ProficiencyRankSchema,
      senses: z.array(SenseDataSchema).default([]),
    }),
    /** Skill proficiencies (canonical + Lore). REQ-PF2-012..013 */
    skills: z.record(z.string(), SkillProficiencySchema).default({}),
    proficiencies: ProficiencyBlockSchema.default({}),
    resources: ResourcesSchema.default({}),
    details: CharacterDetailsSchema,
    /** Level-by-level builder state (R10-A, DEC-R10-01). Optional/absent = r9 manual mode. */
    build: CharacterBuildSchema.optional(),
    /** System-level traits (ancestry traits, size). */
    traits: z
      .object({
        rarity: z.enum(["common", "uncommon", "rare", "unique"]).default("common"),
        value: z.array(z.string()).default([]),
        size: z.enum(["tiny", "sm", "med", "lg", "huge", "grg"]).default("med"),
      })
      .default({}),
  })
  .passthrough(); // REQ-PF2-204: extra fields from importer are allowed

export type CharacterSystem = z.infer<typeof CharacterSystemSchema>;

// ---------------------------------------------------------------------------
// Validate/parse helper
// ---------------------------------------------------------------------------

/** Parse raw data as a CharacterSystem; throws on validation failure. */
export function parseCharacterSystem(data: unknown): CharacterSystem {
  return CharacterSystemSchema.parse(data);
}

// Re-export subtypes for use in derivation steps and tests.
export type { SenseData } from "../schema-primitives.js";
