/**
 * @fusion/system-sf2e — Actor "loot" schema.
 *
 * Verbatim inheritance from `systems/pf2e/src/schemas/actor-loot.ts`
 * (REQ-SF2-002, REQ-SF2-004). A loot container holds items (salvage crate,
 * derelict ship locker) with no statblock of its own.
 *
 * Clean-room: spec 18 §Model de dados; ORC rules only.
 */

import { z } from "zod";

export const LootSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    publicAccess: z.boolean().default(false),
    description: z.string().optional(),
    traits: z
      .object({
        rarity: z.enum(["common", "uncommon", "rare", "unique"]).default("common"),
        value: z.array(z.string()).default([]),
      })
      .default({}),
  })
  .passthrough();

export type LootSystem = z.infer<typeof LootSystemSchema>;

export function parseLootSystem(data: unknown): LootSystem {
  return LootSystemSchema.parse(data);
}
