/**
 * @fusion/system-sf2e — Actor "hazard" schema.
 *
 * Verbatim inheritance from `systems/pf2e/src/schemas/actor-hazard.ts`
 * (REQ-SF2-002, REQ-SF2-004). Hazards (traps, environmental dangers, and
 * SF2e-specific concepts like malfunctioning tech or hacking terminals in
 * [V2]) use the same statblock shape as PF2e.
 *
 * Clean-room: spec 18 §Model de dados; ORC rules only.
 */

import { z } from "zod";
import { HpBlockSchema, IwrBlockSchema } from "../schema-primitives.js";

export const HazardSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    level: z.object({ value: z.number().int() }).default({ value: 1 }),
    attributes: z.object({
      hp: HpBlockSchema,
      ac: z.object({ value: z.number().int().min(0) }).default({ value: 10 }),
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
        trigger: z.string().optional(),
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
