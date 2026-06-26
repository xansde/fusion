/**
 * @fusion/system-pf2e — Item "spell" schema.
 *
 * Aligned to the Fireball example in 02-schema-actor-item.md.
 * Key fields: level, traditions, area, range, defense, damage, heightening.
 *
 * Clean-room: spec 17 §Tipos de Item; ORC/OGL only.
 * REQ-PF2-003, REQ-PF2-080..084.
 */

import { z } from "zod";
import {
  DamageTypeSchema,
  EffectRuleSchema,
  PublicationSchema,
  RaritySchema,
  SaveStatisticSchema,
  SpellTraditionSchema,
} from "../schema-primitives.js";

// ---------------------------------------------------------------------------
// Damage entries (keyed map — matches PF2e JSON format)
// ---------------------------------------------------------------------------

const SpellDamageEntrySchema = z.object({
  /** Dice formula (e.g. "6d6"). */
  formula: z.string(),
  type: DamageTypeSchema,
  /** Damage kinds: "damage" | "healing". */
  kinds: z.array(z.string()).default(["damage"]),
  /** Whether the caster's ability mod is added. */
  applyMod: z.boolean().default(false),
  /** Category modifier (splash, persistent). */
  category: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Heightening
// ---------------------------------------------------------------------------

const HeighteningSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    /** Every N ranks the spell is heightened. */
    interval: z.number().int().positive(),
    /** Map of damage-entry-key → formula delta per interval. */
    damage: z.record(z.string(), z.string()).optional(),
    area: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal("fixed"),
    /** Explicit per-rank overrides. */
    levels: z.record(z.string(), z.unknown()).optional(),
  }),
]);

// ---------------------------------------------------------------------------
// SpellSystem
// ---------------------------------------------------------------------------

export const SpellSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Spell rank (1–10; 0 = cantrip). REQ-PF2-082 */
    level: z.number().int().min(0).max(10),
    traits: z.object({
      rarity: RaritySchema.default("common"),
      traditions: z.array(SpellTraditionSchema).default([]),
      value: z.array(z.string()).default([]),
    }),
    /** Casting time ("1", "2", "3" actions, "reaction", "free"). */
    castTime: z.string().default("2"),
    /** Range description ("touch", "30 feet", "500 feet"). */
    range: z.string().optional(),
    /** Area of effect. */
    area: z
      .object({
        type: z.enum(["burst", "cone", "line", "emanation"]),
        value: z.number().int().positive(),
      })
      .optional(),
    /** Target description. */
    target: z.string().optional(),
    /** Duration description. */
    duration: z.object({ value: z.string(), sustained: z.boolean().default(false) }).optional(),
    /** Defense — save or spell attack. */
    defense: z
      .object({
        save: z
          .object({
            statistic: SaveStatisticSchema,
            /** True = basic save (0/half/full/double). REQ-PF2-041 */
            basic: z.boolean().default(false),
          })
          .optional(),
        spellAttack: z.boolean().optional(),
      })
      .optional(),
    /** Damage map: "0" | "1" | ... → entry. */
    damage: z.record(z.string(), SpellDamageEntrySchema).default({}),
    /** Heightening rules. REQ-PF2-082 */
    heightening: HeighteningSchema.optional(),
    /** Counteraction eligible. */
    counteraction: z.boolean().default(false),
    /** Material cost for casting. */
    cost: z.string().optional(),
    /** Requirements for casting. */
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
