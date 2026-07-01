/**
 * @fusion/system-sf2e — Item "effect" schema.
 *
 * Verbatim inheritance from `systems/pf2e/src/schemas/item-effect.ts`
 * (REQ-SF2-004). Confirmed by the real SF2e conditions/effects data
 * (vendor/pf2e/packs/sf2e/conditions/*.json use `type: "effect"` with the
 * same duration/badge/rules shape as PF2e — e.g. Glitching's badge counter).
 *
 * Clean-room: spec 18 §Tipos de Item; ORC data only.
 * REQ-SF2-003, REQ-SF2-004.
 */

import { z } from "zod";
import { DamageTypeSchema, EffectRuleSchema, IwrBlockSchema } from "../schema-primitives.js";

const ExtraDamageSchema = z.object({
  dice: z.number().int().positive(),
  die: z.number().int().positive(),
  damageType: DamageTypeSchema,
});

export const EffectSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    slug: z.string().optional(),
    duration: z
      .object({
        value: z.number().int(),
        unit: z.enum(["round", "minute", "hour", "day", "encounter", "unlimited"]),
        sustained: z.boolean().default(false),
        expiry: z.enum(["turn-start", "turn-end", "round-end"]).nullable().optional(),
      })
      .optional(),
    /** Badge for tracking incremental effects (e.g. Glitching's counter). */
    badge: z
      .object({
        type: z.enum(["counter", "value"]),
        value: z.number().int().min(0),
        max: z.number().int().positive().optional(),
      })
      .optional(),
    rules: z.array(EffectRuleSchema).default([]),
    grantedConditions: z
      .array(z.object({ slug: z.string(), value: z.number().int().min(1).optional() }))
      .default([]),
    iwr: IwrBlockSchema.optional(),
    extraDamage: z.array(ExtraDamageSchema).default([]),
  })
  .passthrough();

export type EffectSystem = z.infer<typeof EffectSystemSchema>;

export function parseEffectSystem(data: unknown): EffectSystem {
  return EffectSystemSchema.parse(data);
}
