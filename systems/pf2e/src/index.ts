/**
 * @fusion/system-pf2e — Pathfinder 2e (Remaster) game system.
 *
 * This is the main entry point for the PF2e system package. It registers:
 *   - Data models (Zod schemas) for all Actor and Item subtypes.
 *   - Conditions with their mechanical effects.
 *   - Modifier stacking rules.
 *   - Initiative formula (`pf2e`).
 *   - Registration hooks for derive steps (populated by agents M3-C/M3-D).
 *
 * Clean-room implementation. Mechanics are ORC/OGL (Archives of Nethys /
 * Pathfinder Player Core). No Foundry or Paizo proprietary code included.
 *
 * Spec: 17-sistema-pf2e.md
 * REQ-PF2-001..005.
 */

import { defineSystem } from "@fusion/system-api";

// Schemas — actors
import { CharacterSystemSchema } from "./schemas/actor-character.js";
import { NpcSystemSchema } from "./schemas/actor-npc.js";
import { HazardSystemSchema } from "./schemas/actor-hazard.js";
import { LootSystemSchema } from "./schemas/actor-loot.js";
import { FamiliarSystemSchema } from "./schemas/actor-familiar.js";

// Schemas — items
import { WeaponSystemSchema } from "./schemas/item-weapon.js";
import { ArmorSystemSchema } from "./schemas/item-armor.js";
import { SpellSystemSchema } from "./schemas/item-spell.js";
import { FeatSystemSchema } from "./schemas/item-feat.js";
import { ConditionSystemSchema } from "./schemas/item-condition.js";
import { EffectSystemSchema } from "./schemas/item-effect.js";
import { SpellcastingEntrySystemSchema } from "./schemas/item-spellcasting-entry.js";
import { ClassFeatureSystemSchema } from "./schemas/item-class-feature.js";
import {
  EquipmentSystemSchema,
  ConsumableSystemSchema,
  ShieldSystemSchema,
  TreasureSystemSchema,
  ContainerSystemSchema,
  ActionSystemSchema,
  MeleeSystemSchema,
  LoreSystemSchema,
  AncestrySystemSchema,
  BackgroundSystemSchema,
  ClassSystemSchema,
  HeritageSystemSchema,
} from "./schemas/item-equipment.js";

// Conditions, stacking, initiative
import { PF2E_CONDITIONS } from "./conditions.js";
import { PF2E_STACKING_TABLE } from "./stacking.js";
import { pf2eInitiativeFormula } from "./initiative.js";

// Derivations (M3-B — character + NPC derive steps)
import { registerDerivations } from "./derivations/index.js";

// ---------------------------------------------------------------------------
// defineSystem
// ---------------------------------------------------------------------------

export const pf2eSystem = defineSystem(
  {
    id: "pf2e",
    title: "Pathfinder 2e (Remaster)",
    version: "0.1.0",
    engineCompat: ">=0.1.0",
    authors: [{ name: "Fusion Engine Team" }],
    documentTypes: {
      Actor: ["character", "npc", "hazard", "loot", "familiar"],
      Item: [
        "weapon",
        "armor",
        "shield",
        "equipment",
        "consumable",
        "treasure",
        "container",
        "condition",
        "effect",
        "spell",
        "spellcastingEntry",
        "feat",
        "action",
        "melee",
        "lore",
        "ancestry",
        "heritage",
        "background",
        "class",
        "classFeature",
      ],
    },
    languages: [
      { lang: "pt-BR", name: "Português (Brasil)", path: "lang/pt-BR.json" },
      { lang: "en", name: "English", path: "lang/en.json" },
    ],
  },

  (registrar) => {
    // -----------------------------------------------------------------------
    // Actor schemas
    // REQ-PF2-002
    // -----------------------------------------------------------------------

    registrar.defineModel({
      documentType: "Actor",
      subtype: "character",
      schema: CharacterSystemSchema,
    });

    registrar.defineModel({
      documentType: "Actor",
      subtype: "npc",
      schema: NpcSystemSchema,
    });

    registrar.defineModel({
      documentType: "Actor",
      subtype: "hazard",
      schema: HazardSystemSchema,
    });

    registrar.defineModel({
      documentType: "Actor",
      subtype: "loot",
      schema: LootSystemSchema,
    });

    registrar.defineModel({
      documentType: "Actor",
      subtype: "familiar",
      schema: FamiliarSystemSchema,
    });

    // -----------------------------------------------------------------------
    // Item schemas
    // REQ-PF2-003
    // -----------------------------------------------------------------------

    registrar.defineModel({
      documentType: "Item",
      subtype: "weapon",
      schema: WeaponSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "armor",
      schema: ArmorSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "shield",
      schema: ShieldSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "equipment",
      schema: EquipmentSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "consumable",
      schema: ConsumableSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "treasure",
      schema: TreasureSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "container",
      schema: ContainerSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "condition",
      schema: ConditionSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "effect",
      schema: EffectSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "spell",
      schema: SpellSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "spellcastingEntry",
      schema: SpellcastingEntrySystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "feat",
      schema: FeatSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "action",
      schema: ActionSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "melee",
      schema: MeleeSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "lore",
      schema: LoreSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "ancestry",
      schema: AncestrySystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "heritage",
      schema: HeritageSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "background",
      schema: BackgroundSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "class",
      schema: ClassSystemSchema,
    });

    registrar.defineModel({
      documentType: "Item",
      subtype: "classFeature",
      schema: ClassFeatureSystemSchema,
    });

    // -----------------------------------------------------------------------
    // Conditions (REQ-PF2-050..052)
    // -----------------------------------------------------------------------

    for (const condDef of PF2E_CONDITIONS) {
      registrar.condition(condDef);
    }

    // -----------------------------------------------------------------------
    // Modifier stacking table (REQ-SYS-085, research 13 §3.2)
    // -----------------------------------------------------------------------

    registrar.stackingRules(PF2E_STACKING_TABLE);

    // -----------------------------------------------------------------------
    // Initiative formula (REQ-PF2-090)
    // -----------------------------------------------------------------------

    registrar.registerInitiativeFormula("pf2e", pf2eInitiativeFormula);

    // -----------------------------------------------------------------------
    // Chat card renderers (REQ-SYS-046)
    // These are data-only descriptors — the client renders them from the
    // payload shape without arbitrary HTML (spec 09 §chat cards).
    // -----------------------------------------------------------------------

    registrar.chatCard({
      cardType: "pf2e.strike",
      render(payload: unknown) {
        // Returns the payload as-is; Svelte component consumes it in M3-C.
        return payload;
      },
    });

    registrar.chatCard({
      cardType: "pf2e.damage",
      render(payload: unknown) {
        return payload;
      },
    });

    registrar.chatCard({
      cardType: "pf2e.check",
      render(payload: unknown) {
        return payload;
      },
    });

    // -----------------------------------------------------------------------
    // Derivation steps — character + NPC (M3-B).
    // See spec 17 §DEC-PF2-03 for the pipeline phases:
    //   base → collectModifiers (effects engine) → derived
    //
    // REQ-SYS-020, REQ-PF2-010..017, REQ-PF2-020..022.
    // -----------------------------------------------------------------------

    registerDerivations(registrar);
  },
);

// ---------------------------------------------------------------------------
// Public API re-exports
// ---------------------------------------------------------------------------

// Actor schemas
export { CharacterSystemSchema, parseCharacterSystem } from "./schemas/actor-character.js";
export type {
  CharacterSystem,
  BuildAbilities,
  BuildChoice,
  CharacterBuild,
} from "./schemas/actor-character.js";

export { NpcSystemSchema, parseNpcSystem } from "./schemas/actor-npc.js";
export type { NpcSystem } from "./schemas/actor-npc.js";

export { HazardSystemSchema, parseHazardSystem } from "./schemas/actor-hazard.js";
export type { HazardSystem } from "./schemas/actor-hazard.js";

export { LootSystemSchema, parseLootSystem } from "./schemas/actor-loot.js";
export type { LootSystem } from "./schemas/actor-loot.js";

export {
  FamiliarSystemSchema,
  parseFamiliarSystem,
  CompanionKindSchema,
  COMPANION_KINDS,
} from "./schemas/actor-familiar.js";
export type { FamiliarSystem, CompanionKind } from "./schemas/actor-familiar.js";

// Item schemas
export { WeaponSystemSchema, parseWeaponSystem } from "./schemas/item-weapon.js";
export type { WeaponSystem } from "./schemas/item-weapon.js";

export { ArmorSystemSchema, parseArmorSystem } from "./schemas/item-armor.js";
export type { ArmorSystem } from "./schemas/item-armor.js";

export { SpellSystemSchema, parseSpellSystem } from "./schemas/item-spell.js";
export type { SpellSystem } from "./schemas/item-spell.js";

export { FeatSystemSchema, parseFeatSystem } from "./schemas/item-feat.js";
export type { FeatSystem } from "./schemas/item-feat.js";

export { ConditionSystemSchema, parseConditionSystem } from "./schemas/item-condition.js";
export type { ConditionSystem } from "./schemas/item-condition.js";

export { EffectSystemSchema, parseEffectSystem } from "./schemas/item-effect.js";
export type { EffectSystem } from "./schemas/item-effect.js";

export {
  SpellcastingEntrySystemSchema,
  parseSpellcastingEntrySystem,
} from "./schemas/item-spellcasting-entry.js";
export type { SpellcastingEntrySystem } from "./schemas/item-spellcasting-entry.js";

export {
  ClassFeatureSystemSchema,
  parseClassFeatureSystem,
} from "./schemas/item-class-feature.js";
export type { ClassFeatureSystem } from "./schemas/item-class-feature.js";

export {
  EquipmentSystemSchema,
  ConsumableSystemSchema,
  ShieldSystemSchema,
  TreasureSystemSchema,
  ContainerSystemSchema,
  ActionSystemSchema,
  MeleeSystemSchema,
  LoreSystemSchema,
  AncestrySystemSchema,
  BackgroundSystemSchema,
  ClassSystemSchema,
  HeritageSystemSchema,
  ClassFeatLevelsSchema,
  ClassTrainedSkillsSchema,
  ProficiencyUpgradeSchema,
  CantripsKnownEntrySchema,
  ClassSpellSlotsEntrySchema,
  ClassSpellcastingSchema,
  ClassFeatureRefSchema,
  parseEquipmentSystem,
  parseConsumableSystem,
  parseShieldSystem,
  parseTreasureSystem,
  parseContainerSystem,
  parseActionSystem,
  parseMeleeSystem,
  parseLoreSystem,
  parseAncestrySystem,
  parseBackgroundSystem,
  parseClassSystem,
  parseHeritageSystem,
} from "./schemas/item-equipment.js";
export type {
  EquipmentSystem,
  ConsumableSystem,
  ShieldSystem,
  TreasureSystem,
  ContainerSystem,
  ActionSystem,
  MeleeSystem,
  LoreSystem,
  AncestrySystem,
  BackgroundSystem,
  ClassSystem,
  HeritageSystem,
  ClassFeatLevels,
  ClassTrainedSkills,
  ProficiencyUpgrade,
  CantripsKnownEntry,
  ClassSpellSlotsEntry,
  ClassSpellcasting,
  ClassFeatureRef,
} from "./schemas/item-equipment.js";

// Schema primitives (shared across schemas)
export * from "./schema-primitives.js";

// Types / constants
export * from "./types.js";

// Conditions
export { PF2E_CONDITIONS, PF2E_CONDITION_SLUGS, getConditionBySlug } from "./conditions.js";

// Stacking
export { PF2E_STACKING_TABLE } from "./stacking.js";

// Initiative
export { pf2eInitiativeFormula } from "./initiative.js";

// Actions (strikes, conditions manager, apply-damage pipeline)
export * from "./actions/index.js";

// Derivations (M3-B)
export * from "./derivations/index.js";
