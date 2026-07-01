/**
 * @fusion/system-sf2e — Item "weapon" schema.
 *
 * Mirrors `systems/pf2e/src/schemas/item-weapon.ts`: same base shape
 * (damage, category, runes, range, reload, bulk, price, traits — REQ-SF2-004,
 * REQ-SF2-021), normalized post-import the same way as PF2e (importer flattens
 * Foundry's `{ value: ... }` wrapper objects like `system.reload.value` →
 * `system.reload`; see tools/importer-pf2e/analysis/02-schema-actor-item.md
 * §weapon). SF2e adds the Tech weapon delta (D-SF2-02, TechWeaponExtension
 * from spec 18):
 *
 *   - `grade`: quality tier replacing runes for Tech weapons (WEAPON_GRADES).
 *     Delta from spec 18: the real compendium field name is `grade`, not
 *     `tier` (see types.ts WeaponGrade docstring). Optional — absent/null for
 *     Analog weapons, which keep using `runes` normally (REQ-SF2-021).
 *   - `ammo`: `{ baseType, builtIn, capacity }` — battery/projectile-ammo/
 *     chem-tank charge source (REQ-SF2-018, confirmed on every Tech weapon
 *     in vendor/pf2e/packs/sf2e/equipment/weapons/*.json). `null` for
 *     weapons with no ammo tracking (e.g. Baton).
 *   - `charges`: `{ current, max }` — current charge state tracked
 *     separately from `ammo.capacity` (the max), REQ-SF2-020.
 *   - `expend`: number of charges consumed per shot (real field name in the
 *     compendium data; e.g. Artillery Laser expends 2 per shot). Maps to
 *     REQ-SF2-020's charge-consumption rule.
 *   - `sfTraits` is NOT a separate field: SF2e-exclusive traits (tech,
 *     automatic, area, tracking, analog, injection, line, unwieldy, seeking)
 *     live in the same `traits.value` string array as all other traits —
 *     confirmed by real data (e.g. Arc Rifle traits: ["arc", "tech"]). A
 *     dedicated `sfTraits` field would duplicate data already in `traits`;
 *     mechanical interpretation of these traits (REQ-SF2-019) is engine/
 *     derivation-layer work for a later agent, not a schema concern.
 *
 * Clean-room: spec 18 §Modelo de Dados (TechWeaponExtension); ORC data only.
 * REQ-SF2-003, REQ-SF2-018..021, REQ-SF2-047.
 */

import { z } from "zod";
import {
  AmmoSchema,
  ChargesSchema,
  DamageTypeSchema,
  EffectRuleSchema,
  PublicationSchema,
  TraitsBlockSchema,
  WeaponCategorySchema,
  WeaponGradeSchema,
  WeaponGroupSchema,
  WeaponRunesSchema,
} from "../schema-primitives.js";

// ---------------------------------------------------------------------------
// Damage block — identical to PF2e.
// ---------------------------------------------------------------------------

export const WeaponDamageSchema = z.object({
  dice: z.number().int().positive(),
  die: z.string().regex(/^d\d+$/),
  damageType: DamageTypeSchema,
  modifier: z.number().int().default(0),
  persistent: z
    .object({
      formula: z.string(),
      damageType: DamageTypeSchema,
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// WeaponSystem (delta: grade, ammo, charges, expend — D-SF2-02).
// ---------------------------------------------------------------------------

export const WeaponSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    damage: WeaponDamageSchema,
    category: WeaponCategorySchema,
    weaponGroup: WeaponGroupSchema.optional(),
    /** Rune fields — used by Analog weapons (no `tech` trait). REQ-SF2-021. */
    runes: WeaponRunesSchema.default({ potency: 0, striking: 0, property: [] }),
    /** Quality grade — used by Tech weapons instead of runes. REQ-SF2-018, D-SF2-02. */
    grade: WeaponGradeSchema.optional(),
    /** Ammo/charge source. `null`/absent = no ammo tracking (e.g. melee Analog). REQ-SF2-018. */
    ammo: AmmoSchema.optional(),
    /** Current/max charges loaded. Present when `ammo` is present. REQ-SF2-020. */
    charges: ChargesSchema.optional(),
    /** Charges consumed per shot (real compendium field: `expend`). REQ-SF2-020. */
    expend: z.number().int().min(0).nullable().optional(),
    /** Null = melee; positive number = range in feet. */
    range: z.number().int().positive().nullable().default(null),
    /** Reload time in actions. "-" = no reload. Normalized from `reload.value`. */
    reload: z.string().default("-"),
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
    /** Usage (e.g., "held-in-one-hand", "held-in-two-hands"). Normalized from `usage.value`. */
    usage: z.string().default("held-in-one-hand"),
    size: z.enum(["tiny", "sm", "med", "lg", "huge", "grg"]).default("med"),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    bonus: z.number().int().default(0),
    bonusDamage: z.number().int().default(0),
    baseItem: z.string().optional(),
    material: z.object({ grade: z.string().optional(), type: z.string().optional() }).optional(),
    hp: z.object({ value: z.number().int().min(0), max: z.number().int().min(0) }).optional(),
    hardness: z.number().int().min(0).optional(),
    ammoRef: z.string().nullable().optional(),
    splashDamage: z.number().int().min(0).optional(),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();

export type WeaponSystem = z.infer<typeof WeaponSystemSchema>;

export function parseWeaponSystem(data: unknown): WeaponSystem {
  return WeaponSystemSchema.parse(data);
}

/** True when the weapon has the `tech` trait (uses grade/ammo/charges instead of runes). */
export function isTechWeapon(system: Pick<WeaponSystem, "traits">): boolean {
  return system.traits.value.includes("tech");
}
