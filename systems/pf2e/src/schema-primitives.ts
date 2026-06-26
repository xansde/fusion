/**
 * @fusion/system-pf2e — shared Zod schema primitives.
 *
 * These are small building-block schemas reused across actor and item schemas.
 * Keeping them in one file avoids repetition and makes them easy to update
 * when the spec evolves.
 *
 * Clean-room: schema structure derived from the Fusion spec 17 and from
 * the importer analysis (tools/importer-pf2e/analysis/02-schema-actor-item.md).
 * No Foundry source code copied.
 *
 * REQ-PF2-002, REQ-PF2-003, REQ-PF2-204.
 */

import { z } from "zod";
import {
  ABILITY_SLUGS,
  ARMOR_CATEGORIES,
  DAMAGE_TYPES,
  RARITIES,
  SAVE_STATISTICS,
  SIZES,
  SKILL_SLUGS,
  SPELL_TRADITIONS,
  WEAPON_CATEGORIES,
  WEAPON_GROUPS,
} from "./types.js";

// ---------------------------------------------------------------------------
// Proficiency rank (0..4 = Untrained..Legendary)
// ---------------------------------------------------------------------------

export const ProficiencyRankSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

// ---------------------------------------------------------------------------
// Primitive enum schemas
// ---------------------------------------------------------------------------

export const AbilitySlugSchema = z.enum(ABILITY_SLUGS);
export const SkillSlugSchema = z.enum(SKILL_SLUGS);
export const WeaponCategorySchema = z.enum(WEAPON_CATEGORIES);
export const WeaponGroupSchema = z.enum(WEAPON_GROUPS);
export const ArmorCategorySchema = z.enum(ARMOR_CATEGORIES);
export const DamageTypeSchema = z.enum(DAMAGE_TYPES);
export const SpellTraditionSchema = z.enum(SPELL_TRADITIONS);
export const SaveStatisticSchema = z.enum(SAVE_STATISTICS);
export const SizeSchema = z.enum(SIZES);
export const RaritySchema = z.enum(RARITIES);

// ---------------------------------------------------------------------------
// Immunity / Weakness / Resistance entry
// REQ-PF2-060 — aligned to IwrPipelineEntry used in engine-2e.
// ---------------------------------------------------------------------------

export const IwrEntrySchema = z.object({
  /** Damage type or condition slug targeted by this entry. */
  type: z.string().min(1),
  /** Numeric value for weakness/resistance (omitted for immunity). */
  value: z.number().int().nonnegative().optional(),
  /** Damage types/conditions that bypass this IWR entry. */
  exceptions: z.array(z.string()).optional(),
  /** Damage types against which the value is doubled. */
  doubleVs: z.array(z.string()).optional(),
});
export type IwrEntry = z.infer<typeof IwrEntrySchema>;

export const IwrBlockSchema = z.object({
  immunities: z.array(IwrEntrySchema).default([]),
  weaknesses: z.array(IwrEntrySchema).default([]),
  resistances: z.array(IwrEntrySchema).default([]),
});
export type IwrBlock = z.infer<typeof IwrBlockSchema>;

// ---------------------------------------------------------------------------
// Speed (foot speed + other movement types)
// REQ-PF2-012
// ---------------------------------------------------------------------------

export const OtherSpeedSchema = z.object({
  type: z.string().min(1),
  value: z.number().int().nonnegative(),
});

export const SpeedSchema = z.object({
  value: z.number().int().nonnegative(),
  otherSpeeds: z.array(OtherSpeedSchema).default([]),
});

// ---------------------------------------------------------------------------
// Sense data (darkvision, low-light vision, etc.)
// ---------------------------------------------------------------------------

export const SenseDataSchema = z.object({
  type: z.string().min(1),
  acuity: z.string().optional(),
  range: z.number().int().positive().optional(),
});
export type SenseData = z.infer<typeof SenseDataSchema>;

// ---------------------------------------------------------------------------
// HP block
// REQ-PF2-021, REQ-PF2-022
// ---------------------------------------------------------------------------

export const HpBlockSchema = z.object({
  value: z.number().int().min(0),
  max: z.number().int().min(0),
  temp: z.number().int().min(0).default(0),
  details: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Traits block (rarity + trait slugs array + optional size)
// ---------------------------------------------------------------------------

export const TraitsBlockSchema = z.object({
  rarity: RaritySchema.default("common"),
  value: z.array(z.string()),
  size: SizeSchema.optional(),
});

// ---------------------------------------------------------------------------
// Publication attribution (ORC mandate — REQ-PF2-204)
// ---------------------------------------------------------------------------

export const PublicationSchema = z.object({
  license: z.string(),
  remaster: z.boolean().optional(),
  title: z.string(),
});

// ---------------------------------------------------------------------------
// EffectRule — permissive passthrough for rules stored on items.
// REQ-PF2-204: unknown rule types must NOT break validation.
// ---------------------------------------------------------------------------

/**
 * Permissive schema for a single effect rule.
 *
 * We validate only the discriminator `type` field; all other fields are
 * passed through untouched. This ensures documents from the importer with
 * unsupported rule types remain valid.
 *
 * REQ-PF2-204.
 */
export const EffectRuleSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

export type EffectRuleRaw = z.infer<typeof EffectRuleSchema>;

// ---------------------------------------------------------------------------
// Rune fields (weapon / armor)
// REQ-PF2-130
// ---------------------------------------------------------------------------

export const WeaponRunesSchema = z.object({
  /** Potency rune level (0 = none, 1..4). */
  potency: z.number().int().min(0).max(4).default(0),
  /** Striking rune level (0 = none, 1..3). */
  striking: z.number().int().min(0).max(3).default(0),
  /** Property rune slugs — reserved for [V2] automation. */
  property: z.array(z.string()).default([]),
});

export const ArmorRunesSchema = z.object({
  potency: z.number().int().min(0).max(4).default(0),
  resilient: z.number().int().min(0).max(3).default(0),
  property: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

export const PriceSchema = z.object({
  gp: z.number().int().min(0).optional(),
  sp: z.number().int().min(0).optional(),
  cp: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Spellcasting slots (prepared / spontaneous / innate per rank)
// REQ-PF2-081
// ---------------------------------------------------------------------------

/** Single spell slot for prepared casters (slot ID → spell UUID). */
export const PreparedSpellSchema = z.object({
  id: z.string(),
  expended: z.boolean().default(false),
});

/** A rank's slot pool. */
export const SpellSlotSchema = z.object({
  value: z.number().int().min(0).default(0),
  max: z.number().int().min(0).default(0),
  /** Prepared spells occupying this rank's slots. */
  prepared: z.array(PreparedSpellSchema).optional(),
});

/**
 * Full slot map — ranks 0 (cantrips) through 10.
 * Zod record with string keys (JSON key = "0".."10").
 */
export const SpellSlotsMapSchema = z
  .object({
    "0": SpellSlotSchema.optional(),
    "1": SpellSlotSchema.optional(),
    "2": SpellSlotSchema.optional(),
    "3": SpellSlotSchema.optional(),
    "4": SpellSlotSchema.optional(),
    "5": SpellSlotSchema.optional(),
    "6": SpellSlotSchema.optional(),
    "7": SpellSlotSchema.optional(),
    "8": SpellSlotSchema.optional(),
    "9": SpellSlotSchema.optional(),
    "10": SpellSlotSchema.optional(),
  })
  .default({});
