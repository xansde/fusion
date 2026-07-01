/**
 * @fusion/system-sf2e — Item "augmentation" schema (SF2e-exclusive).
 *
 * D-SF2-03, REQ-SF2-023: augmentations are a dedicated item type with a
 * `bodySlot` field, distinct from generic `equipment`.
 *
 * Delta from spec 18 / real compendium data (IMPORTANT for the importer
 * agent):
 *   - The real SF2e compendium stores augmentations as `type: "equipment"`
 *     with `usage.value: "implanted"` and NO `bodySlot` field at all
 *     (verified against every file in
 *     vendor/pf2e/packs/sf2e/equipment/augmentations/**). There is no
 *     source-data signal for which body slot an augmentation occupies.
 *   - Augmentations ARE organized into 5 folders by category: apex, biotech,
 *     magitech, necrograft, tech — one more than spec 18's 4-value
 *     `augType` enum (biotech/cybernetic/magitech/apex). We use
 *     `AUGMENTATION_TYPES = [apex, biotech, magitech, necrograft, tech]`
 *     (types.ts) as the canonical set; "tech" replaces the spec's
 *     "cybernetic" to match the real folder name, and "necrograft" is added.
 *   - `bodySlot` is therefore OPTIONAL in this schema (not required as
 *     spec 18 originally drafted) until a later agent curates a slug→slot
 *     mapping table or the importer/GM assigns it manually. The slot-limit
 *     hook (REQ-SF2-024, `preCreateItem`) only needs `isApex` to count
 *     regular vs. apex augmentations — it does not require `bodySlot`.
 *   - `soulbound` is hardcoded `true` per spec (augmentations can't be
 *     resold/transferred) but kept as a schema field (not a TS literal
 *     type) so the importer can still write it explicitly per REQ-SF2-023.
 *
 * Clean-room: spec 18 §Modelo de Dados (AugmentationItemSystem); ORC data
 * cross-checked against vendor/pf2e/packs/sf2e/equipment/augmentations/**.
 * REQ-SF2-002, REQ-SF2-023..024, REQ-SF2-051.
 */

import { z } from "zod";
import { EffectRuleSchema, PublicationSchema, TraitsBlockSchema } from "../schema-primitives.js";
import { AUGMENTATION_TYPES, BODY_SLOTS } from "../types.js";

export const AugmentationTypeSchema = z.enum(AUGMENTATION_TYPES);
export const BodySlotSchema = z.enum(BODY_SLOTS);

export const AugmentationSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    augType: AugmentationTypeSchema,
    /** Optional: no body-slot signal in the real compendium data — see docstring. */
    bodySlot: BodySlotSchema.optional(),
    level: z.object({ value: z.number().int().min(0) }).default({ value: 0 }),
    /** Apex augmentations don't count toward the 4-slot regular limit. REQ-SF2-024. */
    isApex: z.boolean().default(false),
    /** Hours; rule of thumb = 1h per 2 item levels (REQ-SF2-023). */
    installationTime: z.number().min(0).default(0),
    requiresMedicineMaster: z.boolean().default(false),
    /** Augmentations are bound to the character; can't be resold/transferred. */
    soulbound: z.literal(true).default(true),
    bulk: z.number().min(0).default(0),
    price: z
      .object({
        gp: z.number().int().min(0).optional(),
        sp: z.number().int().min(0).optional(),
        cp: z.number().int().min(0).optional(),
      })
      .default({}),
    quantity: z.number().int().positive().default(1),
    size: z.enum(["tiny", "sm", "med", "lg", "huge", "grg"]).default("med"),
    traits: TraitsBlockSchema.default({ rarity: "common", value: [] }),
    rules: z.array(EffectRuleSchema).default([]),
    publication: PublicationSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();

export type AugmentationSystem = z.infer<typeof AugmentationSystemSchema>;

export function parseAugmentationSystem(data: unknown): AugmentationSystem {
  return AugmentationSystemSchema.parse(data);
}
