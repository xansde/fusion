/**
 * @fusion/system-pf2e — Actor "familiar" schema (companions: familiar / pet /
 * animal companion).
 *
 * A companion is a full Actor (its own token, HP bar, ownership, combat-tracker
 * turn) linked to a master `character` Actor by `system.masterActorId`. The
 * `companionKind` discriminator covers the three remaster variants that share
 * the same underlying machine (spec 29 §3.2, REQ-PET-001):
 *   - "familiar"        — Tiny spellcaster companion (Wizard/Witch/Magus/…),
 *                         granted by the "Familiar" class feat.
 *   - "pet"             — generic archetype pet (feat "Pet" / Beastmaster),
 *                         mechanically identical to a familiar.
 *   - "animalCompanion" — larger Druid/Ranger companion (schema foundation
 *                         only in the MVP; derived from a creature type table
 *                         in V2, REQ-PET-005). Kept in the enum so a future
 *                         batch never has to migrate the discriminator.
 *   - "mount"           — reserved [V2] (REQ-PET-090); parsed but no derivation.
 *
 * DERIVATION MODEL (MVP, spec 29 §3.3 / Q-PET-02). The server's derivation
 * pipeline is single-actor: a DeriveStep sees only its own document, never the
 * master's. Rather than build a cross-actor pass now, the MVP caches the small
 * set of master-derived inputs a familiar needs — `masterLevel`,
 * `masterAbilityMod` (the master's spellcasting/key ability modifier),
 * `masterAc` and `masterSaves` — directly on the familiar's `system`. The
 * client `petsVM` reads the LIVE master document and writes these caches on
 * create and on every "re-derive on open/edit"; the pure familiar DeriveSteps
 * (systems/pf2e/derivations/familiar.ts) then compute HP = 5 × masterLevel and
 * mirror AC/saves/perception/attack the same way the server does for any other
 * actor. LIMITATION: if the master levels up while a familiar window is closed,
 * the familiar's caches are stale until the master's Pets tab is reopened
 * (re-derive on read). A live cross-actor sync is a documented follow-up.
 *
 * Clean-room: spec 29 (Pets/Companions/Familiars), remaster rules (ORC).
 * No Foundry code copied; the vendor familiar-abilities pack is imported as
 * mechanical data only (REQ-PET-020).
 * REQ-PET-001..004, REQ-PET-006, REQ-PET-007.
 */

import { z } from "zod";
import { HpBlockSchema, SenseDataSchema, SizeSchema, SpeedSchema } from "../schema-primitives.js";

// ---------------------------------------------------------------------------
// companionKind discriminator (REQ-PET-001)
// ---------------------------------------------------------------------------

export const COMPANION_KINDS = ["familiar", "pet", "animalCompanion", "mount"] as const;
export const CompanionKindSchema = z.enum(COMPANION_KINDS);
export type CompanionKind = (typeof COMPANION_KINDS)[number];

// ---------------------------------------------------------------------------
// Master-derived input cache (spec 29 §3.3). Authored by petsVM from the LIVE
// master document; read by the familiar DeriveSteps. Never a source of truth
// about the familiar itself — purely a snapshot of the master's relevant stats.
// ---------------------------------------------------------------------------

const MasterCacheSchema = z
  .object({
    /** Master's character level (drives HP = 5 × level and every mod). */
    level: z.number().int().min(0).default(1),
    /**
     * Master's spellcasting / key ability modifier — familiar attack and the
     * "trained" skills (Acrobatics/Stealth by default) key off this in the
     * remaster.
     */
    abilityMod: z.number().int().default(0),
    /** Master's AC before circumstance/status (familiar copies it). */
    ac: z.number().int().min(0).default(10),
    /** Master's save modifiers before circumstance/status (familiar copies). */
    saves: z
      .object({
        fortitude: z.number().int().default(0),
        reflex: z.number().int().default(0),
        will: z.number().int().default(0),
      })
      .default({ fortitude: 0, reflex: 0, will: 0 }),
    /** Master's Perception modifier (familiar copies it). */
    perception: z.number().int().default(0),
    /** Display name of the master, for the "belongs to <master>" header. */
    name: z.string().optional(),
  })
  .default({});

// ---------------------------------------------------------------------------
// Full FamiliarSystem schema
// ---------------------------------------------------------------------------

export const FamiliarSystemSchema = z
  .object({
    /** System schema version for migrations. REQ-PF2-205 */
    systemVersion: z.string().default("0.1.0"),

    /** Which companion variant this actor is. REQ-PET-001 */
    companionKind: CompanionKindSchema.default("familiar"),

    /**
     * The master `character` Actor's `_id`. REQ-PET-002. A companion with a
     * null/dangling master is an orphan; the sheet surfaces that to the GM.
     */
    masterActorId: z.string().nullable().default(null),

    /** Snapshot of the master's relevant stats (see MasterCacheSchema). */
    master: MasterCacheSchema,

    /**
     * Free-text appearance / flavour the player sets when creating the
     * companion (e.g. "a scruffy black rat named Pickpocket"). Never derived.
     */
    appearance: z.string().default(""),

    attributes: z
      .object({
        /**
         * Current/max HP. `max` is derived (5 × master level for familiar/pet),
         * but stored so `value` (current HP, player-editable) has a container
         * and the token HP bar works before the first derive pass.
         */
        hp: HpBlockSchema.default({ value: 0, max: 0, temp: 0 }),
        /** AC total (derived: mirrors master AC). */
        ac: z.object({ value: z.number().int().min(0).default(10) }).default({ value: 10 }),
        /** Movement (familiars default to 25 ft; abilities add fly/climb/etc). */
        speed: SpeedSchema.default({ value: 25, otherSpeeds: [] }),
      })
      .default({}),

    /** Perception (derived: mirrors master) + senses granted by abilities. */
    perception: z
      .object({
        mod: z.number().int().default(0),
        senses: z.array(SenseDataSchema).default([]),
      })
      .default({ mod: 0, senses: [] }),

    /** Save modifiers (derived: mirror master before circumstance/status). */
    saves: z
      .object({
        fortitude: z.object({ value: z.number().int().default(0) }).default({ value: 0 }),
        reflex: z.object({ value: z.number().int().default(0) }).default({ value: 0 }),
        will: z.object({ value: z.number().int().default(0) }).default({ value: 0 }),
      })
      .default({}),

    /**
     * Ability-selection budget (REQ-PET-006). `max` = 2 base + modifiers from
     * the master's feats / rule elements (the Rat Familiar feat's
     * `familiarAbilities +2` → 4). Authored by petsVM from the resolved master
     * (base 2 + count of `familiarAbilities` bumps). `value` mirrors `max`
     * here (all slots are always fillable — the UI enforces the cap).
     */
    abilitiesBudget: z
      .object({
        value: z.number().int().min(0).default(2),
        max: z.number().int().min(0).default(2),
      })
      .default({ value: 2, max: 2 }),

    /**
     * Slugs of the familiar-abilities-core pack docs the player picked for the
     * day. REQ-PET-007. The picker enforces `selectedAbilities.length <=
     * abilitiesBudget.max`. Stored as slugs (stable across pack rebuilds).
     */
    selectedAbilities: z.array(z.string()).default([]),

    /** Size (familiars/pets are Tiny). */
    traits: z
      .object({
        rarity: z.enum(["common", "uncommon", "rare", "unique"]).default("common"),
        value: z.array(z.string()).default([]),
        size: SizeSchema.default("tiny"),
      })
      .default({}),

    /**
     * Progression stage — only meaningful for `animalCompanion` (V2). Familiars
     * and pets always sit at "young" (never read for them).
     */
    progression: z
      .object({
        stage: z
          .enum(["young", "mature", "incredible", "nimble", "savage"])
          .default("young"),
      })
      .default({ stage: "young" }),
  })
  .passthrough(); // REQ-PF2-204 — tolerate extra fields (derived, future keys).

export type FamiliarSystem = z.infer<typeof FamiliarSystemSchema>;

/** Parse raw data as a FamiliarSystem; throws on validation failure. */
export function parseFamiliarSystem(data: unknown): FamiliarSystem {
  return FamiliarSystemSchema.parse(data);
}
