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
  AbilitySlugSchema,
  DamageTypeSchema,
  EffectRuleSchema,
  ProficiencyRankSchema,
  PublicationSchema,
  SpellTraditionSchema,
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
    /**
     * "passive", "action", "reaction", "free" — flattened plain value, not
     * the vendor's `{value: ...}` wrapper. transform.mjs's buildSystem()
     * routes `type: "action"` docs through normalizeFeatSystem(), which
     * unwraps actionType/actions the same way it does for feats (W2,
     * pf2e.actions-core) — this schema mirrors that real output shape
     * rather than the raw Foundry shape.
     */
    actionType: z.enum(["passive", "action", "reaction", "free"]).default("passive"),
    /** Number of actions (null for non-action types, e.g. passive/reaction/free). */
    actions: z.number().int().min(1).max(3).nullable().default(null),
    /**
     * Gameplay tag ("offensive"/"defensive"/"interaction") — vendor's own
     * system.category. Nullable (not just optional): normalizeFeatSystem
     * (transform.mjs) explicitly sets `category: null` when the vendor doc
     * omits it (~30 basic/skill actions in the real vendor data carry no
     * category at all) — plain `.optional()` rejects an explicit `null`.
     */
    category: z.string().nullable().optional(),
    /**
     * Navigation category derived from the vendor's physical actions/
     * subfolder (e.g. "basic", "skill", "class", "ancestry") — injected by
     * normalize.mjs's loadRawDocs() as system.fusionCategory before the
     * Foundry `folder` id field (never itself a readable name) is stripped.
     * Orthogonal to `category` above. Optional because only pf2e.actions-core
     * populates it; other item types never set it.
     */
    fusionCategory: z.string().optional(),
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
// R10-A: structured level-by-level progression for the builder
// (DEC-R10-01, DEC-R10-06). Shape is authored clean-room from the Fusion
// spec; field names mirror the vendor's items{} map / featLevels arrays
// only as *structure* (facts of the rule system, not copyrighted prose).
// ---------------------------------------------------------------------------

/**
 * Feat slot levels grouped by category. Each array lists the character
 * levels at which the class grants a feat slot of that category.
 * e.g. Magus classFeatLevels = [2,4,6,8,10,12,14,16,18,20].
 */
export const ClassFeatLevelsSchema = z
  .object({
    ancestry: z.array(z.number().int().min(1).max(20)).default([]),
    class: z.array(z.number().int().min(1).max(20)).default([]),
    general: z.array(z.number().int().min(1).max(20)).default([]),
    skill: z.array(z.number().int().min(1).max(20)).default([]),
  })
  .default({});
export type ClassFeatLevels = z.infer<typeof ClassFeatLevelsSchema>;

/** Skill trained at level 1 (from class) plus a count of free choices. */
export const ClassTrainedSkillsSchema = z
  .object({
    value: z.array(z.string()).default([]),
    additional: z.number().int().min(0).default(0),
  })
  .default({});
export type ClassTrainedSkills = z.infer<typeof ClassTrainedSkillsSchema>;

/**
 * A single proficiency-rank upgrade granted at a class level.
 *
 * `stat` identifies what gets upgraded. Kept as an open string (documented
 * enum below) rather than a closed z.enum so that future classes/archetypes
 * can introduce new stat slugs without a schema change:
 *   - "perception"
 *   - "fortitude" | "reflex" | "will"
 *   - "classDC"
 *   - "spellcasting"
 *   - "weapons.<category>" (unarmed|simple|martial|advanced)
 *   - "armor.<category>" (unarmored|light|medium|heavy)
 */
export const ProficiencyUpgradeSchema = z.object({
  level: z.number().int().min(1).max(20),
  stat: z.string().min(1),
  rank: ProficiencyRankSchema,
});
export type ProficiencyUpgrade = z.infer<typeof ProficiencyUpgradeSchema>;

/** Cantrips known at a given character level (count grows with level). */
export const CantripsKnownEntrySchema = z.object({
  level: z.number().int().min(1).max(20),
  count: z.number().int().min(0),
});
export type CantripsKnownEntry = z.infer<typeof CantripsKnownEntrySchema>;

/**
 * Spell slots granted at a given character level, keyed by spell rank
 * ("1".."10") → number of slots. Mirrors SpellSlotsMapSchema's rank keys
 * but only carries counts (no runtime `value`/`prepared` state — this is
 * the class's static progression table, not a live spellcasting entry).
 */
export const ClassSpellSlotsEntrySchema = z.object({
  level: z.number().int().min(1).max(20),
  slots: z.record(z.string(), z.number().int().min(0)).default({}),
});
export type ClassSpellSlotsEntry = z.infer<typeof ClassSpellSlotsEntrySchema>;

/**
 * Optional spellcasting progression table for the class (e.g. Magus arcane
 * prepared casting). Absent for non-casting classes.
 *
 * `tradition` is nullable: most classes fix it (Wizard → arcane), but the
 * Sorcerer's tradition is determined by the chosen bloodline (r22) — the
 * class doc carries `tradition: null` plus `traditionByBloodline` (bloodline
 * slug → tradition) instead. `traditionByBloodline` values are ALSO nullable
 * for a bloodline whose tradition can't be resolved statically (e.g.
 * Draconic, whose tradition depends on a nested "Draconic Exemplars"
 * sub-choice not modeled this round — same boundary as the Wizard's "School
 * of Rooted Wisdom") — the client falls back to a documented default for
 * those. Absent for classes with a fixed tradition.
 */
export const ClassSpellcastingSchema = z.object({
  tradition: SpellTraditionSchema.nullable(),
  type: z.enum(["prepared", "spontaneous"]),
  ability: AbilitySlugSchema,
  cantripsKnown: z.array(CantripsKnownEntrySchema).default([]),
  slots: z.array(ClassSpellSlotsEntrySchema).default([]),
  traditionByBloodline: z.record(z.string(), SpellTraditionSchema.nullable()).optional(),
});
export type ClassSpellcasting = z.infer<typeof ClassSpellcastingSchema>;

/** Reference to a classFeature item granted at a given level. */
export const ClassFeatureRefSchema = z.object({
  level: z.number().int().min(1).max(20),
  uuid: z.string().min(1),
  name: z.string().min(1),
});
export type ClassFeatureRef = z.infer<typeof ClassFeatureRefSchema>;

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
    /** Perception proficiency rank at level 1. */
    perception: ProficiencyRankSchema.default(0),
    /** Saving throw proficiency ranks at level 1. */
    savingThrows: z
      .object({
        fortitude: ProficiencyRankSchema.optional(),
        reflex: ProficiencyRankSchema.optional(),
        will: ProficiencyRankSchema.optional(),
      })
      .default({}),
    /** Armor category proficiency ranks at level 1 (mirrors vendor `defenses`). */
    defenses: z.record(z.string(), ProficiencyRankSchema).default({}),
    /** Weapon category proficiency ranks at level 1 (mirrors vendor `attacks`). */
    attacks: z.record(z.string(), ProficiencyRankSchema).default({}),
    /** Class DC proficiency rank at level 1. */
    classDC: ProficiencyRankSchema.default(0),
    /**
     * Impulse-attack proficiency rank at level 1 (Kineticist; the impulse
     * attack roll uses this rank + the class's key ability — Rage of Elements
     * p.14). Default 0 for classes without impulses. Upgraded over levels via
     * `proficiencyUpgrades` with `stat: "impulse"`.
     */
    impulse: ProficiencyRankSchema.default(0),
    /** Feat slot levels by category (ancestry/class/general/skill). */
    featLevels: ClassFeatLevelsSchema,
    /** Levels at which the class grants a free skill increase. */
    skillIncreaseLevels: z.array(z.number().int().min(1).max(20)).default([]),
    /** Levels at which the class grants a free ability boost set (default PF2e cadence). */
    abilityBoostLevels: z.array(z.number().int().min(1).max(20)).default([5, 10, 15, 20]),
    /** Skill(s) trained at level 1 by the class, plus free additional choices. */
    trainedSkills: ClassTrainedSkillsSchema,
    /** Level-by-level proficiency rank upgrades (perception, saves, classDC, weapons, ...). */
    proficiencyUpgrades: z.array(ProficiencyUpgradeSchema).default([]),
    /** Spellcasting progression table, if this class grants spellcasting. */
    spellcasting: ClassSpellcastingSchema.optional(),
    /** classFeature item references granted at each level. */
    featuresByLevel: z.array(ClassFeatureRefSchema).default([]),
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
