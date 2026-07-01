/**
 * @fusion/system-sf2e — Item "condition" schema.
 *
 * Verbatim inheritance from `systems/pf2e/src/schemas/item-condition.ts`
 * (REQ-SF2-006). Conditions are embedded items on an actor; the mechanical
 * definitions (including the SF2e-exclusive Untethered/Glitching/Suppressed)
 * live in `conditions.ts`, registered by later agents.
 *
 * Clean-room: spec 18 §Tipos de Item; ORC data only.
 * REQ-SF2-003, REQ-SF2-006, REQ-SF2-022.
 */

import { z } from "zod";
import { EffectRuleSchema } from "../schema-primitives.js";

export const ConditionSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Canonical condition slug (e.g. "frightened", "off-guard", "untethered"). */
    slug: z.string().min(1),
    /** Numeric value for valued conditions. Absent for non-valued conditions. */
    value: z.number().int().min(1).optional(),
    overrides: z.array(z.string()).default([]),
    rules: z.array(EffectRuleSchema).default([]),
  })
  .passthrough();

export type ConditionSystem = z.infer<typeof ConditionSystemSchema>;

export function parseConditionSystem(data: unknown): ConditionSystem {
  return ConditionSystemSchema.parse(data);
}
