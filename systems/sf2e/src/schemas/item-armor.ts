/**
 * @fusion/system-sf2e — Item "armor" schema.
 *
 * Mirrors `systems/pf2e/src/schemas/item-armor.ts` (REQ-SF2-004). Delta:
 * adds the optional `grade` field (D-SF2-02) — confirmed present on every
 * SF2e armor in vendor/pf2e/packs/sf2e/equipment/armors/*.json (e.g. Estex
 * Suit: `"grade": "commercial"`). Armor still carries `runes` for Analog
 * armor pieces (REQ-SF2-021); `grade` and `runes` can coexist in the data
 * (grade for the base item quality, runes for property runes applied after
 * crafting) so both are kept as independent optional/defaulted fields rather
 * than a discriminated union.
 *
 * Clean-room: spec 18 §Modelo de Dados; ORC data only.
 * REQ-SF2-003, REQ-SF2-004, REQ-SF2-021.
 */

import { z } from "zod";
import {
  ArmorCategorySchema,
  ArmorRunesSchema,
  EffectRuleSchema,
  PublicationSchema,
  TraitsBlockSchema,
  WeaponGradeSchema,
} from "../schema-primitives.js";

export const ArmorSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    category: ArmorCategorySchema,
    group: z.string().optional(),
    acBonus: z.number().int().min(0),
    dexCap: z.number().int().nullable().default(null),
    checkPenalty: z.number().int().max(0).default(0),
    speedPenalty: z.number().int().max(0).default(0),
    strength: z.number().int().min(0).optional(),
    runes: ArmorRunesSchema.default({ potency: 0, resilient: 0, property: [] }),
    /** Quality grade — confirmed on all SF2e armors. REQ-SF2-018-adjacent, D-SF2-02. */
    grade: WeaponGradeSchema.optional(),
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
    size: z.enum(["tiny", "sm", "med", "lg", "huge", "grg"]).default("med"),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    baseItem: z.string().optional(),
    material: z.object({ grade: z.string().optional(), type: z.string().optional() }).optional(),
    hp: z.object({ value: z.number().int().min(0), max: z.number().int().min(0) }).optional(),
    hardness: z.number().int().min(0).optional(),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();

export type ArmorSystem = z.infer<typeof ArmorSystemSchema>;

export function parseArmorSystem(data: unknown): ArmorSystem {
  return ArmorSystemSchema.parse(data);
}
