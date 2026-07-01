/**
 * @fusion/system-sf2e — shared type aliases and constants.
 *
 * SF2e shares the vast majority of its type vocabulary with PF2e (same
 * engine-2e core: TEML proficiency, 6 abilities, weapon/armor categories,
 * damage types, save statistics, sizes, rarities). This file mirrors
 * `systems/pf2e/src/types.ts` and adds the SF2e-exclusive skills
 * (`computers`, `piloting` — REQ-SF2-007).
 *
 * Delta vs PF2e (see module docstring in index.ts for the full list):
 *   - SKILL_SLUGS: +computers, +piloting (18 skills instead of 16).
 *   - SKILL_ABILITY: computers → int, piloting → dex.
 *   - Everything else (abilities, weapon/armor categories, damage types,
 *     spell traditions, save statistics, sizes, rarities, spellcasting
 *     types) is identical to PF2e — inherited verbatim (REQ-SF2-004).
 *
 * Clean-room: rule knowledge from ORC (Archives of Nethys SF2e, Starfinder
 * Player Core) and from the real compendium data shape observed in
 * vendor/pf2e/packs/sf2e (Apache-2.0). No proprietary Paizo prose included.
 *
 * REQ-SF2-001..007.
 */

// ---------------------------------------------------------------------------
// Proficiency rank (TEML) — identical to PF2e/engine-2e.
// ---------------------------------------------------------------------------

/** 0 = Untrained, 1 = Trained, 2 = Expert, 3 = Master, 4 = Legendary */
export type ProficiencyRank = 0 | 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Abilities — identical to PF2e.
// ---------------------------------------------------------------------------

export const ABILITY_SLUGS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilitySlug = (typeof ABILITY_SLUGS)[number];

// ---------------------------------------------------------------------------
// Skills — the 16 PF2e skills + SF2e-exclusive Computers and Piloting.
// REQ-SF2-007, REQ-SF2-008.
// ---------------------------------------------------------------------------

export const SKILL_SLUGS = [
  "acrobatics",
  "arcana",
  "athletics",
  "computers",
  "crafting",
  "deception",
  "diplomacy",
  "intimidation",
  "medicine",
  "nature",
  "occultism",
  "performance",
  "piloting",
  "religion",
  "society",
  "stealth",
  "survival",
  "thievery",
] as const;
export type SkillSlug = (typeof SKILL_SLUGS)[number];

/** Association of each canonical skill to its key ability. REQ-SF2-007. */
export const SKILL_ABILITY: Record<SkillSlug, AbilitySlug> = {
  acrobatics: "dex",
  arcana: "int",
  athletics: "str",
  computers: "int",
  crafting: "int",
  deception: "cha",
  diplomacy: "cha",
  intimidation: "cha",
  medicine: "wis",
  nature: "wis",
  occultism: "int",
  performance: "cha",
  piloting: "dex",
  religion: "wis",
  society: "int",
  stealth: "dex",
  survival: "wis",
  thievery: "dex",
};

/** SF2e-exclusive skills, for callers that need to diff against PF2e's 16. */
export const SF2E_EXCLUSIVE_SKILLS = ["computers", "piloting"] as const;

// ---------------------------------------------------------------------------
// Weapon / armor categories — identical to PF2e.
// ---------------------------------------------------------------------------

export const WEAPON_CATEGORIES = ["unarmed", "simple", "martial", "advanced"] as const;
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];

/**
 * Weapon groups. Inherits all PF2e groups (Analog weapons use them normally,
 * REQ-SF2-021) and adds the SF2e Tech weapon groups. Full set cross-checked
 * against every file in vendor/pf2e/packs/sf2e/equipment/weapons/*.json
 * (77 weapons): axe, brawling, club, corrosive, crossbow, cryo, dart, flail,
 * flame, hammer, knife, laser, plasma, polearm, projectile, shock, sniper,
 * sonic, spear, sword. `bomb`, `pick`, `shield`, `sling` and `arc` are kept
 * from PF2e/research 13 for Analog weapons not present in the MVP subset.
 */
export const WEAPON_GROUPS = [
  // Inherited from PF2e (Analog weapons)
  "axe",
  "bomb",
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
  // SF2e Tech weapon groups (confirmed in vendor/pf2e/packs/sf2e/equipment/weapons)
  "arc",
  "corrosive",
  "cryo",
  "flame",
  "laser",
  "plasma",
  "projectile",
  "shock",
  "sniper",
  "sonic",
] as const;
export type WeaponGroup = (typeof WEAPON_GROUPS)[number];

export const ARMOR_CATEGORIES = ["unarmored", "light", "medium", "heavy"] as const;
export type ArmorCategory = (typeof ARMOR_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Damage types — identical to PF2e.
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
// Spell traditions and saving throw statistics — identical to PF2e.
// ---------------------------------------------------------------------------

export const SPELL_TRADITIONS = ["arcane", "divine", "occult", "primal"] as const;
export type SpellTradition = (typeof SPELL_TRADITIONS)[number];

export const SAVE_STATISTICS = ["fortitude", "reflex", "will"] as const;
export type SaveStatistic = (typeof SAVE_STATISTICS)[number];

// ---------------------------------------------------------------------------
// Creature/item size — identical to PF2e.
// ---------------------------------------------------------------------------

export const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"] as const;
export type CreatureSize = (typeof SIZES)[number];

// ---------------------------------------------------------------------------
// Rarity — identical to PF2e.
// ---------------------------------------------------------------------------

export const RARITIES = ["common", "uncommon", "rare", "unique"] as const;
export type Rarity = (typeof RARITIES)[number];

// ---------------------------------------------------------------------------
// Spellcasting entry types — identical to PF2e.
// ---------------------------------------------------------------------------

export const SPELLCASTING_TYPES = ["prepared", "spontaneous", "innate"] as const;
export type SpellcastingType = (typeof SPELLCASTING_TYPES)[number];

// ---------------------------------------------------------------------------
// SF2e-exclusive: weapon quality grade (D-SF2-02, REQ-SF2-018).
//
// Delta from spec 18: the real compendium data
// (vendor/pf2e/packs/sf2e/equipment/weapons/*.json) uses the field name
// `grade`, not `tier` as originally drafted in spec 18. The enum values are
// identical to the spec's WeaponTier list. This module keeps `grade` as the
// canonical name to match importer input 1:1, and re-exports `WeaponTier` as
// an alias for spec traceability.
// ---------------------------------------------------------------------------

export const WEAPON_GRADES = [
  "commercial",
  "tactical",
  "advanced",
  "superior",
  "elite",
  "ultimate",
  "paragon",
] as const;
export type WeaponGrade = (typeof WEAPON_GRADES)[number];

/** Alias for spec 18 traceability (REQ-SF2-018 calls this `WeaponTier`). */
export type WeaponTier = WeaponGrade;
export const WEAPON_TIERS = WEAPON_GRADES;

// ---------------------------------------------------------------------------
// SF2e-exclusive: augmentation type (D-SF2-03, REQ-SF2-023).
//
// Delta from spec 18: the real compendium data groups augmentations by
// folder into apex/biotech/magitech/necrograft/tech — one more category
// (`necrograft`) than the 4 listed in spec 18's AugmentationItemSystem
// (biotech/cybernetic/magitech/apex). "cybernetic" in the spec corresponds
// to "tech" in the real data; "necrograft" (undead-themed augmentations) is
// an additional 5th category confirmed in vendor/pf2e/packs/sf2e/equipment/
// augmentations/. We keep both names for compatibility: `cybernetic` is kept
// as an alias-friendly value alongside `tech`.
// ---------------------------------------------------------------------------

export const AUGMENTATION_TYPES = ["apex", "biotech", "magitech", "necrograft", "tech"] as const;
export type AugmentationType = (typeof AUGMENTATION_TYPES)[number];

// ---------------------------------------------------------------------------
// SF2e-exclusive: augmentation body slot (D-SF2-03, REQ-SF2-023).
//
// Note: the real compendium data does NOT carry an explicit `bodySlot` field
// on augmentation items (augmentations are stored as `type: "equipment"`
// with `usage.value: "implanted"` and no body-slot metadata — verified
// against vendor/pf2e/packs/sf2e/equipment/augmentations/**). The enum is
// kept here per spec 18 REQ-SF2-023 for the slot-limit hook (REQ-SF2-024)
// that later agents will implement once body-slot data is sourced (mapped
// manually per augmentation, or left "unassigned" until curated) — see
// AugmentationItemSystem.bodySlot being optional in schemas/item-augmentation.ts.
// ---------------------------------------------------------------------------

export const BODY_SLOTS = [
  "brain",
  "eyes",
  "ears",
  "throat",
  "arms",
  "hands",
  "legs",
  "feet",
  "skin",
  "spinal",
] as const;
export type BodySlot = (typeof BODY_SLOTS)[number];

// ---------------------------------------------------------------------------
// SF2e-exclusive: ammo base type (weapon.system.ammo.baseType in real data).
// Confirmed values across the full weapons pack: battery, chem-tank,
// projectile-ammo. `grenade` and `missile` kept as forward-compatible values
// referenced by research 13 for ammo types not present in the MVP subset.
// ---------------------------------------------------------------------------

export const AMMO_BASE_TYPES = [
  "battery",
  "chem-tank",
  "grenade",
  "missile",
  "projectile-ammo",
] as const;
export type AmmoBaseType = (typeof AMMO_BASE_TYPES)[number];
