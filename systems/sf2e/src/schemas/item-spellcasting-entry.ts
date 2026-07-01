/**
 * @fusion/system-sf2e — Item "spellcastingEntry" schema.
 *
 * Verbatim inheritance from
 * `systems/pf2e/src/schemas/item-spellcasting-entry.ts` (REQ-SF2-004). Only
 * Mystic and Witchwarper have spellcasting entries in SF2e (REQ-SF2-039
 * Spells tab); the entry shape itself is unchanged from PF2e.
 *
 * Clean-room: spec 18 §Tipos de Item; ORC data only.
 * REQ-SF2-003, REQ-SF2-004.
 */

import { z } from "zod";
import {
  AbilitySlugSchema,
  ProficiencyRankSchema,
  SpellSlotsMapSchema,
} from "../schema-primitives.js";
import { SPELL_TRADITIONS } from "../types.js";

const SpellTraditionSchema = z.enum(SPELL_TRADITIONS);

export const SpellcastingEntrySystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    prepared: z.object({ value: z.enum(["prepared", "spontaneous", "innate"]) }),
    tradition: z.object({ value: SpellTraditionSchema }),
    ability: z.object({ value: AbilitySlugSchema }),
    proficiency: z.object({ value: ProficiencyRankSchema }),
    slots: SpellSlotsMapSchema,
    isFocusPool: z.boolean().default(false),
  })
  .passthrough();

export type SpellcastingEntrySystem = z.infer<typeof SpellcastingEntrySystemSchema>;

export function parseSpellcastingEntrySystem(data: unknown): SpellcastingEntrySystem {
  return SpellcastingEntrySystemSchema.parse(data);
}
