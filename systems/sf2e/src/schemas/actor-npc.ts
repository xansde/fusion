/**
 * @fusion/system-sf2e — Actor "npc" schema.
 *
 * Verbatim inheritance from `systems/pf2e/src/schemas/actor-npc.ts`
 * (REQ-SF2-004). Confirmed by inspecting the real SF2e bestiary data
 * (vendor/pf2e/packs/sf2e/alien-core-bestiary/*.json): the `system` field
 * top-level keys (abilities, attributes, details, initiative, perception,
 * resources, saves, skills, traits) are IDENTICAL to PF2e NPCs — no
 * currency block, no SF2e-exclusive fields on the NPC statblock itself.
 * SF2e NPC weapons/strikes are still embedded `melee`/`ranged` items
 * (schemas/item-equipment.ts MeleeSystemSchema, inherited unchanged).
 *
 * FIX (audit M4.5-corretor, ISSUE MEDIA): mirrors the pf2e fix verbatim
 * (systems/pf2e/src/schemas/actor-npc.ts docstring) — verified against
 * every NPC in systems/sf2e/packs/bestiary-core/documents.json (produced by
 * the same tools/importer-pf2e/src/transform.mjs normalizeActorSystem).
 * Same three divergences fixed by accepting both shapes:
 *   1. `perception` at the system TOP LEVEL, not nested under `attributes`.
 *   2. `attributes.allSaves` is `{ value: string }`, not a bare string.
 *   3. `traits.size` is `{ value: <size enum> }`, not a bare enum string.
 *
 * Clean-room: spec 18 §Model de dados; ORC rules only.
 * REQ-SF2-002, REQ-SF2-004.
 */

import { z } from "zod";
import {
  HpBlockSchema,
  IwrBlockSchema,
  SenseDataSchema,
  SizeSchema,
  SpeedSchema,
} from "../schema-primitives.js";

// ---------------------------------------------------------------------------
// NPC Abilities (mod-only) — identical to PF2e.
// ---------------------------------------------------------------------------

const NpcAbilitySchema = z.object({
  mod: z.number().int(),
});

const NpcAbilitiesSchema = z.object({
  str: NpcAbilitySchema,
  dex: NpcAbilitySchema,
  con: NpcAbilitySchema,
  int: NpcAbilitySchema,
  wis: NpcAbilitySchema,
  cha: NpcAbilitySchema,
});

// ---------------------------------------------------------------------------
// NPC Saves (flat modifier values) — identical to PF2e.
// ---------------------------------------------------------------------------

const NpcSaveSchema = z.object({
  value: z.number().int(),
  saveDetail: z.string().optional(),
});

const NpcSavesSchema = z.object({
  fortitude: NpcSaveSchema,
  reflex: NpcSaveSchema,
  will: NpcSaveSchema,
});

// ---------------------------------------------------------------------------
// NPC Attributes — identical to PF2e.
// ---------------------------------------------------------------------------

/** Shared by top-level `system.perception` (real packs) and the legacy
 * `attributes.perception` nesting some hand-authored docs may still use. */
const NpcPerceptionSchema = z.object({
  mod: z.number().int(),
  senses: z.array(SenseDataSchema).default([]),
  details: z.string().optional(),
});

/** Real shape is `{ value: string }`; bare string also accepted (legacy). */
const NpcAllSavesSchema = z.union([z.string(), z.object({ value: z.string() })]);

const NpcAttributesSchema = z.object({
  hp: HpBlockSchema,
  ac: z.object({
    value: z.number().int().min(0),
    details: z.string().optional(),
  }),
  speed: SpeedSchema,
  /** Legacy nested perception — real packs use the system top-level field. */
  perception: NpcPerceptionSchema.optional(),
  iwr: IwrBlockSchema.default({ immunities: [], weaknesses: [], resistances: [] }),
  allSaves: NpcAllSavesSchema.optional(),
});

// ---------------------------------------------------------------------------
// NPC Skills (compact: slug → { base }) — identical to PF2e. The SF2e skill
// set (computers, piloting) is a superset the record accepts transparently.
// ---------------------------------------------------------------------------

const NpcSkillEntrySchema = z.object({
  base: z.number().int(),
  special: z.array(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// NPC Details — identical to PF2e.
// ---------------------------------------------------------------------------

const NpcDetailsSchema = z.object({
  level: z.object({ value: z.number().int() }),
  languages: z
    .object({
      value: z.array(z.string()).default([]),
      details: z.string().optional(),
    })
    .default({ value: [] }),
  publicNotes: z.string().optional(),
  blurb: z.string().optional(),
  publication: z
    .object({
      license: z.string(),
      remaster: z.boolean().optional(),
      title: z.string(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// NPC Traits — identical to PF2e.
// ---------------------------------------------------------------------------

/** Real shape is `{ value: <size enum> }`; bare enum also accepted (legacy). */
const NpcSizeSchema = z
  .union([SizeSchema, z.object({ value: SizeSchema })])
  .transform((v) => (typeof v === "string" ? v : v.value))
  .default("med");

const NpcTraitsSchema = z.object({
  rarity: z.enum(["common", "uncommon", "rare", "unique"]).default("common"),
  value: z.array(z.string()).default([]),
  size: NpcSizeSchema,
});

// ---------------------------------------------------------------------------
// Full NpcSystem schema — REQ-SF2-002.
// ---------------------------------------------------------------------------

export const NpcSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    abilities: NpcAbilitiesSchema,
    attributes: NpcAttributesSchema,
    saves: NpcSavesSchema,
    skills: z.record(z.string(), NpcSkillEntrySchema).default({}),
    /** Real packs store perception at the system TOP LEVEL (see
     * NpcAttributesSchema.perception docstring for the legacy nested
     * fallback). REQ-SF2-014 */
    perception: NpcPerceptionSchema.optional(),
    initiative: z
      .object({ statistic: z.string().default("perception") })
      .default({ statistic: "perception" }),
    details: NpcDetailsSchema,
    traits: NpcTraitsSchema,
    spellcasting: z
      .object({
        rituals: z.object({ dc: z.number().int() }).optional(),
      })
      .optional(),
  })
  .passthrough(); // REQ-SF2-051

export type NpcSystem = z.infer<typeof NpcSystemSchema>;

export function parseNpcSystem(data: unknown): NpcSystem {
  return NpcSystemSchema.parse(data);
}
