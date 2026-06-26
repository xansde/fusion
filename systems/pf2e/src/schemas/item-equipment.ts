/**
 * @fusion/system-pf2e — Item schemas for equipment, consumable, shield,
 * treasure, container, action/ability, melee, lore, ancestry, background, class.
 *
 * These are grouped here to keep the file count manageable. Each export
 * follows the same pattern: Schema + inferred Type + parse function.
 *
 * Clean-room: spec 17 §Tipos de Item; ORC/OGL only.
 * REQ-PF2-003.
 */

import { z } from "zod";
import {
  DamageTypeSchema,
  EffectRuleSchema,
  ProficiencyRankSchema,
  PublicationSchema,
  TraitsBlockSchema,
  WeaponCategorySchema,
} from "../schema-primitives.js";

// ---------------------------------------------------------------------------
// equipment (generic physical item)
// ---------------------------------------------------------------------------

export const EquipmentSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    bulk: z.number().min(0).default(0),
    price: z
      .object({
        gp: z.number().int().min(0).optional(),
        sp: z.number().int().min(0).optional(),
        cp: z.number().int().min(0).optional(),
      })
      .default({}),
    quantity: z.number().int().positive().default(1),
    level: z.number().int().min(0).default(0),
    usage: z.string().default("held-in-one-hand"),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type EquipmentSystem = z.infer<typeof EquipmentSystemSchema>;
export const parseEquipmentSystem = (data: unknown): EquipmentSystem =>
  EquipmentSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// consumable (potion, scroll, wand, ammunition, etc.)
// ---------------------------------------------------------------------------

export const ConsumableSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Category: scroll, wand, potion, oil, talisman, ammunition, toolkit, etc. */
    category: z.string().default("other"),
    charges: z
      .object({ value: z.number().int().min(0), max: z.number().int().min(0) })
      .default({ value: 1, max: 1 }),
    bulk: z.number().min(0).default(0),
    price: z
      .object({
        gp: z.number().int().min(0).optional(),
        sp: z.number().int().min(0).optional(),
        cp: z.number().int().min(0).optional(),
      })
      .default({}),
    quantity: z.number().int().positive().default(1),
    level: z.number().int().min(0).default(0),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    /** Spell embedded in a scroll/wand (UUID reference). */
    spell: z.string().optional(),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type ConsumableSystem = z.infer<typeof ConsumableSystemSchema>;
export const parseConsumableSystem = (data: unknown): ConsumableSystem =>
  ConsumableSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// shield
// REQ-PF2-020 (dexCap / hardness / hp)
// ---------------------------------------------------------------------------

export const ShieldSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Item AC bonus while the shield is raised. */
    acBonus: z.number().int().min(0),
    hardness: z.number().int().min(0).default(0),
    hp: z
      .object({ value: z.number().int().min(0), max: z.number().int().min(0) })
      .default({ value: 0, max: 0 }),
    /** Broken threshold (Hardness value; HP below this = broken). */
    brokenThreshold: z.number().int().min(0).default(0),
    bulk: z.number().min(0).default(1),
    price: z
      .object({
        gp: z.number().int().min(0).optional(),
        sp: z.number().int().min(0).optional(),
        cp: z.number().int().min(0).optional(),
      })
      .default({}),
    quantity: z.number().int().positive().default(1),
    level: z.number().int().min(0).default(0),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type ShieldSystem = z.infer<typeof ShieldSystemSchema>;
export const parseShieldSystem = (data: unknown): ShieldSystem => ShieldSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// treasure
// ---------------------------------------------------------------------------

export const TreasureSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    value: z
      .object({
        gp: z.number().int().min(0).optional(),
        sp: z.number().int().min(0).optional(),
        cp: z.number().int().min(0).optional(),
      })
      .default({}),
    quantity: z.number().int().positive().default(1),
    bulk: z.number().min(0).default(0),
    publication: PublicationSchema.optional(),
  })
  .passthrough();
export type TreasureSystem = z.infer<typeof TreasureSystemSchema>;
export const parseTreasureSystem = (data: unknown): TreasureSystem =>
  TreasureSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// container
// ---------------------------------------------------------------------------

export const ContainerSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Max bulk the container can hold. */
    capacity: z.number().min(0).default(0),
    /** Bulk reduction for items stored inside (e.g. Bag of Holding). */
    bulkReduction: z.number().min(0).default(0),
    bulk: z.number().min(0).default(0),
    price: z
      .object({
        gp: z.number().int().min(0).optional(),
        sp: z.number().int().min(0).optional(),
        cp: z.number().int().min(0).optional(),
      })
      .default({}),
    quantity: z.number().int().positive().default(1),
    level: z.number().int().min(0).default(0),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type ContainerSystem = z.infer<typeof ContainerSystemSchema>;
export const parseContainerSystem = (data: unknown): ContainerSystem =>
  ContainerSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// action / ability (NPC abilities, basic game actions)
// ---------------------------------------------------------------------------

export const ActionSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** "passive", "action", "reaction", "free". */
    actionType: z.object({ value: z.enum(["passive", "action", "reaction", "free"]) }),
    /** Number of actions (null for non-action types). */
    actions: z
      .object({ value: z.number().int().min(1).max(3).nullable() })
      .default({ value: null }),
    category: z.string().optional(),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type ActionSystem = z.infer<typeof ActionSystemSchema>;
export const parseActionSystem = (data: unknown): ActionSystem => ActionSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// melee (NPC-only attack item: pre-computed bonus, damage, traits)
// REQ-PF2-030 (NPC strikes derive from melee items, not weapon schemas)
// ---------------------------------------------------------------------------

const MeleeDamageEntrySchema = z.object({
  formula: z.string(),
  damageType: DamageTypeSchema,
  /** Category: "persistent", "splash", etc. */
  category: z.string().nullable().optional(),
});

export const MeleeSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Pre-computed attack bonus for this strike (e.g. +6). */
    bonus: z.object({ value: z.number().int() }),
    /** Damage entries for this strike. */
    damage: z.object({
      formula: z.string(),
      damageType: DamageTypeSchema,
    }),
    /** Additional damage entries (persistent, splash, etc.). */
    damageRolls: z.record(z.string(), MeleeDamageEntrySchema).default({}),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type MeleeSystem = z.infer<typeof MeleeSystemSchema>;
export const parseMeleeSystem = (data: unknown): MeleeSystem => MeleeSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// lore (custom Lore skill item)
// REQ-PF2-013
// ---------------------------------------------------------------------------

export const LoreSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Proficiency rank for this Lore skill. */
    proficient: z.object({ value: ProficiencyRankSchema }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
  })
  .passthrough();
export type LoreSystem = z.infer<typeof LoreSystemSchema>;
export const parseLoreSystem = (data: unknown): LoreSystem => LoreSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// ancestry (MVP: grants HP, speed, size, boost slots, vision)
// ---------------------------------------------------------------------------

export const AncestrySystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** HP granted by ancestry at level 1. */
    hp: z.number().int().min(0),
    speed: z.number().int().positive().default(25),
    size: z.enum(["tiny", "sm", "med", "lg", "huge", "grg"]).default("med"),
    /** Ability boost slots at level 1 (ability slugs or "free"). */
    boosts: z.array(z.string()).default([]),
    /** Ability flaws (ability slugs). */
    flaws: z.array(z.string()).default([]),
    /** Languages granted. */
    languages: z.object({ value: z.array(z.string()).default([]) }).default({ value: [] }),
    /** Primary vision type (darkvision, low-light-vision, etc.). */
    vision: z.string().default("normal"),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type AncestrySystem = z.infer<typeof AncestrySystemSchema>;
export const parseAncestrySystem = (data: unknown): AncestrySystem =>
  AncestrySystemSchema.parse(data);

// ---------------------------------------------------------------------------
// background (MVP: grants ability boost slots + skill proficiency)
// ---------------------------------------------------------------------------

export const BackgroundSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    boosts: z.array(z.string()).default([]),
    /** Skill proficiencies granted (slug → rank). */
    skills: z.record(z.string(), z.object({ value: ProficiencyRankSchema })).default({}),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type BackgroundSystem = z.infer<typeof BackgroundSystemSchema>;
export const parseBackgroundSystem = (data: unknown): BackgroundSystem =>
  BackgroundSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// class (MVP: hp per level, key ability, initial proficiencies)
// ---------------------------------------------------------------------------

export const ClassSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** HP gained per level from this class. */
    hp: z.number().int().positive(),
    /** Key ability slug(s) — usually one or two options. */
    keyAbility: z.array(z.string()),
    /** Initial proficiencies: map of category → rank. */
    proficiencies: z
      .object({
        classDC: ProficiencyRankSchema.optional(),
        weapons: z.record(WeaponCategorySchema, ProficiencyRankSchema).optional(),
        armor: z.record(z.string(), ProficiencyRankSchema).optional(),
        saves: z.record(z.string(), ProficiencyRankSchema).optional(),
        skills: z.record(z.string(), ProficiencyRankSchema).optional(),
      })
      .default({}),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type ClassSystem = z.infer<typeof ClassSystemSchema>;
export const parseClassSystem = (data: unknown): ClassSystem => ClassSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// heritage (MVP: may carry rules, no special dedicated fields)
// ---------------------------------------------------------------------------

export const HeritageSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
  })
  .passthrough();
export type HeritageSystem = z.infer<typeof HeritageSystemSchema>;
export const parseHeritageSystem = (data: unknown): HeritageSystem =>
  HeritageSystemSchema.parse(data);
