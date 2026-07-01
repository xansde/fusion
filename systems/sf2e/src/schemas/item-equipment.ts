/**
 * @fusion/system-sf2e — Item schemas for equipment, consumable, shield,
 * treasure, container, action/ability, melee, lore, ancestry (species),
 * background, class.
 *
 * Mirrors `systems/pf2e/src/schemas/item-equipment.ts` (REQ-SF2-004,
 * REQ-SF2-009..010, REQ-SF2-015..016). All subtype shapes are identical to
 * PF2e's "MVP simplified" representation (boosts/skills as flat arrays or
 * records) — the real SF2e compendium data (vendor/pf2e/packs/sf2e/**)
 * carries a richer rules-driven shape (ActiveEffectLike/GrantItem/ChoiceSet
 * rule elements, `boosts`/`flaws` as index-keyed objects, `trainedSkills`
 * with `lore`/`value`) that is a strict superset and passes through
 * unchanged via `.passthrough()`, same as PF2e.
 *
 * SF2e-specific deltas noted per subtype below:
 *
 *   - `equipment`: gains `system.credits` + `system.isCredstick` for
 *     credsticks (D-SF2-05, REQ-SF2-029). Augmentations are imported as a
 *     dedicated `augmentation` subtype (item-augmentation.ts), NOT as
 *     `equipment`, even though the raw compendium data stores them as
 *     `type: "equipment"` — the importer (later agent) is responsible for
 *     detecting `usage.value === "implanted"` and remapping to the
 *     `augmentation` subtype at transform time (REQ-SF2-023).
 *   - `consumable`: the real data splits ammunition into a separate
 *     Foundry `type: "ammo"` (uses `system.uses.{value,max,autoDestroy}`
 *     instead of PF2e's `system.charges.{value,max}`) and everyday
 *     consumables keep `type: "consumable"`. Both map to this same
 *     `ConsumableSystemSchema` post-import; `charges` stays the canonical
 *     Fusion field name (importer normalizes `uses` → `charges`, mirroring
 *     how `weapon.reload.value` is flattened to `weapon.reload` in PF2e).
 *   - `container`: the real data uses Foundry `type: "backpack"` for bags/
 *     pouches (`system.bulk.capacity` instead of a top-level `capacity`
 *     field) — importer maps `backpack` → `container` subtype, same
 *     shape as PF2e's ContainerSystemSchema.
 *   - `treasure`: credsticks are NOT a `treasure` subtype in the spec
 *     (D-SF2-05, REQ-SF2-029 — they are `equipment` with `isCredstick`).
 *     `TreasureSystemSchema` is kept for completeness/parity with PF2e
 *     (raw commodity items, gems, etc. that aren't credsticks) but is
 *     expected to see little use in the SF2e MVP subset.
 *   - `ancestry` (Species, D-SF2-08), `background`, `class`, `heritage`:
 *     structurally identical to PF2e — the `displayName: "Species"`
 *     override for ancestry is a manifest/i18n concern (REQ-SF2-003),
 *     not a schema concern.
 *
 * Clean-room: spec 18 §Tipos de Item; ORC data cross-checked against
 * vendor/pf2e/packs/sf2e/{equipment,heritages,backgrounds,classes,ancestries}.
 * REQ-SF2-003, REQ-SF2-004, REQ-SF2-009..010, REQ-SF2-015..016,
 * REQ-SF2-023, REQ-SF2-029.
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
// equipment (generic physical item; also credsticks — D-SF2-05, REQ-SF2-029)
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
    /** Credits carried by this item, when it's a credstick. REQ-SF2-029. */
    credits: z.number().int().min(0).optional(),
    /** True when this equipment item is a credstick. REQ-SF2-029. */
    isCredstick: z.boolean().default(false),
  })
  .passthrough();
export type EquipmentSystem = z.infer<typeof EquipmentSystemSchema>;
export const parseEquipmentSystem = (data: unknown): EquipmentSystem =>
  EquipmentSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// consumable (potion analog, ammunition, batteries, spell gems, etc.)
// ---------------------------------------------------------------------------

export const ConsumableSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    category: z.string().default("other"),
    /** Normalized from either `system.charges` (PF2e) or `system.uses` (SF2e `ammo` type). */
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
// ---------------------------------------------------------------------------

export const ShieldSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    acBonus: z.number().int().min(0),
    hardness: z.number().int().min(0).default(0),
    hp: z
      .object({ value: z.number().int().min(0), max: z.number().int().min(0) })
      .default({ value: 0, max: 0 }),
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
// treasure (raw commodities/gems; credsticks are `equipment`, not this — see
// module docstring). Kept for parity with PF2e and forward compatibility.
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
// container (bags/pouches; real data uses Foundry type "backpack")
// ---------------------------------------------------------------------------

export const ContainerSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    capacity: z.number().min(0).default(0),
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
// action / ability (NPC abilities, basic game actions, Envoy Directives —
// REQ-SF2-013)
// ---------------------------------------------------------------------------

export const ActionSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    actionType: z.object({ value: z.enum(["passive", "action", "reaction", "free"]) }),
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
// ---------------------------------------------------------------------------

const MeleeDamageEntrySchema = z.object({
  formula: z.string(),
  damageType: DamageTypeSchema,
  category: z.string().nullable().optional(),
});

export const MeleeSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    bonus: z.object({ value: z.number().int() }),
    damage: z.object({
      formula: z.string(),
      damageType: DamageTypeSchema,
    }),
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
// ---------------------------------------------------------------------------

export const LoreSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    proficient: z.object({ value: ProficiencyRankSchema }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
  })
  .passthrough();
export type LoreSystem = z.infer<typeof LoreSystemSchema>;
export const parseLoreSystem = (data: unknown): LoreSystem => LoreSystemSchema.parse(data);

// ---------------------------------------------------------------------------
// ancestry (D-SF2-08: Species. Displayed as "Species" via i18n override —
// REQ-SF2-003 — but the document subtype stays `ancestry`, no schema delta)
// ---------------------------------------------------------------------------

export const AncestrySystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    hp: z.number().int().min(0),
    speed: z.number().int().positive().default(25),
    size: z.enum(["tiny", "sm", "med", "lg", "huge", "grg"]).default("med"),
    boosts: z.array(z.string()).default([]),
    flaws: z.array(z.string()).default([]),
    languages: z.object({ value: z.array(z.string()).default([]) }).default({ value: [] }),
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
// background
// ---------------------------------------------------------------------------

export const BackgroundSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    boosts: z.array(z.string()).default([]),
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
// class (6 SF2e classes: Envoy, Mystic, Operative, Solarian, Soldier,
// Witchwarper — REQ-SF2-009)
// ---------------------------------------------------------------------------

export const ClassSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    hp: z.number().int().positive(),
    keyAbility: z.array(z.string()),
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
// heritage (Species heritage — e.g. Artificial Scion Android)
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
