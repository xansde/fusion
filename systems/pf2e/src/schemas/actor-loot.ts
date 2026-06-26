/**
 * @fusion/system-pf2e — Actor "loot" schema.
 *
 * A loot container is an actor with no statblock; it exists solely to hold
 * items (treasure pile, chest, dropped equipment). The schema is minimal.
 *
 * Clean-room: spec 17 §Tipos de Actor; ORC/OGL only.
 * REQ-PF2-002.
 */

import { z } from "zod";

export const LootSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Whether the loot container is accessible to players (vs. GM-only). */
    publicAccess: z.boolean().default(false),
    /** Optional description shown to players when they open the container. */
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
