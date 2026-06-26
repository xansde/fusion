/**
 * @fusion/system-pf2e — Item "armor" schema.
 *
 * Clean-room: spec 17 §Tipos de Item; ORC/OGL only.
 * REQ-PF2-003, REQ-PF2-020.
 */

import { z } from "zod";
import {
  ArmorCategorySchema,
  ArmorRunesSchema,
  EffectRuleSchema,
  PublicationSchema,
  TraitsBlockSchema,
} from "../schema-primitives.js";

export const ArmorSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** unarmored / light / medium / heavy. REQ-PF2-020 */
    category: ArmorCategorySchema,
    /** Armor group — affects critical specialization. */
    group: z.string().optional(),
    /** Item AC bonus (before potency rune). REQ-PF2-020 */
    acBonus: z.number().int().min(0),
    /** Maximum Dexterity bonus allowed (null = no cap). REQ-PF2-020 */
    dexCap: z.number().int().nullable().default(null),
    /** Armor Check Penalty (negative; 0 = no penalty). */
    checkPenalty: z.number().int().max(0).default(0),
    /** Speed penalty while wearing (negative; 0 = no penalty). */
    speedPenalty: z.number().int().max(0).default(0),
    /** Minimum Strength score to avoid penalty. */
    strength: z.number().int().min(0).optional(),
    runes: ArmorRunesSchema.default({ potency: 0, resilient: 0, property: [] }),
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
