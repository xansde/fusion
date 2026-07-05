/**
 * @fusion/system-sf2e — shared Zod schema primitives.
 *
 * Mirrors `systems/pf2e/src/schema-primitives.ts` — the vast majority of
 * these building blocks are IDENTICAL to PF2e (engine-2e shared vocabulary:
 * IWR, speed, senses, HP block, traits block, publication, EffectRule
 * passthrough, rune fields). SF2e-specific additions/overrides:
 *
 *   - PriceSchema / currency: SF2e uses `credits` instead of gp/sp/cp
 *     (D-SF2-05, REQ-SF2-027). Kept as a SEPARATE schema (CreditsPriceSchema)
 *     because the real compendium data (vendor/pf2e/packs/sf2e/**)
 *     still prices items with gp/sp/cp keys (Foundry sf2e system reuses the
 *     PF2e currency denominations internally and converts to credits at
 *     display time — 1 sp = 1 credit by SF2e convention). We therefore keep
 *     BOTH: `PriceSchema` (gp/sp/cp, matches item.system.price.value in the
 *     real data) for items, and `CreditsSchema` (flat integer) for the
 *     actor's `system.currency.credits` wallet field (REQ-SF2-027..029).
 *   - WeaponGradeFieldSchema: SF2e's `grade` field (replaces PF2e runes for
 *     Tech weapons — D-SF2-02). Analog weapons keep using WeaponRunesSchema
 *     (REQ-SF2-021), inherited verbatim from PF2e.
 *   - AmmoSchema: battery/projectile-ammo/chem-tank charge tracking
 *     (REQ-SF2-020), replacing PF2e's reload-only model for Tech weapons.
 *
 * Clean-room: schema structure derived from the Fusion spec 18 and from
 * direct inspection of vendor/pf2e/packs/sf2e/**\/*.json (Apache-2.0 data).
 * No Foundry source code copied.
 *
 * REQ-SF2-002, REQ-SF2-018..021, REQ-SF2-027..029.
 */

import { z } from "zod";
import {
  ABILITY_SLUGS,
  AMMO_BASE_TYPES,
  ARMOR_CATEGORIES,
  DAMAGE_TYPES,
  RARITIES,
  SAVE_STATISTICS,
  SIZES,
  SKILL_SLUGS,
  WEAPON_CATEGORIES,
  WEAPON_GRADES,
  WEAPON_GROUPS,
} from "./types.js";

// ---------------------------------------------------------------------------
// Proficiency rank (0..4 = Untrained..Legendary) — identical to PF2e.
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
export const SaveStatisticSchema = z.enum(SAVE_STATISTICS);
export const SizeSchema = z.enum(SIZES);
export const RaritySchema = z.enum(RARITIES);
export const WeaponGradeSchema = z.enum(WEAPON_GRADES);
export const AmmoBaseTypeSchema = z.enum(AMMO_BASE_TYPES);

// ---------------------------------------------------------------------------
// Immunity / Weakness / Resistance entry — identical to PF2e.
// REQ-SF2-004 (IWR inherited from engine-2e without modification).
// ---------------------------------------------------------------------------

export const IwrEntrySchema = z.object({
  type: z.string().min(1),
  value: z.number().int().nonnegative().optional(),
  exceptions: z.array(z.string()).optional(),
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
// Speed (foot speed + other movement types) — identical to PF2e.
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
// Sense data — identical to PF2e.
// ---------------------------------------------------------------------------

export const SenseDataSchema = z.object({
  type: z.string().min(1),
  acuity: z.string().optional(),
  range: z.number().int().positive().optional(),
});
export type SenseData = z.infer<typeof SenseDataSchema>;

// ---------------------------------------------------------------------------
// HP block — identical to PF2e.
// ---------------------------------------------------------------------------

export const HpBlockSchema = z.object({
  value: z.number().int().min(0),
  max: z.number().int().min(0),
  temp: z.number().int().min(0).default(0),
  details: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Traits block — identical to PF2e.
// ---------------------------------------------------------------------------

export const TraitsBlockSchema = z.object({
  rarity: RaritySchema.default("common"),
  value: z.array(z.string()),
  size: SizeSchema.optional(),
});

// ---------------------------------------------------------------------------
// Publication attribution (ORC mandate) — identical to PF2e.
// ---------------------------------------------------------------------------

export const PublicationSchema = z.object({
  license: z.string(),
  remaster: z.boolean().optional(),
  title: z.string(),
});

// ---------------------------------------------------------------------------
// EffectRule — permissive passthrough for rules stored on items.
// Mirrors PF2e's fixed EffectRuleSchema (systems/pf2e/src/schema-primitives.ts,
// REQ-SF2-051 mirrors REQ-PF2-204): tools/importer-pf2e/src/transform.mjs's
// convertRuleElement() produces ModifierDescriptor objects with a `kind`
// discriminator field, not `type` — verified against every rules[] entry in
// systems/sf2e/packs/{conditions,augmentations-core}/documents.json (e.g.
// Glitching's badge rules, Retinal Reflectors' Sense/FlatModifier
// descriptors). A bare `type: z.string()` (no `kind` alternative) rejects
// every one of them with "rules.N.type: Required".
// ---------------------------------------------------------------------------

export const EffectRuleSchema = z
  .object({
    kind: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough()
  .refine((rule) => typeof rule.kind === "string" || typeof rule.type === "string", {
    message: "EffectRule must have a string 'kind' or 'type' discriminator",
  });

export type EffectRuleRaw = z.infer<typeof EffectRuleSchema>;

// ---------------------------------------------------------------------------
// Rune fields (weapon / armor) — inherited verbatim from PF2e.
// Used by Analog weapons/armor (no `Tech` trait), which keep the PF2e rune
// system per REQ-SF2-021.
// ---------------------------------------------------------------------------

export const WeaponRunesSchema = z.object({
  potency: z.number().int().min(0).max(4).default(0),
  striking: z.number().int().min(0).max(3).default(0),
  property: z.array(z.string()).default([]),
});

export const ArmorRunesSchema = z.object({
  potency: z.number().int().min(0).max(4).default(0),
  resilient: z.number().int().min(0).max(3).default(0),
  property: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Price — item price as stored in the real compendium data (gp/sp/cp keys,
// e.g. { "sp": 50 } for the Arc Rifle). Identical shape to PF2e's PriceSchema
// because the sf2e Foundry system still prices items via the pf2e coinage
// keys internally (1 sp = 1 credit by SF2e convention); the UI-facing
// conversion to credits happens at display time, not in stored data.
// ---------------------------------------------------------------------------

export const PriceSchema = z.object({
  gp: z.number().int().min(0).optional(),
  sp: z.number().int().min(0).optional(),
  cp: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// SF2e-exclusive: actor currency — flat credits integer (D-SF2-05,
// REQ-SF2-027). Replaces PF2e's { cp, sp, gp, pp } wallet on the actor.
// ---------------------------------------------------------------------------

export const CreditsSchema = z.object({
  credits: z.number().int().min(0).default(0),
});
export type Credits = z.infer<typeof CreditsSchema>;

// ---------------------------------------------------------------------------
// SF2e-exclusive: ammo/charge tracking for Tech weapons (D-SF2-02,
// REQ-SF2-018, REQ-SF2-020, REQ-SF2-047).
//
// Matches the real shape observed on every SF2e weapon with the `tech` trait
// (vendor/pf2e/packs/sf2e/equipment/weapons/*.json), e.g.:
//   "ammo": { "baseType": "battery", "builtIn": false, "capacity": 1 }
// `null` for Analog weapons that carry no ammo/charge tracking (e.g. Baton).
// ---------------------------------------------------------------------------

export const AmmoSchema = z
  .object({
    baseType: AmmoBaseTypeSchema,
    /** True when the ammo source is built into the weapon (no separate item). */
    builtIn: z.boolean().default(false),
    /** Number of charges/shots the ammo source holds. */
    capacity: z.number().int().min(0).default(1),
  })
  .nullable();
export type Ammo = z.infer<typeof AmmoSchema>;

/** Charges currently loaded — tracked separately from `capacity` (max). REQ-SF2-020. */
export const ChargesSchema = z.object({
  current: z.number().int().min(0).default(1),
  max: z.number().int().min(0).default(1),
});
export type Charges = z.infer<typeof ChargesSchema>;

// ---------------------------------------------------------------------------
// Spellcasting slots (prepared / spontaneous / innate per rank) — identical
// to PF2e. Used by Mystic and Witchwarper spellcasting entries. REQ-SF2-004.
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
