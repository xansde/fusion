/**
 * @fusion/system-pf2e — Actor "hazard" schema.
 *
 * A hazard (trap/environmental danger) is a subset of NPC: it has a statblock
 * (AC, HP, Hardness, saves) but typically no active actions of its own.
 * Complex hazards may have a routine that fires on initiative.
 *
 * Clean-room: spec 17 §Tipos de Actor; ORC/OGL only.
 * REQ-PF2-002.
 */

import { z } from "zod";
import { HpBlockSchema, IwrBlockSchema } from "../schema-primitives.js";

export const HazardSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Hazard level. Negative levels are valid. */
    level: z.object({ value: z.number().int() }).default({ value: 1 }),
    attributes: z.object({
      hp: HpBlockSchema,
      ac: z.object({ value: z.number().int().min(0) }).default({ value: 10 }),
      /** Hardness reduces damage before HP is affected. REQ-PF2-023 */
      hardness: z.number().int().min(0).default(0),
      iwr: IwrBlockSchema.default({ immunities: [], weaknesses: [], resistances: [] }),
    }),
    saves: z
      .object({
        fortitude: z.object({ value: z.number().int() }).optional(),
        reflex: z.object({ value: z.number().int() }).optional(),
        will: z.object({ value: z.number().int() }).optional(),
      })
      .default({}),
    details: z
      .object({
        /** Trigger description for the hazard. */
        trigger: z.string().optional(),
        /** Effect description. */
        effect: z.string().optional(),
        disable: z.string().optional(),
        reset: z.string().optional(),
        routine: z.string().optional(),
        publicNotes: z.string().optional(),
        publication: z
          .object({ license: z.string(), remaster: z.boolean().optional(), title: z.string() })
          .optional(),
      })
      .default({}),
    traits: z
      .object({
        rarity: z.enum(["common", "uncommon", "rare", "unique"]).default("common"),
        value: z.array(z.string()).default([]),
      })
      .default({}),
  })
  .passthrough();

export type HazardSystem = z.infer<typeof HazardSystemSchema>;

export function parseHazardSystem(data: unknown): HazardSystem {
  return HazardSystemSchema.parse(data);
}
