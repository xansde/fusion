/**
 * @fusion/system-pf2e — Item "spellcastingEntry" schema.
 *
 * A spellcasting entry is the container for a caster's spell repertoire:
 * tradition, key ability, proficiency rank, and slot tracking.
 *
 * Clean-room: spec 17 §Tipos de Item; ORC/OGL only.
 * REQ-PF2-003, REQ-PF2-080..083.
 */

import { z } from "zod";
import {
  AbilitySlugSchema,
  ProficiencyRankSchema,
  SpellSlotsMapSchema,
  SpellTraditionSchema,
} from "../schema-primitives.js";

export const SpellcastingEntrySystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    /** Spellcasting type: prepared / spontaneous / innate. REQ-PF2-080 */
    prepared: z.object({ value: z.enum(["prepared", "spontaneous", "innate"]) }),
    /** Magic tradition. REQ-PF2-080 */
    tradition: z.object({ value: SpellTraditionSchema }),
    /** Key ability for spell DC and spell attack. REQ-PF2-017 */
    ability: z.object({ value: AbilitySlugSchema }),
    /** Proficiency rank for spell DC / attack. */
    proficiency: z.object({ value: ProficiencyRankSchema }),
    /**
     * Slot tracking (ranks 0..10).
     * Cantrips are in slot 0; slots 1-10 for levelled spells.
     * REQ-PF2-081, REQ-PF2-082.
     */
    slots: SpellSlotsMapSchema,
    /**
     * Whether this entry is for focus spells.
     * Focus spells consume Focus Points rather than slots. REQ-PF2-083.
     */
    isFocusPool: z.boolean().default(false),
  })
  .passthrough();

export type SpellcastingEntrySystem = z.infer<typeof SpellcastingEntrySystemSchema>;

export function parseSpellcastingEntrySystem(data: unknown): SpellcastingEntrySystem {
  return SpellcastingEntrySystemSchema.parse(data);
}
