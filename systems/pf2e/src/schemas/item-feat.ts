/**
 * @fusion/system-pf2e — Item "feat" schema.
 *
 * Feats carry effect rules (FlatModifier / ToggleCondition / etc.) that are
 * processed by the effects engine during prepareData.
 *
 * Clean-room: spec 17 §Tipos de Item; ORC/OGL only.
 * REQ-PF2-003, DEC-PF2-04.
 */

import { z } from "zod";
import { EffectRuleSchema, PublicationSchema, TraitsBlockSchema } from "../schema-primitives.js";

export const FeatSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Feat level (minimum level to take). */
    level: z.number().int().min(1),
    /** Category slug (e.g. "skill", "ancestry", "class", "general", "archetype"). */
    category: z.string().default("general"),
    /** Action type: "passive", "action", "reaction", "free". */
    actionType: z.enum(["passive", "action", "reaction", "free"]).default("passive"),
    /** Number of actions (relevant when actionType = "action"). */
    actions: z.number().int().min(1).max(3).nullable().default(null),
    /** Frequency: times-per-day, per-encounter, etc. */
    frequency: z
      .object({
        max: z.number().int().positive(),
        per: z.enum(["day", "encounter", "hour", "minute", "turn"]),
      })
      .optional(),
    /** Prerequisites (displayed text). */
    prerequisites: z.array(z.object({ value: z.string() })).default([]),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();

export type FeatSystem = z.infer<typeof FeatSystemSchema>;

export function parseFeatSystem(data: unknown): FeatSystem {
  return FeatSystemSchema.parse(data);
}
