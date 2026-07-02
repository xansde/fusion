/**
 * @fusion/system-pf2e — Actor "npc" schema.
 *
 * Defines the Zod schema for the `system` field of an NPC/monster actor,
 * aligned to the real data shape in the importer analysis (Skeleton Guard
 * example from 02-schema-actor-item.md).
 *
 * Key differences from character:
 *   - Abilities store only `mod` (not full score) — imported directly.
 *   - Saves, AC, HP, Perception store numeric totals (not proficiency ranks).
 *   - Skills map is compact: slug → { base: number }.
 *   - IWR is stored as flat arrays (immunities, resistances, weaknesses).
 *   - Strikes are embedded as `melee`/`ranged` items, not derived here.
 *
 * FIX (audit M4.5-corretor, ISSUE MEDIA): this schema originally documented
 * a shape that does NOT match the real packs produced by
 * tools/importer-pf2e/src/transform.mjs normalizeActorSystem (verified
 * against every NPC in systems/pf2e/packs/bestiary-core/documents.json —
 * and, since sf2e imports through the same normalizer, every NPC in
 * systems/sf2e/packs/bestiary-core/documents.json too). Three divergences,
 * all fixed below by accepting BOTH shapes rather than regenerating the
 * packs:
 *   1. `perception` lives at the system TOP LEVEL (`system.perception`),
 *      not nested under `attributes` — the schema required
 *      `attributes.perception` and had no top-level field, so every real
 *      NPC failed validation entirely.
 *   2. `attributes.allSaves` is stored as `{ value: string }`, not a bare
 *      string.
 *   3. `traits.size` is stored as `{ value: <size enum> }`, not a bare
 *      enum string.
 *
 * Clean-room: spec 17 §Model de dados; ORC/OGL rules only.
 * REQ-PF2-002.
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
// NPC Abilities (mod-only)
// ---------------------------------------------------------------------------

const NpcAbilitySchema = z.object({
  /** Pre-computed modifier (no score stored for NPCs). */
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
// NPC Saves (flat modifier values, not rank-based)
// REQ-PF2-015 (NPC uses total, not derived from TEML+level)
// ---------------------------------------------------------------------------

const NpcSaveSchema = z.object({
  value: z.number().int(),
  /** Optional GM-facing details (e.g., "save vs. death effects"). */
  saveDetail: z.string().optional(),
});

const NpcSavesSchema = z.object({
  fortitude: NpcSaveSchema,
  reflex: NpcSaveSchema,
  will: NpcSaveSchema,
});

// ---------------------------------------------------------------------------
// NPC Attributes
// ---------------------------------------------------------------------------

/**
 * Perception block shape — shared by the top-level `system.perception`
 * (real packs) and the legacy `attributes.perception` nesting some
 * hand-authored docs may still use.
 */
const NpcPerceptionSchema = z.object({
  mod: z.number().int(),
  senses: z.array(SenseDataSchema).default([]),
  details: z.string().optional(),
});

/**
 * `allSaves` real shape is `{ value: string }` (systems/pf2e/packs/
 * bestiary-core/documents.json — e.g. "+2 status to all saves vs. magic").
 * A bare string is also accepted for hand-authored/legacy docs.
 */
const NpcAllSavesSchema = z.union([z.string(), z.object({ value: z.string() })]);

const NpcAttributesSchema = z.object({
  hp: HpBlockSchema,
  /** AC total for NPC — fixed from statblock, not derived. */
  ac: z.object({
    value: z.number().int().min(0),
    details: z.string().optional(),
  }),
  speed: SpeedSchema,
  /**
   * Legacy nested perception — the real packs store perception at the
   * system TOP LEVEL (see NpcSystemSchema.perception below); this stays
   * optional for hand-authored docs using the old nesting.
   * REQ-PF2-014
   */
  perception: NpcPerceptionSchema.optional(),
  iwr: IwrBlockSchema.default({ immunities: [], weaknesses: [], resistances: [] }),
  /** Special note on all saves (e.g., "+1 status vs. magic"). */
  allSaves: NpcAllSavesSchema.optional(),
});

// ---------------------------------------------------------------------------
// NPC Skills (compact: slug abbreviation → { base })
// Aligned to the PF2e JSON format: "acr" | "ath" | "ste" etc.
// The importer may use abbreviated or full slugs.
// REQ-PF2-012 (NPC uses total bonus, not TEML)
// ---------------------------------------------------------------------------

const NpcSkillEntrySchema = z.object({
  /** Total skill bonus (pre-calculated in the statblock). */
  base: z.number().int(),
  /** Optional extra note (e.g., "+2 in water"). */
  special: z.array(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// NPC Details
// ---------------------------------------------------------------------------

const NpcDetailsSchema = z.object({
  /** NPC level (can be negative, e.g. -1 for weak creatures). */
  level: z.object({ value: z.number().int() }),
  languages: z
    .object({
      value: z.array(z.string()).default([]),
      details: z.string().optional(),
    })
    .default({ value: [] }),
  /** Flavour text (ORC/OGL ok). */
  publicNotes: z.string().optional(),
  /** Short tagline summary. */
  blurb: z.string().optional(),
  /** Publication attribution (ORC mandate). REQ-PF2-204 */
  publication: z
    .object({
      license: z.string(),
      remaster: z.boolean().optional(),
      title: z.string(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// NPC Traits
// ---------------------------------------------------------------------------

/**
 * `traits.size` real shape is `{ value: <size enum> }` (systems/pf2e/packs/
 * bestiary-core/documents.json). A bare enum string is also accepted for
 * hand-authored/legacy docs; normalized to the enum value either way.
 */
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
// Full NpcSystem schema
// REQ-PF2-002 / spec 17 §schemas npc
// ---------------------------------------------------------------------------

export const NpcSystemSchema = z
  .object({
    /** System schema version for migrations. REQ-PF2-205 */
    systemVersion: z.string().default("0.1.0"),
    abilities: NpcAbilitiesSchema,
    attributes: NpcAttributesSchema,
    saves: NpcSavesSchema,
    /**
     * Skills map: abbreviated slug (e.g. "acr") or full slug → { base }.
     * NPCs typically list only the skills they have.
     */
    skills: z.record(z.string(), NpcSkillEntrySchema).default({}),
    /**
     * Perception — real packs store this at the system TOP LEVEL (see
     * NpcAttributesSchema.perception docstring for the legacy nested
     * fallback). Optional here because a doc may still only carry the
     * nested `attributes.perception`; derivation steps read both with a
     * fallback chain (systems/pf2e/src/derivations/npc.ts stepNpcPerception).
     * REQ-PF2-014
     */
    perception: NpcPerceptionSchema.optional(),
    /** Which statistic is used for initiative rolls. REQ-PF2-090 */
    initiative: z
      .object({ statistic: z.string().default("perception") })
      .default({ statistic: "perception" }),
    details: NpcDetailsSchema,
    traits: NpcTraitsSchema,
    /** Optional spellcasting reference (DC + mod for NPC casters). */
    spellcasting: z
      .object({
        rituals: z.object({ dc: z.number().int() }).optional(),
      })
      .optional(),
  })
  .passthrough(); // REQ-PF2-204

export type NpcSystem = z.infer<typeof NpcSystemSchema>;

/** Parse raw data as an NpcSystem; throws on validation failure. */
export function parseNpcSystem(data: unknown): NpcSystem {
  return NpcSystemSchema.parse(data);
}
