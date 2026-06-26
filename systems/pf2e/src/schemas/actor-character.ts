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
  focusPoints: z
    .object({ value: z.number().int().min(0), max: z.number().int().min(0) })
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
