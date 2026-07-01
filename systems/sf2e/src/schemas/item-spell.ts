/**
 * @fusion/system-sf2e — Item "spell" schema.
 *
 * Verbatim inheritance from `systems/pf2e/src/schemas/item-spell.ts`
 * (REQ-SF2-004: spell system — slots, heightening, traditions — inherited
 * unchanged). SF2e spells (Mystic, Witchwarper) use the same 4 traditions
 * (arcane/divine/occult/primal) and the same damage/heightening shape;
 * confirmed structurally identical in vendor/pf2e/packs/sf2e/spells/*.json.
 *
 * Clean-room: spec 18 §Tipos de Item; ORC data only.
 * REQ-SF2-003, REQ-SF2-004.
 */

import { z } from "zod";
import {
  DamageTypeSchema,
  EffectRuleSchema,
  PublicationSchema,
  RaritySchema,
  SaveStatisticSchema,
} from "../schema-primitives.js";
import { SPELL_TRADITIONS } from "../types.js";

const SpellTraditionSchema = z.enum(SPELL_TRADITIONS);

const SpellDamageEntrySchema = z.object({
  formula: z.string(),
  type: DamageTypeSchema,
  kinds: z.array(z.string()).default(["damage"]),
  applyMod: z.boolean().default(false),
  category: z.string().nullable().optional(),
});

const HeighteningSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    interval: z.number().int().positive(),
    damage: z.record(z.string(), z.string()).optional(),
    area: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal("fixed"),
    levels: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export const SpellSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    level: z.number().int().min(0).max(10),
    traits: z.object({
      rarity: RaritySchema.default("common"),
      traditions: z.array(SpellTraditionSchema).default([]),
      value: z.array(z.string()).default([]),
    }),
    castTime: z.string().default("2"),
    range: z.string().optional(),
    area: z
      .object({
        type: z.enum(["burst", "cone", "line", "emanation"]),
        value: z.number().int().positive(),
      })
      .optional(),
    target: z.string().optional(),
    duration: z.object({ value: z.string(), sustained: z.boolean().default(false) }).optional(),
    defense: z
      .object({
        save: z
          .object({
            statistic: SaveStatisticSchema,
            basic: z.boolean().default(false),
          })
          .optional(),
        spellAttack: z.boolean().optional(),
      })
      .optional(),
    damage: z.record(z.string(), SpellDamageEntrySchema).default({}),
    heightening: HeighteningSchema.optional(),
    counteraction: z.boolean().default(false),
    cost: z.string().optional(),
    requirements: z.string().optional(),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();

export type SpellSystem = z.infer<typeof SpellSystemSchema>;

export function parseSpellSystem(data: unknown): SpellSystem {
  return SpellSystemSchema.parse(data);
}
