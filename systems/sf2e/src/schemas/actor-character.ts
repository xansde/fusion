/**
 * @fusion/system-sf2e — Actor "character" schema.
 *
 * Mirrors `systems/pf2e/src/schemas/actor-character.ts` almost verbatim —
 * abilities, proficiencies, HP/dying/wounded, resources, details are all
 * inherited unchanged from engine-2e/PF2e (REQ-SF2-004). Deltas (spec 18
 * ActorSystemSF2e):
 *
 *   - `currency`: `{ credits: number }` instead of PF2e's gp/sp/cp wallet
 *     (D-SF2-05, REQ-SF2-027).
 *   - `skills`: includes the 18-skill SF2e set (computers, piloting) via
 *     `SkillSlugSchema` from ./types.js (REQ-SF2-007..008). The schema still
 *     uses a permissive `z.record` like PF2e so Lore skills keep working.
 *   - `augmentations`: slot-tracking block (installed list + apex/regular
 *     counts) — REQ-SF2-023..024, D-SF2-03.
 *   - `classResources.solarian`: optional Graviton/Photon attunement tracker
 *     (REQ-SF2-012, REQ-SF2-042) — manual MVP tracking, no automation.
 *
 * Clean-room: spec 18 §Model de dados; ORC rules only.
 * REQ-SF2-002, REQ-SF2-004, REQ-SF2-007, REQ-SF2-023, REQ-SF2-027.
 */

import { z } from "zod";
import {
  AbilitySlugSchema,
  CreditsSchema,
  HpBlockSchema,
  IwrBlockSchema,
  ProficiencyRankSchema,
  SenseDataSchema,
  SpeedSchema,
} from "../schema-primitives.js";
import { AUGMENTATION_TYPES, BODY_SLOTS } from "../types.js";

// ---------------------------------------------------------------------------
// Ability score block — identical to PF2e.
// ---------------------------------------------------------------------------

export const CharacterAbilitySchema = z.object({
  value: z.number().int(),
  mod: z.number().int().default(0),
});

const CharacterAbilitiesSchema = z.object({
  str: CharacterAbilitySchema,
  dex: CharacterAbilitySchema,
  con: CharacterAbilitySchema,
  int: CharacterAbilitySchema,
  wis: CharacterAbilitySchema,
  cha: CharacterAbilitySchema,
});

// ---------------------------------------------------------------------------
// Proficiency records — identical to PF2e.
// ---------------------------------------------------------------------------

const SaveProficiencySchema = z.object({
  rank: ProficiencyRankSchema,
});

const SavesSchema = z.object({
  fortitude: SaveProficiencySchema,
  reflex: SaveProficiencySchema,
  will: SaveProficiencySchema,
});

/** Per-skill proficiency rank; lore flag marks custom Lore skills. */
const SkillProficiencySchema = z.object({
  rank: ProficiencyRankSchema,
  lore: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Attributes — identical to PF2e (dying/wounded/doomed/IWR from engine-2e).
// ---------------------------------------------------------------------------

const CharacterAttributesSchema = z.object({
  hp: HpBlockSchema,
  ac: z.object({ value: z.number().int() }).default({ value: 10 }),
  speed: SpeedSchema,
  dying: z.object({
    value: z.number().int().min(0).default(0),
    max: z.number().int().min(0).default(4),
  }),
  wounded: z.object({ value: z.number().int().min(0).default(0) }),
  doomed: z.object({ value: z.number().int().min(0).default(0) }),
  iwr: IwrBlockSchema.default({ immunities: [], weaknesses: [], resistances: [] }),
});

// ---------------------------------------------------------------------------
// Weapon and armor proficiencies — identical to PF2e.
// ---------------------------------------------------------------------------

const ProficiencyBlockSchema = z.object({
  classDC: z.object({ rank: ProficiencyRankSchema }).default({ rank: 0 }),
  weapons: z
    .object({
      unarmed: ProficiencyRankSchema.default(0),
      simple: ProficiencyRankSchema.default(0),
      martial: ProficiencyRankSchema.default(0),
      advanced: ProficiencyRankSchema.default(0),
    })
    .default({ unarmed: 0, simple: 0, martial: 0, advanced: 0 }),
  armor: z
    .object({
      unarmored: ProficiencyRankSchema.default(0),
      light: ProficiencyRankSchema.default(0),
      medium: ProficiencyRankSchema.default(0),
      heavy: ProficiencyRankSchema.default(0),
    })
    .default({ unarmored: 0, light: 0, medium: 0, heavy: 0 }),
});

// ---------------------------------------------------------------------------
// Resources (Hero Points, Focus Points) — identical to PF2e.
// ---------------------------------------------------------------------------

const ResourcesSchema = z.object({
  heroPoints: z
    .object({ value: z.number().int().min(0), max: z.number().int().min(0) })
    .default({ value: 1, max: 3 }),
  focusPoints: z
    .object({ value: z.number().int().min(0), max: z.number().int().min(0) })
    .default({ value: 0, max: 0 }),
});

// ---------------------------------------------------------------------------
// SF2e-exclusive: augmentation slot tracking (D-SF2-03, REQ-SF2-023..024).
//
// Delta from spec 18: the real compendium data does not carry a `bodySlot`
// field on augmentation items (see types.ts BODY_SLOTS docstring), so
// `bodySlot` is kept optional here ("unassigned" until an agent curates the
// mapping or the GM assigns it manually on the sheet).
// ---------------------------------------------------------------------------

export const AugmentationTypeSchema = z.enum(AUGMENTATION_TYPES);
export const BodySlotSchema = z.enum(BODY_SLOTS);

export const AugmentationSlotSchema = z.object({
  itemId: z.string(),
  bodySlot: BodySlotSchema.optional(),
  augType: AugmentationTypeSchema,
  isApex: z.boolean().default(false),
});

const AugmentationsBlockSchema = z.object({
  installed: z.array(AugmentationSlotSchema).default([]),
  apexCount: z.number().int().min(0).default(0),
  /** Non-apex augmentations installed; hook-enforced max of 4 (REQ-SF2-024). */
  regularCount: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// SF2e-exclusive: Solarian attunement tracker (REQ-SF2-012, REQ-SF2-042).
// Manual MVP tracking only — no automated effects (D-SF2-01 scope note).
// ---------------------------------------------------------------------------

const SolarianAttunementSchema = z.object({
  gravitonAttunement: z.number().int().min(0).max(3).default(0),
  photonAttunement: z.number().int().min(0).max(3).default(0),
  pole: z.enum(["graviton", "photon", "balanced"]).default("balanced"),
});

const ClassResourcesSchema = z.object({
  solarian: SolarianAttunementSchema.optional(),
});

// ---------------------------------------------------------------------------
// Details (key ability, ABC references) — identical to PF2e. `ancestry`
// stores the Species item name/slug (D-SF2-08: species = ancestry doctype).
// ---------------------------------------------------------------------------

const CharacterDetailsSchema = z.object({
  keyAbility: AbilitySlugSchema,
  ancestry: z.string().optional(),
  background: z.string().optional(),
  class: z.string().optional(),
  level: z.number().int().min(1).max(20).default(1),
});

// ---------------------------------------------------------------------------
// Full CharacterSystem schema (ActorSystemSF2e — spec 18 §Model de dados)
// REQ-SF2-002.
// ---------------------------------------------------------------------------

export const CharacterSystemSchema = z
  .object({
    systemVersion: z.string().default("0.1.0"),
    level: z.object({ value: z.number().int().min(1).max(20) }).default({ value: 1 }),
    abilities: CharacterAbilitiesSchema,
    attributes: CharacterAttributesSchema,
    saves: SavesSchema,
    perception: z.object({
      rank: ProficiencyRankSchema,
      senses: z.array(SenseDataSchema).default([]),
    }),
    /** Skill proficiencies — 18 canonical SF2e skills + Lore. REQ-SF2-007..008. */
    skills: z.record(z.string(), SkillProficiencySchema).default({}),
    proficiencies: ProficiencyBlockSchema.default({}),
    resources: ResourcesSchema.default({}),
    /** Credits wallet — replaces PF2e's gp/sp/cp. REQ-SF2-027. */
    currency: CreditsSchema.default({ credits: 0 }),
    augmentations: AugmentationsBlockSchema.default({
      installed: [],
      apexCount: 0,
      regularCount: 0,
    }),
    classResources: ClassResourcesSchema.optional(),
    details: CharacterDetailsSchema,
    traits: z
      .object({
        rarity: z.enum(["common", "uncommon", "rare", "unique"]).default("common"),
        value: z.array(z.string()).default([]),
        size: z.enum(["tiny", "sm", "med", "lg", "huge", "grg"]).default("med"),
      })
      .default({}),
  })
  .passthrough(); // REQ-SF2-051 (mirrors REQ-PF2-204): extra importer fields allowed.

export type CharacterSystem = z.infer<typeof CharacterSystemSchema>;

export function parseCharacterSystem(data: unknown): CharacterSystem {
  return CharacterSystemSchema.parse(data);
}

export type { SenseData } from "../schema-primitives.js";
