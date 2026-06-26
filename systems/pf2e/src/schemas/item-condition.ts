/**
 * @fusion/system-pf2e — Item "condition" schema.
 *
 * Conditions are embedded items on an actor. The system.conditions list in
 * `conditions.ts` defines the mechanical effects; this schema defines the
 * data stored per-condition-instance on a specific actor.
 *
 * Clean-room: spec 17 §Tipos de Item; ORC/OGL only.
 * REQ-PF2-003, REQ-PF2-050..054.
 */

import { z } from "zod";
import { EffectRuleSchema } from "../schema-primitives.js";

export const ConditionSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /**
     * Canonical condition slug (e.g. "frightened", "off-guard", "dying").
     * REQ-PF2-050.
     */
    slug: z.string().min(1),
    /**
     * Numeric value for valued conditions (e.g. frightened 2, clumsy 1).
     * Absent / undefined for non-valued conditions.
     * REQ-PF2-054: highest value wins when applied multiple times.
     */
    value: z.number().int().min(1).optional(),
    /**
     * Condition slugs that this condition overrides/removes on application
     * (e.g., "unconscious" overrides "sleeping").
     */
    overrides: z.array(z.string()).default([]),
    /**
     * Effect rules from this condition instance (used when a condition
     * directly carries FlatModifier rules rather than deferring to the
     * ConditionDefinition in the registry).
     * REQ-PF2-204: unsupported rule types must not break validation.
     */
    rules: z.array(EffectRuleSchema).default([]),
  })
  .passthrough();

export type ConditionSystem = z.infer<typeof ConditionSystemSchema>;

export function parseConditionSystem(data: unknown): ConditionSystem {
  return ConditionSystemSchema.parse(data);
}
