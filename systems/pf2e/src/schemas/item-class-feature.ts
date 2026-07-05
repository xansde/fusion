/**
 * @fusion/system-pf2e — Item "classFeature" schema.
 *
 * Class features are granted automatically at specific character levels
 * (e.g. Magus's "Arcane Spellcasting (Magus)" at level 1, "Weapon Expertise"
 * at level 5). Shape mirrors item-feat.ts since both carry effect rules
 * processed by the effects engine, but classFeatures are never chosen from
 * a feat list — they're referenced by `ClassSystem.featuresByLevel`
 * (R10-A, DEC-R10-01).
 *
 * Clean-room: spec 17 §Tipos de Item; ORC/OGL only.
 * REQ-PF2-003.
 */

import { z } from "zod";
import { EffectRuleSchema, PublicationSchema, TraitsBlockSchema } from "../schema-primitives.js";

export const ClassFeatureSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Character level at which this feature is granted. */
    level: z.number().int().min(1).max(20),
    /**
     * Category slug. "classfeature" covers ordinary class features;
     * "hybridStudy" marks Magus Hybrid Study choices (a sub-choice slot
     * within a classFeature, e.g. Starlit Span / Inexorable Iron).
     */
    category: z.string().default("classfeature"),
    /** Prerequisites (displayed text). */
    prerequisites: z.array(z.object({ value: z.string() })).default([]),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();

export type ClassFeatureSystem = z.infer<typeof ClassFeatureSystemSchema>;

export function parseClassFeatureSystem(data: unknown): ClassFeatureSystem {
  return ClassFeatureSystemSchema.parse(data);
}
