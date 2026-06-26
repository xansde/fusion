/**
 * @fusion/system-pf2e — Item "weapon" schema.
 *
 * Aligned to the Longsword example in 02-schema-actor-item.md.
 * Key fields: damage, category, group, runes, traits, range, reload, usage.
 *
 * Clean-room: spec 17 §Tipos de Item; ORC/OGL only.
 * REQ-PF2-003, REQ-PF2-030..034.
 */

import { z } from "zod";
import {
  DamageTypeSchema,
  EffectRuleSchema,
  PublicationSchema,
  TraitsBlockSchema,
  WeaponCategorySchema,
  WeaponGroupSchema,
  WeaponRunesSchema,
} from "../schema-primitives.js";

// ---------------------------------------------------------------------------
// Damage block
// REQ-PF2-033
// ---------------------------------------------------------------------------

export const WeaponDamageSchema = z.object({
  /** Number of weapon damage dice. */
  dice: z.number().int().positive(),
  /** Die size string (e.g. "d6", "d8", "d12"). */
  die: z.string().regex(/^d\d+$/),
  damageType: DamageTypeSchema,
  /** Static modifier added to damage (usually 0 for base weapons). */
  modifier: z.number().int().default(0),
  /** Persistent damage component, if any. */
  persistent: z
    .object({
      formula: z.string(),
      damageType: DamageTypeSchema,
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// WeaponSystem
// ---------------------------------------------------------------------------

export const WeaponSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    damage: WeaponDamageSchema,
    /** Simple / martial / advanced / unarmed. REQ-PF2-032 */
    category: WeaponCategorySchema,
    /** Weapon group — affects critical specialization. [V2] REQ-PF2-036 */
    weaponGroup: WeaponGroupSchema.optional(),
    runes: WeaponRunesSchema.default({ potency: 0, striking: 0, property: [] }),
    /** Null = melee; positive number = range in feet. */
    range: z.number().int().positive().nullable().default(null),
    /** Reload time. "-" = no reload. */
    reload: z.string().default("-"),
    /** Bulk (0 = light; numbers = bulk value). */
    bulk: z.number().min(0).default(0),
    /** Price in gp/sp/cp. */
    price: z
      .object({
        gp: z.number().int().min(0).optional(),
        sp: z.number().int().min(0).optional(),
        cp: z.number().int().min(0).optional(),
      })
      .default({}),
    quantity: z.number().int().positive().default(1),
    level: z.number().int().min(0).default(0),
    /** Usage (e.g., "held-in-one-hand", "held-in-two-hands"). */
    usage: z.string().default("held-in-one-hand"),
    size: z.enum(["tiny", "sm", "med", "lg", "huge", "grg"]).default("med"),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    /** Bonus to hit (item bonus beyond potency rune). */
    bonus: z.number().int().default(0),
    /** Flat bonus damage. */
    bonusDamage: z.number().int().default(0),
    /** Canonical base weapon slug (for rune inheritance). */
    baseItem: z.string().optional(),
    /** Material (cold iron, silver, etc.). */
    material: z.object({ grade: z.string().optional(), type: z.string().optional() }).optional(),
    /** HP and hardness for breakable weapons. */
    hp: z.object({ value: z.number().int().min(0), max: z.number().int().min(0) }).optional(),
    hardness: z.number().int().min(0).optional(),
    /** Ammo reference (uuid or slug). */
    ammo: z.string().nullable().optional(),
    /** Splash damage for bomb weapons. */
    splashDamage: z.number().int().min(0).optional(),
    /** Effect rules (FlatModifier, RollOption, etc.). REQ-PF2-204 */
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();

export type WeaponSystem = z.infer<typeof WeaponSystemSchema>;

export function parseWeaponSystem(data: unknown): WeaponSystem {
  return WeaponSystemSchema.parse(data);
}
