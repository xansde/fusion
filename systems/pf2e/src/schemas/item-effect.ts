/**
 * @fusion/system-pf2e — Item "effect" schema.
 *
 * Effects carry declarative modifier rules (FlatModifier-like) and optional
 * duration + badge for tracking. They are embedded items on actors and
 * processed by the effects engine during prepareData.
 *
 * Clean-room: spec 17 §Tipos de Item; ORC/OGL only.
 * REQ-PF2-003, DEC-PF2-04.
 */

import { z } from "zod";
import { DamageTypeSchema, EffectRuleSchema, IwrBlockSchema } from "../schema-primitives.js";

// ---------------------------------------------------------------------------
// Extra damage (DamageDice static — MVP subset of DamageDice RE)
// ---------------------------------------------------------------------------

const ExtraDamageSchema = z.object({
  dice: z.number().int().positive(),
  die: z.number().int().positive(),
  damageType: DamageTypeSchema,
});

// ---------------------------------------------------------------------------
// EffectSystem
// ---------------------------------------------------------------------------

export const EffectSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    slug: z.string().optional(),
    /**
     * Duration of the effect.
     * value = -1 means "unlimited / permanent".
     */
    duration: z
      .object({
        value: z.number().int(),
        unit: z.enum(["round", "minute", "hour", "day", "encounter", "unlimited"]),
        sustained: z.boolean().default(false),
        expiry: z.enum(["turn-start", "turn-end", "round-end"]).nullable().optional(),
      })
      .optional(),
    /**
     * Badge for tracking incremental effects (counter / value).
     * E.g. clumsy badge.value = 2 → clumsy 2.
     */
    badge: z
      .object({
        type: z.enum(["counter", "value"]),
        value: z.number().int().min(0),
        max: z.number().int().positive().optional(),
      })
      .optional(),
    /** Effect rules (FlatModifier, RollOption, Note, ToggleCondition, IWR). */
    rules: z.array(EffectRuleSchema).default([]),
    /** Conditions granted while this effect is active. */
    grantedConditions: z
      .array(z.object({ slug: z.string(), value: z.number().int().min(1).optional() }))
      .default([]),
    /**
     * IWR declared by this effect (e.g., a potion that grants fire resistance).
     * Processed by the effects engine into the actor's IWR block.
     */
    iwr: IwrBlockSchema.optional(),
    /** Static bonus damage dice. MVP subset of DamageDice RE. */
    extraDamage: z.array(ExtraDamageSchema).default([]),
  })
  .passthrough();

export type EffectSystem = z.infer<typeof EffectSystemSchema>;

export function parseEffectSystem(data: unknown): EffectSystem {
  return EffectSystemSchema.parse(data);
}
