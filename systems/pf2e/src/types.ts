/**
 * @fusion/system-pf2e — shared type aliases and constants.
 *
 * These types are used across schemas and helpers. They encode the PF2e
 * Remaster canonical sets (skills, abilities, proficiency ranks, etc.) as
 * TypeScript literals derived from Zod, so runtime and compile-time agree.
 *
 * Clean-room: rule knowledge from ORC/OGL (Archives of Nethys, Pathfinder
 * Player Core). No proprietary Paizo content.
 *
 * REQ-PF2-001..003.
 */

// ---------------------------------------------------------------------------
// Proficiency rank (TEML)
// ---------------------------------------------------------------------------

/** 0 = Untrained, 1 = Trained, 2 = Expert, 3 = Master, 4 = Legendary */
export type ProficiencyRank = 0 | 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

export const ABILITY_SLUGS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilitySlug = (typeof ABILITY_SLUGS)[number];

// ---------------------------------------------------------------------------
// Skills (16 canonical PF2e skills + their key ability)
// REQ-PF2-012
// ---------------------------------------------------------------------------

export const SKILL_SLUGS = [
  "acrobatics",
  "arcana",
  "athletics",
  "crafting",
  "deception",
  "diplomacy",
  "intimidation",
  "medicine",
  "nature",
  "occultism",
  "performance",
  "religion",
  "society",
  "stealth",
  "survival",
  "thievery",
] as const;
export type SkillSlug = (typeof SKILL_SLUGS)[number];

/** Association of each canonical skill to its key ability. Research 13 §5.1. */
export const SKILL_ABILITY: Record<SkillSlug, AbilitySlug> = {
  acrobatics: "dex",
  arcana: "int",
  athletics: "str",
  crafting: "int",
  deception: "cha",
  diplomacy: "cha",
  intimidation: "cha",
  medicine: "wis",
  nature: "wis",
  occultism: "int",
  performance: "cha",
  religion: "wis",
  society: "int",
  stealth: "dex",
  survival: "wis",
  thievery: "dex",
};

// ---------------------------------------------------------------------------
// Weapon / armor categories
// REQ-PF2-030..032, REQ-PF2-020
// ---------------------------------------------------------------------------

export const WEAPON_CATEGORIES = ["unarmed", "simple", "martial", "advanced"] as const;
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];

export const WEAPON_GROUPS = [
  "axe",
  "bomb",
  "bow",
  "brawling",
  "club",
  "crossbow",
  "dart",
  "flail",
  "hammer",
  "knife",
  "pick",
  "polearm",
  "shield",
  "sling",
  "spear",
  "sword",
] as const;
export type WeaponGroup = (typeof WEAPON_GROUPS)[number];

export const ARMOR_CATEGORIES = ["unarmored", "light", "medium", "heavy"] as const;
export type ArmorCategory = (typeof ARMOR_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Damage types
// REQ-PF2-060 / Research 13 §6
// ---------------------------------------------------------------------------

export const DAMAGE_TYPES = [
  "acid",
  "bleed",
  "bludgeoning",
  "chaotic",
  "cold",
  "electricity",
  "evil",
  "fire",
  "force",
  "good",
  "lawful",
  "mental",
  "negative",
  "persistent",
  "physical",
  "piercing",
  "poison",
  "positive",
  "precision",
  "slashing",
  "sonic",
  "spirit",
  "untyped",
  "vitality",
  "void",
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

// ---------------------------------------------------------------------------
// Spell traditions and saving throw statistics
// REQ-PF2-080
// ---------------------------------------------------------------------------

export const SPELL_TRADITIONS = ["arcane", "divine", "occult", "primal"] as const;
export type SpellTradition = (typeof SPELL_TRADITIONS)[number];

export const SAVE_STATISTICS = ["fortitude", "reflex", "will"] as const;
export type SaveStatistic = (typeof SAVE_STATISTICS)[number];

// ---------------------------------------------------------------------------
// Creature/item size
// ---------------------------------------------------------------------------

export const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"] as const;
export type CreatureSize = (typeof SIZES)[number];

// ---------------------------------------------------------------------------
// Rarity
// ---------------------------------------------------------------------------

export const RARITIES = ["common", "uncommon", "rare", "unique"] as const;
export type Rarity = (typeof RARITIES)[number];

// ---------------------------------------------------------------------------
// Spellcasting entry types
// REQ-PF2-080
// ---------------------------------------------------------------------------

export const SPELLCASTING_TYPES = ["prepared", "spontaneous", "innate"] as const;
export type SpellcastingType = (typeof SPELLCASTING_TYPES)[number];
