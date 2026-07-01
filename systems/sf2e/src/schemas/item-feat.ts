/**
 * @fusion/system-sf2e — Item "feat" schema.
 *
 * Verbatim inheritance from `systems/pf2e/src/schemas/item-feat.ts`
 * (REQ-SF2-004). Used for class feats (Envoy Directives, Operative
 * specializations, etc.), ancestry/species feats, general and skill feats —
 * REQ-SF2-009..010, REQ-SF2-013.
 *
 * Clean-room: spec 18 §Tipos de Item; ORC data only.
 * REQ-SF2-003, REQ-SF2-004.
 */

import { z } from "zod";
import { EffectRuleSchema, PublicationSchema, TraitsBlockSchema } from "../schema-primitives.js";

export const FeatSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    level: z.number().int().min(1),
    /** Category slug (e.g. "skill", "ancestry", "class", "general", "starship-role" [V2]). */
    category: z.string().default("general"),
    actionType: z.enum(["passive", "action", "reaction", "free"]).default("passive"),
    actions: z.number().int().min(1).max(3).nullable().default(null),
    frequency: z
      .object({
        max: z.number().int().positive(),
        per: z.enum(["day", "encounter", "hour", "minute", "turn"]),
      })
      .optional(),
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
